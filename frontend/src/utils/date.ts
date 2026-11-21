/**
 * Format a Date object into local YYYY-MM-DD without UTC timezone shifting.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Return today's date in the browser's local timezone as YYYY-MM-DD.
 */
export function getTodayLocalDate(): string {
  return formatLocalDate(new Date());
}

/**
 * Return the current month in the browser's local timezone as YYYY-MM.
 */
export function getCurrentLocalMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Return the local first and last YYYY-MM-DD dates for a given year and 0-indexed month.
 */
export function getLocalMonthBounds(
  year: number,
  monthIndex: number
): { firstDay: string; lastDay: string } {
  return {
    firstDay: formatLocalDate(new Date(year, monthIndex, 1)),
    lastDay: formatLocalDate(new Date(year, monthIndex + 1, 0)),
  };
}
