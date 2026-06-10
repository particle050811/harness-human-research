import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getModelInjection } from './config';
import { ImageFlowConfig } from './shared';
import { buildGenerateBody } from './api';

/**
 * 组装最终 prompt：
 * 模型注入句 + IMAGES.md 全文 + 替换后正文
 * 用空行连接，空段省略。
 */
function assembleFinalPrompt(
  processedText: string,
  model: string,
  config: Omit<ImageFlowConfig, 'apiKey'>,
  workspaceRoot?: string,
): string {
  const parts: string[] = [];

  // 模型注入句
  const injection = getModelInjection(config, model);
  if (injection) parts.push(injection);

  // IMAGES.md 全文
  if (workspaceRoot) {
    try {
      const imagesPath = path.join(workspaceRoot, 'IMAGES.md');
      const content = fs.readFileSync(imagesPath, 'utf-8').trim();
      if (content) parts.push(content);
    } catch {
      // 不存在或不可读，静默跳过
    }
  }

  // 替换后正文
  if (processedText.trim()) parts.push(processedText);

  return parts.join('\n\n');
}

/**
 * 打开预览文档：与真实提交完全一致的解析与请求体构造，但不调 API。
 */
export async function showPreview(
  _mdPath: string,
  processedText: string,
  images: string[],
  model: string,
  config: Omit<ImageFlowConfig, 'apiKey'>,
  workspaceRoot?: string,
): Promise<void> {
  const finalPrompt = assembleFinalPrompt(processedText, model, config, workspaceRoot);

  const url = `POST ${config.baseUrl}/v1/api/generate`;

  // 构造请求体（剔除 prompt 和 images）
  const fullBody = buildGenerateBody({
    model,
    prompt: finalPrompt,
    images,
    config: { baseUrl: config.baseUrl, aspectRatio: config.aspectRatio, imageSize: config.imageSize },
  });
  const bodyWithoutPrompt: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fullBody as Record<string, unknown>)) {
    if (k !== 'prompt' && k !== 'images') bodyWithoutPrompt[k] = v;
  }
  const bodyJson = JSON.stringify(bodyWithoutPrompt, null, 2);

  // 参考图概览
  let refOverview: string;
  if (images.length === 0) {
    refOverview = '无参考图';
  } else {
    refOverview = images
      .map((img, i) => {
        const preview = img.slice(0, 48);
        return `image${i + 1}: ${preview}…（总长度 ${img.length}）`;
      })
      .join('\n');
  }

  const content = [
    `# 预览请求: ${finalPrompt.split('\n')[0] || '(无提示词)'}`,
    '',
    '## 最终提示词',
    '',
    '```',
    finalPrompt,
    '```',
    '',
    '## 请求地址',
    '',
    '```',
    url,
    '```',
    '',
    '## 请求参数（已剔除 prompt 与 images）',
    '',
    '```json',
    bodyJson,
    '```',
    '',
    '## 参考图概览',
    '',
    '```',
    refOverview,
    '```',
  ].join('\n');

  const doc = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown',
  });
  await vscode.window.showTextDocument(doc, { preview: true });
}
