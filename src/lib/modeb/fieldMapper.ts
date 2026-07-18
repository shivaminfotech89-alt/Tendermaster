/**
 * fieldMapper.ts — Mode B value-mapping stage
 *
 * Pure function: DetectedField[] + page dimensions + user data → MappedField[]
 * No network calls, no side effects, fully testable offline.
 *
 * Contract:
 *   • Value always comes from profile/directors verbatim — never invented.
 *   • Empty/missing profile field → value = '', status = 'blank'.
 *   • Unrecognised label → value = '', status = 'needs_review'.
 *   • Signature/seal fields → value = '', status = 'skip'.
 *   • Date field auto-fills today's date (editable in review step).
 */

import type {
  BusinessProfile,
  Director,
  TenderData,
  DetectedField,
  MappedField,
  PdfRect,
  FieldStatus,
} from './types';

// ── Coordinate conversion ─────────────────────────────────────────────────────
// Gemini: [y_min, x_min, y_max, x_max] in 0-1000, top-left origin
// PDF:    x from left, y from bottom (pts)

function toPdfRect(
  box: [number, number, number, number],
  pageW: number,
  pageH: number,
): PdfRect {
  const [yMin, xMin, yMax, xMax] = box;
  const x = (xMin / 1000) * pageW;
  const yFromTop = (yMin / 1000) * pageH;
  const width = ((xMax - xMin) / 1000) * pageW;
  const height = ((yMax - yMin) / 1000) * pageH;
  return { x, y: pageH - yFromTop - height, width, height };
}

// ── Normalisation ─────────────────────────────────────────────────────────────

function norm(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\w\s/]/g, ' ')  // punctuation → space (keep / for a/c, cin/llpin)
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Director-row pattern extraction ──────────────────────────────────────────
// Handles labels like:
//   "Director Row 1 Full Name"  →  idx=0, field='name'
//   "Sr. No. 2 DIN"             →  idx=1, field='din'
//   "Partner 3 Address"         →  idx=2, field='address'
//   "3 PAN"                     →  idx=2, field='pan'

type DirectorSubField = 'name' | 'designation' | 'din' | 'pan' | 'address';

const DIRECTOR_IDX_RE =
  /(?:(?:director|partner|promoter|member|proprietor|row|sr\.?\s*no\.?)\s*[.#:-]?\s*(\d)|(\d)\s*[.#:-]\s*(?=\w))/i;

const DIRECTOR_FIELD_RE = /\b(full\s*name|name|din|pan|designation|desig|address|residential|flat|house)\b/i;

const DIRECTOR_FIELD_MAP: Record<string, DirectorSubField> = {
  'full name': 'name', name: 'name',
  din: 'din', pan: 'pan',
  designation: 'designation', desig: 'designation',
  address: 'address', residential: 'address', flat: 'address', house: 'address',
};

function extractDirectorRow(
  n: string,
): { idx: number; subField: DirectorSubField } | null {
  const idxMatch = n.match(DIRECTOR_IDX_RE);
  if (!idxMatch) return null;
  const idx = parseInt(idxMatch[1] ?? idxMatch[2], 10) - 1; // 1-indexed → 0-indexed
  if (idx < 0 || idx > 9) return null;

  // Look for sub-field AFTER the matched index position to avoid false positives
  // from header text (e.g. "with DIN (if any)" appearing before "Sr. No. 1 - Full Name").
  const afterIdx = n.slice((idxMatch.index ?? 0) + idxMatch[0].length);
  const fieldMatch = afterIdx.match(DIRECTOR_FIELD_RE);
  if (!fieldMatch) return null;
  const key = fieldMatch[1].toLowerCase().replace(/\s+/g, ' ');
  const subField = DIRECTOR_FIELD_MAP[key];
  return subField ? { idx, subField } : null;
}

// ── Turnover-year extraction ──────────────────────────────────────────────────
// Handles:
//   "Turnover Year 1"   →  0
//   "Annual Turnover 2" →  1
//   "F.Y. 3"            →  2

function extractTurnoverIdx(n: string): number | null {
  const m =
    n.match(/\b(?:year|yr)\s*[.#-]?\s*([123])\b/) ??
    n.match(/\bturnover\s*[.#-]?\s*([123])\b/) ??
    n.match(/\bf\.?\s*y\.?\s*[.#-]?\s*([123])\b/);
  if (!m) return null;
  const idx = parseInt(m[1], 10) - 1;
  return idx >= 0 && idx <= 2 ? idx : null;
}

// ── Rule table ────────────────────────────────────────────────────────────────

const p = (r: string) => new RegExp(r, 'i');

// Matches fill_area_description or notes values that describe a checkbox /
// tick-box / radio-button — these fields must never have text overlaid.
const CHOICE_FIELD_RE =
  /\b(check\s*box|tick\s*box|radio(?:\s*button)?|circle.*(?:tick|select|check)|tick\s*mark|put.*tick|check\s*mark)\b/i;

interface Rule {
  patterns: RegExp[];
  source: string;
  status?: FieldStatus;   // override: 'skip' for signature/seal
  resolve: (
    pr: BusinessProfile,
    dirs: Director[],
    tender?: TenderData,
  ) => string | null;
}

const RULES: Rule[] = [

  // ── A. Company identity ────────────────────────────────────────────────────
  {
    patterns: [p('name of (firm|company|agency|bidder|tenderer)'), p('\\bfirm\\s*name\\b'), p('\\bcompany\\s*name\\b')],
    source: 'profile.companyName',
    resolve: (pr) => pr.companyName || null,
  },
  {
    patterns: [p("name of proprietor"), p("proprietor'?s?\\s*name")],
    source: 'profile.proprietorName',
    resolve: (pr) => pr.proprietorName || null,
  },
  {
    patterns: [
      p('type of (firm|organisation|organization|entity|business)'),
      p('constitution of (firm|company)'),
      p('nature of (firm|entity|business)'),
      p('form of (organisation|organization|entity)'),
    ],
    source: 'profile.companyType',
    resolve: (pr) => pr.companyType || null,
  },
  {
    patterns: [p('\\bcin\\b'), p('\\bllpin\\b'), p('cin\\s*/\\s*llpin')],
    source: 'profile.cinLlpin',
    resolve: (pr) => pr.cinLlpin || null,
  },
  {
    patterns: [p('\\budyam\\b'), p('msme\\s*(reg|number|no|cert)'), p('msme\\s*registration'), p('udyam\\s*(reg|no)')],
    source: 'profile.udyamNumber',
    resolve: (pr) => pr.udyamNumber || null,
  },
  {
    patterns: [p('year of estab'), p('date of estab'), p('date of incorporation'), p('year of incorporation'), p('established\\s*in')],
    source: 'profile.dateOfIncorporation',
    resolve: (pr) => pr.dateOfIncorporation || null,
  },

  // ── B. Address & location ──────────────────────────────────────────────────
  {
    patterns: [
      p('registered (office )?address'),
      p('regd\\.?\\s*address'),
      p('address of (firm|company)'),
      p('^registered address$'),
      p('^address of applicant$'),
    ],
    source: 'profile.registeredOfficeAddress',
    resolve: (pr) => pr.registeredOfficeAddress || null,
  },
  {
    patterns: [p('works\\s*address'), p('operational\\s*address'), p('factory\\s*address'), p('plant\\s*address')],
    source: 'profile.worksAddress',
    resolve: (pr) => pr.worksAddress || pr.registeredOfficeAddress || null,
  },
  {
    patterns: [p('^office\\s*address$'), p('^communication\\s*address$'), p('^postal\\s*address$')],
    source: 'profile.registeredOfficeAddress',
    resolve: (pr) => pr.registeredOfficeAddress || null,
  },
  {
    patterns: [p('\\bstate\\b')],
    source: 'profile.state',
    resolve: (pr) => pr.state || null,
  },
  {
    patterns: [p('\\bdistrict\\b'), p('\\bdist\\.\\b')],
    source: 'profile.district',
    resolve: (pr) => pr.district || null,
  },
  {
    patterns: [p('\\bpin\\s*code\\b'), p('\\bpincode\\b'), p('\\bpostal\\s*code\\b'), p('\\bzip\\b')],
    source: 'profile.pinCode',
    resolve: (pr) => pr.pinCode || null,
  },
  {
    patterns: [p('\\bcity\\b'), p('\\btown\\b')],
    source: 'profile.city',
    resolve: (pr) => pr.city || null,
  },
  {
    patterns: [p('^place$'), p('place of signing'), p('place of submission'), p('^place\\b')],
    source: 'profile.place',
    resolve: (pr) => pr.place || null,
  },

  // ── C. Statutory numbers ───────────────────────────────────────────────────
  {
    patterns: [p('\\bgstin?\\b'), p('gst\\s*(no|number|reg)'), p('gst\\s*registration\\s*(no|number)')],
    source: 'profile.gstNumber',
    resolve: (pr) => pr.gstNumber || null,
  },
  {
    patterns: [p('\\bpan\\b'), p('pan\\s*(no|number|card)'), p('permanent account (number|no)')],
    source: 'profile.panNumber',
    resolve: (pr) => pr.panNumber || null,
  },
  {
    patterns: [p('\\btan\\b'), p('tan\\s*(no|number)'), p('tax deduction account')],
    source: 'profile.tanNumber',
    resolve: (pr) => pr.tanNumber || null,
  },
  {
    patterns: [p('\\besic\\b'), p('esic\\s*(no|number)'), p('employees?\\s*state\\s*insurance')],
    source: 'profile.esicNumber',
    resolve: (pr) => pr.esicNumber || null,
  },
  {
    patterns: [p('\\bepf\\b'), p('epf\\s*(no|number)'), p('\\bpf\\s*(no|number)\\b'), p('provident\\s*fund')],
    source: 'profile.epfNumber',
    resolve: (pr) => pr.epfNumber || null,
  },
  {
    patterns: [p('professional\\s*tax'), p('\\bpt\\s*no\\b'), p('\\bptax\\b')],
    source: 'profile.professionalTaxNumber',
    resolve: (pr) => pr.professionalTaxNumber || null,
  },
  {
    patterns: [p('trade\\s*(license|licence)'), p('trade\\s*lic\\b')],
    source: 'profile.tradeLicenseNumber',
    resolve: (pr) => pr.tradeLicenseNumber || null,
  },
  {
    patterns: [p('labour\\s*(license|licence)'), p('works\\s*contractor\\s*(license|licence)'), p('contractor\\s*(license|licence)')],
    source: 'profile.labourLicenseNumber',
    resolve: (pr) => pr.labourLicenseNumber || null,
  },

  // ── D. Contact ─────────────────────────────────────────────────────────────
  {
    patterns: [p('\\bphone\\b'), p('\\btelephone\\b'), p('\\btel\\b'), p('\\blandline\\b'), p('\\bland\\s*line\\b'), p('std\\s*no'), p('^contact\\s*no$')],
    source: 'profile.phone',
    resolve: (pr) => pr.phone || null,
  },
  {
    patterns: [p('\\bmobile\\b'), p('cell\\s*(no|number)'), p('mobile\\s*phone'), p('mob\\s*no')],
    source: 'profile.mobile',
    resolve: (pr) => pr.mobile || pr.phone || null,
  },
  {
    patterns: [p('\\bfax\\b'), p('fax\\s*(no|number)')],
    source: 'profile.fax',
    resolve: (pr) => pr.fax || null,
  },
  {
    patterns: [p('\\bemail\\b'), p('e-?mail'), p('email\\s*(id|address)'), p('electronic\\s*mail')],
    source: 'profile.email',
    resolve: (pr) => pr.email || null,
  },
  {
    patterns: [p('\\bwebsite\\b'), p('web\\s*site'), p('\\burl\\b')],
    source: 'profile.website',
    resolve: (pr) => pr.website || null,
  },

  // ── E. Bank ────────────────────────────────────────────────────────────────
  {
    patterns: [p('^bank\\s*name$'), p('name of bank'), p('^banker$'), p('bank\\s*name\\s*&?\\s*address')],
    source: 'profile.bankName',
    resolve: (pr) => pr.bankName || null,
  },
  {
    patterns: [p('bank\\s*branch'), p('branch\\s*name'), p('name of branch'), p('branch\\s*of\\s*bank')],
    source: 'profile.bankBranch',
    resolve: (pr) => pr.bankBranch || null,
  },
  {
    patterns: [p('account\\s*(no|number)'), p('a\\/c\\s*(no|number)'), p('bank\\s*account\\s*(no|number)'), p('acct\\s*(no|number)')],
    source: 'profile.bankAccountNumber',
    resolve: (pr) => pr.bankAccountNumber || null,
  },
  {
    patterns: [p('\\bifsc\\b'), p('ifsc\\s*code'), p('indian\\s*financial\\s*system')],
    source: 'profile.bankIfsc',
    resolve: (pr) => pr.bankIfsc || null,
  },
  {
    patterns: [p('account\\s*type'), p('type of account'), p('nature of account')],
    source: 'profile.bankAccountType',
    resolve: (pr) => pr.bankAccountType || null,
  },

  // ── F. Signatory ───────────────────────────────────────────────────────────
  {
    patterns: [
      p('name of (authori[sz]ed\\s*)?signatory'),
      p('(authori[sz]ed\\s*)?signatory\\s*name$'),
      p('name of.*representative'),   // "Name of Legal Representative / Agent" — NOT "Whether acting as"
      p('name of (authori[sz]ed\\s*)?(person|officer)'),
      p('name of.*agent'),
      p('^name$'),                    // bare "Name:" in signatory blocks
    ],
    source: 'profile.authorizedSignatoryName',
    resolve: (pr) => pr.authorizedSignatoryName || null,
  },
  {
    patterns: [p('^designation$'), p('(authori[sz]ed\\s*)?signatory\\s*designation'), p('designation of (authori[sz]ed\\s*)?signatory')],
    source: 'profile.authorizedSignatoryDesignation',
    resolve: (pr) => pr.authorizedSignatoryDesignation || null,
  },
  {
    patterns: [p('(authori[sz]ed\\s*)?signatory\\s*(din|director\\s*id)'), p('^din$'), p('director\\s*identification')],
    source: 'profile.authorizedSignatoryDin',
    resolve: (pr) => pr.authorizedSignatoryDin || null,
  },

  // ── G. Tender-specific (from analysis) ────────────────────────────────────
  {
    patterns: [p('tender\\s*(no|number|id|ref)'), p('nit\\s*(no|number)'), p('reference\\s*no')],
    source: 'tender.tender_number',
    resolve: (_pr, _dirs, t) => t?.tender_simplified?.tender_number ?? null,
  },
  {
    patterns: [p('name of (work|project|scheme)'), p('work\\s*description')],
    source: 'tender.tender_name',
    resolve: (_pr, _dirs, t) => t?.tender_simplified?.tender_name ?? null,
  },
  {
    patterns: [p('issuing authority'), p('name of authority'), p('department'), p('authority name')],
    source: 'tender.authority_name',
    resolve: (_pr, _dirs, t) => t?.tender_simplified?.authority_name ?? null,
  },
  {
    patterns: [p('emd amount'), p('earnest money'), p('bid security amount')],
    source: 'tender.emd_amount',
    resolve: (_pr, _dirs, t) => t?.emd_details?.amount ?? null,
  },

  // ── H. Date — auto-fill today (editable in review) ────────────────────────
  {
    patterns: [p('^date$'), p('date of submission'), p('^date:'), p('signing date'), p('date of signing')],
    source: 'runtime.today',
    resolve: () =>
      new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }),
  },

  // ── I. Physical fields — never write text ─────────────────────────────────
  {
    patterns: [
      p('^signature$'),
      p('sign\\s*here'),
      p('signature of'),
      p('^seal$'),
      p('seal of'),
      p('company\\s*seal'),
      p('rubber\\s*stamp'),
      p('stamp.*seal'),
      p('round\\s*seal'),
    ],
    source: '(physical — leave blank)',
    status: 'skip',
    resolve: () => null,
  },
  // ── J. Tick/choice selectors — never overlay text on pre-printed options ──
  {
    patterns: [
      p('tick\\s*(which|applic)'),     // "tick whichever applicable"
      p('whichever\\s*(is\\s*)?applic'), // "whichever is applicable"
      p('put\\s*(?:a\\s*)?tick'),       // "put a tick mark"
      p('(?:please\\s*)?tick\\s*mark'), // "please tick mark"
      p('applicable\\s*tick'),
    ],
    source: '(tick/choice — leave blank)',
    status: 'skip',
    resolve: () => null,
  },
];

// ── Compound cells ────────────────────────────────────────────────────────────
// A single Gemini-detected cell that contains multiple logical fields.
// Sub-values are joined with \n; empty sub-values are omitted.

interface CompoundPart {
  source: string;
  resolve: (pr: BusinessProfile) => string;
}
interface CompoundSpec {
  pattern: RegExp;
  parts: CompoundPart[];
}

const COMPOUND_SPECS: CompoundSpec[] = [
  {
    // "Works Address as per Vendor Registration Phone No. Fax No. Email ID"
    pattern: /works\s+address.*phone.*email/i,
    parts: [
      { source: 'profile.worksAddress', resolve: (pr) => pr.worksAddress || pr.registeredOfficeAddress },
      { source: 'profile.phone',        resolve: (pr) => pr.phone },
      { source: 'profile.fax',          resolve: (pr) => pr.fax },
      { source: 'profile.email',        resolve: (pr) => pr.email },
    ],
  },
  {
    // "Office Address Phone No. Fax No. Email ID" (and similar)
    pattern: /address.*phone.*email/i,
    parts: [
      { source: 'profile.registeredOfficeAddress', resolve: (pr) => pr.registeredOfficeAddress },
      { source: 'profile.phone',                   resolve: (pr) => pr.phone },
      { source: 'profile.fax',                     resolve: (pr) => pr.fax },
      { source: 'profile.email',                   resolve: (pr) => pr.email },
    ],
  },
];

// ── Mapper ────────────────────────────────────────────────────────────────────

export function mapFields(
  detectedFields: DetectedField[],
  pageW: number,
  pageH: number,
  profile: BusinessProfile,
  directors: Director[],
  tender?: TenderData,
): MappedField[] {
  return detectedFields.map((field): MappedField => {
    const pdfRect = toPdfRect(field.fill_box, pageW, pageH);
    const n = norm(field.field_label);

    // ── BUG 3: tick/checkbox detected from Gemini fill_area_description ───
    // Runs before all other checks so a label match (e.g. "type of firm")
    // never overwrites a tick-box selector on the actual form.
    if (
      CHOICE_FIELD_RE.test(field.fill_area_description) ||
      CHOICE_FIELD_RE.test(field.notes ?? '')
    ) {
      return { ...field, pdfRect, value: '', source: '(tick/choice — leave blank)', status: 'skip' };
    }

    // ── Special case 0: Compound cell ─────────────────────────────────────
    const compoundSpec = COMPOUND_SPECS.find(s => s.pattern.test(n));
    if (compoundSpec) {
      const resolved = compoundSpec.parts.map(pt => ({ source: pt.source, value: pt.resolve(profile) || '' }));
      const value = resolved.filter(pt => pt.value).map(pt => pt.value).join('\n');
      const source = resolved.map(pt => pt.source).join(', ');
      return { ...field, pdfRect, value, source, status: value ? 'filled' : 'blank' };
    }

    // ── Special case 1: Director / partner table row ───────────────────────
    const dirRow = extractDirectorRow(n);
    if (dirRow) {
      const { idx, subField } = dirRow;
      const dir = directors[idx];
      const source = `directors[${idx}].${subField}`;
      if (!dir) {
        return { ...field, pdfRect, value: '', source, status: 'blank' };
      }
      const value: string = {
        name: dir.name,
        designation: dir.designation,
        din: dir.din,
        pan: dir.pan,
        address: dir.residentialAddress,
      }[subField] ?? '';
      return {
        ...field, pdfRect,
        value,
        source,
        status: value ? 'filled' : 'blank',
      };
    }

    // ── Special case 2: Turnover year table row ────────────────────────────
    const tvIdx = extractTurnoverIdx(n);
    if (tvIdx !== null) {
      const keys = [
        ['turnoverYear1Label', 'turnoverYear1'],
        ['turnoverYear2Label', 'turnoverYear2'],
        ['turnoverYear3Label', 'turnoverYear3'],
      ] as const;
      const [labelKey, valueKey] = keys[tvIdx];
      const rawValue = String(profile[valueKey] ?? '').trim();
      const unit = profile.turnoverUnit || 'Lakhs';
      const value = rawValue ? `${rawValue} ${unit}` : '';
      const source = `profile.${valueKey}`;
      return {
        ...field, pdfRect,
        value,
        source,
        status: value ? 'filled' : 'blank',
      };
    }

    // ── General rule table ─────────────────────────────────────────────────
    for (const rule of RULES) {
      if (rule.patterns.some((re) => re.test(n))) {
        const resolved = rule.resolve(profile, directors, tender);
        const value = resolved ?? '';
        const status: FieldStatus =
          rule.status ??
          (value ? 'filled' : 'blank');
        return { ...field, pdfRect, value, source: rule.source, status };
      }
    }

    // ── No match ────────────────────────────────────────────────────────────
    return {
      ...field,
      pdfRect,
      value: '',
      source: '(unrecognised)',
      status: 'needs_review',
    };
  });
}

// ── Diagnostic summary (for tests and console reporting) ─────────────────────

export interface MapSummary {
  total: number;
  filled: number;
  blank: number;
  needs_review: number;
  skip: number;
  fillRate: string;   // "73%"
}

export function summarise(fields: MappedField[]): MapSummary {
  const total = fields.length;
  const filled = fields.filter((f) => f.status === 'filled').length;
  const blank = fields.filter((f) => f.status === 'blank').length;
  const needs_review = fields.filter((f) => f.status === 'needs_review').length;
  const skip = fields.filter((f) => f.status === 'skip').length;
  const denominator = total - skip;
  const fillRate =
    denominator > 0 ? `${Math.round((filled / denominator) * 100)}%` : 'N/A';
  return { total, filled, blank, needs_review, skip, fillRate };
}
