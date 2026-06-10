/**
 * Markdown 解析 — 提取参考图、去重编号、替换正文图片语法。
 * - 支持 ![alt](path) 与 ![alt](<path with spaces()>)
 * - 按首次出现顺序去重编号
 * - 替换为 [imageN](文件名去扩展名)
 */

import * as path from 'path';
import * as fs from 'fs';
import { getMimeType, getImageExtension } from './utils';

export interface RefImage {
  /** data: URI，如 data:image/png;base64,... */
  dataUri: string;
  /** 原始相对路径 */
  originalPath: string;
  /** 文件名（去扩展名） */
  baseName: string;
}

export interface ParseResult {
  /** 替换后的正文 */
  body: string;
  /** 参考图数组（按编号顺序） */
  refs: RefImage[];
}

/**
 * 解析 Markdown 全文，提取参考图并按首次出现顺序去重编号。
 * @param content - Markdown 原始内容
 * @param mdDir - Markdown 文件所在目录（读取参考图的基准路径）
 * @returns 替换后的正文与参考图数组；任何参考图读取失败抛出 Error。
 */
export function parseMarkdown(content: string, mdDir: string): ParseResult {
  // 匹配 ![alt](路径) 或 ![alt](<路径>)
  const imgRe = /!\[([^\]]*)\]\(<?([^)>]+)>?\)/g;

  const seen = new Map<string, number>(); // path → 编号 (1-based)
  const refs: RefImage[] = [];
  const failed: string[] = [];

  // 第一遍：收集参考图并按顺序去重
  const matches: Array<{ full: string; alt: string; imgPath: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(content)) !== null) {
    const imgPath = m[2].trim();
    matches.push({ full: m[0], alt: m[1], imgPath });
    if (!seen.has(imgPath)) {
      const absPath = path.resolve(mdDir, imgPath);
      try {
        const buf = fs.readFileSync(absPath);
        const ext = getImageExtension(imgPath);
        const dataUri = `data:${getMimeType(ext)};base64,${buf.toString('base64')}`;
        const baseName = path.basename(imgPath, path.extname(imgPath));
        refs.push({ dataUri, originalPath: imgPath, baseName });
        seen.set(imgPath, refs.length); // 1-based
      } catch {
        failed.push(imgPath);
      }
    }
    // 已见过的路径保持原编号
  }

  if (failed.length > 0) {
    throw new Error(`参考图读取失败：${failed.join(', ')}`);
  }

  // 第二遍：替换正文中图片语法
  let body = content;
  let offset = 0;
  imgRe.lastIndex = 0;
  while ((m = imgRe.exec(content)) !== null) {
    const imgPath = m[2].trim();
    const num = seen.get(imgPath)!;
    const ref = refs[num - 1];
    const replacement = `[image${num}](${ref.baseName})`;
    body = body.slice(0, m.index + offset) + replacement + body.slice(m.index + offset + m[0].length);
    offset += replacement.length - m[0].length;
  }

  return { body, refs };
}

/** 判断 Markdown 内容是否为空（trim 后） */
export function isContentEmpty(content: string): boolean {
  return content.trim().length === 0;
}
