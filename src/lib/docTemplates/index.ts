import type { ApprovedTemplate, TemplateAuthority, PlaceholderContext, CandidateTemplate, BOQForPlaceholders } from './types';
import type { BusinessProfile } from '../modeb/types';
import { resolve, extractPlaceholders } from './resolver';
import { COVER_LETTER } from './templates/generic/coverLetter';
import { BID_SUBMISSION_LETTER } from './templates/generic/bidSubmissionLetter';
import { COMPANY_PROFILE } from './templates/generic/companyProfile';
import { TECHNICAL_PROPOSAL } from './templates/generic/technicalProposal';

// ── Template registry ─────────────────────────────────────────────────────────
// Key: `${authority}/${documentType}` — authority-specific templates are checked
// first; if absent, falls back to the generic entry with the same documentType.
// To add an authority-specific override, insert a new entry keyed by e.g.
// 'ugvcl/Cover Letter' pointing to a UGVCL-specific template object.

const REGISTRY = new Map<string, ApprovedTemplate>([
  ['generic/Cover Letter',           COVER_LETTER],
  ['generic/Bid Submission Letter',  BID_SUBMISSION_LETTER],
  ['generic/Company Profile Summary', COMPANY_PROFILE],
  ['generic/Technical Proposal',     TECHNICAL_PROPOSAL],
]);

// ── Authority detection ───────────────────────────────────────────────────────

export function detectAuthority(authorityName: string | null | undefined): TemplateAuthority {
  if (!authorityName) return 'generic';
  const n = authorityName.toUpperCase();
  if (n.includes('UGVCL')) return 'ugvcl';
  if (n.includes('GETCO') || n.includes('GUJARAT ENERGY TRANSMISSION')) return 'getco';
  if (n.includes('GEM') || n.includes('GOVERNMENT E-MARKETPLACE')) return 'gem';
  if (n.includes('RAILWAY') || n.includes('INDIAN RAILWAY') || n.includes('IRCTC')) return 'railways';
  return 'generic';
}

// ── Public API ────────────────────────────────────────────────────────────────

export function isTemplated(docType: string, authorityName?: string | null): boolean {
  const authority = detectAuthority(authorityName);
  return REGISTRY.has(`${authority}/${docType}`) || REGISTRY.has(`generic/${docType}`);
}

function findTemplate(docType: string, authorityName?: string | null): ApprovedTemplate | null {
  const authority = detectAuthority(authorityName);
  return REGISTRY.get(`${authority}/${docType}`) ?? REGISTRY.get(`generic/${docType}`) ?? null;
}

export function fillTemplate(
  docType: string,
  profile: BusinessProfile | null,
  analysis: any | null,
  authorityName?: string | null,
  boq?: BOQForPlaceholders | null,
): string | null {
  const template = findTemplate(docType, authorityName);
  if (!template) return null;
  const ctx: PlaceholderContext = {
    profile,
    analysis,
    directors: (profile as any)?.directors ?? [],
    boq: boq ?? undefined,
  };
  return resolve(template.content, ctx);
}

export function getAllApprovedTemplates(): ApprovedTemplate[] {
  return [...REGISTRY.values()];
}

// ── Candidate template saving (fire-and-forget) ───────────────────────────────
// Called after Gemini generates a document. Non-blocking — never awaited by callers.
// Saves the raw output to `candidate_templates` so admins can review and promote
// popular generation patterns into the hardcoded registry.

export async function saveCandidateTemplate(
  docType: string,
  generatedContent: string,
  authority: string | null,
): Promise<void> {
  try {
    const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
    const { db } = await import('../firebase');
    await addDoc(collection(db, 'candidate_templates'), {
      documentType: docType,
      authority,
      source: 'gemini',
      generatedContent,
      createdAt: serverTimestamp(),
      reviewStatus: 'pending',
    } as Omit<CandidateTemplate, 'id'>);
  } catch (e) {
    console.warn('[DocTemplates] Failed to save candidate template (non-fatal):', e);
  }
}

export { extractPlaceholders };
export type { ApprovedTemplate, CandidateTemplate, TemplateAuthority };
