const fs = require('fs');

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Add import
content = content.replace(
    `import Login from "./pages/Login";`,
    `import Login from "./pages/Login";\nimport LandingPage from "./pages/LandingPage";`
);

// Add Route and change Layout path
content = content.replace(
    `<Route path="/login" element={<Login />} />`,
    `<Route path="/" element={<LandingPage />} />\n              <Route path="/login" element={<Login />} />`
);

content = content.replace(
    `<Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>`,
    `<Route path="/dashboard" element={<ProtectedRoute><Layout /></ProtectedRoute>}>`
);

// Update Navigate to "/" to "/dashboard" where applicable (except in superAdminOnly / adminOnly which can go to /dashboard)
content = content.replace(
    `if (superAdminOnly && role !== "superadmin") return <Navigate to="/" />;`,
    `if (superAdminOnly && role !== "superadmin") return <Navigate to="/dashboard" />;`
);
content = content.replace(
    `if (adminOnly && role !== "admin" && role !== "superadmin") return <Navigate to="/" />;`,
    `if (adminOnly && role !== "admin" && role !== "superadmin") return <Navigate to="/dashboard" />;`
);

fs.writeFileSync('src/App.tsx', content, 'utf-8');
console.log("App.tsx patched.");
