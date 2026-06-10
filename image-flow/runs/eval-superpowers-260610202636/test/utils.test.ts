// 测试：工具函数
import * as assert from 'assert';
import { isTransientHttpError, isTransientError, VIP_PIXEL_TABLE, formatDuration, dedupErrors, getExtFromUrl } from '../src/utils';

suite('Utils', () => {
  suite('Transient Error Detection', () => {
    test('HTTP 5xx 视为瞬时错误', () => {
      assert.strictEqual(isTransientHttpError(500), true);
      assert.strictEqual(isTransientHttpError(502), true);
      assert.strictEqual(isTransientHttpError(503), true);
      assert.strictEqual(isTransientHttpError(599), true);
    });

    test('HTTP 429 视为瞬时错误', () => {
      assert.strictEqual(isTransientHttpError(429), true);
    });

    test('HTTP 4xx（非 429）不是瞬时错误', () => {
      assert.strictEqual(isTransientHttpError(400), false);
      assert.strictEqual(isTransientHttpError(401), false);
      assert.strictEqual(isTransientHttpError(404), false);
    });

    test('HTTP 2xx 不是瞬时错误', () => {
      assert.strictEqual(isTransientHttpError(200), false);
    });

    test('fetch failed / abort / timeout 视为瞬时错误', () => {
      assert.strictEqual(isTransientError(new Error('fetch failed')), true);
      assert.strictEqual(isTransientError(new Error('The operation was aborted')), true);
      assert.strictEqual(isTransientError(new Error('Request timed out')), true);
    });

    test('普通 Error 不是瞬时错误', () => {
      assert.strictEqual(isTransientError(new Error('Something went wrong')), false);
    });

    test('格式错误不是瞬时错误', () => {
      assert.strictEqual(isTransientError(new Error('查询接口返回格式异常')), false);
    });

    test('null/undefined 不是瞬时错误', () => {
      assert.strictEqual(isTransientError(null), false);
      assert.strictEqual(isTransientError(undefined), false);
    });
  });

  suite('VIP Pixel Table', () => {
    test('1:1 分辨率', () => {
      assert.strictEqual(VIP_PIXEL_TABLE['1:1']['1K'], '1024x1024');
      assert.strictEqual(VIP_PIXEL_TABLE['1:1']['2K'], '2048x2048');
      assert.strictEqual(VIP_PIXEL_TABLE['1:1']['4K'], '2880x2880');
    });

    test('3:4 分辨率', () => {
      assert.strictEqual(VIP_PIXEL_TABLE['3:4']['1K'], '864x1152');
      assert.strictEqual(VIP_PIXEL_TABLE['3:4']['4K'], '2304x3072');
    });

    test('16:9 4K 符合约束（总像素 ≤ 8,294,400）', () => {
      const [w, h] = VIP_PIXEL_TABLE['16:9']['4K'].split('x').map(Number);
      assert.ok(w * h <= 8_294_400);
      assert.ok(w <= 3840 && h <= 3840);
      assert.strictEqual(w % 16, 0);
      assert.strictEqual(h % 16, 0);
    });

    test('9:16 分辨率', () => {
      assert.strictEqual(VIP_PIXEL_TABLE['9:16']['1K'], '768x1344');
      assert.strictEqual(VIP_PIXEL_TABLE['9:16']['2K'], '1536x2688');
    });
  });

  suite('formatDuration', () => {
    test('小于一小时显示 mm:ss', () => {
      assert.strictEqual(formatDuration(0), '00:00');
      assert.strictEqual(formatDuration(65_000), '01:05');
      assert.strictEqual(formatDuration(600_000), '10:00');
      assert.strictEqual(formatDuration(3_599_000), '59:59');
    });

    test('超过一小时显示 h:mm:ss', () => {
      assert.strictEqual(formatDuration(3_600_000), '1:00:00');
      assert.strictEqual(formatDuration(3_665_000), '1:01:05');
    });
  });

  suite('dedupErrors', () => {
    test('去重保留顺序', () => {
      const result = dedupErrors(['a', 'b', 'a', 'c', 'b']);
      assert.strictEqual(result, 'a\nb\nc');
    });

    test('过滤空字符串', () => {
      const result = dedupErrors(['a', '', 'b', '']);
      assert.strictEqual(result, 'a\nb');
    });

    test('空数组返回空字符串', () => {
      assert.strictEqual(dedupErrors([]), '');
    });
  });

  suite('getExtFromUrl', () => {
    test('标准 URL 提取扩展名', () => {
      assert.strictEqual(getExtFromUrl('https://example.com/image.png'), 'png');
      assert.strictEqual(getExtFromUrl('https://example.com/photo.jpg?size=large'), 'jpg');
      assert.strictEqual(getExtFromUrl('https://example.com/img.webp'), 'webp');
    });

    test('非图片扩展名回退 png', () => {
      assert.strictEqual(getExtFromUrl('https://example.com/video.mp4'), 'png');
      assert.strictEqual(getExtFromUrl('https://example.com/file.pdf'), 'png');
    });
  });

  suite('Aggregate Progress Calculation', () => {
    // 模拟 calcProgress 逻辑
    function calcProgress(jobs: Array<{ status: string; progress?: number }>): number {
      if (jobs.length === 0) { return 0; }
      let total = 0;
      for (const j of jobs) {
        if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation') {
          total += 100;
        } else if (j.status === 'running') {
          total += j.progress ?? 0;
        }
        // submitting → 0
      }
      return Math.round(total / jobs.length);
    }

    test('全部 submitting → 0%', () => {
      const jobs = [
        { status: 'submitting' },
        { status: 'submitting' },
      ];
      assert.strictEqual(calcProgress(jobs), 0);
    });

    test('混合态：1 running(50%) + 1 submitting → 25%', () => {
      const jobs = [
        { status: 'running', progress: 50 },
        { status: 'submitting' },
      ];
      assert.strictEqual(calcProgress(jobs), 25);
    });

    test('全部终结 → 100%', () => {
      const jobs = [
        { status: 'succeeded' },
        { status: 'failed' },
        { status: 'violation' },
      ];
      assert.strictEqual(calcProgress(jobs), 100);
    });

    test('部分终结：2 succeeded + 1 running(60%) → (200+60)/3 ≈ 87%', () => {
      const jobs = [
        { status: 'succeeded' },
        { status: 'succeeded' },
        { status: 'running', progress: 60 },
      ];
      assert.strictEqual(calcProgress(jobs), 87);
    });

    test('空 jobs → 0%', () => {
      assert.strictEqual(calcProgress([]), 0);
    });
  });
});
