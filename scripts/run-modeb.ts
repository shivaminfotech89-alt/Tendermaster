/**
 * run-modeb.ts — Full Mode B pipeline (probe → map → overlay → save)
 *
 * Given an original PDF form, this script:
 *   1. Detects fillable fields on EVERY page via Gemini Vision
 *   2. Maps detected labels to the user's business profile
 *   3. Overlays filled values onto the original PDF (all pages)
 *   4. Saves <name>_filled.pdf
 *
 * Probe results are cached to <name>_probe.json so re-runs skip Gemini.
 * Use --no-cache to force a fresh probe.
 *
 * Usage:
 *   npx tsx scripts/run-modeb.ts [form.pdf] [options]
 *   npx tsx scripts/run-modeb.ts scripts/ugvcl-annex-a.pdf --debug
 *   npx tsx scripts/run-modeb.ts scripts/ugvcl-annex-a.pdf --debug --no-cache
 *
 * Defaults:
 *   form.pdf  → scripts/ugvcl-annex-a.pdf
 *   --debug   → draw colored boxes around all detected field areas
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { PDFDocument } from 'pdf-lib';
import { mapFields, summarise } from '../src/lib/modeb/fieldMapper.js';
import { overlayFields } from '../src/lib/modeb/overlay.js';
import type { BusinessProfile, Director, DetectedField } from '../src/lib/modeb/types.js';

// ── Gemini helpers ─────────────────────────────────────────────────────────────

function getAI(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('\nError: GEMINI_API_KEY not set. Add it to your .env file.\n');
    process.exit(1);
  }
  return new GoogleGenAI({ apiKey: key });
}

function isRetryable(e: any): boolean {
  const msg = (e?.message ?? e?.toString() ?? '').toLowerCase();
  const status: number = e?.status ?? e?.httpError?.status ?? 0;
  return status === 503 || msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded');
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  delays = [5, 10, 20, 40],
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn(); } catch (e: any) {
      lastErr = e;
      if (!isRetryable(e) || attempt === delays.length) throw e;
      const wait = delays[attempt];
      console.log(`  ⏳ ${label}: 503 — retrying in ${wait}s (attempt ${attempt + 1}/${delays.length})…`);
      await new Promise(r => setTimeout(r, wait * 1000));
    }
  }
  throw lastErr;
}

const MODEL_FALLBACK_ORDER = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.0-flash'];

const SYSTEM_PROMPT = `You are analyzing a scanned Indian government tender form (Annexure / bid submission form).
Your task: identify every fillable field on the page — these are blank lines, blank boxes, or underscored spaces where a bidder must write their information.

Return a JSON array (no markdown, no code fences, raw JSON only) with one object per field:
{
  "field_label": "<exact label text as printed on the form>",
  "fill_area_description": "<brief description of the blank area>",
  "fill_box": [y_min, x_min, y_max, x_max],
  "confidence": "high" | "medium" | "low",
  "notes": "<optional>"
}

fill_box: [y_min, x_min, y_max, x_max], values 0–1000 (top-left origin), covering the BLANK FILL AREA not the label.
Include ALL fillable fields. If this page has no fillable fields, return [].
Output ONLY the JSON array.`;

// ── Probe data types ───────────────────────────────────────────────────────────

interface ProbeField {
  field_label: string;
  fill_area_description: string;
  fill_box: [number, number, number, number];
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
  page: number;
}

interface ProbeData {
  path: number;
  pageW: number;
  pageH: number;
  pageCount: number;
  counts: { total: number; high: number; medium: number; low: number };
  fields: ProbeField[];
}

// ── Probe all pages via Gemini ────────────────────────────────────────────────

async function probeAllPages(pdfPath: string, modelOverride?: string): Promise<ProbeData> {
  const ai = getAI();
  const models = modelOverride ? [modelOverride] : MODEL_FALLBACK_ORDER;

  // Get page count from pdf-lib (fast, no network)
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes.buffer as ArrayBuffer, { ignoreEncryption: true });
  const pageCount = pdfDoc.getPageCount();
  const page0 = pdfDoc.getPage(0);
  const { width: pageW, height: pageH } = page0.getSize();

  console.log(`  PDF: ${pageCount} page(s)  (${Math.round(pageW)}×${Math.round(pageH)} pts)`);

  // Upload PDF once — reuse for all page calls
  console.log('  Uploading PDF to Gemini Files API…');
  const uploaded = await withRetry('upload', () =>
    ai.files.upload({
      file: pdfPath,
      config: { mimeType: 'application/pdf', displayName: path.basename(pdfPath) },
    }),
  );
  console.log(`  Uploaded: ${uploaded.uri}\n`);

  const allFields: ProbeField[] = [];

  for (let pg = 1; pg <= pageCount; pg++) {
    const { width: pgW, height: pgH } = pdfDoc.getPage(pg - 1).getSize();
    const pageNote = `\n\nAnalyze page ${pg} of this PDF.`;
    const callParams = {
      contents: [{
        role: 'user' as const,
        parts: [
          createPartFromUri(uploaded.uri!, 'application/pdf'),
          { text: SYSTEM_PROMPT + pageNote },
        ],
      }],
      config: { temperature: 0.1 },
    };

    process.stdout.write(`  Probing page ${pg}/${pageCount}…`);
    let rawText = '';
    let usedModel = '';

    for (const model of models) {
      try {
        const result = await withRetry(
          `${model} pg${pg}`,
          () => ai.models.generateContent({ model, ...callParams }),
        );
        rawText = result.text ?? '';
        usedModel = model;
        break;
      } catch (e: any) {
        if (model === models[models.length - 1]) {
          console.log(` ⚠️  all models failed — skipping page ${pg}`);
          rawText = '[]';
          usedModel = 'none';
        }
      }
    }

    // Parse JSON response
    let fields: Omit<ProbeField, 'page'>[] = [];
    try {
      const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) fields = parsed;
    } catch {
      console.log(` ⚠️  could not parse response`);
    }

    const highCount = fields.filter(f => f.confidence === 'high').length;
    console.log(` → ${fields.length} fields (${highCount} high)  [${usedModel}]`);

    // Tag each field with its page number
    fields.forEach(f => {
      if (!Array.isArray(f.fill_box) || f.fill_box.length !== 4) return;
      allFields.push({ ...f, fill_box: f.fill_box as [number,number,number,number], page: pg });
    });

    // Brief pause between pages to be polite to the API
    if (pg < pageCount) await new Promise(r => setTimeout(r, 1000));
  }

  // Clean up uploaded file
  try { await ai.files.delete({ name: uploaded.name! }); } catch (_) {}

  return {
    path: 2,
    pageW, pageH, pageCount,
    counts: {
      total: allFields.length,
      high:   allFields.filter(f => f.confidence === 'high').length,
      medium: allFields.filter(f => f.confidence === 'medium').length,
      low:    allFields.filter(f => f.confidence === 'low').length,
    },
    fields: allFields,
  };
}

// ── Demo profile (replace with Firestore lookup in production) ─────────────────

const profile: BusinessProfile = {
  companyName:                    'Shiva Electricals Pvt Ltd',
  proprietorName:                 'Rajesh Kumar Shah',
  companyType:                    'Pvt Ltd',
  cinLlpin:                       'U40100GJ2010PTC061234',
  udyamNumber:                    'UDYAM-GJ-07-0012345',
  msmeStatus:                     'Small',
  dateOfIncorporation:            '15/03/2010',
  experienceYears:                '14',
  registeredOfficeAddress:        'Plot 42, GIDC Estate, Vatva, Ahmedabad – 382 445',
  worksAddress:                   '',
  state:                          'Gujarat',
  city:                           'Ahmedabad',
  district:                       'Ahmedabad',
  pinCode:                        '382445',
  place:                          'Ahmedabad',
  phone:                          '079-26583210',
  fax:                            '',
  mobile:                         '9876543210',
  email:                          'info@shivaelectricals.in',
  website:                        'www.shivaelectricals.in',
  contactDetails:                 '',
  gstNumber:                      '24AABCS1429B1ZB',
  panNumber:                      'AABCS1429B',
  tanNumber:                      'AHMS23456G',
  esicNumber:                     'ESIC31000000001',
  epfNumber:                      'GJ/AHD/0012345/000/0000001',
  professionalTaxNumber:          'PT/AHD/12345',
  tradeLicenseNumber:             'TL/AHD/2023/001',
  labourLicenseNumber:            '',
  turnover:                       '85',
  turnoverUnit:                   'Lakhs',
  turnoverYear1Label:             '2021-22',
  turnoverYear1:                  '72',
  turnoverYear2Label:             '2022-23',
  turnoverYear2:                  '85',
  turnoverYear3Label:             '2023-24',
  turnoverYear3:                  '91',
  netWorth:                       '120',
  bankName:                       'State Bank of India',
  bankBranch:                     'Vatva Industrial Area',
  bankAccountNumber:              '10234567890',
  bankIfsc:                       'SBIN0060234',
  bankAccountType:                'Current',
  authorizedSignatoryName:        'Rajesh Kumar Shah',
  authorizedSignatoryDesignation: 'Managing Director',
  authorizedSignatoryDin:         '02345678',
  authorizedSignatoryPan:         'ABCDE1234F',
  registrationClass:              'Class A',
  numberOfEmployees:              '45',
  vendorRegistrationNumbers:      '',
  experienceSummary:              '14 years in electrical infrastructure works',
};

const directors: Director[] = [
  { name: 'Rajesh Kumar Shah', designation: 'Managing Director', din: '02345678', pan: 'ABCDE1234F', residentialAddress: '12, Satellite Road, Ahmedabad' },
  { name: 'Meena R Shah',      designation: 'Director',          din: '05678901', pan: 'FGHIJ5678K', residentialAddress: '12, Satellite Road, Ahmedabad' },
  { name: 'Vikram Shah',       designation: 'Director',          din: '06789012', pan: 'KLMNO9012L', residentialAddress: '45, Thaltej, Ahmedabad' },
];

// ── Main pipeline ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const pdfArg  = args.find(a => !a.startsWith('-') && a.endsWith('.pdf'));
  const noCache = args.includes('--no-cache');
  const debugMode = args.includes('--debug');
  const modelFlag = args.indexOf('--model');
  const modelOverride = modelFlag >= 0 ? args[modelFlag + 1] : undefined;

  const pdfPath      = path.resolve(pdfArg ?? 'scripts/ugvcl-annex-a.pdf');
  const probeJsonPath = pdfPath.replace(/\.pdf$/i, '_probe.json');
  const outPath       = pdfPath.replace(/\.pdf$/i, '_filled.pdf');

  console.log('\n' + '═'.repeat(72));
  console.log('  MODE B PIPELINE  (multi-page)');
  console.log('═'.repeat(72));
  console.log(`\n  PDF:      ${pdfPath}`);
  console.log(`  Probe:    ${probeJsonPath}`);
  console.log(`  Output:   ${outPath}`);
  console.log(`  Debug:    ${debugMode ? 'ON (colored field boxes)' : 'OFF'}`);

  // ── Step 1: Get probe data ─────────────────────────────────────────────────
  let probe: ProbeData;

  if (!noCache && fs.existsSync(probeJsonPath)) {
    console.log('\n  [1/4] Loading cached probe JSON…');
    probe = JSON.parse(fs.readFileSync(probeJsonPath, 'utf8'));
    console.log(`        ${probe.fields.length} fields across ${probe.pageCount} pages (from cache)`);
  } else {
    console.log('\n  [1/4] Probing all pages with Gemini Vision…');
    probe = await probeAllPages(pdfPath, modelOverride);
    fs.writeFileSync(probeJsonPath, JSON.stringify(probe, null, 2));
    console.log(`\n  Probe cached → ${probeJsonPath}`);
    console.log(`  Total: ${probe.counts.total} fields  🟢 ${probe.counts.high}  🟡 ${probe.counts.medium}  🟠 ${probe.counts.low}`);
  }

  // ── Step 2: Map fields ────────────────────────────────────────────────────
  console.log('\n  [2/4] Mapping fields…');

  // Build DetectedField[] — mapFields recomputes pdfRect from fill_box
  const detectedFields: DetectedField[] = probe.fields.map(f => ({
    field_label:           f.field_label,
    fill_area_description: f.fill_area_description,
    fill_box:              f.fill_box,
    confidence:            f.confidence,
    notes:                 f.notes,
    page:                  f.page,
  }));

  // All pages are the same size (tender form assumption).
  // mapFields recomputes pdfRect using probe.pageW / probe.pageH.
  const mapped = mapFields(detectedFields, probe.pageW, probe.pageH, profile, directors);
  const summary = summarise(mapped);

  console.log(`  Fill rate: ${summary.fillRate}  (filled=${summary.filled}  blank=${summary.blank}  needs_review=${summary.needs_review}  skip=${summary.skip})`);

  // Per-page breakdown
  const pagesSet = [...new Set(mapped.map(f => f.page ?? 1))].sort((a, b) => a - b);
  for (const pg of pagesSet) {
    const pgFields = mapped.filter(f => (f.page ?? 1) === pg);
    const pgFilled = pgFields.filter(f => f.status === 'filled').length;
    const pgTotal  = pgFields.filter(f => f.status !== 'skip').length;
    console.log(`    Page ${pg}: ${pgFilled}/${pgTotal} non-skip fields filled`);
  }

  // Field-by-field table
  console.log(`\n  ${'#'.padEnd(4)} ${'PG'.padEnd(4)} ${'STATUS'.padEnd(14)} ${'VALUE'.padEnd(36)} LABEL`);
  console.log('  ' + '-'.repeat(90));
  for (let i = 0; i < mapped.length; i++) {
    const f = mapped[i];
    const icon = { filled: '✅', blank: '⬜', needs_review: '🔴', skip: '⏭️ ' }[f.status] ?? '  ';
    const val  = f.value.replace(/\n/g, ' ⏎ ').slice(0, 34).padEnd(36);
    const lbl  = f.field_label.slice(0, 48);
    console.log(`  ${String(i + 1).padEnd(4)} p${f.page ?? 1}   ${(icon + ' ' + f.status).padEnd(14)} ${val} ${lbl}`);
  }

  // ── Step 3: Overlay ───────────────────────────────────────────────────────
  console.log('\n  [3/4] Rendering overlay…');
  const originalBytes = fs.readFileSync(pdfPath);
  const { pdfBytes: filledBytes, warnings } = await overlayFields(
    originalBytes.buffer as ArrayBuffer,
    mapped,
    { debugBoxes: debugMode },
  );

  if (warnings.length > 0) {
    console.log('\n  ⚠️  Overflow warnings (not drawn):');
    warnings.forEach(w => console.log(`     ${w}`));
  } else {
    console.log('  No overflow warnings.');
  }

  // ── Step 4: Save ─────────────────────────────────────────────────────────
  console.log('\n  [4/4] Saving output…');
  fs.writeFileSync(outPath, filledBytes);
  console.log(`  Saved → ${outPath}`);

  console.log('\n' + '═'.repeat(72) + '\n');
}

main().catch(err => {
  console.error('\nFailed:', err?.message ?? err);
  process.exit(1);
});
