const fs = require('fs');

const env = Object.fromEntries(
  fs
    .readFileSync('.env', 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => {
      const i = line.indexOf('=');
      return [line.slice(0, i), line.slice(i + 1)];
    })
);

const key = env.OPENAI_API_KEY;
const wf = env.WORKFLOW_ID;
const model = env.OPENAI_MODEL || 'gpt-4o-mini';

const candidates = [
  { url: `https://api.openai.com/v1/workflows/${wf}/runs`, body: { input: 'ping' } },
  { url: `https://api.openai.com/v1/workflows/${wf}/execute`, body: { input: 'ping' } },
  { url: 'https://api.openai.com/v1/workflows/runs', body: { workflow_id: wf, input: 'ping' } },
  { url: 'https://api.openai.com/v1/workflows/execute', body: { workflow_id: wf, input: 'ping' } },
  { url: `https://api.openai.com/v1/agents/${wf}/runs`, body: { input: 'ping' } },
  { url: 'https://api.openai.com/v1/workflow_runs', body: { workflow_id: wf, input: 'ping' } },
  { url: 'https://api.openai.com/v1/responses', body: { model, workflow_id: wf, input: 'ping' } },
  { url: 'https://api.openai.com/v1/responses', body: { model, workflow: wf, input: 'ping' } },
  { url: 'https://api.openai.com/v1/responses', body: { model, metadata: { workflow_id: wf }, input: 'ping' } }
];

(async () => {
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify(candidate.body)
      });

      const text = await response.text();
      const summary = text.replace(/\s+/g, ' ').slice(0, 220);
      console.log(`${response.status} | ${candidate.url}`);
      console.log(`  ${summary}`);
    } catch (error) {
      console.log(`ERR | ${candidate.url}`);
      console.log(`  ${error.message}`);
    }
  }
})();
