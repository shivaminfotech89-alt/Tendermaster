export interface UserProfile {
  keywords: string[];
  states: string[];
  min_capacity_inr: number | null;
}

export interface RequiredDocument {
  document_name: string;
  status: string;
  context: string;
}

export interface TenderAnalysisResult {
  compatibility: {
    score: number;
    rationale: string;
  };
  tender_simplified: {
    scope_of_work: string;
    pros: string[];
    cons_and_risks: string[];
  };
  timeline_and_milestones: {
    pre_bid_meeting: string;
    clarification_deadline: string;
    submission_deadline: string;
    execution_duration: string;
  };
  required_documents_checklist: RequiredDocument[];
  application_roadmap: {
    portal_source: string;
    next_immediate_steps: string[];
    winning_strategy_tips: string[];
  };
  bid_recommendation?: {
    estimated_value?: string;
    conservative?: string;
    recommended?: string;
    aggressive?: string;
    safe_range?: string;
    margin_range?: string;
    risk_level?: string;
    rationale?: string;
  };
  financial_estimate?: {
    total_estimated_cost?: string;
  };
}
