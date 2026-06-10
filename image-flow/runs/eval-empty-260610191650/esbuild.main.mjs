import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  outfile: 'dist/extension.js',
  sourcemap: true,
  target: 'es2022',
});

if (isWatch) {
  await ctx.watch();
  console.log('[esbuild] 主进程 watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[esbuild] 主进程构建完成 → dist/extension.js');
}
