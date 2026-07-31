// Expanded Tender Overview — glance-first, drill-down-on-demand redesign.
// Purely a display layer: every value here comes from fields the analysis
// pipeline already extracts (see src/lib/analysisPrompt.ts) or the BOQ tab's
// own confirmed state (`boq`). Best-effort sections (Penalty/LD, Price
// Variation, Payment Terms, Blacklisting, Warranty, Evaluation,
// Subcontracting) are keyword-classified from cons_and_risks/pros — see
// src/lib/overview/classifyOverviewProse.ts for why classification always
// runs against `baseDetails` (untranslated) while rendering reads
// `displayDetails` (translated) at the same index.
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  IndianRupee, Clock, Target, Calendar, Wallet, Shield, Gavel, TrendingUp,
  Ban, ClipboardList, Users, ScrollText, MessageSquare, ChevronDown,
  ChevronUp, CreditCard, Award,
} from "lucide-react";
import type { BOQData } from "../../lib/boq/types";
import { fmtINR } from "../../lib/boq/calculator";
import {
  findProseMatches, resolveProseMatch, bucketComplianceRequirement,
  type HighlightBucket,
  PENALTY_LD_KEYWORDS, PRICE_VARIATION_KEYWORDS, PAYMENT_TERMS_KEYWORDS,
  BLACKLISTING_KEYWORDS, WARRANTY_KEYWORDS, EVALUATION_KEYWORDS,
  SUBCONTRACTING_KEYWORDS,
} from "../../lib/overview/classifyOverviewProse";

interface SharedProps {
  baseDetails: any;
  displayDetails: any;
  onAskAi: (prompt: string) => void;
}

function GlanceStat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-start gap-3 min-w-0">
      <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500 truncate">{label}</p>
        <p className="text-base font-bold text-slate-900 truncate" title={value}>{value}</p>
      </div>
    </div>
  );
}

function AskAiLink({ prompt, onAskAi, t }: { prompt: string; onAskAi: (p: string) => void; t: (k: string) => string }) {
  return (
    <button
      onClick={() => onAskAi(prompt)}
      className="text-xs font-semibold text-slate-500 hover:text-indigo-600 flex items-center gap-1 shrink-0"
    >
      <MessageSquare className="w-3.5 h-3.5" /> {t('ask_ai_about_this')}
    </button>
  );
}

interface DetailCardProps {
  icon: ReactNode;
  title: string;
  hasData: boolean;
  bestEffort?: boolean;
  emptyMessage: string;
  askPrompt: string;
  onAskAi: (prompt: string) => void;
  t: (k: string) => string;
  children?: ReactNode;
}

function DetailCard({ icon, title, hasData, bestEffort, emptyMessage, askPrompt, onAskAi, t, children }: DetailCardProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden print:break-inside-avoid">
      <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <span className="text-indigo-600 shrink-0">{icon}</span>{title}
        </h3>
        {bestEffort && hasData && (
          <span className="text-[10px] font-semibold uppercase tracking-wide bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
            {t('best_effort_badge')}
          </span>
        )}
      </div>
      <div className="p-5">
        {hasData ? (
          <>
            <div className={expanded ? "" : "max-h-28 overflow-hidden relative"}>
              {children}
              {!expanded && (
                <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
              )}
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100">
              <button
                onClick={() => setExpanded((e) => !e)}
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {expanded ? t('read_less') : t('read_more')}
              </button>
              <AskAiLink prompt={askPrompt} onAskAi={onAskAi} t={t} />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-slate-500">
              {emptyMessage}{' '}
              <button onClick={() => onAskAi(askPrompt)} className="text-indigo-600 hover:text-indigo-800 font-semibold underline underline-offset-2">
                {t('fallback_ask_ai_link')}
              </button>
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ProseList({ items }: { items: string[] }) {
  return (
    <ul className="space-y-2 text-sm text-slate-700 list-disc pl-4">
      {items.map((text, i) => <li key={i}>{text}</li>)}
    </ul>
  );
}

/** Runs a keyword scan against baseDetails, resolves matched text against
 *  displayDetails at the same indices — the language-independent-matching /
 *  language-correct-rendering split classifyOverviewProse.ts documents. */
function getKeywordSectionItems(baseDetails: any, displayDetails: any, keywords: string[]): string[] {
  const matches = findProseMatches(baseDetails, keywords);
  return matches.map((m) => resolveProseMatch(m, displayDetails)).filter(Boolean);
}

interface HighlightColumnProps {
  title: string;
  items: string[];
  askPrompt: string;
  onAskAi: (prompt: string) => void;
}

function HighlightColumn({ title, items, askPrompt, onAskAi }: HighlightColumnProps) {
  const { t } = useTranslation();
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col print:break-inside-avoid">
      <h4 className="font-semibold text-slate-800 mb-3">{title}</h4>
      {items.length > 0 ? (
        <ul className="space-y-2 text-sm text-slate-700 flex-1">
          {items.map((text, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 mt-1.5 shrink-0" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-slate-400 flex-1">{t('highlights_none')}</p>
      )}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <AskAiLink prompt={askPrompt} onAskAi={onAskAi} t={t} />
      </div>
    </div>
  );
}

export function OverviewGlanceAndDetails({ baseDetails, displayDetails, boq, tenderValue, onAskAi }: SharedProps & { boq: BOQData; tenderValue: number | null }) {
  const { t } = useTranslation();

  const completionPeriodValue = boq?.completionPeriodConfirmed
    ? (boq.completionPeriodLabel || (boq.completionPeriodDays ? `${boq.completionPeriodDays} Days` : null))
    : null;
  const periodDisplay = completionPeriodValue || displayDetails?.timeline_and_milestones?.execution_duration || t('glance_not_available');

  const boqValueDisplay = (boq?.estimatedAmountConfirmed && boq.estimatedAmount != null)
    ? fmtINR(boq.estimatedAmount)
    : t('glance_not_available');

  const matchScoreDisplay = displayDetails?.compatibility?.score != null
    ? `${displayDetails.compatibility.score}/100`
    : t('glance_not_available');

  const deadlineDisplay = displayDetails?.timeline_and_milestones?.submission_deadline || t('glance_not_available');

  // Grouped highlights — compliance_matrix requirements bucketed by
  // keyword, classified against baseDetails (index-stable), rendered from
  // displayDetails at the same index.
  const baseCompliance: any[] = Array.isArray(baseDetails?.compliance_matrix) ? baseDetails.compliance_matrix : [];
  const displayCompliance: any[] = Array.isArray(displayDetails?.compliance_matrix) ? displayDetails.compliance_matrix : [];
  const buckets: Record<HighlightBucket, string[]> = { financial: [], technical: [], qualification: [] };
  baseCompliance.forEach((item, i) => {
    const bucket = bucketComplianceRequirement(item?.requirement || "");
    const text = displayCompliance[i]?.requirement;
    if (text) buckets[bucket].push(text);
  });
  const emd = displayDetails?.emd_details;
  const financialExtras: string[] = [];
  if (emd?.amount != null) financialExtras.push(`${t('label_emd')}: ${fmtINR(emd.amount)}${emd.mode ? ` (${emd.mode})` : ''}`);
  const br = displayDetails?.bid_recommendation;
  if (br?.recommended != null) financialExtras.push(`${br.rationale ? br.rationale : `${t('glance_tender_value')}: ${fmtINR(br.recommended)}`}`);

  // Best-effort keyword sections.
  const penaltyItems = getKeywordSectionItems(baseDetails, displayDetails, PENALTY_LD_KEYWORDS);
  const priceVariationItems = getKeywordSectionItems(baseDetails, displayDetails, PRICE_VARIATION_KEYWORDS);
  const paymentTermsItems = getKeywordSectionItems(baseDetails, displayDetails, PAYMENT_TERMS_KEYWORDS);
  const blacklistingItems = getKeywordSectionItems(baseDetails, displayDetails, BLACKLISTING_KEYWORDS);
  const warrantyItems = getKeywordSectionItems(baseDetails, displayDetails, WARRANTY_KEYWORDS);
  const evaluationItems = getKeywordSectionItems(baseDetails, displayDetails, EVALUATION_KEYWORDS);
  const subcontractingItems = getKeywordSectionItems(baseDetails, displayDetails, SUBCONTRACTING_KEYWORDS);

  const scope = displayDetails?.tender_simplified?.scope_of_work;
  const tm = displayDetails?.timeline_and_milestones || {};

  return (
    <div className="space-y-8">
      {/* At a glance */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-3">{t('overview_at_a_glance')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <GlanceStat icon={<IndianRupee className="w-4 h-4" />} label={t('glance_tender_value')} value={tenderValue != null ? fmtINR(tenderValue) : t('glance_not_available')} />
          <GlanceStat icon={<Clock className="w-4 h-4" />} label={t('glance_completion_period')} value={periodDisplay} />
          <GlanceStat icon={<Wallet className="w-4 h-4" />} label={t('glance_boq_value')} value={boqValueDisplay} />
          <GlanceStat icon={<Target className="w-4 h-4" />} label={t('glance_match_score')} value={matchScoreDisplay} />
          <GlanceStat icon={<Calendar className="w-4 h-4" />} label={t('glance_submission_deadline')} value={deadlineDisplay} />
        </div>
      </div>

      {/* Grouped highlights */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 mb-3">{t('overview_key_highlights')}</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <HighlightColumn onAskAi={onAskAi} title={t('highlights_financial')} items={[...financialExtras, ...buckets.financial]} askPrompt={t('ask_prompt_financial_highlights')} />
          <HighlightColumn onAskAi={onAskAi} title={t('highlights_technical')} items={buckets.technical} askPrompt={t('ask_prompt_technical_highlights')} />
          <HighlightColumn onAskAi={onAskAi} title={t('highlights_qualification')} items={buckets.qualification} askPrompt={t('ask_prompt_qualification_highlights')} />
        </div>
      </div>

      {/* Detail sections */}
      <div>
        <div className="grid md:grid-cols-2 gap-4">
          <DetailCard icon={<Shield className="w-4.5 h-4.5" />} title={t('section_emd_title')} hasData t={t} emptyMessage="" askPrompt={t('ask_prompt_emd')} onAskAi={onAskAi}>
            <dl className="grid sm:grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-slate-500 text-xs font-medium">{t('label_emd')}</dt>
                <dd className="font-semibold text-slate-800 mt-0.5">
                  {emd?.amount != null || emd?.mode
                    ? [emd?.amount != null ? fmtINR(emd.amount) : null, emd?.mode].filter(Boolean).join(' · ')
                    : t('fallback_not_specified')}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs font-medium">{t('label_security_deposit')}</dt>
                <dd className="font-semibold text-slate-800 mt-0.5">{t('fallback_not_specified')}</dd>
              </div>
              <div>
                <dt className="text-slate-500 text-xs font-medium">{t('label_performance_guarantee')}</dt>
                <dd className="font-semibold text-slate-800 mt-0.5">{t('fallback_not_specified')}</dd>
              </div>
              {emd?.msme_exemption != null && (
                <div>
                  <dt className="text-slate-500 text-xs font-medium">{t('label_msme_exemption')}</dt>
                  <dd className="font-semibold text-slate-800 mt-0.5">{emd.msme_exemption ? t('value_yes') : t('value_no')}</dd>
                </div>
              )}
            </dl>
          </DetailCard>

          <DetailCard icon={<Calendar className="w-4.5 h-4.5" />} title={t('section_dates_title')} hasData t={t} emptyMessage="" askPrompt={t('ask_prompt_dates')} onAskAi={onAskAi}>
            <dl className="grid sm:grid-cols-2 gap-3 text-sm">
              {[
                [t('pre_bid_meeting'), tm.pre_bid_meeting],
                [t('clarification_deadline'), tm.clarification_deadline],
                [t('bid_submission'), tm.submission_deadline],
                [t('label_execution_duration'), tm.execution_duration],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <dt className="text-slate-500 text-xs font-medium">{label}</dt>
                  <dd className="font-semibold text-slate-800 mt-0.5">{(val as string) || t('fallback_not_specified')}</dd>
                </div>
              ))}
            </dl>
          </DetailCard>

          <DetailCard icon={<ScrollText className="w-4.5 h-4.5" />} title={t('section_scope_title')} hasData={!!scope} t={t} emptyMessage={t('fallback_not_specified')} askPrompt={t('ask_prompt_scope')} onAskAi={onAskAi}>
            <p className="text-sm text-slate-700 whitespace-pre-line">{scope}</p>
          </DetailCard>

          <DetailCard icon={<Gavel className="w-4.5 h-4.5" />} title={t('section_penalty_title')} bestEffort hasData={penaltyItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_penalty')} onAskAi={onAskAi}>
            <ProseList items={penaltyItems} />
          </DetailCard>

          <DetailCard icon={<TrendingUp className="w-4.5 h-4.5" />} title={t('section_price_variation_title')} bestEffort hasData={priceVariationItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_price_variation')} onAskAi={onAskAi}>
            <ProseList items={priceVariationItems} />
          </DetailCard>

          <DetailCard icon={<CreditCard className="w-4.5 h-4.5" />} title={t('section_payment_terms_title')} bestEffort hasData={paymentTermsItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_payment_terms')} onAskAi={onAskAi}>
            <ProseList items={paymentTermsItems} />
          </DetailCard>

          <DetailCard icon={<Ban className="w-4.5 h-4.5" />} title={t('section_blacklisting_title')} bestEffort hasData={blacklistingItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_blacklisting')} onAskAi={onAskAi}>
            <ProseList items={blacklistingItems} />
          </DetailCard>

          <DetailCard icon={<Award className="w-4.5 h-4.5" />} title={t('section_warranty_title')} bestEffort hasData={warrantyItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_warranty')} onAskAi={onAskAi}>
            <ProseList items={warrantyItems} />
          </DetailCard>

          <DetailCard icon={<ClipboardList className="w-4.5 h-4.5" />} title={t('section_evaluation_title')} bestEffort hasData={evaluationItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_evaluation')} onAskAi={onAskAi}>
            <ProseList items={evaluationItems} />
          </DetailCard>

          <DetailCard icon={<Users className="w-4.5 h-4.5" />} title={t('section_subcontracting_title')} bestEffort hasData={subcontractingItems.length > 0} t={t} emptyMessage={t('fallback_no_match_prefix')} askPrompt={t('ask_prompt_subcontracting')} onAskAi={onAskAi}>
            <ProseList items={subcontractingItems} />
          </DetailCard>
        </div>
      </div>
    </div>
  );
}

export function OverviewAiSummary({ displayDetails, onAskAi }: { displayDetails: any; onAskAi: (prompt: string) => void }) {
  const { t } = useTranslation();
  const rationale = displayDetails?.compatibility?.rationale;
  const pros: string[] = Array.isArray(displayDetails?.tender_simplified?.pros) ? displayDetails.tender_simplified.pros : [];
  const cons: string[] = Array.isArray(displayDetails?.tender_simplified?.cons_and_risks) ? displayDetails.tender_simplified.cons_and_risks : [];
  const hasData = !!rationale || pros.length > 0 || cons.length > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden print:break-inside-avoid">
      <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2">
          <span className="text-indigo-600"><Target className="w-4.5 h-4.5" /></span>{t('ai_summary_title')}
        </h3>
      </div>
      <div className="p-5">
        {hasData ? (
          <div className="space-y-4">
            {rationale && <p className="text-sm text-slate-700 leading-relaxed">{rationale}</p>}
            {(pros.length > 0 || cons.length > 0) && (
              <div className="grid sm:grid-cols-2 gap-4">
                {pros.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-emerald-700 mb-1.5">{t('green_flags')}</p>
                    <ul className="space-y-1 text-sm text-slate-700 list-disc pl-4">{pros.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  </div>
                )}
                {cons.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-red-700 mb-1.5">{t('red_flags')}</p>
                    <ul className="space-y-1 text-sm text-slate-700 list-disc pl-4">{cons.map((c, i) => <li key={i}>{c}</li>)}</ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">{t('fallback_not_specified')}</p>
        )}
        <div className="flex justify-end mt-3 pt-3 border-t border-slate-100">
          <AskAiLink prompt={t('ask_prompt_ai_summary')} onAskAi={onAskAi} t={t} />
        </div>
      </div>
    </div>
  );
}
