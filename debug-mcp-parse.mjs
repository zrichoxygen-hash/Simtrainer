import fs from 'fs';
import path from 'path';

function parseMaybeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const attempts = [trimmed, trimmed.replace(/^"|"$/g, '')];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === 'string') {
        try {
          return JSON.parse(parsed);
        } catch {
          return parsed;
        }
      }
      return parsed;
    } catch {}
  }
  return fallback;
}

function toArray(v) { return Array.isArray(v) ? v : []; }

function parseRowsFromMcpToolText(text) {
  const maybeWrapped = parseMaybeJson(text, null);
  const normalizedText =
    maybeWrapped && typeof maybeWrapped === 'object' && typeof maybeWrapped.result === 'string'
      ? maybeWrapped.result
      : text;

  const taggedMatch = normalizedText.match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-[^>]+>/);
  const payload = taggedMatch?.[1]?.trim() || normalizedText;
  const firstBracket = payload.indexOf('[');
  const lastBracket = payload.lastIndexOf(']');
  if (firstBracket === -1 || lastBracket === -1 || lastBracket < firstBracket) return [];
  const jsonArray = payload.slice(firstBracket, lastBracket + 1);
  return toArray(parseMaybeJson(jsonArray, []));
}

const cwd = process.cwd();
const envPath = path.join(cwd, '.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i === -1) continue;
  const k = t.slice(0, i).trim();
  const v = t.slice(i + 1).trim();
  if (!process.env[k]) process.env[k] = v;
}

const url = process.env.SUPABASE_MCP_URL;
const token = process.env.SUPABASE_MCP_AUTH;

const init = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'init', method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'dbg', version: '1.0.0' } } })
});
const sid = init.headers.get('mcp-session-id');
await init.text();

const sql = await fetch(url, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'Mcp-Session-Id': sid },
  body: JSON.stringify({ jsonrpc: '2.0', id: 'sql', method: 'tools/call', params: { name: 'execute_sql', arguments: { query: "SELECT id, prompt_id, titre FROM public.promptid WHERE LOWER(COALESCE(actif::text, 'true')) IN ('true', 't', '1', 'yes', 'y', 'on') ORDER BY created_at DESC NULLS LAST, idx ASC NULLS LAST;" } } })
});

const raw = await sql.text();
const payload = parseMaybeJson(raw, {});
const textItem = toArray(payload?.result?.content).find((x) => x?.type === 'text')?.text || '';
const rows1 = parseRowsFromMcpToolText(textItem);
const rows2 = parseRowsFromMcpToolText(raw);

console.log('RAW first 600:\n', raw.slice(0, 600));
console.log('\nTEXTITEM first 600:\n', String(textItem).slice(0, 600));
console.log('\nROWS_FROM_TEXTITEM:\n', JSON.stringify(rows1, null, 2));
console.log('\nROWS_FROM_RAW:\n', JSON.stringify(rows2, null, 2));
