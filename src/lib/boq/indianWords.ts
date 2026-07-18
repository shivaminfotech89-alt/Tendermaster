// Indian number-to-words: Rupees/Paise, Lakh/Crore system.
// This string is printed on submitted bid documents — every case must be correct.

const ones = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const tensWords = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

// n in 1–99
function belowHundred(n: number): string {
  if (n < 20) return ones[n]!;
  const t = tensWords[Math.floor(n / 10)]!;
  const o = n % 10;
  return o ? `${t}-${ones[o]!}` : t;
}

// n in 1–999
function belowThousand(n: number): string {
  if (n === 0) return '';
  if (n < 100) return belowHundred(n);
  const h = Math.floor(n / 100);
  const r = n % 100;
  return r ? `${ones[h]!} Hundred ${belowHundred(r)}` : `${ones[h]!} Hundred`;
}

// n in 1–9_999_999_999_999 (handles up to ~9,999 Crore)
function rupeesWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];

  const crores = Math.floor(n / 1_00_00_000);
  n %= 1_00_00_000;
  if (crores > 0) {
    if (crores < 1000) {
      parts.push(`${belowThousand(crores)} Crore`);
    } else {
      // 1,000–9,999 crore — e.g. "One Thousand Five Hundred Crore"
      const cT = Math.floor(crores / 1000);
      const cR = crores % 1000;
      const cPart = cR
        ? `${belowThousand(cT)} Thousand ${belowThousand(cR)}`
        : `${belowThousand(cT)} Thousand`;
      parts.push(`${cPart} Crore`);
    }
  }

  const lakhs = Math.floor(n / 1_00_000);
  n %= 1_00_000;
  if (lakhs > 0) parts.push(`${belowThousand(lakhs)} Lakh`);

  const thousands = Math.floor(n / 1_000);
  n %= 1_000;
  if (thousands > 0) parts.push(`${belowThousand(thousands)} Thousand`);

  if (n > 0) parts.push(belowThousand(n));

  return parts.join(' ');
}

/**
 * Convert a rupee amount (with optional paise) to Indian words.
 * e.g. 7800409 → "Rupees Seventy-Eight Lakh Four Hundred Nine Only"
 * e.g. 100.50  → "Rupees One Hundred and Fifty Paise Only"
 */
export function toIndianWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return 'Invalid Amount';
  // Use integer paise to avoid floating-point drift
  const totalPaise = Math.round(amount * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise  = totalPaise % 100;
  const rWords = rupeesWords(rupees);
  if (paise === 0) return `Rupees ${rWords} Only`;
  return `Rupees ${rWords} and ${belowHundred(paise)} Paise Only`;
}
