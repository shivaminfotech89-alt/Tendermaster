import type { DetectedTable, ExtractionConfidence } from '../../types/boq';

export function calculateConfidence(tables: DetectedTable[], warnings: string[]): ExtractionConfidence {
  const boqTables = tables.filter(t => t.type === 'boq_schedule');
  const allItems = tables.flatMap(t => t.items);
  const rowsExtracted = allItems.length;

  let headerConfidence = 0;
  if (boqTables.length > 0) {
    const total = boqTables.reduce((s, t) => s + (t.header?.confidence ?? 0), 0);
    headerConfidence = total / boqTables.length;
  }

  const qualityItems = allItems.filter(
    item => item.description.trim().length > 0 && item.quantity > 0,
  );
  const rowQuality = rowsExtracted > 0 ? (qualityItems.length / rowsExtracted) * 100 : 0;

  const overallConfidence = Math.min(
    100,
    headerConfidence * 0.4 + rowQuality * 0.4 + (rowsExtracted > 0 ? 20 : 0),
  );

  return {
    overallConfidence: Math.round(overallConfidence),
    headerConfidence: Math.round(headerConfidence),
    rowsExtracted,
    tablesDetected: tables.length,
    warnings,
  };
}
