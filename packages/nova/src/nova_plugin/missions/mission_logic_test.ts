import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultRankData } from 'novadatainterface/rank_data';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import {
    abortMission,
    acceptOffer,
    failExpiredMissions,
    makeMissionOffer,
    matchesStellarRef,
    missionMapMarks,
    runPendingShipDone,
    MissionContext,
    MissionMachineryContext,
    missionMatchesLocation,
    MissionWorkingState,
    LOCATION_BAR,
    LOCATION_MAIN_SPACEPORT,
    LOCATION_MISSION_COMPUTER,
    processLanding,
    runMissionSetString,
    StellarInfo,
    stellarRecord,
    stellarVisible,
} from './mission_logic.js';
import {
    DISCOVERY_ENTERED, DISCOVERY_LANDED, DISCOVERY_UNKNOWN, DiscoveryLevel,
} from '../player/discovery.js';
import { ActiveMission, MAX_ACTIVE_MISSIONS, Missions } from '../player/player_state_plugin.js';

function makeStellar(partial: Partial<StellarInfo> = {}): StellarInfo {
    return {
        id: 'nova:128',
        govt: null,
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
        ...partial,
    };
}

function makeGovt(id: string, partial: Partial<GovtData> = {}): GovtData {
    return { ...getDefaultGovtData(), id, ...partial };
}

function makeContext(partial: Partial<MissionContext> = {}): MissionContext {
    return {
        stellar: makeStellar(),
        stellarCandidates: [
            makeStellar(),
            makeStellar({ id: 'nova:129' }),
            makeStellar({ id: 'nova:130', uninhabited: true }),
        ],
        bits: new Set<number>(),
        shipId: 'nova:164',
        activeMissions: new Map(),
        freeCargoSpace: 20,
        random: () => 0.5,
        getGovt: () => undefined,
        currentDay: 1000,
        ...partial,
    };
}

function makeState(partial: Partial<MissionWorkingState> = {}): MissionWorkingState {
    return {
        missions: new Map() as Missions,
        cargo: new Map(),
        credits: { credits: 1000 },
        bits: new Set<number>(),
        cargoCapacity: 20,
        dateAdvance: 0,
        events: [],
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
            ...ctxPartial,
        }),
        random: () => 0.5,
    };
}

describe('matchesStellarRef', () => {
    const fed = makeGovt('nova:128', {
        classes: [1], allies: [2], enemies: [3],
    });
    const ally = makeGovt('nova:129', { classes: [2] });
    const enemy = makeGovt('nova:130', { classes: [3] });
    const govts = new Map([[fed.id, fed], [ally.id, ally], [enemy.id, enemy]]);
    const getGovt = (id: string) => govts.get(id);

    it('matches any inhabited stellar for -1', () => {
        expect(matchesStellarRef(-1, null, makeStellar(), 'nova', getGovt))
            .toBe(true);
        expect(matchesStellarRef(-1, null,
            makeStellar({ uninhabited: true }), 'nova', getGovt)).toBe(false);
    });

    it('matches a specific stellar by resolved id', () => {
        expect(matchesStellarRef(128, 'nova:128', makeStellar(), 'nova',
            getGovt)).toBe(true);
        expect(matchesStellarRef(128, 'nova:128',
            makeStellar({ id: 'nova:129' }), 'nova', getGovt)).toBe(false);
    });

    it('matches independent stellars for 9999', () => {
        expect(matchesStellarRef(9999, null, makeStellar({ govt: null }),
            'nova', getGovt)).toBe(true);
        expect(matchesStellarRef(9999, null,
            makeStellar({ govt: 'nova:128' }), 'nova', getGovt)).toBe(false);
    });

    it('matches govt stellars for the 10000 range', () => {
        const stellar = makeStellar({ govt: 'nova:128' });
        expect(matchesStellarRef(10000, null, stellar, 'nova', getGovt))
            .toBe(true);
        expect(matchesStellarRef(10001, null, stellar, 'nova', getGovt))
            .toBe(false);
    });

    it('resolves a plug-in mission\'s govt number to STOCK or ITS OWN govt, '
        + 'never a third plug-in\'s (ARPIA 196 is not Planet Rico 196)', () => {
            const arpia = makeGovt('arpia:196', { classes: [4] });
            const rico = makeGovt('Planet Rico:196', { classes: [5] });
            const all = new Map([...govts, [arpia.id, arpia], [rico.id, rico]]);
            const get = (id: string) => all.get(id);
            // AvailStel 10068 = "any stellar of govt 196", from an ARPIA
            // mission: Gravit Station (Planet Rico:196) must not match.
            expect(matchesStellarRef(10068, null,
                makeStellar({ govt: 'Planet Rico:196' }), 'arpia', get))
                .toBe(false);
            expect(matchesStellarRef(10068, null,
                makeStellar({ govt: 'arpia:196' }), 'arpia', get)).toBe(true);
            // A plug-in mission naming a STOCK govt matches stock stellars.
            expect(matchesStellarRef(10000, null,
                makeStellar({ govt: 'nova:128' }), 'arpia', get)).toBe(true);
            // And the "not this govt" range is the exact complement.
            expect(matchesStellarRef(20068, null,
                makeStellar({ govt: 'Planet Rico:196' }), 'arpia', get))
                .toBe(true);
        });

    it('matches allies for the 15000 range', () => {
        // govt 128's allies are class 2; nova:129 is class 2.
        expect(matchesStellarRef(15000, null,
            makeStellar({ govt: 'nova:129' }), 'nova', getGovt)).toBe(true);
        // The govt itself also matches.
        expect(matchesStellarRef(15000, null,
            makeStellar({ govt: 'nova:128' }), 'nova', getGovt)).toBe(true);
        expect(matchesStellarRef(15000, null,
            makeStellar({ govt: 'nova:130' }), 'nova', getGovt)).toBe(false);
    });

    it('matches non-govt stellars for the 20000 range', () => {
        expect(matchesStellarRef(20000, null,
            makeStellar({ govt: 'nova:128' }), 'nova', getGovt)).toBe(false);
        expect(matchesStellarRef(20000, null,
            makeStellar({ govt: 'nova:129' }), 'nova', getGovt)).toBe(true);
    });

    it('matches enemies for the 25000 range', () => {
        expect(matchesStellarRef(25000, null,
            makeStellar({ govt: 'nova:130' }), 'nova', getGovt)).toBe(true);
        expect(matchesStellarRef(25000, null,
            makeStellar({ govt: 'nova:129' }), 'nova', getGovt)).toBe(false);
    });

    it('matches classmates for the 30000/31000 ranges', () => {
        const classmate = makeGovt('nova:131', { classes: [1, 7] });
        const withClassmate = new Map(govts);
        withClassmate.set(classmate.id, classmate);
        const get = (id: string) => withClassmate.get(id);
        expect(matchesStellarRef(30000, null,
            makeStellar({ govt: 'nova:131' }), 'nova', get)).toBe(true);
        expect(matchesStellarRef(31000, null,
            makeStellar({ govt: 'nova:131' }), 'nova', get)).toBe(false);
        expect(matchesStellarRef(31000, null,
            makeStellar({ govt: 'nova:130' }), 'nova', get)).toBe(true);
    });

    describe('the AvailStel 5000-7047 adjacent-system range', () => {
        // System topology: nova:200 links to nova:201; nova:202 is
        // unconnected. Stellars: 300 in system 200, 301 in system 201,
        // 302 in system 202.
        const adjacency = {
            systemOfStellar: (id: string) => ({
                'nova:300': 'nova:200',
                'nova:301': 'nova:201',
                'nova:302': 'nova:202',
            } as Record<string, string | undefined>)[id],
            systemsAdjacentOrEqual: (a: string, b: string) => {
                if (a === b) return true;
                const links: Record<string, string[]> = {
                    'nova:200': ['nova:201'],
                    'nova:201': ['nova:200'],
                    'nova:202': [],
                };
                return links[a]?.includes(b) ?? false;
            },
        };
        // ref 5072 -> target system 128 + (5072 - 5000) = 200.
        const refFor200 = 5000 + (200 - 128);

        it('matches a stellar in the target system itself', () => {
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:300' }), 'nova', getGovt, adjacency))
                .toBe(true);
        });

        it('matches a stellar in an adjacent system', () => {
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:301' }), 'nova', getGovt, adjacency))
                .toBe(true);
        });

        it('rejects a stellar in a non-adjacent system', () => {
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:302' }), 'nova', getGovt, adjacency))
                .toBe(false);
        });

        it('never matches without an adjacency resolver (fail closed)', () => {
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:300' }), 'nova', getGovt))
                .toBe(false);
        });

        it('resolves a plug-in mission\'s target system stock-first', () => {
            // A plug-in mïsn with AvailStel 5000+n where n is a STOCK
            // system offers adjacent to that system — the reference means
            // nova:200, not a phantom 'arpia:200'
            // (resolveNumberedResource, via the systemExists lookup).
            const systemExists = (id: string) =>
                ['nova:200', 'nova:201', 'nova:202'].includes(id);
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:301' }), 'arpia', getGovt,
                adjacency, systemExists)).toBe(true);
            // The plug-in's own private system number still resolves to
            // the plug-in when stock does not define it.
            expect(matchesStellarRef(refFor200, null,
                makeStellar({ id: 'nova:301' }), 'arpia', getGovt,
                adjacency, id => id === 'arpia:200')).toBe(false);
        });
    });
});

describe('missionMatchesLocation', () => {
    it('requires the location to match', () => {
        const mission = makeMission({ availLoc: LOCATION_BAR });
        const ctx = makeContext();
        expect(missionMatchesLocation(mission, LOCATION_BAR, ctx)).toBe(true);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER, ctx))
            .toBe(false);
    });

    it('matches the main-spaceport location distinctly (AvailLoc 3)', () => {
        // A main-spaceport (AvailLoc 3) mission is offered on landing,
        // not on the mission computer or in the bar.
        const mission = makeMission({ availLoc: LOCATION_MAIN_SPACEPORT });
        const ctx = makeContext();
        expect(missionMatchesLocation(mission, LOCATION_MAIN_SPACEPORT, ctx))
            .toBe(true);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER, ctx))
            .toBe(false);
        expect(missionMatchesLocation(mission, LOCATION_BAR, ctx)).toBe(false);
    });

    it('evaluates AvailBits against the real player bits', () => {
        const mission = makeMission({ availBits: 'b13 & !b14' });
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ bits: new Set([13]) }))).toBe(true);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ bits: new Set([13, 14]) }))).toBe(false);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext())).toBe(false);
    });

    it('fails closed on malformed AvailBits', () => {
        const mission = makeMission({ availBits: 'b13 &&& !!!' });
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ bits: new Set([13]) }))).toBe(false);
    });

    // mïsn Flags 0x2000 "Mission unavailable if player's ship is of
    // inherentAI type 1 or 2 (cargo ships)" / 0x4000 "... type 3 or 4
    // (warships)" — stock's six house duels nova:759-764 carry 0x2000.
    describe('the InherentAI gates (Flags 0x2000 / 0x4000, #106)', () => {
        const duel = makeMission({
            flags: { ...getDefaultMissionData().flags, notForCargoShips: true },
        });
        const milkRun = makeMission({
            flags: { ...getDefaultMissionData().flags, notForWarships: true },
        });
        const at = (mission: MissionData, shipInherentAI?: number) =>
            missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
                makeContext({ shipInherentAI }));

        it('keeps a duel from a freighter and a milk run from a warship',
            () => {
                expect(at(duel, 1)).toBe(false);
                expect(at(duel, 2)).toBe(false);
                expect(at(duel, 3)).toBe(true);
                expect(at(duel, 4)).toBe(true);
                expect(at(milkRun, 1)).toBe(true);
                expect(at(milkRun, 2)).toBe(true);
                expect(at(milkRun, 3)).toBe(false);
                expect(at(milkRun, 4)).toBe(false);
            });

        it('leaves both open when the ship\'s AI type is unknown', () => {
            expect(at(duel)).toBe(true);
            expect(at(milkRun)).toBe(true);
        });
    });

    it('judges AvailRecord at an independent stellar by STOCK govt 128, '
        + 'even for a plug-in\'s mission (#107)', () => {
            // Appendix II: an independent system is judged by "the first
            // government's [ID 128]". A plug-in mission used to key a
            // phantom `<plug>:128` record no crime ever writes.
            const fed = makeGovt('nova:128', { crimeTol: 6 });
            const getGovt = (id: string) => id === fed.id ? fed : undefined;
            const records = new Map([['nova:128', 40]]);
            expect(stellarRecord(makeStellar({ govt: null }), records,
                'arpia', getGovt)).toBe(40);
            const plugMission = makeMission({
                id: 'arpia:600', prefix: 'arpia', writerPrefix: 'arpia',
                availRecord: 30,
            });
            expect(missionMatchesLocation(plugMission,
                LOCATION_MISSION_COMPUTER,
                makeContext({ records, getGovt }))).toBe(true);
            expect(missionMatchesLocation(plugMission,
                LOCATION_MISSION_COMPUTER,
                makeContext({ records: new Map(), getGovt }))).toBe(false);
        });

    // Exxx in AvailBits: "Returns 1 if the player has explored system ID
    // xxx" (Bible :157) — a mission that only turns up once the pilot has
    // been somewhere.
    describe('Exxx in AvailBits', () => {
        const mission = makeMission({ availBits: 'E130 & !E162' });
        /** A context whose record holds exactly `explored`. */
        const ctx = (explored: string[], systems = ['nova:130', 'nova:162']) =>
            makeContext({
                discovery: {
                    level: id => explored.includes(id)
                        ? DISCOVERY_ENTERED : DISCOVERY_UNKNOWN,
                    markVisited: () => { },
                },
                systemExists: id => systems.includes(id),
            });
        const offers = (c: MissionContext) =>
            missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER, c);

        it('reads the pilot\'s discovery record', () => {
            expect(offers(ctx(['nova:130']))).toBe(true);
            expect(offers(ctx([]))).toBe(false);
            expect(offers(ctx(['nova:130', 'nova:162']))).toBe(false);
        });

        it('is true at "landed within" too, not just "visited"', () => {
            expect(offers(makeContext({
                discovery: {
                    level: id => id === 'nova:130'
                        ? DISCOVERY_LANDED : DISCOVERY_UNKNOWN,
                    markVisited: () => { },
                },
                systemExists: () => true,
            }))).toBe(true);
        });

        it('scopes the sÿst number stock-first, then the mission\'s own '
            + 'plug-in', () => {
                // A plug-in mission's E130 means stock's 130 when stock has
                // one, and the plug-in's own 130 only when it does not.
                const pluginMission = makeMission({
                    id: 'arpia:900', availBits: 'E130',
                });
                const asks: string[] = [];
                const context = (stockHas130: boolean) => makeContext({
                    discovery: {
                        level: id => {
                            asks.push(id);
                            return DISCOVERY_ENTERED;
                        },
                        markVisited: () => { },
                    },
                    systemExists: id =>
                        id === 'arpia:130' || (stockHas130 && id === 'nova:130'),
                });
                missionMatchesLocation(pluginMission,
                    LOCATION_MISSION_COMPUTER, context(true));
                missionMatchesLocation(pluginMission,
                    LOCATION_MISSION_COMPUTER, context(false));
                expect(asks).toEqual(['nova:130', 'arpia:130']);
            });

        it('is false for a sÿst id no loaded data set defines', () => {
            spyOn(console, 'warn');
            const missing = makeMission({ availBits: 'E9999' });
            expect(missionMatchesLocation(missing, LOCATION_MISSION_COMPUTER,
                ctx(['nova:9999'], []))).toBe(false);
        });

        it('is false when the caller has no discovery record at all', () => {
            // The unwired default; see ncb.ts's hasExplored.
            expect(offers(makeContext())).toBe(false);
        });
    });

    it('never offers a mission that is already active', () => {
        const mission = makeMission();
        const activeMissions: Missions = new Map([[mission.id, {
            id: mission.id, acceptedDay: 0, acceptedAt: 'nova:128',
            travelPlanet: null, returnPlanet: null, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null,
        }]]);
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ activeMissions }))).toBe(false);
    });

    it('offers every ship goal, board and rescue included', () => {
            // Destroy goals are supported now (mission_ship_logic.ts).
            expect(missionMatchesLocation(makeMission({
                shipGoal: 0, shipCount: 3, shipDudeId: 'nova:240',
            }), LOCATION_MISSION_COMPUTER, makeContext())).toBe(true);
            // Board (2) is offered now that boarding is real.
            expect(missionMatchesLocation(makeMission({
                shipGoal: 2, shipCount: 1, shipDudeId: 'nova:240',
            }), LOCATION_MISSION_COMPUTER, makeContext())).toBe(true);
            // Rescue (5) is offered too, now that "they start out
            // disabled and stay that way" is the hulk state.
            expect(missionMatchesLocation(makeMission({
                shipGoal: 5, shipCount: 1, shipDudeId: 'nova:240',
            }), LOCATION_MISSION_COMPUTER, makeContext())).toBe(true);
        });

    describe('Oxxx in AvailBits', () => {
        it('sees the player\'s outfits (nova:649 "Renew darts", '
            + '`b371 & !O226`)', () => {
                const renew = makeMission({ availBits: 'b371 & !O226' });
                const bits = new Set([371]);
                // Holding a Dart: not offered.
                expect(missionMatchesLocation(renew, LOCATION_MISSION_COMPUTER,
                    makeContext({
                        bits,
                        ownedOutfits: new Map([['nova:226', 2]]),
                    }))).toBe(false);
                // All darts gone: offered (three more are on their way).
                expect(missionMatchesLocation(renew, LOCATION_MISSION_COMPUTER,
                    makeContext({
                        bits,
                        ownedOutfits: new Map([['nova:226', 0]]),
                    }))).toBe(true);
                expect(missionMatchesLocation(renew, LOCATION_MISSION_COMPUTER,
                    makeContext({ bits, ownedOutfits: new Map() })))
                    .toBe(true);
            });

        it('is false without an outfits map (the unwired default)', () => {
            expect(missionMatchesLocation(makeMission({ availBits: 'O226' }),
                LOCATION_MISSION_COMPUTER, makeContext())).toBe(false);
            expect(missionMatchesLocation(makeMission({ availBits: '!O226' }),
                LOCATION_MISSION_COMPUTER, makeContext())).toBe(true);
        });

        it('resolves the oütf number stock-first, never to a third '
            + 'plug-in\'s outfit', () => {
                const mission = makeMission({
                    id: 'plug:900', writerPrefix: 'plug', availBits: 'O226',
                });
                const at = (owned: [string, number][]) =>
                    missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
                        makeContext({ ownedOutfits: new Map(owned) }));
                expect(at([['nova:226', 1]])).toBe(true);
                expect(at([['plug:226', 1]])).toBe(true);
                expect(at([['other:226', 1]])).toBe(false);
            });
    });

    it('gates a mïsn Flags 0x0008 mission on 100 units of fuel', () => {
        // "(mission won't be offered if player has less than 100 units of
        // fuel)" — the Refuel Traders, nova:141/650-652.
        const trader = makeMission();
        trader.flags = { ...trader.flags, remove100FuelOnAutoAbort: true };
        expect(missionMatchesLocation(trader, LOCATION_MISSION_COMPUTER,
            makeContext({ fuel: 30 }))).toBe(false);
        expect(missionMatchesLocation(trader, LOCATION_MISSION_COMPUTER,
            makeContext({ fuel: 100 }))).toBe(true);
        // No reading at all leaves the gate open.
        expect(missionMatchesLocation(trader, LOCATION_MISSION_COMPUTER,
            makeContext())).toBe(true);
        // Without the flag the tank is nobody's business.
        expect(missionMatchesLocation(makeMission(), LOCATION_MISSION_COMPUTER,
            makeContext({ fuel: 0 }))).toBe(true);
    });

    it('gates a Require mask on the player Contribute mask', () => {
        const mission = makeMission({ require: '3' }); // bits 0x1 | 0x2
        // No contribute: the requirement is unmet.
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext())).toBe(false);
        // Partial cover is still unmet.
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ playerContribute: 0x1n }))).toBe(false);
        // Full cover passes.
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ playerContribute: 0x3n }))).toBe(true);
        // Extra contribute bits don't hurt.
        expect(missionMatchesLocation(mission, LOCATION_MISSION_COMPUTER,
            makeContext({ playerContribute: 0xFFn }))).toBe(true);
    });

    it('restricts by ship type', () => {
        const mustFly = makeMission({ availShipType: 164 });
        const mustNotFly = makeMission({ availShipType: 1164 });
        const ctx = makeContext({ shipId: 'nova:164' });
        expect(missionMatchesLocation(mustFly, LOCATION_MISSION_COMPUTER, ctx))
            .toBe(true);
        expect(missionMatchesLocation(mustNotFly, LOCATION_MISSION_COMPUTER,
            ctx)).toBe(false);
    });

    it('restricts by ship type across the full Bible range (128-895)', () => {
        // A high-id ship (>255) must still match a 128-895 restriction.
        const mustFly = makeMission({ availShipType: 500 });
        expect(missionMatchesLocation(mustFly, LOCATION_MISSION_COMPUTER,
            makeContext({ shipId: 'nova:500' }))).toBe(true);
        expect(missionMatchesLocation(mustFly, LOCATION_MISSION_COMPUTER,
            makeContext({ shipId: 'nova:164' }))).toBe(false);
    });

    it('restricts by the ship\'s inherent govt (2128+/3128+)', () => {
        // 2128 + (govt 130 - 128) = 2130: must fly a ship of govt 130.
        const mustBeGovt130 = makeMission({ availShipType: 2130 });
        const mustNotBeGovt130 = makeMission({ availShipType: 3130 });
        const govt130 = makeContext({ shipGovt: 'nova:130' });
        const govt129 = makeContext({ shipGovt: 'nova:129' });
        const noGovt = makeContext({ shipGovt: null });

        expect(missionMatchesLocation(mustBeGovt130,
            LOCATION_MISSION_COMPUTER, govt130)).toBe(true);
        expect(missionMatchesLocation(mustBeGovt130,
            LOCATION_MISSION_COMPUTER, govt129)).toBe(false);
        expect(missionMatchesLocation(mustBeGovt130,
            LOCATION_MISSION_COMPUTER, noGovt)).toBe(false);

        expect(missionMatchesLocation(mustNotBeGovt130,
            LOCATION_MISSION_COMPUTER, govt130)).toBe(false);
        expect(missionMatchesLocation(mustNotBeGovt130,
            LOCATION_MISSION_COMPUTER, govt129)).toBe(true);
        // A ship with no inherent govt is "not of govt 130".
        expect(missionMatchesLocation(mustNotBeGovt130,
            LOCATION_MISSION_COMPUTER, noGovt)).toBe(true);
    });
});

describe('stellarVisible', () => {
    it('treats a stellar with no visibility info as visible', () => {
        expect(stellarVisible(makeStellar(), new Set())).toBe(true);
    });

    it('treats a blank Visibility expression as always visible', () => {
        expect(stellarVisible(
            makeStellar({ systemVisibilities: ['', '   '] }), new Set()))
            .toBe(true);
    });

    it('evaluates the Visibility NCB test against the player bits', () => {
        const hidden = makeStellar({ systemVisibilities: ['b88 | b3009'] });
        expect(stellarVisible(hidden, new Set())).toBe(false);
        expect(stellarVisible(hidden, new Set([88]))).toBe(true);
    });

    it('is visible when ANY containing system is visible', () => {
        // A stellar listed by two stacked systems with mutually exclusive
        // Visibility expressions is always visible through one of them.
        const stellar = makeStellar({
            systemVisibilities: ['!b88', 'b88'],
        });
        expect(stellarVisible(stellar, new Set())).toBe(true);
        expect(stellarVisible(stellar, new Set([88]))).toBe(true);
    });

    it('stays visible when a Visibility expression is malformed', () => {
        expect(stellarVisible(
            makeStellar({ systemVisibilities: ['b('] }), new Set()))
            .toBe(true);
    });
});

describe('makeMissionOffer', () => {
    it('resolves a random inhabited destination (-2)', () => {
        const mission = makeMission({ travelStel: -2 });
        const offer = makeMissionOffer(mission, makeContext());
        // The only inhabited candidate that isn't the current stellar.
        expect(offer?.travelPlanet).toBe('nova:129');
    });

    it('never samples a currently-hidden duplicate stellar (-2)', () => {
        // Two same-position inhabited destinations: one visible, one hidden
        // behind an unset story bit. The random pick must be the visible one.
        const mission = makeMission({ travelStel: -2 });
        const ctx = makeContext({
            stellarCandidates: [
                makeStellar(),  // current stellar (nova:128), excluded
                makeStellar({ id: 'nova:214', systemVisibilities: ['!b6300'] }),
                makeStellar({ id: 'nova:503', systemVisibilities: ['b6300'] }),
            ],
        });
        // No bits set: only nova:214 is visible.
        expect(makeMissionOffer(mission, ctx)?.travelPlanet).toBe('nova:214');
    });

    it('samples a govt-ranged destination only from visible stellars', () => {
        const fed = makeGovt('nova:128', { classes: [1] });
        const mission = makeMission({ travelStel: 10000 }); // govt 128
        const ctx = makeContext({
            stellar: makeStellar({ id: 'nova:900' }),
            getGovt: id => (id === 'nova:128' ? fed : undefined),
            stellarCandidates: [
                makeStellar({ id: 'nova:214', govt: 'nova:128',
                    systemVisibilities: ['!b6300'] }),
                makeStellar({ id: 'nova:503', govt: 'nova:128',
                    systemVisibilities: ['b6300'] }),
            ],
        });
        expect(makeMissionOffer(mission, ctx)?.travelPlanet).toBe('nova:214');
    });

    it('resolves the return stellar -4 to the offering stellar', () => {
        const mission = makeMission({ returnStel: -4 });
        const offer = makeMissionOffer(mission, makeContext());
        expect(offer?.returnPlanet).toBe('nova:128');
    });

    it('returns null when a destination cannot be resolved', () => {
        const mission = makeMission({ travelStel: -3 });
        const ctx = makeContext({
            stellarCandidates: [makeStellar()], // no uninhabited candidates
        });
        expect(makeMissionOffer(mission, ctx)).toBe(null);
    });

    it('resolves randomized cargo quantities (±50%)', () => {
        const mission = makeMission({ cargoType: 2, cargoQty: -10 });
        const low = makeMissionOffer(mission,
            makeContext({ random: () => 0 }));
        const high = makeMissionOffer(mission,
            makeContext({ random: () => 0.999 }));
        expect(low?.cargoQty).toBe(5);
        expect(high?.cargoQty).toBe(15);
    });

    it('resolves random cargo type (1000) to a standard type', () => {
        const mission = makeMission({ cargoType: 1000, cargoQty: 5 });
        const offer = makeMissionOffer(mission, makeContext());
        expect(offer?.cargoType).toBeGreaterThanOrEqual(0);
        expect(offer?.cargoType).toBeLessThanOrEqual(5);
    });

    it('marks the offer unacceptable when the cargo does not fit', () => {
        const mission = makeMission({ cargoType: 0, cargoQty: 50 });
        const offer = makeMissionOffer(mission,
            makeContext({ freeCargoSpace: 20 }));
        expect(offer?.acceptable).toBe(false);
        expect(offer?.reason).toContain('cargo space');
    });

    it('hides the offer entirely with the insufficient-space flag', () => {
        const mission = makeMission({ cargoType: 0, cargoQty: 50 });
        mission.flags = {
            ...mission.flags,
            notOfferedIfInsufficientCargoSpace: true,
        };
        expect(makeMissionOffer(mission, makeContext({ freeCargoSpace: 20 })))
            .toBe(null);
    });

    it('hides a LATER-pickup mission with the flag too (Flags2 0x0001, '
        + '"even if the mission cargo won\'t be picked up until later")',
        () => {
            // nova:429 "Federation Resupply;Fed2": 20 t, PickupMode 1,
            // the flag set. Offered to a 5-ton hold it would be accepted
            // and stall silently at its travel stellar.
            for (const pickupMode of [1, 2]) {
                const mission = makeMission({
                    cargoType: 7, cargoQty: 20, pickupMode,
                });
                mission.flags = {
                    ...mission.flags,
                    notOfferedIfInsufficientCargoSpace: true,
                };
                expect(makeMissionOffer(mission,
                    makeContext({ freeCargoSpace: 5 })))
                    .withContext(`pickupMode ${pickupMode}`).toBe(null);
                // Enough room: offered, and acceptable (the cargo does
                // not load now, so the "must fit now" check is moot).
                expect(makeMissionOffer(mission,
                    makeContext({ freeCargoSpace: 20 }))?.acceptable)
                    .withContext(`pickupMode ${pickupMode}`).toBe(true);
            }
            // Without the flag a later-pickup mission is still offered
            // to a hold that cannot take it (the pre-existing behaviour;
            // the stall is the scenario author's to prevent).
            const unflagged = makeMission({
                cargoType: 7, cargoQty: 20, pickupMode: 1,
            });
            expect(makeMissionOffer(unflagged,
                makeContext({ freeCargoSpace: 5 }))?.acceptable).toBe(true);
        });

    it('enforces the active mission cap', () => {
        const activeMissions: Missions = new Map();
        for (let i = 0; i < MAX_ACTIVE_MISSIONS; i++) {
            activeMissions.set(`nova:${300 + i}`, {
                id: `nova:${300 + i}`, acceptedDay: 0, acceptedAt: 'nova:128',
                travelPlanet: null, returnPlanet: null, cargoType: -1,
                cargoQty: 0, cargoLoaded: false, travelDone: false,
                deadlineDay: null,
            });
        }
        const offer = makeMissionOffer(makeMission(),
            makeContext({ activeMissions }));
        expect(offer?.acceptable).toBe(false);
        expect(offer?.reason).toContain('16');
    });
});

describe('accept / landing / completion flow', () => {
    it('runs a delivery mission end to end', () => {
        const mission = makeMission({
            id: 'nova:200',
            name: 'Delivery',
            travelStel: -1,
            returnStel: 129,
            returnStelId: 'nova:129',
            cargoType: 2,
            cargoQty: 10,
            pickupMode: 0,
            dropOffMode: 1,
            payVal: 15000,
            timeLimit: 30,
            onAccept: 'b100',
            onSuccess: 'b101 !b100',
            completionText: 'Thanks for the delivery.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);

        const offer = makeMissionOffer(mission, machinery.offerContext());
        expect(offer).not.toBe(null);
        expect(offer!.acceptable).toBe(true);

        acceptOffer(machinery, offer!);
        expect(state.missions.size).toBe(1);
        const active = state.missions.get('nova:200')!;
        expect(active.cargoLoaded).toBe(true);
        expect(state.cargo.get('mission:nova:200')).toBe(10);
        expect(state.bits.has(100)).toBe(true);
        expect(active.deadlineDay).toBe(1030);

        // Landing somewhere else does nothing.
        processLanding(machinery, 'nova:131', 1005);
        expect(state.missions.size).toBe(1);
        expect(state.events.filter(e => e.type === 'completed').length)
            .toBe(0);

        // Landing at the return stellar completes, pays, runs OnSuccess.
        processLanding(machinery, 'nova:129', 1010);
        expect(state.missions.size).toBe(0);
        expect(state.cargo.has('mission:nova:200')).toBe(false);
        expect(state.credits.credits).toBe(16000);
        expect(state.bits.has(101)).toBe(true);
        expect(state.bits.has(100)).toBe(false);
        const completed = state.events.find(e => e.type === 'completed')!;
        expect(completed.missionName).toBe('Delivery');
        expect(completed.payment).toBe(15000);
        expect(completed.text).toBe('Thanks for the delivery.');
    });

    it('completes when landing on a duplicate of the return stellar', () => {
        // The Bible: a travel/return objective is fulfilled by landing on a
        // duplicate stellar with the identical name and coordinates. The
        // mission is frozen to nova:503 (a hidden Brass duplicate) but the
        // player lands on nova:214 (the visible Brass); sameStellar bridges
        // them so the mission still completes and pays.
        const mission = makeMission({
            id: 'nova:211',
            name: 'Delivery to <DST>',
            travelStel: 10000,
            returnStel: -1,
            cargoType: 0,
            cargoQty: 2,
            pickupMode: 0,
            dropOffMode: 0,
            payVal: 15000,
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        machinery.sameStellar = (a, b) =>
            a === b || (a === 'nova:503' && b === 'nova:214')
            || (a === 'nova:214' && b === 'nova:503');

        acceptOffer(machinery, {
            data: mission, travelPlanet: 'nova:503', returnPlanet: null,
            cargoType: 0, cargoQty: 2, acceptable: true,
        });
        expect(state.missions.size).toBe(1);

        // Landing on the visible duplicate completes the mission.
        processLanding(machinery, 'nova:214', 1005);
        expect(state.missions.size).toBe(0);
        expect(state.credits.credits).toBe(16000);
        expect(state.events.find(e => e.type === 'completed')?.missionId)
            .toBe('nova:211');
    });

    it('completes two missions bound to the same stellar on one landing',
        () => {
            const make = (id: string) => makeMission({
                id, name: `Delivery ${id}`,
                travelStel: 10000, returnStel: -1,
                cargoType: 0, cargoQty: 1, pickupMode: 0, dropOffMode: 0,
                payVal: 15000,
            });
            const m1 = make('nova:211');
            const m2 = make('nova:418');
            const state = makeState();
            const machinery = makeMachinery(state, [m1, m2]);

            for (const m of [m1, m2]) {
                acceptOffer(machinery, {
                    data: m, travelPlanet: 'nova:214', returnPlanet: null,
                    cargoType: 0, cargoQty: 1, acceptable: true,
                });
            }
            expect(state.missions.size).toBe(2);

            processLanding(machinery, 'nova:214', 1005);
            expect(state.missions.size).toBe(0);
            const completed = state.events
                .filter(e => e.type === 'completed')
                .map(e => e.missionId).sort();
            expect(completed).toEqual(['nova:211', 'nova:418']);
            expect(state.credits.credits).toBe(1000 + 15000 + 15000);
        });

    it('handles a two-leg mission (travel then return)', () => {
        const mission = makeMission({
            id: 'nova:201',
            travelStel: 130,
            travelStelId: 'nova:130',
            returnStel: -4,
            cargoType: 1,
            cargoQty: 5,
            pickupMode: 1,   // pick up at travel stellar
            dropOffMode: 1,  // drop off at return
            payVal: 5000,
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        const offer = makeMissionOffer(mission, machinery.offerContext());
        acceptOffer(machinery, offer!);

        const active = state.missions.get('nova:201')!;
        expect(active.returnPlanet).toBe('nova:128');
        // Cargo is not loaded at accept (pickup at travel).
        expect(active.cargoLoaded).toBe(false);

        // Landing at the return stellar first does NOT complete.
        processLanding(machinery, 'nova:128', 1001);
        expect(state.missions.size).toBe(1);

        // Landing at the travel stellar picks up the cargo.
        processLanding(machinery, 'nova:130', 1002);
        expect(active.travelDone).toBe(true);
        expect(state.cargo.get('mission:nova:201')).toBe(5);

        // Now the return stellar completes.
        processLanding(machinery, 'nova:128', 1003);
        expect(state.missions.size).toBe(0);
        expect(state.credits.credits).toBe(6000);
    });

    it('emits the cargo-transfer dësc texts as landing events '
        + '(the Kontik probe shape: silent drop reads as a stuck mission)',
        () => {
            const mission = makeMission({
                id: 'nova:830',
                travelStel: 315,
                travelStelId: 'nova:315',
                returnStel: -4,
                cargoType: 1,
                cargoQty: 5,
                pickupMode: 1,   // pick up at travel stellar
                dropOffMode: 0,  // drop off at travel stellar too
                payVal: 50000,
                loadCargoText: 'You take the probe aboard.',
                dropOffCargoText: 'You launch the probe over <DST>.',
            });
            const state = makeState();
            const machinery = makeMachinery(state, [mission]);
            const offer = makeMissionOffer(mission, machinery.offerContext());
            acceptOffer(machinery, offer!);

            processLanding(machinery, 'nova:315', 1001);
            const loaded = state.events.find(e => e.type === 'cargoLoaded');
            const dropped = state.events.find(e => e.type === 'cargoDropped');
            expect(loaded?.text).toBe('You take the probe aboard.');
            expect(dropped?.text).toBe('You launch the probe over <DST>.');
            // One event per transfer: a later landing at the same stellar
            // (travel already done) must not repeat them.
            processLanding(machinery, 'nova:315', 1002);
            expect(state.events.filter(e => e.type === 'cargoDropped').length)
                .toBe(1);
        });

    it('shows the DropCargText at the RETURN stop before the CompText for '
        + 'DropOffMode 1, even with no cargo (the Polaris martial-arts shape)',
        () => {
            // mïsn nova:167/172: no cargo, DropOffMode 1, both a DropCargText
            // and a CompText — the original lands to two boxes in a row.
            const mission = makeMission({
                id: 'nova:167',
                travelStel: -1,
                returnStel: -4,
                cargoType: -1, cargoQty: -1,
                pickupMode: 0, dropOffMode: 1,
                payVal: 0,
                dropOffCargoText: 'You head over to Eamon\'s office.',
                completionText: 'Time after time he makes you submit.',
            });
            const state = makeState();
            const machinery = makeMachinery(state, [mission]);
            const offer = makeMissionOffer(mission, machinery.offerContext());
            acceptOffer(machinery, offer!);

            processLanding(machinery, 'nova:128', 1001);
            expect(state.missions.size).toBe(0);
            const kinds = state.events.map(e => e.type);
            expect(kinds.indexOf('cargoDropped')).toBeGreaterThanOrEqual(0);
            expect(kinds.indexOf('cargoDropped'))
                .toBeLessThan(kinds.indexOf('completed'));
            const dropped = state.events.find(e => e.type === 'cargoDropped');
            expect(dropped?.text).toBe('You head over to Eamon\'s office.');
            expect(dropped?.stop).toBe('return');
        });

    it('emits no cargo-transfer events when the dësc ids are unset', () => {
        const mission = makeMission({
            id: 'nova:211',
            travelStel: 130,
            travelStelId: 'nova:130',
            returnStel: -1,
            cargoType: 0, cargoQty: 1, pickupMode: 0, dropOffMode: 0,
            payVal: 100,
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        const offer = makeMissionOffer(mission, machinery.offerContext());
        acceptOffer(machinery, offer!);
        processLanding(machinery, 'nova:130', 1001);
        expect(state.events.some(e => e.type === 'cargoLoaded'
            || e.type === 'cargoDropped')).toBeFalse();
    });

    // The real MissionSession recomputes freeCargoSpace from the current
    // cargo on every offerContext() call; the default makeMachinery freezes
    // it. This variant mirrors the session so accept-time re-checks (L3/L4)
    // see cargo committed by earlier accepts.
    function makeMachineryLiveCargo(state: MissionWorkingState,
        missionData: MissionData[]): MissionMachineryContext {
        const byId = new Map(missionData.map(m => [m.id, m]));
        return {
            state,
            getMission: id => byId.get(id),
            offerContext: () => {
                const used = [...state.cargo.values()].reduce((a, b) => a + b, 0);
                return makeContext({
                    bits: state.bits,
                    activeMissions: state.missions,
                    freeCargoSpace: state.cargoCapacity - used,
                });
            },
            random: () => 0.5,
        };
    }

    it('refuses a second cargo mission that no longer fits the hold (L3)', () => {
        // Two 8-ton pickupMode-0 missions, 10 tons free: the first fits,
        // the second must be refused (its frozen offer is stale) and must
        // NOT become an active mission that later completes without cargo.
        const first = makeMission({
            id: 'nova:220', name: 'First', cargoType: 0, cargoQty: 8,
            pickupMode: 0, returnStel: 129, returnStelId: 'nova:129',
            payVal: 1000,
        });
        const second = makeMission({
            id: 'nova:221', name: 'Second', cargoType: 0, cargoQty: 8,
            pickupMode: 0, returnStel: 129, returnStelId: 'nova:129',
            payVal: 5000,
        });
        const state = makeState({ cargoCapacity: 10 });
        const machinery = makeMachineryLiveCargo(state, [first, second]);

        // Both offers look acceptable when the board opens (10 >= 8 each).
        const offerA = makeMissionOffer(first, machinery.offerContext())!;
        const offerB = makeMissionOffer(second, machinery.offerContext())!;
        expect(offerA.acceptable).toBe(true);
        expect(offerB.acceptable).toBe(true);

        expect(acceptOffer(machinery, offerA).accepted).toBe(true);
        expect(state.missions.get('nova:220')!.cargoLoaded).toBe(true);

        // The second no longer fits (only 2 tons free): refused cleanly.
        const result = acceptOffer(machinery, offerB);
        expect(result.accepted).toBe(false);
        if (!result.accepted) {
            expect(result.reason).toContain('cargo space');
        }
        expect(state.missions.has('nova:221')).toBe(false);

        // Completing at the return stellar pays ONLY the first mission.
        const creditsBefore = state.credits.credits;
        processLanding(machinery, 'nova:129', 1001);
        expect(state.credits.credits).toBe(creditsBefore + 1000);
        expect(state.events.some(
            e => e.type === 'completed' && e.missionName === 'Second'))
            .toBe(false);
    });

    it('refuses a stale offer that would exceed the mission cap (L4)', () => {
        const state = makeState();
        // Fill to one below the cap with cargo-free missions.
        const filler: MissionData[] = [];
        for (let i = 0; i < MAX_ACTIVE_MISSIONS - 1; i++) {
            const m = makeMission({
                id: `nova:${400 + i}`, returnStel: 129, returnStelId: 'nova:129',
            });
            filler.push(m);
        }
        const a = makeMission({
            id: 'nova:450', name: 'A', returnStel: 129, returnStelId: 'nova:129',
        });
        const b = makeMission({
            id: 'nova:451', name: 'B', returnStel: 129, returnStelId: 'nova:129',
        });
        const machinery = makeMachineryLiveCargo(state, [...filler, a, b]);
        for (const m of filler) {
            acceptOffer(machinery,
                makeMissionOffer(m, machinery.offerContext())!);
        }
        expect(state.missions.size).toBe(MAX_ACTIVE_MISSIONS - 1);

        // Both offers frozen at size 15 (acceptable). Accepting A hits the
        // cap; B must then be refused rather than exceeding it.
        const offerA = makeMissionOffer(a, machinery.offerContext())!;
        const offerB = makeMissionOffer(b, machinery.offerContext())!;
        expect(offerA.acceptable).toBe(true);
        expect(offerB.acceptable).toBe(true);

        expect(acceptOffer(machinery, offerA).accepted).toBe(true);
        expect(state.missions.size).toBe(MAX_ACTIVE_MISSIONS);

        const result = acceptOffer(machinery, offerB);
        expect(result.accepted).toBe(false);
        if (!result.accepted) {
            expect(result.reason).toContain('16');
        }
        expect(state.missions.has('nova:451')).toBe(false);
        expect(state.missions.size).toBe(MAX_ACTIVE_MISSIONS);
    });

    it('does not complete a mission aborted by another mission\'s ' +
        'OnSuccess during the same landing (M1)', () => {
        // Two active missions share a return stellar. A's OnSuccess
        // aborts C via an Axxx set string. Landing processes A first
        // (removing C from state.missions), but the loop iterates a
        // snapshot: C must NOT be completed/paid.
        const missionA = makeMission({
            id: 'nova:200',
            name: 'A',
            returnStel: 129,
            returnStelId: 'nova:129',
            payVal: 1000,
            onSuccess: 'a203', // aborts mission C
        });
        const missionC = makeMission({
            id: 'nova:203',
            name: 'C',
            returnStel: 129,
            returnStelId: 'nova:129',
            payVal: 5000,
            onSuccess: 'b99', // proof it did NOT run
        });
        const state = makeState();
        const machinery = makeMachinery(state, [missionA, missionC]);
        // Accept A first so it is iterated first (Map insertion order).
        acceptOffer(machinery,
            makeMissionOffer(missionA, machinery.offerContext())!);
        acceptOffer(machinery,
            makeMissionOffer(missionC, machinery.offerContext())!);
        expect(state.missions.size).toBe(2);

        const creditsBefore = state.credits.credits;
        processLanding(machinery, 'nova:129', 1001);

        // A completed and paid.
        expect(state.events.some(
            e => e.type === 'completed' && e.missionName === 'A')).toBe(true);
        // C was aborted, NOT completed: no completion event, no OnSuccess.
        expect(state.events.some(
            e => e.type === 'completed' && e.missionName === 'C')).toBe(false);
        expect(state.events.some(
            e => e.type === 'aborted' && e.missionName === 'C')).toBe(true);
        expect(state.bits.has(99)).toBe(false);
        // C's 5000 payVal was not applied; only A's 1000.
        expect(state.credits.credits).toBe(creditsBefore + 1000);
        expect(state.missions.size).toBe(0);
    });

    it('fails a mission whose deadline passed, running OnFailure', () => {
        const mission = makeMission({
            id: 'nova:202',
            returnStel: 129,
            returnStelId: 'nova:129',
            timeLimit: 5,
            onFailure: 'b666',
            failText: 'You blew it.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);

        processLanding(machinery, 'nova:131', 1010); // day > 1005
        expect(state.missions.size).toBe(0);
        expect(state.bits.has(666)).toBe(true);
        const failed = state.events.find(e => e.type === 'failed')!;
        expect(failed.text).toBe('You blew it.');
    });

    it('fails an expired deadline via failExpiredMissions (in flight)', () => {
        const mission = makeMission({
            id: 'nova:202',
            returnStel: 129,
            returnStelId: 'nova:129',
            timeLimit: 5,
            onFailure: 'b666',
            failText: 'Out of time.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        // Accepted at day 1000, deadline day 1005.
        expect(failExpiredMissions(machinery, 1003)).toBe(0);
        expect(state.missions.size).toBe(1);
        // The day passes the deadline: fails immediately, no landing.
        expect(failExpiredMissions(machinery, 1006)).toBe(1);
        expect(state.missions.size).toBe(0);
        expect(state.bits.has(666)).toBe(true);
        expect(state.events.find(e => e.type === 'failed')?.text)
            .toBe('Out of time.');
    });

    it('fails a mission the sim marked failed (player disable/destroy)', () => {
        const mission = makeMission({
            id: 'nova:205',
            returnStel: 129,
            returnStelId: 'nova:129',
            onFailure: 'b77',
            failText: 'You were disabled.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        // The shared sim sets active.failed on a disable/destroy.
        state.missions.get('nova:205')!.failed = true;
        // No deadline, but failExpiredMissions still fails it.
        expect(failExpiredMissions(machinery, 1001)).toBe(1);
        expect(state.missions.size).toBe(0);
        expect(state.bits.has(77)).toBe(true);
        expect(state.events.find(e => e.type === 'failed')?.text)
            .toBe('You were disabled.');
    });

    it('runs OnShipDone when the sim marks the goal done (in flight)', () => {
        const mission = makeMission({
            id: 'nova:207',
            shipGoal: 0, shipCount: 2, shipDudeId: 'nova:240',
            returnStel: 129, returnStelId: 'nova:129',
            onShipDone: 'b88',
            shipDoneText: 'Targets eliminated.',
        });
        const state = makeState();
        // Special-ship resolution needs system topology in the context.
        const machinery = makeMachinery(state, [mission], {
            systems: [{ id: 'nova:200', govt: null, links: [] }],
            systemIdOfStellar: () => 'nova:200',
        });
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        const active = state.missions.get('nova:207')!;
        // Nothing pending yet.
        expect(runPendingShipDone(machinery)).toBe(0);
        // The shared sim completes the goal and flags OnShipDone.
        active.shipObjective!.complete = true;
        active.shipObjective!.shipDonePending = true;
        // Runs at the next date advance (jump or landing), not just at
        // the return landing: OnShipDone fires and the mission stays.
        expect(runPendingShipDone(machinery)).toBe(1);
        expect(state.bits.has(88)).toBe(true);
        expect(state.events.find(e => e.type === 'shipDone')?.text)
            .toBe('Targets eliminated.');
        expect(active.shipObjective!.shipDonePending).toBe(false);
        expect(state.missions.has('nova:207')).toBe(true);
        // Idempotent: it does not run again.
        expect(runPendingShipDone(machinery)).toBe(0);
    });

    // M5(b): runPendingShipDone iterates a snapshot of state.missions. If
    // one mission's OnShipDone aborts a sibling, the sibling is gone from
    // state.missions but its shipDonePending flag is untouched, so without
    // a loop-top membership guard the snapshot would still run the dead
    // sibling's OnShipDone and fire a shipDone event for it.
    it('runPendingShipDone skips a sibling aborted by an earlier '
        + 'mission\'s OnShipDone', () => {
        const a = makeMission({
            id: 'nova:230',
            shipGoal: 0, shipCount: 1, shipDudeId: 'nova:240',
            onShipDone: 'a231', // A's OnShipDone aborts sibling B.
            shipDoneText: 'A done.',
        });
        const b = makeMission({
            id: 'nova:231',
            shipGoal: 0, shipCount: 1, shipDudeId: 'nova:240',
            onShipDone: 'b99', // Must NOT run: B is aborted first.
            onAbort: 'b70', // Proves B was aborted.
            shipDoneText: 'B done.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [a, b], {
            systems: [{ id: 'nova:200', govt: null, links: [] }],
            systemIdOfStellar: () => 'nova:200',
        });
        acceptOffer(machinery, makeMissionOffer(a, machinery.offerContext())!);
        acceptOffer(machinery, makeMissionOffer(b, machinery.offerContext())!);
        for (const id of ['nova:230', 'nova:231']) {
            const obj = state.missions.get(id)!.shipObjective!;
            obj.complete = true;
            obj.shipDonePending = true;
        }
        // Only A's OnShipDone runs; it aborts B before the snapshot reaches
        // it, so B's OnShipDone never fires.
        expect(runPendingShipDone(machinery)).toBe(1);
        expect(state.bits.has(70)).toBe(true); // B was aborted.
        expect(state.bits.has(99)).toBe(false); // B's OnShipDone did NOT run.
        expect(state.missions.has('nova:231')).toBe(false);
        const shipDoneEvents = state.events.filter(e => e.type === 'shipDone');
        expect(shipDoneEvents.length).toBe(1);
        expect(shipDoneEvents[0].missionId).toBe('nova:230');
    });

    // M5(a): in processLanding, OnShipDone runs before the completion
    // check. Its set string can abort THIS mission (Axxx naming itself);
    // without a membership re-check the mission would then also be
    // completed — paying PayVal and pushing a 'completed' event for a
    // mission that was just aborted.
    it('processLanding does not complete a mission whose OnShipDone '
        + 'aborts itself', () => {
        const mission = makeMission({
            id: 'nova:232',
            payVal: 1000,
            shipGoal: 0, shipCount: 1, shipDudeId: 'nova:240',
            // Completes at the landed stellar (no travel leg).
            returnStel: 128, returnStelId: 'nova:128',
            onShipDone: 'a232', // OnShipDone aborts THIS mission.
            onAbort: 'b71',
            shipDoneText: 'Goal done.',
            completionText: 'Paid in full.',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission], {
            systems: [{ id: 'nova:200', govt: null, links: [] }],
            systemIdOfStellar: () => 'nova:200',
        });
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        const obj = state.missions.get('nova:232')!.shipObjective!;
        obj.complete = true;
        obj.shipDonePending = true;
        const creditsBefore = state.credits.credits;

        processLanding(machinery, 'nova:128', 1000);

        expect(state.missions.has('nova:232')).toBe(false);
        expect(state.bits.has(71)).toBe(true); // Aborted (OnAbort ran).
        // Not completed: PayVal not paid, no 'completed' event.
        expect(state.credits.credits).toBe(creditsBefore);
        expect(state.events.some(e => e.type === 'completed')).toBe(false);
        expect(state.events.some(e => e.type === 'aborted')).toBe(true);
    });

    it('freezes failIfPlayerDisabledOrDestroyed onto the active mission', () => {
        const flagged = makeMission({ id: 'nova:206' });
        flagged.flags = {
            ...flagged.flags, failIfPlayerDisabledOrDestroyed: true,
        };
        const state = makeState();
        const machinery = makeMachinery(state, [flagged]);
        acceptOffer(machinery,
            makeMissionOffer(flagged, machinery.offerContext())!);
        expect(state.missions.get('nova:206')!
            .failIfPlayerDisabledOrDestroyed).toBe(true);
    });

    it('aborts a mission, dropping its cargo and running OnAbort', () => {
        const mission = makeMission({
            id: 'nova:203',
            cargoType: 0,
            cargoQty: 8,
            pickupMode: 0,
            returnStel: 129,
            returnStelId: 'nova:129',
            onAbort: 'b55',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.cargo.get('mission:nova:203')).toBe(8);

        abortMission(machinery, 'nova:203');
        expect(state.missions.size).toBe(0);
        expect(state.cargo.has('mission:nova:203')).toBe(false);
        expect(state.bits.has(55)).toBe(true);
    });

    it('auto-abort missions run their effects and never stay', () => {
        const mission = makeMission({
            id: 'nova:204',
            payVal: 500,
            onAccept: 'b42',
            datePostInc: 2,
        });
        mission.flags = {
            ...mission.flags,
            autoAbort: true,
            applyPayOnAutoAbort: true,
        };
        const state = makeState();
        const machinery = makeMachinery(state, [mission]);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.missions.size).toBe(0);
        expect(state.bits.has(42)).toBe(true);
        expect(state.credits.credits).toBe(1500);
        expect(state.dateAdvance).toBe(2);
    });

    it('an immediate auto-abort runs OnAbort after OnAccept '
        + '(mïsn Flags 0x0001)', () => {
            // "Any control bits pointed to by the mission's OnAbort fields
            // will be automatically set when the mission aborts." Both
            // strings run, OnAccept first: nova:609 "Drop Bear" sets b45
            // on accept and clears it on abort so it can score again.
            const mission = makeMission({
                id: 'nova:609', onAccept: 'b1 b45', onAbort: 'b2 !b45',
            });
            mission.flags = { ...mission.flags, autoAbort: true };
            const state = makeState();
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            expect(state.missions.size).toBe(0);
            expect(state.bits.has(1)).toBe(true);
            expect(state.bits.has(2)).toBe(true);
            expect(state.bits.has(45)).toBe(false);
        });

    it('an immediate auto-abort leaves the CompReward abort reversal alone',
        () => {
            // The ruling in acceptOffer: nova:614-629 (the enforcement
            // squads) all set Flags 0x0040 with CompRewards up to 30, and
            // being hunted is not meant to cost a -150 record.
            const mission = makeMission({
                id: 'nova:614', compGovt: 128, compReward: 2,
            });
            mission.flags = {
                ...mission.flags, autoAbort: true,
                lose5xCompRewardOnAbort: true,
            };
            const state = makeState({ records: new Map([['nova:128', 10]]) });
            const machinery = makeMachinery(state, [mission]);
            acceptOffer(machinery,
                makeMissionOffer(mission, machinery.offerContext())!);
            expect(state.records!.get('nova:128')).toBe(10);
        });

    it('an immediate auto-abort with special ships queues them for the '
        + 'lift-off (PendingAutoAbortShips)', () => {
            // nova:614 "Avoid Federation Secession Task-Force": autoAbort,
            // ShipCount 4, ShipSyst -6, ShipNames "Secession TF". The
            // mission never becomes active, so its ships are kept aside.
            const mission = makeMission({
                id: 'nova:614', shipGoal: 0, shipCount: 4, shipSyst: -6,
                shipDudeId: 'nova:130', shipBehav: 0, shipStart: 1,
                shipNames: ['Secession TF'],
            });
            mission.flags = { ...mission.flags, autoAbort: true };
            const state = makeState({ autoAbortShips: [] });
            const machinery = makeMachinery(state, [mission], {
                systems: [{ id: 'nova:200', govt: null, links: [] }],
                systemIdOfStellar: () => 'nova:200',
            });
            const offer = makeMissionOffer(mission, machinery.offerContext())!;
            expect(offer.shipObjective).toBeDefined();
            acceptOffer(machinery, offer);
            expect(state.missions.size).toBe(0);
            expect(state.autoAbortShips!.length).toBe(1);
            const [batch] = state.autoAbortShips!;
            expect(batch.missionId).toBe('nova:614');
            expect(batch.shipObjective.total).toBe(4);
            expect(batch.shipObjective.systemId).toBeNull();
            expect(batch.shipObjective.behavior).toBe(0);
            // The name the notice showed is the name the ships wear.
            expect(batch.shipName).toBe('Secession TF');
            expect(state.events[0].specialShipName).toBe('Secession TF');
            // A copy, not the offer's own live map.
            expect(batch.shipObjective.live).not.toBe(offer.shipObjective!.live);
            // A mission without ships queues nothing.
            const plain = makeMission({ id: 'nova:609' });
            plain.flags = { ...plain.flags, autoAbort: true };
            acceptOffer(machinery,
                makeMissionOffer(plain, machinery.offerContext())!);
            expect(state.autoAbortShips!.length).toBe(1);
        });
});

describe('mission set-string hooks (Sxxx/Axxx/Fxxx)', () => {
    it('Sxxx starts a mission by id through the real machinery', () => {
        const started = makeMission({
            id: 'nova:210',
            returnStel: 129,
            returnStelId: 'nova:129',
            onAccept: 'b77',
        });
        const state = makeState();
        const machinery = makeMachinery(state, [started]);
        runMissionSetString(machinery, 's210', 'nova');
        expect(state.missions.has('nova:210')).toBe(true);
        expect(state.bits.has(77)).toBe(true);
    });

    it('Axxx aborts and Fxxx fails active missions', () => {
        const a = makeMission({ id: 'nova:211', onAbort: 'b1' });
        const f = makeMission({ id: 'nova:212', onFailure: 'b2' });
        const state = makeState();
        const machinery = makeMachinery(state, [a, f]);
        acceptOffer(machinery,
            makeMissionOffer(a, machinery.offerContext())!);
        acceptOffer(machinery,
            makeMissionOffer(f, machinery.offerContext())!);
        expect(state.missions.size).toBe(2);

        runMissionSetString(machinery, 'a211 f212', 'nova');
        expect(state.missions.size).toBe(0);
        expect(state.bits.has(1)).toBe(true);
        expect(state.bits.has(2)).toBe(true);
    });

    // Xxxx, "make system ID xxx be explored" (Bible :263). The whole of
    // the stock game's use of it is the tutorial revealing where to go
    // next: mïsn 630's OnAccept is "X128" (Kania, holding Port Kane),
    // 631's is "X162", 633's "X166", 757's and 758's "X187", and 251's is
    // "b8339 X130" — Sol, on the way to Earth.
    describe('Xxxx in a mission set string', () => {
        function machineryWithDiscovery(levels: Map<string, DiscoveryLevel>,
            systems: string[]) {
            const state = makeState();
            const machinery: MissionMachineryContext = {
                ...makeMachinery(state, []),
                discovery: {
                    level: id => levels.get(id) ?? DISCOVERY_UNKNOWN,
                    markVisited: id => {
                        if ((levels.get(id) ?? DISCOVERY_UNKNOWN)
                            < DISCOVERY_ENTERED) {
                            levels.set(id, DISCOVERY_ENTERED);
                        }
                    },
                },
                systemExists: id => systems.includes(id),
            };
            return { state, machinery };
        }

        it('marks the named system visited', () => {
            const levels = new Map<string, DiscoveryLevel>();
            const { machinery } = machineryWithDiscovery(levels,
                ['nova:128', 'nova:130']);
            // Stock mïsn 251's OnAccept, verbatim.
            runMissionSetString(machinery, 'b8339 X130', 'nova');
            expect(levels.get('nova:130')).toBe(DISCOVERY_ENTERED);
        });

        it('leaves a system the pilot has landed in at "landed"', () => {
            const levels = new Map<string, DiscoveryLevel>(
                [['nova:128', DISCOVERY_LANDED]]);
            const { machinery } = machineryWithDiscovery(levels, ['nova:128']);
            runMissionSetString(machinery, 'X128', 'nova');
            expect(levels.get('nova:128')).toBe(DISCOVERY_LANDED);
        });

        it('scopes the sÿst number to the plug-in that wrote the string',
            () => {
                // A plug-in's X400, where stock has no 400: its own system.
                const levels = new Map<string, DiscoveryLevel>();
                const { machinery } = machineryWithDiscovery(levels,
                    ['arpia:400']);
                runMissionSetString(machinery, 'X400', 'arpia');
                expect([...levels.keys()]).toEqual(['arpia:400']);
            });

        it('writes nothing for a sÿst id no data set defines', () => {
            spyOn(console, 'warn');
            const levels = new Map<string, DiscoveryLevel>();
            const { machinery } = machineryWithDiscovery(levels, []);
            runMissionSetString(machinery, 'X9999', 'nova');
            expect(levels.size).toBe(0);
        });

        it('is a no-op when the caller has no discovery record', () => {
            // The pre-existing behaviour: reported as an unimplemented hook.
            const state = makeState();
            expect(() => runMissionSetString(
                makeMachinery(state, []), 'X130', 'nova')).not.toThrow();
        });
    });

    // Sxxx/Axxx/Fxxx and Kxxx/Lxxx resolve their bare numbers exactly as
    // every sibling operator does (resolveNumberedResource): stock's n
    // when stock defines it, else the writing plug-in's own.
    describe('stock-first numeric resolution', () => {
        it('starts the STOCK mission for a plug-in\'s S<stock-n>', () => {
            const stock = makeMission({ id: 'nova:210' });
            const state = makeState();
            const machinery = makeMachinery(state, [stock]);
            runMissionSetString(machinery, 's210', 'arpia');
            expect(state.missions.has('nova:210')).toBe(true);
            expect(state.missions.has('arpia:210')).toBe(false);
        });

        it('starts the plug-in\'s own mission for its private number', () => {
            const own = makeMission({ id: 'arpia:400' });
            const state = makeState();
            const machinery = makeMachinery(state, [own]);
            runMissionSetString(machinery, 's400', 'arpia');
            expect(state.missions.has('arpia:400')).toBe(true);
        });

        it('aborts and fails STOCK missions from a plug-in\'s Axxx/Fxxx',
            () => {
                const a = makeMission({ id: 'nova:211', onAbort: 'b1' });
                const f = makeMission({ id: 'nova:212', onFailure: 'b2' });
                const state = makeState();
                const machinery = makeMachinery(state, [a, f]);
                acceptOffer(machinery,
                    makeMissionOffer(a, machinery.offerContext())!);
                acceptOffer(machinery,
                    makeMissionOffer(f, machinery.offerContext())!);
                expect(state.missions.size).toBe(2);
                runMissionSetString(machinery, 'a211 f212', 'arpia');
                expect(state.missions.size).toBe(0);
                expect(state.bits.has(1)).toBe(true);
                expect(state.bits.has(2)).toBe(true);
            });

        function rankMachinery(ranks: Set<string>, known: string[]) {
            const state = makeState({ ranks });
            const machinery: MissionMachineryContext = {
                ...makeMachinery(state, []),
                getRank: id => known.includes(id)
                    ? { ...getDefaultRankData(), id } : undefined,
            };
            return machinery;
        }

        it('activates the STOCK rank for a plug-in\'s K<stock-n>', () => {
            const ranks = new Set<string>();
            runMissionSetString(rankMachinery(ranks, ['nova:147']),
                'k147', 'arpia');
            expect([...ranks]).toEqual(['nova:147']);
        });

        it('activates the plug-in\'s own rank for its private number', () => {
            const ranks = new Set<string>();
            runMissionSetString(rankMachinery(ranks, ['arpia:400']),
                'k400', 'arpia');
            expect([...ranks]).toEqual(['arpia:400']);
        });

        it('still records the writer\'s id for a rank NEITHER data set '
            + 'defines (player state is never dropped)', () => {
                // rank_logic.ts records unknown ids so a not-loaded
                // plug-in's rank survives a save; the writer's own id is
                // the one it would come back under.
                const ranks = new Set<string>();
                runMissionSetString(rankMachinery(ranks, []),
                    'k999', 'arpia');
                expect([...ranks]).toEqual(['arpia:999']);
            });

        it('deactivates the STOCK rank for a plug-in\'s L<stock-n>', () => {
            const ranks = new Set<string>(['nova:147']);
            runMissionSetString(rankMachinery(ranks, ['nova:147']),
                'l147', 'arpia');
            expect(ranks.size).toBe(0);
        });
    });

    it('guards against self-referential Sxxx recursion', () => {
        const loop = makeMission({
            id: 'nova:213',
            onAccept: 'a213 s213',
        });
        loop.flags = { ...loop.flags, autoAbort: true };
        const state = makeState();
        const machinery = makeMachinery(state, [loop]);
        // Must terminate.
        runMissionSetString(machinery, 's213', 'nova');
        expect(state.missions.size).toBe(0);
    });
});

describe('missionMapMarks', () => {
    function activeMission(partial: Partial<ActiveMission>): ActiveMission {
        return {
            id: 'nova:200', acceptedDay: 0, acceptedAt: 'nova:128',
            travelPlanet: null, returnPlanet: null, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null, ...partial,
        };
    }
    // Planet -> system map for the test.
    const systemOf = (planetId: string) => ({
        'nova:300': 'nova:400', // travel
        'nova:301': 'nova:401', // return
    } as Record<string, string | undefined>)[planetId];

    it('marks travel and return systems as destinations', () => {
        const mission = makeMission({ id: 'nova:200' });
        const getMission = (id: string) => id === 'nova:200'
            ? mission : undefined;
        const marks = missionMapMarks([activeMission({
            travelPlanet: 'nova:300', returnPlanet: 'nova:301',
        })], getMission, systemOf);
        expect(marks).toEqual([
            { systemId: 'nova:400', kind: 'destination', missionId: 'nova:200' },
            { systemId: 'nova:401', kind: 'destination', missionId: 'nova:200' },
        ]);
    });

    it('suppresses destination marks under hideDestArrows', () => {
        const mission = makeMission({ id: 'nova:200' });
        mission.flags = { ...mission.flags, hideDestArrows: true };
        const getMission = () => mission;
        const marks = missionMapMarks([activeMission({
            travelPlanet: 'nova:300', returnPlanet: 'nova:301',
        })], getMission, systemOf);
        expect(marks).toEqual([]);
    });

    it('marks the ship-syst system only under showArrowForShipSyst', () => {
        const mission = makeMission({ id: 'nova:200' });
        const getMission = () => mission;
        const active = activeMission({
            travelPlanet: null, returnPlanet: null,
            shipObjective: {
                goal: 0, systemId: 'nova:500', shipStart: 0, behavior: -1,
                dudeId: 'nova:240', total: 1, satisfied: 0, complete: false,
                failed: false, shipDonePending: false, live: new Map(),
            },
        });
        // Without the flag: no mark.
        expect(missionMapMarks([active], getMission, systemOf)).toEqual([]);
        // With the flag: a ship-syst mark.
        mission.flags = { ...mission.flags, showArrowForShipSyst: true };
        expect(missionMapMarks([active], getMission, systemOf)).toEqual([
            { systemId: 'nova:500', kind: 'shipSyst', missionId: 'nova:200' },
        ]);
    });

    it('deduplicates and skips unplaced/unknown systems', () => {
        const mission = makeMission({ id: 'nova:200' });
        const getMission = () => mission;
        const marks = missionMapMarks([
            activeMission({ travelPlanet: 'nova:300' }),
            // Same system again (dedup) and an unplaced planet (skipped).
            activeMission({ id: 'nova:200', travelPlanet: 'nova:300',
                returnPlanet: 'nova:999' }),
        ], getMission, systemOf);
        expect(marks).toEqual([
            { systemId: 'nova:400', kind: 'destination', missionId: 'nova:200' },
        ]);
    });
});

describe('the <SN> special ship name', () => {
    // The stock bounty-hunter name list: mïsn nova:258 ("25000 Credit
    // Bounty;Bounty Hunter1a") points ShipNameID at STR# nova:25000,
    // "Auroran Warships".
    const AURORAN_WARSHIPS = [
        'Dechanik', 'Blood Honor', 'Frunch\'eck', 'Talons of Integrity',
        'Warrior\'s Pride', 'Doomblade', 'Warrior\'s Path', 'Gjinchar',
        'Swordsman\'s Song', 'Ytrack',
    ];

    function bountyMission(partial: Partial<MissionData> = {}): MissionData {
        return makeMission({
            id: 'nova:258',
            name: '25000 Credit Bounty',
            shipGoal: 0, shipCount: 1, shipDudeId: 'nova:240',
            returnStel: 129, returnStelId: 'nova:129',
            shipNames: AURORAN_WARSHIPS,
            briefText: 'In the last few weeks a rogue Auroran ship, the '
                + '<SN>, has slipped past Federation border patrols.',
            ...partial,
        });
    }

    function shipMachinery(state: MissionWorkingState,
        missions: MissionData[], random: () => number) {
        const machinery = makeMachinery(state, missions, {
            systems: [{ id: 'nova:200', govt: null, links: [] }],
            systemIdOfStellar: () => 'nova:200',
        });
        return { ...machinery, random };
    }

    it('picks the name from the ShipNameID list at accept', () => {
        const mission = bountyMission();
        const state = makeState();
        // 0.55 * 10 = 5 -> "Doomblade".
        const machinery = shipMachinery(state, [mission], () => 0.55);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.missions.get('nova:258')!.shipName).toBe('Doomblade');
    });

    it('leaves the name unset when the mission has no ShipNameID list', () => {
        // mïsn nova:685 ("Assassinate Krane") is the stock example: its
        // QuickBrief says "...in the <SN>" but ShipNameID is -1, so the
        // original screws that up too.
        const mission = bountyMission({ id: 'nova:685', shipNames: [] });
        const state = makeState();
        const machinery = shipMachinery(state, [mission], () => 0.55);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.missions.get('nova:685')!.shipName).toBeUndefined();
    });

    it('keeps the accepted name stable for the mission\'s whole life', () => {
        const mission = bountyMission();
        const state = makeState();
        let roll = 0.55;
        const machinery = shipMachinery(state, [mission], () => roll);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        const active = state.missions.get('nova:258')!;
        // Later randomness (spawns, NCB sets) must not re-roll it.
        roll = 0.05;
        expect(active.shipName).toBe('Doomblade');
    });

    it('carries the name on the events whose dëscs can use it', () => {
        const mission = bountyMission({
            completionText: 'The <SN> is scrap. Here is your bounty.',
            payVal: 25000,
        });
        const state = makeState();
        const machinery = shipMachinery(state, [mission], () => 0.55);
        acceptOffer(machinery,
            makeMissionOffer(mission, machinery.offerContext())!);
        expect(state.events.find(e => e.type === 'accepted')!.specialShipName)
            .toBe('Doomblade');
        // The mission is gone from the player's state by the time the
        // completion popup renders, so the event has to carry the name.
        const active = state.missions.get('nova:258')!;
        active.shipObjective!.satisfied = active.shipObjective!.total;
        active.shipObjective!.complete = true;
        processLanding(machinery, 'nova:129', 1010);
        const completed = state.events.find(e => e.type === 'completed')!;
        expect(completed.specialShipName).toBe('Doomblade');
    });
});
