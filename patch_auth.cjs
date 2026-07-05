const fs = require('fs');
let content = fs.readFileSync('src/lib/firebase.ts', 'utf-8');

if (!content.includes('setPersistence')) {
    content = content.replace(
        'import { getAuth, GoogleAuthProvider, EmailAuthProvider } from "firebase/auth";',
        'import { getAuth, GoogleAuthProvider, EmailAuthProvider, setPersistence, browserLocalPersistence } from "firebase/auth";'
    );
    content = content.replace(
        'export const auth = getAuth(app);',
        'export const auth = getAuth(app);\nsetPersistence(auth, browserLocalPersistence).catch(console.error);'
    );
    fs.writeFileSync('src/lib/firebase.ts', content, 'utf-8');
}
