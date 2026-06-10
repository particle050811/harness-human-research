// 通用工具函数
import * as path from 'path';

/** 图片扩展名白名单 */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

/** 判断文件是否为图片文件 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/** 根据扩展名推断 MIME 类型 */
export function getMimeType(ext: string): string {
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
  };
  return mimeMap[ext.toLowerCase()] ?? 'image/png';
}

/** 从 URL 提取文件扩展名，校验白名单，否则回退 png */
export function getExtFromUrl(url: string): string {
  try {
    const urlPath = new URL(url).pathname;
    const ext = path.extname(urlPath).slice(1).toLowerCase();
    if (IMAGE_EXTENSIONS.includes(ext)) {
      return ext;
    }
  } catch {
    // URL 解析失败，尝试简单提取
    const match = url.match(/\.(\w+)(?:\?|$)/);
    if (match && IMAGE_EXTENSIONS.includes(match[1].toLowerCase())) {
      return match[1].toLowerCase();
    }
  }
  return 'png';
}

/** 时间戳格式化: yyMMddHHmmSS */
export function formatTimestamp(date: Date = new Date()): string {
  const y = date.getFullYear().toString().slice(2);
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  const H = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const S = date.getSeconds().toString().padStart(2, '0');
  return `${y}${M}${d}${H}${m}${S}`;
}

/** gpt-image-2-vip 像素换算表 */
export const VIP_PIXEL_TABLE: Record<string, Record<string, string>> = {
  '1:1':  { '1K': '1024x1024',  '2K': '2048x2048',  '4K': '2880x2880' },
  '3:4':  { '1K': '864x1152',   '2K': '1728x2304',  '4K': '2304x3072' },
  '4:3':  { '1K': '1152x864',   '2K': '2304x1728',  '4K': '3072x2304' },
  '16:9': { '1K': '1344x768',   '2K': '2688x1536',  '4K': '3840x2160' },
  '9:16': { '1K': '768x1344',   '2K': '1536x2688',  '4K': '2160x3840' },
};

/** 判断是否为 nano-banana 系列模型 */
export function isNanoBananaModel(model: string): boolean {
  return model.startsWith('nano-banana');
}

/** 判断是否为 gpt-image-2-vip 模型 */
export function isGptImage2Vip(model: string): boolean {
  return model === 'gpt-image-2-vip';
}

/** 生成文件中序号号，避免任务内重名 */
export function padSeq(seq: number): string {
  return seq.toString().padStart(2, '0');
}

/** 格式化时长 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (hours > 0) {
    return `${hours}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

/** 聚合去重错误信息 */
export function dedupErrors(errors: string[]): string {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const e of errors) {
    if (e && !seen.has(e)) {
      seen.add(e);
      result.push(e);
    }
  }
  return result.join('\n');
}

/** 判断 HTTP 状态码是否为可重试的瞬时错误 */
export function isTransientHttpError(status: number): boolean {
  return status >= 500 || status === 429;
}

/** 判断错误是否为瞬时错误（可重试） */
export function isTransientError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('fetch failed') || msg.includes('abort') || msg.includes('aborted') || msg.includes('timeout') || msg.includes('timed out')) {
      return true;
    }
  }
  return false;
}
