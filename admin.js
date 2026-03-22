const state = {
  prompts: [],
  selectedKey: null,
  adminToken: ''
};

const els = {
  promptList: document.getElementById('prompt-list'),
  createBtn: document.getElementById('create-prompt'),
  refreshBtn: document.getElementById('refresh-list'),
  tokenInput: document.getElementById('admin-token'),
  searchInput: document.getElementById('search-input'),
  statusChip: document.getElementById('status-chip'),
  form: document.getElementById('prompt-form'),
  promptId: document.getElementById('field-prompt-id'),
  actif: document.getElementById('field-actif'),
  titre: document.getElementById('field-titre'),
  categorie: document.getElementById('field-categorie'),
  version: document.getElementById('field-version'),
  description: document.getElementById('field-description'),
  systemprompt: document.getElementById('field-systemprompt'),
  promptmessages: document.getElementById('field-promptmessages'),
  promptEvaluateur: document.getElementById('field-prompt-evaluateur'),
  stages: document.getElementById('field-stages'),
  criteria: document.getElementById('field-criteria'),
  testeurActif: document.getElementById('field-testeur-actif'),
  testeurPrompt: document.getElementById('field-testeur-prompt'),
  formatJsonBtn: document.getElementById('btn-format-json'),
  deleteBtn: document.getElementById('btn-delete')
};

const TOKEN_STORAGE_KEY = 'simventes_admin_token';

function setStatus(label, mode = 'idle') {
  els.statusChip.textContent = label;
  els.statusChip.className = `status-chip ${mode}`;
}

function prettyJson(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback, null, 2);
  } catch {
    return JSON.stringify(fallback, null, 2);
  }
}

function parseJsonField(value, fallback, label) {
  const txt = String(value || '').trim();
  if (!txt) {
    return fallback;
  }

  try {
    return JSON.parse(txt);
  } catch (error) {
    throw new Error(`${label}: JSON invalide (${error.message})`);
  }
}

function validatePromptPayload(payload, { requirePromptId = false } = {}) {
  const ensureString = (field) => {
    if (payload[field] !== undefined && typeof payload[field] !== 'string') {
      throw new Error(`${field} doit etre une chaine`);
    }
  };

  ['prompt_id', 'titre', 'description', 'actif', 'categorie', 'version', 'systemprompt', 'promptmessages', 'prompt_evaluateur']
    .forEach(ensureString);

  if (requirePromptId) {
    const pid = String(payload.prompt_id || '').trim();
    if (!pid) {
      throw new Error('prompt_id obligatoire');
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

}

function ensureAdminToken() {
  if (!String(state.adminToken || '').trim()) {
    throw new Error('Renseigne ADMIN_TOKEN pour utiliser l\'admin');
  }
}

function buildPromptId() {
  return `pmpt_admin_${Date.now()}`;
}

function getAuthHeaders(extra = {}) {
  const token = (state.adminToken || '').trim();
  const headers = { ...extra };
  if (token) {
    headers['X-Admin-Token'] = token;
  }
  return headers;
}

function promptItemMarkup(prompt) {
  const actif = String(prompt.actif || '').toLowerCase();
  const badge = actif === 'true' ? 'Actif' : 'Inactif';
  return `
    <div class="prompt-title">${prompt.titre || '(Sans titre)'}</div>
    <div class="prompt-meta">${prompt.prompt_id || prompt.id || ''}</div>
    <div class="prompt-meta">${badge}${prompt.categorie ? ` • ${prompt.categorie}` : ''}${prompt.version ? ` • ${prompt.version}` : ''}</div>
  `;
}

function renderPromptList() {
  const keyword = els.searchInput.value.trim().toLowerCase();
  const filtered = state.prompts.filter((p) => {
    if (!keyword) return true;
    return [p.titre, p.prompt_id, p.id, p.categorie, p.version]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(keyword);
  });

  els.promptList.innerHTML = '';

  filtered.forEach((prompt) => {
    const key = prompt.prompt_id || prompt.id;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `prompt-item ${state.selectedKey === key ? 'active' : ''}`;
    item.innerHTML = promptItemMarkup(prompt);
    item.addEventListener('click', () => loadPromptDetail(key));
    els.promptList.appendChild(item);
  });

  if (!filtered.length) {
    els.promptList.innerHTML = '<div class="prompt-meta">Aucun prompt trouve.</div>';
  }
}

async function fetchJson(url, options) {
  ensureAdminToken();
  const response = await fetch(url, {
    ...options,
    headers: getAuthHeaders(options?.headers || {})
  });
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }

  return body;
}

async function loadPromptList() {
  setStatus('Chargement...', 'idle');
  const payload = await fetchJson('/api/admin/prompts');
  state.prompts = Array.isArray(payload.prompts) ? payload.prompts : [];
  renderPromptList();
  setStatus('Liste chargee', 'success');

  if (!state.selectedKey && state.prompts.length) {
    await loadPromptDetail(state.prompts[0].prompt_id || state.prompts[0].id);
  }
}

function fillForm(prompt) {
  els.promptId.value = prompt.prompt_id || '';
  els.actif.value = String(prompt.actif ?? 'true');
  els.titre.value = prompt.titre || '';
  els.categorie.value = prompt.categorie || '';
  els.version.value = prompt.version || '';
  els.description.value = prompt.description || '';
  els.systemprompt.value = prompt.systemprompt || '';
  els.promptmessages.value = prompt.promptmessages || '';
  els.promptEvaluateur.value = prompt.prompt_evaluateur || '';
  els.stages.value = prettyJson(prompt.stages, []);
  els.criteria.value = prettyJson(prompt.criteria, []);
  const testeur = (prompt.testeur && typeof prompt.testeur === 'object') ? prompt.testeur : {};
  els.testeurActif.value = String(testeur.actif ?? 'false').toLowerCase() === 'true' ? 'true' : 'false';
  els.testeurPrompt.value = String(testeur.prompt || '');
}

async function loadPromptDetail(promptKey) {
  state.selectedKey = promptKey;
  renderPromptList();

  setStatus('Chargement detail...', 'idle');
  const payload = await fetchJson(`/api/admin/prompts/${encodeURIComponent(promptKey)}`);
  fillForm(payload.prompt || {});
  setStatus('Prompt charge', 'success');
}

function formatJsonFields() {
  const stages = parseJsonField(els.stages.value, [], 'Stages');
  const criteria = parseJsonField(els.criteria.value, [], 'Criteria');

  els.stages.value = prettyJson(stages, []);
  els.criteria.value = prettyJson(criteria, []);

  setStatus('JSON formate', 'success');
}

function buildFormPayload() {
  const stages = parseJsonField(els.stages.value, [], 'Stages');
  const criteria = parseJsonField(els.criteria.value, [], 'Criteria');

  const payload = {
    actif: els.actif.value,
    titre: els.titre.value,
    categorie: els.categorie.value,
    version: els.version.value,
    description: els.description.value,
    systemprompt: els.systemprompt.value,
    promptmessages: els.promptmessages.value,
    prompt_evaluateur: els.promptEvaluateur.value,
    stages,
    criteria,
    testeur: {
      actif: els.testeurActif.value,
      prompt: els.testeurPrompt.value
    }
  };

  validatePromptPayload(payload);
  return payload;
}

async function savePrompt(event) {
  event.preventDefault();
  if (!state.selectedKey) {
    setStatus('Selectionne un prompt', 'error');
    return;
  }

  try {
    const payload = buildFormPayload();

    setStatus('Sauvegarde...', 'saving');

    const result = await fetchJson(`/api/admin/prompts/${encodeURIComponent(state.selectedKey)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    fillForm(result.prompt || payload);
    setStatus('Enregistre avec succes', 'success');
    await loadPromptList();
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  }
}

async function createPrompt() {
  try {
    const promptId = buildPromptId();

    const payload = {
      prompt_id: promptId,
      titre: 'Nouveau prompt',
      description: '',
      actif: 'true',
      categorie: 'custom',
      version: 'v1',
      systemprompt: '',
      promptmessages: '',
      prompt_evaluateur: '',
      stages: ['Brise-glace'],
      criteria: [{ nom: 'Critere principal', coefficient: 1 }]
    };

    validatePromptPayload(payload, { requirePromptId: true });
    setStatus('Creation...', 'saving');

    await fetchJson('/api/admin/prompts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    await loadPromptList();
    await loadPromptDetail(payload.prompt_id);
    setStatus('Prompt cree', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  }
}

async function deletePrompt() {
  if (!state.selectedKey) {
    setStatus('Aucun prompt selectionne', 'error');
    return;
  }

  const ok = window.confirm(`Supprimer le prompt ${state.selectedKey} ?`);
  if (!ok) {
    return;
  }

  try {
    setStatus('Suppression...', 'saving');
    await fetchJson(`/api/admin/prompts/${encodeURIComponent(state.selectedKey)}`, {
      method: 'DELETE'
    });

    state.selectedKey = null;
    await loadPromptList();
    setStatus('Prompt supprime', 'success');
  } catch (error) {
    console.error(error);
    setStatus(error.message, 'error');
  }
}

function bootstrapToken() {
  const saved = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
  state.adminToken = saved;
  els.tokenInput.value = saved;

  els.tokenInput.addEventListener('change', () => {
    state.adminToken = els.tokenInput.value.trim();
    localStorage.setItem(TOKEN_STORAGE_KEY, state.adminToken);
    setStatus('Token admin mis a jour', 'success');
  });
}

bootstrapToken();
els.createBtn.addEventListener('click', createPrompt);
els.deleteBtn.addEventListener('click', deletePrompt);
els.refreshBtn.addEventListener('click', loadPromptList);
els.searchInput.addEventListener('input', renderPromptList);
els.form.addEventListener('submit', savePrompt);
els.formatJsonBtn.addEventListener('click', () => {
  try {
    formatJsonFields();
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

loadPromptList().catch((error) => {
  console.error(error);
  setStatus(error.message, 'error');
});
