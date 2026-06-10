import * as assert from 'assert';
import { extractImageRefs, parseMarkdown } from '../parser';

suite('图片语法解析与替换', () => {

  test('普通路径解析', () => {
    const md = 'hello ![cat](images/cat.png) world ![dog](dogs/dog.jpg) end';
    const refs = extractImageRefs(md);
    assert.strictEqual(refs.length, 2);
    assert.strictEqual(refs[0].imagePath, 'images/cat.png');
    assert.strictEqual(refs[0].num, 1);
    assert.strictEqual(refs[1].imagePath, 'dogs/dog.jpg');
    assert.strictEqual(refs[1].num, 2);
  });

  test('尖括号路径（含空格和括号）', () => {
    const md = '![img](<my images (1)/photo (copy).png>) text ![x](normal.png)';
    const refs = extractImageRefs(md);
    assert.strictEqual(refs.length, 2);
    assert.strictEqual(refs[0].imagePath, 'my images (1)/photo (copy).png');
    assert.strictEqual(refs[0].num, 1);
    assert.strictEqual(refs[1].imagePath, 'normal.png');
    assert.strictEqual(refs[1].num, 2);
  });

  test('重复引用复用编号', () => {
    const md = '![a](a.png) ![b](b.png) ![a2](a.png) ![c](c.png) ![b2](b.png)';
    const refs = extractImageRefs(md);
    assert.strictEqual(refs.length, 5);
    assert.strictEqual(refs[0].num, 1); // a.png → 1
    assert.strictEqual(refs[1].num, 2); // b.png → 2
    assert.strictEqual(refs[2].num, 1); // a.png → 复用 1
    assert.strictEqual(refs[3].num, 3); // c.png → 3
    assert.strictEqual(refs[4].num, 2); // b.png → 复用 2
  });

  test('替换文本：编号正确替换', () => {
    const md = 'start ![a](img/a.png) middle ![b](img/b.png) end';
    const result = parseMarkdown(md);
    assert.strictEqual(result.text, 'start [image1](a) middle [image2](b) end');
  });

  test('替换文本：重复引用保持编号', () => {
    const md = '![a](a.png) ![b](b.png) ![a2](a.png)';
    const result = parseMarkdown(md);
    assert.strictEqual(result.text, '[image1](a) [image2](b) [image1](a)');
  });

  test('无图片引用返回原文本', () => {
    const md = 'just some text **bold** no images';
    const result = parseMarkdown(md);
    assert.strictEqual(result.text, md);
    assert.strictEqual(result.refs.length, 0);
  });

  test('尖括号路径替换后保留正确引用', () => {
    const md = 'pre ![img](<path with spaces.png>) post';
    const result = parseMarkdown(md);
    assert.strictEqual(result.text, 'pre [image1](path with spaces) post');
    assert.strictEqual(result.refs[0].imagePath, 'path with spaces.png');
    assert.strictEqual(result.refs[0].num, 1);
  });
});
