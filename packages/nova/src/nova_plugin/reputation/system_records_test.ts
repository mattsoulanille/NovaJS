import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { LegalRecords } from './reputation.js';
import {
    applyCompletionReward, applyCrime, applyGovtRecordChange, cleanRecords,
    crimeRecordChange, initialRecordsFromGovtStatuses, LawSystem,
    LegalGeography, scaledPenalty, systemRecordsFromGovtRecords,
} from './system_records.js';

/**
 * The per-system legal records (ruling #380) against the reference
 * measurements, on hand-built kit geographies that copy the reference rigs'
 * gövt penalties, alliances and sÿst links (docs/reference_experiments.md,
 * the A14 sections of waves 12-15). Every number pinned here was read back
 * from an original pilot file.
 */

let nextClass = 1000;
function govt(id: string, fields: {
    disab?: number, board?: number, kill?: number, allies?: string[],
    enemies?: string[], initialRecord?: number, xenophobic?: boolean,
    classes?: number[],
} = {}): GovtData {
    const base = getDefaultGovtData();
    return {
        ...base, id,
        disablePenalty: fields.disab ?? 0,
        boardPenalty: fields.board ?? 0,
        killPenalty: fields.kill ?? 0,
        initialRecord: fields.initialRecord ?? 0,
        classes: fields.classes ?? [CLASS_OF(id)],
        allies: (fields.allies ?? []).map(CLASS_OF),
        enemies: (fields.enemies ?? []).map(CLASS_OF),
        flags: { ...base.flags, xenophobic: fields.xenophobic ?? false },
    };
}
const classes = new Map<string, number>();
function CLASS_OF(id: string): number {
    let c = classes.get(id);
    if (c === undefined) {
        c = nextClass++;
        classes.set(id, c);
    }
    return c;
}

function sys(id: string, govtId: string | null, links: string[],
    position: [number, number]): LawSystem {
    return { id, govt: govtId, links, position };
}

/** The records as a plain object, for whole-map comparisons. */
function asObject(records: LegalRecords): Record<string, number> {
    return Object.fromEntries(records);
}

// --- The wave-14 / wave-15 spread rig ("A14 spread, wave 14", "A14 /
// contraband wave 15"), and wave 13's Kit Odd systems as wave 15 found
// them: stacked on 1510's and 1511's map positions.
const FED = govt('nova:128', { disab: 1, board: 2, kill: 5 });
const OWNER = govt('k:338', {
    disab: 2, board: 2, kill: 8000, allies: ['k:337'], enemies: ['k:336'],
});
const ALLY = govt('k:337', { disab: 40, board: 2, kill: 60 });
const ENEMY = govt('k:336', { disab: 70, board: 2, kill: 140 });
const VICTIM = govt('k:350', { disab: 30, board: 5, kill: 100 });
const ODD = govt('k:345', { disab: 11, board: 3, kill: 25 });
const NEUTRAL = govt('k:363', { disab: 50, board: 50, kill: 100 });
const LIFE = govt('k:346', { disab: 50, board: 50, kill: 100 });
const PEN_OWNER = govt('k:335', {
    disab: 2, board: 2, kill: 8000, allies: ['k:334'], enemies: ['k:333'],
});
const PEN_ALLY = govt('k:334', { disab: 40, board: 2, kill: 60 });
const PEN_ENEMY = govt('k:333', { disab: 70, board: 2, kill: 140 });
const GOVTS = [FED, OWNER, ALLY, ENEMY, VICTIM, ODD, NEUTRAL, LIFE,
    PEN_OWNER, PEN_ALLY, PEN_ENEMY];
const govtEntries = (list: GovtData[]) =>
    list.map(g => [g.id, g] as const);

const CHAIN = ['s:2096', 's:2097', 's:2098', 's:2099', 's:2108', 's:2109'];
const SPREAD_SYSTEMS: LawSystem[] = [
    sys('s:2095', OWNER.id,
        ['s:2096', 's:2135', 's:2136', 's:2137', 's:1510'], [0, 0]),
    ...CHAIN.map((id, i) => sys(id, OWNER.id,
        [i === 0 ? 's:2095' : CHAIN[i - 1], ...(CHAIN[i + 1] ? [CHAIN[i + 1]] : [])],
        [40 * (i + 1), 0])),
    sys('s:2135', ALLY.id, ['s:2095'], [0, 40]),
    sys('s:2136', ENEMY.id, ['s:2095'], [0, -40]),
    sys('s:2137', VICTIM.id, ['s:2095'], [-40, -40]),
    // Reached only through a hypergate / a wormhole: no hyperlinks.
    sys('s:2138', OWNER.id, [], [500, 500]),
    sys('s:2139', OWNER.id, [], [-500, 500]),
    // Wave 15: the unowned neighbour and the system beyond it...
    sys('s:1510', null, ['s:2095', 's:1511'], [-40, 0]),
    sys('s:1511', OWNER.id, ['s:1510'], [-80, 0]),
    // ...sitting on wave 13's Kit Life Range and Kit Odd Traffic.
    sys('s:2085', LIFE.id, [], [-40, 0]),
    sys('s:2082', ODD.id, ['s:2083', 's:2084'], [-80, 0]),
    sys('s:2083', ODD.id, ['s:2082', 's:2081'], [-80, 40]),
    sys('s:2084', NEUTRAL.id, ['s:2082'], [-120, 0]),
    sys('s:2081', ODD.id, ['s:2083'], [-80, 80]),
    // The penalty rig.
    sys('s:2158', PEN_OWNER.id, ['s:2159', 's:2050', 's:2051'], [900, 0]),
    sys('s:2159', PEN_OWNER.id, ['s:2158'], [940, 0]),
    sys('s:2050', PEN_ALLY.id, ['s:2158'], [900, 40]),
    sys('s:2051', PEN_ENEMY.id, ['s:2158'], [900, -40]),
];
const SPREAD = new LegalGeography(SPREAD_SYSTEMS, govtEntries(GOVTS));

/** A kill (Disab + Kill) of a `victim` ship in `systemId`. */
function kill(geography: LegalGeography, systemId: string,
    victim: GovtData, records: LegalRecords = new Map()): LegalRecords {
    applyCrime(records, geography, systemId, victim, ['disable', 'kill']);
    return records;
}

describe('per-system legal records: the crime spread (A14 waves 12-15)', () => {
    it('scales each penalty field by 0.65 per jump, truncated', () => {
        expect([0, 1, 2, 3, 4, 5, 6].map(n => scaledPenalty(8000, n)))
            .toEqual([8000, 5200, 3380, 2197, 1428, 928, 603]);
        expect(scaledPenalty(2, 1)).toBe(1);
        expect(scaledPenalty(11, 2)).toBe(4);
        // Truncated toward zero, as C integer arithmetic would.
        expect(scaledPenalty(-100, 1)).toBe(-65);
        expect(scaledPenalty(-1, 1)).toBe(0);
        // Far enough out, every stock-sized field is gone.
        expect(scaledPenalty(32767, 25)).toBe(0);
    });

    it('wave 14: a reward kill spreads +4001 / +2600 ... +301 down the '
        + 'chain, with no cut-off at six jumps', () => {
            const records = kill(SPREAD, 's:2095', VICTIM);
            expect(['s:2095', ...CHAIN].map(id => records.get(id)))
                .toEqual([4001, 2600, 1690, 1098, 714, 464, 301]);
        });

    it('wave 14: allied, enemy and victim neighbours each judge by their '
        + 'OWN owner (+32, +67, -84); gate and wormhole systems get nothing',
        () => {
            const records = kill(SPREAD, 's:2095', VICTIM);
            expect(records.get('s:2135')).toBe(32);
            expect(records.get('s:2136')).toBe(67);
            expect(records.get('s:2137')).toBe(-84);
            expect(records.has('s:2138')).toBeFalse();
            expect(records.has('s:2139')).toBeFalse();
        });

    it('wave 14: a penalty spreads the same way (-8002, -5201; the '
        + 'ally\'s home -5201, the enemy\'s +67)', () => {
            const records = kill(SPREAD, 's:2158', PEN_OWNER);
            expect(asObject(records)).toEqual({
                's:2158': -8002, 's:2159': -5201,
                's:2050': -5201, 's:2051': 67,
            });
        });

    it('wave 15: walks the map by POSITION — systems stacked on a linked '
        + 'system\'s coordinates take its jump count and pass it on', () => {
            const records = kill(SPREAD, 's:2095', VICTIM);
            // 1511, two jumps through the unowned 1510: the normal +1690.
            expect(records.get('s:1511')).toBe(1690);
            // The side finding, to the unit: 2085 +48 (on 1510's spot),
            // 2082 +7 (on 1511's), and on through 2082's own links.
            expect(records.get('s:2085')).toBe(48);
            expect(records.get('s:2082')).toBe(7);
            expect(records.get('s:2083')).toBe(4);
            expect(records.get('s:2084')).toBe(19);
            expect(records.get('s:2081')).toBe(2);
        });

    it('waves 15-16: an UNOWNED neighbour takes minus a quarter of the '
        + 'VICTIM\'s scaled fields (-20; -76 / -49)', () => {
            // Wave 15: victim 350 (30 / 100), one jump: 19 -> 9 -> 4,
            // 65 -> 32 -> 16. Not gövt 128's view: the Federation-like 1 / 5
            // standing in for an owner would have given +1.
            expect(kill(SPREAD, 's:2095', VICTIM).get('s:1510')).toBe(-20);
            // Wave 16: victim 314 (400 / 7 / 70) killed in 1566 (owner
            // 338); 1567 and 1568 unowned, one and two jumps out.
            const odd314 = govt('k:314', { disab: 400, board: 7, kill: 70 });
            const rig = new LegalGeography([
                sys('s:1566', OWNER.id, ['s:1567'], [0, 0]),
                sys('s:1567', null, ['s:1566', 's:1568'], [40, 0]),
                sys('s:1568', null, ['s:1567'], [80, 0]),
            ], govtEntries([...GOVTS, odd314]));
            expect(asObject(kill(rig, 's:1566', odd314))).toEqual({
                's:1566': 4001, 's:1567': -76, 's:1568': -49,
            });
        });

    it('wave 13: Kit Odd Owner +17 / +11 / +7, the neutral neighbour +48',
        () => {
            const odd = new LegalGeography([
                sys('s:2082', ODD.id, ['s:2083', 's:2084'], [0, 0]),
                sys('s:2083', ODD.id, ['s:2082', 's:2081'], [40, 0]),
                sys('s:2084', NEUTRAL.id, ['s:2082'], [-40, 0]),
                sys('s:2081', ODD.id, ['s:2083'], [80, 0]),
            ], govtEntries(GOVTS));
            expect(asObject(kill(odd, 's:2082', VICTIM))).toEqual({
                's:2082': 17, 's:2083': 11, 's:2084': 48, 's:2081': 7,
            });
        });

    it('changes nothing in a system the crime\'s system does not reach',
        () => {
            const records = kill(SPREAD, 's:2158', PEN_OWNER);
            for (const id of ['s:2095', ...CHAIN, 's:1510', 's:2082']) {
                expect(records.has(id)).withContext(id).toBeFalse();
            }
        });

    it('takes the VICTIM\'s penalties from the owner\'s or an ally\'s ship '
        + 'and the OWNER\'s halves from anyone else\'s (wave 12)', () => {
            const owner351 = govt('k:351', { disab: 7, board: 3, kill: 13 });
            const law352 = govt('k:352', {
                disab: 30, board: 5, kill: 100, enemies: ['k:353'],
            });
            const pirate353 = govt('k:353', { disab: 20, board: 5, kill: 40 });
            const ally341 = govt('k:341', { disab: 20, board: 5, kill: 40 });
            const owner340 = govt('k:340', {
                disab: 30, board: 5, kill: 100, allies: ['k:341'],
            });
            const negative = govt('k:369', {
                disab: -100, board: -100, kill: -100,
            });
            const all = [owner351, law352, pirate353, ally341, owner340,
                negative, VICTIM];
            const one = (owner: GovtData, victim: GovtData) =>
                crimeRecordChange(victim, owner, ['disable', 'kill'], 0);
            expect(one(VICTIM, VICTIM)).toBe(-130);
            expect(one(owner340, ally341)).toBe(-60);
            expect(one(owner351, VICTIM)).toBe(9);
            expect(one(law352, pirate353)).toBe(65);
            expect(one(negative, negative)).toBe(200);
            // The same through a one-system geography each.
            for (const [owner, victim, expected] of [
                [owner351, VICTIM, 9], [law352, pirate353, 65],
            ] as const) {
                const here = new LegalGeography(
                    [sys('s:x', owner.id, [], [0, 0])], govtEntries(all));
                expect(kill(here, 's:x', victim).get('s:x')).toBe(expected);
            }
        });

    it('charges a disable alone its DisabPenalty (wave 13: -30), and a '
        + 'disable + board of an unrelated ship half the owner\'s two '
        + 'fields (P1 wave 13: +50)', () => {
            const home = new LegalGeography(
                [sys('s:2080', VICTIM.id, [], [0, 0])], govtEntries(GOVTS));
            const records: LegalRecords = new Map();
            applyCrime(records, home, 's:2080', VICTIM, ['disable']);
            expect(records.get('s:2080')).toBe(-30);

            const police = govt('k:342', { disab: 50, board: 50, kill: 100 });
            const shipping = govt('k:343', { disab: 10, board: 10, kill: 10 });
            const range = new LegalGeography(
                [sys('s:2079', police.id, [], [0, 0])],
                govtEntries([police, shipping]));
            const boarded: LegalRecords = new Map();
            applyCrime(boarded, range, 's:2079', shipping, ['disable']);
            applyCrime(boarded, range, 's:2079', shipping, ['board']);
            expect(boarded.get('s:2079')).toBe(50);
        });

    it('starts an absent system from its InitialRec, and a system it does '
        + 'not know from nothing', () => {
            const wary = govt('k:900', { kill: 10, initialRecord: -5 });
            const geography = new LegalGeography(
                [sys('s:a', wary.id, [], [0, 0])], govtEntries([wary]));
            const records = kill(geography, 's:a', wary);
            expect(records.get('s:a')).toBe(-5 - 0 - 10);
            // Unknown crime system: only itself, owned by nobody, so the
            // unowned quarter of the victim's Disab 0 (no penalty: R4,
            // wave 39) + Kill 10.
            expect(geography.jumpsFrom('s:nowhere'))
                .toEqual(new Map([['s:nowhere', 0]]));
            expect(asObject(kill(geography, 's:nowhere', wary)))
                .toEqual({ 's:nowhere': -(0 + 2) });
        });
});

describe('per-system legal records: govt-wide changes', () => {
    const PIRATE = govt('k:137', { xenophobic: true });
    const FRIENDLY_XENO = govt('k:170', { xenophobic: true,
        allies: ['k:338'] });
    const BYSTANDER = govt('k:200');
    const geography = new LegalGeography([
        sys('s:o1', OWNER.id, [], [0, 0]),
        sys('s:o2', OWNER.id, [], [10, 0]),
        sys('s:ally', ALLY.id, [], [20, 0]),
        sys('s:enemy', ENEMY.id, [], [30, 0]),
        sys('s:pirate', PIRATE.id, [], [40, 0]),
        sys('s:fx', FRIENDLY_XENO.id, [], [50, 0]),
        sys('s:by', BYSTANDER.id, [], [60, 0]),
        sys('s:indep', null, [], [70, 0]),
    ], govtEntries([...GOVTS, PIRATE, FRIENDLY_XENO, BYSTANDER]));

    it('CompReward (wave 14, finding 5): +R in every CompGovt system, '
        + '+R/2 allies, -R/2 enemies and xenophobes; independent untouched',
        () => {
            const records: LegalRecords = new Map();
            applyCompletionReward(records, geography, OWNER.id, OWNER, 1000);
            expect(asObject(records)).toEqual({
                's:o1': 1000, 's:o2': 1000, 's:ally': 500, 's:enemy': -500,
                's:pirate': -500,
                // A xenophobe allied to the CompGovt is an ally.
                's:fx': 500,
            });
        });

    it('CompReward truncates the half toward zero, and without the '
        + 'CompGovt\'s data changes only its own systems', () => {
            const records: LegalRecords = new Map();
            applyCompletionReward(records, geography, OWNER.id, OWNER, -51);
            expect(records.get('s:o1')).toBe(-51);
            expect(records.get('s:ally')).toBe(-25);
            expect(records.get('s:enemy')).toBe(25);
            const bare: LegalRecords = new Map();
            applyCompletionReward(bare, geography, OWNER.id, undefined, 10);
            expect(asObject(bare)).toEqual({ 's:o1': 10, 's:o2': 10 });
        });

    it('a 0x0040 abort / a failure changes every CompGovt system only '
        + '(wave 14, finding 6: -500 in every 338 system)', () => {
            const records: LegalRecords = new Map();
            applyGovtRecordChange(records, geography, OWNER.id, -500);
            expect(asObject(records)).toEqual({ 's:o1': -500, 's:o2': -500 });
        });

    it('cleans the systems of a govt, its allies, its classmates, or all',
        () => {
            const bad = () => new Map(geography.systemIds.map(
                id => [id, -40] as [string, number]));
            const govtOnly = bad();
            cleanRecords(govtOnly, geography, 'govt', OWNER);
            expect(govtOnly.get('s:o1')).toBe(0);
            expect(govtOnly.get('s:o2')).toBe(0);
            expect(govtOnly.get('s:ally')).toBe(-40);
            const allies = bad();
            cleanRecords(allies, geography, 'allies', OWNER);
            expect(allies.get('s:ally')).toBe(0);
            expect(allies.get('s:enemy')).toBe(-40);
            const everything = bad();
            everything.set('s:gone', -9);
            cleanRecords(everything, geography, 'all', undefined);
            expect([...everything.values()].every(v => v === 0)).toBeTrue();
            // Good records are never lowered.
            const good = new Map([['s:o1', 7]]);
            cleanRecords(good, geography, 'govt', OWNER);
            expect(good.get('s:o1')).toBe(7);
        });

    it('cleans an absent system whose InitialRec is negative', () => {
        const hated = govt('k:150', { initialRecord: -100 });
        const geo = new LegalGeography([sys('s:h', hated.id, [], [0, 0])],
            govtEntries([hated]));
        const records: LegalRecords = new Map();
        cleanRecords(records, geo, 'govt', hated);
        expect(records.get('s:h')).toBe(0);
    });

    it('chär statuses land in the govt\'s and its allies\' systems, '
        + 'negated in its enemies\' (Bible, chär Status1-4)', () => {
            const records = initialRecordsFromGovtStatuses(
                [{ govt: OWNER.id, status: 30 }], geography);
            expect(asObject(records)).toEqual({
                's:o1': 30, 's:o2': 30, 's:ally': 30, 's:fx': 30,
                's:enemy': -30,
            });
        });

    it('seeds an old save\'s per-govt records into each system by its '
        + 'status govt (gövt 128 for an independent one)', () => {
            const seeded = systemRecordsFromGovtRecords(
                [[OWNER.id, -12], ['nova:128', 4], ['k:gone', 99]],
                geography);
            expect(asObject(seeded)).toEqual({
                's:o1': -12, 's:o2': -12, 's:indep': 4,
            });
        });
});
