const esbuild = require('esbuild');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !isProduction,
  minify: isProduction,
  metafile: true,
};

/** @type {esbuild.BuildOptions} */
const sidebarConfig = {
  entryPoints: ['media/sidebar.tsx'],
  bundle: true,
  outfile: 'media/sidebar.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: !isProduction,
  minify: isProduction,
  metafile: true,
  define: {
    'process.env.NODE_ENV': isProduction ? '"production"' : '"development"',
  },
};

async function build() {
  try {
    const [extResult, sidebarResult] = await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(sidebarConfig),
    ]);

    if (!isWatch) {
      const extText = await esbuild.analyzeMetafile(extResult.metafile);
      console.log('Extension bundle analysis:\n', extText);
      const sidebarText = await esbuild.analyzeMetafile(sidebarResult.metafile);
      console.log('Sidebar bundle analysis:\n', sidebarText);
    }
  } catch (err) {
    console.error('Build failed:', err);
    process.exit(1);
  }
}

if (isWatch) {
  const ctx = esbuild.context({
    ...extensionConfig,
    plugins: [],
  });
  // Watch mode handled via separate contexts
  console.log('Watch mode not yet implemented for dual builds');
  build();
} else {
  build();
}
