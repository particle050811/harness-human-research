import { VIP_PIXEL_MAP } from './shared';

export interface GenerateRequest {
  model: string;
  prompt: string;
  images: string[];
  aspectRatio: string;
  imageSize?: string;
  replyType: 'async';
}

export interface GenerateResponse {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'violation';
  results?: { url: string }[];
  progress?: number;
  error?: string;
}

/** 构建生成请求体，处理各模型尺寸字段差异 */
export function buildRequestBody(
  model: string,
  prompt: string,
  images: string[],
  aspectRatio: string,
  imageSize: string,
): GenerateRequest {
  if (model.startsWith('nano-banana')) {
    return { model, prompt, images, aspectRatio, imageSize, replyType: 'async' };
  } else if (model === 'gpt-image-2') {
    return { model, prompt, images, aspectRatio, replyType: 'async' };
  } else if (model === 'gpt-image-2-vip') {
    const pixels = VIP_PIXEL_MAP[aspectRatio]?.[imageSize] || '864x1152';
    return { model, prompt, images, aspectRatio: pixels, replyType: 'async' };
  }
  // fallback
  return { model, prompt, images, aspectRatio, imageSize, replyType: 'async' };
}

/** POST 提交生成任务，返回 job id */
export async function submitGenerate(
  baseUrl: string,
  apiKey: string,
  body: GenerateRequest,
  _signal?: AbortSignal,
): Promise<{ id: string; status: string; error?: string }> {
  const resp = await fetchWithTimeout(`${baseUrl}/v1/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  }, 30000);

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    return { id: '', status: resp.status >= 500 ? 'running' : 'failed', error: text || `HTTP ${resp.status}` };
  }

  const data = (await resp.json()) as GenerateResponse;
  if (!isValidResponse(data)) {
    return { id: '', status: 'failed', error: '响应格式异常' };
  }

  if (data.status === 'failed' || data.status === 'violation') {
    return { id: data.id || '', status: data.status, error: data.error || data.status };
  }

  if (!data.id) {
    return { id: '', status: 'failed', error: '响应缺少任务 ID' };
  }

  return { id: data.id, status: data.status };
}

/** GET 查询任务结果 */
export async function queryResult(
  baseUrl: string,
  apiKey: string,
  jobId: string,
  _signal?: AbortSignal,
): Promise<GenerateResponse> {
  const resp = await fetchWithTimeout(`${baseUrl}/v1/api/result?id=${encodeURIComponent(jobId)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 30000);

  if (!resp.ok) {
    return { id: jobId, status: 'running', error: `HTTP ${resp.status}` };
  }

  const data = (await resp.json()) as GenerateResponse;
  if (!isValidResponse(data)) {
    return { id: jobId, status: 'failed', error: '响应格式异常' };
  }
  return data;
}

/** 运行时校验响应结构 */
export function isValidResponse(data: unknown): data is GenerateResponse {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string') return false;
  const validStatus = ['running', 'succeeded', 'failed', 'violation'];
  if (!validStatus.includes(d.status as string)) return false;
  if (d.results !== undefined) {
    if (!Array.isArray(d.results)) return false;
    for (const r of d.results) {
      if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>).url !== 'string') return false;
    }
  }
  return true;
}

/** 判断是否为可重试的瞬时错误 */
export function isTransientError(error: string): boolean {
  if (!error) return false;
  if (/^HTTP 5\d{2}$/.test(error)) return true;
  if (/^HTTP 429$/.test(error)) return true;
  if (error.includes('fetch failed') || error.includes('abort') || error === 'AbortError') return true;
  if (error === 'The operation was aborted') return true;
  return false;
}

/** 带超时的 fetch wrapper */
export async function fetchWithTimeout(input: string, init?: RequestInit, timeoutMs: number = 30000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(input, { ...init, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timer);
  }
}

/** gpt-image-2-vip 像素换算 */
export function vipPixelSize(aspectRatio: string, imageSize: string): string {
  return VIP_PIXEL_MAP[aspectRatio]?.[imageSize] || '864x1152';
}
