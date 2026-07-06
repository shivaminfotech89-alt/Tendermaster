const express = require('express');
const app = express();
app.get('/', (req, res) => {
  res.status("400").json({ error: "test" });
});
const server = app.listen(0, async () => {
  const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
  const res = await fetch(`http://localhost:${server.address().port}/`);
  console.log("Status:", res.status);
  server.close();
});
