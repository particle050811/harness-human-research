// 预览文本组装测试

import * as assert from 'assert';
import { buildFinalPrompt } from '../../markdownParser';

suite('buildFinalPrompt', () => {
  test('三段均有时正确拼接', () => {
    const result = buildFinalPrompt(
      '原始正文',
      '注入句',
      'IMAGES.md 内容',
    );
    assert.ok(result.includes('注入句'));
    assert.ok(result.includes('IMAGES.md 内容'));
    assert.ok(result.includes('原始正文'));
    // 空行分隔
    const lines = result.split('\n');
    assert.ok(lines.some(l => l === ''));
  });

  test('注入句为空时省略', () => {
    const result = buildFinalPrompt('正文', '', null);
    assert.strictEqual(result, '正文');
  });

  test('IMAGES.md 为 null 时省略', () => {
    const result = buildFinalPrompt('正文', '注入', null);
    assert.strictEqual(result, '注入\n\n正文');
  });

  test('IMAGES.md 为空串时省略', () => {
    const result = buildFinalPrompt('正文', '注入', '');
    assert.strictEqual(result, '注入\n\n正文');
  });

  test('全部为空时返回空串', () => {
    const result = buildFinalPrompt('', '', null);
    assert.strictEqual(result, '');
  });
});
