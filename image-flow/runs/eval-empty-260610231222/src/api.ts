// Grsai API 调用层

import { isNanoBanana, isGptImage2Vip } from './config';
import { vipPixelSize, GenerateResponse, ResultResponse } from './shared';

const TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/** POST /v1/api/generate 提交生成任务 */
export async function submitGenerate(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  images: string[],
  aspectRatio: string,
  imageSize: string,
): Promise<GenerateResponse> {
  const body: Record<string, unknown> = {
    model,
    prompt,
    images,
    replyType: 'async',
  };

  if (isNanoBanana(model)) {
    body.aspectRatio = aspectRatio;
    body.imageSize = imageSize;
  } else if (isGptImage2Vip(model)) {
    body.aspectRatio = vipPixelSize(aspectRatio, imageSize);
  } else {
    // gpt-image-2 (非 vip)
    body.aspectRatio = aspectRatio;
  }

  const url = `${baseUrl}/v1/api/generate`;
  const resp = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const json: unknown = await resp.json().catch(() => null);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }

  return validateGenerateResponse(json);
}

/** GET /v1/api/result?id= 查询任务结果 */
export async function queryResult(baseUrl: string, apiKey: string, jobId: string): Promise<ResultResponse> {
  const url = `${baseUrl}/v1/api/result?id=${encodeURIComponent(jobId)}`;
  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const json: unknown = await resp.json().catch(() => null);

  if (!resp.ok) {
    if (resp.status >= 500 || resp.status === 429) {
      throw new Error(`HTTP ${resp.status} — 瞬时错误`);
    }
    throw new Error(`HTTP ${resp.status}: ${JSON.stringify(json)}`);
  }

  return validateResultResponse(json);
}

/** 运行时校验 generate 返回 */
function validateGenerateResponse(json: unknown): GenerateResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('无效的 API 响应（非对象）');
  }
  const r = json as Record<string, unknown>;
  const status = r.status;
  if (status === 'failed' || status === 'violation') {
    throw new Error(`API 返回失败: ${r.error ?? status}`);
  }
  if (status === 'succeeded' || status === 'running') {
    const id = r.id;
    if (!id || typeof id !== 'string') {
      throw new Error('API 返回缺少有效 id');
    }
    return {
      id,
      status: status,
      results: Array.isArray(r.results) ? r.results as { url: string }[] : undefined,
      progress: typeof r.progress === 'number' ? r.progress : undefined,
    };
  }
  throw new Error(`未知 API 状态: ${status}`);
}

/** 运行时校验 result 返回 */
function validateResultResponse(json: unknown): ResultResponse {
  if (!json || typeof json !== 'object') {
    throw new Error('无效的 API 响应（非对象）');
  }
  const r = json as Record<string, unknown>;
  const status = r.status;
  if (!status || typeof status !== 'string') {
    throw new Error('响应缺少 status 字段');
  }
  return {
    id: typeof r.id === 'string' ? r.id : undefined,
    status,
    results: Array.isArray(r.results) ? r.results as { url: string }[] : undefined,
    progress: typeof r.progress === 'number' ? r.progress : undefined,
    error: typeof r.error === 'string' ? r.error : undefined,
  };
}

/** 下载图片到本地 */
export async function downloadImage(url: string, destPath: string): Promise<void> {
  const resp = await fetchWithTimeout(url, {}, TIMEOUT_MS);
  if (!resp.ok) {
    throw new Error(`下载失败 HTTP ${resp.status}: ${url}`);
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const fs = await import('fs');
  fs.writeFileSync(destPath, buf);
}
