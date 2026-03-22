import fs from 'fs';
import path from 'path';

const base = process.env.BASE_URL || 'http://localhost:3000';

const envPath = path.join(process.cwd(), '.env');
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

const adminToken = process.env.ADMIN_TOKEN || '';
const authHeaders = {
  'X-Admin-Token': adminToken,
  'Content-Type': 'application/json'
};

const list = await fetch(`${base}/api/admin/prompts`, { headers: authHeaders }).then((r) => r.json());
const first = (list.prompts || [])[0];

if (!first) {
  console.error('No prompt available');
  process.exit(1);
}

const key = encodeURIComponent(first.prompt_id || first.id);
const detailResp = await fetch(`${base}/api/admin/prompts/${key}`, { headers: authHeaders });
const detail = await detailResp.json();
console.log('DETAIL_STATUS', detailResp.status, detail.prompt?.prompt_id || detail.prompt?.id);

const marker = `Admin update test ${Date.now()}`;
const updateResp = await fetch(`${base}/api/admin/prompts/${key}`, {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({ description: marker })
});

const updated = await updateResp.json();
console.log('UPDATE_STATUS', updateResp.status, updated.updated === true);
console.log('UPDATED_DESCRIPTION', updated.prompt?.description || '');

const createdPromptId = `pmpt_admin_ui_test_${Date.now()}`;
const createResp = await fetch(`${base}/api/admin/prompts`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    prompt_id: createdPromptId,
    titre: 'UI Test Prompt',
    actif: 'true',
    categorie: 'test',
    version: 'v1',
    description: 'created by test-admin-api',
    systemprompt: 'Test system',
    promptmessages: 'Test messages',
    prompt_evaluateur: 'Test evaluateur',
    stages: ['Brise-glace'],
    criteria: [{ nom: 'Critere test', coefficient: 1 }],
    variables: {}
  })
});
const created = await createResp.json();
console.log('CREATE_STATUS', createResp.status, created.created === true, created.prompt?.prompt_id || '');

const badResp = await fetch(`${base}/api/admin/prompts/${encodeURIComponent(createdPromptId)}`, {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({ criteria: [{ nom: 'Invalid coeff', coefficient: 'x' }] })
});
const bad = await badResp.json();
console.log('VALIDATION_STATUS', badResp.status, bad.error || '');

const deleteResp = await fetch(`${base}/api/admin/prompts/${encodeURIComponent(createdPromptId)}`, {
  method: 'DELETE',
  headers: authHeaders
});
const deleted = await deleteResp.json();
console.log('DELETE_STATUS', deleteResp.status, deleted.deleted === true);
