import * as vscode from 'vscode';
import * as path from 'path';
import type { ConfigManager } from './config';
import type { TaskManager } from './taskManager';
import type { ExtToWebview, WebviewToExt, MaterialLibrary } from './shared';
import { buildAutoLibraries, scanImages, buildImageRef } from './materialLib';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private configManager: ConfigManager;
  private taskManager: TaskManager;
  private extensionUri: vscode.Uri;
  private _lastActiveMd: vscode.TextDocument | null = null;

  constructor(
    extensionUri: vscode.Uri,
    configManager: ConfigManager,
    taskManager: TaskManager,
  ) {
    this.extensionUri = extensionUri;
    this.configManager = configManager;
    this.taskManager = taskManager;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;

    this.refreshLocalResourceRoots();

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WebviewToExt) => {
      await this.handleMessage(msg);
    });

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.pushState();
      }
    });
  }

  /** 推送全量状态到 webview */
  async pushState() {
    if (!this._view) return;
    const config = await this.configManager.getConfig();

    this.post({
      type: 'config',
      config: { ...config, apiKey: config.apiKey ? '***' : '' },
    });

    const activeMd = this.getActiveMd();
    this.post({
      type: 'activeMd',
      filePath: activeMd?.uri.fsPath || null,
      fileName: activeMd ? path.basename(activeMd.uri.fsPath) : null,
    });

    const tasks = this.taskManager.getTasks();
    const history = activeMd ? this.taskManager.getHistory(activeMd.uri.fsPath) : [];
    this.post({ type: 'tasks', tasks, history });

    const materials = this.getMaterials(activeMd);
    this.post({ type: 'materials', ...materials });
  }

  /** 增量推送任务更新 */
  pushProgress() {
    if (!this._view) return;
    const tasks = this.taskManager.getTasks();
    const activeMd = this.getActiveMd();
    const history = activeMd ? this.taskManager.getHistory(activeMd.uri.fsPath) : [];
    this.post({ type: 'tasks', tasks, history });
  }

  private getActiveMd(): vscode.TextDocument | null {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.languageId === 'markdown') {
      this._lastActiveMd = editor.document;
      return editor.document;
    }
    return this._lastActiveMd || null;
  }

  setLastActiveMd(doc: vscode.TextDocument | null) {
    if (doc) {
      this._lastActiveMd = doc;
    }
  }

  private async handleMessage(msg: WebviewToExt) {
    switch (msg.type) {
      case 'generate':
        await vscode.commands.executeCommand('image-flow.generateImage');
        break;
      case 'preview':
        await vscode.commands.executeCommand('image-flow.previewRequest');
        break;
      case 'saveConfig':
        await this.configManager.set(msg.key, msg.value);
        await this.pushState();
        break;
      case 'setApiKey':
        await this.configManager.setApiKey(msg.value);
        break;
      case 'addMaterialDir':
        await this.handleAddMaterialDir();
        break;
      case 'removeMaterialDir':
        await this.configManager.removeMaterialDir(msg.dir);
        await this.pushState();
        this.refreshLocalResourceRoots();
        break;
      case 'insertImage':
        await this.handleInsertImage(msg.imagePath);
        break;
      case 'openImage':
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(msg.imagePath));
        break;
      case 'openUrl':
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
    }
  }

  private async handleAddMaterialDir() {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (result && result[0]) {
      await this.configManager.addMaterialDir(result[0].fsPath);
      await this.pushState();
      this.refreshLocalResourceRoots();
    }
  }

  private async handleInsertImage(imagePath: string) {
    const editor = vscode.window.activeTextEditor;
    const activeMd = this.getActiveMd();

    if (!editor || !activeMd || editor.document.uri.fsPath !== activeMd.uri.fsPath) {
      vscode.window.showWarningMessage('请先切换到生效的 Markdown 文件再插入引用');
      return;
    }

    const ref = buildImageRef(activeMd.uri.fsPath, imagePath);
    if (!ref) {
      vscode.window.showWarningMessage('无法生成相对路径引用（可能跨盘符）');
      return;
    }

    await editor.edit((editBuilder) => {
      editBuilder.insert(editor.selection.active, ref);
    });
  }

  private getMaterials(activeMd: vscode.TextDocument | null) {
    const workspaces = vscode.workspace.workspaceFolders;
    const root = workspaces?.[0]?.uri.fsPath || '';

    const auto: MaterialLibrary[] = activeMd
      ? buildAutoLibraries(activeMd.uri.fsPath, root, (p) => this.getWebviewUri(p))
      : [];

    const manualDirs = this.configManager.getMaterialDirs();
    const manual: MaterialLibrary[] = manualDirs.map((dir) => ({
      name: path.basename(dir),
      path: dir,
      images: scanImages(dir, true, (p) => this.getWebviewUri(p)),
    }));

    return { auto, manual };
  }

  private getWebviewUri(filePath: string): vscode.Uri {
    return this._view!.webview.asWebviewUri(vscode.Uri.file(filePath));
  }

  refreshLocalResourceRoots() {
    if (!this._view) return;
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.extensionUri, 'media'),
    ];

    const workspaces = vscode.workspace.workspaceFolders;
    if (workspaces) {
      for (const ws of workspaces) {
        roots.push(ws.uri);
      }
    }

    const manualDirs = this.configManager.getMaterialDirs();
    for (const dir of manualDirs) {
      roots.push(vscode.Uri.file(dir));
    }

    this._view.webview.options = {
      enableScripts: true,
      localResourceRoots: roots,
    };
  }

  private post(msg: ExtToWebview) {
    this._view?.webview.postMessage(msg);
  }

  /** CSP 安全的 HTML */
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'media', 'sidebar.css'),
    );
    const csp = [
      'default-src \'none\'',
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 64; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
