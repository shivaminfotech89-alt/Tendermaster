import { describe, test, expect } from 'vitest';
import {
  findProseMatches,
  resolveProseMatch,
  bucketComplianceRequirement,
  PENALTY_LD_KEYWORDS,
  PRICE_VARIATION_KEYWORDS,
} from './classifyOverviewProse';

const DETAILS_EN = {
  tender_simplified: {
    cons_and_risks: [
      "A penalty of 0.5% per week of delay, capped at 10% of contract value, applies for late completion.",
      "The site has restricted vehicular access which may slow material delivery.",
      "Price variation clause allows cost escalation based on WPI for contracts exceeding 18 months.",
    ],
    pros: [
      "Strong track record with this authority increases win probability.",
    ],
  },
};

const DETAILS_HI = {
  tender_simplified: {
    cons_and_risks: [
      "देर से पूरा होने पर प्रति सप्ताह 0.5% का जुर्माना, अनुबंध मूल्य के 10% तक सीमित।",
      "साइट तक वाहन पहुंच सीमित है जिससे सामग्री वितरण धीमा हो सकता है।",
      "18 महीने से अधिक के अनुबंधों के लिए WPI के आधार पर मूल्य वृद्धि खंड लागत वृद्धि की अनुमति देता है।",
    ],
    pros: ["इस प्राधिकरण के साथ मजबूत ट्रैक रिकॉर्ड जीत की संभावना बढ़ाता है।"],
  },
};

describe('findProseMatches / resolveProseMatch', () => {
  test('finds penalty/LD match by index in cons_and_risks', () => {
    const matches = findProseMatches(DETAILS_EN, PENALTY_LD_KEYWORDS);
    expect(matches).toEqual([{ field: 'cons_and_risks', index: 0 }]);
  });

  test('finds price variation match by index in cons_and_risks', () => {
    const matches = findProseMatches(DETAILS_EN, PRICE_VARIATION_KEYWORDS);
    expect(matches).toEqual([{ field: 'cons_and_risks', index: 2 }]);
  });

  test('no match returns empty array, never throws', () => {
    const matches = findProseMatches({}, PENALTY_LD_KEYWORDS);
    expect(matches).toEqual([]);
  });

  test('resolveProseMatch pulls text from a DIFFERENT (translated) details object at the same index', () => {
    const matches = findProseMatches(DETAILS_EN, PENALTY_LD_KEYWORDS);
    expect(matches).toHaveLength(1);
    // Classification ran on English; resolution reads the Hindi text at the
    // same index — this is the exact mechanism ProjectDetails.tsx relies on
    // to stay multilingual-safe (classify on base, render from displayDetails).
    const resolved = resolveProseMatch(matches[0], DETAILS_HI);
    expect(resolved).toBe(DETAILS_HI.tender_simplified.cons_and_risks[0]);
  });

  test('resolveProseMatch returns empty string for an out-of-range index rather than throwing', () => {
    const resolved = resolveProseMatch({ field: 'cons_and_risks', index: 99 }, DETAILS_EN);
    expect(resolved).toBe('');
  });
});

describe('bucketComplianceRequirement', () => {
  test('turnover/financial-capacity language buckets as financial', () => {
    expect(bucketComplianceRequirement('Minimum average annual turnover of Rs. 5 Cr in last 3 years')).toBe('financial');
  });

  test('similar-work/equipment language buckets as technical', () => {
    expect(bucketComplianceRequirement('Experience of at least 2 similar works with own plant and machinery')).toBe('technical');
  });

  test('unmatched requirement defaults to qualification', () => {
    expect(bucketComplianceRequirement('Valid GST registration certificate')).toBe('qualification');
  });

  test('empty/undefined input does not throw and defaults to qualification', () => {
    expect(bucketComplianceRequirement('')).toBe('qualification');
    expect(bucketComplianceRequirement(undefined as unknown as string)).toBe('qualification');
  });
});
