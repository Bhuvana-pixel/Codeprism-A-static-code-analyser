const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

function copyStaticAssets() {
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }
  fs.copyFileSync('src/webview/styles.css', 'dist/styles.css');
  fs.copyFileSync('src/webview/index.html', 'dist/index.html');
}

async function main() {
  copyStaticAssets();

  // Build Extension Host Bundle
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  // Build Webview Script Bundle
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/app.ts'],
    bundle: true,
    format: 'iife',
    minify: false,
    sourcemap: true,
    platform: 'browser',
    outfile: 'dist/webviewApp.js',
    logLevel: 'info',
  });

  const vscodeMockPlugin = {
    name: 'vscode-mock',
    setup(build) {
      build.onResolve({ filter: /^vscode$/ }, args => ({
        path: args.path,
        namespace: 'vscode-mock-ns',
      }));
      build.onLoad({ filter: /.*/, namespace: 'vscode-mock-ns' }, () => ({
        contents: `module.exports = {
          window: { showInformationMessage: () => {}, showErrorMessage: () => {} },
          workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
          CancellationTokenSource: class { token = {}; }
        };`,
        loader: 'js',
      }));
    },
  };

  // Build Test Runner Bundle
  const testCtx = await esbuild.context({
    entryPoints: ['test/runTests.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    platform: 'node',
    outfile: 'dist/testRunner.js',
    plugins: [vscodeMockPlugin],
    logLevel: 'info',
  });

  if (watch) {
    await extCtx.watch();
    await webviewCtx.watch();
    await testCtx.watch();
    console.log('Watching for changes...');
  } else {
    await extCtx.rebuild();
    await webviewCtx.rebuild();
    await testCtx.rebuild();
    await extCtx.dispose();
    await webviewCtx.dispose();
    await testCtx.dispose();
    console.log('Build completed successfully.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
