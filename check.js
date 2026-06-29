import http from 'http';
http.get('http://0.0.0.0:3000', (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode));
}).on('error', (err) => console.error('Error:', err.message));
