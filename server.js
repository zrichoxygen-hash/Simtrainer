const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

// Load .env file FIRST before any other code runs
function loadEnvFile() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }

  const content = fs.readFileSync(envPath, 'utf8');
  content.split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnvFile();

const PORT = Number(process.env.PORT || 3000);
const MAX_PORT_ATTEMPTS = 5;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'MaloMa4iToken';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function getRuntimeConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || OPENAI_API_KEY
  };
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';

    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });

    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Token'
  });
  res.end(body);
}

async function importWorkflowModule() {
  return import(pathToFileURL(path.join(__dirname, 'workflow-sdk.mjs')).href);
}

async function callOpenAI(message, conversationHistory, options = {}) {
  void conversationHistory;
  const config = getRuntimeConfig();

  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const workflowModule = await importWorkflowModule();
  const workflowResult = await workflowModule.runWorkflow({
    input_as_text: message,
    conversation_history: conversationHistory,
    prompt_id: options.promptId || null,
    conversation_id: options.conversationId || null,
    user_id: options.userId || null
  });

  const workflowText =
    workflowResult?.output_parsed?.client_reply ||
    workflowResult?.output_parsed?.evaluation?.summary_feedback ||
    workflowResult?.output_text ||
    '';

  if (!String(workflowText).trim()) {
    throw new Error('Workflow returned no usable text');
  }

  return {
    text: String(workflowText).trim(),
    source: 'workflow',
    conversationId: workflowResult?.output_parsed?.conversation_id || null,
    promptId: workflowResult?.output_parsed?.prompt_id || null,
    stageIndex: workflowResult?.output_parsed?.stage_index,
    stageName: workflowResult?.output_parsed?.stage_name,
    simulationComplete: Boolean(workflowResult?.output_parsed?.simulation_complete),
    stages: Array.isArray(workflowResult?.output_parsed?.stages) ? workflowResult.output_parsed.stages : [],
    criteria: Array.isArray(workflowResult?.output_parsed?.criteria) ? workflowResult.output_parsed.criteria : [],
    stageEvaluations: Array.isArray(workflowResult?.output_parsed?.stage_evaluations)
      ? workflowResult.output_parsed.stage_evaluations
      : []
  };
}

async function listPromptOptions() {
  const config = getRuntimeConfig();
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.listPromptOptions !== 'function') {
    throw new Error('listPromptOptions unavailable in workflow-sdk.mjs');
  }
  return workflowModule.listPromptOptions();
}

async function listAdminPrompts() {
  const config = getRuntimeConfig();
  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY missing');
  }

  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.listAdminPrompts !== 'function') {
    throw new Error('listAdminPrompts unavailable in workflow-sdk.mjs');
  }

  return workflowModule.listAdminPrompts();
}

async function getAdminPrompt(promptKey) {
  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.getAdminPrompt !== 'function') {
    throw new Error('getAdminPrompt unavailable in workflow-sdk.mjs');
  }

  return workflowModule.getAdminPrompt(promptKey);
}

async function updateAdminPrompt(promptKey, payload) {
  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.updateAdminPrompt !== 'function') {
    throw new Error('updateAdminPrompt unavailable in workflow-sdk.mjs');
  }

  return workflowModule.updateAdminPrompt(promptKey, payload);
}

async function createAdminPrompt(payload) {
  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.createAdminPrompt !== 'function') {
    throw new Error('createAdminPrompt unavailable in workflow-sdk.mjs');
  }

  return workflowModule.createAdminPrompt(payload);
}

async function deleteAdminPrompt(promptKey) {
  const workflowModule = await importWorkflowModule();
  if (typeof workflowModule.deleteAdminPrompt !== 'function') {
    throw new Error('deleteAdminPrompt unavailable in workflow-sdk.mjs');
  }

  return workflowModule.deleteAdminPrompt(promptKey);
}

function requireAdminToken(req, res) {
  if (!ADMIN_TOKEN) {
    sendJson(res, 500, { error: 'ADMIN_TOKEN manquant dans .env' });
    return false;
  }

  const incomingToken = String(req.headers['x-admin-token'] || '').trim();
  if (!incomingToken || incomingToken !== ADMIN_TOKEN) {
    sendJson(res, 401, { error: 'Token admin invalide' });
    return false;
  }

  return true;
}

function validateAdminPayload(payload, { requirePromptId = false } = {}) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Payload invalide: objet JSON attendu');
  }

  if (requirePromptId) {
    const pid = String(payload.prompt_id || '').trim();
    if (!pid) {
      throw new Error('prompt_id est obligatoire pour la creation');
    }
  }

  const stringFields = [
    'prompt_id',
    'titre',
    'description',
    'actif',
    'categorie',
    'version',
    'systemprompt',
    'promptmessages',
    'prompt_evaluateur'
  ];

  for (const field of stringFields) {
    if (payload[field] !== undefined && typeof payload[field] !== 'string') {
      throw new Error(`Champ ${field} doit etre une chaine`);
    }
  }

  if (payload.stages !== undefined) {
    if (!Array.isArray(payload.stages) || payload.stages.some((s) => typeof s !== 'string')) {
      throw new Error('stages doit etre un tableau de chaines');
    }
  }

  if (payload.criteria !== undefined) {
    if (!Array.isArray(payload.criteria)) {
      throw new Error('criteria doit etre un tableau');
    }

    payload.criteria.forEach((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error(`criteria[${index}] doit etre un objet`);
      }

      const hasName = typeof item.nom === 'string' || typeof item.critere === 'string';
      if (!hasName) {
        throw new Error(`criteria[${index}] doit contenir nom ou critere`);
      }

      if (item.coefficient !== undefined && typeof item.coefficient !== 'number') {
        throw new Error(`criteria[${index}].coefficient doit etre numerique`);
      }
    });
  }

  if (payload.variables !== undefined) {
    if (!payload.variables || typeof payload.variables !== 'object' || Array.isArray(payload.variables)) {
      throw new Error('variables doit etre un objet JSON');
    }
  }

  if (payload.testeur !== undefined) {
    if (!payload.testeur || typeof payload.testeur !== 'object' || Array.isArray(payload.testeur)) {
      throw new Error('testeur doit etre un objet JSON');
    }
  }
}

function getAdminErrorStatusCode(error) {
  const message = String(error?.message || '').toLowerCase();
  if (!message) {
    return 500;
  }

  if (
    message.includes('payload invalide') ||
    message.includes('invalid json') ||
    message.includes('doit') ||
    message.includes('obligatoire') ||
    message.includes('required')
  ) {
    return 400;
  }

  return 500;
}

function serveStaticFile(req, res) {
  let requestPath = req.url === '/' ? '/index.html' : req.url;
  requestPath = requestPath.split('?')[0];

  const normalizedPath = path.normalize(requestPath).replace(/^\/+/, '');
  const filePath = path.join(__dirname, normalizedPath);

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  // Server config endpoint
  if (req.method === 'GET' && req.url === '/api/config') {
    sendJson(res, 200, {
      port: server.address()?.port || PORT
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/prompts') {
    try {
      const prompts = await listPromptOptions();
      sendJson(res, 200, { prompts });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Prompt loading failed'
      });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/admin/prompts') {
    if (!requireAdminToken(req, res)) {
      return;
    }

    try {
      const prompts = await listAdminPrompts();
      sendJson(res, 200, { prompts });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Admin prompt loading failed'
      });
    }
    return;
  }

  if (req.method === 'GET' && req.url.startsWith('/api/admin/prompts/')) {
    if (!requireAdminToken(req, res)) {
      return;
    }

    try {
      const promptKey = decodeURIComponent(req.url.replace('/api/admin/prompts/', '').split('?')[0] || '');
      if (!promptKey) {
        sendJson(res, 400, { error: 'prompt key is required' });
        return;
      }

      const prompt = await getAdminPrompt(promptKey);
      sendJson(res, 200, { prompt });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Admin prompt detail failed'
      });
    }
    return;
  }

  if (req.method === 'PUT' && req.url.startsWith('/api/admin/prompts/')) {
    if (!requireAdminToken(req, res)) {
      return;
    }

    try {
      const promptKey = decodeURIComponent(req.url.replace('/api/admin/prompts/', '').split('?')[0] || '');
      if (!promptKey) {
        sendJson(res, 400, { error: 'prompt key is required' });
        return;
      }

      const body = await readJsonBody(req);
  validateAdminPayload(body || {});
      const updatedPrompt = await updateAdminPrompt(promptKey, body || {});
      sendJson(res, 200, { prompt: updatedPrompt, updated: true });
    } catch (error) {
      sendJson(res, getAdminErrorStatusCode(error), {
        error: error.message || 'Admin prompt update failed'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/admin/prompts') {
    if (!requireAdminToken(req, res)) {
      return;
    }

    try {
      const body = await readJsonBody(req);
      validateAdminPayload(body || {}, { requirePromptId: true });
      const createdPrompt = await createAdminPrompt(body || {});
      sendJson(res, 201, { prompt: createdPrompt, created: true });
    } catch (error) {
      sendJson(res, getAdminErrorStatusCode(error), {
        error: error.message || 'Admin prompt create failed'
      });
    }
    return;
  }

  if (req.method === 'DELETE' && req.url.startsWith('/api/admin/prompts/')) {
    if (!requireAdminToken(req, res)) {
      return;
    }

    try {
      const promptKey = decodeURIComponent(req.url.replace('/api/admin/prompts/', '').split('?')[0] || '');
      if (!promptKey) {
        sendJson(res, 400, { error: 'prompt key is required' });
        return;
      }

      const deleted = await deleteAdminPrompt(promptKey);
      sendJson(res, 200, { deleted: true, prompt: deleted });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Admin prompt delete failed'
      });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/testeur') {
    try {
      const body = await readJsonBody(req);
      const testeurPrompt = String(body?.testeur_prompt || '').trim();
      const conversationHistory = Array.isArray(body?.conversation_history) ? body.conversation_history : [];

      if (!testeurPrompt) {
        sendJson(res, 400, { error: 'testeur_prompt est requis' });
        return;
      }

      const config = getRuntimeConfig();
      if (!config.apiKey) {
        sendJson(res, 500, { error: 'OPENAI_API_KEY manquant' });
        return;
      }

      // Invert roles: in original history user=student, assistant=evaluateur.
      // From testeur perspective: user=evaluateur (the one asking), assistant=student (previous replies).
      const flippedHistory = conversationHistory.map((msg) => ({
        role: msg.role === 'user' ? 'assistant' : 'user',
        content: msg.content
      }));

      const messages = [{ role: 'system', content: testeurPrompt }, ...flippedHistory];

      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages, max_tokens: 400, temperature: 0.85 })
      });

      if (!openaiRes.ok) {
        const errText = await openaiRes.text();
        sendJson(res, 500, { error: `OpenAI error: ${errText.slice(0, 200)}` });
        return;
      }

      const aiData = await openaiRes.json();
      const text = String(aiData?.choices?.[0]?.message?.content || '').trim();
      if (!text) {
        sendJson(res, 500, { error: 'Reponse testeur vide' });
        return;
      }

      sendJson(res, 200, { response: text });
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Testeur error' });
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    try {
      const body = await readJsonBody(req);
      const message = String(body?.message || '').trim();
      const conversationHistory = Array.isArray(body?.conversationHistory) ? body.conversationHistory : [];

      if (!message) {
        sendJson(res, 400, { error: 'message is required' });
        return;
      }

      const openaiResult = await callOpenAI(message, conversationHistory, {
        promptId: body?.promptId || null,
        conversationId: body?.conversationId || null,
        userId: body?.userId || null
      });

      sendJson(res, 200, {
        response: openaiResult.text,
        source: openaiResult.source,
        conversationId: openaiResult.conversationId,
        promptId: openaiResult.promptId,
        stageIndex: openaiResult.stageIndex,
        stageName: openaiResult.stageName,
        simulationComplete: openaiResult.simulationComplete,
        stages: openaiResult.stages,
        criteria: openaiResult.criteria,
        stageEvaluations: openaiResult.stageEvaluations
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || 'Server error',
        fallback: true
      });
    }
    return;
  }

  if (req.method === 'GET') {
    serveStaticFile(req, res);
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
});

function startServer(startPort) {
  let attempts = 0;

  const tryListen = (port) => {
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && attempts < MAX_PORT_ATTEMPTS) {
        attempts += 1;
        tryListen(port + 1);
        return;
      }

      throw error;
    });

    server.listen(port, () => {
      console.log(`Server started: http://localhost:${port}`);
      // Serve port info on a special endpoint for client-side discovery
      console.log(`PORT_INFO: ${port}`);
    });
  };

  tryListen(startPort);
}

startServer(PORT);
