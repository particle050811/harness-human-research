/**
 * 共享类型 — webview 与扩展主进程双向通信协议
 * 两端引用同一模块，避免消息格式漂移。
 */

// ─── 配置 ────────────────────────────────────────────

export interface ExtensionConfig {
  baseUrl: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  concurrency: number;
  workbenchCols: number;
  tasksCols: number;
  modelInjections: Record<string, string>;
  hasApiKey: boolean;
}

export interface ConfigUpdate {
  baseUrl?: string;
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  concurrency?: number;
  workbenchCols?: number;
  tasksCols?: number;
  modelInjections?: Record<string, string>;
}

// ─── 任务/历史 ────────────────────────────────────────

export interface JobInfo {
  id: string | null;
  status: 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';
  progress: number;
  error?: string;
  imagePaths: string[];
  imageUris: string[];
}

export interface TaskInfo {
  folderName: string;
  taskId: string;
  model: string;
  mdPath: string;
  jobs: JobInfo[];
  startTime: number;
  status: 'active' | 'done';
}

export interface HistoryInfo {
  folderName: string;
  imageCount: number;
  imagePaths: string[];
  imageUris: string[];
  timestamp: number;
}

// ─── 扩展 → Webview ──────────────────────────────────

export type ExtensionMessage =
  | { type: 'config'; data: ExtensionConfig }
  | { type: 'activeMd'; path: string }
  | { type: 'statusMessage'; text: string; isError: boolean }
  | { type: 'tasks'; data: TaskInfo[] }
  | { type: 'history'; data: HistoryInfo[] }
  | { type: 'taskUpdate'; data: TaskInfo }
  | { type: 'taskDone'; taskId: string; images: string[]; errors: string[] }
  | { type: 'allMaterialDirs'; dirs: string[] };

// ─── Webview → 扩展 ──────────────────────────────────

export type WebviewMessage =
  | { type: 'init' }
  | { type: 'updateConfig'; data: ConfigUpdate }
  | { type: 'setApiKey'; value: string }
  | { type: 'generate' }
  | { type: 'previewRequest' }
  | { type: 'openFile'; path: string }
  | { type: 'openExternal'; url: string }
  | { type: 'insertReference'; path: string }
  | { type: 'pickMaterialFolder' }
  | { type: 'removeMaterialFolder'; path: string };
