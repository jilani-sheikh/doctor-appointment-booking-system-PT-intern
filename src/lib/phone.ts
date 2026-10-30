/**
 * Normalizes and validates Indian phone numbers for Cashfree customer_details.
 * Strips +91, leading 0, spaces, dashes, and punctuation.
 * Returns a clean 10-digit mobile number if valid, or null if invalid.
 */
export function normalizeIndianPhoneNumber(rawPhone?: string | null): string | null {
  if (!rawPhone) return null;

  // Extract all numeric digits
  let digits = rawPhone.replace(/\D/g, "");

  // If 12 digits starting with country code 91
  if (digits.length === 12 && digits.startsWith("91")) {
    digits = digits.slice(2);
  }

  // If 11 digits starting with trunk prefix 0
  if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // Valid Indian mobile numbers are 10 digits starting with 6, 7, 8, or 9
  if (digits.length === 10 && /^[6-9]\d{9}$/.test(digits)) {
    return digits;
  }

  return null;
}
