// image-flow 共享类型与消息协议
// 主进程与 webview 共用，不得引入 vscode 模块

// ========== 配置 ==========

export interface ImageFlowConfig {
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

// ========== 任务状态 ==========

export type JobStatus = 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';

export interface JobState {
  id: string;           // job id（submitting 态为空）
  status: JobStatus;
  progress: number;     // 0-100
  error?: string;
  downloadedImages: string[];  // 本地图片相对路径
}

export interface TaskState {
  folderName: string;       // 任务文件夹名
  model: string;
  mdPath: string;           // 触发任务的 MD 绝对路径
  jobs: JobState[];         // N 个并发 job
  startedAt: number;        // 真实提交时间（epoch ms）
  resumeStartedAt: number;  // 本次会话开始时间（epoch ms），用于超时判定
  doneImages: number;       // 总计已下载图片数
}

// ========== 历史记录（扫描结果）==========

export interface HistoryFolder {
  folderName: string;
  path: string;         // 绝对路径
  images: string[];     // 文件夹内图片文件名列表
}

// ========== 素材库 ==========

export interface MaterialFolder {
  name: string;
  path: string;
  images: string[];     // 文件名列表（素材库扫描到的是绝对路径）
}

// ========== Webview 消息协议 ==========

export type WebviewCommand =
  | { type: 'init' }
  | { type: 'generate' }
  | { type: 'preview' }
  | { type: 'setApiKey'; value: string }
  | { type: 'setConfig'; key: string; value: unknown }
  | { type: 'setModelInjection'; model: string; injection: string }
  | { type: 'addMaterialFolder' }
  | { type: 'removeMaterialFolder'; path: string }
  | { type: 'insertImage'; imagePath: string }
  | { type: 'openImage'; imagePath: string }
  | { type: 'openUrl'; url: string };

export interface InitPayload {
  config: Omit<ImageFlowConfig, 'apiKey'> & { apiKey: boolean };
  activeMdPath: string;
  activeMdName: string;
  tasks: TaskState[];
  history: HistoryFolder[];
  materials: MaterialFolder[];
  autoMaterials: MaterialFolder[];
}

export type ExtensionEvent =
  | { type: 'init'; payload: InitPayload }
  | { type: 'configUpdate'; key: string; value: unknown }
  | { type: 'taskUpdate'; tasks: TaskState[]; history: HistoryFolder[] }
  | { type: 'materialUpdate'; materials: MaterialFolder[]; autoMaterials: MaterialFolder[] }
  | { type: 'activeMdUpdate'; path: string; name: string }
  | { type: 'statusMessage'; text: string; isError: boolean };

// ========== 图片白名单 ==========

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

export const IMAGE_EXT_SET = new Set(IMAGE_EXTENSIONS);

export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXT_SET.has(ext);
}

export function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
    if (IMAGE_EXT_SET.has(ext)) return ext;
  } catch {
    // ignore
  }
  return 'png';
}

export function mimeFromExt(ext: string): string {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return map[ext.toLowerCase()] ?? 'image/png';
}

// ========== 模型系列判定 ==========

export function isNanoBanana(model: string): boolean {
  return model.startsWith('nano-banana');
}

export function isGptImage2(model: string): boolean {
  return model === 'gpt-image-2';
}

export function isGptImage2Vip(model: string): boolean {
  return model === 'gpt-image-2-vip';
}

// ========== gpt-image-2-vip 像素换算 ==========

const SIZE_TARGET: Record<string, number> = {
  '1K': 1_000_000,
  '2K': 4_000_000,
  '4K': 16_000_000,
};

export function calcVipPixels(ratio: string, imageSize: string): string {
  const [rw, rh] = ratio.split(':').map(Number);
  const target = SIZE_TARGET[imageSize] ?? 1_000_000;

  let h = Math.round(Math.sqrt((target * rh) / rw));
  let w = Math.round((rw / rh) * h);

  // 对齐到 16 的倍数
  w = Math.round(w / 16) * 16 || 16;
  h = Math.round(h / 16) * 16 || 16;

  // 最大边长不超过 3840
  const MAX = 3840;
  if (w > MAX) {
    w = MAX - (MAX % 16);
    h = Math.round((w * rh) / rw / 16) * 16 || 16;
  }
  if (h > MAX) {
    h = MAX - (MAX % 16);
    w = Math.round((h * rw) / rh / 16) * 16 || 16;
  }

  return `${w}x${h}`;
}

// ========== 状态枚举值 ==========

export const VALID_STATUSES = new Set(['running', 'succeeded', 'failed', 'violation']);

// ========== 纯工具函数（前后端共用）==========

/** 格式化时长 mm:ss 或 h:mm:ss */
export function formatDuration(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 聚合进度：每个 job 占 1/N，succeeded 记 1，running 按 progress/100，其余记 0 */
export function calcProgress(jobs: Array<{ status: string; progress: number }>): number {
  if (jobs.length === 0) return 0;
  let total = 0;
  for (const j of jobs) {
    if (j.status === 'succeeded') total += 1;
    else if (j.status === 'running') total += j.progress / 100;
    // submitting / failed → 0
  }
  return Math.round((total / jobs.length) * 100);
}
