import { CheckCircle2 } from 'lucide-react';
import type { BOQType, BOQTypeConfidence } from '../../lib/boq/types';

interface PricingMethodCardProps {
  boqType: BOQType | undefined;
  boqTypeConfidence?: BOQTypeConfidence;
  boqTypeScore?: number;
  boqTypeReason?: string;
}

const TYPE_LABELS: Record<BOQType, string> = {
  percentage_rate: 'Percentage Rate',
  item_rate: 'Item Rate',
  lump_sum_epc: 'Lump Sum / Package',
  hybrid: 'Hybrid',
  unknown: 'Not set',
};

// Static explanatory copy per mode — UI labels, not extracted data.
const MODE_NOTE: Partial<Record<BOQType, string>> = {
  percentage_rate: 'Estimated Amount: Manual Override Available',
  item_rate: 'Reason: Individual quoted rates required',
  lump_sum_epc: 'Reason: Package-based lump sum pricing',
};

/**
 * Reads real detection data already computed by detectBoqTypeFromText/
 * detectBoqTypeFromItems and stored on BOQData — never fabricates a
 * confidence figure or detection source. Undetected/manual types (e.g.
 * Lump Sum, which is manual-only today) show "--"/"Manually selected".
 */
export default function PricingMethodCard({ boqType, boqTypeConfidence, boqTypeScore, boqTypeReason }: PricingMethodCardProps) {
  const type = boqType ?? 'unknown';
  const label = TYPE_LABELS[type];
  const detected = boqTypeConfidence != null;

  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1">Pricing Method</p>
      {type === 'unknown' ? (
        <p className="text-sm font-semibold text-slate-500 mt-1">Not yet detected</p>
      ) : (
        <>
          <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {label}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            Confidence: {detected && boqTypeScore != null ? `${boqTypeScore}%` : '--'}
          </p>
          <p className="text-[11px] text-slate-500 truncate" title={boqTypeReason}>
            Detection Source: {detected && boqTypeReason ? boqTypeReason : 'Manually selected'}
          </p>
          {MODE_NOTE[type] && (
            <p className="text-[11px] text-slate-400 mt-1">{MODE_NOTE[type]}</p>
          )}
        </>
      )}
    </div>
  );
}
