import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}

const mod = await import(pathToFileURL(path.join(cwd, 'workflow-sdk.mjs')).href);
const rows = await mod.listPromptOptions();
console.log(JSON.stringify(rows, null, 2));
