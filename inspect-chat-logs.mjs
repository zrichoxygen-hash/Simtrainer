import fs from 'fs';
import path from 'path';

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

const initResp = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'init-1',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'inspect-logs', version: '1.0.0' }
    }
  })
});

const sessionId = initResp.headers.get('mcp-session-id');
await initResp.text();

const query = `
SELECT conversation_id, user_id, promptid, conversation_status,
       jsonb_array_length(COALESCE(stage_evaluations, '[]'::jsonb)) AS stage_eval_count,
       LENGTH(COALESCE(full_conversation_transcript, '')) AS transcript_length,
       prompt_evaluateur,
       etapes,
       criterea_with_coefficient,
       updated_at
FROM public.conversation_chat_logs
ORDER BY updated_at DESC
LIMIT 3;
`;

const sqlResp = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Session-Id': sessionId || ''
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 'sql-1',
    method: 'tools/call',
    params: {
      name: 'execute_sql',
      arguments: { query }
    }
  })
});

const raw = await sqlResp.text();
console.log('STATUS', sqlResp.status);
console.log(raw.slice(0, 3500));
