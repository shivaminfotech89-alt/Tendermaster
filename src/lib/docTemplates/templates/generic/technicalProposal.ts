import type { ApprovedTemplate } from '../../types';

export const TECHNICAL_PROPOSAL: ApprovedTemplate = {
  id: 'generic/technical-proposal/1.0.0',
  version: '1.0.0',
  documentType: 'Technical Proposal',
  category: 'technical',
  authority: 'generic',
  language: 'en',
  placeholders: [
    'tenderName', 'tenderNumber', 'authorityName',
    'companyName', 'companyType', 'experienceYears',
    'scopeOfWork', 'objectives', 'deliverables',
    'authorizedSignatoryName', 'authorizedSignatoryDesignation',
    'gstNumber', 'panNumber', 'place', 'date',
  ],
  content: `# Technical Proposal

**Tender:** {{tenderName}}
**Tender No.:** {{tenderNumber}}
**Submitted To:** {{authorityName}}
**Submitted By:** {{companyName}}
**Date:** {{date}}

---

## 1. Covering Note

This Technical Proposal is submitted by **{{companyName}}**, a {{companyType}} with {{experienceYears}} years of operational experience, in response to the Notice Inviting Tender (NIT) issued by **{{authorityName}}**.

We are pleased to present our detailed technical proposal demonstrating our capability, methodology, and commitment to delivering the stated scope of work to the highest standards.

---

## 2. Scope of Work — Our Understanding

{{scopeOfWork}}

---

## 3. Objectives

{{objectives}}

---

## 4. Proposed Methodology

*[Edit this section to describe your specific approach, tools, and execution plan.]*

We propose the following structured approach to deliver the required scope:

**Phase 1 — Mobilisation & Planning**
- Review all available drawings, specifications, and site data.
- Prepare a detailed execution programme and resource deployment plan.
- Complete site establishment and safety planning.

**Phase 2 — Execution**
- Implement work in phased manner in accordance with the agreed programme.
- Conduct regular quality checks at each stage to ensure compliance with specifications.
- Maintain daily progress records and submit periodic progress reports.

**Phase 3 — Testing, Commissioning & Handover**
- Carry out all required tests and inspections.
- Prepare and submit all as-built drawings, test certificates, and completion documentation.
- Formally hand over the completed work with all warranties and O&M manuals.

---

## 5. Key Deliverables

{{deliverables}}

---

## 6. Our Team

| Role | Name | Qualification |
|---|---|---|
| Authorised Signatory / Project Lead | {{authorizedSignatoryName}} | {{authorizedSignatoryDesignation}} |

*[Add key site engineers, technical staff, and other project personnel here.]*

---

## 7. Compliance Confirmation

We confirm that **{{companyName}}** has the requisite technical capability, financial strength, and all applicable registrations and certifications to execute the work described in this tender. Copies of all supporting certificates and experience documents are enclosed with our bid.

---

**{{authorizedSignatoryName}}**
{{authorizedSignatoryDesignation}}
For **{{companyName}}**

GSTIN: {{gstNumber}} | PAN: {{panNumber}}

Place: {{place}}
Date: {{date}}
`,
};
