/**
 * ModeBReviewPanelDemo — offline dev harness for ModeBReviewPanel.
 *
 * Loads the cached UGVCL probe JSON (scripts/ugvcl-annex-a_probe.json),
 * runs mapFields with a sample profile, and renders the panel.
 * No API call is made — fully offline.
 *
 * Route: /dev/modeb  (added in App.tsx — dev + production, but no auth gate)
 */

import { useMemo, useState } from 'react';
import probeJson from '../../../scripts/ugvcl-annex-a_probe.json';
import { mapFields } from '../../lib/modeb/fieldMapper';
import type { BusinessProfile, Director, DetectedField, TenderData } from '../../lib/modeb/types';
import ModeBReviewPanel from './ModeBReviewPanel';

// ── Sample data (mirrors scripts/run-modeb.ts dev profile) ───────────────────

const SAMPLE_PROFILE: BusinessProfile = {
  companyName:                  'Shiva Electricals Pvt Ltd',
  proprietorName:               'Rajesh Kumar Shah',
  companyType:                  'Pvt Ltd',
  cinLlpin:                     'U40100GJ2010PTC061234',
  udyamNumber:                  'UDYAM-GJ-07-0012345',
  msmeStatus:                   'Small',
  dateOfIncorporation:          '15/03/2010',
  experienceYears:              '14',
  registeredOfficeAddress:      'Plot 42, GIDC Estate, Vatva, Ahmedabad – 382 445',
  worksAddress:                 '',
  state:                        'Gujarat',
  city:                         'Ahmedabad',
  district:                     'Ahmedabad',
  pinCode:                      '382445',
  place:                        'Ahmedabad',
  phone:                        '079-26583210',
  fax:                          '',
  mobile:                       '9876543210',
  email:                        'info@shivaelectricals.in',
  website:                      'www.shivaelectricals.in',
  contactDetails:               '',
  gstNumber:                    '24AABCS1429B1ZB',
  panNumber:                    'AABCS1429B',
  tanNumber:                    'AHMS23456G',
  esicNumber:                   'ESIC31000000001',
  epfNumber:                    'GJ/AHD/0012345/000/0000001',
  professionalTaxNumber:        'PT/AHD/12345',
  tradeLicenseNumber:           'TL/AHD/2023/001',
  labourLicenseNumber:          '',
  turnover:                     '85',
  turnoverUnit:                 'Lakhs',
  turnoverYear1Label:           '2021-22',
  turnoverYear1:                '72',
  turnoverYear2Label:           '2022-23',
  turnoverYear2:                '85',
  turnoverYear3Label:           '2023-24',
  turnoverYear3:                '91',
  netWorth:                     '120',
  bankName:                     'State Bank of India',
  bankBranch:                   'Vatva Industrial Area',
  bankAccountNumber:            '38291234567',
  bankIfsc:                     'SBIN0004325',
  bankAccountType:              'Current',
  authorizedSignatoryName:      'Rajesh Kumar Shah',
  authorizedSignatoryDesignation: 'Managing Director',
  authorizedSignatoryDin:       '07654321',
  authorizedSignatoryPan:       'ABCPR1234D',
  registrationClass:            'Class-I Electrical Contractor',
  numberOfEmployees:            '47',
  vendorRegistrationNumbers:    '',
  experienceSummary:            '14 years in electrical works, substations, and industrial wiring.',
};

const SAMPLE_DIRECTORS: Director[] = [
  { name: 'Rajesh Kumar Shah',  designation: 'Managing Director', din: '07654321', pan: 'ABCPR1234D', residentialAddress: 'B-12, Satellite, Ahmedabad' },
  { name: 'Meena R. Shah',      designation: 'Director',          din: '07654322', pan: 'ABCPS5678E', residentialAddress: 'B-12, Satellite, Ahmedabad' },
];

const SAMPLE_TENDER: TenderData = {
  tender_simplified: {
    tender_name:   'Supply and Erection of Distribution Transformers',
    authority_name: 'UGVCL – Mehsana Circle',
    tender_value:  '₹ 42,00,000',
    tender_number: 'UGVCL/PROC/2024-25/MC/001',
  },
};

// ── Demo component ─────────────────────────────────────────────────────────────

export default function ModeBReviewPanelDemo() {
  const [exported, setExported] = useState(false);
  const [exporting, setExporting] = useState(false);

  const probe = probeJson as unknown as {
    pageW: number;
    pageH: number;
    pageCount: number;
    fields: DetectedField[];
  };

  const mappedFields = useMemo(
    () => mapFields(probe.fields, probe.pageW, probe.pageH, SAMPLE_PROFILE, SAMPLE_DIRECTORS, SAMPLE_TENDER),
    [probe.fields, probe.pageW, probe.pageH],
  );

  const handleExport = async (editedFields: typeof mappedFields) => {
    setExporting(true);
    // Dev stub: just log what would be passed to overlayFields + download
    console.log('[ModeBDevDemo] Export called with', editedFields.length, 'fields');
    console.table(editedFields.map(f => ({
      label:  f.field_label.slice(0, 40),
      status: f.status,
      value:  f.value.slice(0, 30),
      page:   f.page,
    })));
    await new Promise(r => setTimeout(r, 800)); // Simulate async
    setExporting(false);
    setExported(true);
  };

  if (exported) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center bg-white rounded-xl border border-slate-200 shadow-sm p-10 max-w-sm">
          <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-bold text-slate-800 mb-2">Export triggered</h2>
          <p className="text-sm text-slate-500 mb-6">
            Check the browser console for the edited field list. In production this
            would run <code className="font-mono text-indigo-600">overlayFields()</code> and download the PDF.
          </p>
          <button
            onClick={() => setExported(false)}
            className="px-4 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
          >
            Back to Review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen p-4 bg-slate-100 flex flex-col gap-3">
      {/* Dev banner */}
      <div className="bg-indigo-900 text-indigo-200 text-xs font-mono px-4 py-2 rounded-lg flex items-center justify-between shrink-0">
        <span>
          DEV MODE — UGVCL Annexure-A ({probe.pageCount} pages, {probe.fields.length} detected fields,{' '}
          {mappedFields.filter(f => f.status === 'filled').length} auto-filled)
        </span>
        <span className="text-indigo-400">No API calls · Offline</span>
      </div>

      {/* Panel fills remaining height */}
      <div className="flex-1 min-h-0">
        <ModeBReviewPanel
          mappedFields={mappedFields}
          pageW={probe.pageW}
          pageH={probe.pageH}
          pageCount={probe.pageCount}
          formName="UGVCL Annexure-A"
          exporting={exporting}
          onExport={handleExport}
          onCancel={() => window.history.back()}
        />
      </div>
    </div>
  );
}
