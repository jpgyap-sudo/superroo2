import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('=== SuperRoo Webview Diagnostic ===\n');

// Check 1: Webview build files
console.log('1. Checking webview build files...');
const webviewBuildPath = path.join(__dirname, '..', 'src', 'webview-ui', 'build');
const distWebviewPath = path.join(__dirname, '..', 'src', 'dist', 'webview-ui', 'build');

const files = [
  { name: 'index.html', path: path.join(webviewBuildPath, 'index.html') },
  { name: 'index.js', path: path.join(webviewBuildPath, 'assets', 'index.js') },
  { name: 'index.css', path: path.join(webviewBuildPath, 'assets', 'index.css') },
];

files.forEach(f => {
  const exists = fs.existsSync(f.path);
  const size = exists ? fs.statSync(f.path).size : 0;
  console.log(`  ${f.name}: ${exists ? `EXISTS (${size} bytes)` : 'MISSING'}`);
});

// Check 2: Dist folder
console.log('\n2. Checking dist folder...');
const distFiles = [
  { name: 'extension.js', path: path.join(__dirname, '..', 'src', 'dist', 'extension.js') },
  { name: 'index.html', path: path.join(distWebviewPath, 'index.html') },
];

distFiles.forEach(f => {
  const exists = fs.existsSync(f.path);
  const size = exists ? fs.statSync(f.path).size : 0;
  console.log(`  ${f.name}: ${exists ? `EXISTS (${size} bytes)` : 'MISSING'}`);
});

// Check 3: Check index.html content
console.log('\n3. Checking index.html content...');
const indexPath = path.join(webviewBuildPath, 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const hasScript = html.includes('<script');
  const hasRoot = html.includes('id="root"');
  console.log(`  Has script tag: ${hasScript}`);
  console.log(`  Has root element: ${hasRoot}`);
  console.log(`  Content preview:\n${html.substring(0, 200)}...`);
}

// Check 4: Check extension.js for webview handlers
console.log('\n4. Checking extension.js for webview handlers...');
const extPath = path.join(__dirname, '..', 'src', 'dist', 'extension.js');
if (fs.existsSync(extPath)) {
  const ext = fs.readFileSync(extPath, 'utf8');
  const hasWebviewHandler = ext.includes('webviewMessageHandler');
  const hasPostState = ext.includes('postStateToWebview');
  const hasGetHtml = ext.includes('getHtmlContent');
  console.log(`  Has webviewMessageHandler: ${hasWebviewHandler}`);
  console.log(`  Has postStateToWebview: ${hasPostState}`);
  console.log(`  Has getHtmlContent: ${hasGetHtml}`);
}

// Check 5: Check assets in dist
console.log('\n5. Checking assets in dist...');
const assetsPath = path.join(__dirname, '..', 'src', 'dist', 'assets');
if (fs.existsSync(assetsPath)) {
  const codicons = fs.existsSync(path.join(assetsPath, 'codicons', 'codicon.css'));
  const images = fs.existsSync(path.join(assetsPath, 'images'));
  console.log(`  codicons: ${codicons ? 'EXISTS' : 'MISSING'}`);
  console.log(`  images: ${images ? 'EXISTS' : 'MISSING'}`);
}

console.log('\n=== Diagnostic Complete ===');
console.log('\nTo test the webview:');
console.log('1. Press F5 in VS Code to launch Extension Development Host');
console.log('2. Open SuperRoo sidebar');
console.log('3. Help > Toggle Developer Tools > Console tab');
console.log('4. View > Output > Select "SuperRoo" for extension logs');