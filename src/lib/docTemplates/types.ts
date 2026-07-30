import type { BusinessProfile } from '../modeb/types';

export type TemplateAuthority = 'generic' | 'ugvcl' | 'getco' | 'gem' | 'railways';
export type TemplateCategory = 'bid' | 'company' | 'technical' | 'financial' | 'declaration';
export type TemplateSource = 'gemini' | 'tender_extraction';
export type ReviewStatus = 'pending' | 'approved' | 'rejected';

export interface TemplateMetadata {
  id: string;
  version: string;
  documentType: string;
  category: TemplateCategory;
  authority: TemplateAuthority;
  language: string;
  placeholders: string[];
}

export interface ApprovedTemplate extends TemplateMetadata {
  content: string;
}

export interface CandidateTemplate {
  id?: string;
  documentType: string;
  authority: string | null;
  source: TemplateSource;
  generatedContent: string;
  createdAt?: any;
  reviewStatus: ReviewStatus;
}

// Full tender analysis result shape (superset of TenderData in modeb/types.ts)
export interface FullTenderAnalysis {
  tender_simplified?: {
    tender_name?: string;
    tender_number?: string;
    authority_name?: string;
    tender_value?: string;
    scope_of_work?: string;
    pros?: string[];
    cons_and_risks?: string[];
  };
  timeline_and_milestones?: {
    submission_deadline?: string;
    pre_bid_meeting?: string;
    clarification_deadline?: string;
    execution_duration?: string;
  };
  emd_details?: {
    amount?: string;
    mode?: string;
    msme_exemption?: boolean;
  };
  application_roadmap?: {
    portal_source?: string;
    detailed_procedure_steps?: string[];
    next_immediate_steps?: string[];
    winning_strategy_tips?: string[];
  };
  required_documents_checklist?: Array<{
    document_name?: string;
    status?: string;
    context?: string;
  }>;
  required_annexures?: Array<{
    annexure_name?: string;
    purpose?: string;
    filling_complexity?: string;
  }>;
}

export interface BOQForPlaceholders {
  boqType?: string;
  estimatedAmount?: number | null;
  estimatedAmountConfirmed?: boolean;
  percentage?: number | null;
  aboveBelow?: 'above' | 'below';
  quotedAmount?: number | null;
  quotedAmountWords?: string | null;
  profitPercent?: number | null;
  grossProfit?: number | null;
  marginPercent?: number | null;
  remarks?: string;

  // Finalized-bid fields — only meaningful once boq.finalisedAt is set; each
  // still individually gated (in resolver.ts) on its own live confirm flag
  // below, so a mid-edit/unconfirmed field renders blank rather than stale
  // data. See ProjectDetails.tsx's `finalizedBid` construction for the same
  // shape/gating logic, mirrored here for the local template-fill path.
  finalisedAt?: any;
  gstIncluded?: 'yes' | 'no' | 'separate' | 'unknown';
  manualOverride?: { gstIncluded?: true };
  cessPercent?: number;
  cessAmount?: number;
  gstPercent?: number;
  gstAmount?: number;
  roundedTotal?: number;
  totalWithGst?: number;
  completionPeriodConfirmed?: boolean;
  completionPeriodDays?: number | null;
  completionPeriodLabel?: string;
  bidValidityConfirmed?: boolean;
  bidValidityDays?: number | null;
  bidValidityLabel?: string;
  expectedRevenueConfirmed?: boolean;
  expectedRevenueConfirmedValue?: number | null;
}

export interface PlaceholderContext {
  profile: BusinessProfile | null;
  analysis: FullTenderAnalysis | null;
  directors?: Array<{ name: string; designation: string; din: string; pan: string }>;
  boq?: BOQForPlaceholders;
  projectName?: string;
}
