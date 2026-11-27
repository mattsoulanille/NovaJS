import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import {
    abortMission,
    acceptOffer,
    failExpiredMissions,
    failMission,
    makeMissionOffer,
    MissionContext,
    MissionOffer,
    MissionMachineryContext,
    missionMatchesLocation,
    MissionWorkingState,
    startMissionById,
    LOCATION_MISSION_COMPUTER,
    processLanding,
    runDeferredAutoAbort,
    runPendingAutoAborts,
    stellarRecord,
    StellarInfo,
} from './index.js';
import { isRight } from 'fp-ts/lib/Either.js';
import { applyContrabandScan } from '../npc/index.js';
import { ActiveMissionType, Missions } from '../player/index.js';
import {
    LegalGeography, LegalRecords, localLaw,
} from '../reputation/index.js';

/**
 * Mission-layer reputation: AvailRecord/AvailRating gating,
 * CompGovt/CompReward outcome changes, and the PayVal negative
 * encodings. Kept separate from mission_logic_test so the reputation
 * layer's tests live together.
 *
 * Records are per SYSTEM (ruling #380). Each govt here owns one system
 * whose sÿst id is the govt's own number (as stock sÿst nova:128 is a
 * Federation system), so a record keyed 'nova:128' is the one in the
 * Federation's system; stellar nova:128 is in it, stellar nova:129 in the
 * Aurorans'.
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
const SYSTEMS = [
    { id: 'nova:128', govt: fed.id, links: [] as string[] },
    { id: 'nova:153', govt: bureau.id, links: [] as string[] },
    { id: 'nova:129', govt: auroran.id, links: [] as string[] },
    { id: 'sys:indep', govt: null, links: [] as string[] },
    // Systems of the plug-in govts the prefix specs below resolve to.
    { id: 'bigplug:200', govt: 'bigplug:200', links: [] as string[] },
    { id: 'nova:200', govt: 'nova:200', links: [] as string[] },
    { id: 'bigplug:250', govt: 'bigplug:250', links: [] as string[] },
];
const geography = new LegalGeography(SYSTEMS.map((system, i) => ({
    ...system, position: [i * 10, 0] as [number, number],
})), govts);
/** Stellar nova:N sits in sÿst nova:N; 'nova:777' in the independent one. */
const systemIdOfStellar = (id: string) =>
    id === 'nova:777' ? 'sys:indep' : id;

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
        systems: SYSTEMS,
        systemIdOfStellar,
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
        // Injected exactly as MissionSession injects them (#266).
        missionOperators: {
            startMission: startMissionById,
            abortMission,
            failMission,
        },
        random: () => 0.5,
        legalGeography: () => geography,
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

    it('judges the record in the STELLAR\'s system', () => {
        const mission = makeMission({ availRecord: 5 });
        // Criminal in the Federation's system but upstanding in the
        // Aurorans': available on an Auroran world only.
        const records: LegalRecords = new Map([
            ['nova:128', -20], ['nova:129', 8]]);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ records }))).toBe(false);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({
                records,
                stellar: makeStellar({ id: 'nova:129', govt: 'nova:129' }),
            }))).toBe(true);
    });

    it('judges independent stellars by their own system\'s record, '
        + 'absent reading as govt 128\'s InitialRec (Appendix II)', () => {
            const stellar = makeStellar({ id: 'nova:777', govt: null });
            const where = { systems: SYSTEMS, systemIdOfStellar };
            expect(stellarRecord(stellar, new Map([['sys:indep', 7]]),
                'nova', getGovt, where)).toBe(7);
            const wary = new Map(govts);
            wary.set('nova:128', { ...fed, initialRecord: -3 });
            expect(stellarRecord(stellar, new Map([['nova:128', 7]]),
                'nova', id => wary.get(id), where)).toBe(-3);
        });

    it('gates the domination sentinels on the dominated stellars (#353): '
        + '-32000 this stellar, -32001 any', () => {
            const here = makeMission({ availRecord: -32000 });
            const any = makeMission({ availRecord: -32001 });
            const at = (dominated?: string[]) => [here, any].map(mission =>
                missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
                    makeContext(dominated ? { dominated } : {})));
            expect(at()).toEqual([false, false]);
            expect(at([])).toEqual([false, false]);
            // Another stellar: only "at least one".
            expect(at(['nova:200'])).toEqual([false, true]);
            // This one (the context's stellar, nova:128): both.
            expect(at(['nova:128'])).toEqual([true, true]);
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

    it('reaches the CompGovt\'s allies (+R/2) and enemies (-R/2) on '
        + 'completion (reference "A14 spread, wave 14")', () => {
            const state = makeState();
            runToCompletion(makeMission({
                compGovt: 128, compReward: 10,
            }), state);
            expect(Object.fromEntries(state.records!)).toEqual({
                'nova:128': 10, 'nova:153': 5, 'nova:129': -5,
            });
        });

    // Overturns the Bible's -R/2 for this failure kind: reference "A14 /
    // contraband wave 15" finding 2 (CompReward 1000, TimeLimit 1: no
    // record changed anywhere).
    it('changes NO record when the mission fails on its TimeLimit, '
        + 'at a landing', () => {
            const state = makeState();
            const mission = makeMission({
                compGovt: 128, compReward: 1000, timeLimit: 1,
            });
            const machinery = makeMachinery(state, [mission]);
            const offer = makeMissionOffer(mission, machinery.offerContext())!;
            acceptOffer(machinery, offer);
            // Land far past the deadline: the mission fails.
            processLanding(machinery, 'nova:999', 5000);
            expect(state.records!.size).toBe(0);
            expect(state.missions.size).toBe(0);
            expect(state.events.some(e => e.type === 'failed')).toBe(true);
        });

    it('nor in flight (the date-advance sweep)', () => {
        const state = makeState();
        const mission = makeMission({
            compGovt: 128, compReward: 1000, timeLimit: 1,
        });
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(failExpiredMissions(machinery, 5000)).toBe(1);
        expect(state.records!.size).toBe(0);
        expect(state.events.some(e => e.type === 'failed')).toBe(true);
    });

    it('still costs half the reward (truncated) on an UNMEASURED failure: '
        + 'an Fxxx, or one the sim flagged', () => {
            const scripted = makeState();
            const mission = makeMission({ compGovt: 128, compReward: 3 });
            const machinery = makeMachinery(scripted, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            failMission(machinery, mission.id);
            expect(scripted.records!.get('nova:128')).toBe(-1);
            // The failure stays with the CompGovt (not measured to spread).
            expect(scripted.records!.size).toBe(1);

            // Flagged by the sim (the owner disabled or destroyed under
            // Flags2 0x0004, boarded by pirates under Flags 0x8000), and
            // past its deadline by the landing: still the flagged
            // failure, not a timeout.
            for (const cause of ['lost', 'plundered'] as const) {
                const flagged = makeState();
                const timed = makeMission({
                    compGovt: 128, compReward: 3, timeLimit: 1,
                });
                const flaggedMachinery = makeMachinery(flagged, [timed]);
                acceptOffer(flaggedMachinery,
                    makeMissionOffer(timed, flaggedMachinery.offerContext())!);
                Object.assign(flagged.missions.get(timed.id)!,
                    { failed: true, failCause: cause });
                processLanding(flaggedMachinery, 'nova:999', 5000);
                expect(flagged.records!.get('nova:128')).withContext(cause)
                    .toBe(-1);
            }
        });

    // Overturns the Bible's -R/2 for this failure kind too: reference "S1
    // and S2 wave 12", S2 (a Flags 0x0020 mission with CompReward 10
    // failed by a scan: "none changed").
    describe('a Flags 0x0020 mission failed by a contraband SCAN', () => {
        /** Accepts the mission and fails it the way the sim's scan does. */
        function scanFailed(timeLimit = 0) {
            const state = makeState();
            const mission = makeMission({
                compGovt: 128, compReward: 1000, timeLimit,
            });
            mission.flags = { ...mission.flags, failIfScanned: true };
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            const result = applyContrabandScan({
                smuggled: false, failMissions: [mission.id],
                items: [`mission:${mission.id}`],
            }, fed, localLaw('nova:128', fed.id, getGovt), {
                credits: state.credits, records: state.records,
                missions: state.missions,
            });
            expect(result.missionFailed).toBeTrue();
            expect(state.missions.get(mission.id)).toEqual(jasmine
                .objectContaining({ failed: true, failCause: 'scan' }));
            return { state, machinery, mission };
        }

        it('changes NO record at the next landing', () => {
            const { state, machinery } = scanFailed();
            processLanding(machinery, 'nova:999', 1000);
            expect(state.records!.size).toBe(0);
            expect(state.missions.size).toBe(0);
            expect(state.events.some(e => e.type === 'failed')).toBe(true);
        });

        it('nor in flight (the date-advance sweep)', () => {
            const { state, machinery } = scanFailed();
            expect(failExpiredMissions(machinery, 1000)).toBe(1);
            expect(state.records!.size).toBe(0);
            expect(state.events.some(e => e.type === 'failed')).toBe(true);
        });

        it('nor once its deadline has passed as well', () => {
            const { state, machinery } = scanFailed(1);
            processLanding(machinery, 'nova:999', 5000);
            expect(state.records!.size).toBe(0);
            expect(state.missions.size).toBe(0);
        });
    });

    it('reads a sim-failed mission saved WITHOUT a failCause (an older '
        + 'save) as the old -R/2 failure', () => {
            const state = makeState();
            const mission = makeMission({ compGovt: 128, compReward: 3 });
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            // What a pilot file written before failCause existed holds.
            const { failCause: _absent, ...saved } = {
                ...ActiveMissionType.encode(state.missions.get(mission.id)!),
                failed: true,
            };
            const decoded = ActiveMissionType.decode(saved);
            expect(isRight(decoded)).toBeTrue();
            if (!isRight(decoded)) {
                return;
            }
            expect(decoded.right.failCause).toBeUndefined();
            state.missions.set(mission.id, decoded.right);
            processLanding(machinery, 'nova:999', 1000);
            expect(state.records!.get('nova:128')).toBe(-1);
            expect(state.missions.size).toBe(0);
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
        // The CompGovt alone (reference "A14 spread, wave 14", finding 6).
        expect(flagged.records!.size).toBe(1);
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
                // Deferred only behind a përs replacement (përs 0x0040).
                acceptOffer(machinery, {
                    ...makeMissionOffer(mission, machinery.offerContext())!,
                    replacesPers: true,
                });
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
 * An auto-abort is the mission's own end, not the player's abort (#320)
 * ============================================================================
 *
 * The question: an IMMEDIATE auto-abort (acceptOffer) skipped the mïsn
 * Flags 0x0040 "-5x CompReward reversal on abort", while a DEFERRED one
 * (board/rescue goal; runPendingAutoAborts) applied it through
 * abortMission. The ruling: "An auto-abort can still pay if the mission
 * says it should. For example, there's a cheat plugin that offers a
 * mission that auto-aborts in order to immediately pay 900M credits."
 *
 * The rule both paths now follow: an auto-abort runs what the Bible ties
 * to the auto-abort itself — OnAbort (Flags 0x0001), the Pay under Flags2
 * 0x0002, the fuel under Flags 0x0008 — and NOT the 0x0040 reversal, which
 * punishes an abort the PLAYER chose (OnAbort is "evaluated when the
 * mission is aborted by the player"). No installed mission exercises the
 * deferred case with 0x0040 (the only deferred auto-aborts installed are
 * the four Refuel Traders, nova:141/650-652, without it), so it is pinned
 * on a hand-built one.
 */
describe('auto-aborts and the CompReward abort reversal (#320)', () => {
    /** A board-goal auto-abort: deferred to the boarding (see
     * deferredAutoAbort), with every flag that could cost the player. */
    function deferredMission(): MissionData {
        const mission = makeMission({
            id: 'nova:614', compGovt: 128, compReward: 3, payVal: -10129,
            shipCount: 1, shipGoal: 2 /* board */, onAbort: 'b7',
        });
        mission.flags = {
            ...mission.flags, autoAbort: true,
            lose5xCompRewardOnAbort: true, applyPayOnAutoAbort: true,
        };
        return mission;
    }

    /** Its offer as a përs that the special ship REPLACES makes it (përs
     * Flags 0x0040): the condition for the deferral. */
    function deferredOffer(mission: MissionData,
        machinery: ReturnType<typeof makeMachinery>): MissionOffer {
        return {
            ...makeMissionOffer(mission, machinery.offerContext())!,
            replacesPers: true,
        };
    }

    it('a DEFERRED auto-abort runs OnAbort and its Pay but no reversal',
        () => {
            const mission = deferredMission();
            const state = makeState({
                records: new Map([['nova:128', 10], ['nova:129', -40]]),
            });
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery, deferredOffer(mission, machinery));
            const active = state.missions.get(mission.id)!;
            expect(active.autoAbortOnBoard).toBeTrue();
            // The tick the owner boards the special ship, the sim marks it.
            active.autoAbortPending = true;

            expect(runPendingAutoAborts(machinery)).toBe(1);

            expect(state.missions.has(mission.id)).toBeFalse();
            // OnAbort ran (Flags 0x0001: "Any control bits pointed to by
            // the mission's OnAbort fields will be automatically set")...
            expect(state.bits.has(7)).toBeTrue();
            // ...the Pay did (Flags2 0x0002: PayVal -10129 cleans the
            // Auroran record)...
            expect(state.records!.get('nova:129')).toBe(0);
            // ...and the 0x0040 reversal did not: still 10, not 10 - 15.
            expect(state.records!.get('nova:128')).toBe(10);
        });

    it('a DEFERRED auto-abort adds its DatePostInc with the abort, not at '
        + 'the accept (reference "The deferred (përs) auto-abort (R16), '
        + 'wave 43": June 28th -> July 5th across the board)', () => {
            const mission = deferredMission();
            mission.datePostInc = 7;
            const state = makeState({});
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery, deferredOffer(mission, machinery));
            expect(state.dateAdvance).toBe(0);
            // Not pending yet (not boarded): nothing runs.
            expect(runDeferredAutoAbort(machinery, mission.id)).toBeFalse();
            expect(state.missions.has(mission.id)).toBeTrue();
            state.missions.get(mission.id)!.autoAbortPending = true;
            expect(runDeferredAutoAbort(machinery, mission.id)).toBeTrue();
            expect(state.missions.has(mission.id)).toBeFalse();
            expect(state.dateAdvance).toBe(7);
            // Once only.
            expect(runDeferredAutoAbort(machinery, mission.id)).toBeFalse();
            expect(runPendingAutoAborts(machinery)).toBe(0);
            expect(state.dateAdvance).toBe(7);
        });

    it('WITHOUT a përs replacement the same board-goal mission aborts at '
        + 'once (the original, reference #320 item 3 wave 11)', () => {
            // mïsn 1040 on the original: Flags 0x0001 + ShipGoal 5, no
            // përs, aborted when its ship appeared — OnAbort set, no
            // CompReward and no reversal — never waiting for a boarding.
            const mission = deferredMission();
            const state = makeState({
                records: new Map([['nova:128', 10], ['nova:129', -40]]),
            });
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            expect(state.missions.has(mission.id)).toBeFalse();
            expect(state.bits.has(7)).toBeTrue();
            expect(state.records!.get('nova:129')).toBe(0);
            expect(state.records!.get('nova:128')).toBe(10);
            expect(state.events.map(e => e.type)).toContain('autoAborted');
        });

    it('the same mission aborted BY THE PLAYER still costs 5x', () => {
        // The reversal is not gone, only kept to the abort it is for.
        const mission = deferredMission();
        const state = makeState({ records: new Map([['nova:128', 10]]) });
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery, deferredOffer(mission, machinery));
        abortMission(machinery, mission.id);
        expect(state.records!.get('nova:128')).toBe(10 - 15);
    });

    it('an immediate auto-abort pays 900M under Flags2 0x0002, whatever its '
        + 'CompReward flags', () => {
            // The ruling's example, in the shape Extra Outfits' "Leviathan
            // Income" (extra-outfits:1034) really has: Flags 0x0001 with
            // no ships, Flags2 0x0002 — plus a 0x0040 CompReward that must
            // not come back out of it.
            const mission = makeMission({
                id: 'nova:1034', payVal: 900_000_000, compGovt: 128,
                compReward: 3,
            });
            mission.flags = {
                ...mission.flags, autoAbort: true, applyPayOnAutoAbort: true,
                lose5xCompRewardOnAbort: true,
            };
            const state = makeState({
                credits: { credits: 0 }, records: new Map([['nova:128', 10]]),
            });
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            expect(state.missions.size).toBe(0);
            expect(state.credits.credits).toBe(900_000_000);
            expect(state.records!.get('nova:128')).toBe(10);
        });

    it('pins "SuperCash", the 899M cheat: it is NOT an auto-abort, and pays '
        + 'on the first landing back where it was taken', () => {
            // The only mission in the whole canonical Nova_Data paying
            // anything like 900M is mïsn 128 "SuperCash" in the
            // NOT-installed "Plug-ins 1/SuperCash" (so no data-gated spec
            // can load it). Its fields, read from the resource fork:
            // AvailLoc 0 (mission computer), AvailStel -1, AvailRandom 100,
            // TravelStel -1, ReturnStel -4 (the initial stellar), PayVal
            // 899,000,000, Flags 0x0000, Flags2 0x0000, no set strings,
            // briefing "Just take off and land". It pays by COMPLETING.
            const superCash = makeMission({
                id: 'nova:128', name: 'SuperCash', availLoc: 0,
                availStel: -1, availRandom: 100, travelStel: -1,
                returnStel: -4, returnStelId: null, payVal: 899_000_000,
                canAbort: true,
            });
            const state = makeState({ credits: { credits: 0 } });
            const machinery = makeMachinery(state, [superCash]);
            const offer = makeMissionOffer(superCash,
                machinery.offerContext())!;
            expect(offer.returnPlanet).toBe('nova:128');
            acceptOffer(machinery, offer);
            expect(state.missions.has('nova:128')).toBeTrue();
            expect(state.credits.credits).toBe(0);
            // "Just take off and land": the landing back at the stellar.
            processLanding(machinery, 'nova:128', 1001);
            expect(state.missions.size).toBe(0);
            expect(state.credits.credits).toBe(899_000_000);
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
