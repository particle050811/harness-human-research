// gpt-image-2-vip 像素换算测试

import * as assert from 'assert';
import { vipPixelSize } from '../../shared';

suite('vipPixelSize', () => {
  test('3:4 + 1K → 864x1152', () => {
    assert.strictEqual(vipPixelSize('3:4', '1K'), '864x1152');
  });

  test('3:4 + 2K → 1728x2304', () => {
    assert.strictEqual(vipPixelSize('3:4', '2K'), '1728x2304');
  });

  test('3:4 + 4K → 3456x4608', () => {
    assert.strictEqual(vipPixelSize('3:4', '4K'), '3456x4608');
  });

  test('1:1 + 1K → 1024x1024', () => {
    assert.strictEqual(vipPixelSize('1:1', '1K'), '1024x1024');
  });

  test('16:9 + 1K → 1792x1024', () => {
    assert.strictEqual(vipPixelSize('16:9', '1K'), '1792x1024');
  });

  test('9:16 + 2K → 2048x3584', () => {
    assert.strictEqual(vipPixelSize('9:16', '2K'), '2048x3584');
  });

  test('4:3 + 2K → 2304x1728', () => {
    assert.strictEqual(vipPixelSize('4:3', '2K'), '2304x1728');
  });

  test('1:1 + 4K → 4096x4096', () => {
    assert.strictEqual(vipPixelSize('1:1', '4K'), '4096x4096');
  });
});
