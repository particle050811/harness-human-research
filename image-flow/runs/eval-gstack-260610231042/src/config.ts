import * as vscode from 'vscode';
import { ImageFlowConfig } from './shared';
const DEFAULT_INJECTIONS: Record<string, string> = {
  'gpt-image-2': '整体画面弱化微小细节，避免过度刻画。',
  'gpt-image-2-vip': '整体画面弱化微小细节，避免过度刻画。',
};

/** 从 VS Code 配置读取所有配置项（不含 apiKey，apiKey 走 secrets） */
export function readConfig(): Omit<ImageFlowConfig, 'apiKey'> {
  const c = vscode.workspace.getConfiguration('image-flow');
  return {
    baseUrl: c.get<string>('baseUrl') ?? 'https://grsai.dakka.com.cn',
    model: c.get<string>('model') ?? 'nano-banana-2',
    aspectRatio: c.get<string>('aspectRatio') ?? '3:4',
    imageSize: c.get<string>('imageSize') ?? '1K',
    concurrency: c.get<number>('concurrency') ?? 1,
    workbenchCols: c.get<number>('workbenchCols') ?? 4,
    tasksCols: c.get<number>('tasksCols') ?? 2,
    modelInjections: c.get<Record<string, string>>('modelInjections') ?? {},
  };
}

/** 写入单个全局配置字段（合并语义，针对 modelInjections 执行深度合并） */
export async function writeConfigField(
  _context: vscode.ExtensionContext,
  key: string,
  value: unknown
): Promise<void> {
  const config = vscode.workspace.getConfiguration('image-flow');
  await config.update(key, value, vscode.ConfigurationTarget.Global);
}

/** 获取 apiKey */
export async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get('image-flow.apiKey')) ?? '';
}

/** 设置 apiKey */
export async function setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  await context.secrets.store('image-flow.apiKey', key);
}

/** 种子模型注入提示词：补写配置中尚不存在的模型 key，用户改过（含清空为空串）不覆盖 */
export async function seedModelInjections(_context: vscode.ExtensionContext): Promise<void> {
  const config = vscode.workspace.getConfiguration('image-flow');
  const current = config.get<Record<string, string>>('modelInjections') ?? {};
  let changed = false;
  for (const [model, injection] of Object.entries(DEFAULT_INJECTIONS)) {
    if (!(model in current)) {
      current[model] = injection;
      changed = true;
    }
  }
  if (changed) {
    await config.update('modelInjections', current, vscode.ConfigurationTarget.Global);
  }
}

/** 获取某个模型的注入句 */
export function getModelInjection(config: Omit<ImageFlowConfig, 'apiKey'>, model: string): string {
  return config.modelInjections[model] ?? '';
}

/** 获取素材库文件夹列表（workspaceState） */
export function getMaterialFolders(context: vscode.ExtensionContext): string[] {
  return context.workspaceState.get<string[]>('image-flow.materialFolders') ?? [];
}

/** 设置素材库文件夹列表 */
export async function setMaterialFolders(
  context: vscode.ExtensionContext,
  folders: string[]
): Promise<void> {
  await context.workspaceState.update('image-flow.materialFolders', folders);
}
