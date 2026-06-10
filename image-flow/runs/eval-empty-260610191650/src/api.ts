/**
 * Grsai API 调用层
 * - POST /v1/api/generate（异步提交）
 * - GET /v1/api/result（轮询结果）
 * - 多模型尺寸字段区分（nano-banana / gpt-image-2 / gpt-image-2-vip）
 * - 30s 超时
 * - 运行时响应校验
 */

import * as vscode from 'vscode';

// ─── gpt-image-2-vip 像素换算表 ─────────────────────

const VIP_PIXEL_TABLE: Record<string, Record<string, string>> = {
  '1:1': { '1K': '1024x1024', '2K': '1440x1440', '4K': '2048x2048' },
  '3:4': { '1K': '864x1152', '2K': '1248x1664', '4K': '1728x2304' },
  '4:3': { '1K': '1152x864', '2K': '1664x1248', '4K': '2304x1728' },
  '16:9': { '1K': '1344x768', '2K': '1920x1088', '4K': '2688x1536' },
  '9:16': { '1K': '768x1344', '2K': '1088x1920', '4K': '1536x2688' },
};

/** gpt-image-2-vip：按比例 + 分辨率查表返回宽x高像素字符串 */
export function getVipPixelSize(aspectRatio: string, imageSize: string): string {
  const ratioEntry = VIP_PIXEL_TABLE[aspectRatio];
  if (!ratioEntry) {
    throw new Error(`不支持的比例：${aspectRatio}`);
  }
  const size = ratioEntry[imageSize];
  if (!size) {
    throw new Error(`不支持的分辨率：${imageSize}`);
  }
  return size;
}

// ─── 生成请求体 ──────────────────────────────────────

export interface GenerateRequest {
  model: string;
  prompt: string;
  images: string[];
  aspectRatio?: string;
  imageSize?: string;
  replyType: 'json' | 'async';
}

export interface GenerateResponse {
  id: string;
  status: 'running' | 'violation' | 'succeeded' | 'failed';
  results?: Array<{ url: string }>;
  progress?: number;
  error?: string;
}

export interface QueryResponse {
  id: string;
  status: 'running' | 'violation' | 'succeeded' | 'failed';
  results?: Array<{ url: string }>;
  progress?: number;
  error?: string;
}

/** 验证 status 枚举 */
function isValidStatus(s: unknown): s is GenerateResponse['status'] {
  return s === 'running' || s === 'violation' || s === 'succeeded' || s === 'failed';
}

/** 验证生成/查询响应形状 */
function validateResponse(data: unknown): GenerateResponse {
  if (typeof data !== 'object' || data === null) {
    throw new Error('响应非 JSON 对象');
  }
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string') {
    throw new Error('响应缺少 id 字段');
  }
  if (!isValidStatus(d.status)) {
    throw new Error(`非法 status 值：${d.status}`);
  }
  const resp: GenerateResponse = { id: d.id, status: d.status };
  if (d.results !== undefined) {
    if (!Array.isArray(d.results)) {
      throw new Error('results 应为数组');
    }
    resp.results = d.results as Array<{ url: string }>;
  }
  if (d.progress !== undefined) {
    resp.progress = Number(d.progress);
  }
  if (d.error !== undefined) {
    resp.error = String(d.error);
  }
  return resp;
}

// ─── 构建请求体（按模型系列区分尺寸字段） ─────────

function isNanoBanana(model: string): boolean {
  return model.startsWith('nano-banana');
}

function isGptImage2Vip(model: string): boolean {
  return model === 'gpt-image-2-vip';
}

function isGptImage2(model: string): boolean {
  return model === 'gpt-image-2';
}

export function buildRequestBody(params: {
  model: string;
  prompt: string;
  images: string[];
  aspectRatio: string;
  imageSize: string;
  replyType: 'json' | 'async';
}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    images: params.images,
    replyType: params.replyType,
  };

  if (isNanoBanana(params.model)) {
    base.aspectRatio = params.aspectRatio;
    base.imageSize = params.imageSize;
  } else if (isGptImage2(params.model)) {
    base.aspectRatio = params.aspectRatio;
  } else if (isGptImage2Vip(params.model)) {
    base.aspectRatio = getVipPixelSize(params.aspectRatio, params.imageSize);
  }

  return base;
}

// ─── 网络请求 ────────────────────────────────────────

const TIMEOUT_MS = 30_000;

function createAbortController(timeoutMs: number): { controller: AbortController; timeoutId: NodeJS.Timeout } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

/** 判断错误是否为瞬时（可重试） */
export function isTransientError(err: unknown): boolean {
  const msg = String(err);
  if (msg.includes('AbortError') || msg.includes('aborted') || msg.includes('fetch failed')) {
    return true;
  }
  return false;
}

/** 判断 HTTP 状态码是否瞬时 */
export function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** POST 提交生成任务 */
export async function submitGenerate(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<GenerateResponse> {
  const { controller, timeoutId } = createAbortController(TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/v1/api/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (isTransientStatus(res.status)) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as unknown;
    return validateResponse(data);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** GET 查询异步结果 */
export async function queryResult(
  baseUrl: string,
  apiKey: string,
  jobId: string,
): Promise<QueryResponse> {
  const { controller, timeoutId } = createAbortController(TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/v1/api/result?id=${encodeURIComponent(jobId)}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (isTransientStatus(res.status)) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json() as unknown;
    return validateResponse(data);
  } finally {
    clearTimeout(timeoutId);
  }
}

/** 下载图片到本地文件 */
export async function downloadImage(url: string, destPath: string): Promise<void> {
  const { controller, timeoutId } = createAbortController(TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`下载失败 HTTP ${res.status}: ${url}`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await vscode.workspace.fs.writeFile(vscode.Uri.file(destPath), buf);
  } finally {
    clearTimeout(timeoutId);
  }
}
