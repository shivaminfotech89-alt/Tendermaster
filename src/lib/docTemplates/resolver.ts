import type { PlaceholderContext } from './types';

// Printed in the document wherever a value is missing — consistent with the
// rest of the document pipeline and legible on printed forms.
export const BLANK = '__________';

const v = (s: string | null | undefined): string => s?.trim() || BLANK;

const today = (): string =>
  new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

type Resolver = (ctx: PlaceholderContext) => string;

const PLACEHOLDERS: Record<string, Resolver> = {
  // ── Runtime ────────────────────────────────────────────────────────────────
  date: () => today(),

  // ── Company identity ───────────────────────────────────────────────────────
  companyName:               (c) => v(c.profile?.companyName),
  companyType:               (c) => v(c.profile?.companyType),
  dateOfIncorporation:       (c) => v(c.profile?.dateOfIncorporation),
  experienceYears:           (c) => v(String(c.profile?.experienceYears ?? '')),
  numberOfEmployees:         (c) => v(c.profile?.numberOfEmployees),
  msmeStatus:                (c) => v(c.profile?.msmeStatus),
  vendorRegistrationNumbers: (c) => v(c.profile?.vendorRegistrationNumbers),
  registrationClass:         (c) => v(c.profile?.registrationClass),

  // ── Address ────────────────────────────────────────────────────────────────
  registeredOfficeAddress: (c) => v(c.profile?.registeredOfficeAddress),
  worksAddress:            (c) => v(c.profile?.worksAddress || c.profile?.registeredOfficeAddress),
  state:                   (c) => v(c.profile?.state),
  city:                    (c) => v(c.profile?.city),
  district:                (c) => v(c.profile?.district),
  pinCode:                 (c) => v(c.profile?.pinCode),
  place:                   (c) => v(c.profile?.place || c.profile?.city),

  // ── Contact ────────────────────────────────────────────────────────────────
  phone:   (c) => v(c.profile?.phone),
  mobile:  (c) => v(c.profile?.mobile || c.profile?.phone),
  fax:     (c) => v(c.profile?.fax),
  email:   (c) => v(c.profile?.email),
  website: (c) => v(c.profile?.website),

  // ── Statutory numbers ──────────────────────────────────────────────────────
  gstNumber:             (c) => v(c.profile?.gstNumber),
  panNumber:             (c) => v(c.profile?.panNumber),
  tanNumber:             (c) => v(c.profile?.tanNumber),
  cinLlpin:              (c) => v(c.profile?.cinLlpin),
  udyamNumber:           (c) => v(c.profile?.udyamNumber),
  esicNumber:            (c) => v(c.profile?.esicNumber),
  epfNumber:             (c) => v(c.profile?.epfNumber),
  professionalTaxNumber: (c) => v(c.profile?.professionalTaxNumber),
  tradeLicenseNumber:    (c) => v(c.profile?.tradeLicenseNumber),
  labourLicenseNumber:   (c) => v(c.profile?.labourLicenseNumber),

  // ── Bank ───────────────────────────────────────────────────────────────────
  bankName:          (c) => v(c.profile?.bankName),
  bankBranch:        (c) => v(c.profile?.bankBranch),
  bankAccountNumber: (c) => v(c.profile?.bankAccountNumber),
  bankIfsc:          (c) => v(c.profile?.bankIfsc),
  bankAccountType:   (c) => v(c.profile?.bankAccountType),

  // ── Signatory ──────────────────────────────────────────────────────────────
  authorizedSignatoryName:        (c) => v(c.profile?.authorizedSignatoryName),
  authorizedSignatoryDesignation: (c) => v(c.profile?.authorizedSignatoryDesignation),
  authorizedSignatoryDin:         (c) => v(c.profile?.authorizedSignatoryDin),
  authorizedSignatoryPan:         (c) => v(c.profile?.authorizedSignatoryPan),

  // ── Experience ─────────────────────────────────────────────────────────────
  experienceSummary: (c) => v(c.profile?.experienceSummary),

  // ── Turnover ───────────────────────────────────────────────────────────────
  turnoverYear1Label: (c) => v(c.profile?.turnoverYear1Label) === BLANK ? 'F.Y. 1' : v(c.profile?.turnoverYear1Label),
  turnoverYear2Label: (c) => v(c.profile?.turnoverYear2Label) === BLANK ? 'F.Y. 2' : v(c.profile?.turnoverYear2Label),
  turnoverYear3Label: (c) => v(c.profile?.turnoverYear3Label) === BLANK ? 'F.Y. 3' : v(c.profile?.turnoverYear3Label),
  turnoverYear1: (c) => {
    const val = c.profile?.turnoverYear1?.toString().trim();
    if (!val) return BLANK;
    return `₹ ${val} ${c.profile?.turnoverUnit || 'Lakhs'}`;
  },
  turnoverYear2: (c) => {
    const val = c.profile?.turnoverYear2?.toString().trim();
    if (!val) return BLANK;
    return `₹ ${val} ${c.profile?.turnoverUnit || 'Lakhs'}`;
  },
  turnoverYear3: (c) => {
    const val = c.profile?.turnoverYear3?.toString().trim();
    if (!val) return BLANK;
    return `₹ ${val} ${c.profile?.turnoverUnit || 'Lakhs'}`;
  },

  // ── Tender ────────────────────────────────────────────────────────────────
  tenderNumber:       (c) => v(c.analysis?.tender_simplified?.tender_number),
  tenderName:         (c) => v(c.analysis?.tender_simplified?.tender_name),
  authorityName:      (c) => v(c.analysis?.tender_simplified?.authority_name),
  tenderValue:        (c) => v(c.analysis?.tender_simplified?.tender_value),
  emdAmount:          (c) => v(c.analysis?.emd_details?.amount),
  submissionDeadline: (c) => v(c.analysis?.timeline_and_milestones?.submission_deadline),
  executionDuration:  (c) => v(c.analysis?.timeline_and_milestones?.execution_duration),
  scopeOfWork:        (c) => v(c.analysis?.tender_simplified?.scope_of_work),

  // ── Derived: objectives from tender analysis ───────────────────────────────
  objectives: (c) => {
    const tenderName = c.analysis?.tender_simplified?.tender_name;
    const scope = c.analysis?.tender_simplified?.scope_of_work?.trim();
    if (!scope) return `- ${BLANK}\n- ${BLANK}\n- ${BLANK}`;
    return `- To complete and deliver all work described under "${tenderName || 'this tender'}" in full compliance with all technical specifications, drawings, and standards.\n` +
      `- To ensure quality, safety, and timely handover within the stipulated contract period.\n` +
      `- To maintain transparent communication, progress reporting, and documentation throughout the contract.`;
  },

  // ── Derived: deliverables from tender annexures / roadmap ─────────────────
  deliverables: (c) => {
    const annexures = c.analysis?.required_annexures;
    const steps = c.analysis?.application_roadmap?.next_immediate_steps;
    if (Array.isArray(annexures) && annexures.length > 0) {
      return annexures.map((a, i) =>
        `${i + 1}. **${a.annexure_name || ''}**${a.purpose ? ` — ${a.purpose}` : ''}`
      ).join('\n');
    }
    if (Array.isArray(steps) && steps.length > 0) {
      return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
    }
    return `1. ${BLANK}\n2. ${BLANK}\n3. ${BLANK}`;
  },

  // ── BOQ / Bid Pricing placeholders ────────────────────────────────────────
  boqType: (c) => v(c.boq?.boqType),
  estimatedAmount: (c) => {
    const n = c.boq?.estimatedAmount;
    return (n != null && Number.isFinite(n)) ? `₹${n.toLocaleString('en-IN')}` : BLANK;
  },
  estimatedAmountConfirmed: (c) => c.boq?.estimatedAmountConfirmed ? 'Yes' : BLANK,
  percentage: (c) => {
    const pct = c.boq?.percentage;
    return (pct != null && Number.isFinite(pct)) ? `${pct}%` : BLANK;
  },
  aboveBelow: (c) => v(c.boq?.aboveBelow),
  quotedAmount: (c) => {
    const n = c.boq?.quotedAmount;
    return (n != null && Number.isFinite(n)) ? `₹${n.toLocaleString('en-IN')}` : BLANK;
  },
  quotedAmountWords: (c) => v(c.boq?.quotedAmountWords),
  profitPercentage: (c) => {
    const n = c.boq?.profitPercent;
    return (n != null && Number.isFinite(n)) ? `${n.toFixed(2)}%` : BLANK;
  },
  grossProfit: (c) => {
    const n = c.boq?.grossProfit;
    return (n != null && Number.isFinite(n)) ? `₹${n.toLocaleString('en-IN')}` : BLANK;
  },
  marginPercentage: (c) => {
    const n = c.boq?.marginPercent;
    return (n != null && Number.isFinite(n)) ? `${n.toFixed(2)}%` : BLANK;
  },
  boqRemarks: (c) => v(c.boq?.remarks),

  // ── Derived: enclosures list from required_documents_checklist ────────────
  enclosuresList: (c) => {
    const header = `| Sr. No. | Document | Status |\n|---|---|---|`;
    const checklist = c.analysis?.required_documents_checklist;
    if (Array.isArray(checklist) && checklist.length > 0) {
      const rows = checklist.map((doc, i) => `| ${i + 1} | ${doc.document_name || ''} | Enclosed |`).join('\n');
      return `${header}\n${rows}`;
    }
    return `${header}\n| 1 | Covering Letter | Enclosed |\n| 2 | Technical Bid Documents | Enclosed |\n| 3 | Financial Bid / Price Schedule | Enclosed |\n\n*(Please update this list to match your actual submission)*`;
  },
};

export function extractPlaceholders(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g) ?? [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

export function resolve(template: string, ctx: PlaceholderContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const fn = PLACEHOLDERS[key];
    if (!fn) return BLANK;
    try {
      return fn(ctx);
    } catch {
      return BLANK;
    }
  });
}
