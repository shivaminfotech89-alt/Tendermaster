export interface BoqItem {
  id: string;
  itemNo: string;
  code?: string;
  description: string;
  unit: string;
  quantity: number;
  estimatedRate?: number;
  bidRate?: number;
  amount?: number;
  gst?: number;
  remarks?: string;
  schedule?: string;
}

export interface RateAnalysis {
  id: string;
  itemNo: string;
  materialCost?: number;
  labourCost?: number;
  machineryCost?: number;
  transportCost?: number;
  totalCost?: number;
  remarks?: string;
}

export type ColumnRole =
  | 'item_no' | 'description' | 'unit' | 'quantity' | 'code' | 'schedule'
  | 'estimated_rate' | 'bid_rate' | 'amount' | 'gst' | 'remarks' | 'unknown';

export type TableType = 'boq_schedule' | 'rate_analysis' | 'other';
export type DetectedBoqType = 'percentage_rate' | 'item_rate' | 'unknown';

export interface TextBlock {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
  fontSize: number;
}

export interface TextRow {
  page: number;
  baseY: number;
  blocks: TextBlock[];
}

export interface ColumnAnchor {
  index: number;
  x: number;
  spanWidth: number;
}

export type ColumnMapping = Record<number, ColumnRole>;

export interface HeaderDetectionResult {
  headerRowIndex: number;
  mapping: ColumnMapping;
  confidence: number;
  mappedCount: number;
  totalColumns: number;
}

export interface DetectedTable {
  type: TableType;
  title?: string;
  startRowIndex: number;
  endRowIndex: number;
  header?: HeaderDetectionResult;
  items: BoqItem[];
  rateAnalyses: RateAnalysis[];
}

export interface ExtractionConfidence {
  overallConfidence: number;
  headerConfidence: number;
  rowsExtracted: number;
  tablesDetected: number;
  warnings: string[];
}

export interface ExtractionResult {
  items: BoqItem[];
  rateAnalyses: RateAnalysis[];
  tables: DetectedTable[];
  detectedBoqType: DetectedBoqType;
  isScanned: boolean;
  confidence: ExtractionConfidence;
  rawText: string;
}

export interface PendingExtraction {
  rows: TextRow[];
  columns: ColumnAnchor[];
  tables: DetectedTable[];
  rawText: string;
}

// ── Phase 2: linear extraction ─────────────────────────────────────────────

/** x-range for one role column, derived from the anchor header row */
export interface ColumnBoundary {
  role: ColumnRole;
  x: number;      // anchor block x (centre reference)
  minX: number;   // inclusive left edge for data-row matching
  maxX: number;   // exclusive right edge for data-row matching
}

/** Column map locked after the anchor row is found at high confidence */
export interface LockedColumnMap {
  anchorRowIndex: number;
  anchorConfidence: number;
  boundaries: ColumnBoundary[];   // sorted by x ascending
  headerText: string;             // full text of anchor row (repeated-header detection)
}

export type RowClass =
  | 'new_item'        // first column has a valid item number
  | 'continuation'    // no item number, has description text → append to current item
  | 'repeated_header' // exact/near-duplicate of the anchor row → skip
  | 'section_break'   // title matches a section-break pattern → stop BOQ
  | 'skip';           // empty or irrelevant row

export interface ClassifiedRow {
  rowClass: RowClass;
  cells: Partial<Record<ColumnRole, string>>;
  row: TextRow;
  sectionBreakReason?: string;
}

// ── Verification ───────────────────────────────────────────────────────────

export interface VerificationCheck {
  name: string;
  pass: boolean;
  critical: boolean;   // critical=true → failure makes the whole result FAIL
  detail: string[];
}

export interface VerificationResult {
  pass: boolean;
  checks: VerificationCheck[];
  criticalFailures: string[];
  statedTotal: number | null;
  computedTotal: number;
  score: number;   // 0–100
}

// ── Orchestrator / telemetry ───────────────────────────────────────────────

export type ExtractionEngine = 'deterministic' | 'vision';

export interface ExtractionTelemetry {
  engine: ExtractionEngine;
  parserDurationMs: number;
  verificationDurationMs: number;
  visionDurationMs?: number;
  verificationScore: number;
  fallbackReason?: string;
  pagesProcessed: number;
  itemsExtracted: number;
}

export interface OrchestratorResult {
  extraction: ExtractionResult;
  verification: VerificationResult;
  telemetry: ExtractionTelemetry;
}
