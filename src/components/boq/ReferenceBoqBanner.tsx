import { Info } from 'lucide-react';

/**
 * Static explanatory banner — no data-dependent values, so no risk of
 * showing a fabricated figure. Purely clarifies that the table below is
 * department reference data, not the bidder's own quoted rates.
 */
export default function ReferenceBoqBanner() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4">
      <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
      <div>
        <p className="text-xs font-bold text-slate-600 uppercase tracking-widest">Reference BOQ</p>
        <p className="text-sm text-slate-600 mt-1">
          These values are extracted from the tender's Schedule-B. They represent the
          department's estimated quantities and rates. They are <span className="font-semibold">not</span> your
          quoted rates. Prepare your financial bid using the Pricing section.
        </p>
      </div>
    </div>
  );
}
