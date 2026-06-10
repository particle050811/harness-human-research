import * as assert from 'assert';
import { isTransientError } from '../api';
import { calcVipPixels } from '../shared';

suite('瞬时错误判定', () => {

  test('HTTP 5xx 为瞬时错误', () => {
    assert.strictEqual(isTransientError(new Error('服务器错误 (500)')), true);
    assert.strictEqual(isTransientError(new Error('服务器错误 (502)')), true);
    assert.strictEqual(isTransientError(new Error('服务器错误 (503)')), true);
  });

  test('HTTP 429 为瞬时错误', () => {
    assert.strictEqual(isTransientError(new Error('服务器错误 (429)')), true);
  });

  test('fetch failed 为瞬时错误', () => {
    assert.strictEqual(isTransientError(new Error('fetch failed')), true);
  });

  test('abort/超时为瞬时错误', () => {
    assert.strictEqual(isTransientError(new Error('请求超时')), true);
    assert.strictEqual(isTransientError(new Error('abort')), true);
  });

  test('ECONNREFUSED 为瞬时错误', () => {
    assert.strictEqual(isTransientError(new Error('ECONNREFUSED')), true);
    assert.strictEqual(isTransientError(new Error('ETIMEDOUT')), true);
  });

  test('格式错误非瞬时', () => {
    assert.strictEqual(isTransientError(new Error('响应格式异常：缺少 id')), false);
    assert.strictEqual(isTransientError(new Error('响应 JSON 解析失败')), false);
    assert.strictEqual(isTransientError(new Error('something else')), false);
  });
});

suite('gpt-image-2-vip 像素换算', () => {

  test('1:1 + 1K', () => {
    const result = calcVipPixels('1:1', '1K');
    const [w, h] = result.split('x').map(Number);
    assert.strictEqual(w, 1008);
    assert.strictEqual(h, 1008);
    assert.ok(w % 16 === 0 && h % 16 === 0);
  });

  test('3:4 + 1K → 864x1152', () => {
    const result = calcVipPixels('3:4', '1K');
    assert.strictEqual(result, '864x1152');
  });

  test('4:3 + 1K', () => {
    const result = calcVipPixels('4:3', '1K');
    const [w, h] = result.split('x').map(Number);
    assert.ok(Math.abs(w / h - 4 / 3) < 0.02);
    assert.ok(w % 16 === 0 && h % 16 === 0);
  });

  test('16:9 + 2K', () => {
    const result = calcVipPixels('16:9', '2K');
    const [w, h] = result.split('x').map(Number);
    assert.ok(Math.abs(w / h - 16 / 9) < 0.02);
    assert.ok(w % 16 === 0 && h % 16 === 0);
    // 2K ~4MP
    assert.ok(w * h >= 3_800_000 && w * h <= 4_200_000);
  });

  test('9:16 + 4K', () => {
    const result = calcVipPixels('9:16', '4K');
    const [w, h] = result.split('x').map(Number);
    assert.ok(Math.abs(w / h - 9 / 16) < 0.02);
    assert.ok(w % 16 === 0 && h % 16 === 0);
    // 4K ~16MP, max side 3840
    assert.ok(w <= 3840 && h <= 3840);
  });

  test('所有结果均为 16 的倍数', () => {
    const ratios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    const sizes = ['1K', '2K', '4K'];
    for (const r of ratios) {
      for (const s of sizes) {
        const result = calcVipPixels(r, s);
        const [w, h] = result.split('x').map(Number);
        assert.ok(w % 16 === 0, `${r} ${s}: width ${w} not multiple of 16`);
        assert.ok(h % 16 === 0, `${r} ${s}: height ${h} not multiple of 16`);
      }
    }
  });
});
