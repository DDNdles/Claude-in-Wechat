// Copy preload.cjs to dist-electron so Electron can find it in production
'use strict';
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'electron', 'preload.cjs');
const dest = path.join(__dirname, '..', 'dist-electron', 'preload.cjs');

fs.cpSync(src, dest);
console.log('✅ preload.cjs copied to dist-electron/');