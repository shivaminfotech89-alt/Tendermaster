const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/generate-doc',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer NOT_A_REAL_TOKEN'
  }
};

const req = http.request(options, res => {
  let data = '';
  res.on('data', d => data += d);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});
req.write(JSON.stringify({ docType: "Cover Letter", tenderDetails: {title: "Test"}, userProfile: {name: "Test Co"} }));
req.end();
