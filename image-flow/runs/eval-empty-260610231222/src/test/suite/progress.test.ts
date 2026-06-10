// 聚合进度计算测试

import * as assert from 'assert';
import { aggregateProgress, TaskJob } from '../../shared';

suite('aggregateProgress', () => {
  test('全 submitting 为 0', () => {
    const jobs: TaskJob[] = [
      { index: 0, status: 'submitting', progress: 0 },
      { index: 1, status: 'submitting', progress: 0 },
    ];
    assert.strictEqual(aggregateProgress(jobs), 0);
  });

  test('混合态正确计算', () => {
    const jobs: TaskJob[] = [
      { index: 0, status: 'succeeded', progress: 100 },
      { index: 1, status: 'running', progress: 50 },
      { index: 2, status: 'submitting', progress: 0 },
      { index: 3, status: 'failed', progress: 0 },
    ];
    // (100 + 50 + 0 + 100) / 4 = 62.5 → 63
    const p = aggregateProgress(jobs);
    assert.ok(p >= 62 && p <= 63);
  });

  test('全部终结为 100', () => {
    const jobs: TaskJob[] = [
      { index: 0, status: 'succeeded', progress: 100 },
      { index: 1, status: 'failed', progress: 0 },
      { index: 2, status: 'violation', progress: 0 },
    ];
    assert.strictEqual(aggregateProgress(jobs), 100);
  });

  test('空 job 列表为 0', () => {
    assert.strictEqual(aggregateProgress([]), 0);
  });
});
