/**
 * Money utilities: integer paise calculations to prevent floating point inaccuracies.
 * All internal arithmetic (policy, partial refunds, caps) must be done in integer paise.
 * Decimal(10,2) is used only at the database/API boundaries.
 */

export function rupeesToPaise(rupees: number | string): number {
  const num = typeof rupees === "string" ? parseFloat(rupees) : rupees;
  if (isNaN(num)) return 0;
  return Math.round(num * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}

export function paiseToDecimalString(paise: number): string {
  return (paise / 100).toFixed(2);
}

export function formatINR(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
