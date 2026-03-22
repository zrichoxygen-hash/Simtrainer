import fs from 'fs';
import path from 'path';

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

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('Missing OPENAI_API_KEY');
  process.exit(1);
}

const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    input: 'Reponds uniquement: API_OK'
  })
});

const raw = await response.text();
console.log('STATUS', response.status);
console.log(raw.slice(0, 600));
