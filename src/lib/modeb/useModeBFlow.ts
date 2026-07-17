/**
 * useModeBFlow — React hook for the Mode B (exact-form overlay) pipeline.
 *
 * Stage machine: idle → uploading → probing → reviewing → exporting → done
 *
 * The hook keeps the original PDF ArrayBuffer in a ref across re-renders so
 * overlayFields() never needs a re-fetch after the user edits fields.
 */

import { useState, useRef } from 'react';
import { toast } from 'react-hot-toast';
import { fetchWithAuth } from '../api';
import { mapFields } from './fieldMapper';
import { overlayFields } from './overlay';
import type { BusinessProfile, Director, TenderData, MappedField, DetectedField } from './types';

export type ModeBStage = 'idle' | 'uploading' | 'probing' | 'reviewing' | 'exporting' | 'done';

export function useModeBFlow(options: {
  businessProfile: BusinessProfile | null;
  directors?: Director[];
  tenderData?: TenderData;
  /** Called after the filled PDF is generated. Page handles Storage + Firestore. */
  onSave?: (blob: Blob, filename: string) => Promise<void>;
}) {
  const { businessProfile, directors = [], tenderData, onSave } = options;

  const [stage,        setStage]        = useState<ModeBStage>('idle');
  const [formFile,     setFormFile]     = useState<File | null>(null);
  const [pageW,        setPageW]        = useState(612);
  const [pageH,        setPageH]        = useState(792);
  const [pageCount,    setPageCount]    = useState(1);
  const [mappedFields, setMappedFields] = useState<MappedField[] | null>(null);
  const [error,        setError]        = useState<string | null>(null);

  // Original bytes kept in a ref — never triggers re-renders
  const origBytesRef = useRef<ArrayBuffer | null>(null);

  const selectFile = (file: File | null) => {
    origBytesRef.current = null;
    setFormFile(file);
    setStage('idle');
    setMappedFields(null);
    setError(null);
  };

  const reset = () => {
    origBytesRef.current = null;
    setFormFile(null);
    setStage('idle');
    setMappedFields(null);
    setError(null);
  };

  const startFlow = async (uid: string) => {
    if (!formFile) return;
    if (!businessProfile) {
      setError('Complete your business profile before using Vision fill.');
      return;
    }
    setError(null);

    // ── Read file bytes (kept for overlay) ────────────────────────────────────
    let bytes: ArrayBuffer;
    try {
      bytes = await formFile.arrayBuffer();
      origBytesRef.current = bytes;
    } catch (e: any) {
      setError('Could not read file: ' + e.message);
      return;
    }

    // ── Upload blank form to Firebase Storage ─────────────────────────────────
    setStage('uploading');
    let storageUrl: string;
    try {
      const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
      const { storage } = await import('../firebase');
      const path = `users/${uid}/form-uploads/${Date.now()}-${formFile.name}`;
      const fileRef = ref(storage, path);
      await uploadBytes(fileRef, new Uint8Array(bytes));
      storageUrl = await getDownloadURL(fileRef);
    } catch (e: any) {
      setStage('idle');
      setError('Upload failed: ' + e.message);
      return;
    }

    // ── Vision probe (server-side — Gemini API key stays on server) ───────────
    setStage('probing');
    let probe: { fields: DetectedField[]; pageW: number; pageH: number; pageCount: number; partial?: boolean; failedPages?: number[] };
    try {
      const res = await fetchWithAuth('/api/modeb/probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storageUrl }),
      });
      const json = await res.json().catch(() => ({})) as any;
      if (!res.ok) {
        setStage('idle');
        setError(json.error ?? 'Field detection failed. Please try again.');
        return;
      }
      probe = json;
      if (!Array.isArray(probe.fields) || probe.fields.length === 0) {
        setStage('idle');
        setError('No fillable fields detected on this form. Try a clearer scan.');
        return;
      }
      if (probe.partial && probe.failedPages?.length) {
        toast.error(
          `Page${probe.failedPages.length > 1 ? 's' : ''} ${probe.failedPages.join(', ')} could not be scanned — review detected fields and fill those pages manually.`,
          { duration: 7000 },
        );
      }
    } catch {
      setStage('idle');
      setError('Network error during field detection. Please try again.');
      return;
    }

    // ── Map fields (pure, client-side) ────────────────────────────────────────
    const mapped = mapFields(
      probe.fields,
      probe.pageW,
      probe.pageH,
      businessProfile,
      directors,
      tenderData,
    );

    setPageW(probe.pageW);
    setPageH(probe.pageH);
    setPageCount(probe.pageCount);
    setMappedFields(mapped);
    setStage('reviewing');
  };

  const confirmExport = async (editedFields: MappedField[]) => {
    const origBytes = origBytesRef.current;
    if (!origBytes) {
      setError('Original form data lost — please re-upload the form.');
      return;
    }

    setStage('exporting');
    setError(null);

    // ── pdf-lib overlay (client-side, no debug boxes) ─────────────────────────
    let filledBytes: Uint8Array;
    try {
      const { pdfBytes, warnings } = await overlayFields(origBytes, editedFields, { debugBoxes: false });
      filledBytes = pdfBytes;
      if (warnings.length) console.warn('[ModeBFlow] overlay skipped fields:', warnings);
    } catch (e: any) {
      setStage('reviewing');
      setError('PDF overlay failed: ' + e.message);
      return;
    }

    const filename = formFile
      ? formFile.name.replace(/(\.[^.]+)?$/, '_filled.pdf')
      : 'filled_form.pdf';
    const blob = new Blob([filledBytes], { type: 'application/pdf' });

    // ── Trigger browser download (always — save is non-fatal) ─────────────────
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

    // ── Persist to project (non-fatal) ────────────────────────────────────────
    if (onSave) {
      try { await onSave(blob, filename); }
      catch (e: any) { console.warn('[ModeBFlow] onSave failed (non-fatal):', e.message); }
    }

    setStage('done');
  };

  return {
    stage, formFile, pageW, pageH, pageCount, mappedFields, error,
    selectFile, startFlow, confirmExport, reset,
  };
}
