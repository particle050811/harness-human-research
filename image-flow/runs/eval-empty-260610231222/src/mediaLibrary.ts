// 素材库：手动素材库 + 自动「当前路径」库

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { isImageExt } from './shared';
import { getMediaFolders } from './config';

export interface MediaFolder {
  name: string;
  path: string;
  images: string[];
}

const RECURSION_MAX_DEPTH = 3;
const RECURSION_MAX_ITEMS = 500;

/** 递归扫描图片（深度限制、条数限制） */
function scanImages(dir: string, maxDepth: number, maxItems: number, currentDepth = 0): string[] {
  const images: string[] = [];
  if (currentDepth > maxDepth || images.length >= maxItems) return images;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (images.length >= maxItems) break;
      if (entry.isDirectory() && currentDepth < maxDepth) {
        images.push(...scanImages(path.join(dir, entry.name), maxDepth, maxItems, currentDepth + 1));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1);
        if (isImageExt(ext)) {
          images.push(path.join(dir, entry.name));
        }
      }
    }
  } catch {
    // 忽略不可读的目录
  }
  return images.slice(0, maxItems);
}

/** 扫描手动素材库 */
export function scanManualMediaFolders(workspaceState: vscode.Memento): MediaFolder[] {
  const folders = getMediaFolders(workspaceState);
  return folders.map(f => ({
    name: path.basename(f),
    path: f,
    images: scanImages(f, RECURSION_MAX_DEPTH, RECURSION_MAX_ITEMS),
  }));
}

/** 自动素材库：按生效 MD 的路径逐层生成 */
export function scanAutoMediaFolders(mdFilePath: string | null): MediaFolder[] {
  if (!mdFilePath) return [];

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return [];

  const wsRoot = folders[0].uri.fsPath;
  const mdDir = path.dirname(mdFilePath);

  // MD 不在工作区内
  if (!mdDir.startsWith(wsRoot)) return [];

  // 从工作区根的下一层到 MD 所在目录，逐层
  const result: MediaFolder[] = [];
  let current = mdDir;

  while (current.length > wsRoot.length) {
    const name = path.relative(wsRoot, current);
    try {
      const entries = fs.readdirSync(current, { withFileTypes: true });
      const images = entries
        .filter(e => e.isFile() && isImageExt(path.extname(e.name).slice(1)))
        .map(e => path.join(current, e.name));
      if (images.length > 0) {
        result.unshift({ name: name || path.basename(current), path: current, images });
      }
    } catch {
      // 忽略
    }
    current = path.dirname(current);
  }

  return result;
}

/** 获取图片路径的正则，用于扫描目录下的直接图片文件 */
export function scanHistoryImages(folderPath: string): string[] {
  const images: string[] = [];
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && isImageExt(path.extname(entry.name).slice(1))) {
        images.push(path.join(folderPath, entry.name));
      }
    }
  } catch {
    // 忽略
  }
  return images;
}

/** 生成相对引用路径（POSIX 风格，含空格/括号时用尖括号包裹） */
export function makeRelativeImageRef(mdDir: string, imageAbsPath: string): string {
  let rel = path.relative(mdDir, imageAbsPath);
  // 跨盘符检查
  if (path.isAbsolute(rel) && !rel.startsWith('.')) {
    throw new Error('无法跨盘符引用');
  }
  // 转 POSIX 风格
  rel = rel.split(path.sep).join('/');
  const needsBracket = /[\s()]/.test(rel);
  if (needsBracket) {
    rel = `<${rel}>`;
  }
  if (!rel.startsWith('.') && !rel.startsWith('<')) {
    rel = './' + rel;
  }
  const baseName = path.basename(imageAbsPath, path.extname(imageAbsPath));
  return `![${baseName}](${rel})`;
}
