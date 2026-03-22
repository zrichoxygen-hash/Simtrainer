import http from 'http';

console.log('Testing GET / endpoint...');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/',
  method: 'GET',
  timeout: 3000
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    console.log(`Received ${data.length} bytes`);
    console.log(data.substring(0, 200));
    process.exit(0);
  });
});

req.on('error', (error) => {
  console.error('Error:', error.message);
  process.exit(1);
});

req.on('timeout', () => {
  console.error('Timeout');
  process.exit(1);
});

req.end();
