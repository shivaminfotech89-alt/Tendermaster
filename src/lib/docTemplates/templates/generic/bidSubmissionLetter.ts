import type { ApprovedTemplate } from '../../types';

export const BID_SUBMISSION_LETTER: ApprovedTemplate = {
  id: 'generic/bid-submission-letter/1.0.0',
  version: '1.0.0',
  documentType: 'Bid Submission Letter',
  category: 'bid',
  authority: 'generic',
  language: 'en',
  placeholders: [
    'date', 'authorityName', 'tenderName', 'tenderNumber',
    'companyName', 'companyType', 'registeredOfficeAddress',
    'emdAmount', 'enclosuresList',
    'gstNumber', 'panNumber',
    'authorizedSignatoryName', 'authorizedSignatoryDesignation', 'place',
  ],
  content: `{{date}}

To,
**{{authorityName}}**

**Subject: Submission of Bid for "{{tenderName}}"**
Ref: Tender No. {{tenderNumber}}

Dear Sir/Madam,

We, **{{companyName}}**, a {{companyType}} with our registered office at {{registeredOfficeAddress}}, hereby submit our bid documents in response to the above-mentioned tender, in accordance with the terms and conditions of the Notice Inviting Tender (NIT).

**Earnest Money Deposit (EMD):** {{emdAmount}}

We hereby declare and confirm that:

1. We have carefully read and fully understood the entire Tender Document, including all clauses, annexures, drawings, specifications, and any corrigendums issued thereto.
2. Our bid is valid for the period specified in the NIT from the date of opening of bids, and shall not be withdrawn or modified during this period.
3. We have not been debarred, blacklisted, or barred from participation in tenders by any Central / State Government authority, PSU, or autonomous body.
4. There is no conflict of interest in our participation in this tender.
5. The prices quoted in our financial bid are firm and binding, and include all applicable taxes, duties, levies, and other charges.
6. We agree to execute the work in full conformity with the tender specifications, drawings, and conditions of contract.

**Documents Enclosed:**

{{enclosuresList}}

We request you to kindly consider our bid favourably.

Yours faithfully,

---

**{{authorizedSignatoryName}}**
{{authorizedSignatoryDesignation}}
**{{companyName}}**

GSTIN: {{gstNumber}} | PAN: {{panNumber}}

Place: {{place}}
Date: {{date}}
`,
};
