import * as vscode from 'vscode';
import { SEED_INJECTIONS, type ExtensionConfig } from './shared';

/** 配置管理：apiKey → secrets，其余 → globalState，素材库 → workspaceState */
export class ConfigManager {
  private secrets: vscode.SecretStorage;
  private globalState: vscode.Memento;
  private workspaceState: vscode.Memento;

  constructor(context: vscode.ExtensionContext) {
    this.secrets = context.secrets;
    this.globalState = context.globalState;
    this.workspaceState = context.workspaceState;
  }

  /** 首次激活种入 modelInjections 种子（不覆盖已有键） */
  async seedInjections(): Promise<void> {
    const stored = this.globalState.get<Record<string, string>>('modelInjections') || {};
    let changed = false;
    for (const [model, injection] of Object.entries(SEED_INJECTIONS)) {
      if (!(model in stored)) {
        stored[model] = injection;
        changed = true;
      }
    }
    if (changed) {
      await this.globalState.update('modelInjections', stored);
    }
  }

  async getApiKey(): Promise<string> {
    return (await this.secrets.get('apiKey')) || '';
  }

  async setApiKey(value: string): Promise<void> {
    await this.secrets.store('apiKey', value);
  }

  get<T>(key: string, defaultValue: T): T {
    return this.globalState.get<T>(key) ?? defaultValue;
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.globalState.update(key, value);
  }

  async getConfig(): Promise<ExtensionConfig> {
    const cfg = vscode.workspace.getConfiguration('imageFlow');
    return {
      apiKey: await this.getApiKey(),
      baseUrl: this.get<string>('baseUrl', cfg.get<string>('baseUrl') || 'https://grsai.dakka.com.cn'),
      model: this.get<string>('model', cfg.get<string>('model') || 'nano-banana-2'),
      aspectRatio: this.get<string>('aspectRatio', cfg.get<string>('aspectRatio') || '3:4'),
      imageSize: this.get<string>('imageSize', cfg.get<string>('imageSize') || '1K'),
      concurrency: this.get<number>('concurrency', cfg.get<number>('concurrency') || 1),
      workbenchCols: this.get<number>('workbenchCols', cfg.get<number>('workbenchCols') || 4),
      tasksCols: this.get<number>('tasksCols', cfg.get<number>('tasksCols') || 2),
      modelInjections: this.get<Record<string, string>>('modelInjections', cfg.get<Record<string, string>>('modelInjections') || {}),
    };
  }

  /** 获取素材库列表 */
  getMaterialDirs(): string[] {
    return this.workspaceState.get<string[]>('materialDirs') || [];
  }

  async addMaterialDir(dir: string): Promise<void> {
    const dirs = this.getMaterialDirs();
    if (!dirs.includes(dir)) {
      dirs.push(dir);
      await this.workspaceState.update('materialDirs', dirs);
    }
  }

  async removeMaterialDir(dir: string): Promise<void> {
    let dirs = this.getMaterialDirs();
    dirs = dirs.filter((d) => d !== dir);
    await this.workspaceState.update('materialDirs', dirs);
  }
}
