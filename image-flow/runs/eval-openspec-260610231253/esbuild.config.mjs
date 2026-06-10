import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

/** @type {esbuild.BuildOptions} */
const extConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: true,
  minify: false,
};

/** @type {esbuild.BuildOptions} */
const sidebarConfig = {
  entryPoints: ['media/sidebar.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  outfile: 'media/sidebar.js',
  sourcemap: true,
  minify: false,
};

async function main() {
  if (isWatch) {
    const extCtx = await esbuild.context(extConfig);
    const sidebarCtx = await esbuild.context(sidebarConfig);
    await Promise.all([extCtx.watch(), sidebarCtx.watch()]);
    console.log('watching...');
  } else {
    await Promise.all([
      esbuild.build(extConfig),
      esbuild.build(sidebarConfig),
    ]);
    console.log('build complete');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
