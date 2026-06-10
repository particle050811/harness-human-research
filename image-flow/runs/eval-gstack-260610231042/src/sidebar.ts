import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskManager } from './tasks';
import {
  ExtensionEvent,
  WebviewCommand,
  InitPayload,
  MaterialFolder,
  ImageFlowConfig,
} from './shared';
import { readConfig, getApiKey, setApiKey, writeConfigField, getModelInjection, getMaterialFolders, setMaterialFolders } from './config';
import {
  getAutoMaterials,
  getManualMaterials,
  pickMaterialFolder,
} from './materials';
import { processMarkdown, ParseResult } from './parser';
import { posixRelative, needsAngleBrackets } from './utils';
import { showPreview } from './preview';

/** 获取 webview HTML 内容（script nonce 由扩展端生成） */
function getWebviewHtml(webview: vscode.Webview, extUri: vscode.Uri): string {
  const nonce = getNonce();
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'media', 'sidebar.js')
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extUri, 'media', 'sidebar.css')
  );

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src 'nonce-${nonce}';
    style-src ${webview.cspSource} 'unsafe-inline';
    img-src ${webview.cspSource} data: https:;
    font-src ${webview.cspSource};
  ">
  <link rel="stylesheet" href="${cssUri}">
  <title>AI 绘图</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 64; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | null = null;
  private taskManager: TaskManager;
  private activeMdPath: string = '';
  private activeMdName: string = '';
  private config: Omit<ImageFlowConfig, 'apiKey'>;
  private apiKeySet = false;
  private context: vscode.ExtensionContext;
  private statusEventHandler: vscode.Disposable | null = null;

  constructor(context: vscode.ExtensionContext, taskManager: TaskManager) {
    this.context = context;
    this.taskManager = taskManager;
    this.config = readConfig();

    this.taskManager.setOnUpdate(() => {
      this.pushTasks();
    });

    // 监听活动编辑器变化
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => this.onActiveEditorChanged(editor),
      null,
      context.subscriptions
    );

    // 初始活动编辑器
    this.onActiveEditorChanged(vscode.window.activeTextEditor);
  }

  private onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (editor?.document.languageId === 'markdown' ||
        editor?.document.fileName.endsWith('.md')) {
      this.activeMdPath = editor.document.fileName;
      this.activeMdName = path.basename(editor.document.fileName);
      this.pushActiveMd();
    }
    // 切到非 MD 不清空，保留上一个
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: this.buildLocalResourceRoots(),
    };

    webviewView.webview.html = getWebviewHtml(
      webviewView.webview,
      this.context.extensionUri
    );

    webviewView.webview.onDidReceiveMessage(
      (msg: WebviewCommand) => this.handleWebviewMessage(msg)
    );

    // 监听配置变更，推送到前端
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('image-flow')) {
        this.config = readConfig();
        this.pushConfig();
      }
    }, null, this.context.subscriptions);
  }

  private buildLocalResourceRoots(): vscode.Uri[] {
    const roots: vscode.Uri[] = [
      vscode.Uri.joinPath(this.context.extensionUri, 'media'),
    ];

    // 工作区目录
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders) {
      for (const wf of workspaceFolders) {
        roots.push(wf.uri);
      }
    }

    // 素材库目录
    const materialFolders = getMaterialFolders(this.context);
    for (const mf of materialFolders) {
      try {
        roots.push(vscode.Uri.file(mf));
      } catch { /* ignore */ }
    }

    return roots;
  }

  /** 重设 localResourceRoots（素材库增删后调用） */
  private refreshResourceRoots(): void {
    if (this.view) {
      this.view.webview.options = {
        enableScripts: true,
        localResourceRoots: this.buildLocalResourceRoots(),
      };
    }
  }

  // ========== 消息处理 ==========

  private async handleWebviewMessage(msg: WebviewCommand): Promise<void> {
    switch (msg.type) {
      case 'init':
        await this.pushInit();
        break;
      case 'generate':
        await this.handleGenerate();
        break;
      case 'preview':
        await this.handlePreview();
        break;
      case 'setApiKey':
        await setApiKey(this.context, msg.value);
        this.apiKeySet = !!msg.value;
        this.postMessage({ type: 'configUpdate', key: 'apiKey', value: !!msg.value });
        break;
      case 'setConfig':
        await writeConfigField(this.context, msg.key, msg.value);
        break;
      case 'setModelInjection':
        await this.handleSetModelInjection(msg.model, msg.injection);
        break;
      case 'addMaterialFolder':
        await this.handleAddMaterialFolder();
        break;
      case 'removeMaterialFolder':
        await this.handleRemoveMaterialFolder(msg.path);
        break;
      case 'insertImage':
        await this.handleInsertImage(msg.imagePath);
        break;
      case 'openImage':
        await this.handleOpenImage(msg.imagePath);
        break;
      case 'openUrl':
        vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
    }
  }

  private async pushInit(): Promise<void> {
    this.apiKeySet = !!(await getApiKey(this.context));
    const configForInit: InitPayload['config'] = {
      baseUrl: this.config.baseUrl,
      model: this.config.model,
      aspectRatio: this.config.aspectRatio,
      imageSize: this.config.imageSize,
      concurrency: this.config.concurrency,
      workbenchCols: this.config.workbenchCols,
      tasksCols: this.config.tasksCols,
      modelInjections: this.config.modelInjections,
      apiKey: this.apiKeySet,
    };
    const payload: InitPayload = {
      config: configForInit,
      activeMdPath: this.activeMdPath,
      activeMdName: this.activeMdName,
      tasks: [...this.taskManager.getTasks()],
      history: this.activeMdPath ? this.taskManager.scanHistory(this.activeMdPath) : [],
      materials: getManualMaterials(getMaterialFolders(this.context)),
      autoMaterials: this.getCurrentAutoMaterials(),
    };
    this.postMessage({ type: 'init', payload });
  }

  private async pushTasks(): Promise<void> {
    const history = this.activeMdPath
      ? this.taskManager.scanHistory(this.activeMdPath)
      : [];
    this.postMessage({
      type: 'taskUpdate',
      tasks: [...this.taskManager.getTasks()],
      history,
    });
  }

  private pushActiveMd(): void {
    this.postMessage({
      type: 'activeMdUpdate',
      path: this.activeMdPath,
      name: this.activeMdName,
    });
    // 同时刷新历史与自动素材库
    this.pushTasks();
    this.pushAutoMaterials();
  }

  private pushConfig(): void {
    for (const [key, value] of Object.entries(this.config)) {
      this.postMessage({ type: 'configUpdate', key, value });
    }
  }

  private pushAutoMaterials(): void {
    this.postMessage({
      type: 'materialUpdate',
      materials: getManualMaterials(getMaterialFolders(this.context)),
      autoMaterials: this.getCurrentAutoMaterials(),
    });
  }

  private getCurrentAutoMaterials(): MaterialFolder[] {
    if (!this.activeMdPath) return [];
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(this.activeMdPath)
    );
    if (!workspaceFolder) return [];
    return getAutoMaterials(this.activeMdPath, workspaceFolder.uri.fsPath);
  }

  private postMessage(event: ExtensionEvent): void {
    this.view?.webview.postMessage(event);
  }

  // ========== 生成处理 ==========

  private async handleGenerate(): Promise<void> {
    const apiKey = await getApiKey(this.context);
    if (!apiKey) {
      this.postMessage({
        type: 'statusMessage',
        text: '请先在设置页填写 API Key',
        isError: true,
      });
      vscode.window.showWarningMessage('Image Flow: 请先在设置页填写 API Key');
      return;
    }

    if (!this.activeMdPath) {
      this.postMessage({
        type: 'statusMessage',
        text: '未打开 Markdown 文件',
        isError: true,
      });
      return;
    }

    // 读取 MD 内容
    let content: string;
    try {
      content = fs.readFileSync(this.activeMdPath, 'utf-8');
    } catch {
      this.postMessage({
        type: 'statusMessage',
        text: '无法读取 Markdown 文件',
        isError: true,
      });
      return;
    }

    if (!content.trim()) {
      this.postMessage({
        type: 'statusMessage',
        text: '内容为空',
        isError: true,
      });
      vscode.window.showErrorMessage('Image Flow: 内容为空');
      return;
    }

    // 解析 Markdown
    let parsed: ParseResult;
    try {
      const mdDir = path.dirname(this.activeMdPath);
      parsed = processMarkdown(content, mdDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'statusMessage', text: msg, isError: true });
      vscode.window.showErrorMessage(`Image Flow: ${msg}`);
      return;
    }

    // 组装最终 prompt
    const finalPrompt = this.assemblePrompt(parsed.text);

    // 创建任务（异步提交在 tasks.ts 内处理）
    try {
      await this.taskManager.createTask(
        this.activeMdPath,
        finalPrompt,
        parsed.images,
        this.config.model,
        this.config.concurrency,
        this.config.baseUrl,
        apiKey,
        this.config.aspectRatio,
        this.config.imageSize,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.postMessage({ type: 'statusMessage', text: msg, isError: true });
      return;
    }

    this.postMessage({ type: 'statusMessage', text: '任务已提交', isError: false });
  }

  /** 组装最终 prompt：注入 + IMAGES.md + 正文 */
  private assemblePrompt(processedText: string): string {
    const parts: string[] = [];

    const injection = getModelInjection(this.config, this.config.model);
    if (injection) parts.push(injection);

    // IMAGES.md
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      this.activeMdPath ? vscode.Uri.file(this.activeMdPath) : undefined as unknown as vscode.Uri
    );
    if (workspaceFolder) {
      try {
        const imagesPath = path.join(workspaceFolder.uri.fsPath, 'IMAGES.md');
        const imContent = fs.readFileSync(imagesPath, 'utf-8').trim();
        if (imContent) parts.push(imContent);
      } catch { /* 静默跳过 */ }
    }

    if (processedText.trim()) parts.push(processedText);

    return parts.join('\n\n');
  }

  // ========== 预览处理 ==========

  private async handlePreview(): Promise<void> {
    if (!this.activeMdPath) {
      this.postMessage({
        type: 'statusMessage',
        text: '未打开 Markdown 文件',
        isError: true,
      });
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(this.activeMdPath, 'utf-8');
    } catch {
      this.postMessage({
        type: 'statusMessage',
        text: '无法读取 Markdown 文件',
        isError: true,
      });
      return;
    }

    if (!content.trim()) {
      vscode.window.showErrorMessage('Image Flow: 内容为空');
      return;
    }

    let parsed: ParseResult;
    try {
      const mdDir = path.dirname(this.activeMdPath);
      parsed = processMarkdown(content, mdDir);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Image Flow: ${msg}`);
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(
      vscode.Uri.file(this.activeMdPath)
    );

    await showPreview(
      this.activeMdPath,
      parsed.text,
      parsed.images,
      this.config.model,
      this.config,
      workspaceFolder?.uri.fsPath,
    );
  }

  // ========== 配置处理 ==========

  private async handleSetModelInjection(model: string, injection: string): Promise<void> {
    const current = { ...this.config.modelInjections };
    current[model] = injection;
    await writeConfigField(this.context, 'modelInjections', current);
  }

  // ========== 素材库处理 ==========

  private async handleAddMaterialFolder(): Promise<void> {
    const folderPath = await pickMaterialFolder();
    if (!folderPath) return;

    const folders = getMaterialFolders(this.context);
    if (folders.includes(folderPath)) return;

    folders.push(folderPath);
    await setMaterialFolders(this.context, folders);
    this.refreshResourceRoots();
    this.pushAutoMaterials();
  }

  private async handleRemoveMaterialFolder(folderPath: string): Promise<void> {
    const folders = getMaterialFolders(this.context).filter((f: string) => f !== folderPath);
    await setMaterialFolders(this.context, folders);
    this.refreshResourceRoots();
    this.pushAutoMaterials();
  }

  // ========== 图片操作 ==========

  private async handleInsertImage(imagePath: string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.fileName !== this.activeMdPath) {
      vscode.window.showWarningMessage('Image Flow: 当前活动编辑器不是生效的 Markdown 文件，无法插入引用');
      return;
    }

    const mdDir = path.dirname(this.activeMdPath);
    let rel = posixRelative(mdDir, imagePath);

    if (rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) {
      vscode.window.showWarningMessage('Image Flow: 图片与 Markdown 文件不在同一驱动器，无法相对引用');
      return;
    }

    const baseName = path.basename(imagePath, path.extname(imagePath));

    if (needsAngleBrackets(rel)) {
      rel = `<${rel}>`;
    }

    const snippet = `![${baseName}](${rel})`;
    await editor.insertSnippet(new vscode.SnippetString(snippet));
  }

  private async handleOpenImage(imagePath: string): Promise<void> {
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(imagePath));
      await vscode.window.showTextDocument(doc);
    } catch {
      // 非文本文件，尝试用默认方式打开
      try {
        vscode.env.openExternal(vscode.Uri.file(imagePath));
      } catch { /* ignore */ }
    }
  }

  // ========== 暴露给外部（右键命令触发）==========

  /** 右键触发生成：目标 MD 成为生效 MD 并聚焦侧栏 */
  async generateFromUri(uri: vscode.Uri): Promise<void> {
    this.activeMdPath = uri.fsPath;
    this.activeMdName = path.basename(uri.fsPath);
    this.pushActiveMd();

    // 聚焦侧栏
    if (this.view) {
      this.view.show?.(true);
    }

    await this.handleGenerate();
  }

  /** 右键触发预览 */
  async previewFromUri(uri: vscode.Uri): Promise<void> {
    this.activeMdPath = uri.fsPath;
    this.activeMdName = path.basename(uri.fsPath);
    this.pushActiveMd();

    if (this.view) {
      this.view.show?.(true);
    }

    await this.handlePreview();
  }
}
