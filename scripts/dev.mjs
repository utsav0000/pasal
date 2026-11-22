// Development: rebuilds the frontend on change and restarts the API server when server files change.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
spawn(process.execPath, ['scripts/build-web.mjs', '--watch'], { cwd: ROOT, stdio: 'inherit' });
let srv;
const start = () => {
  srv?.kill();
  srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } });
};
let t;
fs.watch(path.join(ROOT, 'server'), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { console.log('↻ restarting server'); start(); }, 150); });
start();
