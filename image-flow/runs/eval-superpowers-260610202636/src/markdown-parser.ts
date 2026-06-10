// Markdown 图片语法解析与参考图提取
import * as path from 'path';
import * as fs from 'fs';
import { getMimeType } from './utils';

export interface ReferenceImage {
  /** 编号（从 1 开始，按首次出现顺序） */
  index: number;
  /** 文件绝对路径 */
  absPath: string;
  /** data URI */
  dataUri: string;
}

export interface ParsedMarkdown {
  /** 替换后的正文（图片语法替换为 [imageN](文件名去扩展名)） */
  body: string;
  /** 参考图列表（按编号顺序） */
  references: ReferenceImage[];
}

/**
 * 解析 Markdown 正文，提取参考图并替换
 * @param content Markdown 原始文本
 * @param mdDir Markdown 文件所在目录（用于解析相对路径）
 * @returns 解析结果；读取失败时抛出包含所有失败路径的错误
 */
export function parseMarkdown(content: string, mdDir: string): ParsedMarkdown {
  // 匹配 ![alt](path) 或 ![alt](<path>) 其中尖括号内可含空格与半角括号
  const imgRegex = /!\[([^\]]*)\]\((?:<([^>]+)>|([^)]+))\)/g;

  const pathToIndex = new Map<string, number>();
  const references: ReferenceImage[] = [];
  const failures: string[] = [];

  // 第一遍：收集所有引用并编号
  const matches: Array<{ full: string; alt: string; p: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(content)) !== null) {
    const rawPath = match[2] ?? match[3];
    matches.push({
      full: match[0],
      alt: match[1],
      p: rawPath,
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  // 去重编号
  for (const m of matches) {
    if (!pathToIndex.has(m.p)) {
      const idx = pathToIndex.size + 1;
      pathToIndex.set(m.p, idx);
    }
  }

  // 第二遍：读取文件并生成 data URI
  for (const [relativePath, idx] of pathToIndex.entries()) {
    const absPath = path.resolve(mdDir, relativePath);
    try {
      const buffer = fs.readFileSync(absPath);
      const ext = path.extname(absPath).slice(1);
      const mime = getMimeType(ext);
      const dataUri = `data:${mime};base64,${buffer.toString('base64')}`;
      references.push({ index: idx, absPath, dataUri });
    } catch {
      failures.push(relativePath);
    }
  }

  if (failures.length > 0) {
    throw new Error(`参考图读取失败:\n${failures.join('\n')}`);
  }

  // 按编号排序
  references.sort((a, b) => a.index - b.index);

  // 替换正文
  let body = content;
  // 从后往前替换，保持索引正确
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const idx = pathToIndex.get(m.p)!;
    const fileName = path.basename(m.p, path.extname(m.p));
    body = body.slice(0, m.start) + `[image${idx}](${fileName})` + body.slice(m.end);
  }

  return { body, references };
}
