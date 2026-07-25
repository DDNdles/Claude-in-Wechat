#!/usr/bin/env node
/**
 * Claude in WeChat — Installer Build Script
 * Wraps electron-builder for Windows NSIS packaging.
 *
 * Usage: node scripts/build-installer.js [--publish]
 */

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PUBLISH = process.argv.includes('--publish');

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

console.log('');
console.log(bold('Claude in WeChat — Installer Builder'));
console.log('='.repeat(50));
console.log('');

// Step 1: Check pre-reqs
console.log(bold('1. Checking prerequisites...'));
console.log('-'.repeat(40));

const nodeVersion = process.version;
console.log(`  Node.js: ${nodeVersion}`);

try {
  execSync('npm --version', { encoding: 'utf-8' });
  console.log(`  npm: OK`);
} catch {
  console.log(red('  npm: NOT FOUND'));
  process.exit(1);
}

// Step 2: Install dependencies
console.log('');
console.log(bold('2. Installing dependencies...'));
console.log('-'.repeat(40));

try {
  if (!existsSync(path.join(ROOT, 'node_modules'))) {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  } else {
    console.log('  node_modules already exists, skipping');
  }
} catch (err) {
  console.log(red(`  Install failed: ${err.message}`));
  process.exit(1);
}

// Step 3: Build
console.log('');
console.log(bold('3. Building application...'));
console.log('-'.repeat(40));

try {
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  console.log(green('  Build successful'));
} catch (err) {
  console.log(red(`  Build failed: ${err.message}`));
  process.exit(1);
}

// Step 4: Package with electron-builder
console.log('');
console.log(bold('4. Packaging installer...'));
console.log('-'.repeat(40));

const targetArg = '--win';
const publishArg = PUBLISH ? '--publish always' : '';

try {
  execSync(`npx electron-builder ${targetArg} ${publishArg}`, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production' },
  });
} catch (err) {
  console.log(red(`  Packaging failed: ${err.message}`));
  process.exit(1);
}

// Step 5: Summary
console.log('');
console.log(bold('Build complete!'));
console.log('='.repeat(50));
console.log('');

const releaseDir = path.join(ROOT, 'release');
if (existsSync(releaseDir)) {
  const fs = await import('node:fs');
  const files = fs.readdirSync(releaseDir).filter(f => f.endsWith('.exe'));
  if (files.length > 0) {
    console.log(green(`Installer: release/${files[0]}`));
  }
}

if (PUBLISH) {
  console.log(yellow('Published to GitHub Releases (if configured)'));
} else {
  console.log('To publish to GitHub, run with --publish flag');
}
console.log('');
