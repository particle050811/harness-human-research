import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MaterialFolder, isImageFile } from './shared';

const SCAN_MAX_DEPTH = 3;
const SCAN_MAX_FILES = 500;

/**
 * 递归扫描图片文件
 * @param dir 目录
 * @param maxDepth 递归深度上限
 * @param maxFiles 条目上限
 * @returns 图片绝对路径数组
 */
function scanImagesRecursive(
  dir: string,
  maxDepth: number,
  maxFiles: number
): string[] {
  const results: string[] = [];
  const stack: Array<{ dirPath: string; depth: number }> = [
    { dirPath: dir, depth: 0 },
  ];

  while (stack.length > 0 && results.length < maxFiles) {
    const { dirPath, depth } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const full = path.join(dirPath, entry.name);
      if (entry.isFile() && isImageFile(entry.name)) {
        results.push(full);
      } else if (entry.isDirectory() && depth < maxDepth - 1) {
        stack.push({ dirPath: full, depth: depth + 1 });
      }
    }
  }

  return results;
}

/** 扫描素材库文件夹 */
export function scanMaterialFolder(dirPath: string): MaterialFolder | null {
  const images = scanImagesRecursive(dirPath, SCAN_MAX_DEPTH, SCAN_MAX_FILES);
  if (images.length === 0) return null;
  return {
    name: path.basename(dirPath),
    path: dirPath,
    images,
  };
}

/** 获取手动素材库列表 */
export function getManualMaterials(folders: string[]): MaterialFolder[] {
  const results: MaterialFolder[] = [];
  for (const folderPath of folders) {
    const m = scanMaterialFolder(folderPath);
    if (m) results.push(m);
  }
  return results;
}

/**
 * 获取自动素材库（"当前路径"）
 * 从工作区根的下一层起，到 MD 所在目录为止，每一层各成一个库（只取该层直接图片，不递归）
 */
export function getAutoMaterials(
  mdPath: string,
  workspaceRoot: string
): MaterialFolder[] {
  // MD 不在工作区内则返回空
  if (!mdPath.startsWith(workspaceRoot + path.sep) && mdPath !== workspaceRoot) {
    return [];
  }

  const results: MaterialFolder[] = [];
  const mdDir = path.dirname(mdPath);

  // 从工作区根到 MD 目录的路径链，从根的下层开始
  let current = mdDir;
  while (current.length > workspaceRoot.length) {
    const rel = path.relative(workspaceRoot, current);
    if (!rel) break;

    try {
      const files = fs
        .readdirSync(current, { withFileTypes: true })
        .filter(e => e.isFile() && isImageFile(e.name))
        .map(e => path.join(current, e.name));

      if (files.length > 0) {
        results.push({
          name: rel || path.basename(current),
          path: current,
          images: files,
        });
      }
    } catch {
      // 跳过无权限目录
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 倒序：从根到 MD
  results.reverse();

  // 排除工作区根层
  return results.filter(r => r.path !== workspaceRoot);
}

/** 通过系统文件夹选择器添加素材库 */
export async function pickMaterialFolder(): Promise<string | undefined> {
  const result = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    title: '选择素材库文件夹',
  });
  return result?.[0]?.fsPath;
}
