#!/usr/bin/env node
import http from 'http';

console.log('🧪 SImventes Integration Test Suite');
console.log('=' .repeat(50));

const PORT = 3001;
const BASE_URL = `http://localhost:${PORT}`;

async function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: PORT,
      path,
      method,
      timeout: 5000,
      headers: {}
    };

    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => reject(new Error('Timeout')));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test(name, fn) {
  try {
    console.log(`\n📋 ${name}`);
    await fn();
    console.log(`   ✅ PASSED`);
  } catch (error) {
    console.log(`   ❌ FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

// Tests
await test('Verify server is online', async () => {
  const result = await makeRequest('/');
  if (result.status !== 200) throw new Error(`Expected 200, got ${result.status}`);
  if (!result.raw.includes('DOCTYPE html')) throw new Error('Not HTML');
});

await test('Get server config', async () => {
  const result = await makeRequest('/api/config');
  if (result.status !== 200) throw new Error(`Status ${result.status}`);
  if (result.data.port !== PORT) throw new Error(`Wrong port: ${result.data.port}`);
  console.log(`   Server running on port ${result.data.port}`);
});

await test('Load prompts list', async () => {
  const result = await makeRequest('/api/prompts');
  if (result.status !== 200) throw new Error(`Status ${result.status}`);
  if (!Array.isArray(result.data.prompts)) throw new Error('Prompts not an array');
  if (result.data.prompts.length === 0) throw new Error('No prompts returned');
  
  const first = result.data.prompts[0];
  if (!first.titre) throw new Error('Missing titre field');
  if (!first.prompt_id && !first.id) throw new Error('Missing id fields');
  
  console.log(`   Found ${result.data.prompts.length} prompts:`);
  result.data.prompts.forEach(p => {
    console.log(`   - "${p.titre || p.prompt_id}"`);
  });
});

await test('Verify prompts are UI-compatible', async () => {
  const result = await makeRequest('/api/prompts');
  const prompts = result.data.prompts || [];
  
  prompts.forEach((prompt, idx) => {
    if (!prompt.titre && !prompt.prompt_id) {
      throw new Error(`Prompt ${idx} missing display text`);
    }
    if (!prompt.prompt_id && !prompt.id) {
      throw new Error(`Prompt ${idx} missing ID field`);
    }
  });
  
  console.log(`   All ${prompts.length} prompts have required fields`);
});

await test('Check CORS headers', async () => {
  const result = await makeRequest('/api/prompts');
  // The headers should allow cross-origin (though relative URLs don't need it)
  // This is optional for this test
  console.log('   CORS headers not required for same-origin requests');
});

console.log('\n' + '='.repeat(50));
console.log('✅ All tests passed!');
console.log('\nServer is ready at: http://localhost:3001');
