/**
 * image-flow 单元测试
 * 覆盖：图片语法解析、聚合进度、瞬时错误判定、像素换算、预览文本组装
 */

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseMarkdown, isContentEmpty } from '../src/markdown';
import { computeAggregateProgress } from '../src/utils';
import { getVipPixelSize, isTransientError, isTransientStatus } from '../src/api';
import { buildPreviewText } from '../src/preview';

// 用于创建测试用的最小 PNG（1×1 像素）
const MINI_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
function miniPngBuffer(): Buffer { return Buffer.from(MINI_PNG_B64, 'base64'); }

// ─── 1. 图片语法解析与替换 ──────────────────────────

suite('parseMarkdown', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-flow-test-'));
    fs.writeFileSync(path.join(tmpDir, 'a.png'), miniPngBuffer());
    fs.writeFileSync(path.join(tmpDir, 'b.png'), miniPngBuffer());
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('普通路径 ![alt](a.png)', () => {
    const res = parseMarkdown('![test](a.png)', tmpDir);
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].originalPath, 'a.png');
    assert.strictEqual(res.refs[0].baseName, 'a');
    assert.ok(res.refs[0].dataUri.startsWith('data:image/png;base64,'));
    assert.strictEqual(res.body, '[image1](a)');
  });

  test('尖括号路径含空格 ![alt](<path with spaces.png>)', () => {
    const name = 'path with spaces.png';
    fs.writeFileSync(path.join(tmpDir, name), miniPngBuffer());
    const res = parseMarkdown(`![alt](<${name}>)`, tmpDir);
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].originalPath, name);
    assert.strictEqual(res.body, '[image1](path with spaces)');
  });

  test('尖括号路径含括号 ![alt](<img (1).png>)', () => {
    const name = 'img (1).png';
    fs.writeFileSync(path.join(tmpDir, name), miniPngBuffer());
    const res = parseMarkdown(`![alt](<${name}>)`, tmpDir);
    assert.strictEqual(res.refs.length, 1);
    assert.strictEqual(res.refs[0].originalPath, name);
  });

  test('重复引用复用编号', () => {
    const res = parseMarkdown('![a](a.png) ![b](a.png) ![c](b.png) ![d](a.png)', tmpDir);
    assert.strictEqual(res.refs.length, 2); // 只有两张不同
    assert.strictEqual(res.body, '[image1](a) [image1](a) [image2](b) [image1](a)');
  });

  test('编号与首次出现顺序一致', () => {
    const res = parseMarkdown('![b](b.png) ![a](a.png) ![c](b.png)', tmpDir);
    assert.strictEqual(res.refs[0].originalPath, 'b.png');
    assert.strictEqual(res.refs[1].originalPath, 'a.png');
    assert.strictEqual(res.body, '[image1](b) [image2](a) [image1](b)');
  });

  test('参考图读取失败报错', () => {
    assert.throws(() => {
      parseMarkdown('![x](missing.png)', tmpDir);
    }, /参考图读取失败/);
  });

  test('内容为空判断', () => {
    assert.strictEqual(isContentEmpty(''), true);
    assert.strictEqual(isContentEmpty('  \n  '), true);
    assert.strictEqual(isContentEmpty('hello'), false);
  });
});

// ─── 2. 聚合进度计算 ────────────────────────────────

suite('computeAggregateProgress', () => {
  test('全 submitting 返回 0', () => {
    assert.strictEqual(computeAggregateProgress([
      { status: 'submitting', progress: 0 },
      { status: 'submitting', progress: 0 },
    ]), 0);
  });

  test('混合态正确均摊', () => {
    // 1 succeeded (100) + 1 running (50) + 1 submitting (0) = 150/3 = 50
    assert.strictEqual(computeAggregateProgress([
      { status: 'succeeded', progress: 100 },
      { status: 'running', progress: 50 },
      { status: 'submitting', progress: 0 },
    ]), 50);
  });

  test('全部终结返回 100', () => {
    assert.strictEqual(computeAggregateProgress([
      { status: 'succeeded', progress: 100 },
      { status: 'failed', progress: 0 },
      { status: 'violation', progress: 0 },
    ]), 33); // 1 succeeded out of 3 = 100/3 ≈ 33
  });

  test('全部 succeeded 返回 100', () => {
    assert.strictEqual(computeAggregateProgress([
      { status: 'succeeded', progress: 100 },
      { status: 'succeeded', progress: 100 },
    ]), 100);
  });

  test('空数组返回 0', () => {
    assert.strictEqual(computeAggregateProgress([]), 0);
  });
});

// ─── 3. 瞬时错误判定 ────────────────────────────────

suite('瞬时错误判定', () => {
  test('5xx 为瞬时', () => {
    assert.strictEqual(isTransientStatus(500), true);
    assert.strictEqual(isTransientStatus(502), true);
    assert.strictEqual(isTransientStatus(503), true);
  });

  test('429 为瞬时', () => {
    assert.strictEqual(isTransientStatus(429), true);
  });

  test('AbortError / fetch failed 为瞬时', () => {
    assert.strictEqual(isTransientError(new Error('AbortError: timeout')), true);
    assert.strictEqual(isTransientError('fetch failed'), true);
  });

  test('格式错误非瞬时', () => {
    assert.strictEqual(isTransientStatus(400), false);
    assert.strictEqual(isTransientStatus(200), false);
    assert.strictEqual(isTransientError(new Error('Unexpected JSON')), false);
  });
});

// ─── 4. gpt-image-2-vip 像素换算 ─────────────────────

suite('getVipPixelSize', () => {
  test('3:4 + 1K → 864x1152', () => {
    assert.strictEqual(getVipPixelSize('3:4', '1K'), '864x1152');
  });

  test('1:1 + 2K → 1440x1440', () => {
    assert.strictEqual(getVipPixelSize('1:1', '2K'), '1440x1440');
  });

  test('16:9 + 4K → 2688x1536', () => {
    assert.strictEqual(getVipPixelSize('16:9', '4K'), '2688x1536');
  });

  test('9:16 + 1K → 768x1344', () => {
    assert.strictEqual(getVipPixelSize('9:16', '1K'), '768x1344');
  });

  test('4:3 + 2K → 1664x1248', () => {
    assert.strictEqual(getVipPixelSize('4:3', '2K'), '1664x1248');
  });

  test('不支持的比例抛出错误', () => {
    assert.throws(() => getVipPixelSize('21:9', '1K'));
  });

  test('不支持的分辨率抛出错误', () => {
    assert.throws(() => getVipPixelSize('1:1', '8K'));
  });
});

// ─── 5. 预览文本组装 ────────────────────────────────

suite('buildPreviewText', () => {
  test('基本结构包含四段', () => {
    const text = buildPreviewText({
      finalPrompt: '一只猫',
      baseUrl: 'https://example.com',
      paramsForDisplay: { model: 'nano-banana-2', replyType: 'json' },
      refs: [],
    });
    assert.ok(text.includes('# 预览请求'));
    assert.ok(text.includes('## 最终提示词'));
    assert.ok(text.includes('一只猫'));
    assert.ok(text.includes('## 请求地址'));
    assert.ok(text.includes('POST https://example.com/v1/api/generate'));
    assert.ok(text.includes('## 请求参数（已剔除 prompt 与 images）'));
    assert.ok(text.includes('## 参考图概览'));
    assert.ok(text.includes('无参考图'));
  });

  test('已剔除 prompt 与 images 字段', () => {
    const text = buildPreviewText({
      finalPrompt: 'test',
      baseUrl: 'https://x.com',
      paramsForDisplay: { model: 'x', replyType: 'json', images: [], prompt: 'hidden' },
      refs: [],
    });
    assert.ok(!text.includes('prompt'));
    assert.ok(!text.includes('images'));
  });

  test('有参考图时显示概览', () => {
    const text = buildPreviewText({
      finalPrompt: 'test',
      baseUrl: 'https://x.com',
      paramsForDisplay: {},
      refs: [{ dataUri: 'data:image/png;base64,AAAA', originalPath: 'a.png', baseName: 'a' }],
    });
    assert.ok(text.includes('image1: data:image/png;base64,AAAA…（28 字符）'));
  });
});
