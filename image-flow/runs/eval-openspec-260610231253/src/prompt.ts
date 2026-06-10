import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ConfigManager } from './config';

/** 组装最终 prompt = 模型注入句 + IMAGES.md + 替换后正文 */
export function getPrompt(
  mdPath: string,
  model: string,
  parsedBody: string,
  configManager: ConfigManager,
): string {
  const parts: string[] = [];

  // 1. 模型注入句
  const injections = configManager.get<Record<string, string>>('modelInjections', {});
  const injection = injections[model];
  if (injection) {
    parts.push(injection);
  }

  // 2. 工作区根 IMAGES.md
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mdPath));
  if (workspaceFolder) {
    const imagesMdPath = path.join(workspaceFolder.uri.fsPath, 'IMAGES.md');
    try {
      if (fs.existsSync(imagesMdPath)) {
        const content = fs.readFileSync(imagesMdPath, 'utf-8').trim();
        if (content) {
          parts.push(content);
        }
      }
    } catch { /* 静默跳过 */ }
  }

  // 3. 替换后正文
  const trimmed = parsedBody.trim();
  if (trimmed) {
    parts.push(trimmed);
  }

  return parts.join('\n\n');
}
