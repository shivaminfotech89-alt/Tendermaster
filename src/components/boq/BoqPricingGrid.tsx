import { useState, memo, useCallback } from 'react';
import { AlertTriangle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { BoqItem } from '../../types/boq';
import type { ItemPricing } from '../../types/boqPricing';

export type EditableField = 'bidRate' | 'discountPercent' | 'premiumPercent' | 'remarks';

interface BoqPricingGridProps {
  items: BoqItem[];
  pricingKeys: string[];           // parallel to items — see buildPricingKeys
  pricing: Record<string, ItemPricing>;
  duplicateItemNos: Set<string>;
  onFieldChange: (key: string, item: BoqItem, field: EditableField, rawValue: string) => void;
}

function fmtIndian(n: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
}

function commitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === 'Enter') e.currentTarget.blur();
}

interface PricingRowProps {
  item: BoqItem;
  rowKey: string;
  pricing: ItemPricing | undefined;
  isDuplicate: boolean;
  expanded: boolean;
  onToggleDesc: (id: string) => void;
  onFieldChange: (key: string, item: BoqItem, field: EditableField, rawValue: string) => void;
}

const PricingRow = memo(function PricingRow({
  item, rowKey, pricing, isDuplicate, expanded, onToggleDesc, onFieldChange,
}: PricingRowProps) {
  const longDesc = item.description.length > 80;
  const validation = pricing?.validation;
  const level = validation?.level ?? 'ok';

  return (
    <tr className="hover:bg-slate-50 transition-colors">
      <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap align-top">{item.itemNo}</td>
      <td className="px-4 py-3 text-slate-700 max-w-xs align-top">
        <div className={expanded ? '' : 'line-clamp-2'}>{item.description}</div>
        {longDesc && (
          <button
            onClick={() => onToggleDesc(item.id)}
            className="text-xs text-indigo-500 hover:underline mt-0.5 flex items-center gap-0.5"
          >
            {expanded
              ? <><ChevronUp className="w-3 h-3" />Show less</>
              : <><ChevronDown className="w-3 h-3" />Show more</>}
          </button>
        )}
      </td>
      <td className="px-4 py-3 text-slate-600 whitespace-nowrap align-top">{item.unit}</td>
      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap align-top">{item.quantity}</td>
      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap align-top">
        {item.estimatedRate !== undefined ? fmtIndian(item.estimatedRate) : '—'}
      </td>
      <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap align-top">
        {item.amount !== undefined ? fmtIndian(item.amount) : '—'}
      </td>

      {/* Editable: Quoted Rate */}
      <td className="px-2 py-2 align-top">
        <input
          type="number"
          step="0.01"
          value={pricing?.bidRate ?? ''}
          onChange={e => onFieldChange(rowKey, item, 'bidRate', e.target.value)}
          onKeyDown={commitOnEnter}
          className={`w-24 text-right px-2 py-1.5 text-sm border rounded-lg outline-none focus:ring-2 ${
            level === 'error' ? 'border-red-300 focus:ring-red-200'
              : level === 'warning' ? 'border-amber-300 focus:ring-amber-200'
              : 'border-slate-200 focus:ring-indigo-200'
          }`}
        />
      </td>

      {/* Editable: Discount % */}
      <td className="px-2 py-2 align-top">
        <input
          type="number"
          step="0.01"
          value={pricing?.discountPercent ?? ''}
          onChange={e => onFieldChange(rowKey, item, 'discountPercent', e.target.value)}
          onKeyDown={commitOnEnter}
          className="w-16 text-right px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </td>

      {/* Editable: Premium % */}
      <td className="px-2 py-2 align-top">
        <input
          type="number"
          step="0.01"
          value={pricing?.premiumPercent ?? ''}
          onChange={e => onFieldChange(rowKey, item, 'premiumPercent', e.target.value)}
          onKeyDown={commitOnEnter}
          className="w-16 text-right px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </td>

      {/* Computed: Quoted Amount */}
      <td className="px-4 py-3 text-right font-semibold text-slate-800 whitespace-nowrap align-top">
        {pricing?.quotedAmount !== undefined ? fmtIndian(pricing.quotedAmount) : '—'}
      </td>

      {/* Editable: Remarks */}
      <td className="px-2 py-2 align-top">
        <input
          type="text"
          value={pricing?.remarks ?? ''}
          onChange={e => onFieldChange(rowKey, item, 'remarks', e.target.value)}
          onKeyDown={commitOnEnter}
          className="w-32 px-2 py-1.5 text-sm border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </td>

      {/* Validation */}
      <td className="px-2 py-3 align-top">
        {(level === 'warning' || (level === 'error' && !isDuplicate)) && (
          <span title={validation?.issues.join(', ')}>
            <AlertTriangle className="w-4 h-4 text-amber-500" />
          </span>
        )}
        {level === 'error' && isDuplicate && (
          <span title={validation?.issues.join(', ')}>
            <AlertCircle className="w-4 h-4 text-red-500" />
          </span>
        )}
      </td>
    </tr>
  );
});

export default function BoqPricingGrid({ items, pricingKeys, pricing, duplicateItemNos, onFieldChange }: BoqPricingGridProps) {
  const [expandedDescs, setExpandedDescs] = useState<Set<string>>(new Set());

  const toggleDesc = useCallback((id: string) => {
    setExpandedDescs(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">Item No</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600 min-w-[200px]">Description</th>
            <th className="px-4 py-3 text-left font-semibold text-slate-600 whitespace-nowrap">Unit</th>
            <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">Quantity</th>
            <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">Est. Rate (₹)</th>
            <th className="px-4 py-3 text-right font-semibold text-slate-600 whitespace-nowrap">Est. Amount (₹)</th>
            <th className="px-4 py-3 text-right font-semibold text-indigo-700 whitespace-nowrap">Quoted Rate (₹)</th>
            <th className="px-4 py-3 text-right font-semibold text-indigo-700 whitespace-nowrap">Disc. %</th>
            <th className="px-4 py-3 text-right font-semibold text-indigo-700 whitespace-nowrap">Prem. %</th>
            <th className="px-4 py-3 text-right font-semibold text-indigo-700 whitespace-nowrap">Quoted Amount (₹)</th>
            <th className="px-4 py-3 text-left font-semibold text-indigo-700 whitespace-nowrap">Remarks</th>
            <th className="px-2 py-3"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.length === 0 ? (
            <tr>
              <td colSpan={12} className="px-4 py-10 text-center text-slate-400">No items to price.</td>
            </tr>
          ) : items.map((item, i) => (
            <PricingRow
              key={item.id}
              item={item}
              rowKey={pricingKeys[i]}
              pricing={pricing[pricingKeys[i]]}
              isDuplicate={duplicateItemNos.has(item.itemNo.trim())}
              expanded={expandedDescs.has(item.id)}
              onToggleDesc={toggleDesc}
              onFieldChange={onFieldChange}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
