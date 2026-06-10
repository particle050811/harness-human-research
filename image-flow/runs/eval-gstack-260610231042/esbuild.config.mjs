import esbuild from 'esbuild';
import { existsSync, mkdirSync } from 'fs';

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

if (!existsSync('dist')) mkdirSync('dist', { recursive: true });
if (!existsSync('media')) mkdirSync('media', { recursive: true });

const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
};

const webviewConfig = {
  entryPoints: ['webview/index.tsx'],
  bundle: true,
  outfile: 'media/sidebar.js',
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  jsx: 'automatic',
  sourcemap: !isProduction,
  minify: isProduction,
  logLevel: 'info',
};

if (isWatch) {
  const extCtx = await esbuild.context(extensionConfig);
  const wvCtx = await esbuild.context(webviewConfig);
  await extCtx.watch();
  await wvCtx.watch();
  console.log('[esbuild] watching for changes...');
} else {
  await esbuild.build(extensionConfig);
  await esbuild.build(webviewConfig);
  console.log('[esbuild] build complete');
}
