const baseUrl = 'http://localhost:3000';

const promptsResp = await fetch(`${baseUrl}/api/prompts`);
const promptsData = await promptsResp.json();
const promptId = promptsData?.prompts?.[0]?.prompt_id;

if (!promptId) {
  console.error('No prompt id available');
  process.exit(1);
}

const firstPayload = {
  message: 'Bonjour, je suis pret pour la simulation.',
  conversationHistory: [],
  promptId,
  userId: 'zakaria@test.local'
};

const firstResp = await fetch(`${baseUrl}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(firstPayload)
});

const firstJson = await firstResp.json();
console.log('TURN1', firstResp.status, JSON.stringify(firstJson));

if (!firstJson.conversationId) {
  process.exit(0);
}

const secondPayload = {
  message: 'Pouvez-vous me parler de vos besoins actuels ?',
  conversationHistory: [],
  promptId,
  conversationId: firstJson.conversationId,
  userId: 'zakaria@test.local'
};

const secondResp = await fetch(`${baseUrl}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(secondPayload)
});

const secondJson = await secondResp.json();
console.log('TURN2', secondResp.status, JSON.stringify(secondJson));
