/**
 * Helpers for user-friendly live thousand-separated IDR/currency input fields.
 * State remains a clean numeric string (e.g. "50000"), while displayed text is
 * formatted inline with Indonesian dot separators (e.g. "50.000").
 */

export function sanitizeCurrencyDigits(raw: string): string {
  const digitsOnly = raw.replace(/\D/g, '');
  if (!digitsOnly) return '';
  // Collapse leading zeros unless value is simply "0"
  return digitsOnly.replace(/^0+(?=\d)/, '');
}

export function formatCurrencyInputDisplay(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';

  let rawStr: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    rawStr = String(Math.round(value));
  } else {
    const trimmed = value.trim();
    if (!trimmed) return '';
    // Handle backend/stored numeric strings that might carry ".00" decimals
    if (/^\d+\.\d+$/.test(trimmed)) {
      rawStr = String(Math.round(Number(trimmed)));
    } else {
      rawStr = sanitizeCurrencyDigits(trimmed);
    }
  }

  if (!rawStr) return '';
  const num = Number(rawStr);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('id-ID');
}
