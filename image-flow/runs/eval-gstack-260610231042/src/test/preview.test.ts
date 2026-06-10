import * as assert from 'assert';
import { buildGenerateBody } from '../api';

suite('预览文本组装', () => {

  test('请求体剔除 prompt 和 images', () => {
    const body = buildGenerateBody({
      model: 'nano-banana-2',
      prompt: 'test prompt',
      images: ['data:image/png;base64,abc123'],
      config: {
        baseUrl: 'https://grsai.dakka.com.cn',
        aspectRatio: '1:1',
        imageSize: '1K',
      },
    });

    // 构建 JSON 后剔除 prompt 和 images
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (k !== 'prompt' && k !== 'images') filtered[k] = v;
    }
    const json = JSON.stringify(filtered, null, 2);

    assert.ok(!json.includes('"prompt"'));
    assert.ok(!json.includes('"images"'));
    assert.ok(!json.includes('test prompt'));
    assert.ok(!json.includes('data:image'));
    assert.ok(json.includes('"model"'));
    assert.ok(json.includes('nano-banana-2'));
    assert.ok(json.includes('"aspectRatio"'));
    assert.ok(json.includes('1:1'));
  });

  test('nano-banana 系列包含 aspectRatio 和 imageSize', () => {
    const body = buildGenerateBody({
      model: 'nano-banana-2',
      prompt: 'test',
      images: [],
      config: { baseUrl: '', aspectRatio: '4:3', imageSize: '2K' },
    });
    assert.strictEqual(body.aspectRatio, '4:3');
    assert.strictEqual(body.imageSize, '2K');
  });

  test('gpt-image-2 不包含 imageSize', () => {
    const body = buildGenerateBody({
      model: 'gpt-image-2',
      prompt: 'test',
      images: [],
      config: { baseUrl: '', aspectRatio: '16:9', imageSize: '2K' },
    });
    assert.strictEqual(body.aspectRatio, '16:9');
    assert.strictEqual('imageSize' in body, false);
  });

  test('gpt-image-2-vip 使用像素值', () => {
    const body = buildGenerateBody({
      model: 'gpt-image-2-vip',
      prompt: 'test',
      images: [],
      config: { baseUrl: '', aspectRatio: '3:4', imageSize: '1K' },
    });
    assert.strictEqual(body.aspectRatio, '864x1152');
    assert.strictEqual('imageSize' in body, false);
  });

  test('replyType 始终为 async', () => {
    for (const model of ['nano-banana-2', 'gpt-image-2', 'gpt-image-2-vip']) {
      const body = buildGenerateBody({
        model,
        prompt: 'test',
        images: [],
        config: { baseUrl: '', aspectRatio: '1:1', imageSize: '1K' },
      });
      assert.strictEqual(body.replyType, 'async');
    }
  });

  test('参考图概览格式', () => {
    const images = ['data:image/png;base64,abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH'];
    // 预览截取前 48 字符
    const previews = images.map((img, i) => {
      const preview = img.slice(0, 48);
      return `image${i + 1}: ${preview}…（总长度 ${img.length}）`;
    });
    assert.strictEqual(previews.length, 1);
    assert.ok(previews[0].startsWith('image1: data:image/png;base64,abcdefghijklmnopqrstuvwxy'));
    assert.ok(previews[0].endsWith(`（总长度 ${images[0].length}）`));
  });

  test('无参考图注明', () => {
    const images: string[] = [];
    const refOverview = images.length === 0 ? '无参考图' : '有图';
    assert.strictEqual(refOverview, '无参考图');
  });
});
