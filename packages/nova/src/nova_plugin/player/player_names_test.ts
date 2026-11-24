import 'jasmine';
import {
    derivedShipName, MAX_PLAYER_NAME_LENGTH, playerPilotName, playerShipName,
    sanitizeShipName,
    sanitizePlayerName,
} from './player_names.js';

const ch = (code: number) => String.fromCharCode(code);

describe('player names', () => {
    describe('sanitizePlayerName', () => {
        it('keeps an ordinary name as typed', () => {
            expect(sanitizePlayerName('Kit Mass Roomy 300 989'))
                .toBe('Kit Mass Roomy 300 989');
            expect(sanitizePlayerName("Rocinante <PN> {b12 \"x\"}"))
                .toBe("Rocinante <PN> {b12 \"x\"}");
        });

        it('strips control characters, line breaks and text-direction '
            + 'overrides', () => {
            expect(sanitizePlayerName(`Roci${ch(0)}nante${ch(7)}`))
                .toBe('Rocinante');
            expect(sanitizePlayerName('Two\nLines\r\tHere'))
                .toBe('TwoLinesHere');
            expect(sanitizePlayerName(`Del${ch(0x7f)}${ch(0x85)}ete`))
                .toBe('Delete');
            expect(sanitizePlayerName(
                `${ch(0x202e)}evil${ch(0x2066)}${ch(0x2028)}${ch(0xfeff)}`))
                .toBe('evil');
        });

        it('trims and caps at Str31 characters without splitting a '
            + 'surrogate pair', () => {
            expect(MAX_PLAYER_NAME_LENGTH).toBe(31);
            expect(sanitizePlayerName('   Spaced   ')).toBe('Spaced');
            const long = 'x'.repeat(40);
            expect(sanitizePlayerName(long)).toBe('x'.repeat(31));
            const rocket = String.fromCodePoint(0x1f680);
            const emoji = 'y'.repeat(30) + rocket + rocket;
            const kept = sanitizePlayerName(emoji)!;
            expect(Array.from(kept).length).toBe(31);
            expect(kept.endsWith(rocket)).toBeTrue();
        });

        it('turns empty and non-string values into undefined', () => {
            expect(sanitizePlayerName('')).toBeUndefined();
            expect(sanitizePlayerName(` ${ch(1)}\n `)).toBeUndefined();
            expect(sanitizePlayerName(undefined)).toBeUndefined();
            expect(sanitizePlayerName(42)).toBeUndefined();
            expect(sanitizePlayerName({ name: 'x' })).toBeUndefined();
        });
    });

    it('keeps an empty SHIP name as a blank one, cleaned the same way',
        () => {
            expect(sanitizeShipName('')).toBe('');
            expect(sanitizeShipName(` ${ch(7)}\n`)).toBe('');
            expect(sanitizeShipName(`Roci${ch(0)}nante`)).toBe('Rocinante');
            expect(sanitizeShipName('z'.repeat(64))).toBe('z'.repeat(31));
            expect(sanitizeShipName(undefined)).toBeUndefined();
            expect(sanitizeShipName(3)).toBeUndefined();
            // A blank stored name is the name: no derived fallback.
            expect(playerShipName({ ship: '' }, 'Shuttle', 5)).toBe('');
        });

    it('derives "<type> <number>", the number defaulting to 1', () => {
        expect(derivedShipName('Heavy Shuttle', 244))
            .toBe('Heavy Shuttle 244');
        expect(derivedShipName('Shuttle')).toBe('Shuttle 1');
    });

    it('reads the stored ship name first, cleaned, else the derived one',
        () => {
            expect(playerShipName({ ship: 'Rocinante' }, 'Shuttle', 5))
                .toBe('Rocinante');
            expect(playerShipName({ ship: `Bad${ch(10)}Name` }, 'Shuttle'))
                .toBe('BadName');
            expect(playerShipName({ ship: '   ' }, 'Shuttle', 5))
                .toBe('');
            expect(playerShipName(undefined, 'Shuttle', 5)).toBe('Shuttle 5');
            expect(playerShipName(undefined, undefined)).toBeUndefined();
        });

    it('reads the stored pilot name first, else the fallback, both cleaned',
        () => {
            expect(playerPilotName({ pilot: 'Matt' }, 'Pilot')).toBe('Matt');
            expect(playerPilotName({}, 'Pilot')).toBe('Pilot');
            expect(playerPilotName({ pilot: ch(3) }, undefined))
                .toBeUndefined();
        });
});
