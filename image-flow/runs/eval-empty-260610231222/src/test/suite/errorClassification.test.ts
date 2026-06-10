// 瞬时错误判定测试

import * as assert from 'assert';
import { isTransientError } from '../../shared';

suite('isTransientError', () => {
  test('HTTP 5xx 是瞬时错误', () => {
    assert.strictEqual(isTransientError('HTTP 500: Internal Server Error'), true);
    assert.strictEqual(isTransientError('HTTP 502'), true);
    assert.strictEqual(isTransientError('HTTP 503 Service Unavailable'), true);
  });

  test('HTTP 429 是瞬时错误', () => {
    assert.strictEqual(isTransientError('HTTP 429: Too Many Requests'), true);
  });

  test('abort 是瞬时错误', () => {
    assert.strictEqual(isTransientError('AbortError: The operation was aborted'), true);
    assert.strictEqual(isTransientError('fetch aborted'), true);
  });

  test('fetch failed 是瞬时错误', () => {
    assert.strictEqual(isTransientError('fetch failed'), true);
    assert.strictEqual(isTransientError('TypeError: fetch failed'), true);
  });

  test('timeout 是瞬时错误', () => {
    assert.strictEqual(isTransientError('timeout of 30000ms exceeded'), true);
  });

  test('格式错误非瞬时', () => {
    assert.strictEqual(isTransientError('无效的 API 响应（非对象）'), false);
  });

  test('HTTP 400 非瞬时', () => {
    assert.strictEqual(isTransientError('HTTP 400: Bad Request'), false);
  });

  test('普通字符串非瞬时', () => {
    assert.strictEqual(isTransientError('some random error'), false);
  });
});
