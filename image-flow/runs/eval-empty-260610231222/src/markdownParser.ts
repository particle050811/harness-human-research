// Markdown 解析与参考图提取

import * as fs from 'fs';
import * as path from 'path';
import { mimeFromExt } from './shared';

export interface ParsedMarkdown {
  /** 替换后的正文 */
  body: string;
  /** 参考图数组（base64 data URI） */
  images: string[];
  /** 图片路径→编号映射 */
  imageMap: Map<string, number>;
}

/**
 * 解析 Markdown：
 * - 匹配 ![alt](路径) 或 ![alt](<路径>) 格式
 * - 相对路径基于 mdDir 解析
 * - 按首次出现顺序去重编号
 * - 正文中替换为 [imageN](文件名去扩展名)
 */
export function parseMarkdown(mdContent: string, mdDir: string): ParsedMarkdown {
  const imageMap = new Map<string, number>();
  const imagePaths: string[] = [];
  let nextIndex = 1;
  const failures: string[] = [];

  // 匹配 ![alt](path) 或 ![alt](<path>) — 尖括号内可含空格与半角括号
  // 使用两路交替：尖括号形式允许括号出现在路径中
  const imgRegex = /!\[([^\]]*)\]\(<([^>]*)>\)|!\[([^\]]*)\]\(([^)\s]*)\)/g;

  const body = mdContent.replace(imgRegex, (
    fullMatch,
    alt1: string, path1: string | undefined,
    alt2: string, path2: string,
  ) => {
    const imgPath = (path1 !== undefined ? path1 : path2).trim();
    let index: number;
    if (imageMap.has(imgPath)) {
      index = imageMap.get(imgPath)!;
    } else {
      const absPath = path.isAbsolute(imgPath) ? imgPath : path.resolve(mdDir, imgPath);
      try {
        const buf = fs.readFileSync(absPath);
        const ext = path.extname(absPath).slice(1);
        const mime = mimeFromExt(ext);
        const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
        index = nextIndex++;
        imageMap.set(imgPath, index);
        imagePaths.push(dataUri);
      } catch {
        failures.push(imgPath);
        return fullMatch; // 保留原文，等后续报错
      }
    }
    const baseName = path.basename(imgPath, path.extname(imgPath));
    return `[image${index}](${baseName})`;
  });

  if (failures.length > 0) {
    throw new Error(`以下参考图读取失败：\n${failures.join('\n')}`);
  }

  return { body, images: imagePaths, imageMap };
}

/**
 * 拼接最终 prompt：模型注入句 + IMAGES.md 全文 + 替换后正文，空行连接，空段省略
 */
export function buildFinalPrompt(
  originalBody: string,
  injection: string,
  imagesMdContent: string | null,
): string {
  const parts: string[] = [];
  if (injection.trim()) parts.push(injection.trim());
  if (imagesMdContent && imagesMdContent.trim()) parts.push(imagesMdContent.trim());
  if (originalBody.trim()) parts.push(originalBody.trim());
  return parts.join('\n\n');
}
