const RFC_3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[t\s](\d{2}):(\d{2}):(\d{2})(\.\d+)?(z|([+-])(\d{2})(?::?(\d{2}))?)$/i;

/**
 * Parses the strict date-time language accepted by ajv-formats.
 *
 * Unlike Date.parse, this accepts every timezone spelling supported by the
 * frozen contract and maps a valid UTC leap second to the following instant.
 */
export function parseRfc3339DateTime(value: string): Date | null {
  const match = RFC_3339_DATE_TIME.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetSign = match[9] === "-" ? -1 : 1;
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  if (second === 60) {
    const utcMinute = minute - offsetMinute * offsetSign;
    const utcHour = hour - offsetHour * offsetSign - (utcMinute < 0 ? 1 : 0);
    if (
      (utcHour !== 23 && utcHour !== -1) ||
      (utcMinute !== 59 && utcMinute !== -1)
    ) {
      return null;
    }
  }

  const fractionMilliseconds = Math.floor(Number(`0${match[7] ?? ""}`) * 1_000);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, Math.min(second, 59), fractionMilliseconds);
  const offsetMilliseconds =
    (match[8]!.toLowerCase() === "z"
      ? 0
      : offsetSign * (offsetHour * 60 + offsetMinute)) * 60_000;
  return new Date(
    local.getTime() - offsetMilliseconds + (second === 60 ? 1_000 : 0)
  );
}

export function isRfc3339DateTime(value: string): boolean {
  return parseRfc3339DateTime(value) !== null;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leapYear ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}
