import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { removeUndefined } from '../lib/firestore';
import type { ItemPricing, ItemValidation } from '../types/boqPricing';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

const SAVE_DEBOUNCE_MS = 1000;

type EditablePricingFields = Pick<
  ItemPricing,
  'bidRate' | 'discountPercent' | 'premiumPercent' | 'remarks' | 'quotedAmount'
>;

interface UsePricingAutosaveResult {
  pricing: Record<string, ItemPricing>;
  loaded: boolean;
  saveState: SaveState;
  updateItem: (key: string, patch: Partial<EditablePricingFields>, validation: ItemValidation) => void;
}

/**
 * Debounced read/write of saved_tenders/{projectId}/boq_pricing/latest —
 * the per-item rate/discount/premium/remarks map for the item-rate pricing
 * grid. Mirrors the setTimeout/clearTimeout debounce idiom already used for
 * the aggregate `boq` field (ProjectDetails.tsx:handleBoqChange), but keyed
 * separately since per-item data has no home in the BOQData shape.
 */
export default function usePricingAutosave(projectId: string | undefined): UsePricingAutosaveResult {
  const [pricing, setPricing] = useState<Record<string, ItemPricing>>({});
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const pricingRef = useRef<Record<string, ItemPricing>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId) return;
    setLoaded(false);
    const ref = doc(db, 'saved_tenders', projectId, 'boq_pricing', 'latest');
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? (snap.data() as { items?: Record<string, ItemPricing> }) : null;
        const items = data?.items ?? {};
        pricingRef.current = items;
        setPricing(items);
        setLoaded(true);
      },
      (err) => {
        console.error('[usePricingAutosave] snapshot error', err);
        setLoaded(true);
      },
    );
    return () => unsub();
  }, [projectId]);

  const scheduleSave = useCallback(() => {
    if (!projectId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaveState('saving');
      const ref = doc(db, 'saved_tenders', projectId, 'boq_pricing', 'latest');
      setDoc(ref, removeUndefined({ items: pricingRef.current, updatedAt: serverTimestamp() }), { merge: true })
        .then(() => setSaveState('saved'))
        .catch((err) => {
          console.error('[usePricingAutosave] save failed', err);
          setSaveState('error');
        });
    }, SAVE_DEBOUNCE_MS);
  }, [projectId]);

  const updateItem = useCallback(
    (key: string, patch: Partial<EditablePricingFields>, validation: ItemValidation) => {
      const next = {
        ...pricingRef.current,
        [key]: { ...pricingRef.current[key], ...patch, validation },
      };
      pricingRef.current = next;
      setPricing(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  return { pricing, loaded, saveState, updateItem };
}
