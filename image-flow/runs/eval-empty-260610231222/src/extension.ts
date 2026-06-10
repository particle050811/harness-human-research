// image-flow VS Code 扩展主入口

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { getConfig, seedModelInjections, setApiKey, setConfigValue, addMediaFolder, removeMediaFolder } from './config';
import { parseMarkdown, buildFinalPrompt } from './markdownParser';
import { initTaskManager, disposeTaskManager, getTasks, createTask, submitAllJobs } from './taskManager';
import { showPreview, readImagesMd } from './preview';
import { scanManualMediaFolders, scanAutoMediaFolders, scanHistoryImages, makeRelativeImageRef } from './mediaLibrary';
import { ActiveMdInfo, ExtToWv, WvToExt, TaskInfo, HistoryItem, isTaskFolder, MediaFolder } from './shared';

let sidebarProvider: SidebarProvider | undefined;
let activeMdPath: string | null = null;
let activeMdFileName: string | null = null;

export function activate(context: vscode.ExtensionContext): void {
  seedModelInjections(context.globalState);

  initTaskManager(
    context,
    () => sidebarProvider?.sendTasks(),
    (task) => sidebarProvider?.onTaskCompleted(task),
  );

  sidebarProvider = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('image-flow.sidebar', sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.generateImage', async (uri?: vscode.Uri) => {
      await handleGenerate(uri, context);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.previewRequest', async (uri?: vscode.Uri) => {
      await handlePreview(uri, context);
    }),
  );

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateActiveMd(editor);
    }),
  );

  updateActiveMd(vscode.window.activeTextEditor);

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('image-flow')) {
        sidebarProvider?.sendConfig();
      }
    }),
  );
}

export function deactivate(): void {
  disposeTaskManager();
}

function updateActiveMd(editor: vscode.TextEditor | undefined): void {
  if (!editor || !editor.document) return;
  const doc = editor.document;
  if (doc.uri.scheme === 'file' && doc.fileName.endsWith('.md')) {
    activeMdPath = doc.fileName;
    activeMdFileName = path.basename(doc.fileName);
    sidebarProvider?.sendActiveMd();
    sidebarProvider?.refreshHistory();
    sidebarProvider?.refreshAutoMedia();
  }
}

async function handleGenerate(uri: vscode.Uri | undefined, context: vscode.ExtensionContext): Promise<void> {
  try {
    const mdPath = resolveMdPath(uri);
    if (!mdPath) return;

    const config = await getConfig(context.secrets, context.globalState);
    if (!config.apiKey) {
      vscode.window.showErrorMessage('请先配置 API Key');
      return;
    }

    const mdDir = path.dirname(mdPath);
    const mdContent = fs.readFileSync(mdPath, 'utf-8');

    if (mdContent.trim() === '') {
      vscode.window.showErrorMessage('内容为空');
      return;
    }

    const parsed = parseMarkdown(mdContent, mdDir);

    const injection = config.modelInjections[config.model] ?? '';
    const imagesMdContent = readImagesMd();
    const finalPrompt = buildFinalPrompt(parsed.body, injection, imagesMdContent);

    const task = await createTask(mdPath, config.model, config.concurrency);

    sidebarProvider?.sendTasks();
    sidebarProvider?.switchToTasks();

    submitAllJobs(task, finalPrompt, parsed.images, config.aspectRatio, config.imageSize)
      .then(() => sidebarProvider?.sendTasks())
      .catch((err) => {
        vscode.window.showErrorMessage(String(err));
        sidebarProvider?.sendTasks();
      });
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
  }
}

async function handlePreview(uri: vscode.Uri | undefined, context: vscode.ExtensionContext): Promise<void> {
  try {
    const mdPath = resolveMdPath(uri);
    if (!mdPath) return;
    await showPreview(mdPath, context, context.globalState, context.secrets);
  } catch (err) {
    vscode.window.showErrorMessage(String(err));
  }
}

function resolveMdPath(uri: vscode.Uri | undefined): string | null {
  if (uri) {
    activeMdPath = uri.fsPath;
    activeMdFileName = path.basename(uri.fsPath);
    sidebarProvider?.sendActiveMd();
    sidebarProvider?.refreshHistory();
    sidebarProvider?.refreshAutoMedia();
    return uri.fsPath;
  }
  if (activeMdPath) return activeMdPath;

  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.fileName.endsWith('.md')) {
    activeMdPath = editor.document.fileName;
    activeMdFileName = path.basename(editor.document.fileName);
    sidebarProvider?.sendActiveMd();
    sidebarProvider?.refreshHistory();
    sidebarProvider?.refreshAutoMedia();
    return editor.document.fileName;
  }

  vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
  return null;
}

// ---- 侧栏 Provider ----

class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private context: vscode.ExtensionContext;
  /** webview URI → 本地路径 */
  private uriToLocalPath = new Map<string, string>();

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg: WvToExt) => {
      await this.handleMessage(msg);
    });

    this.sendInit().catch(() => {});
  }

  private getLocalResourceRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [vscode.Uri.joinPath(this.context.extensionUri, 'media')];
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const wf of workspaceFolders) {
        roots.push(wf.uri);
      }
    }
    const mediaFolders = scanManualMediaFolders(this.context.workspaceState);
    for (const mf of mediaFolders) {
      roots.push(vscode.Uri.file(mf.path));
    }
    return roots;
  }

  private getHtml(webview: vscode.Webview): string {
    const extUri = this.context.extensionUri;
    const nonce = getNonce();

    const sidebarJsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, 'media', 'sidebar.js'),
    );
    const sidebarCssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, 'media', 'sidebar.css'),
    );

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${sidebarCssUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${sidebarJsUri}"></script>
</body>
</html>`;
  }

  /** 本地路径转 webview URI */
  private toWvUri(localPath: string): string {
    const wv = this.view?.webview;
    if (!wv) return localPath;
    const uri = wv.asWebviewUri(vscode.Uri.file(localPath)).toString();
    this.uriToLocalPath.set(uri, localPath);
    return uri;
  }

  private convertPaths(paths: string[]): string[] {
    return paths.map(p => this.toWvUri(p));
  }

  private convertTask(t: TaskInfo): TaskInfo {
    return {
      ...t,
      jobs: t.jobs.map(j => ({
        ...j,
        results: j.results ? this.convertPaths(j.results) : j.results,
      })),
    };
  }

  private convertHistory(h: HistoryItem): HistoryItem {
    return { ...h, images: this.convertPaths(h.images) };
  }

  private convertMediaFolder(mf: MediaFolder): MediaFolder {
    return { ...mf, images: this.convertPaths(mf.images) };
  }

  private async handleMessage(msg: WvToExt): Promise<void> {
    try {
      switch (msg.type) {
        case 'init':
          await this.sendInit();
          break;

        case 'generate':
          await vscode.commands.executeCommand('image-flow.generateImage', vscode.Uri.file(msg.filePath));
          break;

        case 'previewRequest':
          await vscode.commands.executeCommand('image-flow.previewRequest', vscode.Uri.file(msg.filePath));
          break;

        case 'updateConfig':
          if (msg.key === 'apiKey') {
            await setApiKey(this.context.secrets, String(msg.value));
          } else {
            setConfigValue(this.context.globalState, msg.key, msg.value);
          }
          this.postMessage({ type: 'configUpdate', key: msg.key, value: msg.value });
          break;

        case 'addMediaFolder': {
          const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
          });
          if (folders && folders.length > 0) {
            addMediaFolder(this.context.workspaceState, folders[0].fsPath);
            this.view!.webview.options = {
              enableScripts: true,
              localResourceRoots: this.getLocalResourceRoots(),
            };
            this.sendMediaFolders();
          }
          break;
        }

        case 'removeMediaFolder':
          removeMediaFolder(this.context.workspaceState, msg.path);
          this.view!.webview.options = {
            enableScripts: true,
            localResourceRoots: this.getLocalResourceRoots(),
          };
          this.sendMediaFolders();
          break;

        case 'insertImageRef': {
          const editor = vscode.window.activeTextEditor;
          if (!editor || editor.document.fileName !== activeMdPath) {
            vscode.window.showWarningMessage('当前活动编辑器不是生效的 Markdown 文件，无法插入引用');
            return;
          }
          const localPath = this.uriToLocalPath.get(msg.imagePath) ?? msg.imagePath;
          const mdDir = path.dirname(editor.document.fileName);
          try {
            const ref = makeRelativeImageRef(mdDir, localPath);
            editor.edit((eb) => eb.insert(editor.selection.active, ref));
          } catch (e) {
            vscode.window.showWarningMessage(String(e));
          }
          break;
        }

        case 'openImage': {
          const localPath = this.uriToLocalPath.get(msg.imagePath) ?? msg.imagePath;
          const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
          await vscode.window.showTextDocument(doc);
          break;
        }

        case 'openUrl':
          await vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
      }
    } catch (err) {
      this.postMessage({ type: 'statusMessage', message: String(err), isError: true });
    }
  }

  private postMessage(msg: ExtToWv): void {
    this.view?.webview.postMessage(msg);
  }

  async sendInit(): Promise<void> {
    this.uriToLocalPath.clear();
    const config = await getConfig(this.context.secrets, this.context.globalState);
    const tasks = getTasks().map(t => this.convertTask(t));
    const activeMd: ActiveMdInfo | null = activeMdPath
      ? { filePath: activeMdPath, fileName: activeMdFileName! } : null;
    const history = this.getHistory().map(h => this.convertHistory(h));
    const mediaFolders = scanManualMediaFolders(this.context.workspaceState).map(mf => this.convertMediaFolder(mf));
    const autoMediaFolders = scanAutoMediaFolders(activeMdPath).map(mf => this.convertMediaFolder(mf));

    this.postMessage({
      type: 'initResponse',
      config, activeMd, tasks, history, mediaFolders, autoMediaFolders,
    });
  }

  sendTasks(): void {
    this.uriToLocalPath.clear();
    this.postMessage({ type: 'taskUpdate', tasks: getTasks().map(t => this.convertTask(t)) });
  }

  sendConfig(): void {
    getConfig(this.context.secrets, this.context.globalState).then((config) => {
      this.uriToLocalPath.clear();
      const tasks = getTasks().map(t => this.convertTask(t));
      const activeMd: ActiveMdInfo | null = activeMdPath
        ? { filePath: activeMdPath, fileName: activeMdFileName! } : null;
      const history = this.getHistory().map(h => this.convertHistory(h));
      const mediaFolders = scanManualMediaFolders(this.context.workspaceState).map(mf => this.convertMediaFolder(mf));
      const autoMediaFolders = scanAutoMediaFolders(activeMdPath).map(mf => this.convertMediaFolder(mf));
      this.postMessage({
        type: 'initResponse',
        config, activeMd, tasks, history, mediaFolders, autoMediaFolders,
      });
    });
  }

  sendActiveMd(): void {
    const activeMd: ActiveMdInfo | null = activeMdPath
      ? { filePath: activeMdPath, fileName: activeMdFileName! } : null;
    this.postMessage({ type: 'activeMdChanged', activeMd });
  }

  sendMediaFolders(): void {
    const mediaFolders = scanManualMediaFolders(this.context.workspaceState).map(mf => this.convertMediaFolder(mf));
    const autoMediaFolders = scanAutoMediaFolders(activeMdPath).map(mf => this.convertMediaFolder(mf));
    this.postMessage({ type: 'mediaFoldersUpdate', folders: mediaFolders });
    this.postMessage({ type: 'autoMediaFoldersUpdate', folders: autoMediaFolders });
  }

  switchToTasks(): void {
    this.postMessage({ type: 'switchTab', tab: 'tasks' });
  }

  onTaskCompleted(task: TaskInfo): void {
    this.uriToLocalPath.clear();
    this.postMessage({ type: 'taskCompleted', taskInfo: this.convertTask(task) });
    this.refreshHistory();
  }

  refreshHistory(): void {
    const history = this.getHistory().map(h => this.convertHistory(h));
    this.postMessage({ type: 'historyUpdate', history });
  }

  refreshAutoMedia(): void {
    this.sendMediaFolders();
  }

  private getHistory(): HistoryItem[] {
    if (!activeMdPath) return [];
    const mdDir = path.dirname(activeMdPath);
    const activeTasks = new Set(getTasks().map(t => t.folderName));

    const historyItems: HistoryItem[] = [];
    try {
      const entries = fs.readdirSync(mdDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !isTaskFolder(entry.name)) continue;
        if (activeTasks.has(entry.name)) continue;
        const folderPath = path.join(mdDir, entry.name);
        const images = scanHistoryImages(folderPath);
        if (images.length === 0) continue;
        historyItems.push({
          folderName: entry.name,
          folderPath,
          images,
          imageCount: images.length,
        });
      }
    } catch {
      // ignore
    }

    historyItems.sort((a, b) => b.folderName.localeCompare(a.folderName));
    return historyItems;
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
