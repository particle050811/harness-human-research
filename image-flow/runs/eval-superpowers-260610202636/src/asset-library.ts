// 素材库管理：手动素材库 + 自动「当前路径」素材库
import * as path from 'path';
import * as fs from 'fs';
import { AssetFolder } from './shared';
import { isImageFile } from './utils';

const MAX_DEPTH = 3;
const MAX_ITEMS = 500;

/** 扫描手动素材库（递归，深度上限 3，条目上限 500） */
export function scanAssetFolder(folderPath: string): string[] {
  const images: string[] = [];
  scanRecursive(folderPath, 0, images);
  return images;
}

function scanRecursive(dir: string, depth: number, images: string[]): void {
  if (depth > MAX_DEPTH || images.length >= MAX_ITEMS) { return; }
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (images.length >= MAX_ITEMS) { return; }
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          scanRecursive(fullPath, depth + 1, images);
        } else if (entry.isFile() && isImageFile(fullPath)) {
          images.push(fullPath);
        }
      } catch { /* skip permission errors */ }
    }
  } catch { /* skip */ }
}

/** 生成自动素材库：从工作区根下一层到 MD 目录为止，每层取直接图片 */
export function getAutoAssetFolders(workspaceRoot: string, mdPath: string): AssetFolder[] {
  if (!workspaceRoot || !mdPath || !mdPath.startsWith(workspaceRoot)) { return []; }

  const mdDir = path.dirname(mdPath);
  const folders: AssetFolder[] = [];

  // 从工作区根下一层起，到 MD 目录为止
  let current = mdDir;
  while (current !== workspaceRoot && current !== path.dirname(current)) {
    const layerName = path.relative(workspaceRoot, current);
    if (layerName === '') { break; }

    const images = scanDirectImages(current);
    if (images.length > 0) {
      folders.push({
        name: layerName,
        path: current,
        auto: true,
        images,
      });
    }
    current = path.dirname(current);
  }

  // 保持从工作区向 MD 目录方向排序
  folders.reverse();
  return folders;
}

/** 扫描目录下直接的图片文件（不递归） */
function scanDirectImages(dir: string): string[] {
  const images: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = path.join(dir, entry.name);
        if (isImageFile(fullPath)) {
          images.push(fullPath);
        }
      }
    }
  } catch { /* skip */ }
  return images.sort();
}

/** 获取手动素材库列表（含扫描结果） */
export function getManualAssetFolders(folderPaths: string[]): AssetFolder[] {
  return folderPaths.map(fp => ({
    name: path.basename(fp),
    path: fp,
    auto: false,
    images: scanAssetFolder(fp),
  }));
}

/** 全部素材库（自动 + 手动） */
export function getAllAssetFolders(
  workspaceRoot: string,
  mdPath: string,
  manualFolders: string[],
): AssetFolder[] {
  const auto = getAutoAssetFolders(workspaceRoot, mdPath);
  const manual = getManualAssetFolders(manualFolders);
  return [...auto, ...manual];
}

/** 生成插入引用的相对路径（POSIX 风格） */
export function buildInsertRef(imagePath: string, mdPath: string): string | null {
  try {
    let rel = path.relative(path.dirname(mdPath), imagePath);
    // 转为 POSIX 风格
    rel = rel.replace(/\\/g, '/');

    // 跨盘符检查
    if (rel.startsWith('..') && rel.includes(':')) {
      return null; // 跨盘符无法相对引用
    }

    // 非 .. 开头加 ./ 前缀
    if (!rel.startsWith('.')) {
      rel = './' + rel;
    }

    const alt = path.basename(imagePath, path.extname(imagePath));

    // 含空格或半角括号用 <> 包裹
    if (/[ ()]/.test(rel)) {
      return `![${alt}](<${rel}>)`;
    }
    return `![${alt}](${rel})`;
  } catch {
    return null;
  }
}
