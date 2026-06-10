import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['media/sidebar.tsx'],
  tsconfig: 'tsconfig.webview.json',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  globalName: 'ImageFlow',
  outfile: 'media/sidebar.js',
  sourcemap: false,
  target: 'es2022',
  minify: false,
});

console.log('[esbuild] webview 构建完成 → media/sidebar.js');
