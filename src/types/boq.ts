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
