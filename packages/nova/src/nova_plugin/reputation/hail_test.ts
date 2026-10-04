import { GovtData, getDefaultGovtData } from 'novadatainterface/govt_data';
import {
    assistForPayText,
    assistIsFree,
    assistPaidText,
    assistRefusedText,
    assistWillingness,
    ASSIST_FOR_PAY_FIRST_INDEX,
    ASSIST_PAID_FIRST_INDEX,
    ASSIST_REFUSED_FIRST_INDEX,
    justAnEscortText,
    rudeGreetingText,
    bribeAmount,
    busyResponseText,
    BUSY_RESPONSE_COUNT,
    BUSY_RESPONSE_FALLBACK,
    BUSY_RESPONSE_FIRST_INDEX,
    shipIsFighting,
    BRIBE_FRACTION,
    BRIBE_FRACTION_LARGE,
    BRIBE_MINIMUM,
    canRequestAssistance,
    greetingText,
    hashString,
    hostileResponseText,
    HOSTILE_RESPONSE_COUNT,
    HOSTILE_RESPONSE_FALLBACK,
    HOSTILE_RESPONSE_FIRST_INDEX,
    noNeedResponseText,
    NO_NEED_RESPONSE_COUNT,
    NO_NEED_RESPONSE_FALLBACK,
    NO_NEED_RESPONSE_FIRST_INDEX,
    planetTakesBribes,
    shipAnswersHails,
    shipHailResponse,
    shipTakesBribes,
} from './hail.js';

function govt(overrides: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id: 'nova:128', ...overrides };
}
function withFlags(flags: Partial<GovtData['flags']>): GovtData {
    return govt({ flags: { ...getDefaultGovtData().flags, ...flags } });
}
function withFlags2(flags2: Partial<GovtData['flags2']>): GovtData {
    return govt({ flags2: { ...getDefaultGovtData().flags2, ...flags2 } });
}

describe('shipTakesBribes', () => {
    it('warships take bribes only with the warship flag', () => {
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: true }), 3))
            .toBe(true);
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: false }), 3))
            .toBe(false);
    });
    it('freighters take bribes only with the freighter flag', () => {
        expect(shipTakesBribes(withFlags({ freightersTakeBribes: true }), 1))
            .toBe(true);
        expect(shipTakesBribes(withFlags({ warshipsTakeBribes: true }), 2))
            .toBe(false);
    });
    it('largerBribes (pirates) always take bribes regardless of aiType', () => {
        expect(shipTakesBribes(withFlags({ largerBribes: true }), 1)).toBe(true);
        expect(shipTakesBribes(withFlags({ largerBribes: true }), 3)).toBe(true);
    });
    it('no govt never takes bribes', () => {
        expect(shipTakesBribes(undefined, 3)).toBe(false);
    });
});

describe('bribeAmount', () => {
    it('demands the ordinary fraction of cash', () => {
        expect(bribeAmount(100_000, false))
            .toBe(Math.floor(100_000 * BRIBE_FRACTION));
    });
    it('demands the larger fraction for pirate govts', () => {
        expect(bribeAmount(100_000, true))
            .toBe(Math.floor(100_000 * BRIBE_FRACTION_LARGE));
    });
    it('never falls below the minimum but never exceeds the player cash', () => {
        expect(bribeAmount(1000, false)).toBe(BRIBE_MINIMUM);
        // A player poorer than the minimum pays everything they have.
        expect(bribeAmount(200, false)).toBe(200);
    });
    it('is deterministic: same inputs, same output (no randomness)', () => {
        expect(bribeAmount(54_321, true)).toBe(bribeAmount(54_321, true));
    });
});

describe('shipHailResponse', () => {
    it('cantBeHailed govts do not answer', () => {
        expect(shipHailResponse(withFlags({ cantBeHailed: true }),
            false, 3)).toEqual({ kind: 'cantHail' });
    });
    it('an IFF-hostile ship offers Beg For Mercy, priced when the govt '
        + 'bargains', () => {
        expect(shipHailResponse(withFlags({ warshipsTakeBribes: true }),
            true, 3)).toEqual({ kind: 'hostile', canBeg: true, canBribe: true });
    });
    it('an IFF-hostile ship of a non-bribing govt STILL offers Beg For '
        + 'Mercy - the plea is refused, not hidden (ruling #297)', () => {
        expect(shipHailResponse(govt(), true, 3))
            .toEqual({ kind: 'hostile', canBeg: true, canBribe: false });
    });
    it('noAssistOrMercy disables Beg For Mercy even for a bribing govt',
        () => {
            const g = withFlags({ warshipsTakeBribes: true });
            g.flags2 = { ...g.flags2, noAssistOrMercy: true };
            expect(shipHailResponse(g, true, 3))
                .toEqual({ kind: 'hostile', canBeg: false, canBribe: false });
        });
    it('friendly / neutral ships greet and are talkative by default', () => {
        expect(shipHailResponse(govt(), false, 3))
            .toEqual({ kind: 'greeting', talkative: true });
        expect(shipHailResponse(govt(), false, 1))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('noDistressMessages govts answer but are not talkative', () => {
        expect(shipHailResponse(withFlags2({ noDistressMessages: true }),
            false, 3)).toEqual({ kind: 'greeting', talkative: false });
    });
    it('a class that INHERITS no-greetings answers but is not talkative',
        () => {
            expect(shipHailResponse(govt(), false, 3,
                { inheritedNoGreetings: true }))
                .toEqual({ kind: 'greeting', talkative: false });
        });
    it('a govt-less ship greets talkatively', () => {
        expect(shipHailResponse(undefined, false, undefined))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('hostility is the IFF verdict, NOT the government stance', () => {
        // Ruling #297: "Hostility in the hailing channel should reflect the
        // iff of that ship, not the government stance." A xenophobic govt
        // whose ship is not IFF-hostile (bought off, say) answers like any
        // other; a peaceful one whose ship is IFF-hostile answers hostile.
        expect(shipHailResponse(withFlags({ xenophobic: true }), false, 3))
            .toEqual({ kind: 'greeting', talkative: true });
        expect(shipHailResponse(govt(), true, 3).kind).toBe('hostile');
    });
    it('a cantBeHailed ship stays silent even while attacking the player',
        () => {
            expect(shipHailResponse(withFlags({ cantBeHailed: true }),
                true, 3)).toEqual({ kind: 'cantHail' });
        });
    it('a class that INHERITS cantBeHailed stays silent', () => {
        expect(shipHailResponse(govt(), false, 3,
            { inheritedCantBeHailed: true })).toEqual({ kind: 'cantHail' });
    });
});

/**
 * Ruling #297: "Some ships don't respond to hails at all (no hailing channel
 * appears), like the krypt pod and wraith, and some don't have a 'request
 * assistance' button (Polaris (often) and Dechtakar)." The flag words below
 * are the stock data's, read off the real files (see shipAnswersHails).
 */
describe('shipAnswersHails', () => {
    /** A govt carrying a raw Flags2 word, decoded the way the parser does. */
    function withRawFlags2(raw: number, cantBeHailed = false): GovtData {
        const g = withFlags({ cantBeHailed });
        g.flags2 = {
            ...g.flags2,
            noAssistOrMercy: Boolean(raw & 0x0001),
            noDistressMessages: Boolean(raw & 0x0008),
            roadsideAssistance: Boolean(raw & 0x0010),
        };
        return g;
    }

    it('silences the Krypt (govt 140 Flags2 0x002b, 163 0x0029) and the '
        + 'Wraith (138/139 Flags2 0x00ab): nothing to say, nothing to offer',
        () => {
            expect(shipAnswersHails(withRawFlags2(0x002b))).toBeFalse();
            expect(shipAnswersHails(withRawFlags2(0x0029))).toBeFalse();
            expect(shipAnswersHails(withRawFlags2(0x00ab))).toBeFalse();
        });

    it('silences 0x0400, on the govt or inherited by the class', () => {
        // Wraith govt 159 (Flags 0x0c80); Wraith (Adult) nova:185 inherits
        // it through InherentGovt 159.
        expect(shipAnswersHails(withRawFlags2(0, true))).toBeFalse();
        expect(shipAnswersHails(govt(), { inheritedCantBeHailed: true }))
            .toBeFalse();
    });

    it('silences a no-assist govt whose CLASS inherits no-greetings', () => {
        expect(shipAnswersHails(withRawFlags2(0x0001),
            { inheritedNoGreetings: true })).toBeFalse();
    });

    it('lets the Dechtakar answer (govt 142 Rimerta, Flags2 0x0027): the '
        + 'channel opens, there is just no Request Assistance', () => {
        const dechtakar = withRawFlags2(0x0027);
        expect(shipAnswersHails(dechtakar)).toBeTrue();
        expect(canRequestAssistance({ govt: dechtakar })).toBeFalse();
        expect(shipHailResponse(dechtakar, false, 3))
            .toEqual({ kind: 'greeting', talkative: false });
    });

    it('lets the Polaris answer, with assistance only where the govt allows',
        () => {
            // Polaris (130, Flags2 0x0020) assists; the Nil-kemorya, who
            // also answer as "Polaris" (147, Flags2 0x0003), do not: the
            // "often" of the ruling.
            const polaris = withRawFlags2(0x0020);
            const nilkemorya = withRawFlags2(0x0003);
            expect(shipAnswersHails(polaris)).toBeTrue();
            expect(shipAnswersHails(nilkemorya)).toBeTrue();
            expect(canRequestAssistance({ govt: polaris })).toBeTrue();
            expect(canRequestAssistance({ govt: nilkemorya })).toBeFalse();
        });

    it('answers for an ordinary or govt-less ship', () => {
        expect(shipAnswersHails(govt())).toBeTrue();
        expect(shipAnswersHails(undefined)).toBeTrue();
        // 0x0008 alone (the Hypergate govt, 183) still answers.
        expect(shipAnswersHails(withRawFlags2(0x0008))).toBeTrue();
    });
});

describe('canRequestAssistance', () => {
    it('is OFFERED even when the player needs no help at all', () => {
        // Matthew: "it should show request assistance even if there's no
        // reason for you to request it (they usually just tell you that you
        // don't need help)." The offer is about who you are talking to, not
        // about your hull — the ANSWER is where the need is judged.
        expect(canRequestAssistance({ govt: govt() })).toBe(true);
        expect(canRequestAssistance({ govt: undefined })).toBe(true);
    });
    it('is OFFERED by a ship of a government hostile to the player that is '
        + 'not attacking (ruling #297: "always visible ... They just refuse '
        + 'to help you or make you pay")', () => {
        // A pirate govt: xenophobic, so its stance toward everyone is
        // hostile. Not IFF-hostile (bought off, or not engaging), so the
        // button is there; whether it helps is assistWillingness's call.
        expect(canRequestAssistance({
            govt: withFlags({ xenophobic: true, largerBribes: true }),
            iffHostile: false,
        })).toBe(true);
    });
    it('is refused by noAssistOrMercy / cantBeHailed govts', () => {
        expect(canRequestAssistance({
            govt: withFlags2({ noAssistOrMercy: true }),
        })).toBe(false);
        expect(canRequestAssistance({
            govt: withFlags({ cantBeHailed: true }),
        })).toBe(false);
    });
    it('lets ränk 0x0400 override noAssistOrMercy, but not IFF hostility',
        () => {
            const quiet = withFlags2({ noAssistOrMercy: true });
            expect(canRequestAssistance({
                govt: quiet, rankAlwaysAssists: true,
            })).toBe(true);
            expect(canRequestAssistance({
                govt: quiet, rankAlwaysAssists: true, iffHostile: true,
            })).toBe(false);
        });
    it('is allowed for Roadside Assistance govts', () => {
        expect(canRequestAssistance({ govt: withFlags2({ roadsideAssistance: true }) })).toBe(true);
    });
    it('is refused by a neutral-govt ship attacking the player', () => {
        // The assistance exploit: a neutral warship shooting a disabled player
        // must not also offer to fly over and repair them.
        expect(canRequestAssistance({ govt: govt(),
            iffHostile: true })).toBe(false);
        // Even a Roadside-Assistance govt refuses while attacking.
        expect(canRequestAssistance({ govt: withFlags2({ roadsideAssistance: true }),
            iffHostile: true })).toBe(false);
    });
});

describe('assistWillingness (ruling #297: "refuse to help you or make you '
    + 'pay")', () => {
    it('helps a player its government does not dislike', () => {
        for (const disposition of ['neutral', 'friendly'] as const) {
            expect(assistWillingness({
                disposition, govt: withFlags({ largerBribes: true }),
                aiType: 3,
            })).toBe('willing');
        }
    });
    it('makes the player PAY when its unfriendly govt takes bribes from a '
        + 'ship of its kind', () => {
        const pirate = withFlags({ xenophobic: true, largerBribes: true });
        expect(assistWillingness({
            disposition: 'hostile', govt: pirate, aiType: 3,
        })).toBe('forPay');
        // Freighter flag for freighters, warship flag for warships.
        const traders = withFlags({ freightersTakeBribes: true });
        expect(assistWillingness({
            disposition: 'hostile', govt: traders, aiType: 1,
        })).toBe('forPay');
        expect(assistWillingness({
            disposition: 'hostile', govt: traders, aiType: 3,
        })).toBe('unwilling');
    });
    it('REFUSES when its unfriendly govt takes no bribes', () => {
        expect(assistWillingness({
            disposition: 'hostile', govt: govt(), aiType: 3,
        })).toBe('unwilling');
    });
    it('always helps under a ränk 0x0400 for its government', () => {
        expect(assistWillingness({
            disposition: 'hostile', govt: govt(), aiType: 3,
            rankAlwaysAssists: true,
        })).toBe('willing');
    });
});

describe('the refusal / price / escort / rude lines (STR# 3000)', () => {
    const table = Array.from({ length: 190 }, (_, i) => `line ${i}`);
    it('draws each from its own group, deterministically by seed', () => {
        for (let seed = 0; seed < 10; seed++) {
            const pick = (text: string) => Number(text.split(' ')[1]);
            const refused = pick(assistRefusedText(table, seed));
            expect(refused).toBeGreaterThanOrEqual(ASSIST_REFUSED_FIRST_INDEX);
            expect(refused).toBeLessThan(ASSIST_REFUSED_FIRST_INDEX + 5);
            const forPay = pick(assistForPayText(table, seed));
            expect(forPay).toBeGreaterThanOrEqual(ASSIST_FOR_PAY_FIRST_INDEX);
            expect(forPay).toBeLessThan(ASSIST_FOR_PAY_FIRST_INDEX + 5);
            const paid = pick(assistPaidText(table, seed));
            expect(paid).toBeGreaterThanOrEqual(ASSIST_PAID_FIRST_INDEX);
            expect(paid).toBeLessThan(ASSIST_PAID_FIRST_INDEX + 5);
            // Only the two "just an escort" entries, never 110-112.
            expect([113, 114]).toContain(pick(justAnEscortText(table, seed)));
            // The rude greeting is entries 11-15 of the maintainer's
            // one-indexed viewer: 0-based 10-14.
            const rude = pick(rudeGreetingText(table, seed));
            expect(rude).toBeGreaterThanOrEqual(10);
            expect(rude).toBeLessThan(15);
            expect(assistRefusedText(table, seed))
                .toBe(assistRefusedText(table, seed));
        }
    });
    it('falls back to the pinned literals with no table', () => {
        expect(assistRefusedText(undefined)).toBe("I'd rather not.");
        expect(justAnEscortText(undefined))
            .toBe("Sorry sir, I'm just an escort.");
        expect(assistForPayText(undefined))
            .toBe("All right, I'll give you some help, but it'll cost you.");
        expect(assistPaidText(undefined)).toBe("Okay, I'm on my way.");
        expect(rudeGreetingText(undefined)).toBe('What is it you want?');
    });
});

describe('assistIsFree', () => {
    it('is free for Roadside Assistance govts', () => {
        expect(assistIsFree(withFlags2({ roadsideAssistance: true })))
            .toBe(true);
    });
    it('is not (yet) free otherwise', () => {
        expect(assistIsFree(govt())).toBe(false);
        expect(assistIsFree(undefined)).toBe(false);
    });
});

describe('planetTakesBribes', () => {
    it('honors planetsTakeBribes and largerBribes', () => {
        expect(planetTakesBribes(withFlags({ planetsTakeBribes: true })))
            .toBe(true);
        expect(planetTakesBribes(withFlags({ largerBribes: true }))).toBe(true);
        expect(planetTakesBribes(govt())).toBe(false);
        expect(planetTakesBribes(undefined)).toBe(false);
    });
});

describe('greetingText', () => {
    const greetings = ['Alpha', 'Bravo', 'Charlie'];
    it('prefers a pers CommQuote over a govt greeting', () => {
        expect(greetingText({ persCommQuote: 'Hello there!',
            govtGreetings: greetings, govtCommName: 'Fed', talkative: true }))
            .toBe('Hello there!');
    });
    it('picks a real govt greeting when there is no pers quote', () => {
        // seed 4 % 3 = 1 -> the second greeting.
        expect(greetingText({ govtGreetings: greetings, seed: 4,
            talkative: true })).toBe('Bravo');
    });
    it('picks the govt greeting deterministically by seed', () => {
        // Same seed -> same line every time (no Math.random).
        const first = greetingText({ govtGreetings: greetings, seed: 7,
            talkative: true });
        const again = greetingText({ govtGreetings: greetings, seed: 7,
            talkative: true });
        expect(first).toBe(again);
        expect(greetings).toContain(first);
        // A different seed can select a different line (8 % 3 = 2).
        expect(greetingText({ govtGreetings: greetings, seed: 8,
            talkative: true })).toBe('Charlie');
    });
    it('falls back to a synthetic line with no greeting resource', () => {
        expect(greetingText({ govtGreetings: [], govtCommName: 'the Federation',
            talkative: true })).toContain('the Federation');
    });
    it('is empty when the govt is not talkative', () => {
        expect(greetingText({ persCommQuote: 'Hi', talkative: false }))
            .toBe('');
    });
});

describe('hashString', () => {
    it('is stable and deterministic for the same input', () => {
        expect(hashString('abc')).toBe(hashString('abc'));
    });
    it('produces an unsigned 32-bit integer', () => {
        const h = hashString('some-ship-uuid');
        expect(h).toBeGreaterThanOrEqual(0);
        expect(h).toBeLessThanOrEqual(0xffffffff);
        expect(Number.isInteger(h)).toBeTrue();
    });
    it('differs for different inputs (no trivial collisions)', () => {
        expect(hashString('uuid-a')).not.toBe(hashString('uuid-b'));
    });
});

describe('shipIsFighting', () => {
    it('is true for an NPC in attack mode with a target', () => {
        expect(shipIsFighting({ npcMode: 'attack', npcTarget: 'someone' }))
            .toBeTrue();
    });

    it('is false for attack mode with nothing targeted', () => {
        // NpcFireControl needs both before it fires a shot, so both are
        // required here: no target means nothing is being shot at.
        expect(shipIsFighting({ npcMode: 'attack', npcTarget: undefined }))
            .toBeFalse();
    });

    it('is false for the peaceful modes, even with a target', () => {
        for (const mode of ['travel', 'dwell', 'patrol', 'depart', undefined]) {
            expect(shipIsFighting({ npcMode: mode, npcTarget: 'someone' }))
                .withContext(`mode ${mode}`).toBeFalse();
        }
    });

    it('is false for a FLEEING ship', () => {
        // Running away is not shooting, and a fleeing ship talked into a
        // rendezvous was never the complaint.
        expect(shipIsFighting({ npcMode: 'flee', npcTarget: 'someone' }))
            .toBeFalse();
    });

    it('is true for the legacy shoot-all-weapons dev enemy', () => {
        expect(shipIsFighting({
            npcMode: undefined, npcTarget: undefined, shootsAllWeapons: true,
        })).toBeTrue();
    });

    it('is false for a ship with no NPC brain at all', () => {
        expect(shipIsFighting({ npcMode: undefined, npcTarget: undefined }))
            .toBeFalse();
    });
});

describe('busyResponseText', () => {
    // The stock table's busy group (STR# 3000 indices 80-84) as it reads in
    // the real game data; string_table_integration_test pins that.
    const table: string[] = [];
    table[BUSY_RESPONSE_FIRST_INDEX] = "I'm busy.";
    table[BUSY_RESPONSE_FIRST_INDEX + 1] = "I'm a little busy right now.";
    table[BUSY_RESPONSE_FIRST_INDEX + 2] = "I'm too busy to help you.";
    table[BUSY_RESPONSE_FIRST_INDEX + 3] = 'I have other business.';
    table[BUSY_RESPONSE_FIRST_INDEX + 4] = "I've got other things to do.";

    it('picks a line from the busy group', () => {
        const line = busyResponseText(table, 12345);
        expect(table.slice(BUSY_RESPONSE_FIRST_INDEX,
            BUSY_RESPONSE_FIRST_INDEX + BUSY_RESPONSE_COUNT))
            .toContain(line);
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(busyResponseText(table, seed))
                .toBe(busyResponseText(table, seed));
        }
    });

    it('spreads across the whole group as the seed varies', () => {
        const seen = new Set<string>();
        for (let seed = 0; seed < BUSY_RESPONSE_COUNT; seed++) {
            seen.add(busyResponseText(table, seed));
        }
        expect(seen.size).toBe(BUSY_RESPONSE_COUNT);
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(busyResponseText(undefined)).toBe(BUSY_RESPONSE_FALLBACK);
        expect(busyResponseText([])).toBe(BUSY_RESPONSE_FALLBACK);
    });

    it('skips blank entries rather than answering with an empty line', () => {
        const sparse: string[] = [];
        sparse[BUSY_RESPONSE_FIRST_INDEX] = '  ';
        sparse[BUSY_RESPONSE_FIRST_INDEX + 1] = 'I have other business.';
        for (const seed of [0, 1, 2, 3, 4]) {
            expect(busyResponseText(sparse, seed))
                .toBe('I have other business.');
        }
    });
});

describe('noNeedResponseText', () => {
    // STR# 3000 indices 70-74, the group the original answers a pointless
    // assistance request with (string_table_integration_test pins the data).
    const table: string[] = [];
    table[NO_NEED_RESPONSE_FIRST_INDEX] = "You're not in any trouble.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 1] = "You're in no danger.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 2] = "You don't have any problems.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 3] =
        "It looks like you're sitting pretty from here.  Try helping yourself.";
    table[NO_NEED_RESPONSE_FIRST_INDEX + 4] =
        "There's no danger to you right now.";

    it('picks a line from the no-need group', () => {
        expect(table.slice(NO_NEED_RESPONSE_FIRST_INDEX,
            NO_NEED_RESPONSE_FIRST_INDEX + NO_NEED_RESPONSE_COUNT))
            .toContain(noNeedResponseText(table, 4242));
    });

    it('never answers with a BUSY line (the neighbouring group)', () => {
        const both = [...table];
        both[BUSY_RESPONSE_FIRST_INDEX] = "I'm busy.";
        for (let seed = 0; seed < NO_NEED_RESPONSE_COUNT; seed++) {
            expect(noNeedResponseText(both, seed)).not.toBe("I'm busy.");
        }
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(noNeedResponseText(table, seed))
                .toBe(noNeedResponseText(table, seed));
        }
    });

    it('spreads across the whole group as the seed varies', () => {
        const seen = new Set<string>();
        for (let seed = 0; seed < NO_NEED_RESPONSE_COUNT; seed++) {
            seen.add(noNeedResponseText(table, seed));
        }
        expect(seen.size).toBe(NO_NEED_RESPONSE_COUNT);
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(noNeedResponseText(undefined)).toBe(NO_NEED_RESPONSE_FALLBACK);
        expect(noNeedResponseText([])).toBe(NO_NEED_RESPONSE_FALLBACK);
    });
});

describe('hostileResponseText', () => {
    // STR# 3000 indices 10-14 — what a hostile ship answers a hail with
    // ("What is it?" on hail/hail_hostile.png). A GLOBAL table: the per-govt
    // STR# 7000+ resources hold only friendly greetings.
    const table: string[] = [];
    table[HOSTILE_RESPONSE_FIRST_INDEX] = 'What is it you want?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 1] = 'What do you want?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 2] = 'What is it?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 3] = 'What is it?';
    table[HOSTILE_RESPONSE_FIRST_INDEX + 4] = 'What?';

    it('picks a line from the hostile group', () => {
        expect(table.slice(HOSTILE_RESPONSE_FIRST_INDEX,
            HOSTILE_RESPONSE_FIRST_INDEX + HOSTILE_RESPONSE_COUNT))
            .toContain(hostileResponseText(table, 987));
    });

    it('never answers with a friendly greeting (the group at 20-24)', () => {
        const both = [...table];
        both[20] = 'What can I do for you?';
        for (let seed = 0; seed < HOSTILE_RESPONSE_COUNT; seed++) {
            expect(hostileResponseText(both, seed))
                .not.toBe('What can I do for you?');
        }
    });

    it('is deterministic in the seed (no PRNG, same on every peer)', () => {
        for (const seed of [0, 1, 2, 3, 4, 99, 123456]) {
            expect(hostileResponseText(table, seed))
                .toBe(hostileResponseText(table, seed));
        }
    });

    it('falls back to the pinned literal with no usable table', () => {
        expect(hostileResponseText(undefined))
            .toBe(HOSTILE_RESPONSE_FALLBACK);
        expect(hostileResponseText([])).toBe(HOSTILE_RESPONSE_FALLBACK);
    });
});
