import * as assert from 'assert';
import type { JobState } from '../src/shared';

/** 聚合进度计算（纯函数，提取自任务逻辑便于测试） */
export function aggregateProgress(jobs: JobState[]): number {
  if (jobs.length === 0) return 0;
  const total = jobs.reduce((sum, j) => {
    if (j.status === 'succeeded' || j.status === 'failed' || j.status === 'violation') return sum + 100;
    if (j.status === 'running') return sum + (j.progress || 0);
    return sum; // submitting → 0
  }, 0);
  return Math.round(total / jobs.length);
}

suite('aggregateProgress', () => {

  test('全部 submitting → 0', () => {
    const jobs: JobState[] = [
      { index: 1, id: null, status: 'submitting', progress: 0, error: null, images: [] },
      { index: 2, id: null, status: 'submitting', progress: 0, error: null, images: [] },
    ];
    assert.strictEqual(aggregateProgress(jobs), 0);
  });

  test('混合态：1 succeeded + 1 submitting + 1 running(50%)', () => {
    const jobs: JobState[] = [
      { index: 1, id: 'a', status: 'succeeded', progress: 100, error: null, images: ['a.png'] },
      { index: 2, id: null, status: 'submitting', progress: 0, error: null, images: [] },
      { index: 3, id: 'b', status: 'running', progress: 50, error: null, images: [] },
    ];
    // (100 + 0 + 50) / 3 = 50
    assert.strictEqual(aggregateProgress(jobs), 50);
  });

  test('全部终结 → 100', () => {
    const jobs: JobState[] = [
      { index: 1, id: 'a', status: 'succeeded', progress: 100, error: null, images: ['a.png'] },
      { index: 2, id: 'b', status: 'failed', progress: 0, error: 'error', images: [] },
      { index: 3, id: 'c', status: 'violation', progress: 0, error: 'violation', images: [] },
    ];
    assert.strictEqual(aggregateProgress(jobs), 100);
  });

  test('空数组 → 0', () => {
    assert.strictEqual(aggregateProgress([]), 0);
  });

  test('running 带不同进度', () => {
    const jobs: JobState[] = [
      { index: 1, id: 'a', status: 'running', progress: 30, error: null, images: [] },
      { index: 2, id: 'b', status: 'running', progress: 70, error: null, images: [] },
    ];
    // (30 + 70) / 2 = 50
    assert.strictEqual(aggregateProgress(jobs), 50);
  });

});
