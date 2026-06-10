// VS Code Test CLI 配置
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  label: 'unitTests',
  files: 'out/test/**/*.test.js',
  mocha: {
    timeout: 10000,
  },
});
