// image-flow 共享类型与消息协议
// 前后端共用，避免接口漂移

// ============ 配置 ============

export interface ImageFlowConfig {
  apiKey: string;           // 存 secrets
  baseUrl: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  concurrency: number;
  workbenchCols: number;
  tasksCols: number;
  modelInjections: Record<string, string>;
}

export const DEFAULT_CONFIG: Omit<ImageFlowConfig, 'apiKey'> = {
  baseUrl: 'https://grsai.dakka.com.cn',
  model: 'nano-banana-2',
  aspectRatio: '3:4',
  imageSize: '1K',
  concurrency: 1,
  workbenchCols: 4,
  tasksCols: 2,
  modelInjections: {},
};

// ============ 任务相关 ============

export type JobStatus = 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';

export interface Job {
  /** 序号，任务内从 1 开始 */
  index: number;
  status: JobStatus;
  /** Grsai job id，submitting 时为空 */
  jobId: string;
  /** 远端进度 0-100，仅 running 时有效 */
  progress: number;
  /** 错误信息 */
  error: string;
  /** 已下载图片的本地路径 */
  downloadedImages: string[];
}

export interface Task {
  /** 任务文件夹名 task-<yyMMddHHmmSS>-<seq> */
  folder: string;
  /** Markdown 文件名（不含扩展名） */
  mdName: string;
  /** 任务文件夹绝对路径 */
  folderPath: string;
  /** 使用的模型 */
  model: string;
  /** 所有 job */
  jobs: Job[];
  /** 任务真实开始时间 (ISO 8601)，用于显示已进行时长 */
  startedAt: string;
  /** 任务是否已终结（全部 job 到达终态） */
  finished: boolean;
  /** 下一张下载图片的起始序号（job 内接续） */
  nextImageSeq: number;
}

// ============ 素材库 ============

export interface AssetFolder {
  /** 显示名称 */
  name: string;
  /** 绝对路径 */
  path: string;
  /** 是否自动生成的「当前路径」库 */
  auto: boolean;
  /** 已扫描的图片文件绝对路径列表 */
  images: string[];
}

// ============ Webview 消息协议 ============

export type FrontendMessage =
  | { type: 'init' }
  | { type: 'generate'; mdPath: string }
  | { type: 'previewRequest'; mdPath: string }
  | { type: 'getConfig' }
  | { type: 'setConfig'; key: string; value: unknown }
  | { type: 'setApiKey'; apiKey: string }
  | { type: 'addAssetFolder' }
  | { type: 'removeAssetFolder'; folderPath: string }
  | { type: 'insertAssetRef'; imagePath: string }
  | { type: 'openImage'; imagePath: string }
  | { type: 'setModelInjection'; model: string; injection: string }
  | { type: 'getTasks' }
  | { type: 'getHistory' }
  | { type: 'getAssetFolders' }
  | { type: 'switchTab'; tab: string };

export type BackendMessage =
  | { type: 'initResponse'; config: ImageFlowConfig; activeMdPath: string; tasks: Task[]; history: HistoryEntry[]; assetFolders: AssetFolder[] }
  | { type: 'configUpdated'; config: ImageFlowConfig }
  | { type: 'tasksUpdated'; tasks: Task[] }
  | { type: 'historyUpdated'; history: HistoryEntry[] }
  | { type: 'assetFoldersUpdated'; assetFolders: AssetFolder[] }
  | { type: 'activeMdChanged'; mdPath: string }
  | { type: 'statusMessage'; message: string; level: 'info' | 'error' | 'warning' }
  | { type: 'error'; message: string };

// ============ 历史记录 ============

export interface HistoryEntry {
  folder: string;
  folderPath: string;
  imageCount: number;
  images: string[]; // 绝对路径
}

// ============ 图片白名单 ============

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

export function isImageFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext);
}

export function getImageMime(ext: string): string {
  switch (ext.toLowerCase()) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    case 'bmp': return 'image/bmp';
    case 'svg': return 'image/svg+xml';
    default: return 'image/png';
  }
}

// ============ 像素换算表 (gpt-image-2-vip) ============

export const VIP_PIXEL_TABLE: Record<string, Record<string, string>> = {
  '1:1':  { '1K': '1024x1024',  '2K': '2048x2048',  '4K': '2880x2880' },
  '3:4':  { '1K': '864x1152',   '2K': '1728x2304',  '4K': '2304x3072' },
  '4:3':  { '1K': '1152x864',   '2K': '2304x1728',  '4K': '3072x2304' },
  '16:9': { '1K': '1344x768',   '2K': '2688x1536',  '4K': '3840x2160' },
  '9:16': { '1K': '768x1344',   '2K': '1536x2688',  '4K': '2160x3840' },
};
