const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building VSIX package...');

// Read package.json metadata
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
const pkgName = pkg.name || 'codeprism-static-analyzer';
const pkgVersion = pkg.version || '1.0.0';
const pkgDisplayName = pkg.displayName || 'CodePrism - Static Code Analyzer & Visualizer';
const pkgPublisher = pkg.publisher || 'codeprism-team';
const pkgDescription = pkg.description || '';

// 1. Ensure dist is built
execSync('node esbuild.js', { stdio: 'inherit' });

// 2. Prepare temporary directory structure
const stageDir = path.join(__dirname, 'vsix_stage');
const extDir = path.join(stageDir, 'extension');

if (fs.existsSync(stageDir)) {
  fs.rmSync(stageDir, { recursive: true, force: true });
}

fs.mkdirSync(extDir, { recursive: true });

// Copy essential extension files into stage/extension/
const filesToCopy = ['package.json', 'README.md', 'LICENSE', 'DETAILED_DESIGN.md'];
filesToCopy.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, path.join(extDir, file));
  }
});

// Copy directories
const dirsToCopy = ['dist', 'media'];
dirsToCopy.forEach(dir => {
  if (fs.existsSync(dir)) {
    fs.cpSync(dir, path.join(extDir, dir), { recursive: true });
  }
});

// Create minimal VSIX manifests
const contentTypesXml = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json" />
  <Default Extension=".vsixmanifest" ContentType="text/xml" />
  <Default Extension=".js" ContentType="application/javascript" />
  <Default Extension=".css" ContentType="text/css" />
  <Default Extension=".html" ContentType="text/html" />
  <Default Extension=".png" ContentType="image/png" />
  <Default Extension=".svg" ContentType="image/svg+xml" />
  <Default Extension=".md" ContentType="text/markdown" />
</Types>`;

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/win/2012/08/package-manifest" xmlns:d="http://schemas.microsoft.com/win/2012/08/package-manifest-metadata">
  <Metadata>
    <Identity Id="${pkgName}" Version="${pkgVersion}" Language="en-US" Publisher="${pkgPublisher}" />
    <DisplayName>${pkgDisplayName.replace(/&/g, '&amp;')}</DisplayName>
    <Description d:getType="null">${pkgDescription.replace(/&/g, '&amp;')}</Description>
    <Icon>extension/media/icon.png</Icon>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" Version="[1.75.0,)" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
  </Assets>
</PackageManifest>`;

fs.writeFileSync(path.join(stageDir, '[Content_Types].xml'), contentTypesXml);
fs.writeFileSync(path.join(stageDir, 'extension.vsixmanifest'), vsixManifest);

const zipPath = path.join(__dirname, `${pkgName}-${pkgVersion}.zip`);
const vsixPath = path.join(__dirname, `${pkgName}-${pkgVersion}.vsix`);

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (fs.existsSync(vsixPath)) fs.unlinkSync(vsixPath);

const psCommand = `powershell -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`;
console.log(`Zipping into ${pkgName}-${pkgVersion}.zip...`);
execSync(psCommand, { stdio: 'inherit' });

fs.renameSync(zipPath, vsixPath);

// Cleanup stage
fs.rmSync(stageDir, { recursive: true, force: true });
console.log(`Successfully created updated ${pkgName}-${pkgVersion}.vsix!`);
