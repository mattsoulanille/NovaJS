import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import { MissionContext } from './mission_logic.js';
import {
    auxShipsMatchSystem,
    resolveShipObjective,
    resolveShipSystem,
    shipGoalOfferable,
    SystemInfo,
} from './mission_ship_logic.js';
import { GOAL_BOARD, GOAL_DESTROY, GOAL_RESCUE } from './mission_ship_state.js';

const SYSTEMS: SystemInfo[] = [
    { id: 'nova:128', govt: 'nova:128', links: ['nova:129', 'nova:130'] },
    { id: 'nova:129', govt: 'nova:128', links: ['nova:128'] },
    { id: 'nova:130', govt: 'nova:200', links: ['nova:128'] },
    { id: 'nova:131', govt: null, links: [] },
];

/** Planet nova:400 lives in nova:128; nova:401 in nova:130. */
const PLANET_SYSTEM = new Map([
    ['nova:400', 'nova:128'],
    ['nova:401', 'nova:130'],
]);

function makeGovt(id: string, classes: number[]): GovtData {
    return { ...getDefaultGovtData(), id, classes };
}

const GOVTS = new Map<string, GovtData>([
    ['nova:128', makeGovt('nova:128', [1])],
    ['nova:200', makeGovt('nova:200', [2])],
]);

function makeContext(random = () => 0): MissionContext {
    return {
        stellar: {
            id: 'nova:400', govt: null,
            uninhabited: false, canLand: true,
        },
        stellarCandidates: [],
        bits: new Set(),
        shipId: 'nova:128',
        activeMissions: new Map(),
        freeCargoSpace: 100,
        random,
        getGovt: id => GOVTS.get(id),
        currentDay: 0,
        systems: SYSTEMS,
        systemIdOfStellar: id => PLANET_SYSTEM.get(id),
    };
}

function makeMission(overrides: Partial<MissionData>): MissionData {
    return {
        ...getDefaultMissionData(),
        id: 'nova:500',
        shipCount: 2,
        shipDude: 240,
        shipDudeId: 'nova:240',
        shipGoal: GOAL_DESTROY,
        ...overrides,
    };
}

describe('shipGoalOfferable', () => {
    it('offers supported goals and missions without ships', () => {
        expect(shipGoalOfferable(makeMission({}))).toBe(true);
        expect(shipGoalOfferable(makeMission({ shipGoal: -1 }))).toBe(true);
        // Board goal without any actual ships: nothing to board.
        expect(shipGoalOfferable(makeMission({
            shipGoal: GOAL_BOARD, shipCount: -1,
        }))).toBe(true);
    });

    it('offers both boarding goals', () => {
        expect(shipGoalOfferable(
            makeMission({ shipGoal: GOAL_BOARD }))).toBe(true);
        expect(shipGoalOfferable(
            makeMission({ shipGoal: GOAL_RESCUE }))).toBe(true);
    });
});

describe('resolveShipSystem', () => {
    it('resolves -1 to the initial system', () => {
        const mission = makeMission({ shipSyst: -1 });
        expect(resolveShipSystem(mission, makeContext(), null, null))
            .toBe('nova:128');
    });

    it('resolves -6 to null (follow the player)', () => {
        const mission = makeMission({ shipSyst: -6 });
        expect(resolveShipSystem(mission, makeContext(), null, null))
            .toBe(null);
    });

    it('freezes -2 to a random system', () => {
        const mission = makeMission({ shipSyst: -2 });
        // random() = 0.6 -> index 2 of the 4 systems.
        expect(resolveShipSystem(mission, makeContext(() => 0.6),
            null, null)).toBe('nova:130');
    });

    it("resolves -3/-4 to the travel/return stellar's system", () => {
        expect(resolveShipSystem(makeMission({ shipSyst: -3 }),
            makeContext(), 'nova:401', null)).toBe('nova:130');
        expect(resolveShipSystem(makeMission({ shipSyst: -4 }),
            makeContext(), null, 'nova:401')).toBe('nova:130');
        // No destination to hang the reference on: unresolvable.
        expect(resolveShipSystem(makeMission({ shipSyst: -3 }),
            makeContext(), null, null)).toBeUndefined();
    });

    it('freezes -5 to a system adjacent to the initial one', () => {
        const mission = makeMission({ shipSyst: -5 });
        // Initial system nova:128 links to nova:129 and nova:130.
        const chosen = resolveShipSystem(mission, makeContext(() => 0.9),
            null, null);
        expect(chosen).toBe('nova:130');
    });

    it('uses the parse-resolved id for plain references', () => {
        const mission = makeMission({ shipSyst: 300, shipSystId: 'nova:300' });
        expect(resolveShipSystem(mission, makeContext(), null, null))
            .toBe('nova:300');
    });

    it('freezes a govt-ranged reference to a matching system', () => {
        // 10000 + (128 - 128): govt nova:128's systems.
        const mission = makeMission({ shipSyst: 10000 });
        const chosen = resolveShipSystem(mission, makeContext(() => 0),
            null, null);
        expect(chosen).toBe('nova:128');
    });

    it('is unresolvable without system info in the context', () => {
        const ctx = makeContext();
        delete ctx.systems;
        expect(resolveShipSystem(makeMission({ shipSyst: -1 }), ctx,
            null, null)).toBeUndefined();
    });
});

describe('resolveShipObjective', () => {
    it('returns undefined for missions without special ships', () => {
        expect(resolveShipObjective(makeMission({ shipCount: -1 }),
            makeContext(), null, null)).toBeUndefined();
        expect(resolveShipObjective(makeMission({ shipDudeId: null }),
            makeContext(), null, null)).toBeUndefined();
    });

    it('returns null (unofferable) for an unknown goal', () => {
        expect(resolveShipObjective(makeMission({ shipGoal: 99 }),
            makeContext(), null, null)).toBeNull();
    });

    it('freezes a RESCUE goal like any other supported one', () => {
        expect(resolveShipObjective(
            makeMission({ shipGoal: GOAL_RESCUE, shipCount: 1 }),
            makeContext(), null, null)).toEqual(
                jasmine.objectContaining({ goal: GOAL_RESCUE, total: 1 }));
    });

    it('freezes a BOARD goal like any other supported one', () => {
        const objective = resolveShipObjective(
            makeMission({ shipGoal: GOAL_BOARD, shipCount: 2 }),
            makeContext(), null, null);
        expect(objective).toEqual(jasmine.objectContaining({
            goal: GOAL_BOARD, total: 2, satisfied: 0,
        }));
    });

    it('freezes the goal state for a destroy mission', () => {
        const mission = makeMission({
            shipSyst: -1, shipStart: 1, shipBehav: 0,
        });
        const objective = resolveShipObjective(mission, makeContext(),
            null, null)!;
        expect(objective).toEqual(jasmine.objectContaining({
            goal: GOAL_DESTROY,
            systemId: 'nova:128',
            shipStart: 1,
            behavior: 0,
            dudeId: 'nova:240',
            total: 2,
            satisfied: 0,
            complete: false,
            failed: false,
            shipDonePending: false,
        }));
        expect(objective.live.size).toBe(0);
    });
});

describe('auxShipsMatchSystem', () => {
    const noDest = { travelPlanet: null, returnPlanet: null };
    const system = SYSTEMS[2]; // nova:130, govt nova:200
    const systemOf = (id: string) => PLANET_SYSTEM.get(id);
    const getGovt = (id: string) => GOVTS.get(id);

    function makeAux(overrides: Partial<MissionData>): MissionData {
        return makeMission({
            auxShipCount: 2,
            auxShipDude: 250,
            auxShipDudeId: 'nova:250',
            ...overrides,
        });
    }

    it('requires aux ships to be defined', () => {
        expect(auxShipsMatchSystem(makeMission({}), noDest, system,
            systemOf, getGovt)).toBe(false);
    });

    it('matches -1 anywhere the player is', () => {
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: -1 }), noDest,
            system, systemOf, getGovt)).toBe(true);
    });

    it("matches -2/-3 against the destinations' systems", () => {
        const dest = { travelPlanet: 'nova:401', returnPlanet: 'nova:400' };
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: -2 }), dest,
            system, systemOf, getGovt)).toBe(true);
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: -3 }), dest,
            system, systemOf, getGovt)).toBe(false);
    });

    it('matches a plain system id', () => {
        expect(auxShipsMatchSystem(makeAux({
            auxShipSyst: 130, auxShipSystId: 'nova:130',
        }), noDest, system, systemOf, getGovt)).toBe(true);
        expect(auxShipsMatchSystem(makeAux({
            auxShipSyst: 129, auxShipSystId: 'nova:129',
        }), noDest, system, systemOf, getGovt)).toBe(false);
    });

    it('matches the 5000-7047 adjacency range', () => {
        // 5000 + (128 - 128): system nova:128 or its neighbors; the
        // mission prefix is 'nova' (id nova:500). nova:130 links to
        // nova:128, so it matches.
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: 5000 }), noDest,
            system, systemOf, getGovt)).toBe(true);
        // nova:131 has no links and isn't nova:128.
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: 5000 }), noDest,
            SYSTEMS[3], systemOf, getGovt)).toBe(false);
    });

    it('resolves a PLUG-IN mission\'s 5000-range target stock-first', () => {
        // A plug-in mïsn naming stock system 128: the reference means
        // nova:128 (the id-space rule, resolveNumberedResource), not a
        // phantom 'arpia:128' that matches nothing.
        expect(auxShipsMatchSystem(
            makeAux({ id: 'arpia:500', auxShipSyst: 5000 }), noDest,
            system, systemOf, getGovt)).toBe(true);
    });

    it('matches the govt-ranged references', () => {
        // 10000 + (200 - 128) = 10072: govt nova:200's systems.
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: 10072 }), noDest,
            system, systemOf, getGovt)).toBe(true);
        expect(auxShipsMatchSystem(makeAux({ auxShipSyst: 10072 }), noDest,
            SYSTEMS[0], systemOf, getGovt)).toBe(false);
    });
});
