/** 扩展与 Webview 共享类型，两端共用避免漂移 */

// --- Webview 消息协议 ---

export interface InitMsg {
  type: 'init';
}

export interface ConfigMsg {
  type: 'config';
  config: ExtensionConfig;
}

export interface ActiveMdMsg {
  type: 'activeMd';
  filePath: string | null;
  fileName: string | null;
}

export interface TasksMsg {
  type: 'tasks';
  tasks: TaskInfo[];
  history: HistoryEntry[];
}

export interface MaterialsMsg {
  type: 'materials';
  auto: MaterialLibrary[];
  manual: MaterialLibrary[];
}

export interface StatusMsg {
  type: 'status';
  message: string;
  isError: boolean;
}

export interface ProgressMsg {
  type: 'progress';
  taskId: string;
  jobs: JobState[];
  images: string[];
  errors: string[];
  startedAt: number;
}

export type ExtToWebview =
  | InitMsg
  | ConfigMsg
  | ActiveMdMsg
  | TasksMsg
  | MaterialsMsg
  | StatusMsg
  | ProgressMsg;

export interface GenerateMsg {
  type: 'generate';
}

export interface PreviewMsg {
  type: 'preview';
}

export interface SaveConfigMsg {
  type: 'saveConfig';
  key: string;
  value: unknown;
}

export interface SetApiKeyMsg {
  type: 'setApiKey';
  value: string;
}

export interface AddMaterialDirMsg {
  type: 'addMaterialDir';
}

export interface RemoveMaterialDirMsg {
  type: 'removeMaterialDir';
  dir: string;
}

export interface InsertImageMsg {
  type: 'insertImage';
  imagePath: string;
}

export interface OpenImageMsg {
  type: 'openImage';
  imagePath: string;
}

export interface OpenUrlMsg {
  type: 'openUrl';
  url: string;
}

export type WebviewToExt =
  | GenerateMsg
  | PreviewMsg
  | SaveConfigMsg
  | SetApiKeyMsg
  | AddMaterialDirMsg
  | RemoveMaterialDirMsg
  | InsertImageMsg
  | OpenImageMsg
  | OpenUrlMsg;

// --- 配置 ---

export interface ExtensionConfig {
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

// --- 任务 ---

export type JobStatus = 'submitting' | 'running' | 'succeeded' | 'failed' | 'violation';

export interface JobState {
  index: number;
  id: string | null;
  status: JobStatus;
  progress: number;
  error: string | null;
  images: string[];
}

export interface TaskInfo {
  id: string;
  folderName: string;
  folderPath: string;
  mdFileName: string;
  model: string;
  jobs: JobState[];
  startedAt: number;
  sessionStart: number;
}

export interface HistoryEntry {
  folderName: string;
  folderPath: string;
  imageCount: number;
  images: string[];
}

// --- 素材库 ---

export interface MaterialLibrary {
  name: string;
  path: string;
  images: MaterialImage[];
}

export interface MaterialImage {
  path: string;
  name: string;
  webviewUri: string;
}

// --- 预设 ---

export const MODELS = ['nano-banana-2', 'nano-banana-pro', 'gpt-image-2', 'gpt-image-2-vip'] as const;

export const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;

export const BASE_URLS = [
  { label: '国内节点', value: 'https://grsai.dakka.com.cn' },
  { label: '全球节点', value: 'https://grsaiapi.com' },
] as const;

/** gpt-image-2-vip 像素换算表: ratio+size → WxH */
export const VIP_PIXEL_MAP: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024x1024', '2K': '2048x2048', '4K': '4096x4096' },
  '16:9': { '1K': '1344x768', '2K': '2688x1536', '4K': '5376x3072' },
  '9:16': { '1K': '768x1344', '2K': '1536x2688', '4K': '3072x5376' },
  '4:3': { '1K': '1152x864', '2K': '2304x1728', '4K': '4608x3456' },
  '3:4': { '1K': '864x1152', '2K': '1728x2304', '4K': '3456x4608' },
};

/** 图片扩展名白名单 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

/** 种子注入提示词 */
export const SEED_INJECTIONS: Record<string, string> = {
  'gpt-image-2': '整体画面弱化微小细节，避免过度刻画。',
  'gpt-image-2-vip': '整体画面弱化微小细节，避免过度刻画。',
};

/** 扩展名 → MIME 映射 */
export function extToMime(ext: string): string {
  const m: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return m[ext] || 'image/png';
}

/** 检查扩展名是否在图片白名单中 */
export function isImageExt(ext: string): boolean {
  const exts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
  return exts.includes(ext.toLowerCase());
}

/** 从 URL 中提取文件扩展名（浏览器兼容版本） */
export function extFromUrl(url: string): string {
  try {
    const u = new URL(url);
    // 取路径最后一段，去掉查询参数
    const parts = u.pathname.split('/');
    const last = parts[parts.length - 1] || '';
    const clean = last.split('?')[0];
    const dotIdx = clean.lastIndexOf('.');
    if (dotIdx >= 0) {
      return clean.slice(dotIdx + 1).toLowerCase();
    }
    return '';
  } catch {
    return '';
  }
}
