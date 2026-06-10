import * as assert from 'assert';
import * as path from 'path';
import { parseMarkdown, mimeFromExt } from '../src/parser';

const fixturesDir = path.resolve(__dirname, '..', '..', '..', 'test', 'fixtures');

suite('parseMarkdown', () => {

  test('普通路径图片语法替换', () => {
    const result = parseMarkdown('![cat](cat.png)', fixturesDir);
    assert.strictEqual(result.body, '[image1](cat)');
    assert.strictEqual(result.refImages.length, 1);
    assert.strictEqual(result.refImages[0].index, 1);
    assert.strictEqual(result.refImages[0].originalPath, 'cat.png');
  });

  test('尖括号路径（含空格）', () => {
    const result = parseMarkdown('![dog](<my dog.png>)', fixturesDir);
    assert.strictEqual(result.body, '[image1](my dog)');
    assert.strictEqual(result.refImages.length, 1);
    assert.strictEqual(result.refImages[0].originalPath, 'my dog.png');
  });

  test('尖括号路径（含括号）', () => {
    const result = parseMarkdown('![pic](<image (1).png>)', fixturesDir);
    assert.strictEqual(result.refImages[0].originalPath, 'image (1).png');
  });

  test('重复引用复用同一编号', () => {
    const content = '![a](cat.png) ![b](cat.png) ![c](dog.png)';
    const result = parseMarkdown(content, fixturesDir);
    const expected = '[image1](cat) [image1](cat) [image2](dog)';
    assert.strictEqual(result.body, expected);
    assert.strictEqual(result.refImages.length, 2);
  });

  test('编号与引用数组顺序一致', () => {
    const content = '![a](a.png) ![b](b.png) ![c](c.png)';
    const result = parseMarkdown(content, fixturesDir);
    assert.strictEqual(result.refImages[0].index, 1);
    assert.strictEqual(result.refImages[0].originalPath, 'a.png');
    assert.strictEqual(result.refImages[1].index, 2);
    assert.strictEqual(result.refImages[1].originalPath, 'b.png');
    assert.strictEqual(result.refImages[2].index, 3);
    assert.strictEqual(result.refImages[2].originalPath, 'c.png');
  });

  test('data URI 格式正确', () => {
    const result = parseMarkdown('![a](cat.png)', fixturesDir);
    assert.ok(result.refImages[0].dataUri.startsWith('data:image/'));
    assert.ok(result.refImages[0].dataUri.includes(';base64,'));
  });

  test('不存在的文件抛出 REF_FAIL 错误', () => {
    assert.throws(() => {
      parseMarkdown('![x](nonexistent.png)', fixturesDir);
    }, /REF_FAIL/);
  });

});

suite('mimeFromExt', () => {
  test('已知扩展名返回正确 MIME', () => {
    assert.strictEqual(mimeFromExt('png'), 'image/png');
    assert.strictEqual(mimeFromExt('jpg'), 'image/jpeg');
    assert.strictEqual(mimeFromExt('jpeg'), 'image/jpeg');
    assert.strictEqual(mimeFromExt('gif'), 'image/gif');
    assert.strictEqual(mimeFromExt('webp'), 'image/webp');
    assert.strictEqual(mimeFromExt('svg'), 'image/svg+xml');
  });

  test('未知扩展名回退 png', () => {
    assert.strictEqual(mimeFromExt('xyz'), 'image/png');
  });
});
