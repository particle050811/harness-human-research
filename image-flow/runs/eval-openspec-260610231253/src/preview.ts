import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { buildRequestBody } from './api';
import { parseMarkdown } from './parser';
import { getPrompt } from './prompt';
import type { ConfigManager } from './config';

/**
 * 预览请求：走与真实提交完全一致的解析与请求体构造，但不调 API，
 * 结果输出到临时预览文档。
 */
export async function showPreview(
  mdPath: string,
  configManager: ConfigManager,
) {
  const config = await configManager.getConfig();
  const mdDir = path.dirname(mdPath);
  const mdContent = fs.readFileSync(mdPath, 'utf-8');

  if (!mdContent.trim()) {
    vscode.window.showErrorMessage('内容为空');
    return;
  }

  let parseResult;
  try {
    parseResult = parseMarkdown(mdContent, mdDir);
  } catch (e: any) {
    if (e.message?.startsWith('REF_FAIL:')) {
      const paths = e.message.replace('REF_FAIL:', '').split('\n').filter(Boolean);
      vscode.window.showErrorMessage(`参考图读取失败：\n${paths.join('\n')}`);
      return;
    }
    throw e;
  }

  const prompt = getPrompt(mdPath, config.model, parseResult.body, configManager);
  const refUris = parseResult.refImages.map((r: { dataUri: string }) => r.dataUri);

  const body = buildRequestBody(config.model, prompt, refUris, config.aspectRatio, config.imageSize);

  // 构造预览内容
  const lines: string[] = [];

  // 1. 最终提示词
  lines.push('## 最终提示词');
  lines.push('');
  lines.push(prompt || '(空)');
  lines.push('');

  // 2. 请求地址
  lines.push('## 请求地址');
  lines.push('');
  lines.push(`POST ${config.baseUrl}/v1/api/generate`);
  lines.push('');

  // 3. 请求参数 JSON（剔除 prompt 与 images）
  const paramsForDisplay: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k !== 'prompt' && k !== 'images') {
      paramsForDisplay[k] = v;
    }
  }
  lines.push('## 请求参数（已剔除 prompt 与 images）');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(paramsForDisplay, null, 2));
  lines.push('```');
  lines.push('');

  // 4. 参考图概览
  lines.push('## 参考图概览');
  lines.push('');
  if (parseResult.refImages.length === 0) {
    lines.push('无参考图');
  } else {
    for (const ref of parseResult.refImages) {
      const preview = ref.dataUri.slice(0, 48);
      const totalLen = ref.dataUri.length;
      lines.push(`- image${ref.index}: ${preview}…（${totalLen} 字符）`);
    }
  }

  // 打开预览文档
  const doc = await vscode.workspace.openTextDocument({
    content: lines.join('\n'),
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}
