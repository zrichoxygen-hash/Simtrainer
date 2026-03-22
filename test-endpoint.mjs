import http from 'http';

console.log('Testing /api/prompts endpoint...');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/prompts',
  method: 'GET',
  timeout: 5000
};

const req = http.request(options, (res) => {
  let data = '';
  
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', JSON.stringify(res.headers, null, 2));

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log('Response body:');
    console.log(data.substring(0, 500));
    try {
      const parsed = JSON.parse(data);
      console.log('\nParsed JSON:');
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log('(Not valid JSON)');
    }
    process.exit(0);
  });
});

req.on('error', (error) => {
  console.error('Request error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Request timeout');
  req.destroy();
  process.exit(1);
});

req.end();
