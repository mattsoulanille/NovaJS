import 'jasmine';
import { getDefaultDudeData } from 'novadatainterface/dude_data';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { getDefaultMissionData, MissionData } from 'novadatainterface/mission_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { Entity } from 'nova_ecs/entity';
import { DisabledComponent } from './disabled_component.js';
import { FiringGroupComponent } from './firing_group.js';
import { ArmorComponent } from './health_plugin.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import {
    buildMissionShipSpawns,
    MISSION_SHIP_NO_DEPART_MS,
    MissionShipUniverse,
} from './mission_ship_spawn.js';
import {
    GOAL_BOARD,
    GOAL_CHASE_OFF,
    GOAL_DESTROY,
    GOAL_DISABLE,
    GOAL_ESCORT,
    GOAL_NONE,
    GOAL_OBSERVE,
    GOAL_RESCUE,
    ShipObjective,
} from './mission_ship_state.js';
import { SystemHoldComponent } from './system_hold.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import { ActiveMission, MissionsComponent } from './player_state_plugin.js';
import { TargetComponent } from './target_component.js';

const MISSION_ID = 'nova:500';
const OWNER = 'owner-uuid';
const DUDE = 'nova:240';
const SHIP = 'nova:300';

function makeGameData(): MockGameData {
    const gameData = new MockGameData();
    gameData.data.Dude.map.set(DUDE, {
        ...getDefaultDudeData(),
        id: DUDE,
        aiType: 3,
        govt: 'nova:200',
        ships: [{ id: SHIP, weight: 100 }],
    });
    gameData.data.Ship.map.set(SHIP, {
        ...getDefaultShipData(),
        id: SHIP,
        name: 'Test Raider',
    });
    return gameData;
}

function makeUniverse(mission?: MissionData): MissionShipUniverse {
    return {
        getMission: id => mission?.id === id ? mission : undefined,
        systemIdOfPlanet: () => undefined,
        getGovt: () => undefined,
        getSystemInfo: id => ({ id, govt: null, links: [] }),
    };
}

function makeObjective(overrides: Partial<ShipObjective>): ShipObjective {
    return {
        goal: GOAL_DESTROY,
        systemId: 'nova:128',
        shipStart: 0,
        behavior: -1,
        dudeId: DUDE,
        total: 3,
        satisfied: 0,
        complete: false,
        failed: false,
        shipDonePending: false,
        live: new Map(),
        ...overrides,
    };
}

function makePlayer(objective?: ShipObjective,
    mission?: MissionData, shipName?: string,
    shipSubtitle?: string): Entity {
    const active: ActiveMission = {
        id: mission?.id ?? MISSION_ID,
        acceptedDay: 0,
        acceptedAt: 'nova:128',
        travelPlanet: null,
        returnPlanet: null,
        cargoType: -1,
        cargoQty: 0,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: null,
        ...(objective ? { shipObjective: objective } : {}),
        ...(shipName ? { shipName } : {}),
        ...(shipSubtitle ? { shipSubtitle } : {}),
    };
    const player = new Entity('player');
    player.components.set(MissionsComponent,
        new Map([[active.id, active]]));
    return player;
}

describe('buildMissionShipSpawns', () => {
    it('spawns the remaining ships in the objective system', async () => {
        const objective = makeObjective({ satisfied: 1 });
        const player = makePlayer(objective);
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ships.length).toBe(2);
        for (const ship of ships) {
            expect(ship.components.get(MissionShipComponent)).toEqual({
                mission: MISSION_ID,
                owner: OWNER,
            });
            // Goal targets must not auto-depart.
            expect(ship.components.get(NpcComponent)?.departAt)
                .toBe(MISSION_SHIP_NO_DEPART_MS);
            // ...and must not leave by any of the routes the timer does
            // not govern either (system_hold.ts). A suppressed departAt
            // alone let "Take Hyperioid Sample"'s board target leave one
            // tick after it spawned, because a trader with no stellar to
            // fly to departs without ever consulting the timer.
            expect(ship.components.get(SystemHoldComponent))
                .toEqual({ reason: 'missionGoal' });
        }
    });

    it('holds every goal but chase-off and none in the system', async () => {
        for (const goal of [GOAL_DESTROY, GOAL_DISABLE,
            GOAL_BOARD, GOAL_ESCORT, GOAL_OBSERVE]) {
            const player = makePlayer(makeObjective({ goal, total: 1 }));
            const [ship] = await buildMissionShipSpawns(player, OWNER,
                'nova:128', makeGameData(), makeUniverse());
            expect(ship.components.get(SystemHoldComponent))
                .withContext(`goal ${goal}`)
                .toEqual({ reason: 'missionGoal' });
        }
    });

    it('does not hold a GOAL_NONE ship: nothing would ever release it', async () => {
        // Ambushers and scenery have no goal, so `complete` never flips
        // for them and a hold would outlive the whole mission (review r14
        // M2). They behave like any other ship of their düde.
        const player = makePlayer(makeObjective({ goal: GOAL_NONE, total: 1 }));
        const [ship] = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ship.components.has(SystemHoldComponent)).toBeFalse();
    });

    it('holds a rescue target for its OWN more specific reason', async () => {
        // A rescue target is held because it is adrift waiting to be
        // refuelled, and rescueBoarded releases it by that name.
        const player = makePlayer(makeObjective(
            { goal: GOAL_RESCUE, total: 1 }));
        const [ship] = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ship.components.get(SystemHoldComponent))
            .toEqual({ reason: 'rescue' });
    });

    it('spawns in a STACKED DUPLICATE of the frozen objective system '
        + '(mïsn 737 frozen to nova:765 while the player enters nova:308)',
        async () => {
            const objective = makeObjective({ systemId: 'nova:765' });
            const player = makePlayer(objective);
            const universe = {
                ...makeUniverse(),
                sameSystem: (a: string, b: string) => a === b
                    || new Set([a, b]).size === 2
                    && ['nova:308', 'nova:765'].includes(a)
                    && ['nova:308', 'nova:765'].includes(b),
            };
            const ships = await buildMissionShipSpawns(player, OWNER,
                'nova:308', makeGameData(), universe);
            expect(ships.length).toBe(3);
            // And still not in an unrelated system.
            const elsewhere = await buildMissionShipSpawns(
                makePlayer(makeObjective({ systemId: 'nova:765' })), OWNER,
                'nova:130', makeGameData(), universe);
            expect(elsewhere.length).toBe(0);
        });

    it('spawns a derelict-govt mission ship disabled with full stats '
        + '(the Kontik probe\'s Aurora Cruiser)', async () => {
        const objective = makeObjective({ satisfied: 1 });
        const player = makePlayer(objective);
        const gameData = makeGameData();
        gameData.data.Govt.map.set('nova:200', {
            ...getDefaultGovtData(),
            id: 'nova:200',
            flags: {
                ...getDefaultGovtData().flags,
                startsDisabled: true,
            },
        });
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:128', gameData, makeUniverse());
        expect(ships.length).toBeGreaterThan(0);
        for (const ship of ships) {
            const disabled = ship.components.get(DisabledComponent);
            expect(disabled).toBeDefined();
            expect(disabled!.repairAt).toBeNull();
            expect(disabled!.hulk).toBeTrue();
            const armor = ship.components.get(ArmorComponent);
            expect(armor!.current).toBe(armor!.max);
        }
    });

    it('leaves an ordinary-govt mission ship enabled', async () => {
        const player = makePlayer(makeObjective({ satisfied: 1 }));
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ships.length).toBeGreaterThan(0);
        for (const ship of ships) {
            expect(ship.components.get(DisabledComponent)).toBeUndefined();
        }
    });

    it('spawns nothing in a non-matching system', async () => {
        const player = makePlayer(makeObjective({}));
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:129', makeGameData(), makeUniverse());
        expect(ships.length).toBe(0);
    });

    it('spawns follow-the-player objectives in any system', async () => {
        const player = makePlayer(makeObjective({ systemId: null }));
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:129', makeGameData(), makeUniverse());
        expect(ships.length).toBe(3);
    });

    it('clears the stale live roster on the player entity', async () => {
        const objective = makeObjective({
            live: new Map([['stale-uuid', {}]]),
        });
        const player = makePlayer(objective);
        await buildMissionShipSpawns(player, OWNER, 'nova:128',
            makeGameData(), makeUniverse());
        const committed = player.components.get(MissionsComponent)!
            .get(MISSION_ID)!.shipObjective!;
        expect(committed.live.size).toBe(0);
    });

    it('spawns nothing for complete or failed objectives', async () => {
        const done = makePlayer(makeObjective(
            { satisfied: 3, complete: true }));
        expect((await buildMissionShipSpawns(done, OWNER, 'nova:128',
            makeGameData(), makeUniverse())).length).toBe(0);
        const failed = makePlayer(makeObjective({ failed: true }));
        expect((await buildMissionShipSpawns(failed, OWNER, 'nova:128',
            makeGameData(), makeUniverse())).length).toBe(0);
    });

    it('aggresses ShipBehav-0 ships at the owner', async () => {
        const player = makePlayer(makeObjective({ behavior: 0, total: 1 }));
        const [ship] = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ship.components.get(NpcComponent)?.aggressor).toBe(OWNER);
        expect(ship.components.get(TargetComponent)?.target).toBe(OWNER);
    });

    it('forms escort-goal ships on the owner', async () => {
        const player = makePlayer(makeObjective(
            { goal: GOAL_ESCORT, total: 2 }));
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse(), 5);
        expect(ships.length).toBe(2);
        expect(ships.map(s => s.components.get(FormationComponent)))
            .toEqual([
                { leader: OWNER, slot: 5 },
                { leader: OWNER, slot: 6 },
            ]);
        for (const ship of ships) {
            expect(ship.components.get(FiringGroupComponent))
                .toEqual({ group: OWNER });
        }
    });

    it('keeps natural departure timers on chase-off targets', async () => {
        const player = makePlayer(makeObjective(
            { goal: GOAL_CHASE_OFF, total: 1 }));
        const [ship] = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse());
        expect(ship.components.get(NpcComponent)?.departAt).toBeUndefined();
        // ...and no hold either: ShipGoal 6 is satisfied by scaring them
        // into jumping out, so leaving is the whole point of them.
        expect(ship.components.get(SystemHoldComponent)).toBeUndefined();
    });

    it('names ships from the mission ShipNameID list', async () => {
        const mission: MissionData = {
            ...getDefaultMissionData(),
            id: MISSION_ID,
            shipNames: ['Doomblade'],
        };
        const player = makePlayer(makeObjective({ total: 1 }), mission);
        const [ship] = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse(mission));
        expect(ship.name).toBe('Doomblade');
    });

    it('uses the name picked at accept, so the ships agree with <SN>',
        async () => {
            // The accepted mission froze "Blood Honor" out of the
            // ShipNameID list (STR# nova:25000, "Auroran Warships");
            // the spawn must not re-roll a different one.
            const mission: MissionData = {
                ...getDefaultMissionData(),
                id: MISSION_ID,
                shipNames: ['Dechanik', 'Blood Honor', 'Doomblade'],
            };
            const player = makePlayer(makeObjective({ total: 3 }), mission,
                'Blood Honor');
            const ships = await buildMissionShipSpawns(player, OWNER,
                'nova:128', makeGameData(), makeUniverse(mission));
            expect(ships.length).toBe(3);
            // One name per mission, shared by all its special ships: the
            // Bible's ShipNameID is singular about the name and plural
            // about the ships, and <SN> is singular.
            expect(ships.map(s => s.name))
                .toEqual(['Blood Honor', 'Blood Honor', 'Blood Honor']);
        });

    /**
     * The regression this file exists to guard: the name used to live
     * ONLY on Entity.name, which the EVN Bible would call a debugging
     * label — it is not serializer-registered, so it never crossed into
     * the display world and the target pane / hail dialog kept showing
     * the bare ship class. The displayed name must ride the
     * serializer-registered MissionShipComponent.
     */
    it('carries the accepted name on the synced MissionShipComponent',
        async () => {
            const mission: MissionData = {
                ...getDefaultMissionData(),
                id: MISSION_ID,
                shipNames: ['Dechanik', 'Blood Honor', 'Doomblade'],
                shipSubtitles: ['Bounty Target'],
            };
            const player = makePlayer(makeObjective({ total: 2 }), mission,
                'Blood Honor', 'Bounty Target');
            const ships = await buildMissionShipSpawns(player, OWNER,
                'nova:128', makeGameData(), makeUniverse(mission));
            expect(ships.length).toBe(2);
            for (const ship of ships) {
                expect(ship.components.get(MissionShipComponent)).toEqual({
                    mission: MISSION_ID,
                    owner: OWNER,
                    name: 'Blood Honor',
                    subtitle: 'Bounty Target',
                });
            }
        });

    /**
     * Re-entering the system respawns the mission's ships from the same
     * frozen ActiveMission, so the bounty target you chased into the
     * next system and back is still the same named ship — the multi-hop
     * case. Nothing is re-rolled per spawn (or per client).
     */
    it('respawns the same name on every system entry', async () => {
        const mission: MissionData = {
            ...getDefaultMissionData(),
            id: MISSION_ID,
            shipNames: ['Dechanik', 'Blood Honor', 'Doomblade'],
        };
        const player = makePlayer(makeObjective({ total: 1 }), mission,
            'Blood Honor');
        const names = new Set<string | undefined>();
        for (let i = 0; i < 5; i++) {
            const [ship] = await buildMissionShipSpawns(player, OWNER,
                'nova:128', makeGameData(), makeUniverse(mission));
            names.add(ship.components.get(MissionShipComponent)?.name);
        }
        expect([...names]).toEqual(['Blood Honor']);
    });

    /**
     * The Bible on aux ships: they "cannot be given specific
     * instructions, and no goals can be set for them", and ShipNameID /
     * ShipSubtitle are documented against "the special ships". So the
     * mission's escort of atmosphere ships stays anonymous even while
     * its special ship is named.
     */
    it('does not name aux ships', async () => {
        const mission: MissionData = {
            ...getDefaultMissionData(),
            id: MISSION_ID,
            shipNames: ['Blood Honor'],
            shipSubtitles: ['Bounty Target'],
            auxShipCount: 2,
            auxShipDude: 240,
            auxShipDudeId: DUDE,
            auxShipSyst: -1,
        };
        const player = makePlayer(undefined, mission, 'Blood Honor',
            'Bounty Target');
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:128', makeGameData(), makeUniverse(mission));
        expect(ships.length).toBe(2);
        for (const ship of ships) {
            const missionShip = ship.components.get(MissionShipComponent)!;
            expect(missionShip.aux).toBeTrue();
            expect(missionShip.name).toBeUndefined();
            expect(missionShip.subtitle).toBeUndefined();
        }
    });

    it('leaves ships unnamed when the mission has no ShipNameID list',
        async () => {
            const mission: MissionData = {
                ...getDefaultMissionData(),
                id: MISSION_ID,
                shipNames: [],
            };
            const player = makePlayer(makeObjective({ total: 1 }), mission);
            const [ship] = await buildMissionShipSpawns(player, OWNER,
                'nova:128', makeGameData(), makeUniverse(mission));
            // makeNpcShip's default: the ship type's own name.
            expect(ship.name).toBe('Test Raider');
        });

    it('spawns aux ships wherever the player goes', async () => {
        const mission: MissionData = {
            ...getDefaultMissionData(),
            id: MISSION_ID,
            auxShipCount: 2,
            auxShipDude: 240,
            auxShipDudeId: DUDE,
            auxShipSyst: -1,
        };
        const player = makePlayer(undefined, mission);
        const ships = await buildMissionShipSpawns(player, OWNER,
            'nova:129', makeGameData(), makeUniverse(mission));
        expect(ships.length).toBe(2);
        for (const ship of ships) {
            expect(ship.components.get(MissionShipComponent)).toEqual({
                mission: MISSION_ID,
                owner: OWNER,
                aux: true,
            });
            // Aux ships keep natural AI and departure behavior. The
            // Bible: "Auxiliary ships cannot be given specific
            // instructions, and no goals can be set for them; they simply
            // are 'normal' ships ... for the purpose of adding
            // atmosphere". Nothing is outstanding, so nothing holds them.
            expect(ship.components.get(NpcComponent)?.departAt)
                .toBeUndefined();
            expect(ship.components.get(SystemHoldComponent)).toBeUndefined();
        }
    });
});
