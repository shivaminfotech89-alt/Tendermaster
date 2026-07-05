const fs = require('fs');
let content = fs.readFileSync('src/auth/AuthProvider.tsx', 'utf8');

const target = `          unsubscribeSnapshot = onSnapshot(userDocRef, async (snap) => {
            let currentRole = "free";
            let currentExpiry = null;
            if (snap.exists()) {
              const data = snap.data();
              currentRole = data.role || "free";
              if (data.subscriptionExpiry) {
                currentExpiry = data.subscriptionExpiry.toDate();
                if (currentRole === "premium" && currentExpiry < new Date()) {
                  currentRole = "free";
                  try {
                    await setDoc(userDocRef, { role: "free" }, { merge: true });
                  } catch(e) {}
                }
              }
            }

            if (firebaseUser.email === "shivaminfotech89@gmail.com") {
              currentRole = "superadmin";
              try {
                await setDoc(userDocRef, { role: "superadmin" }, { merge: true });
              } catch (err) {
                console.log("Superadmin role set locally (firestore write rejected by rules, but local role granted).");
              }
            }
            
            setRole(currentRole as any);
            setSubscriptionExpiry(currentExpiry);
            setLoading(false);
          });
        } catch (error) {
          console.error("Error fetching user role", error);
          setRole("free");
          setSubscriptionExpiry(null);
          setLoading(false);
        }
      } else {`;

const replacement = `          
          // Phase 1: Read role and expiry from token custom claims instead of Firestore
          const tokenResult = await firebaseUser.getIdTokenResult();
          const claims = tokenResult.claims;
          let currentRole = claims.role as any || "free";
          let currentExpiry = null;
          
          if (claims.subscriptionExpiry) {
             currentExpiry = new Date(claims.subscriptionExpiry as string);
             if (currentRole === "premium" && currentExpiry < new Date()) {
                currentRole = "free";
             }
          }
          
          setRole(currentRole);
          setSubscriptionExpiry(currentExpiry);
          
          // Still listen to the user doc for other profile fields (if needed by other parts of the app),
          // but we no longer derive role from it.
          unsubscribeSnapshot = onSnapshot(userDocRef, (snap) => {
            // Document updates can trigger here, but role is locked to the token claims.
            // If the server changes claims, we need to refresh the token manually.
          });
          setLoading(false);
        } catch (error) {
          console.error("Error fetching user claims", error);
          setRole("free");
          setSubscriptionExpiry(null);
          setLoading(false);
        }
      } else {`;

content = content.replace(target, replacement);

fs.writeFileSync('src/auth/AuthProvider.tsx', content);
