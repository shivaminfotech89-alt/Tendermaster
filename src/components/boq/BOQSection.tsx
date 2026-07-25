import { useState, useEffect, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Edit2, Lock, RotateCcw,
} from 'lucide-react';
import type { BOQData, BidSnapshotRow, FinancialValueCandidate } from '../../lib/boq/types';
import { toIndianWords } from '../../lib/boq/indianWords';
import { netBidAmount, calcProfit, getBidWarnings, fmtINR, applyCessAndGst, resolveGstCalculationMode } from '../../lib/boq/calculator';
import { detectBoqTypeFromAnalysis, extractAnalysisText, extractBidRecommendationEstimatedValue } from '../../lib/boq/detectBoqType';
import { buildRateContractHint, resolveRateContractRevenue, detectMisenteredScheduleAmount, pickScheduleMatchingCandidateIndex, resolveExpectedRevenueConfirmation, preferExactScheduleSum } from '../../lib/boq/detectRateContract';
import { formatPeriodLabel } from '../../lib/boq/detectTenderValidity';

interface BOQSectionProps {
  analysisResult: any;
  boq: BOQData;
  setBoq: (b: BOQData) => void;
  totalCost: number;
  onRevenueSync: (amount: number) => void;
  // Optional — ProjectDetails only
  onFinalize?: (data: Omit<BidSnapshotRow, 'id' | 'createdAt' | 'createdBy' | 'version'>) => Promise<void>;
  snapshots?: BidSnapshotRow[];
  snapshotsLoading?: boolean;
  /** Weak signal from BOQViewer's items — "do quantities look nominal?" —
   *  one of three inputs to the Rate Contract hint. Defaults false, which is
   *  the correct behavior when BOQViewer hasn't computed it yet. */
  nominalQuantitiesSignal?: boolean;
  /** The real extracted Schedule-B sum (BOQViewer's meta.totalAmount) — used
   *  only for the Step 1 mis-entry warning, never for any calculation. */
  scheduleSum?: number | null;
}

const INR_RE = /₹?\s*[\d,]+(?:\.\d+)?/;

function parseRaw(raw: string): number | null {
  const s = raw.replace(/[₹,\s]/g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-IN');
}

function snapDate(ts: any): string {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-IN');
}

export default function BOQSection({
  analysisResult, boq, setBoq, totalCost,
  onRevenueSync, onFinalize, snapshots = [], snapshotsLoading = false,
  nominalQuantitiesSignal = false,
  scheduleSum = null,
}: BOQSectionProps) {
  // ── Local UI state ─────────────────────────────────────────────────────────
  // Session-only — a 1-signal hint is a light nudge, not a decision that
  // needs to survive a reload. The 2+-signal case has no dismiss at all.
  const [rateContractHintDismissed, setRateContractHintDismissed] = useState(false);
  const [editingAmount, setEditingAmount] = useState(false);
  const [amountInput, setAmountInput] = useState('');
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueInput, setRevenueInput] = useState('');
  const [editingCompletionPeriod, setEditingCompletionPeriod] = useState(false);
  const [customCompletionPeriodInput, setCustomCompletionPeriodInput] = useState('');
  const [completionPeriodUnit, setCompletionPeriodUnit] = useState<'months' | 'years'>('months');
  const [editingBidValidity, setEditingBidValidity] = useState(false);
  const [customBidValidityInput, setCustomBidValidityInput] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isExpanded, setIsExpanded] = useState(() => {
    try { return localStorage.getItem('boq-section-expanded') !== 'false'; }
    catch { return true; }
  });
  const handleToggle = () => setIsExpanded(prev => {
    const next = !prev;
    try { localStorage.setItem('boq-section-expanded', String(next)); } catch {}
    return next;
  });

  const candidates: FinancialValueCandidate[] =
    boq.financialCandidates ?? analysisResult?.boq_details?.financial_values ?? [];
  const suggestedIdx: number =
    boq.suggestedCandidateIndex ??
    analysisResult?.boq_details?.suggested_estimated_index ?? 0;

  // ── Auto-init BOQ type and candidates from fresh analysis ─────────────────
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    if (!analysisResult) return;
    initializedRef.current = true;

    // The API already returns boq_details.financial_values/suggested_estimated_index
    // today (server.ts). The AI prompt gives no criterion distinguishing a
    // schedule-derived figure from an overall tender-notice figure, and none
    // for which one to mark "suggested" — so `suggested_estimated_index` is
    // never trusted blindly below; it's only the fallback when the real
    // schedule sum isn't known yet.
    const bd = (analysisResult as any)?.boq_details;

    const rawCandidates: FinancialValueCandidate[] = (bd?.financial_values ?? []).map((v: any) => ({
      label: v.label ?? '',
      valueRaw: v.value_raw ?? '',
      valueNumber: v.value_number ?? 0,
      page: v.page,
      clause: v.clause,
      sourceText: v.source_text,
    }));

    // When the API returns no boq_details (current state), preserve whatever candidates
    // and amount were already loaded from Firestore. Without this guard, re-initialising
    // with an empty rawCandidates array clears the pre-filled amount and disables the
    // confirm button even though the candidates are already visible on screen.
    const effectiveCandidates = rawCandidates.length > 0
      ? rawCandidates
      : (boq.financialCandidates ?? []);
    const aiSuggestedIdx = rawCandidates.length > 0
      ? (bd?.suggested_estimated_index ?? 0)
      : (boq.suggestedCandidateIndex ?? 0);
    // Prefer whichever candidate actually matches the extracted schedule sum,
    // when it's already known at this point — never just the AI's pick.
    const effectiveIdx = pickScheduleMatchingCandidateIndex(
      effectiveCandidates.map(c => c.valueNumber),
      scheduleSum,
      aiSuggestedIdx,
    );

    // Determine BOQ type: API field (future) > client detection > leave as-is.
    // Only auto-set on HIGH confidence to prevent false positives (e.g. Annual Rate Contract
    // tenders sharing generic "above the estimated amount" language).
    let detectedType = boq.boqType;
    let detectedConf = boq.boqTypeConfidence;
    let detectedReason = boq.boqTypeReason;
    let detectedScore  = boq.boqTypeScore;
    if (boq.boqType === 'unknown') {
      if (bd?.boq_type && bd?.boq_type_confidence === 'high') {
        detectedType   = bd.boq_type;
        detectedConf   = bd.boq_type_confidence;
      } else {
        const clientDetection = detectBoqTypeFromAnalysis(analysisResult);
        // Analysis-text detection is capped at LOW — never auto-selects; used only as a hint.
        if (clientDetection.confidence === 'high') {
          detectedType   = clientDetection.type;
          detectedConf   = clientDetection.confidence;
          detectedReason = clientDetection.reason;
          detectedScore  = clientDetection.score;
        }
      }
    }

    // Prefer the precise, ground-truth scheduleSum over the AI candidate's
    // own valueNumber when they're plausibly the same figure (the AI's
    // numeric field is sometimes rounded even though its own value_raw
    // string is exact) — see preferExactScheduleSum's own docs.
    const preferredAmount = preferExactScheduleSum(effectiveCandidates[effectiveIdx]?.valueNumber, scheduleSum);

    setBoq({
      ...boq,
      boqType: detectedType,
      boqTypeConfidence: detectedConf,
      boqTypeReason: detectedReason,
      boqTypeScore: detectedScore,
      financialCandidates: effectiveCandidates,
      suggestedCandidateIndex: effectiveIdx,
      // Pre-fill amount from suggested candidate (still requires confirm).
      // Falls back to the already-loaded boq.estimatedAmount so a 0/absent
      // valueNumber from the API never clears a valid saved amount.
      estimatedAmount:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmount
          : preferredAmount || boq.estimatedAmount || null,
      estimatedAmountPage:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountPage
          : effectiveCandidates[effectiveIdx]?.page ?? boq.estimatedAmountPage,
      estimatedAmountClause:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountClause
          : effectiveCandidates[effectiveIdx]?.clause ?? boq.estimatedAmountClause,
      estimatedAmountText:
        boq.estimatedAmountConfirmed
          ? boq.estimatedAmountText
          : effectiveCandidates[effectiveIdx]?.sourceText ?? boq.estimatedAmountText,
    });
    // Pre-fill the amount input so the simplified single-field UI shows the suggested value.
    if (!boq.estimatedAmountConfirmed && !amountInput) {
      const prefilledAmount = preferredAmount || boq.estimatedAmount;
      if (prefilledAmount) setAmountInput(String(prefilledAmount));
    }
  }, [analysisResult]); // eslint-disable-line react-hooks/exhaustive-deps

  // The one-shot init effect above may run before BOQ extraction completes,
  // i.e. before the real schedule sum is known. Re-check once it arrives —
  // never touches an already-confirmed amount, and no-ops once the current
  // selection already matches (so this converges, not loops).
  useEffect(() => {
    if (boq.estimatedAmountConfirmed) return;
    if (scheduleSum == null || scheduleSum <= 0) return;
    const currentCandidates = boq.financialCandidates ?? [];
    if (currentCandidates.length === 0) return;

    const currentIdx = boq.suggestedCandidateIndex ?? 0;
    const betterIdx = pickScheduleMatchingCandidateIndex(
      currentCandidates.map(c => c.valueNumber),
      scheduleSum,
      currentIdx,
    );
    if (betterIdx === currentIdx) return;

    const better = currentCandidates[betterIdx];
    if (better?.valueNumber == null) return;
    const preciseAmount = preferExactScheduleSum(better.valueNumber, scheduleSum)!;

    setBoq({
      ...boq,
      suggestedCandidateIndex: betterIdx,
      estimatedAmount: preciseAmount,
      estimatedAmountPage: better.page,
      estimatedAmountClause: better.clause,
      estimatedAmountText: better.sourceText,
      boqLastChangedAt: Date.now(),
    });
    setAmountInput(String(preciseAmount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleSum, boq.financialCandidates, boq.suggestedCandidateIndex, boq.estimatedAmountConfirmed]);

  // ── Computed values ────────────────────────────────────────────────────────
  // Item-rate and lump-sum bids share the same grid-driven pipeline in
  // BOQViewer (a package is a line item whose "rate" is the package price) —
  // only the display label differs.
  const isGridMode = boq.boqType === 'item_rate' || boq.boqType === 'lump_sum_epc';
  const modeLabel = boq.boqType === 'lump_sum_epc' ? 'Lump Sum / Package' : 'Item Rate';

  // Rate Contract hint — percentage-rate only (grid modes already use real,
  // locked quantities; there's no schedule-vs-revenue ambiguity for them).
  // Zero signals for any other boqType, so nothing below fires for them.
  const aiEstimatedValue = extractBidRecommendationEstimatedValue(analysisResult);
  const rateContractHint = boq.boqType === 'percentage_rate'
    ? buildRateContractHint(
        extractAnalysisText(analysisResult),
        boq.estimatedAmount,
        aiEstimatedValue,
        nominalQuantitiesSignal,
      )
    : { signals: [], reasons: [] };

  const handleSetRateContract = (value: boolean) => {
    setBoq({ ...boq, isRateContract: value, boqLastChangedAt: Date.now() });
  };

  // Advisory only — never blocks confirmation, never feeds any calculation.
  const misenteredScheduleAmount = boq.boqType === 'percentage_rate' && boq.estimatedAmount != null
    && detectMisenteredScheduleAmount(boq.estimatedAmount, aiEstimatedValue, scheduleSum);

  // Grid-mode bids have no user-entered percentage/direction — the net
  // quoted amount is pushed in from BOQViewer's per-item grid (summed there,
  // synced via BOQData.quotedAmount) rather than derived from netBidAmount.
  const canCompute = isGridMode
    ? boq.quotedAmount != null && boq.estimatedAmount != null
    : (boq.estimatedAmountConfirmed && boq.estimatedAmount != null && boq.percentage != null);

  const quotedAmount = isGridMode
    ? boq.quotedAmount
    : (canCompute ? netBidAmount(boq.estimatedAmount!, boq.percentage!, boq.aboveBelow) : null);

  const words = quotedAmount != null ? toIndianWords(quotedAmount) : null;

  // Resolves which revenue figure Gross Profit/Margin should use. For the
  // majority case (not a confirmed/strongly-hinted Rate Contract) this
  // resolves to `quotedAmount` unchanged — see resolveRateContractRevenue's
  // own tests for the exact byte-identical-to-today guarantee. Only a
  // confirmed Rate Contract's schedule-derived quotedAmount gets replaced —
  // quotedAmount itself (the pricing basis / "Final Quoted Amount" figure)
  // is never altered by this, only what feeds calcProfit/getBidWarnings and
  // the parent's revenue sync.
  const rateContractRevenue = resolveRateContractRevenue(
    boq.isRateContract, boq.expectedContractValue, rateContractHint.signals.length, quotedAmount,
  );

  // Extends (never modifies) rateContractRevenue above with one more
  // requirement: even its ungated fallback branch (an ordinary tender, not a
  // confirmed Rate Contract) must be explicitly confirmed once before it
  // drives Gross Profit/Margin — see resolveExpectedRevenueConfirmation's own
  // docs for why. This is now the single source of truth for profit-relevant
  // revenue everywhere below (metrics, warnings, the revenue sync effect, and
  // the Finalize gate) — rateContractRevenue itself is still used directly
  // only by renderRateContractBanner().
  const expectedRevenue = resolveExpectedRevenueConfirmation(
    rateContractRevenue, boq.expectedRevenueConfirmed ?? false, boq.expectedRevenueConfirmedValue,
  );

  const metrics =
    expectedRevenue.revenue != null && totalCost > 0
      ? calcProfit(expectedRevenue.revenue, totalCost)
      : null;

  // Derive percentage/direction from the itemized totals so bid_snapshots
  // (which requires these keys) and getBidWarnings stay meaningful for
  // item-rate bids too, instead of reusing the percentage-rate math.
  const derivedPercentage = isGridMode && quotedAmount != null && boq.estimatedAmount
    ? Math.abs((quotedAmount - boq.estimatedAmount) / boq.estimatedAmount) * 100
    : boq.percentage;
  const derivedAboveBelow: 'above' | 'below' = isGridMode && quotedAmount != null && boq.estimatedAmount != null
    ? (quotedAmount >= boq.estimatedAmount ? 'above' : 'below')
    : boq.aboveBelow;

  const warnings =
    expectedRevenue.revenue != null && derivedPercentage != null
      ? getBidWarnings(expectedRevenue.revenue, totalCost, derivedPercentage, metrics ?? {
          grossProfit: 0, profitPercent: 0, marginPercent: 0,
        })
      : null;

  // Derived, not a stored boolean — self-healing: editing the Material/Labour
  // cost entries elsewhere in ProjectDetails changes totalCost, which
  // immediately un-confirms this without any extra reset logic.
  const estimatedCostConfirmed = boq.estimatedCostConfirmedValue === totalCost && totalCost > 0;

  // Type-aware suggested Expected Revenue figure — already correctly
  // computed by existing code, no new derivation needed. Rate Contract uses
  // the AI tender value/ceiling (informational, never a commitment); every
  // other path uses quotedAmount, which is itself already type-correct
  // (grid-mode item sum, or the percentage-rate netBidAmount result).
  const revenueSuggestion = boq.isRateContract === true
    ? { value: aiEstimatedValue, label: 'contract ceiling from tender notice — not a revenue guarantee' }
    : {
        value: quotedAmount,
        label: boq.boqType === 'item_rate' ? 'quoted BOQ total'
          : boq.boqType === 'lump_sum_epc' ? 'quoted lump sum'
          : 'quoted schedule amount',
      };

  // Welfare cess (applied first) then GST (on the cess-inclusive total) —
  // universal across all boqTypes (previously isGridMode-only). Two
  // arithmetic behaviors, not three: gstIncluded 'yes'/'no' mean no GST
  // addition (rates already reflect it, or it doesn't apply — gstPercent
  // effectively 0 for this calc); 'separate' adds the real gstPercent on
  // top. 'unknown' gates the whole calculation — never assumes a rate
  // (no more silent `?? 18` default), matching detectGstCess's own
  // "never guess" discipline.
  const gstIncluded = boq.gstIncluded ?? 'unknown';
  const gstMode = resolveGstCalculationMode(gstIncluded, boq.gstPercent);
  const gstCessGated = gstMode.gated;
  const cessGst = !gstCessGated && quotedAmount != null
    ? applyCessAndGst(quotedAmount, boq.cessPercent ?? 0, gstMode.effectiveGstPercent)
    : null;
  // The live cess/GST preview above stays visible as soon as gstIncluded is
  // resolved (gstCessGated only fires on 'unknown') — but a high-confidence
  // *detection* alone was previously usable at Finalize with no explicit
  // click. gstConfirmed reuses the existing manualOverride.gstIncluded flag
  // (already set by clicking any of the three Financial Review buttons,
  // including re-clicking the pre-highlighted detected one) as that click.
  const gstConfirmed = gstIncluded !== 'unknown' && !!boq.manualOverride?.gstIncluded;

  // Sync computed values into boq state and parent revenue. Merged into one
  // effect (rather than a separate cess/GST effect also keyed on
  // quotedAmount) because two effects both calling setBoq({...boq, ...})
  // from the same render's stale `boq` closure in the same commit would let
  // the second call silently clobber the first's writes.
  // Single source of truth for grossProfit/profitPercent/marginPercent sync —
  // previously split across two effects, one of which (the totalCost-only
  // effect) recomputed from boq.quotedAmount instead of the resolved revenue,
  // silently overwriting a correct Rate-Contract-aware figure with a
  // schedule-based one whenever Total Cost changed afterward. totalCost is
  // now part of this effect's own key/deps instead, so there is exactly one
  // code path and it always uses the same revenue source as the render above.
  const prevSyncKeyRef = useRef<string>('');
  useEffect(() => {
    const key = `${quotedAmount}|${boq.cessPercent ?? ''}|${boq.gstPercent ?? ''}|${boq.gstIncluded ?? ''}|${boq.isRateContract ?? ''}|${boq.expectedContractValue ?? ''}|${totalCost}`;
    if (key === prevSyncKeyRef.current) return;
    prevSyncKeyRef.current = key;

    setBoq({
      ...boq,
      quotedAmount,
      quotedAmountWords: words,
      grossProfit: metrics?.grossProfit ?? null,
      profitPercent: metrics?.profitPercent ?? null,
      marginPercent: metrics?.marginPercent ?? null,
      ...(isGridMode ? {
        estimatedAmountConfirmed: true,
        percentage: derivedPercentage,
        aboveBelow: derivedAboveBelow,
      } : {}),
      // Cess/GST breakdown sync is universal now (previously isGridMode-only)
      // — cessGst itself is gated on gstIncluded being resolved, not on
      // boqType, so an unresolved 'unknown' correctly leaves these undefined
      // rather than falling back to a guessed rate.
      cessAmount: cessGst?.cessAmount,
      gstAmount: cessGst?.gstAmount,
      totalWithGst: cessGst?.totalWithGst,
      roundOff: cessGst?.roundOff,
      roundedTotal: cessGst?.roundedTotal,
      boqLastChangedAt: Date.now(),
    });
    // Never sync a gated/unconfirmed figure into the parent's revenue —
    // that's precisely the bug/gap this feature exists to prevent. While
    // gated, the parent's Bid Engine panel keeps whatever revenue it already
    // has rather than receiving a fabricated, wrong, or unconfirmed update.
    if (expectedRevenue.revenue != null) onRevenueSync(expectedRevenue.revenue);
  }, [quotedAmount, boq.cessPercent, boq.gstPercent, boq.gstIncluded, boq.isRateContract, boq.expectedContractValue, boq.expectedRevenueConfirmed, boq.expectedRevenueConfirmedValue, totalCost]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleAmountInputChange = (v: string) => {
    setAmountInput(v);
    const n = parseFloat(v.replace(/,/g, ''));
    if (isFinite(n)) {
      const orig = candidates[suggestedIdx]?.valueNumber ?? null;
      const edited = orig !== null && n !== orig;
      setBoq({
        ...boq,
        estimatedAmount: n,
        estimatedAmountEdited: edited,
        estimatedAmountConfirmed: false,
        ...(edited ? { manualOverride: { ...boq.manualOverride, scheduleValue: true } } : {}),
      });
    }
  };

  const handleConfirmAmount = () => {
    if (!boq.estimatedAmount) return;
    setBoq({ ...boq, estimatedAmountConfirmed: true, boqLastChangedAt: Date.now() });
    setEditingAmount(false);
  };

  const handleReconfirm = () => {
    setBoq({ ...boq, estimatedAmountConfirmed: false });
    setAmountInput(boq.estimatedAmount?.toString() ?? '');
    setEditingAmount(true);
  };

  const handlePctChange = (v: string) => {
    const n = parseFloat(v);
    const pct = isFinite(n) ? Math.max(0, n) : null;
    setBoq({ ...boq, percentage: pct, boqLastChangedAt: Date.now() });
  };

  const handleCessChange = (v: string) => {
    const n = parseFloat(v);
    setBoq({ ...boq, cessPercent: v !== '' && isFinite(n) ? Math.max(0, n) : undefined, boqLastChangedAt: Date.now() });
  };

  const handleGstChange = (v: string) => {
    const n = parseFloat(v);
    setBoq({ ...boq, gstPercent: v !== '' && isFinite(n) ? Math.max(0, n) : undefined, boqLastChangedAt: Date.now() });
  };

  // Manual edits to gstIncluded/bidBasis are sticky — set the corresponding
  // manualOverride flag so a future re-detection/re-analysis (ProjectDetails'
  // handleManualBoqExtract) never silently rewrites what the bidder confirmed.
  const handleGstIncludedChange = (value: 'yes' | 'no' | 'separate') => {
    setBoq({
      ...boq,
      gstIncluded: value,
      manualOverride: { ...boq.manualOverride, gstIncluded: true },
      boqLastChangedAt: Date.now(),
    });
  };

  const handleBidBasisChange = (value: 'schedule_total' | 'before_gst' | 'boq_total' | 'not_sure') => {
    setBoq({
      ...boq,
      bidBasis: value,
      manualOverride: { ...boq.manualOverride, bidBasis: true },
      boqLastChangedAt: Date.now(),
    });
  };

  // Confirming here is what actually feeds resolveRateContractRevenue for the
  // Rate Contract branch (expectedContractValue) — same field it already
  // reads, populated through this UI instead of a blank input. For every
  // other boqType, expectedRevenueOverride is set only when the confirmed
  // figure differs from the suggestion (i.e. the bidder typed something else).
  const handleConfirmExpectedRevenue = (value: number) => {
    setBoq({
      ...boq,
      expectedRevenueConfirmed: true,
      expectedRevenueConfirmedValue: value,
      ...(boq.isRateContract === true
        ? { expectedContractValue: value }
        : { expectedRevenueOverride: value !== revenueSuggestion.value ? value : null }),
      boqLastChangedAt: Date.now(),
    });
    setEditingRevenue(false);
  };

  const handleReconfirmExpectedRevenue = () => {
    setBoq({ ...boq, expectedRevenueConfirmed: false });
    setRevenueInput(boq.expectedRevenueConfirmedValue?.toString() ?? '');
  };

  const handleConfirmCompletionPeriod = (days: number, label?: string) => {
    setBoq({
      ...boq,
      completionPeriodDays: days,
      completionPeriodLabel: label ?? (days === boq.completionPeriodDays ? boq.completionPeriodLabel : undefined),
      completionPeriodConfirmed: true,
      manualOverride: { ...boq.manualOverride, completionPeriod: true },
      boqLastChangedAt: Date.now(),
    });
    setEditingCompletionPeriod(false);
  };

  const handleEditCompletionPeriod = () => {
    setBoq({ ...boq, completionPeriodConfirmed: false });
    setCustomCompletionPeriodInput('');
    setEditingCompletionPeriod(true);
  };

  // Bid Validity is captured/confirmable but never blocks Finalize — see
  // detectTenderValidity.ts's own docs for why the two concepts are split.
  const handleConfirmBidValidity = (days: number) => {
    setBoq({
      ...boq,
      bidValidityDays: days,
      // Preserve the detected label only when confirming that exact detected
      // value unchanged; a manually-typed different number has no matching
      // label and must fall back to "${days} Days" rather than showing a
      // stale label from a previous value.
      bidValidityLabel: days === boq.bidValidityDays ? boq.bidValidityLabel : undefined,
      bidValidityConfirmed: true,
      manualOverride: { ...boq.manualOverride, bidValidity: true },
      boqLastChangedAt: Date.now(),
    });
    setEditingBidValidity(false);
  };

  const handleEditBidValidity = () => {
    setBoq({ ...boq, bidValidityConfirmed: false });
    setCustomBidValidityInput(boq.bidValidityDays?.toString() ?? '');
    setEditingBidValidity(true);
  };

  const handleConfirmEstimatedCost = () => {
    setBoq({ ...boq, estimatedCostConfirmedValue: totalCost, boqLastChangedAt: Date.now() });
  };

  const handleFinalize = async () => {
    // Each of these gates is a hard stop, independent of the button's own
    // disabled state — a bid_snapshots entry is immutable.
    if (!onFinalize || !canCompute || !quotedAmount || !words || gstCessGated || !gstConfirmed
      || !estimatedCostConfirmed || !boq.completionPeriodConfirmed || expectedRevenue.gated) return;
    setFinalizing(true);
    try {
      await onFinalize({
        boqType: boq.boqType,
        estimatedAmount: boq.estimatedAmount!,
        estimatedAmountConfirmed: true,
        estimatedAmountEdited: boq.estimatedAmountEdited,
        estimatedAmountClause: boq.estimatedAmountClause,
        estimatedAmountText: boq.estimatedAmountText,
        aboveBelow: boq.aboveBelow,
        percentage: boq.percentage!,
        quotedAmount,
        quotedAmountWords: words,
        totalCost: totalCost || 0,
        grossProfit: metrics?.grossProfit ?? 0,
        profitPercent: metrics?.profitPercent ?? 0,
        marginPercent: metrics?.marginPercent ?? 0,
        cessPercent: boq.cessPercent,
        gstPercent: boq.gstPercent,
        cessAmount: cessGst?.cessAmount,
        gstAmount: cessGst?.gstAmount,
        totalWithGst: cessGst?.totalWithGst,
        roundOff: cessGst?.roundOff,
        roundedTotal: cessGst?.roundedTotal,
        // Distinctly-named duplicates (see types.ts) — additive, the fields
        // above are unchanged so nothing that already reads them breaks.
        tenderValue: aiEstimatedValue ?? undefined,
        scheduleBAmount: boq.estimatedAmount!,
        quotedScheduleAmount: quotedAmount,
        pricingMethod: isGridMode ? modeLabel : 'Percentage Rate',
        bidPercent: derivedPercentage ?? undefined,
        expectedRevenue: expectedRevenue.revenue ?? undefined,
        bidValidityDays: boq.bidValidityDays ?? undefined,
        completionPeriodDays: boq.completionPeriodDays ?? undefined,
        remarks: boq.remarks,
      });
    } finally {
      setFinalizing(false);
    }
  };

  // ── Sub-renders ────────────────────────────────────────────────────────────

  const renderAmountStep = () => {
    if (boq.estimatedAmountConfirmed) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-semibold text-emerald-800">Schedule-B Amount: {fmtINR(boq.estimatedAmount!)} Confirmed</span>
              {boq.estimatedAmountClause && (
                <span className="ml-2 text-xs text-emerald-600">{boq.estimatedAmountClause}{boq.estimatedAmountPage ? ` · Page ${boq.estimatedAmountPage}` : ''}</span>
              )}
              {boq.estimatedAmountEdited && (
                <span className="ml-2 text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">Edited</span>
              )}
            </div>
            <button onClick={handleReconfirm} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1 shrink-0">
              <RotateCcw className="w-3 h-3" /> Re-confirm
            </button>
          </div>
          {misenteredScheduleAmount && (
            <p className="text-xs text-amber-700 flex items-start gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This looks like the overall tender value, not the Schedule-B amount. The percentage applies to the schedule.
            </p>
          )}
        </div>
      );
    }

    const suggested = candidates[suggestedIdx];
    const sourceNote = suggested
      ? suggested.page
        ? `Pre-filled from page ${suggested.page}${suggested.clause ? ` (${suggested.clause})` : ''} — verify against the tender document`
        : suggested.clause
        ? `Pre-filled from ${suggested.clause} — verify against the tender document`
        : suggested.label
        ? `Pre-filled from detected value — verify against the tender document`
        : null
      : null;

    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-800">Schedule-B Amount (₹)</p>
            <p className="text-xs text-amber-700 mt-0.5">
              The figure your bid percentage is applied to — not the overall tender value.
              Confirm before any calculation; a wrong base changes the entire bid.
            </p>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-2 bg-white border border-amber-300 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-amber-300">
            <span className="text-slate-400 font-bold text-sm">₹</span>
            <input
              type="text"
              value={amountInput || (boq.estimatedAmount != null ? boq.estimatedAmount.toString() : '')}
              onChange={e => handleAmountInputChange(e.target.value)}
              placeholder="Type the Schedule-B amount here"
              className="flex-1 bg-transparent text-slate-900 font-semibold text-sm outline-none"
            />
          </div>
          {sourceNote && (
            <p className="text-[11px] text-amber-600 mt-1.5 italic">{sourceNote}</p>
          )}
          {boq.estimatedAmount != null && (
            <p className="text-xs text-amber-700 mt-1">{toIndianWords(boq.estimatedAmount)}</p>
          )}
          {misenteredScheduleAmount && (
            <p className="text-xs text-amber-800 font-medium flex items-start gap-1.5 mt-2 bg-white border border-amber-300 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              This looks like the overall tender value, not the Schedule-B amount. The percentage applies to the schedule.
            </p>
          )}
        </div>

        <button
          onClick={handleConfirmAmount}
          disabled={!boq.estimatedAmount}
          className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          Confirm Schedule-B Amount
        </button>
        {!boq.estimatedAmount && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Type the amount above, then click to confirm
          </p>
        )}
      </div>
    );
  };

  const renderPricingStep = () => {
    if (!boq.estimatedAmountConfirmed) return null;
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
        <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Step 2 — Bid Percentage</h4>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-medium">
            {(['above', 'below'] as const).map(opt => (
              <button
                key={opt}
                onClick={() => setBoq({ ...boq, aboveBelow: opt, boqLastChangedAt: Date.now() })}
                className={`px-4 py-2 capitalize transition-colors ${boq.aboveBelow === opt ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-indigo-300">
            <input
              type="number"
              min="0"
              step="0.01"
              value={boq.percentage ?? ''}
              onChange={e => handlePctChange(e.target.value)}
              placeholder="0.00"
              className="w-24 text-slate-900 font-bold text-lg bg-transparent outline-none"
            />
            <span className="text-slate-400 font-bold">%</span>
          </div>
          <span className="text-sm text-slate-500">the Estimated Amount</span>
        </div>

        {warnings?.messages.some(m => m.includes('20%')) && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            {warnings!.messages.find(m => m.includes('20%'))}
          </div>
        )}

        {quotedAmount != null && (
          <div className="bg-slate-50 rounded-lg p-3 space-y-1">
            <div className="flex justify-between items-baseline">
              <span className="text-xs font-semibold text-slate-500 uppercase">Net Bid Amount</span>
              <span className="text-xl font-black text-slate-900">{fmtINR(quotedAmount)}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{words}</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Remarks (optional)</label>
          <input
            type="text"
            value={boq.remarks}
            onChange={e => setBoq({ ...boq, remarks: e.target.value, boqLastChangedAt: Date.now() })}
            placeholder="Any remarks to include on the bid form"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 focus:ring-2 focus:ring-indigo-300 outline-none"
          />
        </div>
      </div>
    );
  };

  // Universal Financial Review — replaces the old isGridMode-only "Statutory
  // Additions" card. Shown for every boqType once a schedule value exists;
  // captures GST treatment (detected or manually confirmed, sticky via
  // manualOverride), cess/GST rates, and — only for percentage_rate tenders
  // where detection confidence is below 90 and the bidder hasn't already
  // answered — the one mandatory question about where the bid % applies.
  // Never auto-picks gstIncluded: 'unknown' stays 'unknown' (and cessGst
  // stays null / calculation gated) until the bidder or a future detection
  // pass resolves it.
  const renderFinancialReview = () => {
    if (boq.estimatedAmount == null) return null;
    const confidence = boq.gstCessConfidence ?? 0;
    const needsBidBasisQuestion = boq.boqType === 'percentage_rate' && confidence < 90 && !boq.bidBasis;

    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest">Financial Review</h4>
          {boq.manualOverride?.gstIncluded ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-indigo-100 text-indigo-700">
              Manually confirmed
            </span>
          ) : boq.gstCessConfidence != null ? (
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${confidence >= 90 ? 'bg-emerald-100 text-emerald-700' : confidence >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}
              title={boq.gstCessDetectionReason}
            >
              Detected · {confidence}% conf.
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          <span>Tender Value</span>
          <span className="text-right font-medium">{aiEstimatedValue != null ? fmtINR(aiEstimatedValue) : '--'}</span>
          <span>Schedule Value</span>
          <span className="text-right font-medium">{fmtINR(boq.estimatedAmount)}</span>
          <span>Subtotal (before cess/GST)</span>
          <span className="text-right font-medium">{quotedAmount != null ? fmtINR(quotedAmount) : '--'}</span>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">GST Treatment</label>
          <div className="flex flex-wrap gap-1.5">
            {([
              ['yes', 'Included'],
              ['no', 'Not Applicable'],
              ['separate', 'Payable Separately'],
            ] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => handleGstIncludedChange(v)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${gstIncluded === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {gstIncluded === 'unknown' && (
            <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Could not determine GST treatment from the tender text — select one above. Cess/GST totals are withheld until this is resolved.
            </p>
          )}
          {gstIncluded !== 'unknown' && !gstConfirmed && (
            <p className="text-[11px] text-amber-600 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              Detected, not yet confirmed — click "{gstIncluded === 'yes' ? 'Included' : gstIncluded === 'no' ? 'Not Applicable' : 'Payable Separately'}" above to confirm before finalizing.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            Welfare Cess
            <input
              type="number"
              min="0"
              step="0.01"
              value={boq.cessPercent ?? ''}
              onChange={e => handleCessChange(e.target.value)}
              placeholder="0"
              className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-300"
            />
            %
          </label>
          {gstIncluded === 'separate' && (
            <label className="flex items-center gap-2 text-sm text-slate-600">
              GST
              <input
                type="number"
                min="0"
                step="0.01"
                value={boq.gstPercent ?? ''}
                onChange={e => handleGstChange(e.target.value)}
                placeholder="0"
                className="w-20 border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-300"
              />
              %
            </label>
          )}
        </div>
        <p className="text-[11px] text-slate-400">
          Cess is applied to the subtotal first; GST (only when payable separately) is then applied to the cess-inclusive total.
        </p>

        {needsBidBasisQuestion && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
            <p className="text-xs font-semibold text-amber-800">Where should the bid percentage apply?</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['schedule_total', 'Schedule Total'],
                ['before_gst', 'Before GST'],
                ['boq_total', 'BOQ Total'],
                ['not_sure', 'Not sure'],
              ] as const).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => handleBidBasisChange(v)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border bg-white text-amber-700 border-amber-300 hover:bg-amber-100"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        {boq.bidBasis && (
          <p className="text-[11px] text-slate-400">
            Bid basis: <span className="font-medium text-slate-600">{boq.bidBasis.replace(/_/g, ' ')}</span>
            {boq.manualOverride?.bidBasis && ' (confirmed by you)'}
          </p>
        )}
      </div>
    );
  };

  const renderSummaryCard = () => {
    if (!boq.estimatedAmountConfirmed || quotedAmount == null) return null;

    const missingCost = totalCost <= 0;

    const warnColor = warnings?.level === 'red'
      ? 'bg-red-50 border-red-200 text-red-800'
      : warnings?.level === 'amber'
      ? 'bg-amber-50 border-amber-200 text-amber-800'
      : 'bg-emerald-50 border-emerald-200 text-emerald-800';

    const warnIcon = warnings?.level === 'red'
      ? <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
      : warnings?.level === 'amber'
      ? <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
      : <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;

    const warnText = warnings?.messages.length
      ? warnings.messages.join(' · ')
      : 'Healthy margin';

    // Three distinct concepts, named so they can never be confused:
    //   Tender Value           = bid_recommendation.estimated_value (AI-read
    //                            overall contract value) — reference only
    //                            (eligibility/EMD/PG/ceiling), never pricing.
    //   Schedule-B Amount /
    //   Department BOQ Total   = boq.estimatedAmount — the confirmed pricing
    //                            basis (what the bid % is applied to).
    //   Quoted Schedule Amount /
    //   Quoted BOQ Total /
    //   Quoted Lump Sum        = quotedAmount — the bidder's quoted figure
    //                            against the schedule. Never "Final Bid
    //                            Amount" — it is not a contract total.
    const tenderValueRow: [string, string] = [
      'Tender Value',
      aiEstimatedValue != null ? `${fmtINR(aiEstimatedValue)} (reference only)` : '--',
    ];

    const typeSpecificRows: [string, string][] = boq.boqType === 'item_rate'
      ? [
          tenderValueRow,
          ['Department BOQ Total', `${fmtINR(boq.estimatedAmount!)} (summed from priced BOQ items)`],
          ['Quoted BOQ Total', fmtINR(quotedAmount)],
        ]
      : boq.boqType === 'lump_sum_epc'
      ? [
          tenderValueRow,
          ['Quoted Lump Sum', fmtINR(quotedAmount)],
        ]
      : [
          tenderValueRow,
          ['Schedule-B Amount', `${fmtINR(boq.estimatedAmount!)} ✓${boq.estimatedAmountClause ? ` · ${boq.estimatedAmountClause}` : ''}${boq.estimatedAmountPage ? ` · Page ${boq.estimatedAmountPage}` : ''}`],
          ['Bid %', `${derivedAboveBelow === 'above' ? '↑' : '↓'} ${boq.percentage}% ${derivedAboveBelow}`],
          ['Quoted Schedule Amount', fmtINR(quotedAmount)],
        ];

    return (
      <div className="rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="bg-slate-900 px-5 py-3 flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400" />
          <h4 className="text-sm font-bold text-white uppercase tracking-widest">Financial Summary</h4>
        </div>
        <div className="divide-y divide-slate-100">
          {[
            ['Pricing Method', isGridMode ? modeLabel : 'Percentage Rate'],
            ...typeSpecificRows,
            ...(boq.bidBasis ? [['Pricing Basis', boq.bidBasis.replace(/_/g, ' ')]] : []),
            // Un-gated from isGridMode-only — cessGst is itself gated on
            // gstIncluded being resolved (see its computation above), so
            // 'unknown' correctly shows nothing here rather than a guess.
            ...(cessGst ? [
              ...(boq.cessPercent ? [['Welfare Cess', `${boq.cessPercent}% = ${fmtINR(cessGst.cessAmount)}`]] : []),
              ['GST', gstIncluded === 'yes' ? 'Included in quoted rates'
                : gstIncluded === 'no' ? 'Not applicable'
                : `${boq.gstPercent ?? 0}% = ${fmtINR(cessGst.gstAmount)}`],
              ['Round Off', fmtINR(cessGst.roundOff)],
              ['Grand Total', fmtINR(cessGst.roundedTotal)],
            ] as [string, string][] : []),
            ['Amount in Words', words ?? '—'],
            // Distinct from Quoted Schedule/BOQ/Lump-Sum Amount above — the
            // confirmed figure that actually drives profit below, which can
            // diverge sharply from the quoted figure for a Rate Contract.
            ['Expected Revenue', expectedRevenue.revenue != null ? fmtINR(expectedRevenue.revenue) : (expectedRevenue.reason ?? '--')],
            ...(totalCost > 0 ? [
              ['Total Estimated Cost', fmtINR(totalCost)],
              ['Gross Profit', expectedRevenue.gated
                ? expectedRevenue.reason!
                : (metrics ? `${fmtINR(metrics.grossProfit)} (${metrics.profitPercent.toFixed(2)}% of quoted)` : '—')],
              ['Margin on Cost', expectedRevenue.gated
                ? expectedRevenue.reason!
                : (metrics ? `${metrics.marginPercent.toFixed(2)}%` : '—')],
            ] : [['Total Estimated Cost', '— (enter costs in the calculator below)']]),
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[180px_1fr] gap-2 px-5 py-2.5">
              <span className="text-xs font-semibold text-slate-500">{k}</span>
              <span className={`text-sm text-slate-800 ${k === 'Amount in Words' ? 'italic text-xs' : 'font-medium'}`}>{v}</span>
            </div>
          ))}
        </div>
        <div className={`mx-5 my-3 flex items-center gap-2 rounded-lg px-3 py-2 border text-xs font-medium ${warnColor}`}>
          {warnIcon}
          {warnText}
        </div>
      </div>
    );
  };

  // Always renders in the percentage_rate flow; disabled with reason when prereqs unmet.
  const renderFinalizeButton = () => {
    let disabledReason: string | null = null;
    if (!boq.estimatedAmountConfirmed) {
      disabledReason = 'Confirm the estimated amount to finalise';
    } else if (boq.percentage == null) {
      disabledReason = isGridMode ? 'Price at least one BOQ item to finalise' : 'Enter your bid percentage to finalise';
    } else if (gstCessGated) {
      // Mirrors the rate-contract gate's discipline: a bid_snapshots entry is
      // immutable, so it must never lock in a total computed with an assumed
      // GST treatment when the tender text didn't actually say.
      disabledReason = 'Confirm GST treatment in the Financial Review above to finalise';
    } else if (!gstConfirmed) {
      // Resolved (not 'unknown') but not yet explicitly confirmed via a
      // button click — a high-confidence detection alone isn't consent.
      disabledReason = 'Confirm GST treatment in the Financial Review above to finalise';
    } else if (!estimatedCostConfirmed) {
      disabledReason = 'Confirm your Total Estimated Cost to finalise';
    } else if (!boq.completionPeriodConfirmed) {
      // Bid Validity is captured/confirmable too but deliberately does NOT
      // gate here — many tenders never state it, and nothing calculates
      // from it (see detectTenderValidity.ts).
      disabledReason = 'Confirm Completion Period to finalise';
    } else if (expectedRevenue.gated) {
      // A bid_snapshots entry is immutable — must never lock in a margin
      // computed against a revenue figure that isn't determined and
      // confirmed yet (extends, not replaces, the Rate Contract gate).
      disabledReason = expectedRevenue.reason;
    } else if (!onFinalize) {
      disabledReason = 'Save as a project to lock bid snapshots';
    } else if (warnings?.level === 'red') {
      disabledReason = 'Fix the cost error before finalizing';
    }
    const isDisabled = finalizing || disabledReason !== null;

    return (
      <div className="space-y-2">
        {onFinalize && totalCost <= 0 && !disabledReason && (
          <p className="text-xs text-amber-700 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Enter your cost estimate below to unlock profit analysis before finalizing.
          </p>
        )}
        <button
          onClick={handleFinalize}
          disabled={isDisabled}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2"
        >
          {finalizing
            ? <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            : <Lock className="w-4 h-4" />}
          {finalizing ? 'Saving…' : 'Finalize Bid — Lock Snapshot'}
        </button>
        {disabledReason && !finalizing && (
          <p className="text-xs text-slate-500 text-center">{disabledReason}</p>
        )}
      </div>
    );
  };

  // Zero signals → returns null, no UI change from before this feature
  // existed. One signal → dismissible nudge. Two or more → prominent,
  // no-dismiss (Yes/No only) — margin gating in response to this lives in
  // the summary card, not here.
  const renderRateContractBanner = () => {
    if (boq.isRateContract !== undefined) {
      return (
        <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600">
          <span>Rate Contract: <span className="font-semibold">{boq.isRateContract ? 'Yes' : 'No'}</span></span>
          <button
            onClick={() => setBoq({ ...boq, isRateContract: undefined, boqLastChangedAt: Date.now() })}
            className="text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Change
          </button>
        </div>
      );
    }

    const { signals, reasons } = rateContractHint;
    if (signals.length === 0) return null;

    const strong = signals.length >= 2;
    if (!strong && rateContractHintDismissed) return null;

    return (
      <div className={`rounded-lg border p-3 text-sm ${strong ? 'bg-amber-50 border-amber-300' : 'bg-slate-50 border-slate-200'}`}>
        <div className="flex items-start gap-2">
          <AlertTriangle className={`w-4 h-4 shrink-0 mt-0.5 ${strong ? 'text-amber-600' : 'text-slate-400'}`} />
          <div className="flex-1 min-w-0">
            <p className={`font-semibold ${strong ? 'text-amber-800' : 'text-slate-700'}`}>
              This may be a Rate Contract, not a fully-quantified BOQ.
            </p>
            <ul className="text-xs mt-1 space-y-0.5 opacity-80">
              {reasons.map(r => <li key={r}>• {r}</li>)}
            </ul>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                onClick={() => handleSetRateContract(true)}
                className="px-3 py-1 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
              >
                Yes, it's a Rate Contract
              </button>
              <button
                onClick={() => handleSetRateContract(false)}
                className="px-3 py-1 text-xs font-medium rounded border border-slate-300 hover:bg-slate-100 transition-colors"
              >
                No, quantities are real
              </button>
              {!strong && (
                <button
                  onClick={() => setRateContractHintDismissed(true)}
                  className="px-3 py-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  Not now
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Universal Expected Revenue confirmation — one pattern for all four
  // type-aware cases (see revenueSuggestion above), replacing the old
  // Rate-Contract-only blank input. Never shown while the Rate-Contract
  // status itself is still undetermined (2+ signals) — the banner above
  // handles that first. For a confirmed Rate Contract, confirming here also
  // writes expectedContractValue (the field resolveRateContractRevenue
  // already reads, unmodified) — same gate, nicer UI. For every other type,
  // confirming closes the previously-silent gap where quotedAmount was used
  // as revenue with no confirmation at all.
  const renderExpectedRevenueConfirmation = () => {
    if (boq.isRateContract === undefined && rateContractHint.signals.length >= 2) return null;
    if (boq.isRateContract !== true && quotedAmount == null) return null;

    const suggested = revenueSuggestion.value;
    const isConfirmedAndFresh = !expectedRevenue.gated;

    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <label className="block text-xs font-semibold text-slate-600">Expected Revenue</label>

        {isConfirmedAndFresh ? (
          <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-sm font-semibold text-emerald-800 truncate">{fmtINR(expectedRevenue.revenue!)} Confirmed</span>
            </div>
            <button onClick={handleReconfirmExpectedRevenue} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1 shrink-0">
              <RotateCcw className="w-3 h-3" /> Re-confirm
            </button>
          </div>
        ) : editingRevenue ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-indigo-300">
              <span className="text-slate-400 font-bold text-sm">₹</span>
              <input
                type="number"
                min="0"
                value={revenueInput}
                onChange={e => setRevenueInput(e.target.value)}
                placeholder="How much do you actually expect to earn?"
                className="flex-1 bg-transparent text-slate-900 font-semibold text-sm outline-none"
              />
            </div>
            <button
              onClick={() => {
                const n = parseFloat(revenueInput);
                if (isFinite(n) && n > 0) handleConfirmExpectedRevenue(n);
              }}
              disabled={!(isFinite(parseFloat(revenueInput)) && parseFloat(revenueInput) > 0)}
              className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm rounded-lg transition-colors"
            >
              Confirm Expected Revenue
            </button>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
            <p className="text-xs text-amber-700">
              Suggested: <span className="font-bold text-amber-900">{suggested != null ? fmtINR(suggested) : '--'}</span>
              {' '}<span className="italic">({revenueSuggestion.label})</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => suggested != null && handleConfirmExpectedRevenue(suggested)}
                disabled={suggested == null}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                <CheckCircle2 className="w-3.5 h-3.5" /> Yes, use this
              </button>
              <button
                onClick={() => { setRevenueInput(suggested != null ? String(suggested) : ''); setEditingRevenue(true); }}
                className="px-3 py-1.5 text-xs font-medium rounded border border-slate-300 hover:bg-slate-100 transition-colors flex items-center gap-1"
              >
                <Edit2 className="w-3.5 h-3.5" /> No, enter expected value
              </button>
            </div>
          </div>
        )}
        <p className="text-[11px] text-slate-400">
          This figure — not necessarily {boq.isRateContract === true ? 'the tender ceiling' : 'the quoted amount'} —
          drives Gross Profit/Margin below.
        </p>
      </div>
    );
  };

  // totalCost itself is computed elsewhere (materials + labour line items,
  // owned by ProjectDetails) — nothing to retype here, just a confirmation
  // that the current sum is the one to price against. estimatedCostConfirmed
  // is derived above and self-heals the moment the underlying cost changes.
  const renderEstimatedCostConfirmation = () => {
    if (totalCost <= 0) return null;
    if (estimatedCostConfirmed) {
      return (
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-sm font-semibold text-emerald-800">Total Estimated Cost: {fmtINR(totalCost)} Confirmed</span>
        </div>
      );
    }
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
        <p className="text-xs text-amber-700">
          Total Estimated Cost: <span className="font-bold text-amber-900">{fmtINR(totalCost)}</span> (from your Material &amp; Labour cost entries)
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleConfirmEstimatedCost}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors flex items-center gap-1"
          >
            <CheckCircle2 className="w-3.5 h-3.5" /> Yes, use this cost
          </button>
          <span className="text-[11px] text-slate-500">Edit it in the Cost Estimate section above, then return here to confirm.</span>
        </div>
      </div>
    );
  };

  // Detected from the tender text — see detectTenderValidity.ts. Two
  // genuinely different concepts, kept as separate cards (never merged into
  // one number): Completion Period gates Finalize (the field the original
  // "profit depends on the execution period" rationale was actually about);
  // Bid Validity is captured/confirmable but never blocks Finalize — many
  // tenders never state it, and nothing calculates from it.
  const renderCompletionPeriodConfirmation = () => {
    if (boq.estimatedAmount == null) return null;

    if (boq.completionPeriodConfirmed && !editingCompletionPeriod) {
      return (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-sm font-semibold text-emerald-800">Completion Period: {boq.completionPeriodLabel ?? `${boq.completionPeriodDays} Days`} Confirmed</span>
          </div>
          <button onClick={handleEditCompletionPeriod} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1 shrink-0">
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        </div>
      );
    }

    if (boq.completionPeriodDays != null && !editingCompletionPeriod) {
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
          <p className="text-xs text-amber-700">
            Completion Period: <span className="font-bold text-amber-900">{boq.completionPeriodLabel ?? `${boq.completionPeriodDays} Days`}</span>
            {boq.completionPeriodConfidence != null && (
              <span className="italic"> (detected, {boq.completionPeriodConfidence}% conf.)</span>
            )}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleConfirmCompletionPeriod(boq.completionPeriodDays!, boq.completionPeriodLabel)}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
            </button>
            <button
              onClick={handleEditCompletionPeriod}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-300 hover:bg-slate-100 transition-colors flex items-center gap-1"
            >
              <Edit2 className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        </div>
      );
    }

    // Undetected, or editing an existing value: Months/Years entry — never
    // raw day presets. Completion Period still gates Finalize, so unlike Bid
    // Validity this fallback must always offer a way in.
    const n = parseInt(customCompletionPeriodInput, 10);
    const validCustom = isFinite(n) && n > 0;
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
        <p className="text-xs font-semibold text-amber-800">Completion Period</p>
        {boq.completionPeriodDays == null && (
          <p className="text-[11px] text-amber-600">Could not determine this from the tender text — enter it in months or years below.</p>
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="1"
            value={customCompletionPeriodInput}
            onChange={e => setCustomCompletionPeriodInput(e.target.value)}
            placeholder="e.g. 12"
            className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-amber-300"
          />
          <select
            value={completionPeriodUnit}
            onChange={e => setCompletionPeriodUnit(e.target.value as 'months' | 'years')}
            className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-amber-300"
          >
            <option value="months">Months</option>
            <option value="years">Years</option>
          </select>
          <button
            onClick={() => {
              if (!validCustom) return;
              const days = n * (completionPeriodUnit === 'years' ? 365 : 30);
              handleConfirmCompletionPeriod(days, formatPeriodLabel(n, completionPeriodUnit));
            }}
            disabled={!validCustom}
            className="px-3 py-1.5 text-xs font-medium rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Save
          </button>
        </div>
      </div>
    );
  };

  // Informational only — never gates Finalize. Same detect/confirm/edit or
  // picker structure as Completion Period, just without the mandatory-gate
  // messaging or the "no detection yet" warning line.
  // Auto-detect only — never prompts for a value when detection missed.
  // Informational only (never blocks Finalize), so absence needs no manual
  // fallback prompt; the only manual path is editing an already-detected value.
  const renderBidValidityConfirmation = () => {
    if (boq.estimatedAmount == null) return null;

    if (boq.bidValidityConfirmed && !editingBidValidity) {
      return (
        <div className="flex items-center justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-sm font-semibold text-emerald-800">Bid Validity: {boq.bidValidityLabel ?? `${boq.bidValidityDays} Days`} Confirmed</span>
          </div>
          <button onClick={handleEditBidValidity} className="text-xs text-emerald-700 hover:text-emerald-900 font-medium flex items-center gap-1 shrink-0">
            <Edit2 className="w-3 h-3" /> Edit
          </button>
        </div>
      );
    }

    if (boq.bidValidityDays != null && !editingBidValidity) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs text-slate-600">
            Bid Validity: <span className="font-bold text-slate-800">{boq.bidValidityLabel ?? `${boq.bidValidityDays} Days`}</span>
            {boq.bidValidityConfidence != null && (
              <span className="italic"> (detected, {boq.bidValidityConfidence}% conf.)</span>
            )}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleConfirmBidValidity(boq.bidValidityDays!)}
              className="px-3 py-1.5 text-xs font-semibold rounded bg-slate-700 text-white hover:bg-slate-800 transition-colors flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Confirm
            </button>
            <button
              onClick={handleEditBidValidity}
              className="px-3 py-1.5 text-xs font-medium rounded border border-slate-300 hover:bg-slate-100 transition-colors flex items-center gap-1"
            >
              <Edit2 className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        </div>
      );
    }

    if (editingBidValidity) {
      return (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <p className="text-xs font-semibold text-slate-700">Bid Validity — edit</p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              value={customBidValidityInput}
              onChange={e => setCustomBidValidityInput(e.target.value)}
              placeholder="Days"
              className="w-32 border border-slate-200 rounded-lg px-2 py-1.5 text-xs text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              onClick={() => {
                const n = parseInt(customBidValidityInput, 10);
                if (isFinite(n) && n > 0) handleConfirmBidValidity(n);
              }}
              disabled={!(isFinite(parseInt(customBidValidityInput, 10)) && parseInt(customBidValidityInput, 10) > 0)}
              className="px-3 py-1.5 text-xs font-medium rounded bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const renderHistory = () => {
    if (!onFinalize) return null;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowHistory(h => !h)}
          className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
        >
          <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">
            Bid Revisions ({snapshotsLoading ? '…' : snapshots.length})
          </span>
          {showHistory ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
        </button>
        {showHistory && (
          <div className="divide-y divide-slate-100">
            {snapshotsLoading ? (
              <p className="text-center text-slate-400 text-sm py-6">Loading…</p>
            ) : snapshots.length === 0 ? (
              <p className="text-center text-slate-400 text-sm py-6">No finalized bids yet.</p>
            ) : (
              snapshots.map(s => (
                <div key={s.id} className="px-5 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-bold text-slate-800">Version {s.version}</span>
                    <span className="text-xs text-slate-400">{snapDate(s.createdAt)}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-600">
                    <span>{fmtINR(s.quotedAmount)}</span>
                    <span className="capitalize">{s.aboveBelow} {s.percentage}%</span>
                    {s.totalCost > 0 && <span>Margin {s.marginPercent.toFixed(1)}%</span>}
                  </div>
                  <p className="text-[10px] text-slate-400 italic">{s.quotedAmountWords}</p>
                  {s.remarks && <p className="text-xs text-slate-500">"{s.remarks}"</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-xl border border-indigo-100 shadow-sm overflow-hidden">
      {/* Header — click to collapse / expand */}
      <div
        className="bg-gradient-to-r from-indigo-700 to-indigo-600 px-5 py-4 cursor-pointer select-none"
        onClick={handleToggle}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-white">BOQ & Bid Pricing</h3>
            <p className="text-xs text-indigo-200 mt-0.5">Supported: Percentage Rate, Item Rate & Lump Sum (manual) · Hybrid coming later</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {boq.boqType !== 'unknown' && boq.boqTypeConfidence && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${boq.boqTypeConfidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}
                title={boq.boqTypeReason}
              >
                {boq.boqType === 'percentage_rate' ? 'Percentage Rate'
                  : boq.boqType === 'item_rate' ? 'Item Rate'
                  : boq.boqType === 'lump_sum_epc' ? 'Lump Sum / EPC'
                  : boq.boqType}
                {boq.boqTypeScore != null
                  ? ` · ✓ Auto-detected (${boq.boqTypeScore}%)`
                  : ` · ${boq.boqTypeConfidence} conf.`}
              </span>
            )}
            {isExpanded
              ? <ChevronDown className="w-4 h-4 text-indigo-200" />
              : <ChevronRight className="w-4 h-4 text-indigo-200" />}
          </div>
        </div>
      </div>

      {isExpanded && (
        <div className="p-5 space-y-4">
          {/* BOQ Type selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">BOQ / Contract Type</label>
            <select
              value={boq.boqType}
              onChange={e => setBoq({ ...boq, boqType: e.target.value as any, boqLastChangedAt: Date.now() })}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 bg-white focus:ring-2 focus:ring-indigo-300 outline-none"
            >
              <option value="unknown">— Select BOQ type —</option>
              <option value="percentage_rate">Percentage Rate</option>
              <option value="item_rate">Item Rate</option>
              <option value="lump_sum_epc">Lump Sum / Package</option>
              <option value="hybrid" disabled>Hybrid (coming soon)</option>
            </select>
            {boq.boqType === 'lump_sum_epc' && (
              <p className="text-[11px] text-slate-400 mt-1">
                Lump Sum isn't auto-detected yet — you've selected it manually.
              </p>
            )}
          </div>

          {import.meta.env.DEV && (
            <div className="rounded bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] font-mono text-slate-500 break-all">
              {boq.boqTypeReason
                ? `Detection: ${boq.boqTypeReason}`
                : analysisResult
                ? `Detection (not auto-set — capped low from AI text): ${detectBoqTypeFromAnalysis(analysisResult).reason}`
                : 'Detection: waiting for analysis result'}
            </div>
          )}

          {!isGridMode && boq.boqType !== 'percentage_rate' && boq.boqType !== 'unknown' && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
              <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
              Hybrid BOQ entry is coming in a future update.
            </div>
          )}

          {isGridMode && (
            <>
              {boq.estimatedAmount == null ? (
                <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-600">
                  <AlertCircle className="w-4 h-4 text-slate-400 shrink-0" />
                  No priced {boq.boqType === 'lump_sum_epc' ? 'packages' : 'BOQ items'} yet — open the BOQ tab and enter {boq.boqType === 'lump_sum_epc' ? 'Package Prices' : 'Quoted Rates'}. Totals sync here automatically.
                </div>
              ) : (
                <>
                  {renderFinancialReview()}
                  {/* Expected Revenue confirmation — item_rate/lump_sum have no Rate Contract concept, so the suggestion is always quotedAmount (grid-mode item sum) */}
                  {renderExpectedRevenueConfirmation()}
                  {renderEstimatedCostConfirmation()}
                  {renderCompletionPeriodConfirmation()}
                  {renderBidValidityConfirmation()}
                </>
              )}

              {/* Financial Summary Card */}
              {renderSummaryCard()}

              {/* Finalize button */}
              {renderFinalizeButton()}

              {/* Revision history */}
              {renderHistory()}
            </>
          )}

          {boq.boqType === 'percentage_rate' && (
            <>
              {/* Step 1: Confirm amount */}
              <div>
                <p className="text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-widest">Step 1 — Estimated Amount</p>
                {renderAmountStep()}
              </div>

              {/* Financial Review — GST/Cess treatment + bid-basis question, mandatory before the Bid Calculator so the bidder knows the basis before entering a percentage */}
              {renderFinancialReview()}

              {/* Step 2: Pricing */}
              {renderPricingStep()}

              {/* Rate Contract hint/toggle — no UI at all when zero signals fire */}
              {renderRateContractBanner()}

              {/* Expected Revenue confirmation — universal, all four type-aware cases */}
              {renderExpectedRevenueConfirmation()}

              {/* Total Estimated Cost confirmation */}
              {renderEstimatedCostConfirmation()}

              {/* Completion Period confirmation */}
              {renderCompletionPeriodConfirmation()}

              {/* Bid Validity confirmation (optional — never blocks Finalize) */}
              {renderBidValidityConfirmation()}

              {/* Financial Summary Card */}
              {renderSummaryCard()}

              {/* Finalize button — always visible in percentage_rate flow */}
              {renderFinalizeButton()}

              {/* Revision history */}
              {renderHistory()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
