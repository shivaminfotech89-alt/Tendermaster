import { useState, useCallback } from 'react';
import type { ExtractionResult, ColumnMapping } from '../types/boq';
import { extractBoqFromPdf } from '../services/boqPdfExtractService';
import { extractBoqFromExcel } from '../services/boqExcelImportService';

type ImportState = 'idle' | 'loading' | 'scanned' | 'needs_mapping' | 'ready' | 'error';

interface UseBoqImportReturn {
  state: ImportState;
  result: ExtractionResult | null;
  pendingMapping: ColumnMapping | null;
  error: string | null;
  importFile: (file: File) => Promise<void>;
  applyManualMapping: (mapping: ColumnMapping) => void;
  reset: () => void;
}

export default function useBoqImport(): UseBoqImportReturn {
  const [state, setState] = useState<ImportState>('idle');
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [pendingMapping, setPendingMapping] = useState<ColumnMapping | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importFile = useCallback(async (file: File) => {
    setState('loading');
    setError(null);
    setResult(null);
    setPendingMapping(null);

    try {
      const buffer = await file.arrayBuffer();
      let extracted: ExtractionResult;

      const name = file.name.toLowerCase();
      if (name.endsWith('.pdf')) {
        extracted = await extractBoqFromPdf(buffer);
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        extracted = await extractBoqFromExcel(buffer);
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or Excel file.');
      }

      setResult(extracted);

      if (extracted.isScanned) {
        setState('scanned');
      } else if (extracted.confidence.overallConfidence < 80) {
        // Store current mapping for manual override
        const firstHeader = extracted.tables.find(t => t.header)?.header;
        setPendingMapping(firstHeader?.mapping ?? {});
        setState('needs_mapping');
      } else {
        setState('ready');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error during extraction.';
      setError(msg);
      setState('error');
    }
  }, []);

  const applyManualMapping = useCallback((mapping: ColumnMapping) => {
    if (!result) return;

    // Re-classify tables with the new mapping injected into the first BOQ table
    const updatedTables = result.tables.map((table, idx) => {
      if (idx !== 0 || !table.header) return table;
      return {
        ...table,
        header: { ...table.header, mapping },
      };
    });

    setResult({ ...result, tables: updatedTables });
    setPendingMapping(null);
    setState('ready');
  }, [result]);

  const reset = useCallback(() => {
    setState('idle');
    setResult(null);
    setPendingMapping(null);
    setError(null);
  }, []);

  return { state, result, pendingMapping, error, importFile, applyManualMapping, reset };
}
