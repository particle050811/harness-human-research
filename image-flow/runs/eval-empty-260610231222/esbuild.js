const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
  metafile: true,
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['media/sidebar.tsx'],
  bundle: true,
  platform: 'browser',
  target: 'es2020',
  format: 'iife',
  outfile: 'media/sidebar.js',
  sourcemap: true,
  minify: false,
  metafile: true,
};

async function build() {
  try {
    const results = await Promise.all([
      esbuild.build(extConfig),
      esbuild.build(webviewConfig),
    ]);
    if (!isWatch) {
      for (const r of results) {
        console.log(await esbuild.analyzeMetafile(r.metafile));
      }
    }
    console.log('Build succeeded.');
  } catch (e) {
    console.error('Build failed:', e);
    process.exit(1);
  }
}

(async () => {
  if (isWatch) {
    const ctxExt = await esbuild.context(extConfig);
    const ctxWebview = await esbuild.context(webviewConfig);
    await Promise.all([ctxExt.watch(), ctxWebview.watch()]);
    console.log('Watching for changes...');
  } else {
    build();
  }
})();
