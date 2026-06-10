/**
 * 通用工具 — 图片类型白名单、MIME 推断等。
 */

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

/** 检查文件名是否为图片（根据扩展名白名单） */
export function isImageFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTENSIONS.includes(ext);
}

/** 以 . 开头的返回扩展名（小写），否则回退 png */
export function getImageExtension(urlOrPath: string): string {
  const parts = new URL(urlOrPath, 'https://local').pathname.split('.');
  const ext = parts.length > 1 ? parts.pop()!.toLowerCase() : 'png';
  return IMAGE_EXTENSIONS.includes(ext) ? ext : 'png';
}

/** 扩展名 → MIME */
export function getMimeType(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] ?? 'image/png';
}

/** 聚合进度计算：每个 job 占 1/N，终结 job 满分，running 取远端，submitting 记 0 */
export function computeAggregateProgress(jobs: Array<{ status: string; progress: number }>): number {
  if (jobs.length === 0) return 0;
  const total = jobs.reduce((sum, j) => {
    if (j.status === 'succeeded') return sum + 100;
    if (j.status === 'running') return sum + j.progress;
    return sum; // submitting / failed / violation 记 0
  }, 0);
  return Math.round(total / jobs.length);
}

/** 生成随机 nonce 用于 CSP */
export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
