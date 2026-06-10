import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar';
import { TaskManager } from './tasks';
import { seedModelInjections } from './config';

export function activate(context: vscode.ExtensionContext): void {
  // 1. 先种入模型注入提示词种子（不覆盖用户修改过的）
  awaitSeedModelInjections(context);

  // 2. 创建任务管理器并恢复未完成任务
  const taskManager = new TaskManager(context);
  taskManager.resume();

  // 3. 注册侧栏
  const sidebarProvider = new SidebarProvider(context, taskManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('image-flow.sidebar', sidebarProvider)
  );

  // 4. 注册命令：生成图片
  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.generateImage', async (uri?: vscode.Uri) => {
      if (!uri) {
        // 从活动编辑器获取
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
          vscode.window.showWarningMessage('Image Flow: 请先打开一个 Markdown 文件');
          return;
        }
        uri = editor.document.uri;
      }
      await sidebarProvider.generateFromUri(uri);
    })
  );

  // 5. 注册命令：预览请求
  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.previewRequest', async (uri?: vscode.Uri) => {
      if (!uri) {
        const editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.md')) {
          vscode.window.showWarningMessage('Image Flow: 请先打开一个 Markdown 文件');
          return;
        }
        uri = editor.document.uri;
      }
      await sidebarProvider.previewFromUri(uri);
    })
  );
}

function awaitSeedModelInjections(context: vscode.ExtensionContext): void {
  // 在激活时立即执行种子写入（异步但不阻塞激活流程）
  seedModelInjections(context).catch(() => {
    // 静默失败
  });
}

export function deactivate(): void {
  // 清理工作由 context.subscriptions 自动处理
}
