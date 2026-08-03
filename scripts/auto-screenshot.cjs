const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const AUTH_PROVIDER_PATH = path.join(__dirname, "..", "src", "auth", "AuthProvider.tsx");
const AUTH_BACKUP_PATH = AUTH_PROVIDER_PATH + ".bak";

const PAGES = [
  { name: "dashboard", path: "/dashboard", filename: "real_dashboard.png" },
  { name: "projects", path: "/dashboard/projects", filename: "real_projects.png" },
  { name: "analyzer", path: "/dashboard/analyzer", filename: "real_analyzer.png" },
  { name: "chat", path: "/dashboard/chat", filename: "real_chat.png" },
  { name: "profile", path: "/dashboard/profile", filename: "real_profile.png" },
  { name: "settings", path: "/dashboard/settings", filename: "real_settings.png" }
];

const MOCK_AUTH_INJECTION = `
// ==================== MOCK BYPASS FOR SCREENSHOTS ====================
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>({
    uid: "LTYdwnz0YcM7ZxMH5R1whMiwf113",
    email: "shivaminfotech89@gmail.com",
    displayName: "megha parekh"
  });
  const [role, setRole] = useState<any>("superadmin");
  const [credits, setCredits] = useState<any>({
    total: 10,
    used: 2,
    expiry: new Date("2028-12-31"),
    hasCredits: true
  });
  const [loading, setLoading] = useState(false);

  const loginWithGoogle = async () => {};
  const loginWithEmail = async () => {};
  const signupWithEmail = async () => {};
  const logout = async () => {};

  return (
    <AuthContext.Provider value={{ user, role, credits, loading, loginWithGoogle, loginWithEmail, signupWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
`;

function injectMockAuth() {
  console.log("Backing up AuthProvider.tsx...");
  const content = fs.readFileSync(AUTH_PROVIDER_PATH, "utf8");
  fs.writeFileSync(AUTH_BACKUP_PATH, content, "utf8");

  // Locate the AuthProvider function and replace it with mock
  const searchStr = "export function AuthProvider({ children }: { children: React.ReactNode }) {";
  const startIdx = content.indexOf(searchStr);
  if (startIdx === -1) {
    throw new Error("Could not find AuthProvider declaration in AuthProvider.tsx");
  }

  const before = content.slice(0, startIdx);
  const updatedContent = before + MOCK_AUTH_INJECTION;

  console.log("Injecting mock AuthProvider into code...");
  fs.writeFileSync(AUTH_PROVIDER_PATH, updatedContent, "utf8");
}

function restoreAuth() {
  if (fs.existsSync(AUTH_BACKUP_PATH)) {
    console.log("Restoring original AuthProvider.tsx...");
    const content = fs.readFileSync(AUTH_BACKUP_PATH, "utf8");
    fs.writeFileSync(AUTH_PROVIDER_PATH, content, "utf8");
    fs.unlinkSync(AUTH_BACKUP_PATH);
    console.log("Restored successfully. Backup deleted.");
  }
}

async function run() {
  console.log("Starting automated screenshot capture sequence...");

  try {
    injectMockAuth();
    
    // Give Vite 3 seconds to hot-reload the changes
    console.log("Waiting 3s for dev server to reload...");
    await new Promise(r => setTimeout(r, 3000));

    console.log("Launching headless browser...");
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    console.log("Capturing screenshots of pages...");
    const baseDir = path.join(__dirname, "..", "public");

    for (const item of PAGES) {
      const targetUrl = `http://localhost:3000${item.path}`;
      console.log(`- Capturing ${item.name} at ${targetUrl}...`);
      try {
        await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 25000 });
        // Extra wait for chart animations
        await page.waitForTimeout(4000);
        const savePath = path.join(baseDir, item.filename);
        await page.screenshot({ path: savePath });
        console.log(`  Saved ${item.filename} ✅`);
      } catch (err) {
        console.error(`  [Failed] ${item.name}:`, err.message);
      }
    }

    await browser.close();
  } catch (err) {
    console.error("Critical screenshot runner error:", err.message);
  } finally {
    restoreAuth();
  }

  console.log("Automated capture sequence finished.");
}

run();
