/**
 * 配置管理 — apiKey 存 secrets，其余存 globalState，写入时按字段合并。
 */

import * as vscode from 'vscode';
import type { ExtensionConfig, ConfigUpdate } from './shared';

const KEY = 'image-flow.config';

const DEFAULTS: Omit<ExtensionConfig, 'hasApiKey'> = {
  baseUrl: 'https://grsai.dakka.com.cn',
  model: 'nano-banana-2',
  aspectRatio: '3:4',
  imageSize: '1K',
  concurrency: 1,
  workbenchCols: 4,
  tasksCols: 2,
  modelInjections: {},
};

/** 模型注入提示词种子 */
const INJECTION_SEEDS: Record<string, string> = {
  'gpt-image-2': '整体画面弱化微小细节，避免过度刻画。',
  'gpt-image-2-vip': '整体画面弱化微小细节，避免过度刻画。',
};

/**
 * 首次激活时种入默认注入句 —— 只补配置中尚不存在的模型键。
 * 用户已改过（包括改为空串）的键不会被覆盖。
 */
export function seedModelInjections(context: vscode.ExtensionContext): void {
  const raw = context.globalState.get<Record<string, string>>(KEY + '.injections', {});
  let changed = false;
  for (const [model, injection] of Object.entries(INJECTION_SEEDS)) {
    if (!(model in raw)) {
      raw[model] = injection;
      changed = true;
    }
  }
  if (changed) {
    context.globalState.update(KEY + '.injections', raw);
  }
  // 同时写入全局配置快照（如果不存在）
  const cfg = context.globalState.get<Record<string, unknown>>(KEY);
  if (!cfg || cfg.modelInjections === undefined) {
    const merged = { ...DEFAULTS, ...(cfg ?? {}), modelInjections: raw };
    context.globalState.update(KEY, merged);
  }
}

/** 读取完整配置（合并 globalState 覆盖值） */
export function getConfig(context: vscode.ExtensionContext): ExtensionConfig {
  const ws = vscode.workspace.getConfiguration('image-flow');
  const stored = context.globalState.get<Record<string, unknown>>(KEY, {});
  return {
    baseUrl: String(stored.baseUrl ?? ws.get<string>('baseUrl', DEFAULTS.baseUrl)),
    model: String(stored.model ?? ws.get<string>('model', DEFAULTS.model)),
    aspectRatio: String(stored.aspectRatio ?? ws.get<string>('aspectRatio', DEFAULTS.aspectRatio)),
    imageSize: String(stored.imageSize ?? ws.get<string>('imageSize', DEFAULTS.imageSize)),
    concurrency: Number(stored.concurrency ?? ws.get<number>('concurrency', DEFAULTS.concurrency)),
    workbenchCols: Number(stored.workbenchCols ?? ws.get<number>('workbenchCols', DEFAULTS.workbenchCols)),
    tasksCols: Number(stored.tasksCols ?? ws.get<number>('tasksCols', DEFAULTS.tasksCols)),
    modelInjections: (stored.modelInjections as Record<string, string>) ?? {},
    hasApiKey: false, // 由 secrets 侧填充
  };
}

/** 合并写入 globalState */
export async function updateConfig(
  context: vscode.ExtensionContext,
  patch: ConfigUpdate,
): Promise<void> {
  const current = context.globalState.get<Record<string, unknown>>(KEY, {});
  const merged = { ...current, ...patch };
  // handle modelInjections separately if provided
  if (patch.modelInjections) {
    await context.globalState.update(KEY + '.injections', patch.modelInjections);
    merged.modelInjections = patch.modelInjections;
  }
  await context.globalState.update(KEY, merged);
}

/** apiKey 存 secrets */
export async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get('image-flow.apiKey')) ?? '';
}

/** 写入 apiKey 到 secrets */
export async function setApiKey(context: vscode.ExtensionContext, key: string): Promise<void> {
  await context.secrets.store('image-flow.apiKey', key);
}

/** 模型的注入句，无则空串 */
export function getModelInjection(config: ExtensionConfig, model: string): string {
  return config.modelInjections[model] ?? '';
}
