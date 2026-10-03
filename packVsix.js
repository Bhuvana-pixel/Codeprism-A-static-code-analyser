const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('Building VSIX package...');

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
    <Identity Id="codeprism" Version="1.0.0" Language="en-US" Publisher="codeprism-team" />
    <DisplayName>CodePrism - Intelligent Codebase Intelligence &amp; Visualizer</DisplayName>
    <Description d:getType="null">Google Maps for Codebases: Interactive multi-language codebase analysis, progressive code maps, call graphs, dependency trees, and architectural mapping directly inside VS Code.</Description>
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

const zipPath = path.join(__dirname, 'codeprism-1.0.0.zip');
const vsixPath = path.join(__dirname, 'codeprism-1.0.0.vsix');

if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
if (fs.existsSync(vsixPath)) fs.unlinkSync(vsixPath);

const psCommand = `powershell -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`;
console.log('Zipping into codeprism-1.0.0.zip...');
execSync(psCommand, { stdio: 'inherit' });

fs.renameSync(zipPath, vsixPath);

// Cleanup stage
fs.rmSync(stageDir, { recursive: true, force: true });
console.log('Successfully created updated codeprism-1.0.0.vsix!');
