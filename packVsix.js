const { execSync } = require('child_process');

console.log('Building official VS Code VSIX package via @vscode/vsce...');

// 1. Ensure dist bundle is built
execSync('node esbuild.js', { stdio: 'inherit' });

// 2. Package using official Microsoft VS Code extension packaging tool
try {
  execSync('npx -y @vscode/vsce package --no-dependencies', { stdio: 'inherit' });
  console.log('Successfully packaged valid VS Code VSIX file!');
} catch (err) {
  console.error('Packaging failed:', err);
  process.exit(1);
}
