import { useEffect, useRef } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";

type Tier = "7d" | "3d" | "1d" | "overdue";

function parseDeadline(str: string | undefined): Date | null {
  if (!str || typeof str !== "string") return null;
  const t = str.trim().toLowerCase();
  if (!t || t.includes("not") || t.includes("tbd") || t.includes("n/a")) return null;
  const d = new Date(str.trim());
  return isNaN(d.getTime()) ? null : d;
}

function getTier(daysUntil: number): Tier | null {
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 1) return "1d";
  if (daysUntil <= 3) return "3d";
  if (daysUntil <= 7) return "7d";
  return null;
}

function buildMessage(tier: Tier, name: string, daysUntil: number, dateStr: string): string {
  const q = `"${name}"`;
  switch (tier) {
    case "overdue":
      return `⏰ Tender ${q} deadline has passed (${dateStr}). Check your submission status.`;
    case "1d":
      return `⏰ Tender ${q} closes ${daysUntil <= 0 ? "today" : "tomorrow"} (${dateStr}). Prepare your submission now.`;
    case "3d":
      return `⏰ Tender ${q} closes in 3 days (${dateStr}). Prepare your submission.`;
    case "7d":
      return `⏰ Tender ${q} closes in 7 days (${dateStr}). Start your submission preparation.`;
  }
}

/**
 * Checks each saved tender's submission_deadline and creates a Firestore
 * notification for any approaching or overdue deadline — once per tier per tender.
 *
 * Deduplication:
 *  1. Firestore-level: each notification carries a `dedupeKey` field
 *     (e.g. "deadline-{tenderId}-3d"). We build a Set from the already-loaded
 *     `notifications` array and skip any key that's already present.
 *  2. In-session: a useRef<Set> prevents double-writes if onSnapshot fires
 *     before the newly-created doc returns, or if dependencies update rapidly.
 */
export function useDeadlineReminders(
  userId: string | null | undefined,
  savedTenders: any[],
  notifications: any[],
): void {
  const processedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || savedTenders.length === 0) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Keys already persisted in Firestore (loaded via onSnapshot)
    const existingKeys = new Set<string>(
      notifications.map((n: any) => n.dedupeKey as string | undefined).filter(Boolean) as string[],
    );

    for (const tender of savedTenders) {
      const deadline = parseDeadline(
        tender.details?.timeline_and_milestones?.submission_deadline,
      );
      if (!deadline) continue;

      const daysUntil = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
      const tier = getTier(daysUntil);
      if (!tier) continue;

      const dedupeKey = `deadline-${tender.id}-${tier}`;

      // Skip if already exists in Firestore or already created this session
      if (existingKeys.has(dedupeKey)) continue;
      if (processedRef.current.has(dedupeKey)) continue;

      // Mark before the async write so rapid re-renders don't double-fire
      processedRef.current.add(dedupeKey);

      const tenderName =
        tender.projectName ||
        tender.details?.tender_simplified?.tender_name ||
        "Unnamed Tender";

      const dateStr = deadline.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });

      addDoc(collection(db, "notifications"), {
        userId,
        message: buildMessage(tier, tenderName, daysUntil, dateStr),
        dedupeKey,
        read: false,
        createdAt: serverTimestamp(),
        type: "deadline_reminder",
      }).catch((e) => console.error("Failed to create deadline notification:", e));
    }
  }, [userId, savedTenders, notifications]);
}
