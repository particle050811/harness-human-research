// 测试套件入口

import * as path from 'path';
import * as fs from 'fs';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
  const testsRoot = path.resolve(__dirname);

  return new Promise((resolve, reject) => {
    // 递归查找 .test.js 文件
    const testFiles = findTestFiles(testsRoot);
    for (const f of testFiles) {
      mocha.addFile(path.resolve(testsRoot, f));
    }

    try {
      mocha.run((failures: number) => {
        if (failures > 0) reject(new Error(`${failures} tests failed.`));
        else resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}

function findTestFiles(dir: string, baseDir?: string): string[] {
  if (!baseDir) baseDir = dir;
  const files: string[] = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...findTestFiles(full, baseDir));
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        files.push(path.relative(baseDir, full));
      }
    }
  } catch {
    // ignore
  }
  return files;
}
