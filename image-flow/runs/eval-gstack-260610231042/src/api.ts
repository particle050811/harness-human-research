import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import {
  ImageFlowConfig,
  isNanoBanana,
  isGptImage2Vip,
  calcVipPixels,
  VALID_STATUSES,
  extFromUrl,
} from './shared';

const TIMEOUT_MS = 30_000;

// ========== 运行时校验类型 ==========

interface ApiResult {
  id: string;
  status: string;
  results?: Array<{ url: string }>;
  progress?: number;
  error?: string;
}

function validateResult(data: unknown): ApiResult {
  if (!data || typeof data !== 'object') throw new Error('响应格式异常：非对象');
  const d = data as Record<string, unknown>;
  if (typeof d.id !== 'string') throw new Error('响应格式异常：缺少 id');
  if (typeof d.status !== 'string' || !VALID_STATUSES.has(d.status)) {
    throw new Error(`响应格式异常：无效 status "${d.status}"`);
  }
  if (d.results !== undefined) {
    if (!Array.isArray(d.results)) throw new Error('响应格式异常：results 非数组');
    for (const r of d.results) {
      if (!r || typeof r !== 'object' || typeof (r as Record<string, unknown>).url !== 'string') {
        throw new Error('响应格式异常：results[].url 缺失');
      }
    }
  }
  return {
    id: d.id as string,
    status: d.status as string,
    results: (d.results as Array<{ url: string }>) ?? [],
    progress: typeof d.progress === 'number' ? d.progress : undefined,
    error: typeof d.error === 'string' ? d.error : undefined,
  };
}

// ========== HTTP 工具 ==========

interface FetchResult {
  statusCode: number;
  data: unknown;
}

function fetchJson(url: string, options: https.RequestOptions, body?: string): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method: options.method ?? 'GET',
        headers: options.headers ?? {},
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
        res.on('end', () => {
          try {
            const data = JSON.parse(raw);
            resolve({ statusCode: res.statusCode ?? 200, data });
          } catch {
            reject(new Error(`响应 JSON 解析失败: ${raw.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    req.on('error', (e) => reject(e));
    if (body) req.write(body);
    req.end();
  });
}

// ========== 生成请求体构造 ==========

export interface GenerateParams {
  model: string;
  prompt: string;
  images: string[];
  config: Pick<ImageFlowConfig, 'aspectRatio' | 'imageSize' | 'baseUrl'>;
}

export function buildGenerateBody(params: GenerateParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: params.model,
    prompt: params.prompt,
    images: params.images,
    replyType: 'async',
  };

  if (isNanoBanana(params.model)) {
    body.aspectRatio = params.config.aspectRatio;
    body.imageSize = params.config.imageSize;
  } else if (isGptImage2Vip(params.model)) {
    body.aspectRatio = calcVipPixels(params.config.aspectRatio, params.config.imageSize);
  } else {
    // gpt-image-2
    body.aspectRatio = params.config.aspectRatio;
  }

  return body;
}

// ========== API 调用 ==========

/** 提交生成任务，返回 job id */
export async function submitGenerate(
  params: GenerateParams,
  apiKey: string
): Promise<string> {
  const body = buildGenerateBody(params);
  const url = `${params.config.baseUrl}/v1/api/generate`;

  const { statusCode, data } = await fetchJson(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    },
    JSON.stringify(body)
  );

  if (statusCode >= 500 || statusCode === 429) {
    throw new Error(`服务器错误 (${statusCode})`);
  }

  const result = validateResult(data);

  if (result.status === 'failed' || result.status === 'violation') {
    throw new Error(result.error ?? '生成失败');
  }

  if (!result.id) {
    throw new Error('响应不含 id');
  }

  return result.id;
}

/** 查询生成结果 */
export async function queryResult(
  jobId: string,
  baseUrl: string,
  apiKey: string
): Promise<ApiResult> {
  const url = `${baseUrl}/v1/api/result?id=${encodeURIComponent(jobId)}`;
  const { statusCode, data } = await fetchJson(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (statusCode >= 500 || statusCode === 429) {
    throw new Error(`服务器错误 (${statusCode})`);
  }

  return validateResult(data);
}

/** 下载图片到本地 */
export function downloadImage(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, { timeout: TIMEOUT_MS }, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`下载失败: HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => reject(e));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', (e) => reject(e));
  });
}

/** 判断错误是否瞬时（HTTP 5xx / 429 / fetch failed / abort） */
export function isTransientError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('服务器错误 (5') ||
    msg.includes('服务器错误 (429') ||
    msg.includes('请求超时') ||
    msg.includes('ECONNREFUSED') ||
    msg.includes('ENOTFOUND') ||
    msg.includes('EAI_AGAIN') ||
    msg.includes('fetch failed') ||
    msg.includes('abort') ||
    msg.includes('ETIMEDOUT')
  );
}

/** 从 URL 提取扩展名并校验白名单 */
export function extFromUrlSafe(url: string): string {
  return extFromUrl(url);
}
