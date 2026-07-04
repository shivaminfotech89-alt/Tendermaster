import { auth } from "./firebase";

export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  
  try {
    const user = auth.currentUser;
    if (user) {
      const idToken = await user.getIdToken(true);
      headers.set("Authorization", `Bearer ${idToken}`);
    }
  } catch (error) {
    console.error("Failed to retrieve Firebase ID token:", error);
  }

  // Ensure Content-Type is set to application/json by default for strings
  if (options.body && !headers.has("Content-Type") && typeof options.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  return fetch(url, {
    ...options,
    headers,
  });
}
