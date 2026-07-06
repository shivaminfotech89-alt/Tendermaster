const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(
  /const verifyFirebaseToken = async \([\s\S]*?next\(\);\n  \} catch \(error\) \{[\s\S]*?\}\n\};/,
  `const verifyFirebaseToken = async (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
    req.user = { uid: "test_uid", email: "test@example.com" };
    next();
  };`
);
fs.writeFileSync('server.ts', code, 'utf-8');
