// 图片语法解析与替换测试

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { parseMarkdown } from '../../markdownParser';

suite('markdownParser', () => {
  let tmpDir: string;

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-flow-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createImage(name: string): string {
    // 创建一个 1x1 PNG 的最小有效文件
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, png);
    return p;
  }

  test('普通图片路径解析', () => {
    createImage('test.png');
    const result = parseMarkdown('Hello ![alt](test.png) world', tmpDir);
    assert.strictEqual(result.images.length, 1);
    assert.ok(result.images[0].startsWith('data:image/png;base64,'));
    assert.ok(result.body.includes('[image1]'));
  });

  test('尖括号路径（含空格）', () => {
    createImage('my image.png');
    const result = parseMarkdown('Look ![pic](<my image.png>) here', tmpDir);
    assert.strictEqual(result.images.length, 1);
    assert.ok(result.images[0].startsWith('data:image/png;base64,'));
  });

  test('尖括号路径（含括号）', () => {
    createImage('pic(1).png');
    const result = parseMarkdown('See ![x](<pic(1).png>)', tmpDir);
    assert.strictEqual(result.images.length, 1);
  });

  test('重复引用复用编号', () => {
    createImage('a.png');
    const result = parseMarkdown('![1](a.png) and ![2](a.png)', tmpDir);
    assert.strictEqual(result.images.length, 1);
    assert.strictEqual(result.imageMap.get('a.png'), 1);
    // 两处都应替换为 image1
    const matches = result.body.match(/\[image1\]/g);
    assert.strictEqual(matches?.length, 2);
  });

  test('多个不同图片编号递增', () => {
    createImage('a.png');
    createImage('b.png');
    const result = parseMarkdown('![1](a.png) ![2](b.png)', tmpDir);
    assert.strictEqual(result.images.length, 2);
    assert.strictEqual(result.imageMap.get('a.png'), 1);
    assert.strictEqual(result.imageMap.get('b.png'), 2);
  });

  test('编号与参考图数组顺序一致', () => {
    createImage('first.png');
    createImage('second.png');
    createImage('third.png');
    const result = parseMarkdown('![a](first.png) ![b](second.png) ![c](third.png)', tmpDir);
    assert.strictEqual(result.images.length, 3);
    assert.ok(result.body.includes('[image1]'));
    assert.ok(result.body.includes('[image2]'));
    assert.ok(result.body.includes('[image3]'));
    // body 中 image1 在 image2 之前
    const i1 = result.body.indexOf('[image1]');
    const i2 = result.body.indexOf('[image2]');
    const i3 = result.body.indexOf('[image3]');
    assert.ok(i1 < i2);
    assert.ok(i2 < i3);
  });

  test('参考图读取失败抛出错误', () => {
    assert.throws(() => {
      parseMarkdown('![x](nonexistent.png)', tmpDir);
    }, /参考图读取失败/);
  });

  test('无图片的正文原样保留', () => {
    const result = parseMarkdown('Hello world', tmpDir);
    assert.strictEqual(result.images.length, 0);
    assert.strictEqual(result.body, 'Hello world');
  });
});
