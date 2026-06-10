/**
 * image-flow 扩展主入口
 * 激活时种入模型注入种子，注册侧栏与命令，跟踪生效 MD。
 */

import * as vscode from 'vscode';
import { seedModelInjections } from './config';
import { generateImages } from './generate';
import { previewRequest } from './preview';
import { SidebarProvider } from './sidebar-provider';

export function activate(context: vscode.ExtensionContext): void {
  // 1. 种入模型注入句（必须在注册侧栏前完成）
  seedModelInjections(context);

  // 2. 侧栏 Provider
  const sidebar = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('image-flow.sidebar', sidebar, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // 3. 注册命令

  // 生成图片
  const genCmd = vscode.commands.registerCommand(
    'image-flow.generateImage',
    async (arg?: vscode.Uri) => {
      const mdPath = resolveMdPath(arg, sidebar);
      if (!mdPath) {
        vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
        return;
      }
      try {
        await generateImages(context, mdPath, sidebar);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(msg);
        sidebar.postMessage({ type: 'statusMessage', text: msg, isError: true });
      }
    },
  );
  context.subscriptions.push(genCmd);

  // 预览请求
  const previewCmd = vscode.commands.registerCommand(
    'image-flow.previewRequest',
    async (arg?: vscode.Uri) => {
      const mdPath = resolveMdPath(arg, sidebar);
      if (!mdPath) {
        vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
        return;
      }
      try {
        await previewRequest(context, mdPath);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(String(err));
      }
    },
  );
  context.subscriptions.push(previewCmd);

  // 4. 生效 MD 跟踪 —— 跟随活动编辑器
  function trackActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (editor && editor.document.uri.fsPath.endsWith('.md')) {
      sidebar.setActiveMd(editor.document.uri.fsPath);
    }
    // 非 MD 不清空，保留上一个
  }

  // 初始
  if (vscode.window.activeTextEditor) {
    trackActiveEditor(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(trackActiveEditor),
  );

  // 侧栏创建后回发初始状态（webview 就绪后触发 init）
  // PS: sendInitState 由 webview 的 init 消息触发，这里不需要额外调用
}

/** 解析命令触发的目标 MD 路径 */
function resolveMdPath(
  arg: vscode.Uri | undefined,
  sidebar: SidebarProvider,
): string | undefined {
  // 右键菜单通过 URI 参数传入
  if (arg && arg.fsPath.endsWith('.md')) {
    sidebar.setActiveMd(arg.fsPath);
    // 聚焦侧栏
    vscode.commands.executeCommand('image-flow.sidebar.focus');
    return arg.fsPath;
  }

  // 无参 → 使用侧栏跟踪的生效 MD
  const active = sidebar.getActiveMd();
  if (active) return active;

  // 兜底：当前活动编辑器
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.fsPath.endsWith('.md')) {
    return editor.document.uri.fsPath;
  }

  return undefined;
}

export function deactivate(): void {
  // 清理由 subscriptions 自动处理
}
