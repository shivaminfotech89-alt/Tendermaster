// Shared types for the Mode B (exact-form overlay) pipeline.
// These mirror the shapes stored in Firestore; all fields optional-safe (empty string = not set).

export interface BusinessProfile {
  // Identity
  companyName: string;
  proprietorName: string;
  companyType: string;        // Proprietorship | Partnership | Pvt Ltd | Ltd | LLP
  cinLlpin: string;
  udyamNumber: string;
  msmeStatus: string;
  dateOfIncorporation: string;
  experienceYears: string | number;
  // Address
  registeredOfficeAddress: string;
  worksAddress: string;
  state: string;
  city: string;
  district: string;
  pinCode: string;
  place: string;              // for "Place: ___" signing blocks
  // Contact
  phone: string;
  fax: string;
  mobile: string;
  email: string;
  website: string;
  contactDetails: string;
  // Statutory
  gstNumber: string;
  panNumber: string;
  tanNumber: string;
  esicNumber: string;
  epfNumber: string;
  professionalTaxNumber: string;
  tradeLicenseNumber: string;
  labourLicenseNumber: string;
  // Financial
  turnover: string | number;
  turnoverUnit: string;       // Lakhs | Crores
  turnoverYear1Label: string;
  turnoverYear1: string;
  turnoverYear2Label: string;
  turnoverYear2: string;
  turnoverYear3Label: string;
  turnoverYear3: string;
  netWorth: string;
  // Bank
  bankName: string;
  bankBranch: string;
  bankAccountNumber: string;
  bankIfsc: string;
  bankAccountType: string;    // Current | Savings | Cash Credit | Overdraft
  // Signatory
  authorizedSignatoryName: string;
  authorizedSignatoryDesignation: string;
  authorizedSignatoryDin: string;
  authorizedSignatoryPan: string;
  // Other
  registrationClass: string;
  numberOfEmployees: string;
  vendorRegistrationNumbers: string;
  experienceSummary: string;
}

export interface Director {
  name: string;
  designation: string;
  din: string;
  pan: string;
  residentialAddress: string;
}

export interface TenderData {
  tender_simplified?: {
    tender_name?: string;
    authority_name?: string;
    tender_value?: string;
    tender_number?: string;   // NIT / reference number extracted from the document
  };
  timeline_and_milestones?: {
    submission_deadline?: string;
    pre_bid_meeting?: string;
  };
  emd_details?: {
    amount?: string;
  };
}

// Raw output from the Gemini Vision probe (fill_box in 0-1000, top-left origin)
export interface DetectedField {
  field_label: string;
  fill_area_description: string;
  fill_box: [number, number, number, number]; // [y_min, x_min, y_max, x_max]
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
  page?: number;
}

// PDF coordinate rectangle (pts, bottom-left origin)
export interface PdfRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FieldStatus =
  | 'filled'       // value came from profile/directors — shown pre-populated
  | 'blank'        // field recognized but profile field is empty — highlighted yellow
  | 'needs_review' // field not recognized OR value overflows rect — highlighted red
  | 'skip';        // physical field (signature, seal) — never write text

// A detected field after mapping to user data
export interface MappedField extends DetectedField {
  pdfRect: PdfRect;
  value: string;    // what to write; '' means write nothing
  source: string;   // human-readable provenance, e.g. 'profile.gstNumber'
  status: FieldStatus;
}
