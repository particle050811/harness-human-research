// 预览请求：构造与真实请求一致的预览文档
import { VIP_PIXEL_TABLE, isNanoBananaModel, isGptImage2Vip } from './utils';

export interface PreviewParts {
  prompt: string;
  url: string;
  params: string;
  referenceOverview: string;
}

/**
 * 组装完整预览内容
 * @param model 模型
 * @param aspectRatio 比例
 * @param imageSize 分辨率
 * @param baseUrl 节点地址
 * @param finalPrompt 最终提示词（含注入）
 * @param referenceDataUris 参考图 data URI 数组
 * @param referenceFileNames 参考图文件名数组（与 dataUris 对应）
 * @returns 预览文本
 */
export function buildPreview(
  model: string,
  aspectRatio: string,
  imageSize: string,
  baseUrl: string,
  finalPrompt: string,
  referenceDataUris: string[],
  referenceFileNames: string[],
): string {
  // 构建请求体（不含 prompt 和 images 字段）
  const reqBody: Record<string, unknown> = {
    model,
    replyType: 'async',
  };

  if (isNanoBananaModel(model)) {
    reqBody.aspectRatio = aspectRatio;
    reqBody.imageSize = imageSize;
  } else if (isGptImage2Vip(model)) {
    reqBody.aspectRatio = VIP_PIXEL_TABLE[aspectRatio]?.[imageSize] ?? aspectRatio;
  } else {
    // gpt-image-2
    reqBody.aspectRatio = aspectRatio;
  }

  // 参考图概览
  let refOverview: string;
  if (referenceDataUris.length === 0) {
    refOverview = '无参考图';
  } else {
    refOverview = referenceFileNames
      .map((name, i) => {
        const uri = referenceDataUris[i] ?? '';
        const preview = uri.length > 48 ? uri.slice(0, 48) + '…' : uri;
        return `image${i + 1}: ${preview}（${uri.length} 字符）`;
      })
      .join('\n');
  }

  const url = `POST ${baseUrl}/v1/api/generate`;

  return [
    finalPrompt,
    url,
    JSON.stringify(reqBody, null, 2),
    refOverview,
  ].join('\n\n---\n\n');
}
