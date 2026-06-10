/**
 * 侧栏 Webview Provider — 管理 webview 生命周期与前后端通信。
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { ExtensionMessage, WebviewMessage } from './shared';
import { getConfig, updateConfig, getApiKey, setApiKey } from './config';
import { getNonce } from './utils';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    const workspaceFolders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, ...workspaceFolders],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage((msg: WebviewMessage) => {
      this.handleMessage(msg);
    });
  }

  /** 刷新 localResourceRoots 以包含素材库与工作区目录 */
  updateLocalResourceRoots(): void {
    if (!this.view) return;
    const folders = vscode.workspace.workspaceFolders?.map(f => f.uri) ?? [];
    this.view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri, ...folders],
    };
  }

  /** 向 webview 发消息 */
  postMessage(msg: ExtensionMessage): void {
    this.view?.webview.postMessage(msg);
  }

  /** 初始化下发全部状态 */
  async sendInitState(): Promise<void> {
    if (!this.view) return;
    const config = getConfig(this.context);
    const apiKey = await getApiKey(this.context);
    this.postMessage({
      type: 'config',
      data: { ...config, hasApiKey: apiKey.length > 0 },
    });
    this.postMessage({ type: 'activeMd', path: this.currentMdPath ?? '' });
    this.postMessage({ type: 'tasks', data: [] });
    this.postMessage({ type: 'history', data: [] });
  }

  // ─── 生效 MD 跟踪 ─────────────────────────────────

  private currentMdPath: string | undefined;

  setActiveMd(mdPath: string): void {
    this.currentMdPath = mdPath;
    this.postMessage({ type: 'activeMd', path: mdPath });
  }

  getActiveMd(): string | undefined {
    return this.currentMdPath;
  }

  // ─── 消息分发 ──────────────────────────────────────

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'init':
        await this.sendInitState();
        break;

      case 'updateConfig':
        await updateConfig(this.context, msg.data);
        // 回传更新后的完整配置
        {
          const cfg = getConfig(this.context);
          const apiKey = await getApiKey(this.context);
          this.postMessage({ type: 'config', data: { ...cfg, hasApiKey: apiKey.length > 0 } });
        }
        break;

      case 'setApiKey':
        await setApiKey(this.context, msg.value);
        {
          const cfg = getConfig(this.context);
          this.postMessage({ type: 'config', data: { ...cfg, hasApiKey: msg.value.length > 0 } });
        }
        break;

      case 'generate':
        vscode.commands.executeCommand('image-flow.generateImage');
        break;

      case 'previewRequest':
        vscode.commands.executeCommand('image-flow.previewRequest');
        break;

      case 'openFile':
        try {
          const uri = vscode.Uri.file(msg.path);
          await vscode.commands.executeCommand('vscode.open', uri);
        } catch { /* ignore */ }
        break;

      case 'openExternal':
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;

      case 'insertReference':
        // 仅当当前活动编辑器正是生效 MD 时才插入
        {
          const editor = vscode.window.activeTextEditor;
          if (!editor || !this.currentMdPath) {
            vscode.window.showWarningMessage('当前没有打开的 Markdown 文件');
            return;
          }
          if (editor.document.uri.fsPath !== this.currentMdPath) {
            vscode.window.showWarningMessage('活动编辑器与生效 MD 不一致，放弃插入');
            return;
          }
          const caret = editor.selection.active;
          const rel = this.makeRelativeRef(msg.path, path.dirname(this.currentMdPath));
          if (rel) {
            await editor.edit(eb => eb.insert(caret, rel));
          }
        }
        break;

      case 'pickMaterialFolder':
        {
          const folders = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
          });
          if (folders && folders.length > 0) {
            this.postMessage({ type: 'allMaterialDirs', dirs: [folders[0].fsPath] });
          }
        }
        break;

      case 'removeMaterialFolder':
        // M4 实现
        break;
    }
  }

  // ─── 辅助 ──────────────────────────────────────────

  private makeRelativeRef(absPath: string, mdDir: string): string | null {
    const p = path.relative(mdDir, absPath).replace(/\\/g, '/');
    const name = path.basename(absPath, path.extname(absPath));
    const prefix = p.startsWith('..') ? '' : './';
    const refPath = p.includes(' ') || p.includes('(') || p.includes(')')
      ? `<${p}>` : p;
    return `![${name}](${prefix}${refPath})`;
  }

  // ─── HTML 生成 ─────────────────────────────────────

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css'),
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
    img-src ${webview.cspSource} https: data:;
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styleUri}">
  <title>AI 绘图</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

