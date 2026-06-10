import * as assert from 'assert';
import { calcProgress, formatDuration } from '../shared';

suite('聚合进度计算', () => {

  test('全 submitting 态 → 0%', () => {
    const jobs = [
      { status: 'submitting', progress: 0 },
      { status: 'submitting', progress: 0 },
    ];
    assert.strictEqual(calcProgress(jobs), 0);
  });

  test('混合态：1 running 50% + 1 succeeded → 75%', () => {
    const jobs = [
      { status: 'running', progress: 50 },
      { status: 'succeeded', progress: 100 },
    ];
    assert.strictEqual(calcProgress(jobs), 75);
  });

  test('混合态：1 running 0% + 1 succeeded + 1 submitting → 33%', () => {
    const jobs = [
      { status: 'running', progress: 0 },
      { status: 'succeeded', progress: 100 },
      { status: 'submitting', progress: 0 },
    ];
    assert.strictEqual(calcProgress(jobs), 33);
  });

  test('全部终结 → 100%', () => {
    const jobs = [
      { status: 'succeeded', progress: 100 },
      { status: 'succeeded', progress: 100 },
      { status: 'succeeded', progress: 100 },
    ];
    assert.strictEqual(calcProgress(jobs), 100);
  });

  test('含 failed 的混合态', () => {
    const jobs = [
      { status: 'succeeded', progress: 100 },
      { status: 'failed', progress: 0 },
      { status: 'running', progress: 50 },
    ];
    assert.strictEqual(calcProgress(jobs), 50);
  });

  test('单个 running 50% → 50%', () => {
    const jobs = [
      { status: 'running', progress: 50 },
    ];
    assert.strictEqual(calcProgress(jobs), 50);
  });

  test('空数组 → 0%', () => {
    assert.strictEqual(calcProgress([]), 0);
  });
});

suite('formatDuration', () => {
  test('小于 1 分钟', () => {
    assert.strictEqual(formatDuration(30000), '00:30');
    assert.strictEqual(formatDuration(5000), '00:05');
  });

  test('1 分钟以上', () => {
    assert.strictEqual(formatDuration(65000), '01:05');
    assert.strictEqual(formatDuration(125000), '02:05');
  });

  test('1 小时以上', () => {
    assert.strictEqual(formatDuration(3600000), '1:00:00');
    assert.strictEqual(formatDuration(3665000), '1:01:05');
  });

  test('零/负数 → 00:00', () => {
    assert.strictEqual(formatDuration(0), '00:00');
    assert.strictEqual(formatDuration(-1000), '00:00');
  });
});
