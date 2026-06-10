import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from './config';
import { TaskManager } from './taskManager';
import { SidebarProvider } from './sidebar';
import { showPreview } from './preview';

let sidebarProvider: SidebarProvider;
let taskManager: TaskManager;
let configManager: ConfigManager;

export async function activate(context: vscode.ExtensionContext) {
  configManager = new ConfigManager(context);

  // 首次激活：先种入种子再注册侧栏（保证侧栏首次读配置时默认句已可见）
  await configManager.seedInjections();

  taskManager = new TaskManager(configManager, () => {
    sidebarProvider?.pushProgress();
  });

  sidebarProvider = new SidebarProvider(context.extensionUri, configManager, taskManager);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('image-flow.sidebar', sidebarProvider),
  );

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand('image-flow.generateImage', handleGenerate),
    vscode.commands.registerCommand('image-flow.previewRequest', handlePreview),
  );

  // 活动编辑器跟随
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        sidebarProvider.setLastActiveMd(editor.document);
        sidebarProvider.pushState();
      }
    }),
  );

  // 重启续拉未完成任务
  await taskManager.resume();
  sidebarProvider.pushState();
}

async function handleGenerate(uri?: vscode.Uri) {
  const mdUri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!mdUri || path.extname(mdUri.fsPath) !== '.md') {
    vscode.window.showErrorMessage('仅支持 Markdown 文件');
    return;
  }

  const doc = await vscode.workspace.openTextDocument(mdUri);
  sidebarProvider.setLastActiveMd(doc);

  await vscode.commands.executeCommand('image-flow.sidebar.focus');

  const config = await configManager.getConfig();

  await taskManager.submit(
    mdUri.fsPath,
    config.model,
    config.aspectRatio,
    config.imageSize,
    config.concurrency,
  );
}

async function handlePreview(uri?: vscode.Uri) {
  const mdUri = uri || vscode.window.activeTextEditor?.document.uri;
  if (!mdUri || path.extname(mdUri.fsPath) !== '.md') {
    vscode.window.showErrorMessage('仅支持 Markdown 文件');
    return;
  }

  const doc = await vscode.workspace.openTextDocument(mdUri);
  sidebarProvider.setLastActiveMd(doc);

  await showPreview(mdUri.fsPath, configManager);
}

export function deactivate() {
  taskManager?.dispose();
}
