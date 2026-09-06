import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import {
    abortMission,
    acceptOffer,
    makeMissionOffer,
    MissionContext,
    MissionMachineryContext,
    missionMatchesLocation,
    MissionWorkingState,
    LOCATION_MISSION_COMPUTER,
    processLanding,
    stellarRecord,
    StellarInfo,
} from './mission_logic.js';
import { Missions } from '../player/player_state_plugin.js';
import { LegalRecords } from '../reputation/reputation.js';

/**
 * Mission-layer reputation: AvailRecord/AvailRating gating,
 * CompGovt/CompReward outcome changes, and the PayVal negative
 * encodings. Kept separate from mission_logic_test so the reputation
 * layer's tests live together.
 */

function makeStellar(partial: Partial<StellarInfo> = {}): StellarInfo {
    return {
        id: 'nova:128',
        govt: 'nova:128',
        uninhabited: false,
        canLand: true,
        ...partial,
    };
}

function makeMission(partial: Partial<MissionData> = {}): MissionData {
    return {
        ...getDefaultMissionData(),
        id: 'nova:200',
        name: 'Test Mission',
        // Completable by landing where it was accepted.
        returnStel: 128,
        returnStelId: 'nova:128',
        ...partial,
    };
}

function makeGovt(id: string, partial: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id, ...partial };
}

const fed = makeGovt('nova:128', { classes: [1], allies: [0], enemies: [2] });
const bureau = makeGovt('nova:153', { classes: [0], allies: [1] });
const auroran = makeGovt('nova:129', { classes: [2], enemies: [1] });
const govts = new Map([[fed.id, fed], [bureau.id, bureau],
    [auroran.id, auroran]]);
const getGovt = (id: string) => govts.get(id);

function makeContext(partial: Partial<MissionContext> = {}): MissionContext {
    return {
        stellar: makeStellar(),
        stellarCandidates: [makeStellar(), makeStellar({ id: 'nova:129' })],
        bits: new Set<number>(),
        shipId: 'nova:164',
        activeMissions: new Map(),
        freeCargoSpace: 20,
        random: () => 0.5,
        getGovt,
        currentDay: 1000,
        ...partial,
    };
}

function makeState(partial: Partial<MissionWorkingState> = {}):
    MissionWorkingState {
    return {
        missions: new Map() as Missions,
        cargo: new Map(),
        credits: { credits: 1000 },
        bits: new Set<number>(),
        cargoCapacity: 20,
        dateAdvance: 0,
        events: [],
        records: new Map(),
        ...partial,
    };
}

function makeMachinery(state: MissionWorkingState,
    missionData: MissionData[],
    ctxPartial: Partial<MissionContext> = {}): MissionMachineryContext {
    const byId = new Map(missionData.map(m => [m.id, m]));
    return {
        state,
        getMission: id => byId.get(id),
        offerContext: () => makeContext({
            bits: state.bits,
            activeMissions: state.missions,
            freeCargoSpace: state.cargoCapacity,
            records: state.records,
            ...ctxPartial,
        }),
        random: () => 0.5,
        allGovts: () => [...govts],
    };
}

/** Accepts a mission and completes it by landing at the return stellar. */
function runToCompletion(mission: MissionData, state: MissionWorkingState,
    ctxPartial: Partial<MissionContext> = {}) {
    const machinery = makeMachinery(state, [mission], ctxPartial);
    const offer = makeMissionOffer(mission, machinery.offerContext())!;
    expect(offer).not.toBeNull();
    acceptOffer(machinery, offer);
    processLanding(machinery, offer.returnPlanet ?? 'nova:128', 1000);
    return machinery;
}

describe('AvailRecord gating', () => {
    const ctxWith = (records: LegalRecords) => makeContext({ records });

    it('requires a good record for positive AvailRecord', () => {
        const mission = makeMission({ availRecord: 5 });
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            ctxWith(new Map([['nova:128', 5]])))).toBe(true);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            ctxWith(new Map([['nova:128', 4]])))).toBe(false);
    });

    it('requires a criminal record for negative AvailRecord', () => {
        const mission = makeMission({ availRecord: -1 });
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            ctxWith(new Map([['nova:128', -3]])))).toBe(true);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            ctxWith(new Map()))).toBe(false);
    });

    it('judges the record with the STELLAR\'s govt', () => {
        const mission = makeMission({ availRecord: 5 });
        // Criminal with the Federation but upstanding with the
        // Aurorans: available on an Auroran world only.
        const records: LegalRecords = new Map([
            ['nova:128', -20], ['nova:129', 8]]);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ records }))).toBe(false);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({
                records,
                stellar: makeStellar({ govt: 'nova:129' }),
            }))).toBe(true);
    });

    it('judges independent stellars by govt 128 (Appendix II)', () => {
        const records: LegalRecords = new Map([['nova:128', 7]]);
        expect(stellarRecord(makeStellar({ govt: null }), records,
            'nova', getGovt)).toBe(7);
    });

    it('still fails closed on the domination sentinels', () => {
        expect(missionMatchesLocation(
            makeMission({ availRecord: -32000 }),
            LOCATION_MISSION_COMPUTER, makeContext())).toBe(false);
        expect(missionMatchesLocation(
            makeMission({ availRecord: -32001 }),
            LOCATION_MISSION_COMPUTER, makeContext())).toBe(false);
    });
});

describe('AvailRating gating', () => {
    it('gates on kill points', () => {
        const mission = makeMission({ availRating: 200 });
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ combatRating: 199 }))).toBe(false);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ combatRating: 200 }))).toBe(true);
    });

    it('ignores -1', () => {
        expect(missionMatchesLocation(makeMission({ availRating: -1 }),
            LOCATION_MISSION_COMPUTER, makeContext())).toBe(true);
    });
});

describe('CompGovt/CompReward', () => {
    it('raises the record with CompGovt on completion', () => {
        const state = makeState();
        runToCompletion(makeMission({
            compGovt: 128, compReward: 3,
        }), state);
        expect(state.records!.get('nova:128')).toBe(3);
        expect(state.missions.size).toBe(0);
    });

    it('costs half the reward (truncated) on failure', () => {
        const state = makeState();
        const mission = makeMission({
            compGovt: 128, compReward: 3, timeLimit: 1,
        });
        const machinery = makeMachinery(state, [mission]);
        const offer = makeMissionOffer(mission, machinery.offerContext())!;
        acceptOffer(machinery, offer);
        // Land far past the deadline: the mission fails.
        processLanding(machinery, 'nova:999', 5000);
        expect(state.records!.get('nova:128')).toBe(-1);
        expect(state.events.some(e => e.type === 'failed')).toBe(true);
    });

    it('costs 5x on abort only under the 0x0040 flag', () => {
        const plain = makeState();
        let mission = makeMission({ compGovt: 128, compReward: 3 });
        let machinery = makeMachinery(plain, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        abortMission(machinery, mission.id);
        expect(plain.records!.has('nova:128')).toBe(false);

        const flagged = makeState();
        mission = makeMission({ compGovt: 128, compReward: 3 });
        mission.flags = { ...mission.flags, lose5xCompRewardOnAbort: true };
        machinery = makeMachinery(flagged, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        abortMission(machinery, mission.id);
        expect(flagged.records!.get('nova:128')).toBe(-15);
    });
});

describe('PayVal negative encodings', () => {
    it('cleans the record with the encoded govt on completion', () => {
        const state = makeState({
            records: new Map([['nova:128', -40], ['nova:129', -40]]),
        });
        runToCompletion(makeMission({ payVal: -10128 }), state);
        expect(state.records!.get('nova:128')).toBe(0);
        expect(state.records!.get('nova:129')).toBe(-40);
        expect(state.credits.credits).toBe(1000);
    });

    it('cleans allies too for the -20xxx encoding', () => {
        const state = makeState({
            records: new Map([
                ['nova:128', -40], ['nova:153', -40], ['nova:129', -40]]),
        });
        runToCompletion(makeMission({ payVal: -20128 }), state);
        expect(state.records!.get('nova:128')).toBe(0);
        expect(state.records!.get('nova:153')).toBe(0);
        expect(state.records!.get('nova:129')).toBe(-40);
    });

    it('takes a percentage of cash on completion (-40xxx)', () => {
        const state = makeState({ credits: { credits: 1000 } });
        runToCompletion(makeMission({ payVal: -40010 }), state);
        expect(state.credits.credits).toBe(900);
    });

    it('takes flat credits at mission START (-50xxx), clamped at 0', () => {
        const state = makeState({ credits: { credits: 1000 } });
        const mission = makeMission({ payVal: -50300 });
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        // Taken at accept, before any landing.
        expect(state.credits.credits).toBe(700);

        const broke = makeState({ credits: { credits: 100 } });
        const machinery2 = makeMachinery(broke, [mission]);
        acceptOffer(machinery2,
            makeMissionOffer(mission, machinery2.offerContext())!);
        expect(broke.credits.credits).toBe(0);
    });

    it('still pays positive PayVal as credits', () => {
        const state = makeState({ credits: { credits: 0 } });
        const machinery = runToCompletion(
            makeMission({ payVal: 5000 }), state);
        expect(state.credits.credits).toBe(5000);
        expect(machinery.state.events.find(e => e.type === 'completed')
            ?.payment).toBe(5000);
    });
});

/**
 * mïsn Flags2 0x0002, "Apply mission Pay on auto-abort", on an IMMEDIATE
 * auto-abort (Flags 0x0001 without a board/rescue ship goal): the mission
 * never becomes active, so accepting it is the only moment its Pay can be
 * settled.
 *
 * The Pay is the whole PayVal. This used to read `payVal > 0` and so paid
 * only the positive encoding, silently discarding all four negative ones —
 * which is what the stock scenario actually uses the bit FOR (see the
 * nova:609 spec at the end).
 */
describe('PayVal on an immediate auto-abort (mïsn Flags2 0x0002)', () => {
    function autoAbortMission(partial: Partial<MissionData> = {},
        applyPay = true): MissionData {
        const mission = makeMission({ id: 'nova:609', ...partial });
        mission.flags = {
            ...mission.flags,
            autoAbort: true,
            applyPayOnAutoAbort: applyPay,
        };
        return mission;
    }

    /** Accepts the mission; an auto-abort settles entirely at accept. */
    function accept(mission: MissionData, state: MissionWorkingState) {
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.missions.size).toBe(0);
        return machinery;
    }

    it('takes a percentage of cash (-40xxx)', () => {
        const state = makeState({ credits: { credits: 1000 } });
        accept(autoAbortMission({ payVal: -40002 }), state);
        expect(state.credits.credits).toBe(980);
    });

    it('takes flat credits (-50xxx), clamped at 0', () => {
        const state = makeState({ credits: { credits: 1000 } });
        accept(autoAbortMission({ payVal: -50300 }), state);
        expect(state.credits.credits).toBe(700);

        const broke = makeState({ credits: { credits: 100 } });
        accept(autoAbortMission({ payVal: -50300 }), broke);
        expect(broke.credits.credits).toBe(0);
    });

    it('cleans the record with the encoded govt (-10xxx)', () => {
        const state = makeState({
            records: new Map([['nova:128', -40], ['nova:129', -40]]),
        });
        accept(autoAbortMission({ payVal: -10128 }), state);
        expect(state.records!.get('nova:128')).toBe(0);
        expect(state.records!.get('nova:129')).toBe(-40);
    });

    it('still pays a positive PayVal, and reports it on the notice', () => {
        const state = makeState({ credits: { credits: 0 } });
        const machinery = accept(autoAbortMission({ payVal: 500 }), state);
        expect(state.credits.credits).toBe(500);
        expect(machinery.state.events.find(e => e.type === 'autoAborted')
            ?.payment).toBe(500);
    });

    it('reports no payment for the encodings that take', () => {
        const state = makeState({ credits: { credits: 1000 } });
        const machinery = accept(autoAbortMission({ payVal: -40002 }), state);
        expect(machinery.state.events.find(e => e.type === 'autoAborted')
            ?.payment).toBeUndefined();
    });

    it('freezes the DECODED effect on a DEFERRED auto-abort, for the sim',
        () => {
            // Flags 0x0001 with a board/rescue ship goal defers the abort
            // to the boarding, so the mission DOES become active and the
            // simulation settles the arithmetic there. It cannot decode a
            // PayVal (it never reads mission data), so the decoded effect
            // rides on the ActiveMission — which is why freezing the raw
            // `payVal > 0` lost every negative encoding.
            const deferred = (payVal: number) => {
                const mission = autoAbortMission({
                    payVal, shipCount: 1, shipGoal: 2 /* board */,
                });
                const state = makeState({ credits: { credits: 25000 } });
                const machinery = makeMachinery(state, [mission]);
                acceptOffer(machinery,
                    makeMissionOffer(mission, machinery.offerContext())!);
                return state.missions.get('nova:609')!;
            };

            const takes = deferred(-40002);
            expect(takes.autoAbortOnBoard).toBeTrue();
            expect(takes.autoAbortTakePercent).toBe(2);
            expect(takes.autoAbortPay).toBeUndefined();

            const pays = deferred(2000);
            expect(pays.autoAbortPay).toBe(2000);
            expect(pays.autoAbortTakePercent).toBeUndefined();
        });

    it('applies nothing at all without the 0x0002 flag', () => {
        const state = makeState({
            credits: { credits: 1000 },
            records: new Map([['nova:128', -40]]),
        });
        accept(autoAbortMission({ payVal: -40002 }, false), state);
        expect(state.credits.credits).toBe(1000);
        accept(autoAbortMission({ payVal: -10128 }, false), state);
        expect(state.records!.get('nova:128')).toBe(-40);
    });
});

/**
 * ============================================================================
 * Which gövt a mission's BARE NUMBER names (CompGovt, PayVal -1xxxx/-2xxxx)
 * ============================================================================
 *
 * The number is scoped to the plug-in that WROTE the mission
 * (BaseData.writerPrefix), not to its id's prefix — and those differ exactly
 * when a plug-in OVERRIDES a stock mïsn, because the override keeps the
 * stock id. So the writer prefix alone is not an answer: it has to be tried
 * FIRST (a plug-in's own private gövt lives under it) and then fall back to
 * stock, which is what AvailStel's `rangeGovt` has always done.
 *
 * Without the fallback an override's reputation change landed on a phantom
 * `<plug>:n` record no gövt backs — invisible in the player-info dialog and
 * read by nothing — and PayVal's record-cleaning did nothing whatsoever,
 * since `cleanRecords` returns early on a gövt it cannot resolve.
 */
describe('CompGovt / PayVal govt resolution across plug-in prefixes', () => {
    /** A stock mïsn OVERRIDDEN by a plug-in: stock id, plug-in writer. */
    function overridden(partial: Partial<MissionData> = {}): MissionData {
        return makeMission({ id: 'nova:200', writerPrefix: 'bigplug',
            ...partial });
    }

    it('sends an overriding plug-in\'s CompGovt to the STOCK govt', () => {
        const state = makeState();
        runToCompletion(overridden({ compGovt: 128, compReward: 3 }), state);
        expect(state.records!.get('nova:128')).toBe(3);
        expect(state.records!.has('bigplug:128')).toBeFalse();
    });

    it('still prefers the plug-in\'s OWN govt when it defines that number',
        () => {
            // Both `bigplug:200` and `nova:200` exist; the writer wins, the
            // same order rangeGovt uses.
            const mine = makeGovt('bigplug:200');
            const stock200 = makeGovt('nova:200');
            const state = makeState();
            const mission = overridden({ compGovt: 200, compReward: 3 });
            const machinery = makeMachinery(state, [mission], {
                getGovt: (id: string) => id === mine.id ? mine
                    : id === stock200.id ? stock200 : govts.get(id),
            });
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            processLanding(machinery, 'nova:128', 1000);

            expect(state.records!.get('bigplug:200')).toBe(3);
            expect(state.records!.has('nova:200')).toBeFalse();
        });

    it('cleans the STOCK record for an overriding plug-in\'s PayVal', () => {
        const state = makeState({
            records: new Map([['nova:128', -40], ['nova:129', -40]]),
        });
        runToCompletion(overridden({ payVal: -10128 }), state);
        // The whole point: a `bigplug:128` lookup resolves to nothing, and
        // cleanRecords' early return made this a silent no-op.
        expect(state.records!.get('nova:128')).toBe(0);
        expect(state.records!.get('nova:129')).toBe(-40);
    });

    it('leaves a number no data set defines under the writer\'s prefix',
        () => {
            const state = makeState();
            runToCompletion(
                overridden({ compGovt: 250, compReward: 3 }), state);
            expect(state.records!.get('bigplug:250')).toBe(3);
        });
});
