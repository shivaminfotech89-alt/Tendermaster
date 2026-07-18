import type { ApprovedTemplate } from '../../types';

export const COVER_LETTER: ApprovedTemplate = {
  id: 'generic/cover-letter/1.0.0',
  version: '1.0.0',
  documentType: 'Cover Letter',
  category: 'bid',
  authority: 'generic',
  language: 'en',
  placeholders: [
    'date', 'authorityName', 'tenderName', 'tenderNumber',
    'companyName', 'companyType', 'registeredOfficeAddress',
    'gstNumber', 'panNumber', 'mobile', 'email',
    'authorizedSignatoryName', 'authorizedSignatoryDesignation', 'place',
  ],
  content: `{{date}}

To,
**{{authorityName}}**

**Subject: Submission of Bid — {{tenderName}}**
Ref: Tender No. {{tenderNumber}}

Dear Sir/Madam,

With reference to the above-mentioned Notice Inviting Tender (NIT), we, **{{companyName}}**, a {{companyType}} with our registered office at {{registeredOfficeAddress}}, hereby submit our bid documents in accordance with all terms and conditions prescribed in the tender.

We hereby confirm that:

1. We have read and understood all terms, conditions, and technical specifications of the tender document in full.
2. Our bid conforms to all eligibility criteria and requirements specified in the NIT.
3. We have not been debarred or blacklisted by any Central / State Government department, PSU, or autonomous body as on the date of submission.
4. All information and documents furnished with this bid are true, complete, and correct to the best of our knowledge and belief.

**Details of the Bidder:**

| Particulars | Details |
|---|---|
| Name of Firm | {{companyName}} |
| Constitution of Firm | {{companyType}} |
| Registered Office Address | {{registeredOfficeAddress}} |
| GSTIN | {{gstNumber}} |
| PAN | {{panNumber}} |
| Mobile / Phone | {{mobile}} |
| Email ID | {{email}} |

All requisite documents forming part of the bid are enclosed herewith.

Thanking you,

Yours faithfully,

---

**{{authorizedSignatoryName}}**
{{authorizedSignatoryDesignation}}
**{{companyName}}**

Place: {{place}}
Date: {{date}}
`,
};
