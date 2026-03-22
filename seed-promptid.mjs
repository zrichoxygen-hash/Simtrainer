import fs from 'fs';
import path from 'path';

function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
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

function escapeSql(value) {
  return String(value ?? '').replace(/'/g, "''");
}

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'string') {
      try {
        return JSON.parse(parsed);
      } catch {
        return parsed;
      }
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function parseRowsFromMcpText(text) {
  const wrapped = parseMaybeJson(text, null);
  const normalized = wrapped && typeof wrapped.result === 'string' ? wrapped.result : text;

  const tagged = String(normalized).match(/<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-[^>]+>/);
  const payload = tagged?.[1]?.trim() || String(normalized);

  const first = payload.indexOf('[');
  const last = payload.lastIndexOf(']');
  if (first === -1 || last === -1 || last < first) return [];

  return parseMaybeJson(payload.slice(first, last + 1), []);
}

async function mcpInitialize(url, token) {
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
        clientInfo: { name: 'seed-promptid', version: '1.0.0' }
      }
    })
  });

  const sessionId = initResp.headers.get('mcp-session-id');
  const initText = await initResp.text();
  if (!initResp.ok || !sessionId) {
    throw new Error(`MCP init failed: ${initResp.status} ${initText}`);
  }
  return sessionId;
}

async function executeSql(url, token, sessionId, query) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `sql-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: 'execute_sql',
        arguments: { query }
      }
    })
  });

  const raw = await resp.text();
  const payload = parseMaybeJson(raw, {});
  const textItem = (payload?.result?.content || []).find((x) => typeof x?.text === 'string')?.text || '';
  const textObj = parseMaybeJson(textItem, {});

  if (!resp.ok || textObj?.error?.message) {
    throw new Error(`SQL error: ${textObj?.error?.message || raw}`);
  }

  return parseRowsFromMcpText(textItem || raw);
}

function buildInsertSql(prompt, availableColumns) {
  const stages = JSON.stringify(prompt.stages);
  const criteria = JSON.stringify(prompt.criteria);

  const has = (name) => availableColumns.has(name);
  const col = (name) => `"${availableColumns.get(name)}"`;

  const colMap = [
    has('prompt_id') ? [col('prompt_id'), `'${escapeSql(prompt.prompt_id)}'`] : null,
    has('titre') ? [col('titre'), `'${escapeSql(prompt.titre)}'`] : null,
    has('systemprompt') ? [col('systemprompt'), `'${escapeSql(prompt.systemprompt)}'`] : null,
    has('promptmessages') ? [col('promptmessages'), `'${escapeSql(prompt.promptmessages)}'`] : null,
    has('stages') ? [col('stages'), `'${escapeSql(stages)}'::jsonb`] : null,
    has('criteria') ? [col('criteria'), `'${escapeSql(criteria)}'::jsonb`] : null,
    has('actif') ? [col('actif'), `'true'`] : null,
    has('created_at') ? [col('created_at'), `to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`] : null
  ].filter(Boolean);

  // Some schemas may store evaluator prompt under a different column name.
  if (has('prompt_evaluateur')) {
    colMap.push([col('prompt_evaluateur'), `'${escapeSql(prompt.prompt_evaluateur)}'`]);
  } else if (has('promptevaluateur')) {
    colMap.push([col('promptevaluateur'), `'${escapeSql(prompt.prompt_evaluateur)}'`]);
  }

  if (!colMap.length) {
    throw new Error('No compatible columns found in public.promptid');
  }

  const columns = colMap.map((x) => x[0]).join(',\n  ');
  const values = colMap.map((x) => x[1]).join(',\n  ');

  return `
INSERT INTO public.promptid (
  ${columns}
)
SELECT
  ${values}
WHERE NOT EXISTS (
  SELECT 1 FROM public.promptid WHERE prompt_id = '${escapeSql(prompt.prompt_id)}'
);
`.trim();
}

loadEnv();

const url = process.env.SUPABASE_MCP_URL;
const token = process.env.SUPABASE_MCP_AUTH;
if (!url || !token) {
  throw new Error('SUPABASE_MCP_URL or SUPABASE_MCP_AUTH missing in .env');
}

const prompts = [
  {
    prompt_id: 'pmpt_sales_b2b_directif_20260322',
    titre: 'B2B directif',
    systemprompt: 'Tu es un decideur B2B presse, sceptique, oriente ROI. Tu coupes les reponses longues et demandes des preuves chiffrees.',
    promptmessages: 'Contexte: PME industrielle, budget serre, objectif reduction des couts. N accepte pas les generalites, demande des cas concrets et des gains mesurables.',
    prompt_evaluateur: 'Evalue la capacite du commercial a qualifier vite, chiffrer la valeur, traiter l objection prix et conclure une prochaine etape claire.',
    stages: ['Brise-glace', 'Decouverte', 'Argumentation', 'Objections', 'Conclusion'],
    criteria: [
      { nom: 'Qualite de l ecoute et comprehension', coefficient: 2 },
      { nom: 'Adaptation au profil du client', coefficient: 3 },
      { nom: 'Coherence de l argumentation', coefficient: 2 },
      { nom: 'Gestion des reactions du client', coefficient: 2 },
      { nom: 'Conduite et structure de l echange', coefficient: 1 },
      { nom: 'Richesse et pertinence du vocabulaire', coefficient: 2 }
    ]
  },
  {
    prompt_id: 'pmpt_sales_retail_empathique_20260322',
    titre: 'Retail empathique',
    systemprompt: 'Tu es responsable magasin, ouvert mais prudent. Tu valorises la relation, la simplicite et l impact operationnel immediat.',
    promptmessages: 'Contexte: besoin de fluidifier l accueil client et de reduire les ruptures. Tu apprecies les exemples terrain concrets.',
    prompt_evaluateur: 'Evalue l ecoute active, la reformulation, la personnalisation de l argumentaire et la gestion des objections douces.',
    stages: ['Brise-glace', 'Decouverte', 'Argumentation', 'Objections', 'Conclusion'],
    criteria: [
      { nom: 'Qualite de l ecoute et comprehension', coefficient: 2 },
      { nom: 'Adaptation au profil du client', coefficient: 3 },
      { nom: 'Coherence de l argumentation', coefficient: 2 },
      { nom: 'Gestion des reactions du client', coefficient: 2 },
      { nom: 'Conduite et structure de l echange', coefficient: 1 },
      { nom: 'Richesse et pertinence du vocabulaire', coefficient: 2 }
    ]
  },
  {
    prompt_id: 'pmpt_sales_compte_cle_20260322',
    titre: 'Compte cle exigeant',
    systemprompt: 'Tu es un grand compte avec process achat formalise. Tu compares plusieurs fournisseurs et demandes conformite, SLA et integration.',
    promptmessages: 'Contexte: deploiement multi-sites avec contraintes IT et securite. Tu poses des questions de gouvernance et de risque fournisseur.',
    prompt_evaluateur: 'Evalue la structuration du discours, la maitrise des risques, la precision technique et la conduite de decision multi-acteurs.',
    stages: ['Brise-glace', 'Decouverte', 'Argumentation', 'Objections', 'Conclusion'],
    criteria: [
      { nom: 'Qualite de l ecoute et comprehension', coefficient: 2 },
      { nom: 'Adaptation au profil du client', coefficient: 3 },
      { nom: 'Coherence de l argumentation', coefficient: 2 },
      { nom: 'Gestion des reactions du client', coefficient: 2 },
      { nom: 'Conduite et structure de l echange', coefficient: 1 },
      { nom: 'Richesse et pertinence du vocabulaire', coefficient: 2 }
    ]
  },
  {
    prompt_id: 'pmpt_sales_prospect_froid_20260322',
    titre: 'Prospect froid',
    systemprompt: 'Tu n as pas demande d appel. Tu es poli mais distant. Tu testes la pertinence en moins de deux minutes.',
    promptmessages: 'Contexte: charge de travail elevee, peu de disponibilite. Tu refuses les pitchs longs.',
    prompt_evaluateur: 'Evalue l accroche, la capacite a susciter l interet vite, la qualification minimale utile et l obtention d un micro engagement.',
    stages: ['Brise-glace', 'Decouverte', 'Argumentation', 'Objections', 'Conclusion'],
    criteria: [
      { nom: 'Qualite de l ecoute et comprehension', coefficient: 2 },
      { nom: 'Adaptation au profil du client', coefficient: 3 },
      { nom: 'Coherence de l argumentation', coefficient: 2 },
      { nom: 'Gestion des reactions du client', coefficient: 2 },
      { nom: 'Conduite et structure de l echange', coefficient: 1 },
      { nom: 'Richesse et pertinence du vocabulaire', coefficient: 2 }
    ]
  }
];

const sessionId = await mcpInitialize(url, token);

const schemaRows = await executeSql(
  url,
  token,
  sessionId,
  `SELECT column_name
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'promptid'
   ORDER BY ordinal_position;`
);

const availableColumns = new Map(
  schemaRows
    .map((r) => [String(r.column_name || '').toLowerCase(), String(r.column_name || '')])
    .filter((pair) => pair[0])
);

for (const p of prompts) {
  const sql = buildInsertSql(p, availableColumns);
  await executeSql(url, token, sessionId, sql);
}

const checkRows = await executeSql(
  url,
  token,
  sessionId,
  `SELECT id, prompt_id, titre, actif
   FROM public.promptid
   WHERE prompt_id IN (
     'pmpt_sales_b2b_directif_20260322',
     'pmpt_sales_retail_empathique_20260322',
     'pmpt_sales_compte_cle_20260322',
     'pmpt_sales_prospect_froid_20260322'
   )
   ORDER BY created_at DESC NULLS LAST;`
);

console.log(JSON.stringify(checkRows, null, 2));
