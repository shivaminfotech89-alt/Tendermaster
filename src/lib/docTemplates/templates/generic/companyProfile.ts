import type { ApprovedTemplate } from '../../types';

export const COMPANY_PROFILE: ApprovedTemplate = {
  id: 'generic/company-profile/1.0.0',
  version: '1.0.0',
  documentType: 'Company Profile Summary',
  category: 'company',
  authority: 'generic',
  language: 'en',
  placeholders: [
    'companyName', 'companyType', 'dateOfIncorporation', 'cinLlpin', 'udyamNumber',
    'msmeStatus', 'registrationClass', 'numberOfEmployees', 'experienceYears',
    'registeredOfficeAddress', 'worksAddress', 'state', 'district', 'pinCode',
    'phone', 'mobile', 'fax', 'email', 'website',
    'gstNumber', 'panNumber', 'tanNumber', 'esicNumber', 'epfNumber',
    'professionalTaxNumber', 'tradeLicenseNumber', 'labourLicenseNumber',
    'turnoverYear1Label', 'turnoverYear1',
    'turnoverYear2Label', 'turnoverYear2',
    'turnoverYear3Label', 'turnoverYear3',
    'authorizedSignatoryName', 'authorizedSignatoryDesignation', 'authorizedSignatoryDin',
    'bankName', 'bankBranch', 'bankAccountNumber', 'bankIfsc', 'bankAccountType',
    'experienceSummary', 'date',
  ],
  content: `# Company Profile

**{{companyName}}**

---

## 1. Company Overview

| Particulars | Details |
|---|---|
| Name of Company / Firm | {{companyName}} |
| Constitution / Type of Firm | {{companyType}} |
| Date of Establishment / Incorporation | {{dateOfIncorporation}} |
| CIN / LLPIN | {{cinLlpin}} |
| Udyam Registration No. | {{udyamNumber}} |
| MSME Status | {{msmeStatus}} |
| Registration Class | {{registrationClass}} |
| Number of Employees | {{numberOfEmployees}} |
| Years in Business | {{experienceYears}} |

---

## 2. Registered Office

{{registeredOfficeAddress}}

| | |
|---|---|
| State | {{state}} |
| District | {{district}} |
| PIN Code | {{pinCode}} |

---

## 3. Works / Project Office

{{worksAddress}}

---

## 4. Contact Details

| Type | Details |
|---|---|
| Phone | {{phone}} |
| Mobile | {{mobile}} |
| Fax | {{fax}} |
| Email | {{email}} |
| Website | {{website}} |

---

## 5. Statutory Registrations

| Registration | Number |
|---|---|
| GSTIN | {{gstNumber}} |
| PAN | {{panNumber}} |
| TAN | {{tanNumber}} |
| ESIC No. | {{esicNumber}} |
| EPF / PF No. | {{epfNumber}} |
| Professional Tax No. | {{professionalTaxNumber}} |
| Trade Licence No. | {{tradeLicenseNumber}} |
| Labour Licence No. | {{labourLicenseNumber}} |

---

## 6. Financial Information

**Annual Turnover (Audited):**

| Financial Year | Turnover |
|---|---|
| {{turnoverYear1Label}} | {{turnoverYear1}} |
| {{turnoverYear2Label}} | {{turnoverYear2}} |
| {{turnoverYear3Label}} | {{turnoverYear3}} |

---

## 7. Authorised Signatory

| Particulars | Details |
|---|---|
| Name | {{authorizedSignatoryName}} |
| Designation | {{authorizedSignatoryDesignation}} |
| DIN | {{authorizedSignatoryDin}} |

---

## 8. Bank Details

| Particulars | Details |
|---|---|
| Bank Name | {{bankName}} |
| Branch | {{bankBranch}} |
| Account Number | {{bankAccountNumber}} |
| IFSC Code | {{bankIfsc}} |
| Account Type | {{bankAccountType}} |

---

## 9. Business Activities & Experience

{{experienceSummary}}

---

*This company profile is prepared based on official records as on {{date}} and is subject to verification.*

**{{authorizedSignatoryName}}**
{{authorizedSignatoryDesignation}}
For **{{companyName}}**

Date: {{date}}
`,
};
