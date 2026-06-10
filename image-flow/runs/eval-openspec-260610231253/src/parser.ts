import * as path from 'path';
import * as fs from 'fs';
import { isImageExt } from './shared';

export interface RefImage {
  /** 编号（从 1 开始） */
  index: number;
  /** data URI */
  dataUri: string;
  /** 原始路径 */
  originalPath: string;
}

export interface ParseResult {
  /** 替换后的正文（图片语法替换为 [imageN]） */
  body: string;
  /** 去重编号的参考图列表 */
  refImages: RefImage[];
}

/**
 * 解析 Markdown 正文，提取参考图并替换为 [imageN]
 * 匹配 `![alt](路径)` 与 `![alt](<路径>)`
 * 按首次出现顺序去重编号，同一路径复用同一序号
 * 任何参考图读取失败抛出 REF_FAIL: 错误
 */
export function parseMarkdown(mdContent: string, mdDir: string): ParseResult {
  const imageRefs = new Map<string, number>(); // 路径 → 编号
  const refImages: RefImage[] = [];
  const failedPaths: string[] = [];
  let nextIndex = 1;

  const imgRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)\s]+))\)/g;
  let match: RegExpExecArray | null;

  // 第一遍：收集所有引用
  const replacements: { start: number; end: number; rawPath: string }[] = [];

  while ((match = imgRegex.exec(mdContent)) !== null) {
    const rawPath = (match[2] || match[3] || '').trim();
    if (!rawPath) continue;
    replacements.push({ start: match.index, end: match.index + match[0].length, rawPath });
  }

  // 预检查所有参考图是否可读
  for (const { rawPath } of replacements) {
    if (imageRefs.has(rawPath)) continue;
    const absPath = path.resolve(mdDir, rawPath);
    try {
      fs.accessSync(absPath, fs.constants.R_OK);
    } catch {
      failedPaths.push(absPath);
    }
  }

  if (failedPaths.length > 0) {
    throw new Error(`REF_FAIL:${failedPaths.join('\n')}`);
  }

  // 第二遍：构建替换结果
  let body = mdContent;
  let offset = 0;

  for (const { start, end, rawPath } of replacements) {
    let idx: number;
    if (imageRefs.has(rawPath)) {
      idx = imageRefs.get(rawPath)!;
    } else {
      idx = nextIndex++;
      imageRefs.set(rawPath, idx);

      const absPath = path.resolve(mdDir, rawPath);
      const ext = path.extname(absPath).toLowerCase().replace('.', '');
      const mime = mimeFromExt(ext);
      const buffer = fs.readFileSync(absPath);
      const b64 = buffer.toString('base64');
      const dataUri = `data:${mime};base64,${b64}`;

      refImages.push({ index: idx, dataUri, originalPath: rawPath });
    }

    const replacement = `[image${idx}](${path.basename(rawPath, path.extname(rawPath))})`;
    body = body.slice(0, start + offset) + replacement + body.slice(end + offset);
    offset += replacement.length - (end - start);
  }

  return { body, refImages };
}

/** 根据扩展名推断 MIME */
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
  return m[ext] || 'image/png';
}

export { isImageExt };
