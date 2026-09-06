import { GovtData, getDefaultGovtData } from 'novadatainterface/govt_data';
import {
    assistIsFree,
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
            'neutral', 3)).toEqual({ kind: 'cantHail' });
    });
    it('hostile ship offers a bribe when the govt bargains', () => {
        expect(shipHailResponse(withFlags({ warshipsTakeBribes: true }),
            'hostile', 3)).toEqual({ kind: 'hostile', canBribe: true });
    });
    it('hostile ship of a non-bribing govt offers no bribe', () => {
        expect(shipHailResponse(govt(), 'hostile', 3))
            .toEqual({ kind: 'hostile', canBribe: false });
    });
    it('noAssistOrMercy suppresses the bribe option even for a bribing govt',
        () => {
            const g = withFlags({ warshipsTakeBribes: true });
            g.flags2 = { ...g.flags2, noAssistOrMercy: true };
            expect(shipHailResponse(g, 'hostile', 3))
                .toEqual({ kind: 'hostile', canBribe: false });
        });
    it('friendly / neutral ships greet and are talkative by default', () => {
        expect(shipHailResponse(govt(), 'friendly', 3))
            .toEqual({ kind: 'greeting', talkative: true });
        expect(shipHailResponse(govt(), 'neutral', 1))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('noDistressMessages govts answer but are not talkative', () => {
        expect(shipHailResponse(withFlags2({ noDistressMessages: true }),
            'neutral', 3)).toEqual({ kind: 'greeting', talkative: false });
    });
    it('a govt-less ship greets talkatively', () => {
        expect(shipHailResponse(undefined, 'neutral', undefined))
            .toEqual({ kind: 'greeting', talkative: true });
    });
    it('a neutral-govt ship ATTACKING the player answers with hostility', () => {
        // Behavioral hostility: a ship the player provoked is hostile in the
        // dialog regardless of its politics, and a bribing govt still bargains.
        expect(shipHailResponse(withFlags({ warshipsTakeBribes: true }),
            'neutral', 3, /*attackingPlayer=*/true))
            .toEqual({ kind: 'hostile', canBribe: true });
        expect(shipHailResponse(govt(), 'neutral', 3, true))
            .toEqual({ kind: 'hostile', canBribe: false });
    });
    it('a cantBeHailed ship stays silent even while attacking the player',
        () => {
            expect(shipHailResponse(withFlags({ cantBeHailed: true }),
                'neutral', 3, true)).toEqual({ kind: 'cantHail' });
        });
});

describe('canRequestAssistance', () => {
    it('is OFFERED even when the player needs no help at all', () => {
        // Matthew: "it should show request assistance even if there's no
        // reason for you to request it (they usually just tell you that you
        // don't need help)." The offer is about who you are talking to, not
        // about your hull — the ANSWER is where the need is judged.
        expect(canRequestAssistance({ disposition: 'neutral', govt: govt() }))
            .toBe(true);
        expect(canRequestAssistance({ disposition: 'friendly', govt: govt() }))
            .toBe(true);
    });
    it('is refused by hostile ships', () => {
        expect(canRequestAssistance({ disposition: 'hostile', govt: govt() }))
            .toBe(false);
    });
    it('is refused by noAssistOrMercy / cantBeHailed govts', () => {
        expect(canRequestAssistance({ disposition: 'neutral',
            govt: withFlags2({ noAssistOrMercy: true }) })).toBe(false);
        expect(canRequestAssistance({ disposition: 'friendly',
            govt: withFlags({ cantBeHailed: true }) })).toBe(false);
    });
    it('is allowed for Roadside Assistance govts', () => {
        expect(canRequestAssistance({ disposition: 'neutral',
            govt: withFlags2({ roadsideAssistance: true }) })).toBe(true);
    });
    it('is refused by a neutral-govt ship attacking the player', () => {
        // The assistance exploit: a neutral warship shooting a disabled player
        // must not also offer to fly over and repair them.
        expect(canRequestAssistance({ disposition: 'neutral', govt: govt(),
            attackingPlayer: true })).toBe(false);
        // Even a Roadside-Assistance govt refuses while attacking.
        expect(canRequestAssistance({ disposition: 'neutral',
            govt: withFlags2({ roadsideAssistance: true }),
            attackingPlayer: true })).toBe(false);
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
