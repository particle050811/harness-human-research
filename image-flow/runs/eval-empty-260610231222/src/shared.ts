// 共享类型 — 与 media/sidebar.tsx 和 src/extension.ts 共用

// --- 图片工具 ---

/** 图片扩展名白名单 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] as const;

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext.toLowerCase() as typeof IMAGE_EXTENSIONS[number]);
}

export function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
    return ext;
  } catch {
    return '';
  }
}

export function mimeFromExt(ext: string): string {
  const m: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return m[ext.toLowerCase()] ?? 'image/png';
}

// --- 配置 ---

export interface AppConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
  concurrency: number;
  workbenchCols: number;
  tasksCols: number;
  modelInjections: Record<string, string>;
}

export const DEFAULT_BASE_URL = 'https://grsai.dakka.com.cn';
export const DEFAULT_MODEL = 'nano-banana-2';
export const DEFAULT_ASPECT_RATIO = '3:4';
export const DEFAULT_IMAGE_SIZE = '1K';
export const DEFAULT_CONCURRENCY = 1;
export const DEFAULT_WORKBENCH_COLS = 4;
export const DEFAULT_TASKS_COLS = 2;

export const BASE_URL_OPTIONS: Record<string, string> = {
  '国内节点': 'https://grsai.dakka.com.cn',
  '全球节点': 'https://grsaiapi.com',
};

export const MODEL_OPTIONS = ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2', 'gpt-image-2-vip'] as const;
export const ASPECT_RATIO_OPTIONS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;
export const IMAGE_SIZE_OPTIONS = ['1K', '2K', '4K'] as const;

// --- 消息协议 ---

export type WvToExt =
  | { type: 'init' }
  | { type: 'generate'; filePath: string }
  | { type: 'previewRequest'; filePath: string }
  | { type: 'updateConfig'; key: string; value: unknown }
  | { type: 'addMediaFolder' }
  | { type: 'removeMediaFolder'; path: string }
  | { type: 'insertImageRef'; imagePath: string }
  | { type: 'openImage'; imagePath: string }
  | { type: 'openUrl'; url: string };

export type ActiveMdInfo = {
  filePath: string;
  fileName: string;
};

export type TaskJob = {
  index: number;
  status: 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';
  id?: string;
  progress: number;
  error?: string;
  results?: string[];
};

export type TaskInfo = {
  folderName: string;
  folderPath: string;
  model: string;
  mdFileName: string;
  mdFilePath: string;
  jobs: TaskJob[];
  submittedAt: number;
  startedAt: number;
};

export type HistoryItem = {
  folderName: string;
  folderPath: string;
  images: string[];
  imageCount: number;
};

export type MediaFolder = {
  name: string;
  path: string;
  images: string[];
};

export type ExtToWv =
  | { type: 'initResponse'; config: AppConfig; activeMd: ActiveMdInfo | null; tasks: TaskInfo[]; history: HistoryItem[]; mediaFolders: MediaFolder[]; autoMediaFolders: MediaFolder[] }
  | { type: 'configUpdate'; key: string; value: unknown }
  | { type: 'taskUpdate'; tasks: TaskInfo[] }
  | { type: 'taskCompleted'; taskInfo: TaskInfo }
  | { type: 'historyUpdate'; history: HistoryItem[] }
  | { type: 'mediaFoldersUpdate'; folders: MediaFolder[] }
  | { type: 'autoMediaFoldersUpdate'; folders: MediaFolder[] }
  | { type: 'activeMdChanged'; activeMd: ActiveMdInfo | null }
  | { type: 'statusMessage'; message: string; isError: boolean }
  | { type: 'switchTab'; tab: string };

// --- API 响应 ---

export interface GenerateResponse {
  id?: string;
  status?: string;
  results?: { url: string }[];
  progress?: number;
  error?: string;
}

export interface ResultResponse {
  id?: string;
  status?: string;
  results?: { url: string }[];
  progress?: number;
  error?: string;
}

// --- 工具函数 ---

/** 生成任务文件夹名：task-yyMMddHHmmSS-seq */
let _seqCounter = 0;
let _lastTimePrefix = '';
export function taskFolderName(): string {
  const now = new Date();
  const y = String(now.getFullYear()).slice(-2);
  const M = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  const prefix = `task-${y}${M}${d}${h}${m}${s}`;
  if (prefix !== _lastTimePrefix) {
    _lastTimePrefix = prefix;
    _seqCounter = 1;
  } else {
    _seqCounter++;
  }
  return `${prefix}-${_seqCounter}`;
}

/** gpt-image-2-vip 像素换算表 */
export function vipPixelSize(aspectRatio: string, imageSize: string): string {
  const table: Record<string, Record<string, string>> = {
    '1:1':  { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
    '16:9': { '1K': '1792x1024', '2K': '3584x2048', '4K': '7168x4032' },
    '9:16': { '1K': '1024x1792', '2K': '2048x3584', '4K': '4032x7168' },
    '4:3':  { '1K': '1152x864',  '2K': '2304x1728', '4K': '4608x3456' },
    '3:4':  { '1K': '864x1152',  '2K': '1728x2304', '4K': '3456x4608' },
  };
  return table[aspectRatio]?.[imageSize] ?? '864x1152';
}

/** 判断是否为瞬时错误（可重试） */
export function isTransientError(err: unknown): boolean {
  const msg = String(err);
  if (msg.includes('fetch failed') || msg.includes('abort') || msg.includes('AbortError') || msg.includes('timeout')) {
    return true;
  }
  // HTTP 5xx / 429
  const m = msg.match(/HTTP\s*(\d+)/i);
  if (m) {
    const code = parseInt(m[1], 10);
    return code >= 500 || code === 429;
  }
  return false;
}

/** 聚合进度：每个 job 占 1/N */
export function aggregateProgress(jobs: TaskJob[]): number {
  if (jobs.length === 0) return 0;
  let total = 0;
  for (const j of jobs) {
    switch (j.status) {
      case 'succeeded': total += 100; break;
      case 'failed':
      case 'violation': total += 100; break; // 已终结，视作完成
      case 'running': total += j.progress; break;
      case 'submitting': total += 0; break;
    }
  }
  return Math.round(total / jobs.length);
}

/** 格式化已进行时长 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** 扫描目录获取历史任务 */
export function isTaskFolder(name: string): boolean {
  return /^task-\d{12}-\d+$/.test(name);
}
