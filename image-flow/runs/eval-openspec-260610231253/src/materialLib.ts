import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { isImageExt, type MaterialLibrary, type MaterialImage } from './shared';

const MAX_DEPTH = 3;
const MAX_FILES = 500;

/** 扫描目录内图片（递归，深度/数量上限保护） */
export function scanImages(
  dirPath: string,
  recursive: boolean,
  webviewUriFn: (p: string) => vscode.Uri,
): MaterialImage[] {
  const images: MaterialImage[] = [];
  if (!fs.existsSync(dirPath)) return images;

  function walk(currentDir: string, depth: number) {
    if (images.length >= MAX_FILES) return;
    if (recursive && depth > MAX_DEPTH) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (images.length >= MAX_FILES) return;
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().replace('.', '');
        if (isImageExt(ext)) {
          const fullPath = path.join(currentDir, entry.name);
          images.push({
            path: fullPath,
            name: entry.name,
            webviewUri: webviewUriFn(fullPath).toString(),
          });
        }
      } else if (recursive && entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), depth + 1);
      }
    }
  }

  walk(dirPath, 1);
  return images;
}

/** 生成自动素材库（按 MD 路径逐层向上） */
export function buildAutoLibraries(
  mdPath: string,
  workspaceRoot: string,
  webviewUriFn: (p: string) => vscode.Uri,
): MaterialLibrary[] {
  if (!mdPath || !workspaceRoot) return [];

  const libs: MaterialLibrary[] = [];
  const mdDir = path.dirname(mdPath);
  const rel = path.relative(workspaceRoot, mdDir);
  if (!rel || rel.startsWith('..')) return [];

  // 从工作区根的下一层开始，到 MD 所在目录
  const parts = rel.split(path.sep);
  let current = workspaceRoot;

  // 从工作区根下一层起，每层各自成库（不含根那层）
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    // 当前层文件夹名就是库名
    const libName = parts[i] || current;
    const files = fs.readdirSync(current).filter((f) => {
      const fullPath = path.join(current, f);
      try {
        return fs.statSync(fullPath).isFile() && isImageExt(path.extname(f).toLowerCase().replace('.', ''));
      } catch {
        return false;
      }
    });

    if (files.length === 0) continue;

    const images: MaterialImage[] = files.map((f) => {
      const fullPath = path.join(current, f);
      return {
        path: fullPath,
        name: f,
        webviewUri: webviewUriFn(fullPath).toString(),
      };
    });

    libs.push({ name: libName, path: current, images });
  }

  return libs;
}

/** 生成相对 MD 的 POSIX 风格相对路径引用 */
export function relativeImagePath(mdPath: string, imagePath: string): { path: string; needsBracket: boolean } | null {
  const mdDir = path.dirname(mdPath);

  // 跨盘符检测
  try {
    const rel = path.relative(mdDir, imagePath);
    if (rel.startsWith('..') && rel.includes(':')) {
      return null; // 跨盘符
    }
  } catch {
    return null;
  }

  let rel = path.relative(mdDir, imagePath).split(path.sep).join('/');
  const needsBracket = /\s|\(|\)/.test(rel);

  if (!rel.startsWith('..')) {
    rel = './' + rel;
  }

  return { path: rel, needsBracket };
}

/** 生成 Markdown 图片引用 */
export function buildImageRef(mdPath: string, imagePath: string): string | null {
  const rel = relativeImagePath(mdPath, imagePath);
  if (!rel) return null;

  const alt = path.basename(imagePath, path.extname(imagePath));

  if (rel.needsBracket) {
    return `![${alt}](<${rel.path}>)`;
  }
  return `![${alt}](${rel.path})`;
}
