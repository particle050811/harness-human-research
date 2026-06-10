// 测试：Markdown 图片语法解析与替换
import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseMarkdown } from '../src/markdown-parser';

suite('Markdown Parser', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-flow-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createImage(name: string): string {
    // 创建一个最小的 PNG 文件
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, png);
    return filePath;
  }

  test('空内容（trim 后）应触发内容为空逻辑', () => {
    // parseMarkdown 本身不检查空内容，调用方负责
    // 此处验证解析不会崩溃
    const result = parseMarkdown('', tmpDir);
    assert.strictEqual(result.body, '');
    assert.strictEqual(result.references.length, 0);
  });

  test('无图片语法：正文原样返回', () => {
    const input = '一只猫在阳光下睡觉';
    const result = parseMarkdown(input, tmpDir);
    assert.strictEqual(result.body, '一只猫在阳光下睡觉');
    assert.strictEqual(result.references.length, 0);
  });

  test('普通路径：解析并替换', () => {
    createImage('cat.png');
    const input = '看这张 ![猫](cat.png) 图片';
    const result = parseMarkdown(input, tmpDir);
    assert.strictEqual(result.body, '看这张 [image1](cat) 图片');
    assert.strictEqual(result.references.length, 1);
    assert.strictEqual(result.references[0].index, 1);
    assert.ok(result.references[0].dataUri.startsWith('data:image/png;base64,'));
  });

  test('尖括号路径（含空格和括号）：正确解析', () => {
    createImage('my image (test).png');
    const input = '![图](<my image (test).png>) 描述';
    const result = parseMarkdown(input, tmpDir);
    assert.strictEqual(result.body, '[image1](my image (test)) 描述');
    assert.strictEqual(result.references.length, 1);
    assert.strictEqual(result.references[0].index, 1);
  });

  test('重复引用复用同一编号', () => {
    createImage('cat.png');
    const input = '![a](cat.png) 和 ![b](cat.png)';
    const result = parseMarkdown(input, tmpDir);
    // 两处引用用同一编号 1
    assert.strictEqual(result.body, '[image1](cat) 和 [image1](cat)');
    assert.strictEqual(result.references.length, 1);
    assert.strictEqual(result.references[0].index, 1);
  });

  test('多张参考图：编号顺序与首次出现一致', () => {
    createImage('cat.png');
    createImage('dog.jpg');
    const input = '![c](cat.png) 然后 ![d](dog.jpg)';
    const result = parseMarkdown(input, tmpDir);
    assert.strictEqual(result.body, '[image1](cat) 然后 [image2](dog)');
    assert.strictEqual(result.references.length, 2);
    assert.strictEqual(result.references[0].index, 1);
    assert.strictEqual(result.references[1].index, 2);
  });

  test('参考图读取失败：抛出错误并列出所有失败路径', () => {
    const input = '![a](nonexistent1.png) 和 ![b](nonexistent2.jpg)';
    assert.throws(() => {
      parseMarkdown(input, tmpDir);
    }, (err: Error) => {
      return err.message.includes('nonexistent1.png') && err.message.includes('nonexistent2.jpg');
    });
  });

  test('混合已存在和不存在图片：应全部失败', () => {
    createImage('cat.png');
    const input = '![a](cat.png) ![b](nonexistent.png)';
    assert.throws(() => {
      parseMarkdown(input, tmpDir);
    }, (err: Error) => {
      return err.message.includes('nonexistent.png');
    });
  });
});
