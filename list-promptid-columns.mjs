import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
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

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const p = JSON.parse(value);
    if (typeof p === 'string') {
      try { return JSON.parse(p); } catch { return p; }
    }
    return p;
  } catch {
    return fallback;
  }
}

function parseRows(text) {
  const obj = parseMaybeJson(text, {});
  const t = (obj?.result?.content || []).find((x) => typeof x?.text === 'string')?.text || text;
  const tObj = parseMaybeJson(t, {});
  if (tObj?.error?.message) throw new Error(tObj.error.message);
  const wrapped = parseMaybeJson(t, null);
  const resultText = wrapped && typeof wrapped.result === 'string' ? wrapped.result : String(t);
  const m = resultText.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-[^>]+>/);
  const payload = m?.[1] || resultText;
  const first = payload.indexOf('[');
  const last = payload.lastIndexOf(']');
  if (first === -1 || last === -1) return [];
  return parseMaybeJson(payload.slice(first, last + 1), []);
}

loadEnv();
const url = process.env.SUPABASE_MCP_URL;
const token = process.env.SUPABASE_MCP_AUTH;

const init = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'list-cols', version: '1.0.0' } } })
});
const sid = init.headers.get('mcp-session-id');
await init.text();

const sql = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': sid || '' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'sql', method: 'tools/call', params: { name: 'execute_sql', arguments: { query: "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='promptid' ORDER BY ordinal_position;" } } })
});

const raw = await sql.text();
const rows = parseRows(raw);
console.log(JSON.stringify(rows, null, 2));
