// image-flow VS Code 扩展入口
import * as vscode from 'vscode';
import { SidebarProvider } from './sidebar-provider';
import { TaskManager } from './task-manager';
import { loadConfig, saveConfig } from './config';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // M6: 首次激活种入模型注入提示词
  await seedModelInjections(context);

  // 初始化任务管理器
  const taskManager = new TaskManager(context);
  context.subscriptions.push(taskManager);

  // 初始化侧栏提供者
  const sidebarProvider = new SidebarProvider(context, taskManager);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider),
  );

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.generateImage', async (uri?: vscode.Uri) => {
      const mdPath = await resolveMdPath(uri);
      if (!mdPath) { return; }
      sidebarProvider.setActiveMd(mdPath);
      sidebarProvider.setPendingGenerateMd(mdPath);
      // 聚焦侧栏并触发生成
      await vscode.commands.executeCommand('image-flow.sidebar.focus');
      // 通过 setActiveMd 后，发送生成请求
      sidebarProvider.doGenerate(mdPath);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.previewRequest', async (uri?: vscode.Uri) => {
      const mdPath = await resolveMdPath(uri);
      if (!mdPath) { return; }
      sidebarProvider.setActiveMd(mdPath);
      sidebarProvider.doPreview(mdPath);
    }),
  );

  // 监听活动编辑器，跟随生效 MD
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document && editor.document.uri.fsPath.endsWith('.md')) {
        sidebarProvider.setActiveMd(editor.document.uri.fsPath);
      }
      // 非 MD 不清空，保留上一个生效 MD
    }),
  );

  // 初始设定生效 MD
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor?.document?.uri.fsPath.endsWith('.md')) {
    sidebarProvider.setActiveMd(activeEditor.document.uri.fsPath);
  }

  // 重启续拉未完成任务
  await taskManager.resume();
}

export function deactivate(): void {
  // 资源由 context.subscriptions 自动释放
}

/** 从命令参数或活动编辑器解析 MD 路径 */
async function resolveMdPath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri?.fsPath) {
    return uri.fsPath;
  }
  const editor = vscode.window.activeTextEditor;
  if (editor?.document?.uri.fsPath.endsWith('.md')) {
    return editor.document.uri.fsPath;
  }
  vscode.window.showWarningMessage('请先打开一个 Markdown 文件');
  return undefined;
}

/** M6: 首次激活时种入模型注入提示词种子 */
async function seedModelInjections(context: vscode.ExtensionContext): Promise<void> {
  const config = await loadConfig(context);
  const injections = { ...config.modelInjections };

  const seeds: Record<string, string> = {
    'gpt-image-2': '整体画面弱化微小细节，避免过度刻画。',
    'gpt-image-2-vip': '整体画面弱化微小细节，避免过度刻画。',
  };

  let changed = false;
  for (const [model, seed] of Object.entries(seeds)) {
    // 只补配置中尚不存在的模型键
    if (!(model in injections)) {
      injections[model] = seed;
      changed = true;
    }
  }

  if (changed) {
    await saveConfig(context, { modelInjections: injections });
  }
}
