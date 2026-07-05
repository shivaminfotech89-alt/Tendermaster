const http = require('http');

const req = http.request({
  hostname: 'localhost',
  port: 3000,
  path: '/api/generate-doc',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer test'
  }
}, (res) => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response:', data));
});
req.write(JSON.stringify({docType: "Test", tenderDetails: {}}));
req.end();
