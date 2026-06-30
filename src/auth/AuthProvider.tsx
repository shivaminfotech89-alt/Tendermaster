import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextType {
  user: User | null;
  role: "free" | "premium" | "admin" | "superadmin" | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  loading: true,
  loginWithGoogle: async () => {},
  loginWithEmail: async () => {},
  signupWithEmail: async () => {},
  logout: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<"free" | "premium" | "admin" | "superadmin" | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          let currentRole = "free";
          
          if (!userDoc.exists()) {
            try {
              await setDoc(doc(db, "users", firebaseUser.uid), {
                email: firebaseUser.email,
                role: "free",
                createdAt: new Date(),
              });
            } catch (err) {
              console.error("Could not create user doc", err);
            }
          } else {
            currentRole = userDoc.data().role || "free";
          }
          
          if (firebaseUser.email === "shivaminfotech89@gmail.com") {
            currentRole = "superadmin";
            try {
              await setDoc(doc(db, "users", firebaseUser.uid), { role: "superadmin" }, { merge: true });
            } catch (err) {
              console.log("Superadmin role set locally (firestore write rejected by rules, but local role granted).");
            }
          }
          
          setRole(currentRole as any);
        } catch (error) {
          console.error("Error fetching user role", error);
          setRole("free");
        }
      } else {
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/popup-closed-by-user') {
        throw new Error("Popup closed. Please try again.");
      }
      let errorMessage = error.message;
      if (error.code === 'auth/operation-not-allowed') {
        errorMessage = "Google Sign-In is not enabled. Please go to your Firebase Console -> Authentication -> Sign-in method, and enable Google.";
      } else if (error.message.includes("Cross-Origin") || error.message.includes("popup")) {
        errorMessage += "\n\nIf you are viewing this in an iframe, please open the app in a new tab to log in with Google.";
      }
      throw new Error(errorMessage);
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const signupWithEmail = async (email: string, pass: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      email: cred.user.email,
      role: "free",
      createdAt: new Date()
    });
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, role, loading, loginWithGoogle, loginWithEmail, signupWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
