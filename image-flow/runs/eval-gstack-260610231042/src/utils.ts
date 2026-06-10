import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { IMAGE_EXT_SET } from './shared';

/** 生成时间戳到秒的任务文件夹名前缀 */
export function timestampPrefix(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const HH = String(now.getHours()).padStart(2, '0');
  const MI = String(now.getMinutes()).padStart(2, '0');
  const SS = String(now.getSeconds()).padStart(2, '0');
  return `${yy}${mm}${dd}${HH}${MI}${SS}`;
}

/** 在 baseDir 下找一个不冲突的 task-ts-seq 文件夹名 */
export function findTaskFolder(baseDir: string, ts: string): string {
  let seq = 1;
  while (true) {
    const name = `task-${ts}-${seq}`;
    try {
      // 用 fs 同步检查，避免竞态
      const full = path.join(baseDir, name);
      if (!fs.existsSync(full)) {
        return full;
      }
      seq++;
    } catch {
      seq++;
    }
  }
}

/** 从 url 路径提取文件扩展名，不在白名单则回退 png */
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

/** 格式化时长 mm:ss 或 h:mm:ss */
export function formatDuration(ms: number): string {
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

/** 文件路径的 POSIX 相对路径（总是用 /） */
export function posixRelative(from: string, to: string): string {
  let rel = path.relative(from, to);
  // 转 POSIX 分隔符
  rel = rel.replace(/\\/g, '/');
  // 非 .. 开头时加 ./
  if (!rel.startsWith('..') && !rel.startsWith('/')) {
    rel = './' + rel;
  }
  return rel;
}

/** 路径是否需要 <> 包裹（含空格或半角括号） */
export function needsAngleBrackets(p: string): boolean {
  return /[\s()]/.test(p);
}

/** 判断是否跨盘符无法引用 */
export function isCrossDrive(rel: string): boolean {
  // Windows 绝对路径或以盘符开头
  return /^[a-zA-Z]:/.test(rel);
}

/** 图片路径转 webview URI */
export function asWebviewUri(
  webview: vscode.Webview,
  extUri: vscode.Uri,
  filePath: string
): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.file(filePath));
}
