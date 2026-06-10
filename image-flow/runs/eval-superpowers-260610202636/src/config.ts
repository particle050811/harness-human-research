// 配置管理：secrets / globalState / workspaceState
import * as vscode from 'vscode';
import { ImageFlowConfig, DEFAULT_CONFIG } from './shared';

const SECRET_KEY = 'image-flow.apiKey';
const CONFIG_KEY = 'image-flow.config';
const ASSET_FOLDERS_KEY = 'image-flow.assetFolders';

/** 从 secrets + globalState 读取完整配置 */
export async function loadConfig(context: vscode.ExtensionContext): Promise<ImageFlowConfig> {
  const apiKey = (await context.secrets.get(SECRET_KEY)) ?? '';
  const stored = context.globalState.get<Partial<ImageFlowConfig>>(CONFIG_KEY) ?? {};
  return { ...DEFAULT_CONFIG, ...stored, apiKey };
}

/** 保存配置（apiKey 进 secrets，其余进 globalState，patch 语义） */
export async function saveConfig(
  context: vscode.ExtensionContext,
  patch: Partial<ImageFlowConfig>,
): Promise<ImageFlowConfig> {
  const current = await loadConfig(context);

  if (patch.apiKey !== undefined) {
    await context.secrets.store(SECRET_KEY, patch.apiKey);
    delete patch.apiKey;
  }

  // 合并 patch
  const updated: Omit<ImageFlowConfig, 'apiKey'> = {
    ...current,
    ...patch,
    // modelInjections 特殊处理：合并而非覆盖
    modelInjections: {
      ...current.modelInjections,
      ...(patch.modelInjections ?? {}),
    },
  };
  // apiKey 不在 globalState 里存
  const { apiKey: _key, ...toStore } = updated as ImageFlowConfig;
  void _key; // 显式忽略
  await context.globalState.update(CONFIG_KEY, toStore);

  return { ...updated, apiKey: current.apiKey };
}

/** 仅保存 apiKey 到 secrets */
export async function saveApiKey(context: vscode.ExtensionContext, apiKey: string): Promise<void> {
  await context.secrets.store(SECRET_KEY, apiKey);
}

/** 获取素材库文件夹列表 */
export function getAssetFolders(context: vscode.ExtensionContext): string[] {
  return context.workspaceState.get<string[]>(ASSET_FOLDERS_KEY) ?? [];
}

/** 设置素材库文件夹列表 */
export async function setAssetFolders(context: vscode.ExtensionContext, folders: string[]): Promise<void> {
  await context.workspaceState.update(ASSET_FOLDERS_KEY, folders);
}
