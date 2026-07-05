import { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged, signInWithPopup, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { auth, db, googleProvider } from "../lib/firebase";

interface AuthContextType {
  user: User | null;
  role: "free" | "premium" | "admin" | "superadmin" | null;
  subscriptionExpiry: Date | null;
  loading: boolean;
  loginWithGoogle: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  signupWithEmail: (email: string, pass: string, name?: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  subscriptionExpiry: null,
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
  const [subscriptionExpiry, setSubscriptionExpiry] = useState<Date | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribeSnapshot: (() => void) | null = null;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true);
      
      if (unsubscribeSnapshot) {
        unsubscribeSnapshot();
        unsubscribeSnapshot = null;
      }

      if (firebaseUser) {
        setUser(firebaseUser);
        try {
          const userDocRef = doc(db, "users", firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          
          if (!userDoc.exists()) {
            try {
              await setDoc(userDocRef, {
                email: firebaseUser.email,
                name: firebaseUser.displayName || "",
                role: "free",
                createdAt: new Date(),
              });
            } catch (err) {
              console.error("Could not create user doc", err);
            }
          }

          

          
          // Use Firestore user document for role mapping
          unsubscribeSnapshot = onSnapshot(userDocRef, (snap) => {
            if (snap.exists()) {
              const data = snap.data();
              let docRole = data.role || "free";
              let docExpiry = data.subscriptionExpiry ? data.subscriptionExpiry.toDate() : null;
              
              // Hardcoded superadmin email check
              if (firebaseUser.email === "shivaminfotech89@gmail.com") {
                docRole = "superadmin";
              }
              
              if (docRole === "premium" && docExpiry && docExpiry < new Date()) {
                 docRole = "free";
              }
              setRole(docRole);
              setSubscriptionExpiry(docExpiry);
            } else {
               if (firebaseUser.email === "shivaminfotech89@gmail.com") {
                  setRole("superadmin");
               } else {
                  setRole("free");
               }
               setSubscriptionExpiry(null);
            }
          });
          setLoading(false);
        } catch (error) {
          console.error("Error fetching user claims", error);
          setRole("free");
          setSubscriptionExpiry(null);
          setLoading(false);
        }
      } else {
        setUser(null);
        setRole(null);
        setSubscriptionExpiry(null);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe();
      if (unsubscribeSnapshot) unsubscribeSnapshot();
    };
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
      } else if (error.code === 'auth/unauthorized-domain') {
        errorMessage = `This domain is not authorized for Google Sign-In. Please add ${window.location.hostname} to your Firebase Console -> Authentication -> Settings -> Authorized domains.`;
      } else if (error.message.includes("Cross-Origin") || error.message.includes("popup")) {
        errorMessage += "\n\nIf you are viewing this in an iframe, please open the app in a new tab to log in with Google.";
      }
      throw new Error(errorMessage);
    }
  };

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const signupWithEmail = async (email: string, pass: string, name?: string, phone?: string) => {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      email: cred.user.email,
      name: name || "",
      phone: phone || "",
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
    <AuthContext.Provider value={{ user, role, loading, subscriptionExpiry, loginWithGoogle, loginWithEmail, signupWithEmail, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
