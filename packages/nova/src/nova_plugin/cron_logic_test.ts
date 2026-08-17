import 'jasmine';
import { CronData, getDefaultCronData } from 'novadatainterface/cron_data';
import { getDefaultRankData } from 'novadatainterface/rank_data';
import { dayNumber } from './calendar.js';
import { runCronsForDays } from './cron_logic.js';
import { CronStates } from './player_state_plugin.js';

function makeCron(partial: Partial<CronData> = {}): CronData {
    return {
        ...getDefaultCronData(),
        id: 'nova:128',
        name: 'Test Cron',
        random: 100,
        ...partial,
    };
}

const DAY = dayNumber({ day: 23, month: 6, year: 1177 });

describe('runCronsForDays', () => {
    it('scopes a cron\'s Kxxx rank grant to the cron\'s OWN plug-in, not '
        + 'the stock namespace', () => {
            // A plug-in cron granting "its" rank 147 must activate
            // "arpia:147", exactly as a plug-in mission's set string does —
            // regardless of the caller's fallback resolveId.
            const cron = makeCron({ id: 'arpia:300', onStart: 'K147' });
            const active = new Set<string>();
            runCronsForDays([cron], new Map(), new Set(), DAY, DAY + 1,
                () => 0, 0n, {
                    active,
                    resolveId: id => `nova:${id}`,
                    getRank: id => id === 'arpia:147'
                        ? { ...getDefaultRankData(), id } : undefined,
                });
            expect([...active]).toEqual(['arpia:147']);
        });

    it('reads Oxxx in EnableOn against the owned outfits, in the cron\'s '
        + 'own plug-in namespace', () => {
            // Extra Outfits crön 604 "Take Away Officers": EnableOn !O533,
            // OnStart !b9010. Owning the plug-in's oütf 533 must keep it
            // from firing; without the outfits, `!O533` read as true and
            // the officer bit was cleared the day the player left.
            const cron = makeCron({
                id: 'extra-outfits:604', enableOn: '!O533', onStart: '!b10',
            });
            const run = (owned: [string, number][]) => {
                const bits = new Set([10]);
                runCronsForDays([cron], new Map(), bits, DAY, DAY + 1,
                    () => 0, 0n, { ownedOutfits: new Map(owned) });
                return bits.has(10);
            };
            expect(run([['extra-outfits:533', 1]])).toBe(true);
            // A stock outfit of the same number counts too (id-space rule)...
            expect(run([['nova:533', 1]])).toBe(true);
            // ...but a third plug-in's 533, a zero count, or nothing don't.
            expect(run([['arpia:533', 1]])).toBe(false);
            expect(run([['extra-outfits:533', 0]])).toBe(false);
            expect(run([])).toBe(false);
            // No outfits supplied at all: owns nothing.
            const bits = new Set([10]);
            runCronsForDays([cron], new Map(), bits, DAY, DAY + 1, () => 0);
            expect(bits.has(10)).toBe(false);
        });

    it('runs OnStart and OnEnd together for duration 0', () => {
        const cron = makeCron({ onStart: 'b10', onEnd: 'b11' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(true);
        expect(bits.has(11)).toBe(true);
        expect(states.get('nova:128')?.phase).toBe('idle');
    });

    it('waits out PreHoldoff before OnStart', () => {
        const cron = makeCron({ preHoldoff: 3, onStart: 'b10' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(false);
        expect(states.get('nova:128')?.phase).toBe('pre');
        // The holdoff expires 3 days after activation (on DAY + 4).
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 4, () => 0);
        expect(bits.has(10)).toBe(true);
        expect(states.get('nova:128')?.phase).toBe('idle');
    });

    it('stays active for Duration days before OnEnd', () => {
        const cron = makeCron({ duration: 5, onStart: 'b10', onEnd: 'b11' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(true);
        expect(bits.has(11)).toBe(false);
        expect(states.get('nova:128')?.phase).toBe('active');
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 6, () => 0);
        expect(bits.has(11)).toBe(true);
    });

    it('respects EnableOn against the player bits', () => {
        const cron = makeCron({ enableOn: 'b1', onStart: 'b10' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(false);
        bits.add(1);
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 2, () => 0);
        expect(bits.has(10)).toBe(true);
    });

    it('respects the Random daily chance', () => {
        const cron = makeCron({ random: 30, onStart: 'b10' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0.5);
        expect(bits.has(10)).toBe(false);
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 2, () => 0.2);
        expect(bits.has(10)).toBe(true);
    });

    it('respects the calendar date range', () => {
        const cron = makeCron({
            firstDay: 1, firstMonth: 7, firstYear: 1177,
            lastDay: 31, lastMonth: 7, lastYear: 1177,
            onStart: 'b10',
        });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        // 23 Jun 1177 is before the range.
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(false);
        // 8 days later it is July.
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 9, () => 0);
        expect(bits.has(10)).toBe(true);
    });

    it('holds off re-activation for PostHoldoff days', () => {
        const cron = makeCron({ postHoldoff: 10, onStart: '^b10' });
        const bits = new Set<number>();
        const states: CronStates = new Map();
        runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
        expect(bits.has(10)).toBe(true);
        // The next 10 days must not toggle the bit again.
        runCronsForDays([cron], states, bits, DAY + 1, DAY + 10, () => 0);
        expect(bits.has(10)).toBe(true);
        // After the holdoff it fires again (toggling the bit off).
        runCronsForDays([cron], states, bits, DAY + 10, DAY + 12, () => 0);
        expect(bits.has(10)).toBe(false);
    });

    describe('Require / Contribute', () => {
        it('does not activate unless Require is covered by Contribute', () => {
            // Require bit 0x4 (the third contribute bit).
            const cron = makeCron({ require: '4', onStart: 'b10' });
            const bits = new Set<number>();
            const states: CronStates = new Map();
            // No contribute: the cron never activates.
            runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0, 0n);
            expect(bits.has(10)).toBe(false);
            // With the required bit contributed, it activates.
            runCronsForDays([cron], states, bits, DAY + 1, DAY + 2,
                () => 0, 0x4n);
            expect(bits.has(10)).toBe(true);
        });

        it('folds an active cron\'s Contribute into others\' Require', () => {
            // cronA contributes bit 0x8 while active; cronB requires it.
            const cronA = makeCron({
                id: 'nova:200', contribute: '8', duration: 5,
                onStart: 'b20',
            });
            const cronB = makeCron({
                id: 'nova:201', require: '8', onStart: 'b21',
            });
            const bits = new Set<number>();
            const states: CronStates = new Map();
            // cronA activates first (order matters: it precedes cronB),
            // so its contribute is available to cronB the same day.
            runCronsForDays([cronA, cronB], states, bits,
                DAY, DAY + 1, () => 0, 0n);
            expect(bits.has(20)).toBe(true);
            expect(bits.has(21)).toBe(true);
        });
    });

    describe('loop flags', () => {
        it('re-runs OnStart each active day with loopOnStart', () => {
            // Counts up a bit toggle each day; use a set (not toggle) so
            // we can observe repeated runs via a duration window. OnStart
            // sets b10 each day; combine with an EnableOn that we clear
            // mid-window to prove the loop stops.
            const cron = makeCron({
                loopOnStart: true, duration: 4, enableOn: 'b1',
                onStart: '^b10',
            });
            const bits = new Set<number>([1]);
            const states: CronStates = new Map();
            // Day 1 (entry): OnStart runs once -> b10 on.
            runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
            expect(bits.has(10)).toBe(true);
            // Day 2: loop re-runs OnStart -> toggles b10 off.
            runCronsForDays([cron], states, bits, DAY + 1, DAY + 2, () => 0);
            expect(bits.has(10)).toBe(false);
            // Clear EnableOn: the loop stops, b10 stays as-is.
            bits.delete(1);
            runCronsForDays([cron], states, bits, DAY + 2, DAY + 3, () => 0);
            expect(bits.has(10)).toBe(false);
        });

        it('does not re-run OnStart without the loop flag', () => {
            const cron = makeCron({ duration: 4, onStart: '^b10' });
            const bits = new Set<number>();
            const states: CronStates = new Map();
            runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
            expect(bits.has(10)).toBe(true);
            // Subsequent active days do NOT re-run OnStart.
            runCronsForDays([cron], states, bits, DAY + 1, DAY + 3, () => 0);
            expect(bits.has(10)).toBe(true);
        });

        it('re-runs OnEnd during postHoldoff with loopOnEnd', () => {
            const cron = makeCron({
                loopOnEnd: true, postHoldoff: 4, enableOn: 'b1',
                onEnd: '^b11',
            });
            const bits = new Set<number>([1]);
            const states: CronStates = new Map();
            // Duration 0: OnStart+OnEnd together on the entry day. OnEnd
            // toggles b11 on.
            runCronsForDays([cron], states, bits, DAY, DAY + 1, () => 0);
            expect(bits.has(11)).toBe(true);
            // Next postHoldoff day: loopOnEnd re-runs OnEnd -> b11 off.
            runCronsForDays([cron], states, bits, DAY + 1, DAY + 2, () => 0);
            expect(bits.has(11)).toBe(false);
        });
    });

    describe('Gxxx / Dxxx outfit operators', () => {
        // Extra Outfits' Weapon Construction Bay in miniature: OnStart
        // consumes the building materials, OnEnd hands back the ammunition
        // Duration days later. Without these operators wired the bay
        // consumed nothing and produced nothing (the reported bug).
        const bay = (partial: Partial<CronData> = {}) => makeCron({
            id: 'extra-outfits:500', duration: 2,
            enableOn: 'O535 & O536',
            onStart: 'D535 D536', onEnd: 'G135 G135 G135',
            ...partial,
        });

        it('consumes on OnStart and grants on OnEnd, in day order', () => {
            const outfits = new Map([
                ['extra-outfits:535', 1], ['extra-outfits:536', 1],
            ]);
            const states: CronStates = new Map();
            const run = (from: number, to: number) =>
                runCronsForDays([bay()], states, new Set(), from, to,
                    () => 0, 0n, {
                        ownedOutfits: outfits,
                        outfitExists: id => id === 'nova:135',
                    });

            run(DAY, DAY + 1);
            // Dxxx removed the last of each material rather than leaving a
            // zero count behind.
            expect([...outfits.keys()]).toEqual([]);
            run(DAY + 1, DAY + 2);
            expect([...outfits.keys()]).toEqual([]);
            // Duration 2: OnEnd lands on the third day.
            run(DAY + 2, DAY + 3);
            expect([...outfits]).toEqual([['nova:135', 3]]);
        });

        it('resolves a bare number stock-first, then to the cron\'s own '
            + 'plug-in', () => {
                const grant = (n: number, exists: string[]) => {
                    const outfits = new Map<string, number>();
                    runCronsForDays(
                        [bay({ enableOn: '', onStart: '', onEnd: `G${n}` })],
                        new Map(), new Set(), DAY, DAY + 3, () => 0, 0n,
                        {
                            ownedOutfits: outfits,
                            outfitExists: id => exists.includes(id),
                        });
                    return [...outfits.keys()];
                };
                // crön 500's G135: stock has a 135, so it is the stock one.
                expect(grant(135, ['nova:135', 'extra-outfits:464']))
                    .toEqual(['nova:135']);
                // crön 504's G464: stock has none, so it is the plug-in's.
                expect(grant(464, ['nova:135', 'extra-outfits:464']))
                    .toEqual(['extra-outfits:464']);
                // With no id space to consult, a cron's number is its own
                // plug-in's — the behaviour before outfitExists existed.
                const outfits = new Map<string, number>();
                runCronsForDays(
                    [bay({ enableOn: '', onStart: '', onEnd: 'G135' })],
                    new Map(), new Set(), DAY, DAY + 3, () => 0, 0n,
                    { ownedOutfits: outfits });
                expect([...outfits.keys()]).toEqual(['extra-outfits:135']);
            });

        it('shows a later day\'s EnableOn what an earlier day granted', () => {
            // The consumer only fires once the producer has handed over its
            // outfit, which is the whole point of running against one map.
            const producer = makeCron({
                id: 'nova:200', onEnd: 'G300',
            });
            const consumer = makeCron({
                id: 'nova:201', enableOn: 'O300', onStart: 'b10',
            });
            const outfits = new Map<string, number>();
            const bits = new Set<number>();
            const states: CronStates = new Map();
            const options = {
                ownedOutfits: outfits,
                outfitExists: (id: string) => id === 'nova:300',
            };
            // Day 1: the producer grants; the consumer already ran for the
            // day, so it only sees the outfit on day 2.
            runCronsForDays([consumer, producer], states, bits,
                DAY, DAY + 1, () => 0, 0n, options);
            expect(outfits.get('nova:300')).toBe(1);
            expect(bits.has(10)).toBe(false);
            runCronsForDays([consumer, producer], states, bits,
                DAY + 1, DAY + 2, () => 0, 0n, options);
            expect(bits.has(10)).toBe(true);
        });

        it('leaves Gxxx / Dxxx unimplemented when given no outfits map',
            () => {
                // No map to mutate: the operators stay unwired and ncb.ts
                // warns, exactly as it does for every hook a caller omits.
                // The bits in the same string still run.
                const bits = new Set<number>();
                expect(() => runCronsForDays(
                    [bay({ enableOn: '', onStart: 'b10 D535', onEnd: '' })],
                    new Map(), bits, DAY, DAY + 1, () => 0)).not.toThrow();
                expect(bits.has(10)).toBe(true);
            });
    });
});
