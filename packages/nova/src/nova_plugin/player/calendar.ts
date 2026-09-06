import { GameDate } from 'novadatainterface/player_start_data';

/**
 * Pure Gregorian calendar arithmetic for the game date. EV Nova uses
 * real calendar dates (the chär resource stores day/month/year and
 * crön events gate on calendar ranges), so this implements a proleptic
 * Gregorian calendar with plain integer math — no `Date` objects, no
 * timezones, and nothing that could differ between engines.
 */

const DAYS_PER_400_YEARS = 146097;

function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function daysInMonth(month: number, year: number): number {
    if (month === 2 && isLeapYear(year)) {
        return 29;
    }
    return MONTH_DAYS[month - 1] ?? 30;
}

/** Days from the start of the year to the start of `month` (1-12). */
function daysBeforeMonth(month: number, year: number): number {
    let days = 0;
    for (let m = 1; m < month; m++) {
        days += daysInMonth(m, year);
    }
    return days;
}

/** Whole days in the years [0, year). */
function daysBeforeYear(year: number): number {
    // Count of leap years in [0, year): every 4th, minus centuries,
    // plus every 400th; year 0 itself is a leap year but lies inside
    // the range only when year > 0, which the ceil-style formula
    // below (valid for year >= 0) accounts for.
    const y = year;
    const leaps = Math.floor((y + 3) / 4) - Math.floor((y + 99) / 100)
        + Math.floor((y + 399) / 400);
    return y * 365 + leaps;
}

/**
 * The absolute day number of a date: days since 1 January of year 0.
 * A plain integer, so day arithmetic (deadlines, cron durations) is
 * exact and serializes cleanly.
 */
export function dayNumber(date: GameDate): number {
    return daysBeforeYear(date.year)
        + daysBeforeMonth(date.month, date.year)
        + (date.day - 1);
}

/** The date `days` (integer, may be 0) after day number `n`. */
export function dateFromDayNumber(n: number): GameDate {
    // Estimate the year, then correct; daysBeforeYear is monotonic.
    let year = Math.floor(n / DAYS_PER_400_YEARS * 400);
    while (daysBeforeYear(year + 1) <= n) {
        year++;
    }
    while (daysBeforeYear(year) > n) {
        year--;
    }
    let remaining = n - daysBeforeYear(year);
    let month = 1;
    while (remaining >= daysInMonth(month, year)) {
        remaining -= daysInMonth(month, year);
        month++;
    }
    return { day: remaining + 1, month, year };
}

/** The date `days` days after `date`. */
export function addDays(date: GameDate, days: number): GameDate {
    return dateFromDayNumber(dayNumber(date) + days);
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAY_NAMES = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

/** e.g. "Fri, 23 Jun 1177". Day 0 (1 Jan of year 0) is a Saturday. */
export function formatDate(date: GameDate, prefix = '', suffix = ''): string {
    const weekday = WEEKDAY_NAMES[((dayNumber(date) % 7) + 7) % 7];
    const month = MONTH_NAMES[date.month - 1] ?? `M${date.month}`;
    return `${prefix}${weekday}, ${date.day} ${month} ${date.year}${suffix}`;
}

/**
 * Base days a hyperspace jump takes for a ship of the given mass, per
 * the EVN Bible's shïp Mass table: 1-99 tons is 1 day, 100-199 is 2,
 * 200 and up is 3.
 */
export function baseDaysPerJump(mass: number): number {
    if (mass < 100) {
        return 1;
    }
    if (mass < 200) {
        return 2;
    }
    return 3;
}

/**
 * Days a hyperspace jump takes for a ship of the given mass, after the
 * summed "hyperspace speed mod" outfit adjustment (oütf ModType 22).
 * ModVal is a signed number of days added to the base; the Bible caps
 * the result so it "still can't go below 1 day/jump".
 */
export function daysPerJump(mass: number, hyperspaceSpeedMod = 0): number {
    return Math.max(1, baseDaysPerJump(mass) + hyperspaceSpeedMod);
}
