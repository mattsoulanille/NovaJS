import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { govtDispositionTo } from './govt_disposition.js';
import { shipDisposition } from './iff_plugin.js';
import { LocalLaw, localLaw } from './local_law.js';
import {
    addRecordIn,
    availRatingOk,
    availRecordOk,
    combatRatingKillPoints,
    combatRatingName,
    compRewardDelta,
    crimePenalty,
    decodePayVal,
    govtRelation,
    INDEPENDENT_STATUS_GOVT,
    LEGAL_STATUS_NO_RECORD,
    legalStatusInSystem,
    legalStatusName,
    LEGAL_STATUS_NOT_APPLICABLE,
    LegalRecords,
    recordHostile,
    recordIn,
    statusGovtOf,
} from './reputation.js';
import { applyCrime, LegalGeography } from './system_records.js';

function makeGovt(id: string, partial: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id, ...partial };
}

// A little political landscape: fed (class 1), its ally bureau (allied
// with class 1), its enemy auroran (enemies with class 1), and an
// unrelated bystander.
const fed = makeGovt('nova:128', {
    classes: [1], allies: [0, 12], enemies: [2],
    crimeTol: 10, killPenalty: 6, disablePenalty: 2,
});
const bureau = makeGovt('nova:153', { classes: [0], allies: [1] });
const auroran = makeGovt('nova:129', { classes: [2], enemies: [1] });
const bystander = makeGovt('nova:200', { classes: [9] });
const allGovts: (readonly [string, GovtData])[] = [
    [fed.id, fed], [auroran.id, auroran], [bureau.id, bureau],
    [bystander.id, bystander]];

/** The one system each govt owns in these specs (records are per
 * system: ruling #380), and the independent one. */
function systemOf(owner: GovtData | undefined): string {
    return owner ? `sys:${owner.id}` : 'sys:independent';
}

/** The law in force in a system owned by `owner` (undefined:
 * independent), over the little landscape above. */
function lawOf(owner: GovtData | undefined,
    extra: readonly GovtData[] = []): LocalLaw {
    const govts = new Map<string, GovtData>(allGovts);
    for (const govt of extra) {
        govts.set(govt.id, govt);
    }
    return localLaw(systemOf(owner), owner?.id, id => govts.get(id));
}
/** The Federation's own space. */
const FED_SPACE = lawOf(fed);
const FED_SYS = systemOf(fed);

describe('recordIn / addRecordIn', () => {
    it("reads absent entries as the system's status govt InitialRec", () => {
        const records: LegalRecords = new Map();
        expect(recordIn(records, 'sys:a', fed)).toBe(0);
        expect(recordIn(records, 'sys:a',
            makeGovt('nova:128', { initialRecord: -25 }))).toBe(-25);
        expect(recordIn(records, 'sys:a')).toBe(0);
        expect(recordIn(new Map([['sys:a', 3]]), undefined, fed)).toBe(0);
    });

    it('materializes entries from InitialRec when adding', () => {
        const records: LegalRecords = new Map();
        const hostile = makeGovt('nova:150', { initialRecord: -10 });
        addRecordIn(records, 'sys:h', hostile, -5);
        expect(records.get('sys:h')).toBe(-15);
    });

    it('clamps to the pilot-file int16 range', () => {
        const records: LegalRecords = new Map([['sys:a', 32760]]);
        addRecordIn(records, 'sys:a', fed, 100);
        expect(records.get('sys:a')).toBe(32767);
        addRecordIn(records, 'sys:a', fed, -100000);
        expect(records.get('sys:a')).toBe(-32767);
    });
});

describe('crimePenalty', () => {
    it('uses the govt field when set', () => {
        expect(crimePenalty(fed, 'kill')).toBe(6);
        expect(crimePenalty(fed, 'disable')).toBe(2);
    });

    it('charges nothing for a zero field: no engine default (reference '
        + '"Zero govt penalties (R4), wave 39")', () => {
        const zero = makeGovt('nova:130');
        expect(crimePenalty(zero, 'kill')).toBe(0);
        expect(crimePenalty(zero, 'disable')).toBe(0);
        expect(crimePenalty(zero, 'board')).toBe(0);
    });

    it('uses the govt BoardPenalty field for pirating when set', () => {
        const pirateHater = makeGovt('nova:131', { boardPenalty: 20 });
        expect(crimePenalty(pirateHater, 'board')).toBe(20);
    });

    it('applies a NEGATIVE field SIGNED: the crime raises the record '
        + '(reference "A14 with system traffic as the victims, wave 12")',
        () => {
            // Measured: a kill of a -100 / -100 govt's ship raised the
            // record by 200 (Disab + Kill). This replaces #108's "no
            // penalty" reading.
            const negative = makeGovt('nova:369', {
                killPenalty: -100, disablePenalty: -100, boardPenalty: -100,
            });
            expect(crimePenalty(negative, 'kill')).toBe(-100);
            expect(crimePenalty(negative, 'disable')).toBe(-100);
            expect(crimePenalty(negative, 'board')).toBe(-100);
            const records: LegalRecords = new Map();
            const own = new LegalGeography([{
                id: 'sys:neg', govt: negative.id, links: [], position: [0, 0],
            }], [[negative.id, negative]]);
            applyCrime(records, own, 'sys:neg', negative, ['disable']);
            applyCrime(records, own, 'sys:neg', negative, ['kill']);
            expect(records.get('sys:neg')).toBe(200);
        });
});

describe('recordHostile', () => {
    it('flips exactly below -CrimeTol (the warships-attack rule)', () => {
        expect(recordHostile(-10, 10)).toBe(false);
        expect(recordHostile(-11, 10)).toBe(true);
        expect(recordHostile(0, 10)).toBe(false);
        expect(recordHostile(5, 10)).toBe(false);
    });

    it('treats CrimeTol 0 (and nonsense negatives) as zero tolerance',
        () => {
            expect(recordHostile(-1, 0)).toBe(true);
            expect(recordHostile(0, 0)).toBe(false);
            expect(recordHostile(-1, -5)).toBe(true);
        });
});

/**
 * EVN Bible, Appendix II: the status is the record in units of the
 * government's CrimeTol, against a power-of-four ladder — 0 No Record;
 * good >0 Citizen, >4 Good Citizen, >16 Upstanding, >64 Leading, >256
 * Model, >1024 Virtuous; evil >0 No Convictions, >1 Minor Offender, >4
 * Offender, >16 Criminal, >64 Wanted Criminal, >256 Fugitive, >1024
 * Hunted Fugitive, >4096 Public Enemy (strings: stock STR# 134, pinned
 * in reputation_integration_test.ts).
 */
describe('legalStatusName (#119)', () => {
    const TOL = 6; // The stock Federation's CrimeTol.

    it('scales the record by CrimeTol and walks the good ladder', () => {
        expect(legalStatusName(0, TOL)).toBe('No Record');
        expect(legalStatusName(1, TOL)).toBe('Citizen');
        expect(legalStatusName(4 * TOL, TOL)).toBe('Citizen');
        expect(legalStatusName(4 * TOL + 1, TOL)).toBe('Good Citizen');
        expect(legalStatusName(16 * TOL + 1, TOL)).toBe('Upstanding Citizen');
        expect(legalStatusName(64 * TOL + 1, TOL)).toBe('Leading Citizen');
        expect(legalStatusName(256 * TOL + 1, TOL)).toBe('Model Citizen');
        expect(legalStatusName(1024 * TOL + 1, TOL)).toBe('Virtuous Citizen');
    });

    it('walks the evil ladder, whose second step is the hostility line',
        () => {
            expect(legalStatusName(-1, TOL)).toBe('No Convictions');
            expect(legalStatusName(-TOL, TOL)).toBe('No Convictions');
            // record < -CrimeTol: warships open fire (recordHostile) and
            // the status is the first one past "No Convictions".
            expect(recordHostile(-TOL - 1, TOL)).toBe(true);
            expect(legalStatusName(-TOL - 1, TOL)).toBe('Minor Offender');
            expect(legalStatusName(-4 * TOL - 1, TOL)).toBe('Offender');
            expect(legalStatusName(-16 * TOL - 1, TOL)).toBe('Criminal');
            expect(legalStatusName(-64 * TOL - 1, TOL))
                .toBe('Wanted Criminal');
            expect(legalStatusName(-256 * TOL - 1, TOL)).toBe('Fugitive');
            expect(legalStatusName(-1024 * TOL - 1, TOL))
                .toBe('Hunted Fugitive');
            expect(legalStatusName(-4096 * TOL - 1, TOL))
                .toBe('Public Enemy');
        });

    it('depends on CrimeTol: the same record reads differently per govt',
        () => {
            // -30 with a tolerance of 20 (scaled 1.5) is a Minor Offender;
            // with a tolerance of 1 (scaled 30) a Criminal.
            expect(legalStatusName(-30, 20)).toBe('Minor Offender');
            expect(legalStatusName(-30, 1)).toBe('Criminal');
            expect(legalStatusName(30, 20)).toBe('Citizen');
            expect(legalStatusName(30, 1)).toBe('Upstanding Citizen');
        });

    it('reads a CrimeTol of 0 as 1 rather than dividing by zero', () => {
        expect(legalStatusName(5, 0)).toBe('Good Citizen');
        expect(legalStatusName(-2, 0)).toBe('Minor Offender');
        expect(legalStatusName(-2, -7)).toBe('Minor Offender');
    });
});

describe('availRecordOk / availRatingOk', () => {
    it('ignores AvailRecord 0', () => {
        expect(availRecordOk(0, -9999)).toBe(true);
    });

    it('requires at least this high for positive values', () => {
        expect(availRecordOk(5, 5)).toBe(true);
        expect(availRecordOk(5, 4)).toBe(false);
    });

    it('requires at least this LOW for negative values', () => {
        expect(availRecordOk(-1, -1)).toBe(true);
        expect(availRecordOk(-1, 0)).toBe(false);
        expect(availRecordOk(-1, -30)).toBe(true);
    });

    it('ignores AvailRating -1 and gates on kill points otherwise', () => {
        expect(availRatingOk(-1, 0)).toBe(true);
        expect(availRatingOk(200, 199)).toBe(false);
        expect(availRatingOk(200, 200)).toBe(true);
        expect(availRatingOk(0, 0)).toBe(true);
    });
});

describe('combatRatingKillPoints (R6, wave 37)', () => {
    it('adds a fifth of the victim\'s Strength per kill', () => {
        // Reference "... (R6), wave 37": Strength 200 -> +40; wave 5's
        // Strength 50 -> +10; wave 10's Strength 20 -> +4.
        expect(combatRatingKillPoints(200)).toBe(40);
        expect(combatRatingKillPoints(50)).toBe(10);
        expect(combatRatingKillPoints(20)).toBe(4);
    });

    it('rounds down (GUESS) and never subtracts', () => {
        expect(combatRatingKillPoints(8)).toBe(1);
        expect(combatRatingKillPoints(4)).toBe(0);
        expect(combatRatingKillPoints(0)).toBe(0);
        expect(combatRatingKillPoints(-50)).toBe(0);
    });
});

describe('combatRatingName', () => {
    it('names the Appendix I tiers', () => {
        expect(combatRatingName(0)).toBe('No Ability');
        expect(combatRatingName(1)).toBe('Little Ability');
        expect(combatRatingName(99)).toBe('Little Ability');
        expect(combatRatingName(100)).toBe('Fair Ability');
        expect(combatRatingName(12800)).toBe('Deadly');
        expect(combatRatingName(1_000_000)).toBe('Frightening');
    });
});

describe('decodePayVal', () => {
    it('decodes the documented encodings', () => {
        expect(decodePayVal(0)).toEqual({ type: 'none' });
        expect(decodePayVal(-1)).toEqual({ type: 'none' });
        expect(decodePayVal(15000))
            .toEqual({ type: 'credits', amount: 15000 });
        expect(decodePayVal(-10141)).toEqual({
            type: 'cleanRecord', govtResourceId: 141, scope: 'govt' });
        expect(decodePayVal(-20131)).toEqual({
            type: 'cleanRecord', govtResourceId: 131, scope: 'allies' });
        expect(decodePayVal(-30129)).toEqual({
            type: 'cleanRecord', govtResourceId: 129, scope: 'classmates' });
        expect(decodePayVal(-40005))
            .toEqual({ type: 'takePercent', percent: 5 });
        expect(decodePayVal(-50000))
            .toEqual({ type: 'takeCredits', amount: 0 });
        expect(decodePayVal(-51234))
            .toEqual({ type: 'takeCredits', amount: 1234 });
    });

    it('decodes values outside every range to none', () => {
        expect(decodePayVal(-5000)).toEqual({ type: 'none' });
        expect(decodePayVal(-10500)).toEqual({ type: 'none' });
        expect(decodePayVal(-40100)).toEqual({ type: 'none' });
    });
});

describe('compRewardDelta', () => {
    it('grants the full reward on completion', () => {
        expect(compRewardDelta(4, 'complete')).toBe(4);
    });

    it('costs half (truncated) on failure', () => {
        expect(compRewardDelta(4, 'fail')).toBe(-2);
        expect(compRewardDelta(1, 'fail')).toBe(0);
    });

    it('costs nothing when the TimeLimit ran out (reference "A14 / '
        + 'contraband wave 15", finding 2)', () => {
            expect(compRewardDelta(1000, 'timeout')).toBe(0);
            expect(compRewardDelta(-1000, 'timeout')).toBe(0);
        });

    it('costs nothing when a contraband scan failed a 0x0020 mission '
        + '(reference "S1 and S2 wave 12", S2)', () => {
            expect(compRewardDelta(10, 'scanned')).toBe(0);
            expect(compRewardDelta(-1000, 'scanned')).toBe(0);
        });

    it('costs nothing when the pilot jettisoned the mission\'s cargo '
        + '(reference "Jettison cargo, wave 55")', () => {
            expect(compRewardDelta(20, 'jettisoned')).toBe(0);
            expect(compRewardDelta(-1000, 'jettisoned')).toBe(0);
        });

    it('costs 5x on abort only under the 0x0040 flag', () => {
        expect(compRewardDelta(4, 'abort')).toBe(0);
        expect(compRewardDelta(4, 'abort', true)).toBe(-20);
    });
});

describe('govtRelation', () => {
    it('is allied or enemy when EITHER side lists the other', () => {
        // fed lists bureau's class 0; bureau lists fed's class 1.
        expect(govtRelation(fed, bureau)).toBe('ally');
        expect(govtRelation(bureau, fed)).toBe('ally');
        const oneWayAlly = makeGovt('nova:201', { classes: [12] });
        expect(govtRelation(fed, oneWayAlly)).toBe('ally');
        expect(govtRelation(oneWayAlly, fed)).toBe('ally');
        // Only auroran lists fed (class 1) as an enemy; fed lists
        // auroran's class 2 too.
        expect(govtRelation(auroran, fed)).toBe('enemy');
        const oneWayFoe = makeGovt('nova:202', { classes: [7], enemies: [1] });
        expect(govtRelation(fed, oneWayFoe)).toBe('enemy');
        expect(govtRelation(fed, bystander)).toBe('neutral');
    });

    it('prefers ally when both lists apply', () => {
        const torn = makeGovt('nova:203', { classes: [5], allies: [1],
            enemies: [1] });
        expect(govtRelation(fed, torn)).toBe('ally');
    });
});

describe('criminal hostility: sim disposition (govtDispositionTo)', () => {
    it('flips a neutral govt to enemy exactly below -CrimeTol', () => {
        const atTol: LegalRecords = new Map([[FED_SYS, -10]]);
        const belowTol: LegalRecords = new Map([[FED_SYS, -11]]);
        expect(govtDispositionTo(fed, undefined, atTol, FED_SPACE))
            .toBe('neutral');
        expect(govtDispositionTo(fed, undefined, belowTol, FED_SPACE))
            .toBe('enemy');
    });

    it('leaves ships without records (NPCs) politically judged', () => {
        expect(govtDispositionTo(fed, auroran, undefined, FED_SPACE))
            .toBe('enemy');
        expect(govtDispositionTo(fed, bureau, undefined, FED_SPACE))
            .toBe('ally');
        expect(govtDispositionTo(fed, undefined, undefined, FED_SPACE))
            .toBe('neutral');
    });

    it('never flips a neverAttacksPlayer govt', () => {
        const pacifist = makeGovt('nova:500', { crimeTol: 0 });
        pacifist.flags = { ...pacifist.flags, neverAttacksPlayer: true };
        const criminal: LegalRecords = new Map([[systemOf(pacifist), -9999]]);
        expect(govtDispositionTo(pacifist, undefined, criminal,
            lawOf(pacifist, [pacifist]))).toBe('neutral');
    });

    it("reads an absent record as the system owner's InitialRec", () => {
        const hated = makeGovt('nova:501',
            { crimeTol: 10, initialRecord: -50 });
        expect(govtDispositionTo(hated, undefined, new Map(),
            lawOf(hated, [hated]))).toBe('enemy');
    });

    // Reference A14 (docs/reference_experiments.md), rulings #376 and
    // #380: the record that counts is the one IN THIS SYSTEM, and only a
    // govt that enforces this system's law acts on it.
    it('judges the record in THIS system, not the one with its own govt',
        () => {
            // Criminal in this Federation system: the Fed hunts (c1)...
            const fedCriminal: LegalRecords = new Map([[FED_SYS, -500]]);
            expect(govtDispositionTo(fed, undefined, fedCriminal, FED_SPACE))
                .toBe('enemy');
            // ...but not in a system it has no tie to (c5: the home
            // record never counts elsewhere).
            expect(govtDispositionTo(fed, undefined, fedCriminal,
                lawOf(bystander))).toBe('neutral');
            expect(govtDispositionTo(fed, undefined, fedCriminal,
                lawOf(undefined))).toBe('neutral');
            // ...nor in ANOTHER Federation system, whose record is its own
            // (c2: per-system records, ruling #380).
            expect(govtDispositionTo(fed, undefined, fedCriminal,
                localLaw('sys:fed-elsewhere', fed.id,
                    id => new Map(allGovts).get(id)))).toBe('neutral');
            // An ALLY of the owner enforces this system's record (c3), and
            // a record in the ally's own system does not matter (c14).
            expect(govtDispositionTo(bureau, undefined, fedCriminal,
                FED_SPACE)).toBe('enemy');
            expect(govtDispositionTo(bureau, undefined,
                new Map([[systemOf(bureau), -500]]), FED_SPACE)).toBe('neutral');
            // An unrelated govt ignores a local criminal (c4).
            expect(govtDispositionTo(bystander, undefined, fedCriminal,
                FED_SPACE)).toBe('neutral');
        });
});

describe('criminal hostility: display disposition (shipDisposition)', () => {
    it('shows hostile radar/corners below -CrimeTol, same as the sim',
        () => {
            const atTol: LegalRecords = new Map([[FED_SYS, -10]]);
            const belowTol: LegalRecords = new Map([[FED_SYS, -11]]);
            expect(shipDisposition(fed, undefined, atTol, FED_SPACE))
                .toBe('neutral');
            expect(shipDisposition(fed, undefined, belowTol, FED_SPACE))
                .toBe('hostile');
        });

    it('a criminal record beats political friendliness', () => {
        // Sharing the Federation's government but wanted by it: the
        // record flip outranks the same-govt friendly rule.
        const criminal: LegalRecords = new Map([[FED_SYS, -999]]);
        expect(shipDisposition(fed, fed, criminal, FED_SPACE))
            .toBe('hostile');
        expect(shipDisposition(fed, fed, new Map(), FED_SPACE))
            .toBe('friendly');
    });

    it('does not change politics-only calls (no records passed)', () => {
        expect(shipDisposition(fed, auroran, undefined, FED_SPACE))
            .toBe('hostile');
        expect(shipDisposition(fed, undefined, undefined, FED_SPACE))
            .toBe('neutral');
    });

    it('agrees with the sim about whose law counts (A14)', () => {
        const fedCriminal: LegalRecords = new Map([[FED_SYS, -500]]);
        for (const [self, law] of [
            [fed, FED_SPACE], [fed, lawOf(bystander)], [bureau, FED_SPACE],
            [bystander, FED_SPACE], [fed, lawOf(undefined)],
        ] as const) {
            expect(shipDisposition(self, undefined, fedCriminal, law)
                === 'hostile')
                .withContext(`${self.id} in ${law.owner?.id}`)
                .toBe(govtDispositionTo(self, undefined, fedCriminal, law)
                    === 'enemy');
        }
    });
});

/**
 * The map's properties column and the 'p' dialog print their "Legal
 * Status:" through this ONE reading, so a record can never be named two
 * ways — including the record they START from: an absent entry is the
 * govt's InitialRec, exactly what the simulation charges against.
 */
describe('legalStatusInSystem (one reading for the map and the dialog)', () => {
    const fed = makeGovt('nova:128', { crimeTol: 6 });
    // Stock nova:147's shape: the pilot starts at -5 with them.
    const rebels = makeGovt('nova:147', { crimeTol: 3, initialRecord: -5 });
    const getGovt = (id: string) => [fed, rebels].find(g => g.id === id);

    it("reads an absent record as the govt's InitialRec, as the sim does",
        () => {
            const fresh = new Map<string, number>();
            expect(legalStatusInSystem(fresh, 'sys:rebel', 'nova:147', getGovt))
                .toBe(legalStatusName(-5, 3));
            expect(legalStatusInSystem(fresh, 'sys:rebel', 'nova:147', getGovt))
                .not.toBe(LEGAL_STATUS_NO_RECORD);
            // A govt with no InitialRec really is a clean slate.
            expect(legalStatusInSystem(fresh, 'sys:fed', 'nova:128', getGovt))
                .toBe(LEGAL_STATUS_NO_RECORD);
        });

    it('prefers the stored record, scaled by that govt\'s own CrimeTol',
        () => {
            const records = new Map([['sys:rebel', -13], ['sys:fed', -13]]);
            // -13 is 2.2 Federation tolerances but 4.3 Rebel ones.
            expect(legalStatusInSystem(records, 'sys:fed', 'nova:128', getGovt))
                .toBe('Minor Offender');
            expect(legalStatusInSystem(records, 'sys:rebel', 'nova:147', getGovt))
                .toBe('Offender');
            expect(legalStatusInSystem(new Map([['sys:rebel', 30]]),
                'sys:rebel', 'nova:147', getGovt)).toBe(legalStatusName(30, 3));
        });

    it('judges an independent system by gövt 128 (Bible, Appendix II)',
        () => {
            expect(statusGovtOf(null)).toBe(INDEPENDENT_STATUS_GOVT);
            expect(statusGovtOf(undefined)).toBe('nova:128');
            expect(statusGovtOf('nova:147')).toBe('nova:147');
            expect(legalStatusInSystem(new Map([['sys:indep', -30]]),
                'sys:indep', null, getGovt)).toBe(legalStatusName(-30, 6));
            expect(legalStatusInSystem(new Map(), 'sys:indep', null, getGovt))
                .toBe(LEGAL_STATUS_NO_RECORD);
        });

    it('has no line for a status govt the caller cannot resolve', () => {
        expect(legalStatusInSystem(new Map(), 'sys:x', 'arpia:600', getGovt))
            .toBeUndefined();
        expect(legalStatusInSystem(new Map(), 'sys:x', null, () => undefined))
            .toBeUndefined();
    });

    it('reads "N/A" under a XENOPHOBIC owner, whatever the record '
        + '(reference "Map dot colours, wave 23", Kit Map Xeno)', () => {
            const xeno = makeGovt('kit:344', { crimeTol: 10 });
            xeno.flags = { ...xeno.flags, xenophobic: true };
            // 0x0004 "always attacks the player" is NOT 0x0001: Kit Map
            // Attacks read "No Record".
            const attacks = makeGovt('kit:362', { crimeTol: 10 });
            attacks.flags = { ...attacks.flags, alwaysAttacksPlayer: true };
            const lookup = (id: string) =>
                ({ 'kit:344': xeno, 'kit:362': attacks })[id];
            for (const record of [0, -500, 500]) {
                expect(legalStatusInSystem(new Map([['sys:xeno', record]]),
                    'sys:xeno', 'kit:344', lookup))
                    .toBe(LEGAL_STATUS_NOT_APPLICABLE);
            }
            expect(LEGAL_STATUS_NOT_APPLICABLE).toBe('N/A');
            expect(legalStatusInSystem(new Map(), 'sys:attacks', 'kit:362',
                lookup)).toBe(LEGAL_STATUS_NO_RECORD);
        });
});
