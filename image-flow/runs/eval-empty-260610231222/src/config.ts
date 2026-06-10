// 配置管理：apiKey 存 secrets，其余存 globalState；素材库列表存 workspaceState

import * as vscode from 'vscode';
import {
  AppConfig,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_ASPECT_RATIO,
  DEFAULT_IMAGE_SIZE,
  DEFAULT_CONCURRENCY,
  DEFAULT_WORKBENCH_COLS,
  DEFAULT_TASKS_COLS,
} from './shared';

const API_KEY_SECRET = 'image-flow.apiKey';

export async function getConfig(secrets: vscode.SecretStorage, globalState: vscode.Memento): Promise<AppConfig> {
  const apiKey = (await secrets.get(API_KEY_SECRET)) ?? '';
  const baseUrl = globalState.get<string>('baseUrl') ?? DEFAULT_BASE_URL;
  const model = globalState.get<string>('model') ?? DEFAULT_MODEL;
  const aspectRatio = globalState.get<string>('aspectRatio') ?? DEFAULT_ASPECT_RATIO;
  const imageSize = globalState.get<string>('imageSize') ?? DEFAULT_IMAGE_SIZE;
  const concurrency = globalState.get<number>('concurrency') ?? DEFAULT_CONCURRENCY;
  const workbenchCols = globalState.get<number>('workbenchCols') ?? DEFAULT_WORKBENCH_COLS;
  const tasksCols = globalState.get<number>('tasksCols') ?? DEFAULT_TASKS_COLS;
  const modelInjections = globalState.get<Record<string, string>>('modelInjections') ?? {};
  return { apiKey, baseUrl, model, aspectRatio, imageSize, concurrency, workbenchCols, tasksCols, modelInjections };
}

export async function setApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(API_KEY_SECRET, key);
}

export async function getApiKey(secrets: vscode.SecretStorage): Promise<string> {
  return (await secrets.get(API_KEY_SECRET)) ?? '';
}

export function setConfigValue(globalState: vscode.Memento, key: string, value: unknown): void {
  globalState.update(key, value);
}

/** 获取手动素材库列表 */
export function getMediaFolders(workspaceState: vscode.Memento): string[] {
  return workspaceState.get<string[]>('mediaFolders') ?? [];
}

export function addMediaFolder(workspaceState: vscode.Memento, folder: string): void {
  const folders = getMediaFolders(workspaceState);
  if (!folders.includes(folder)) {
    folders.push(folder);
    workspaceState.update('mediaFolders', folders);
  }
}

export function removeMediaFolder(workspaceState: vscode.Memento, folder: string): void {
  let folders = getMediaFolders(workspaceState);
  folders = folders.filter(f => f !== folder);
  workspaceState.update('mediaFolders', folders);
}

/** 模型注入种子：首次激活时只补不存在的键 */
export function seedModelInjections(globalState: vscode.Memento): void {
  const injections = globalState.get<Record<string, string>>('modelInjections') ?? {};
  const seeds: Record<string, string> = {
    'gpt-image-2': '整体画面弱化微小细节，避免过度刻画。',
    'gpt-image-2-vip': '整体画面弱化微小细节，避免过度刻画。',
  };
  let changed = false;
  for (const [model, injection] of Object.entries(seeds)) {
    if (!(model in injections)) {
      injections[model] = injection;
      changed = true;
    }
  }
  if (changed) {
    globalState.update('modelInjections', injections);
  }
}

/** 根据模型判断是否为 nano-banana 系列 */
export function isNanoBanana(model: string): boolean {
  return model.startsWith('nano-banana');
}

/** 根据模型判断是否为 gpt-image-2-vip */
export function isGptImage2Vip(model: string): boolean {
  return model === 'gpt-image-2-vip';
}
