/**
 * 预览请求 — 与真实提交共用请求体构造，但不调 API。
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { parseMarkdown, isContentEmpty } from './markdown';
import { buildRequestBody } from './api';
import { getConfig, getModelInjection } from './config';
import type { RefImage } from './markdown';

function assemblePrompt(content: string, config: ReturnType<typeof getConfig>, workspaceRoot?: string): string {
  const parts: string[] = [];
  const injection = getModelInjection(config, config.model);
  if (injection.trim()) parts.push(injection.trim());
  if (workspaceRoot) {
    try {
      const imagesContent = fs.readFileSync(path.join(workspaceRoot, 'IMAGES.md'), 'utf-8').trim();
      if (imagesContent) parts.push(imagesContent);
    } catch { /* 静默跳过 */ }
  }
  if (content.trim()) parts.push(content.trim());
  return parts.join('\n\n');
}

/** 组装预览文本（纯函数，可测试） */
export function buildPreviewText(params: {
  finalPrompt: string;
  baseUrl: string;
  paramsForDisplay: Record<string, unknown>;
  refs: RefImage[];
}): string {
  const lines: string[] = [];
  lines.push('# 预览请求');
  lines.push('');
  lines.push('## 最终提示词');
  lines.push('');
  lines.push(params.finalPrompt);
  lines.push('');
  lines.push('## 请求地址');
  lines.push('');
  lines.push(`POST ${params.baseUrl}/v1/api/generate`);
  lines.push('');
  lines.push('## 请求参数（已剔除 prompt 与 images）');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(params.paramsForDisplay, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## 参考图概览');
  lines.push('');

  if (params.refs.length === 0) {
    lines.push('无参考图');
  } else {
    params.refs.forEach((ref, i) => {
      const preview = ref.dataUri.slice(0, 48);
      lines.push(`- image${i + 1}: ${preview}…（${ref.dataUri.length} 字符）`);
    });
  }

  return lines.join('\n');
}

export async function previewRequest(
  context: vscode.ExtensionContext,
  mdPath: string,
): Promise<void> {
  const config = getConfig(context);
  const content = fs.readFileSync(mdPath, 'utf-8');

  if (isContentEmpty(content)) {
    vscode.window.showErrorMessage('内容为空，无法预览');
    return;
  }

  const mdDir = path.dirname(mdPath);
  const parseResult = parseMarkdown(content, mdDir);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(mdPath));
  const finalPrompt = assemblePrompt(parseResult.body, config, workspaceFolder?.uri.fsPath);

  const requestBody = buildRequestBody({
    model: config.model,
    prompt: finalPrompt,
    images: parseResult.refs.map(r => r.dataUri),
    aspectRatio: config.aspectRatio,
    imageSize: config.imageSize,
    replyType: 'json',
  });

  const paramsForDisplay = { ...requestBody };
  delete paramsForDisplay.prompt;
  delete paramsForDisplay.images;

  const previewText = buildPreviewText({
    finalPrompt,
    baseUrl: config.baseUrl,
    paramsForDisplay: paramsForDisplay as Record<string, unknown>,
    refs: parseResult.refs,
  });

  const doc = await vscode.workspace.openTextDocument({
    content: previewText,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}
