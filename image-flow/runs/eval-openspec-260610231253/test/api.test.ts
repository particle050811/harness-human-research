import * as assert from 'assert';
import { isTransientError, isValidResponse, vipPixelSize, buildRequestBody } from '../src/api';

suite('isTransientError', () => {

  test('HTTP 5xx 为瞬时错误', () => {
    assert.strictEqual(isTransientError('HTTP 500'), true);
    assert.strictEqual(isTransientError('HTTP 502'), true);
    assert.strictEqual(isTransientError('HTTP 503'), true);
  });

  test('HTTP 429 为瞬时错误', () => {
    assert.strictEqual(isTransientError('HTTP 429'), true);
  });

  test('fetch failed / abort 为瞬时错误', () => {
    assert.strictEqual(isTransientError('fetch failed'), true);
    assert.strictEqual(isTransientError('abort'), true);
    assert.strictEqual(isTransientError('AbortError'), true);
    assert.strictEqual(isTransientError('The operation was aborted'), true);
  });

  test('格式错误非瞬时', () => {
    assert.strictEqual(isTransientError('响应格式异常'), false);
    assert.strictEqual(isTransientError('Unexpected token'), false);
    assert.strictEqual(isTransientError(''), false);
  });

  test('HTTP 4xx 非 429 非瞬时', () => {
    assert.strictEqual(isTransientError('HTTP 400'), false);
    assert.strictEqual(isTransientError('HTTP 404'), false);
  });

});

suite('isValidResponse', () => {

  test('合法 succeeded 响应', () => {
    assert.strictEqual(isValidResponse({
      id: '123', status: 'succeeded', results: [{ url: 'http://example.com/a.png' }],
    }), true);
  });

  test('合法 running 响应', () => {
    assert.strictEqual(isValidResponse({
      id: '456', status: 'running', progress: 50,
    }), true);
  });

  test('缺少 id 不合法', () => {
    assert.strictEqual(isValidResponse({ status: 'succeeded' }), false);
  });

  test('状态不在枚举不合法', () => {
    assert.strictEqual(isValidResponse({ id: '1', status: 'unknown' }), false);
  });

  test('空对象不合法', () => {
    assert.strictEqual(isValidResponse({}), false);
  });

  test('null 不合法', () => {
    assert.strictEqual(isValidResponse(null), false);
  });

  test('results 格式错误不合法', () => {
    assert.strictEqual(isValidResponse({
      id: '1', status: 'succeeded', results: [{ notUrl: true }],
    }), false);
  });

});

suite('vipPixelSize', () => {

  test('1:1 + 1K → 1024x1024', () => {
    assert.strictEqual(vipPixelSize('1:1', '1K'), '1024x1024');
  });

  test('1:1 + 2K → 2048x2048', () => {
    assert.strictEqual(vipPixelSize('1:1', '2K'), '2048x2048');
  });

  test('16:9 + 1K → 1344x768', () => {
    assert.strictEqual(vipPixelSize('16:9', '1K'), '1344x768');
  });

  test('9:16 + 1K → 768x1344', () => {
    assert.strictEqual(vipPixelSize('9:16', '1K'), '768x1344');
  });

  test('3:4 + 1K → 864x1152', () => {
    assert.strictEqual(vipPixelSize('3:4', '1K'), '864x1152');
  });

  test('3:4 + 4K → 3456x4608', () => {
    assert.strictEqual(vipPixelSize('3:4', '4K'), '3456x4608');
  });

  test('未知组合回退默认值', () => {
    assert.strictEqual(vipPixelSize('99:99', '8K'), '864x1152');
  });

});

suite('buildRequestBody', () => {

  test('nano-banana 系列传 aspectRatio + imageSize', () => {
    const body = buildRequestBody('nano-banana-2', 'test prompt', [], '1:1', '2K');
    assert.strictEqual(body.aspectRatio, '1:1');
    assert.strictEqual(body.imageSize, '2K');
  });

  test('gpt-image-2 只传 aspectRatio', () => {
    const body = buildRequestBody('gpt-image-2', 'test', [], '16:9', '2K');
    assert.strictEqual(body.aspectRatio, '16:9');
    assert.strictEqual(body.imageSize, undefined);
  });

  test('gpt-image-2-vip 传像素值', () => {
    const body = buildRequestBody('gpt-image-2-vip', 'test', [], '1:1', '2K');
    assert.strictEqual(body.aspectRatio, '2048x2048');
    assert.strictEqual(body.imageSize, undefined);
  });

});
