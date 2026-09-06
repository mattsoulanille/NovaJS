import 'jasmine';
import { addDays, baseDaysPerJump, dateFromDayNumber, dayNumber, daysInMonth, daysPerJump, formatDate } from './calendar.js';

describe('calendar', () => {
    it('round-trips dates through day numbers', () => {
        const dates = [
            { day: 1, month: 1, year: 0 },
            { day: 23, month: 6, year: 1177 },
            { day: 29, month: 2, year: 1176 }, // leap day
            { day: 31, month: 12, year: 1999 },
            { day: 1, month: 3, year: 1100 },  // 1100 is not a leap year
        ];
        for (const date of dates) {
            expect(dateFromDayNumber(dayNumber(date)))
                .toEqual(date);
        }
    });

    it('starts at day zero', () => {
        expect(dayNumber({ day: 1, month: 1, year: 0 })).toBe(0);
        expect(dayNumber({ day: 2, month: 1, year: 0 })).toBe(1);
    });

    it('knows leap years (including the century rules)', () => {
        expect(daysInMonth(2, 1176)).toBe(29);
        expect(daysInMonth(2, 1177)).toBe(28);
        expect(daysInMonth(2, 1100)).toBe(28); // century, not /400
        expect(daysInMonth(2, 1200)).toBe(29); // /400
    });

    it('adds days across month and year boundaries', () => {
        expect(addDays({ day: 30, month: 6, year: 1177 }, 1))
            .toEqual({ day: 1, month: 7, year: 1177 });
        expect(addDays({ day: 31, month: 12, year: 1177 }, 1))
            .toEqual({ day: 1, month: 1, year: 1178 });
        expect(addDays({ day: 23, month: 6, year: 1177 }, 30))
            .toEqual({ day: 23, month: 7, year: 1177 });
        expect(addDays({ day: 23, month: 6, year: 1177 }, 0))
            .toEqual({ day: 23, month: 6, year: 1177 });
    });

    it('agrees with the real-world calendar on weekdays', () => {
        // 1 Jan 2000 was a Saturday; 18 Jul 2026 is a Saturday.
        expect(formatDate({ day: 1, month: 1, year: 2000 }))
            .toBe('Sat, 1 Jan 2000');
        expect(formatDate({ day: 18, month: 7, year: 2026 }))
            .toBe('Sat, 18 Jul 2026');
    });

    it('formats with the chär prefix and suffix', () => {
        expect(formatDate({ day: 23, month: 6, year: 1177 }, '', ' NC'))
            .toBe('Thu, 23 Jun 1177 NC');
    });

    it('maps ship mass to days per jump per the Bible table', () => {
        expect(baseDaysPerJump(0)).toBe(1);
        expect(baseDaysPerJump(99)).toBe(1);
        expect(baseDaysPerJump(100)).toBe(2);
        expect(baseDaysPerJump(199)).toBe(2);
        expect(baseDaysPerJump(200)).toBe(3);
        expect(baseDaysPerJump(5000)).toBe(3);
        // daysPerJump with no mod matches the base table.
        expect(daysPerJump(0)).toBe(1);
        expect(daysPerJump(100)).toBe(2);
        expect(daysPerJump(200)).toBe(3);
    });

    it('applies the ModType 22 hyperspace speed mod, floored at 1 day', () => {
        // A negative mod speeds jumps up.
        expect(daysPerJump(200, -1)).toBe(2);
        expect(daysPerJump(200, -2)).toBe(1);
        // The floor: never below 1 day/jump, however large the negative.
        expect(daysPerJump(200, -3)).toBe(1);
        expect(daysPerJump(100, -5)).toBe(1);
        expect(daysPerJump(50, -1)).toBe(1);
        // A positive mod slows jumps down (no upper cap).
        expect(daysPerJump(50, 2)).toBe(3);
        expect(daysPerJump(200, 4)).toBe(7);
    });
});
