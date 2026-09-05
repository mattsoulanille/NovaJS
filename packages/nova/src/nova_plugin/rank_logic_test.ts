import 'jasmine';
import {
    getDefaultRankData, RankData,
} from 'novadatainterface/rank_data';
import { makeControlBitHooks, runNCBSet } from './ncb.js';
import {
    activateRank,
    activeRankData,
    deactivateRank,
    mostRecentlyActivatedRank,
    rankConversationName,
    rankConversationNamesForGovt,
    resetMostRecentlyActivatedRank,
    revokeRanksForCrime,
    rankContribute,
    rankPriceMod,
    rankSalaryPerDay,
    ranksAllowAssistance,
    ranksAllowLanding,
    ranksGiveFreeRepair,
    ranksSuppressAggression,
    suppressAggressionGovts,
} from './rank_logic.js';

/**
 * A rank. `flags` names the Bible's Flags bits directly, so each spec reads
 * like the table it is pinning.
 */
function rank(id: string, over: {
    weight?: number, govt?: string | null, flags?: number,
    contribute?: string, priceMod?: number, salary?: number,
    salaryCap?: number, convName?: string, shortName?: string, name?: string,
} = {}): RankData {
    const flags = over.flags ?? 0;
    return {
        ...getDefaultRankData(),
        id,
        name: over.name ?? id,
        weight: over.weight ?? 0,
        affilGovt: over.govt === undefined ? 'nova:128' : over.govt,
        contribute: over.contribute ?? '0',
        priceMod: over.priceMod ?? 100,
        salary: over.salary ?? 0,
        salaryCap: over.salaryCap ?? 0,
        flags,
        convName: over.convName ?? '',
        shortName: over.shortName ?? '',
        rankFlags: {
            dropOtherRanksWhenActivated: !!(flags & 0x0001),
            dropOtherRanksWhenDeactivated: !!(flags & 0x0002),
            dropIfDestroyGovtOrAllyShip: !!(flags & 0x0004),
            permanent: !!(flags & 0x0008),
            dropLowerRanksWhenActivated: !!(flags & 0x0010),
            dropLowerRanksWhenDeactivated: !!(flags & 0x0020),
            dropIfCrimeAgainstGovt: !!(flags & 0x0040),
            govtShipsWontAttack: !!(flags & 0x0100),
            canAlwaysLandOnGovtStellars: !!(flags & 0x0200),
            canRequestBattleAssistance: !!(flags & 0x0400),
            freeRefuelAndRepair: !!(flags & 0x0800),
        },
    };
}

function lookup(...ranks: RankData[]) {
    const byId = new Map(ranks.map(r => [r.id, r]));
    return (id: string) => byId.get(id);
}

describe('rank activation and deactivation', () => {
    it('activates and deactivates a plain rank', () => {
        const get = lookup(rank('nova:128'));
        const active = new Set<string>();
        activateRank(active, 'nova:128', get);
        expect([...active]).toEqual(['nova:128']);
        deactivateRank(active, 'nova:128', get);
        expect([...active]).toEqual([]);
    });

    it('records a rank this build cannot resolve rather than losing it', () => {
        // A plug-in's rank granted by a set string whose data is absent must
        // survive in the player's state (and so into their save).
        const active = new Set<string>();
        activateRank(active, 'someplugin:400', () => undefined);
        expect([...active]).toEqual(['someplugin:400']);
    });

    // 0x0008 "Rank is permanent and cannot be deactivated except if
    // explicitly done by a control bit eval string".
    it('lets an explicit deactivation drop even a PERMANENT rank', () => {
        const get = lookup(rank('nova:147', { flags: 0x0208 }));
        const active = new Set(['nova:147']);
        deactivateRank(active, 'nova:147', get);
        expect([...active]).toEqual([]);
    });
});

describe('the rank deactivation cascades', () => {
    // 0x0001 "Deactivate all other active ranks affiliated with this same
    // govt when this rank is activated (excludes permanent ranks)".
    it('0x0001 drops the same govt\'s other ranks on activation, sparing '
        + 'permanent ones and other govts', () => {
            const get = lookup(
                rank('nova:200', { flags: 0x0001 }),
                rank('nova:201'),                       // same govt, droppable
                rank('nova:202', { flags: 0x0008 }),     // permanent: spared
                rank('nova:203', { govt: 'nova:129' }),  // other govt: spared
                rank('nova:204', { govt: null }),        // unaffiliated
            );
            const active = new Set([
                'nova:201', 'nova:202', 'nova:203', 'nova:204']);
            activateRank(active, 'nova:200', get);
            expect([...active].sort()).toEqual(
                ['nova:200', 'nova:202', 'nova:203', 'nova:204']);
        });

    // 0x0010 "... all other active and LOWER-WEIGHTED ranks ...".
    it('0x0010 drops only same-govt ranks of lower weight', () => {
        const get = lookup(
            rank('nova:200', { flags: 0x0010, weight: 5 }),
            rank('nova:201', { weight: 4 }),  // lower: dropped
            rank('nova:202', { weight: 5 }),  // equal: kept
            rank('nova:203', { weight: 9 }),  // higher: kept
        );
        const active = new Set(['nova:201', 'nova:202', 'nova:203']);
        activateRank(active, 'nova:200', get);
        expect([...active].sort()).toEqual(
            ['nova:200', 'nova:202', 'nova:203']);
    });

    // 0x0002 / 0x0020, the deactivation-side twins.
    it('0x0002 drops the same govt\'s other ranks when it is deactivated',
        () => {
            const get = lookup(
                rank('nova:200', { flags: 0x0002 }),
                rank('nova:201'),
                rank('nova:202', { govt: 'nova:129' }));
            const active = new Set(['nova:200', 'nova:201', 'nova:202']);
            deactivateRank(active, 'nova:200', get);
            expect([...active]).toEqual(['nova:202']);
        });

    it('0x0020 drops only the lower-weighted ones on deactivation', () => {
        const get = lookup(
            rank('nova:200', { flags: 0x0020, weight: 5 }),
            rank('nova:201', { weight: 1 }),
            rank('nova:202', { weight: 7 }));
        const active = new Set(['nova:200', 'nova:201', 'nova:202']);
        deactivateRank(active, 'nova:200', get);
        expect([...active]).toEqual(['nova:202']);
    });

    it('does not run the cascades of a rank that was not active', () => {
        const get = lookup(
            rank('nova:200', { flags: 0x0002 }), rank('nova:201'));
        const active = new Set(['nova:201']);
        deactivateRank(active, 'nova:200', get);
        expect([...active]).toEqual(['nova:201']);
    });

    it('does NOT recurse: a cascade-dropped rank does not fire its own '
        + 'cascade', () => {
            // 200 (weight 5, 0x0020) drops only LOWER-weighted same-govt
            // ranks, so it takes 201 (weight 4) and leaves 203 (weight 9).
            // 201 carries 0x0002, which drops ALL other same-govt ranks —
            // if the cascade recursed, 203 would go too. It must not: a
            // cascade is a direct effect of the rank the set string named,
            // not a chain.
            const get = lookup(
                rank('nova:200', { flags: 0x0020, weight: 5 }),
                rank('nova:201', { flags: 0x0002, weight: 4 }),
                rank('nova:203', { weight: 9 }));
            const active = new Set(['nova:200', 'nova:201', 'nova:203']);
            deactivateRank(active, 'nova:200', get);
            expect([...active]).toEqual(['nova:203']);
        });
});

describe('Kxxx / Lxxx through makeControlBitHooks', () => {
    // EVN Bible set-string operators: Kxxx activates rank xxx, Lxxx
    // deactivates it. ncb.ts already parsed them; these are the hooks.
    function hooksFor(active: Set<string>, ...ranks: RankData[]) {
        const get = lookup(...ranks);
        return makeControlBitHooks(new Set<number>(), undefined, {
            active, resolveId: id => `nova:${id}`, getRank: get,
        });
    }

    it('K147 activates ränk nova:147 and L147 deactivates it', () => {
        const active = new Set<string>();
        const hooks = hooksFor(active, rank('nova:147', { flags: 0x0208 }));
        runNCBSet('k147', hooks, () => 0);
        expect([...active]).toEqual(['nova:147']);
        runNCBSet('l147', hooks, () => 0);
        expect([...active]).toEqual([]);
    });

    it('runs the whole Sigma4 OnAccept string, granting the hypergate rank',
        () => {
            // mïsn nova:898 "Deliver New Hypergate Code;Sigma4": `k147 S899
            // S900`. The mission operators have no hooks here, so only the
            // rank op takes effect - which is exactly the point being pinned.
            const active = new Set<string>();
            const bits = new Set<number>();
            const hooks = makeControlBitHooks(bits, undefined, {
                active, resolveId: id => `nova:${id}`,
                getRank: lookup(rank('nova:147', { flags: 0x0208 })),
            });
            runNCBSet('k147 S899 S900', hooks, () => 0);
            expect(active.has('nova:147')).toBeTrue();
        });

    it('scopes the numeric id to the running resource\'s plug-in', () => {
        const active = new Set<string>();
        const hooks = makeControlBitHooks(new Set<number>(), undefined, {
            active, resolveId: id => `someplugin:${id}`,
            getRank: () => undefined,
        });
        runNCBSet('K147', hooks, () => 0);
        expect([...active]).toEqual(['someplugin:147']);
    });

    it('runs the activation cascades through the hook', () => {
        const active = new Set(['nova:201']);
        const hooks = hooksFor(active,
            rank('nova:200', { flags: 0x0001 }), rank('nova:201'));
        runNCBSet('k200', hooks, () => 0);
        expect([...active]).toEqual(['nova:200']);
    });

    it('leaves Kxxx an unimplemented hook when no rank state is supplied',
        () => {
            // The pre-rank behaviour, still what a bare caller gets.
            const hooks = makeControlBitHooks(new Set<number>());
            expect(hooks.activateRank).toBeUndefined();
            expect(hooks.deactivateRank).toBeUndefined();
        });
});

describe('rank privileges', () => {
    const gate = rank('nova:147',
        { govt: 'nova:183', flags: 0x0208, name: 'Hypergate Access' });

    it('0x0200 answers only for the affiliated govt', () => {
        const get = lookup(gate);
        const active = new Set(['nova:147']);
        expect(ranksAllowLanding(active, get, 'nova:183')).toBeTrue();
        expect(ranksAllowLanding(active, get, 'nova:128')).toBeFalse();
        // An independent stellar has no govt to be affiliated with.
        expect(ranksAllowLanding(active, get, null)).toBeFalse();
        expect(ranksAllowLanding(undefined, get, 'nova:183')).toBeFalse();
    });

    it('0x0100 / 0x0400 / 0x0800 each answer for their own bit', () => {
        const get = lookup(
            rank('nova:300', { flags: 0x0100 }),
            rank('nova:301', { flags: 0x0400 }),
            rank('nova:302', { flags: 0x0800 }));
        expect(ranksSuppressAggression(
            suppressAggressionGovts(new Set(['nova:300']), get),
            'nova:128')).toBeTrue();
        expect(ranksSuppressAggression(
            suppressAggressionGovts(new Set(['nova:301']), get),
            'nova:128')).toBeFalse();
        expect(ranksAllowAssistance(
            new Set(['nova:301']), get, 'nova:128')).toBeTrue();
        expect(ranksGiveFreeRepair(
            new Set(['nova:302']), get, 'nova:128')).toBeTrue();
        expect(ranksGiveFreeRepair(
            new Set(['nova:300']), get, 'nova:128')).toBeFalse();
    });

    it('unions the active ranks\' Contribute sets', () => {
        const get = lookup(
            rank('nova:300', { contribute: '5' }),   // 0b101
            rank('nova:301', { contribute: '2' }),   // 0b010
            rank('nova:302', { contribute: 'junk' }));
        expect(rankContribute(new Set(['nova:300', 'nova:301']), get))
            .toEqual(0b111n);
        // Garbage contributes nothing rather than throwing.
        expect(rankContribute(new Set(['nova:302']), get)).toEqual(0n);
        expect(rankContribute(undefined, get)).toEqual(0n);
    });

    it('sorts the active ranks by weight, highest first, ties by id', () => {
        const get = lookup(
            rank('nova:300', { weight: 1 }),
            rank('nova:301', { weight: 30 }),
            rank('nova:302', { weight: 30 }));
        expect(activeRankData(
            new Set(['nova:300', 'nova:302', 'nova:301']), get)
            .map(r => r.id)).toEqual(['nova:301', 'nova:302', 'nova:300']);
    });

    it('takes <PRK>/<PSR> from the highest-weight rank that HAS the text',
        () => {
            const get = lookup(
                rank('nova:300', { weight: 30 }),  // no ConvName: skipped
                rank('nova:301',
                    { weight: 5, convName: 'Space Marshall',
                        shortName: 'Marshall' }));
            const active = new Set(['nova:300', 'nova:301']);
            expect(rankConversationName(active, get, false))
                .toBe('Space Marshall');
            expect(rankConversationName(active, get, true)).toBe('Marshall');
            // Nothing to say: the caller falls back to "captain".
            expect(rankConversationName(new Set(['nova:300']), get, false))
                .toBeUndefined();
        });

    it('answers <PRKnnn>/<SRKnnn> for one government only (#110)', () => {
        const get = lookup(
            rank('nova:300', { weight: 30, govt: 'nova:141',
                convName: 'Rebel Colonel', shortName: 'Colonel' }),
            rank('nova:301', { weight: 5, govt: 'nova:128',
                convName: 'Federation Ambassador' }),
            rank('nova:302', { weight: 1, govt: 'nova:128',
                shortName: 'Ambassador' }));
        const active = new Set(['nova:300', 'nova:301', 'nova:302']);
        // The Federation's highest-weight rank has no ShortName; the
        // lower one supplies it, exactly as <PRK>/<SRK> fall through.
        expect(rankConversationNamesForGovt(active, get, 'nova:128'))
            .toEqual({ convName: 'Federation Ambassador',
                shortName: 'Ambassador' });
        expect(rankConversationNamesForGovt(active, get, 'nova:141'))
            .toEqual({ convName: 'Rebel Colonel', shortName: 'Colonel' });
        expect(rankConversationNamesForGovt(active, get, 'nova:129'))
            .toBeUndefined();
        expect(rankConversationNamesForGovt(active, get, undefined))
            .toBeUndefined();
    });

    it('remembers the most recently activated rank for <RRK>, session-'
        + 'locally', () => {
            resetMostRecentlyActivatedRank();
            expect(mostRecentlyActivatedRank()).toBeUndefined();
            const get = lookup(rank('nova:300'), rank('nova:301'));
            const active = new Set<string>();
            activateRank(active, 'nova:300', get);
            expect(mostRecentlyActivatedRank()).toBe('nova:300');
            activateRank(active, 'nova:301', get);
            expect(mostRecentlyActivatedRank()).toBe('nova:301');
            // Deactivation does not move the pointer.
            deactivateRank(active, 'nova:301', get);
            expect(mostRecentlyActivatedRank()).toBe('nova:301');
            resetMostRecentlyActivatedRank();
        });

    it('leaves prices unchanged with no affiliated rank active', () => {
        const get = lookup(rank('nova:300', { priceMod: 50 }));
        expect(rankPriceMod(undefined, get, 'nova:128')).toBe(100);
        expect(rankPriceMod(new Set(), get, 'nova:128')).toBe(100);
        // PriceMod 100 is the Bible's own "prices are unchanged".
        const plain = lookup(rank('nova:301', { priceMod: 100 }));
        expect(rankPriceMod(new Set(['nova:301']), plain, 'nova:128'))
            .toBe(100);
    });

    it('applies an affiliated rank\'s PriceMod only at that govt\'s '
        + 'stellars', () => {
            const get = lookup(
                rank('nova:300', { priceMod: 50 }),
                rank('nova:303', { priceMod: 10, govt: 'nova:129' }));
            expect(rankPriceMod(new Set(['nova:300']), get, 'nova:128'))
                .toBe(50);
            // A rank of a different govt does not discount this one's ports,
            // and "owned by the affiliated government" means owned, so a
            // stellar with no govt at all is never discounted.
            expect(rankPriceMod(new Set(['nova:303']), get, 'nova:128'))
                .toBe(100);
            expect(rankPriceMod(new Set(['nova:300']), get, null)).toBe(100);
            expect(rankPriceMod(new Set(['nova:300']), get, undefined))
                .toBe(100);
            // An unaffiliated rank (AffilGovt -1) has no stellars at all.
            const loose = lookup(rank('nova:304', { priceMod: 1, govt: null }));
            expect(rankPriceMod(new Set(['nova:304']), loose, 'nova:128'))
                .toBe(100);
        });

    it('reads PriceMod 0 as UNUSED rather than free', () => {
        // Ten stock ranks (145-147, 151-158) leave PriceMod at 0 while
        // carrying real privileges; so do Extra Outfits' 162 and 177.
        const get = lookup(rank('nova:302', { priceMod: 0 }));
        expect(rankPriceMod(new Set(['nova:302']), get, 'nova:128'))
            .toBe(100);
    });

    it('COMPOUNDS the PriceMods of several affiliated ranks', () => {
        const get = lookup(
            rank('nova:300', { priceMod: 50 }),
            rank('nova:301', { priceMod: 50 }),
            rank('nova:302', { priceMod: 0 }),
            rank('nova:303', { priceMod: 10, govt: 'nova:129' }));
        // Two halves make a quarter, not a half.
        expect(rankPriceMod(
            new Set(['nova:300', 'nova:301']), get, 'nova:128')).toBe(25);
        // The unused one (0) and the other govt's contribute nothing.
        expect(rankPriceMod(
            new Set(['nova:300', 'nova:301', 'nova:302', 'nova:303']),
            get, 'nova:128')).toBe(25);
    });

    it('compounds Extra Outfits\' four PriceMod-1 Spica ranks down to '
        + 'free', () => {
            // ränk extra-outfits:168-171: empty resources whose only content
            // is AffilGovt extra-outfits:302 (the Spica Shipyard's own govt)
            // and PriceMod 1. Four of them is exactly what it takes to floor
            // the plug-in's dearest hull (the 12,000,000 cr Leviathan) to 0.
            const spica = lookup(
                rank('extra:168', { priceMod: 1, govt: 'extra:302' }),
                rank('extra:169', { priceMod: 1, govt: 'extra:302' }),
                rank('extra:170', { priceMod: 1, govt: 'extra:302' }),
                rank('extra:171', { priceMod: 1, govt: 'extra:302' }));
            const all = new Set(
                ['extra:168', 'extra:169', 'extra:170', 'extra:171']);
            const mod = rankPriceMod(all, spica, 'extra:302');
            expect(mod).toBeCloseTo(1e-6, 12);
            expect(Math.floor(12_000_000 * mod / 100)).toBe(0);
            // Three would NOT be free — 12 cr, and a 1 cr hire fee.
            const three = rankPriceMod(
                new Set(['extra:168', 'extra:169', 'extra:170']),
                spica, 'extra:302');
            expect(Math.floor(12_000_000 * three / 100)).toBe(12);
        });

    it('pays Salary per day and stops at SalaryCap (0 meaning uncapped)',
        () => {
            const get = lookup(
                rank('nova:300', { salary: 200 }),
                rank('nova:301', { salary: 350, salaryCap: 350_000 }));
            const both = new Set(['nova:300', 'nova:301']);
            expect(rankSalaryPerDay(both, get, 0)).toBe(550);
            // Over the cap, only the uncapped rank still pays.
            expect(rankSalaryPerDay(both, get, 350_000)).toBe(200);
            expect(rankSalaryPerDay(both, get, 400_000)).toBe(200);
            expect(rankSalaryPerDay(undefined, get, 0)).toBe(0);
        });
});

/**
 * The crime revocations, ränk Flags 0x0004 "Deactivate this rank if
 * player destroys or disables a ship of the affiliated government or its
 * allies" and 0x0040 "Deactivate this rank if the player commits any
 * crime against the affiliated government" (EVN Bible). Stock's cover
 * ranks — nova:148 "; Rebel 1" (0x144), nova:150 "; Nil'kemorya 1"
 * (0x144), the duel protectors nova:153-158 (0x140) — exist for these
 * bits alone (#56).
 */
describe('revokeRanksForCrime (ränk Flags 0x0004 / 0x0040)', () => {
    const REBELLION = { id: 'nova:141', classes: [10] };
    const REBEL_ALLY = { id: 'nova:300', classes: [7] };
    const FEDERATION = { id: 'nova:128', classes: [1] };
    // The Rebellion's allies are classes 7, 16, 13 and 11 (stock).
    const getGovt = (id: string) =>
        id === 'nova:141' ? { allies: [7, 16, 13, 11] } : undefined;

    it('drops a 0x0040 cover on ANY crime against its own govt, and on '
        + 'nothing else', () => {
            const get = lookup(rank('nova:148', { govt: 'nova:141',
                flags: 0x140 }));
            for (const crime of ['kill', 'disable', 'board'] as const) {
                const active = new Set(['nova:148']);
                expect(revokeRanksForCrime(active, REBELLION, crime, get,
                    getGovt)).toEqual(['nova:148']);
                expect(active.size).toBe(0);
            }
            // An ally's ship, or an unrelated govt's, is no crime against
            // the Rebellion.
            const active = new Set(['nova:148']);
            expect(revokeRanksForCrime(active, REBEL_ALLY, 'kill', get,
                getGovt)).toEqual([]);
            expect(revokeRanksForCrime(active, FEDERATION, 'kill', get,
                getGovt)).toEqual([]);
            expect(active.has('nova:148')).toBe(true);
        });

    it('drops a 0x0004 rank on destroying or disabling a ship of the '
        + 'govt OR ITS ALLIES, but not on boarding one', () => {
            const get = lookup(rank('nova:150', { govt: 'nova:141',
                flags: 0x004 }));
            let active = new Set(['nova:150']);
            expect(revokeRanksForCrime(active, REBEL_ALLY, 'disable', get,
                getGovt)).toEqual(['nova:150']);
            active = new Set(['nova:150']);
            expect(revokeRanksForCrime(active, REBELLION, 'kill', get,
                getGovt)).toEqual(['nova:150']);
            active = new Set(['nova:150']);
            expect(revokeRanksForCrime(active, REBELLION, 'board', get,
                getGovt)).toEqual([]);
            expect(revokeRanksForCrime(active, FEDERATION, 'kill', get,
                getGovt)).toEqual([]);
            expect(active.has('nova:150')).toBe(true);
        });

    it('spares a PERMANENT rank and one with no affiliated govt', () => {
        const get = lookup(
            rank('nova:400', { govt: 'nova:141', flags: 0x044 | 0x008 }),
            rank('nova:401', { govt: null, flags: 0x044 }));
        const active = new Set(['nova:400', 'nova:401']);
        expect(revokeRanksForCrime(active, REBELLION, 'kill', get, getGovt))
            .toEqual([]);
        expect(active.size).toBe(2);
    });

    it('runs the revoked rank\'s own deactivation cascade, like an Lxxx',
        () => {
            const get = lookup(
                // 0x0040 with 0x0002: dropping it drops its govt-mates.
                rank('nova:148', { govt: 'nova:141', flags: 0x042 }),
                rank('nova:149', { govt: 'nova:141' }));
            const active = new Set(['nova:148', 'nova:149']);
            expect(revokeRanksForCrime(active, REBELLION, 'kill', get,
                getGovt)).toEqual(['nova:148']);
            expect(active.size).toBe(0);
        });

    it('re-bakes the 0x0100 suppression set without the fallen cover',
        () => {
            const get = lookup(rank('nova:148', { govt: 'nova:141',
                flags: 0x144 }));
            const active = new Set(['nova:148']);
            expect(suppressAggressionGovts(active, get))
                .toEqual(new Set(['nova:141']));
            revokeRanksForCrime(active, REBELLION, 'kill', get, getGovt);
            expect(suppressAggressionGovts(active, get)).toEqual(new Set());
        });
});
