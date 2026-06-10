// Webview 侧栏提供者
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BackendMessage, FrontendMessage, ImageFlowConfig, AssetFolder } from './shared';
import { loadConfig, saveConfig, saveApiKey, getAssetFolders, setAssetFolders } from './config';
import { getAllAssetFolders, buildInsertRef } from './asset-library';
import { parseMarkdown } from './markdown-parser';
import { buildPreview } from './preview';
import { TaskManager, taskEvents } from './task-manager';

export class SidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'image-flow.sidebar';
  private view?: vscode.WebviewView;
  private activeMdPath = '';
  private pendingGenerateMdPath = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly taskManager: TaskManager,
  ) {}

  /** 设置生效 MD */
  setActiveMd(mdPath: string): void {
    if (mdPath !== this.activeMdPath) {
      this.activeMdPath = mdPath;
      this.postMessage({ type: 'activeMdChanged', mdPath });
      this.updateHistory();
    }
  }

  /** 获取生效 MD */
  getActiveMd(): string {
    return this.activeMdPath;
  }

  /** 设置待生成 MD（右键触发生成时用） */
  setPendingGenerateMd(mdPath: string): void {
    this.pendingGenerateMdPath = mdPath;
  }

  /** 刷新 UI 数据 */
  refresh(): void {
    this.updateHistory();
    this.updateAssetFolders();
    this.updateTasks();
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.getLocalResourceRoots(),
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    // 消息处理
    webviewView.webview.onDidReceiveMessage(async (msg: FrontendMessage) => {
      await this.handleMessage(msg);
    });

    // 监听任务事件
    taskEvents.event(() => {
      this.updateTasks();
      this.updateHistory();
    });

    // 监听活动编辑器变化
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document && editor.document.uri.fsPath.endsWith('.md')) {
        this.setActiveMd(editor.document.uri.fsPath);
      }
    });
  }

  /** 处理前端消息 */
  private async handleMessage(msg: FrontendMessage): Promise<void> {
    switch (msg.type) {
      case 'init': {
        const config = await loadConfig(this.context);
        const tasks = this.taskManager.getTasks();
        const history = this.taskManager.getHistory(this.activeMdPath);
        const manualFolders = getAssetFolders(this.context);
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        const assetFolders = getAllAssetFolders(workspaceRoot, this.activeMdPath, manualFolders);
        this.postMessage({
          type: 'initResponse',
          config,
          activeMdPath: this.activeMdPath,
          tasks,
          history,
          assetFolders,
        });
        break;
      }
      case 'generate': {
        await this.doGenerate(msg.mdPath);
        break;
      }
      case 'previewRequest': {
        await this.doPreview(msg.mdPath);
        break;
      }
      case 'setConfig': {
        const patch: Record<string, unknown> = {};
        patch[msg.key] = msg.value;
        const config = await saveConfig(this.context, patch as Partial<ImageFlowConfig>);
        this.postMessage({ type: 'configUpdated', config });
        break;
      }
      case 'setApiKey': {
        await saveApiKey(this.context, msg.apiKey);
        const config = await loadConfig(this.context);
        this.postMessage({ type: 'configUpdated', config });
        break;
      }
      case 'addAssetFolder': {
        await this.addAssetFolder();
        break;
      }
      case 'removeAssetFolder': {
        await this.removeAssetFolder(msg.folderPath);
        break;
      }
      case 'insertAssetRef': {
        await this.insertAssetRef(msg.imagePath);
        break;
      }
      case 'openImage': {
        await this.openImage(msg.imagePath);
        break;
      }
      case 'setModelInjection': {
        const config = await loadConfig(this.context);
        const injections = { ...config.modelInjections, [msg.model]: msg.injection };
        if (msg.injection === '') {
          delete injections[msg.model];
        }
        const updated = await saveConfig(this.context, { modelInjections: injections });
        this.postMessage({ type: 'configUpdated', config: updated });
        break;
      }
      case 'getTasks': {
        this.updateTasks();
        break;
      }
      case 'getHistory': {
        this.updateHistory();
        break;
      }
      case 'getAssetFolders': {
        this.updateAssetFolders();
        break;
      }
    }
  }

  /** 执行生成 */
  async doGenerate(mdPath: string): Promise<void> {
    const config = await loadConfig(this.context);

    if (!config.apiKey) {
      this.postMessage({ type: 'statusMessage', message: '请先在设置页配置 API Key', level: 'error' });
      return;
    }

    try {
      const content = fs.readFileSync(mdPath, 'utf-8').trim();
      if (!content) {
        this.postMessage({ type: 'statusMessage', message: '内容为空', level: 'error' });
        return;
      }

      const mdDir = path.dirname(mdPath);
      const parsed = parseMarkdown(content, mdDir);

      // 拼装最终 prompt
      const finalPrompt = await this.assemblePrompt(parsed.body);

      // 创建任务
      await this.taskManager.createTask(
        mdPath,
        config.model,
        config.aspectRatio,
        config.imageSize,
        config.concurrency,
        config.baseUrl,
        config.apiKey,
        finalPrompt,
        parsed.references.map(r => r.dataUri),
      );

      this.postMessage({ type: 'statusMessage', message: '任务已提交', level: 'info' });
      this.updateTasks();

      // 自动切到任务标签
      this.postMessage({ type: 'switchTab', tab: 'tasks' } as unknown as BackendMessage);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'statusMessage', message: msg, level: 'error' });
    }
  }

  /** 执行预览 */
  async doPreview(mdPath: string): Promise<void> {
    const config = await loadConfig(this.context);
    try {
      const content = fs.readFileSync(mdPath, 'utf-8').trim();
      if (!content) {
        this.postMessage({ type: 'statusMessage', message: '内容为空', level: 'error' });
        return;
      }

      const mdDir = path.dirname(mdPath);
      const parsed = parseMarkdown(content, mdDir);
      const finalPrompt = await this.assemblePrompt(parsed.body);

      const refFileNames = parsed.references.map(r => path.basename(r.absPath));
      const refDataUris = parsed.references.map(r => r.dataUri);

      const previewText = buildPreview(
        config.model,
        config.aspectRatio,
        config.imageSize,
        config.baseUrl,
        finalPrompt,
        refDataUris,
        refFileNames,
      );

      // 打开临时预览文档
      const doc = await vscode.workspace.openTextDocument({
        content: previewText,
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'statusMessage', message: msg, level: 'error' });
    }
  }

  /** 组装最终 prompt（含模型注入句 + IMAGES.md + 替换后正文） */
  private async assemblePrompt(body: string): Promise<string> {
    const config = await loadConfig(this.context);
    const parts: string[] = [];

    // 模型注入句
    const injection = config.modelInjections[config.model];
    if (injection) {
      parts.push(injection);
    }

    // IMAGES.md 全文
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      const imagesMdPath = path.join(workspaceRoot, 'IMAGES.md');
      try {
        const imagesContent = fs.readFileSync(imagesMdPath, 'utf-8').trim();
        if (imagesContent) {
          parts.push(imagesContent);
        }
      } catch { /* 不存在/读取失败，静默跳过 */ }
    }

    parts.push(body);
    return parts.join('\n\n');
  }

  /** 添加手动素材库文件夹 */
  private async addAssetFolder(): Promise<void> {
    const result = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      title: '选择素材库文件夹',
    });

    if (!result || result.length === 0) { return; }

    const folderPath = result[0].fsPath;
    const folders = getAssetFolders(this.context);

    // 去重
    if (!folders.includes(folderPath)) {
      folders.push(folderPath);
      await setAssetFolders(this.context, folders);
    }

    this.updateAssetFolders();
    // 更新 localResourceRoots
    if (this.view) {
      this.view.webview.options = {
        enableScripts: true,
        localResourceRoots: this.getLocalResourceRoots(),
      };
    }
  }

  /** 移除手动素材库文件夹 */
  private async removeAssetFolder(folderPath: string): Promise<void> {
    let folders = getAssetFolders(this.context);
    folders = folders.filter(f => f !== folderPath);
    await setAssetFolders(this.context, folders);
    this.updateAssetFolders();

    if (this.view) {
      this.view.webview.options = {
        enableScripts: true,
        localResourceRoots: this.getLocalResourceRoots(),
      };
    }
  }

  /** 插入图片引用到生效 MD 光标处 */
  private async insertAssetRef(imagePath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.fsPath !== this.activeMdPath) {
      vscode.window.showWarningMessage('当前活动编辑器不是生效的 Markdown 文件，无法插入引用');
      return;
    }

    const refText = buildInsertRef(imagePath, this.activeMdPath);
    if (refText === null) {
      vscode.window.showWarningMessage('跨盘符无法生成相对路径引用');
      return;
    }

    await editor.edit(editBuilder => {
      editBuilder.insert(editor.selection.active, refText);
    });
  }

  /** 打开图片 */
  private async openImage(imagePath: string): Promise<void> {
    try {
      const uri = vscode.Uri.file(imagePath);
      await vscode.commands.executeCommand('vscode.open', uri);
    } catch {
      // ignore
    }
  }

  /** 获取 localResourceRoots */
  private getLocalResourceRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.file(path.join(this.context.extensionPath, 'media')),
    ];

    // 工作区目录
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (workspaceRoot) {
      roots.push(workspaceRoot);
    }

    // 素材库目录
    const manualFolders = getAssetFolders(this.context);
    for (const folder of manualFolders) {
      roots.push(vscode.Uri.file(folder));
    }

    return roots;
  }

  /** 向 webview 发送消息 */
  private postMessage(msg: BackendMessage): void {
    this.view?.webview.postMessage(msg);
  }

  /** 刷新任务列表 */
  private updateTasks(): void {
    const tasks = this.taskManager.getTasks();
    this.postMessage({ type: 'tasksUpdated', tasks });
  }

  /** 刷新历史 */
  private updateHistory(): void {
    const history = this.taskManager.getHistory(this.activeMdPath);
    this.postMessage({ type: 'historyUpdated', history });
  }

  /** 刷新素材库 */
  private updateAssetFolders(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const manualFolders = getAssetFolders(this.context);
    const assetFolders = getAllAssetFolders(workspaceRoot, this.activeMdPath, manualFolders);

    // 将本地图片路径转为 webview URI
    const webviewFolders = assetFolders.map(f => ({
      ...f,
      images: f.images.map(img => {
        if (this.view) {
          return this.view.webview.asWebviewUri(vscode.Uri.file(img)).toString();
        }
        return img;
      }),
      path: '', // 不暴露本地路径给前端
    }));

    this.postMessage({
      type: 'assetFoldersUpdated',
      assetFolders: webviewFolders as unknown as AssetFolder[],
    });
  }

  /** 生成 webview HTML（CSP + nonce） */
  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const sidebarUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebar.js')),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'sidebar.css')),
    );
    const cspSource = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data: https:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${cspSource};">
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${sidebarUri}"></script>
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
