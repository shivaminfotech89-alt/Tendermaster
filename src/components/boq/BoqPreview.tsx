import type { ExtractionResult } from '../../types/boq';

interface BoqPreviewProps {
  result: ExtractionResult;
  onReset: () => void;
}

function fmtNum(n: number | undefined): string {
  if (n === undefined) return '—';
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

export default function BoqPreview({ result, onReset }: BoqPreviewProps) {
  const { detectedBoqType, items, rateAnalyses } = result;

  return (
    <div className="space-y-4">
      {/* Percentage rate info banner */}
      {detectedBoqType === 'percentage_rate' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          This appears to be a Percentage Rate tender. Use the BOQ &amp; Bid Pricing section to enter your bid percentage.
        </div>
      )}

      {/* Items table */}
      {items.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-gray-600 w-8">Sr</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 w-16">Item No</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600">Description</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 w-12">Unit</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 w-16">Qty</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 w-20">Rate</th>
                <th className="px-3 py-2 text-right font-medium text-gray-600 w-24">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((item, idx) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-gray-500">{idx + 1}</td>
                  <td className="px-3 py-2 font-mono text-gray-700">{item.itemNo || '—'}</td>
                  <td className="px-3 py-2 text-gray-800">{item.description || '—'}</td>
                  <td className="px-3 py-2 text-gray-600">{item.unit || '—'}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmtNum(item.quantity)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmtNum(item.estimatedRate)}</td>
                  <td className="px-3 py-2 text-right text-gray-700">{fmtNum(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length === 0 && (
        <p className="text-sm text-gray-500 italic">No BOQ items could be extracted from this document.</p>
      )}

      {/* Rate analysis count */}
      {rateAnalyses.length > 0 && (
        <p className="text-xs text-gray-500">
          Rate Analysis: {rateAnalyses.length} entr{rateAnalyses.length === 1 ? 'y' : 'ies'} detected (detail view coming in Milestone 2).
        </p>
      )}

      <button
        onClick={onReset}
        className="mt-2 inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
      >
        Start Over
      </button>
    </div>
  );
}
