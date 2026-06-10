import * as path from 'path';
import * as fs from 'fs';
import { mimeFromExt } from './shared';

/** 解析结果：替换后的文本 + 去重编号后的参考图 data URI 数组 */
export interface ParseResult {
  text: string;
  images: string[]; // data URI 数组
}

interface ImageRef {
  alt: string;
  imagePath: string; // 原始路径字符串（相对于 MD 所在目录的路径）
  startIndex: number;
  endIndex: number;
  angleBracket: boolean; // 是否 <> 包裹
}

/**
 * 解析 Markdown 中的图片引用，返回去重后的参考图引用列表（按首次出现顺序）。
 * 不在这里读取文件读取——交给调用者批量读。
 */
export function extractImageRefs(content: string): Array<ImageRef & { num: number }> {
  const refs: ImageRef[] = [];
  let pos = 0;

  while (pos < content.length) {
    const start = content.indexOf('![', pos);
    if (start === -1) break;

    const altEnd = content.indexOf(']', start + 2);
    if (altEnd === -1) break;
    if (content[altEnd + 1] !== '(') {
      pos = start + 2;
      continue;
    }

    const parenStart = altEnd + 1;
    const afterParen = parenStart + 1;

    if (content[afterParen] === '<') {
      // 尖括号包裹形式 ![alt](<path>)
      const pathEnd = content.indexOf('>)', afterParen + 1);
      if (pathEnd === -1) { pos = start + 2; continue; }
      const imagePath = content.slice(afterParen + 1, pathEnd);
      const alt = content.slice(start + 2, altEnd);
      refs.push({ alt, imagePath, startIndex: start, endIndex: pathEnd + 2, angleBracket: true });
      pos = pathEnd + 2;
    } else {
      // 普通形式 ![alt](path)
      const pathEnd = content.indexOf(')', parenStart + 1);
      if (pathEnd === -1) { pos = start + 2; continue; }
      const imagePath = content.slice(parenStart + 1, pathEnd);
      const alt = content.slice(start + 2, altEnd);
      refs.push({ alt, imagePath, startIndex: start, endIndex: pathEnd + 1, angleBracket: false });
      pos = pathEnd + 1;
    }
  }

  // 按路径去重，保留首次出现的序号
  const seen = new Map<string, number>();
  const deduped: (ImageRef & { num: number })[] = [];
  for (const ref of refs) {
    const existing = seen.get(ref.imagePath);
    if (existing !== undefined) {
      deduped.push({ ...ref, num: existing });
    } else {
      const num = seen.size + 1;
      seen.set(ref.imagePath, num);
      deduped.push({ ...ref, num });
    }
  }

  return deduped;
}

/**
 * 解析 Markdown 内容：替换图片语法为 [imageN](文件名去扩展名)，
 * 返回处理后的文本，调用者需自行读取参考图文件。
 * 返回每处引用对应的 num 与相对路径，方便调用者按 num 顺序组装 images 数组。
 */
export function parseMarkdown(content: string): {
  text: string;
  refs: Array<{ num: number; imagePath: string; alt: string }>;
} {
  const rawRefs = extractImageRefs(content);

  // 从后往前替换，避免索引偏移
  let text = content;
  for (let i = rawRefs.length - 1; i >= 0; i--) {
    const ref = rawRefs[i];
    const baseName = path.basename(ref.imagePath, path.extname(ref.imagePath));
    const replacement = `[image${ref.num}](${baseName})`;
    text = text.slice(0, ref.startIndex) + replacement + text.slice(ref.endIndex);
  }

  return {
    text,
    refs: rawRefs.map(r => ({ num: r.num, imagePath: r.imagePath, alt: r.alt })),
  };
}

/**
 * 读取参考图文件，转为 data URI。
 * 返回按编号顺序排列的 data URI 数组（去重：同一路径只读一次）。
 * 任何文件不可读即 throw。
 */
export function readRefImages(
  refs: Array<{ num: number; imagePath: string; alt: string }>,
  mdDir: string
): string[] {
  // 按 num 去重，取首次路径
  const byNum = new Map<number, string>();
  for (const ref of refs) {
    if (!byNum.has(ref.num)) {
      byNum.set(ref.num, ref.imagePath);
    }
  }

  const failed: string[] = [];
  const images: string[] = [];

  for (let num = 1; num <= byNum.size; num++) {
    const relPath = byNum.get(num);
    if (!relPath) {
      failed.push(`image${num}: 未找到路径`);
      continue;
    }
    const absPath = path.resolve(mdDir, relPath);
    try {
      const data = fs.readFileSync(absPath);
      const ext = path.extname(absPath).slice(1).toLowerCase();
      const mime = mimeFromExt(ext);
      const b64 = data.toString('base64');
      images.push(`data:${mime};base64,${b64}`);
    } catch {
      failed.push(absPath);
    }
  }

  if (failed.length > 0) {
    throw new Error(`参考图读取失败:\n${failed.join('\n')}`);
  }

  return images;
}

/** 完整处理 Markdown：解析 + 读取参考图 */
export function processMarkdown(content: string, mdDir: string): ParseResult {
  const { text, refs } = parseMarkdown(content);
  const images = refs.length > 0 ? readRefImages(refs, mdDir) : [];
  return { text, images };
}
