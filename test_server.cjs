const express = require('express');
const app = express();
app.use(express.json());

app.post('/api/test', (req, res) => {
  const error = {
    statusCode: 400,
    error: {
      code: "BAD_REQUEST_ERROR",
      description: "Recurring digits in customer contact are disallowed"
    }
  };
  res.status(500).json({ error: error?.error?.description || error?.message || "Failed" });
});

const server = app.listen(0, async () => {
  const port = server.address().port;
  const fetch = (await import('node-fetch')).default;
  const res = await fetch(`http://127.0.0.1:${port}/api/test`, { method: 'POST' });
  const text = await res.text();
  console.log(text);
  server.close();
});
