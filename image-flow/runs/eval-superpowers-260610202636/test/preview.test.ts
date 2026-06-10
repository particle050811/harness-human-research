// 测试：预览请求组装
import * as assert from 'assert';
import { buildPreview } from '../src/preview';

suite('Preview', () => {
  test('预览文本包含四段：prompt、URL、参数JSON、参考图概览', () => {
    const result = buildPreview(
      'nano-banana-2',
      '3:4',
      '1K',
      'https://grsai.dakka.com.cn',
      '一只猫',
      [],
      [],
    );

    assert.ok(result.includes('一只猫'), '应包含 prompt');
    assert.ok(result.includes('POST https://grsai.dakka.com.cn/v1/api/generate'), '应包含请求地址');
    assert.ok(result.includes('"model"'), '应包含参数 JSON');
    assert.ok(result.includes('"replyType"'), '应包含 replyType');
    assert.ok(result.includes('---'), '应有分隔符');
  });

  test('无参考图时显示「无参考图」', () => {
    const result = buildPreview(
      'nano-banana-2', '1:1', '1K', 'https://grsai.dakka.com.cn',
      'prompt', [], [],
    );
    assert.ok(result.includes('无参考图'));
  });

  test('有参考图时显示概览', () => {
    const uris = ['data:image/png;base64,abc123def456'];
    const names = ['cat.png'];
    const result = buildPreview(
      'nano-banana-2', '1:1', '1K', 'https://grsai.dakka.com.cn',
      'prompt', uris, names,
    );
    assert.ok(result.includes('image1: data:image/png;base64,abc123def456'));
    assert.ok(result.includes('字符'));
  });

  test('剔除 prompt 和 images 字段：请求参数不包含 prompt', () => {
    const result = buildPreview(
      'gpt-image-2', '16:9', '2K', 'https://grsai.dakka.com.cn',
      'a long prompt about cats', [], [],
    );
    // JSON 部分不应包含 prompt（注意：prompt 在第一段，不在 JSON 里）
    const sections = result.split('\n\n---\n\n');
    const paramsSection = sections[2]; // 第三段是 JSON
    assert.ok(!paramsSection.includes('"prompt"'), 'JSON 参数段不应包含 prompt 字段');
    assert.ok(!paramsSection.includes('"images"'), 'JSON 参数段不应包含 images 字段');
  });

  test('nano-banana 系列包含 aspectRatio 和 imageSize', () => {
    const result = buildPreview(
      'nano-banana-pro', '4:3', '2K', 'https://grsai.dakka.com.cn',
      'test', [], [],
    );
    const sections = result.split('\n\n---\n\n');
    const params = sections[2];
    assert.ok(params.includes('"aspectRatio"'));
    assert.ok(params.includes('"imageSize"'));
  });

  test('gpt-image-2 包含 aspectRatio 但不含 imageSize', () => {
    const result = buildPreview(
      'gpt-image-2', '16:9', '2K', 'https://grsai.dakka.com.cn',
      'test', [], [],
    );
    const sections = result.split('\n\n---\n\n');
    const params = sections[2];
    assert.ok(params.includes('"aspectRatio"'));
    assert.ok(!params.includes('"imageSize"'));
  });

  test('gpt-image-2-vip 使用像素值作为 aspectRatio', () => {
    const result = buildPreview(
      'gpt-image-2-vip', '3:4', '2K', 'https://grsai.dakka.com.cn',
      'test', [], [],
    );
    const sections = result.split('\n\n---\n\n');
    const params = sections[2];
    assert.ok(params.includes('1728x2304'), '应包含像素值 1728x2304');
  });

  test('超长 data URI 截断为 48 字符 + …', () => {
    const longUri = 'data:image/png;base64,' + 'a'.repeat(100);
    const result = buildPreview(
      'nano-banana-2', '1:1', '1K', 'https://grsai.dakka.com.cn',
      'test', [longUri], ['long.png'],
    );
    const sections = result.split('\n\n---\n\n');
    const refs = sections[3];
    // 应出现 "…" 表示截断
    assert.ok(refs.includes('…'), `应包含截断符号，参考图内容: ${refs}`);
    // 总长度标识应显示
    assert.ok(refs.includes('字符'));
  });
});
