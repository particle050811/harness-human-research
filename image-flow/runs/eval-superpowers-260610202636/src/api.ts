// Grsai API 客户端（使用 Node.js 18+ 内置 fetch）

export interface GenerateRequest {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  images: string[]; // data URI 数组
  aspectRatio?: string;
  imageSize?: string;
  replyType: 'async';
}

export interface GenerateResponse {
  id: string;
  status: 'running' | 'succeeded' | 'failed' | 'violation';
  results?: Array<{ url: string }>;
  progress?: number;
  error?: string;
}

export interface ResultQuery {
  baseUrl: string;
  apiKey: string;
  jobId: string;
}

const TIMEOUT_MS = 30_000;

function createAbortController(): AbortController {
  return new AbortController();
}

/** POST /v1/api/generate — 提交生成任务 */
export async function submitGenerate(req: GenerateRequest): Promise<GenerateResponse> {
  const controller = createAbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    images: req.images,
    replyType: 'async',
  };

  // 按模型系列区分尺寸字段
  if (req.aspectRatio) {
    body.aspectRatio = req.aspectRatio;
  }
  if (req.imageSize && req.model.startsWith('nano-banana')) {
    body.imageSize = req.imageSize;
  }

  try {
    const response = await fetch(`${req.baseUrl}/v1/api/generate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const json = await response.json() as Record<string, unknown>;

    // 运行时校验
    if (!json || typeof json !== 'object') {
      throw new Error(`生成接口返回格式异常: ${JSON.stringify(json)}`);
    }
    if (json.status === 'failed' || json.status === 'violation') {
      return {
        id: (json.id as string) ?? '',
        status: json.status as GenerateResponse['status'],
        error: (json.error as string) ?? '未知错误',
      };
    }
    if (!json.id || !json.status) {
      throw new Error(`生成接口返回缺少 id/status: ${JSON.stringify(json)}`);
    }
    if (!['running', 'succeeded', 'failed', 'violation'].includes(json.status as string)) {
      throw new Error(`生成接口返回未知状态: ${json.status}`);
    }

    return {
      id: String(json.id),
      status: json.status as GenerateResponse['status'],
      results: json.results as Array<{ url: string }> | undefined,
      progress: typeof json.progress === 'number' ? json.progress as number : undefined,
      error: json.error as string | undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** GET /v1/api/result — 查询异步任务结果 */
export async function queryResult(query: ResultQuery): Promise<GenerateResponse> {
  const controller = createAbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${query.baseUrl}/v1/api/result?id=${encodeURIComponent(query.jobId)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${query.apiKey}`,
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // 5xx / 429 视为瞬时错误，抛出以便上层重试
    if (response.status >= 500 || response.status === 429) {
      throw new Error(`查询接口 HTTP ${response.status}`);
    }

    const json = await response.json() as Record<string, unknown>;

    // 运行时校验
    if (!json || typeof json !== 'object') {
      throw new Error(`查询接口返回格式异常: ${JSON.stringify(json)}`);
    }

    const status = json.status as string;
    if (!status || !['running', 'succeeded', 'failed', 'violation'].includes(status)) {
      throw new Error(`查询接口返回未知状态: ${status}, body=${JSON.stringify(json)}`);
    }

    return {
      id: String((json.id as string) ?? query.jobId),
      status: status as GenerateResponse['status'],
      results: json.results as Array<{ url: string }> | undefined,
      progress: typeof json.progress === 'number' ? json.progress as number : undefined,
      error: json.error as string | undefined,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
