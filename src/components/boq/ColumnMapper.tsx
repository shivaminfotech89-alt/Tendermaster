import { useState } from 'react';
import type { ColumnAnchor, TextRow, ColumnMapping, ColumnRole } from '../../types/boq';

const ALL_ROLES: ColumnRole[] = [
  'item_no', 'description', 'unit', 'quantity', 'code', 'schedule',
  'estimated_rate', 'bid_rate', 'amount', 'gst', 'remarks', 'unknown',
];

const ROLE_LABELS: Record<ColumnRole, string> = {
  item_no: 'Item No',
  description: 'Description',
  unit: 'Unit',
  quantity: 'Quantity',
  code: 'Code',
  schedule: 'Schedule / Bill',
  estimated_rate: 'Estimated Rate',
  bid_rate: 'Bid Rate',
  amount: 'Amount',
  gst: 'GST',
  remarks: 'Remarks',
  unknown: '(Ignore)',
};

interface ColumnMapperProps {
  columns: ColumnAnchor[];
  sampleRows: TextRow[];
  currentMapping: ColumnMapping;
  onApply: (mapping: ColumnMapping) => void;
}

export default function ColumnMapper({ columns, sampleRows, currentMapping, onApply }: ColumnMapperProps) {
  const [mapping, setMapping] = useState<ColumnMapping>({ ...currentMapping });

  const getSamples = (colIndex: number): string[] => {
    const samples: string[] = [];
    for (const row of sampleRows.slice(0, 5)) {
      for (const block of row.blocks) {
        const nearestX = columns.reduce((best, c) =>
          Math.abs(c.x - block.x) < Math.abs(best.x - block.x) ? c : best, columns[0]);
        if (nearestX && nearestX.index === colIndex) {
          samples.push(block.text);
          break;
        }
      }
    }
    return samples.filter(Boolean);
  };

  const handleChange = (colIndex: number, role: ColumnRole) => {
    setMapping(prev => ({ ...prev, [colIndex]: role }));
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">
        Column Mapping — Help us identify each column
      </h3>
      <p className="text-xs text-gray-500">
        We could not automatically identify all columns with high confidence. Please assign a role to each column below.
      </p>

      <div className="grid gap-3">
        {columns.map(col => {
          const samples = getSamples(col.index);
          const currentRole = mapping[col.index] ?? 'unknown';

          return (
            <div key={col.index} className="rounded-lg border border-gray-200 bg-white p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-600 mb-1">Column {col.index + 1}</p>
                  <div className="flex flex-wrap gap-1">
                    {samples.length > 0
                      ? samples.map((s, i) => (
                          <span key={i} className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-700">
                            {s}
                          </span>
                        ))
                      : <span className="text-xs text-gray-400 italic">No sample data</span>
                    }
                  </div>
                </div>
                <select
                  value={currentRole}
                  onChange={e => handleChange(col.index, e.target.value as ColumnRole)}
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {ALL_ROLES.map(role => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>

      <button
        onClick={() => onApply(mapping)}
        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors"
      >
        Apply Mapping
      </button>
    </div>
  );
}
