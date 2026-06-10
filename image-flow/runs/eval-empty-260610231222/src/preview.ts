// 预览请求：与真实提交共用请求体构造，但不调 API

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { parseMarkdown, buildFinalPrompt } from './markdownParser';
import { isNanoBanana, isGptImage2Vip } from './config';
import { getConfig } from './config';
import { vipPixelSize } from './shared';

export async function showPreview(
  mdFilePath: string,
  context: vscode.ExtensionContext,
  globalState: vscode.Memento,
  secrets: vscode.SecretStorage,
): Promise<void> {
  const config = await getConfig(secrets, globalState);
  const mdDir = path.dirname(mdFilePath);
  const mdContent = fs.readFileSync(mdFilePath, 'utf-8');

  if (mdContent.trim() === '') {
    vscode.window.showErrorMessage('内容为空');
    return;
  }

  const parsed = parseMarkdown(mdContent, mdDir);
  const injection = config.modelInjections[config.model] ?? '';
  const imagesMdContent = readImagesMd();

  const finalPrompt = buildFinalPrompt(parsed.body, injection, imagesMdContent);

  // 构建请求体（仅展示用）
  const requestBody: Record<string, unknown> = {
    model: config.model,
    images: parsed.images,
    replyType: 'async',
  };

  if (isNanoBanana(config.model)) {
    requestBody.aspectRatio = config.aspectRatio;
    requestBody.imageSize = config.imageSize;
  } else if (isGptImage2Vip(config.model)) {
    requestBody.aspectRatio = vipPixelSize(config.aspectRatio, config.imageSize);
  } else {
    requestBody.aspectRatio = config.aspectRatio;
  }

  const requestUrl = `${config.baseUrl}/v1/api/generate`;

  // 剔除 prompt 和 images 的请求参数
  const paramsWithoutPrompt: Record<string, unknown> = { ...requestBody };
  delete paramsWithoutPrompt.images;
  const paramsJson = JSON.stringify(paramsWithoutPrompt, null, 2);

  // 参考图概览
  let imagesSummary: string;
  if (parsed.images.length === 0) {
    imagesSummary = '（无参考图）';
  } else {
    imagesSummary = parsed.images
      .map((uri, i) => {
        const preview = uri.slice(0, 48);
        return `image${i + 1}: ${preview}…（总长度 ${uri.length}）`;
      })
      .join('\n');
  }

  const previewContent = [
    `# 预览请求 — ${path.basename(mdFilePath)}`,
    '',
    '## 最终提示词',
    '',
    finalPrompt || '（空）',
    '',
    '## 请求地址',
    '',
    `POST ${requestUrl}`,
    '',
    '## 请求参数（已剔除 prompt 与 images 字段）',
    '',
    '```json',
    paramsJson,
    '```',
    '',
    '## 参考图概览',
    '',
    imagesSummary,
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({
    content: previewContent,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}

/** 读取工作区根 IMAGES.md 全文 */
export function readImagesMd(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const root = folders[0].uri.fsPath;
  const imagesMdPath = path.join(root, 'IMAGES.md');
  try {
    const content = fs.readFileSync(imagesMdPath, 'utf-8');
    return content.trim() || null;
  } catch {
    return null;
  }
}
