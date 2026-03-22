const OPENAI_CONFIG = {
  enabled: true,
  backendUrl: '/api/chat',
  promptsUrl: '/api/prompts',
  configUrl: '/api/config',
  agentName: 'AGENT IA'
};

class ChatAgent {
  constructor(config = {}) {
    this.config = {
      enabled: Boolean(config.enabled),
      backendUrl: config.backendUrl || '/api/chat',
      promptsUrl: config.promptsUrl || '/api/prompts',
      configUrl: config.configUrl || '/api/config',
      agentName: config.agentName || 'AGENT IA'
    };

    this.isTyping = false;
    this.conversationHistory = [];
    this.lastResponseSource = 'local';
    this.selectedPromptId = null;
    this.conversationId = null;
    this.userId = null;
    this.promptCatalog = new Map();
    this.currentStages = [];
    this.currentCriteria = [];
    this.currentStageIndex = 0;
    this.stageEvaluations = [];
    this.testeurActive = false;
    this.testeurPrompt = '';
  }

  setSelectedPrompt(promptId) {
    this.selectedPromptId = promptId || null;
    this.conversationId = null;
    this.conversationHistory = [];
    this.currentStageIndex = 0;
    this.stageEvaluations = [];

    const promptConfig = this.promptCatalog.get(this.selectedPromptId) || {};
    this.currentStages = this.normalizeStages(promptConfig.stages);
    this.currentCriteria = this.normalizeCriteria(promptConfig.criteria);
    this.testeurPrompt = String(promptConfig.testeur_prompt || '');

    // auto-activate testeur if prompt has it enabled by default
    const defaultActive = String(promptConfig.testeur_actif || 'false').toLowerCase() === 'true';
    if (defaultActive !== this.testeurActive) {
      this.testeurActive = defaultActive;
      this.updateTesteurButton();
    }

    this.renderStepsPanel();
    this.renderEvaluationPanel();
    this.updateSessionMeta();
  }

  setUserId(userId) {
    this.userId = userId || null;
  }

  updateSessionMeta(extra = '') {
    const meta = document.querySelector('#session-meta');
    if (!meta) {
      return;
    }

    const base = this.conversationId
      ? `Conversation: ${this.conversationId}`
      : 'Aucune conversation active';

    meta.textContent = extra ? `${base} | ${extra}` : base;
  }

  /**
   * Discover the actual server port in case of port conflicts
   */
  async discoverServerConfig() {
    try {
      const response = await fetch(this.config.configUrl);
      if (response.ok) {
        const config = await response.json();
        if (config.port && config.port !== 3000) {
          console.log(`Detected server on port ${config.port}`);
          // URLs are relative so they work across ports automatically
        }
      }
    } catch (e) {
      console.log('Server config discovery optional:', e.message);
    }
  }

  toggleTesteur() {
    if (!this.testeurPrompt) {
      alert('Ce prompt ne dispose pas d\'un prompt testeur. Configure-le dans l\'interface admin (section Testeur).');
      return;
    }
    this.testeurActive = !this.testeurActive;
    this.updateTesteurButton();
    if (this.testeurActive) {
      this.addMessageToChat('SYSTEME', '&#9654; Mode Testeur actif — l\'IA va simuler les reponses de l\'etudiant.', 'system');
    } else {
      this.addMessageToChat('SYSTEME', '&#9646;&#9646; Mode Testeur desactive.', 'system');
    }
  }

  updateTesteurButton() {
    const btn = document.querySelector('#testeur-toggle');
    if (!btn) return;
    if (this.testeurActive) {
      btn.classList.add('active');
      btn.title = 'Desactiver le testeur';
    } else {
      btn.classList.remove('active');
      btn.title = 'Activer le mode testeur (simulation etudiant IA)';
    }
    const inputField = document.querySelector('.input-field');
    const sendBtn = document.querySelector('.send-button');
    if (inputField) inputField.disabled = this.testeurActive;
    if (sendBtn) sendBtn.disabled = this.testeurActive;
  }

  async runTesteurResponse() {
    if (!this.testeurActive || !this.testeurPrompt || this.isTyping) return;
    await this.delay(1200 + Math.random() * 1000);
    if (!this.testeurActive) return; // may have been deactivated during delay

    try {
      const res = await fetch('/api/testeur', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testeur_prompt: this.testeurPrompt,
          conversation_history: this.conversationHistory
        })
      });
      const data = await res.json();
      const studentMessage = String(data?.response || '').trim();
      if (!studentMessage) return;
      await this.sendMessage(studentMessage, true);
    } catch (err) {
      console.error('Testeur error:', err);
    }
  }

  async sendMessage(message, fromTesteur = false) {
    if (this.isTyping) {
      return;
    }

    const senderLabel = fromTesteur ? 'TESTEUR (IA)' : 'ETUDIANT';
    const msgClass = fromTesteur ? 'testeur' : 'user';
    this.addMessageToChat(senderLabel, message, msgClass);
    this.showTypingIndicator();
    await this.delay(600 + Math.random() * 700);
    this.hideTypingIndicator();

    const response = await this.getAssistantResponse(message);
    this.addMessageToChat(this.config.agentName, response, 'ai');

    if (this.testeurActive) {
      this.runTesteurResponse();
    }
  }

  async getAssistantResponse(userMessage) {
    if (this.config.enabled) {
      return this.getBackendResponse(userMessage);
    }
    this.lastResponseSource = 'backend-disabled';
    return 'Le backend est desactive. Active la configuration serveur pour utiliser ton agent OpenAI.';
  }

  async getBackendResponse(userMessage) {
    try {
      const response = await fetch(this.config.backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: this.conversationHistory,
          promptId: this.selectedPromptId,
          conversationId: this.conversationId,
          userId: this.userId
        })
      });

      if (!response.ok) {
        let backendMessage = `Backend error ${response.status}`;

        try {
          const errorData = await response.json();
          backendMessage = errorData?.error || backendMessage;
        } catch {
          const errorBody = await response.text();
          if (errorBody) {
            backendMessage = `${backendMessage}: ${errorBody}`;
          }
        }

        throw new Error(backendMessage);
      }

      const data = await response.json();
      const aiResponse = data?.response?.trim();
      this.lastResponseSource = data?.source || 'backend-unknown';

      if (!aiResponse) {
        throw new Error('Reponse backend vide');
      }

      if (data?.conversationId) {
        this.conversationId = data.conversationId;
      }

      this.conversationHistory.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: aiResponse }
      );

      if (this.conversationHistory.length > 20) {
        this.conversationHistory = this.conversationHistory.slice(-20);
      }

      this.updateSessionMeta(
        data?.simulationComplete
          ? 'Simulation terminee'
          : data?.stageName
            ? `Etape: ${data.stageName}`
            : ''
      );

      this.applyWorkflowState(data || {});

      return aiResponse;
    } catch (error) {
      console.error('Backend API Error:', error);
      this.lastResponseSource = 'backend-error';
      return `Erreur workflow: ${error.message}`;
    }
  }

  addMessageToChat(sender, message, type) {
    const chatMessages = document.querySelector('.chat-messages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;

    if (type === 'system') {
      messageDiv.innerHTML = `
        <div class="message-content">
          <div class="message-bubble">${message}</div>
        </div>
      `;
      chatMessages.appendChild(messageDiv);
      chatMessages.scrollTop = chatMessages.scrollHeight;
      return;
    }

    const avatar = type === 'ai'
      ? `<div class="message-avatar ai-avatar"><div class="ai-icon">AI</div></div>`
      : type === 'testeur'
        ? `<div class="message-avatar">T</div>`
        : `<div class="message-avatar user-avatar">U</div>`;

    messageDiv.innerHTML = `
      ${avatar}
      <div class="message-content">
          <div class="message-label">${sender}</div>
          <div class="message-bubble">${message}</div>
      </div>
    `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (type === 'ai') {
      console.info(`AI response source: ${this.lastResponseSource}`);
    }
  }

  showTypingIndicator() {
    this.isTyping = true;
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) {
      indicator.style.display = 'flex';
    }
  }

  hideTypingIndicator() {
    this.isTyping = false;
    const indicator = document.querySelector('.typing-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  normalizeStages(stages) {
    return Array.isArray(stages) ? stages.filter((s) => typeof s === 'string' && s.trim()) : [];
  }

  normalizeCriteria(criteria) {
    if (!Array.isArray(criteria)) {
      return [];
    }

    return criteria
      .map((item, index) => {
        if (!item || typeof item !== 'object') {
          return null;
        }

        const name = String(item.nom || item.critere || `Critere ${index + 1}`).trim();
        if (!name) {
          return null;
        }

        const coefficient = Number(item.coefficient ?? item.weight ?? 1);
        return {
          name,
          coefficient: Number.isFinite(coefficient) ? coefficient : 1
        };
      })
      .filter(Boolean);
  }

  applyWorkflowState(data) {
    if (Array.isArray(data?.stages) && data.stages.length) {
      this.currentStages = this.normalizeStages(data.stages);
    }

    if (Array.isArray(data?.criteria) && data.criteria.length) {
      this.currentCriteria = this.normalizeCriteria(data.criteria);
    }

    if (Number.isInteger(data?.stageIndex)) {
      this.currentStageIndex = data.stageIndex;
    }

    if (Array.isArray(data?.stageEvaluations)) {
      this.stageEvaluations = data.stageEvaluations;
    }

    this.renderStepsPanel();
    this.renderEvaluationPanel();
  }

  renderStepsPanel() {
    const container = document.querySelector('#steps-list');
    if (!container) {
      return;
    }

    const stages = this.currentStages;
    if (!stages.length) {
      container.innerHTML = '<div class="step locked"><div class="step-content"><div class="step-text">Aucune etape configuree pour ce prompt.</div></div></div>';
      return;
    }

    const stageIndex = Math.max(0, Number(this.currentStageIndex) || 0);

    container.innerHTML = stages
      .map((stage, index) => {
        const status = index < stageIndex ? 'completed' : index === stageIndex ? 'active' : 'locked';
        const hasLine = index < stages.length - 1;
        const circle =
          status === 'completed'
            ? `<div class="step-circle completed"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 4.5L6 12L2.5 8.5" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`
            : status === 'active'
              ? '<div class="step-circle active"></div>'
              : `<div class="step-circle locked"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="3" y="5" width="6" height="4" rx="0.5" stroke="currentColor" stroke-width="1"/><path d="M4 5V3.5C4 2.67157 4.67157 2 5.5 2C6.32843 2 7 2.67157 7 3.5V5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg></div>`;

        return `
          <div class="step ${status}">
            <div class="step-indicator">
              ${circle}
              ${hasLine ? '<div class="step-line"></div>' : ''}
            </div>
            <div class="step-content">
              <div class="step-number">${index + 1}.</div>
              <div class="step-text">${stage}</div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  buildCurrentScoresByCriteria() {
    const scoreMap = new Map();
    const evaluations = Array.isArray(this.stageEvaluations) ? this.stageEvaluations : [];

    evaluations.forEach((evaluation) => {
      const scores = Array.isArray(evaluation?.scores) ? evaluation.scores : [];
      scores.forEach((item) => {
        const name = String(item?.critere || item?.nom || '').trim();
        const note = Number(item?.note);
        if (!name || !Number.isFinite(note)) {
          return;
        }
        scoreMap.set(name.toLowerCase(), note);
      });
    });

    return scoreMap;
  }

  renderEvaluationPanel() {
    const metricsContainer = document.querySelector('#metrics-list');
    if (!metricsContainer) {
      return;
    }

    const criteria = this.currentCriteria;
    const scoreMap = this.buildCurrentScoresByCriteria();

    if (!criteria.length) {
      metricsContainer.innerHTML = '<div class="radar-empty">Aucun critere configure pour ce prompt.</div>';
      this.drawRadar([]);
      return;
    }

    metricsContainer.innerHTML = criteria
      .map((criterion) => {
        const key = criterion.name.toLowerCase();
        const note = scoreMap.has(key) ? scoreMap.get(key) : null;
        const percent = Number.isFinite(note) ? Math.max(0, Math.min(100, (note / 20) * 100)) : 0;
        const scoreText = Number.isFinite(note) ? `${note}/20` : 'N/A';

        return `
          <div class="metric">
            <div class="metric-label">${criterion.name.toUpperCase()}</div>
            <div class="metric-meta">Coefficient: ${criterion.coefficient}</div>
            <div class="metric-bar">
              <div class="metric-fill dynamic" style="width: ${percent}%"></div>
              <div class="metric-score">${scoreText}</div>
            </div>
          </div>
        `;
      })
      .join('');

    const scoredCriteria = criteria.filter((criterion) => scoreMap.has(criterion.name.toLowerCase()));
    const radarData = scoredCriteria.map((criterion) => ({
      label: criterion.name,
      value: scoreMap.get(criterion.name.toLowerCase())
    }));

    this.drawRadar(radarData);
  }

  drawRadar(radarData) {
    const svg = document.querySelector('#radar-svg');
    if (!svg) {
      return;
    }

    const defs = svg.querySelector('defs');
    svg.innerHTML = '';
    if (defs) {
      svg.appendChild(defs);
    }

    if (!Array.isArray(radarData) || !radarData.length) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', '90');
      text.setAttribute('y', '92');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', 'rgba(255,255,255,0.65)');
      text.setAttribute('font-size', '12');
      text.textContent = 'Pas de score disponible';
      svg.appendChild(text);
      return;
    }

    const cx = 90;
    const cy = 90;
    const maxRadius = 62;
    const rings = [0.25, 0.5, 0.75, 1];
    const total = radarData.length;

    const pointAt = (index, radiusFactor) => {
      const angle = (-Math.PI / 2) + (index * ((Math.PI * 2) / total));
      const r = maxRadius * radiusFactor;
      return {
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r
      };
    };

    rings.forEach((ring) => {
      const points = radarData
        .map((_, index) => pointAt(index, ring))
        .map((p) => `${p.x},${p.y}`)
        .join(' ');
      const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      polygon.setAttribute('points', points);
      polygon.setAttribute('fill', 'none');
      polygon.setAttribute('stroke', 'rgba(255,255,255,0.12)');
      polygon.setAttribute('stroke-width', '1');
      svg.appendChild(polygon);
    });

    radarData.forEach((item, index) => {
      const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      const p = pointAt(index, 1);
      axis.setAttribute('x1', String(cx));
      axis.setAttribute('y1', String(cy));
      axis.setAttribute('x2', String(p.x));
      axis.setAttribute('y2', String(p.y));
      axis.setAttribute('stroke', 'rgba(255,255,255,0.12)');
      axis.setAttribute('stroke-width', '1');
      svg.appendChild(axis);

      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const lp = pointAt(index, 1.15);
      label.setAttribute('x', String(lp.x));
      label.setAttribute('y', String(lp.y));
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('fill', 'rgba(255,255,255,0.75)');
      label.setAttribute('font-size', '10');
      label.textContent = item.label.length > 16 ? `${item.label.slice(0, 16)}...` : item.label;
      svg.appendChild(label);
    });

    const valuePoints = radarData
      .map((item, index) => {
        const value = Math.max(0, Math.min(20, Number(item.value) || 0));
        return pointAt(index, value / 20);
      });

    const shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    shape.setAttribute('points', valuePoints.map((p) => `${p.x},${p.y}`).join(' '));
    shape.setAttribute('fill', 'url(#radarGradient)');
    shape.setAttribute('fill-opacity', '0.55');
    shape.setAttribute('stroke', 'rgba(255,255,255,0.8)');
    shape.setAttribute('stroke-width', '1.2');
    svg.appendChild(shape);

    valuePoints.forEach((p) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
      dot.setAttribute('r', '2.4');
      dot.setAttribute('fill', '#ffffff');
      svg.appendChild(dot);
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async loadPromptOptions() {
    const select = document.querySelector('#prompt-select');
    if (!select) {
      return;
    }

    try {
      const response = await fetch(this.config.promptsUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
      this.promptCatalog.clear();

      select.innerHTML = '';
      if (!prompts.length) {
        select.innerHTML = '<option value="">Aucun prompt disponible</option>';
        this.currentStages = [];
        this.currentCriteria = [];
        this.renderStepsPanel();
        this.renderEvaluationPanel();
        return;
      }

      prompts.forEach((prompt, index) => {
        const option = document.createElement('option');
        option.value = prompt.prompt_id || prompt.id;
        option.textContent = prompt.titre || `Prompt ${index + 1}`;
        select.appendChild(option);

        const key = option.value;
        this.promptCatalog.set(key, {
          stages: Array.isArray(prompt.stages) ? prompt.stages : [],
          criteria: Array.isArray(prompt.criteria) ? prompt.criteria : [],
          testeur_prompt: String(prompt.testeur_prompt || ''),
          testeur_actif: String(prompt.testeur_actif || 'false')
        });
      });

      this.setSelectedPrompt(select.value || null);
    } catch (error) {
      console.error('Prompt loading error:', error);
      select.innerHTML = '<option value="">Erreur chargement prompts</option>';
    }
  }

  startConversation() {
    // no auto message
  }

  updateAgentLabels() {
    document.querySelectorAll('.ai-message .message-label').forEach((label) => {
      label.textContent = this.config.agentName;
    });
  }
}

document.addEventListener('DOMContentLoaded', async function () {
  const agent = new ChatAgent(OPENAI_CONFIG);

  const emailNode = document.querySelector('.user-email');
  if (emailNode) {
    agent.setUserId(emailNode.textContent.trim());
  }

  agent.hideTypingIndicator();
  agent.updateAgentLabels();
  agent.startConversation();
  
  // Discover actual server port (handles port conflicts)
  await agent.discoverServerConfig();
  await agent.loadPromptOptions();

  const sendButton = document.querySelector('.send-button');
  const inputField = document.querySelector('.input-field');
  const promptSelect = document.querySelector('#prompt-select');

  if (promptSelect) {
    promptSelect.addEventListener('change', (event) => {
      agent.setSelectedPrompt(event.target.value || null);
      agent.addMessageToChat(agent.config.agentName, 'Nouveau prompt selectionne. Nouvelle conversation demarree.', 'ai');
    });
  }

  const testeurToggle = document.querySelector('#testeur-toggle');
  if (testeurToggle) {
    testeurToggle.addEventListener('click', () => agent.toggleTesteur());
  }

  sendButton.addEventListener('click', function () {
    const message = inputField.value.trim();
    if (message) {
      agent.sendMessage(message);
      inputField.value = '';
    }
  });

  inputField.addEventListener('keypress', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const message = this.value.trim();
      if (message) {
        agent.sendMessage(message);
        this.value = '';
      }
    }
  });

  const consoleErrors = document.querySelector('.console-errors');
  let errorCount = 0;

  consoleErrors.addEventListener('click', function () {
    if (errorCount === 0) {
      agent.addMessageToChat(agent.config.agentName, 'Aucune erreur console detectee.', 'ai');
    } else {
      agent.addMessageToChat(agent.config.agentName, `J'ai detecte ${errorCount} erreur(s) dans la console.`, 'ai');
    }
  });

  const originalError = console.error;
  console.error = function (...args) {
    errorCount += 1;
    document.querySelector('.console-errors span').textContent = `Send console errors (${errorCount})`;
    originalError.apply(console, args);
  };
});
