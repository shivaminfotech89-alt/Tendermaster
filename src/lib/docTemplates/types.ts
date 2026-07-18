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

export interface PlaceholderContext {
  profile: BusinessProfile | null;
  analysis: FullTenderAnalysis | null;
  directors?: Array<{ name: string; designation: string; din: string; pan: string }>;
}
