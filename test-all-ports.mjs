import http from 'http';

async function testPort(port) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port,
      path: '/api/prompts',
      method: 'GET',
      timeout: 2000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        console.log(`✓ Port ${port}: Status ${res.statusCode}`);
        try {
          const parsed = JSON.parse(data);
          console.log(`  Prompts:`, parsed.prompts ? `${parsed.prompts.length} items` : 'none');
        } catch (e) {
          console.log(`  Response: ${data.substring(0, 100)}`);
        }
        resolve(true);
      });
    });

    req.on('error', (error) => {
      console.log(`✗ Port ${port}: ${error.message}`);
      resolve(false);
    });

    req.on('timeout', () => {
      console.log(`✗ Port ${port}: Timeout`);
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

console.log('Testing ports...');
await testPort(3000);
await testPort(3001);
await testPort(3002);
