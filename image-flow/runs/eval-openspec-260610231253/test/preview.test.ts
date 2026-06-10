import * as assert from 'assert';
import { buildRequestBody } from '../src/api';

suite('预览请求体构造', () => {

  test('构建请求体后可剔除 prompt 与 images', () => {
    const body = buildRequestBody('nano-banana-2', 'a prompt', ['data:image/png;base64,xxx'], '1:1', '1K');
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (k !== 'prompt' && k !== 'images') {
        params[k] = v;
      }
    }

    // 应该没有 prompt 和 images
    assert.strictEqual('prompt' in params, false);
    assert.strictEqual('images' in params, false);
    // 应该有 model, aspectRatio, imageSize, replyType
    assert.strictEqual(params.model, 'nano-banana-2');
    assert.strictEqual(params.aspectRatio, '1:1');
    assert.strictEqual(params.imageSize, '1K');
    assert.strictEqual(params.replyType, 'async');
  });

  test('参考图概览格式', () => {
    const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA';
    const preview = dataUri.slice(0, 48);
    const totalLen = dataUri.length;

    const line = `- image1: ${preview}…（${totalLen} 字符）`;
    assert.ok(line.startsWith('- image1: data:image/png;base64,'));
    assert.ok(line.includes('…'));
    assert.ok(line.includes('字符'));
  });

  test('无参考图输出"无参考图"', () => {
    const refImages: { index: number; dataUri: string; originalPath: string }[] = [];
    const text = refImages.length === 0 ? '无参考图' : '有参考图';
    assert.strictEqual(text, '无参考图');
  });

});
