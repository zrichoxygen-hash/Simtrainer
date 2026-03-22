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

const url = process.env.SUPABASE_MCP_URL;
const token = process.env.SUPABASE_MCP_AUTH;

const initPayload = {
  jsonrpc: '2.0',
  id: 'init-1',
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'simventes-debug-client',
      version: '1.0.0'
    }
  }
};

const initResp = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  },
  body: JSON.stringify(initPayload)
});

const sessionId = initResp.headers.get('mcp-session-id');
const initText = await initResp.text();
console.log('INIT_STATUS', initResp.status);
console.log('SESSION', sessionId || 'none');
console.log(initText.slice(0, 500));

const payload = {
  jsonrpc: '2.0',
  id: '2',
  method: 'tools/call',
  params: {
    name: 'execute_sql',
    arguments: {
      query: 'SELECT id, prompt_id, titre, actif FROM public.promptid ORDER BY created_at DESC NULLS LAST LIMIT 3;'
    }
  }
};

const r = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'Mcp-Session-Id': sessionId || ''
  },
  body: JSON.stringify(payload)
});

const text = await r.text();
console.log('STATUS', r.status);
console.log(text.slice(0, 3000));
