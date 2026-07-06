const mod = require('./dist/server.cjs');
console.log(mod.default ? "Has default" : "No default", typeof mod);
