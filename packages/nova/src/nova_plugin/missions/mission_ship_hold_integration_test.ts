import 'jasmine';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import { v4 } from 'uuid';
import {
    getIntegrationGameData, getPluginGameData,
} from '../../communication/simulation_test_fixture.js';
import { GameDataAggregator } from '../../server/parsing/game_data_aggregator.js';
import { MissionSession } from '../../spaceport/mission_session.js';
import { MissionUniverse } from '../../spaceport/mission_universe.js';
import { BoardedComponent } from '../ship/boarding_component.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { JumpComponent } from '../travel/jump_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem, SIMULATION_STEP_MS } from '../make_system.js';
import { startMissionById } from './mission_logic.js';
import { MissionShipComponent } from '../player/mission_ship_component.js';
import { buildMissionShipSpawns } from './mission_ship_spawn.js';
import { ControlBitsComponent } from '../ncb/ncb_plugin.js';
import { NpcComponent } from '../npc/npc_ai_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from '../player/player_state_plugin.js';
import { SystemHoldComponent } from '../npc/system_hold.js';

/**
 * ============================================================================
 * A MISSION SPECIAL SHIP WITH AN OUTSTANDING GOAL STAYS IN THE SYSTEM
 * ============================================================================
 *
 * Matthew's report: "It's impossible to complete 'Take Hyperioid Sample'
 * because the hyperioid jumps out instantly."
 *
 * That mission is Plug-ins/"More Blasters CHEAT" mïsn 1000/1001: ShipCount
 * 1, ShipGoal 2 (board), ShipDude nova:147 ("Hyperioid": AIType 2, brave
 * trader), ShipSyst nova:500 (NGC-1317) — a system with NO stellars at
 * all. The trader AI picks a planet to fly to, finds none, and the
 * with-nowhere-to-go branch used to mean "leave the system", so the target
 * warped out on its very first think. Suppressing the DEPARTURE TIMER
 * (MISSION_SHIP_NO_DEPART_MS) never covered that branch, because it is not
 * timer-driven.
 *
 * The Bible settles the rule: ShipGoal 6 is "Chase them off (either kill
 * them or scare them into jumping out of the system)". A distinct goal for
 * making the ships leave only means anything if the ships of the OTHER
 * goals do not leave on their own — so they don't (system_hold.ts,
 * reason 'missionGoal').
 */

const HYPERIOID_PLUGIN = 'More Blasters CHEAT';
/** "Take Hyperioid sample;from bar". */
const HYPERIOID_MISSION = `${HYPERIOID_PLUGIN}:1000`;
/** NGC-1317: the plug-in's target system, with no stellars in it. */
const NGC_1317 = 'nova:500';
/** "25000 Credit Bounty;Bounty Hunter1a": ShipCount 1, ShipGoal 0. */
const BOUNTY_MISSION = 'nova:258';

const SECOND_STEPS = Math.round(1000 / SIMULATION_STEP_MS);

/**
 * Accepts `missionId` from Rauta (the stock starting stellar) and builds
 * the special ships its objective spawns, exactly the way the owner's
 * client does on entering the ships' system.
 */
async function acceptAndSpawn(gameData: GameDataAggregator,
    missionId: string) {
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const start = await gameData.data.PlayerStart.get('nova:128');
    const shipData = await gameData.data.Ship.get(start.ship);
    const owner = makeShip(shipData);
    owner.components.set(GameDateComponent, { ...start.date });
    owner.components.set(CreditsComponent, { credits: start.credits });
    owner.components.set(ControlBitsComponent, new Set([0]));

    const session = await MissionSession.create(
        owner, gameData, universe, 'nova:128');
    startMissionById(session.machinery, missionId);
    session.commit();
    const active = owner.components.get(MissionsComponent)!.get(missionId)!;
    const systemId = active.shipObjective!.systemId!;
    const ships = await buildMissionShipSpawns(owner, 'owner',
        systemId, gameData, universe);
    return { owner, active, ships, systemId };
}

/**
 * Builds `systemId` (without its own NPC traffic, so nothing distracts the
 * AI) with the mission's owner and its special ships in it.
 */
async function worldWithMissionShips(gameData: GameDataAggregator,
    missionId: string) {
    const { owner, ships, systemId } = await acceptAndSpawn(gameData,
        missionId);
    const world = await makeSystem(systemId, gameData, undefined,
        { npcs: false });
    owner.components.set(MultiplayerData, { owner: 'owner' });
    await completeEntity(world, owner);
    world.entities.set('owner', owner);
    const uuids: string[] = [];
    for (const ship of ships) {
        ship.components.set(MultiplayerData, { owner: 'owner' });
        const uuid = v4();
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        uuids.push(uuid);
    }
    const objective = () => world.entities.get('owner')!.components
        .get(MissionsComponent)!.get(missionId)!.shipObjective!;
    return { world, uuids, objective, systemId };
}

/** Steps `seconds` of simulation, reporting whether any of `uuids` ever
 * entered a hyperspace jump or left the world. */
async function stepSeconds(world: World, uuids: string[], seconds: number) {
    let everJumped = false;
    const modes = new Set<string | undefined>();
    for (let i = 0; i < seconds * SECOND_STEPS; i++) {
        for (const uuid of uuids) {
            const ship = world.entities.get(uuid);
            if (!ship) {
                continue;
            }
            modes.add(ship.components.get(NpcComponent)?.mode);
            if (ship.components.has(JumpComponent)) {
                everJumped = true;
            }
        }
        world.step();
        if (i % 60 === 0) {
            await new Promise(resolve => setImmediate(resolve));
        }
    }
    return {
        everJumped, modes,
        present: uuids.filter(uuid => world.entities.has(uuid)),
    };
}

describe('mission special ships with an outstanding goal', () => {
    it('keeps the stock bounty target in the system for a full minute '
        + '(mïsn nova:258)', async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get(BOUNTY_MISSION);
            expect(mission.shipGoal).toBe(0);
            expect(mission.shipCount).toBe(1);

            const { world, uuids, objective } =
                await worldWithMissionShips(gameData, BOUNTY_MISSION);
            expect(uuids.length).toBe(1);
            expect(world.entities.get(uuids[0])!.components
                .get(SystemHoldComponent)).toEqual({ reason: 'missionGoal' });

            const { everJumped, modes, present } =
                await stepSeconds(world, uuids, 60);
            expect(present).toEqual(uuids);
            expect(everJumped).withContext('never begins a jump').toBeFalse();
            expect(modes).not.toContain('depart');
            expect(objective().satisfied).toBe(0);
        }, 120_000);

    it('keeps the Hyperioid in NGC-1317 and completes the board goal when '
        + 'it is boarded (More Blasters CHEAT mïsn 1000)', async () => {
            const gameData = await getPluginGameData(HYPERIOID_PLUGIN);
            if (!gameData) {
                pending('More Blasters CHEAT plug-in not installed');
                return;
            }
            // The shape of the bug: a board goal in a system with nothing
            // to land on, flown by a trader AI.
            const mission = await gameData.data.Mission.get(HYPERIOID_MISSION);
            expect(mission.shipGoal).toBe(2);
            expect(mission.shipDudeId).toBe('nova:147');
            expect(mission.shipSystId).toBe(NGC_1317);
            expect((await gameData.data.Dude.get('nova:147')).aiType).toBe(2);
            expect((await gameData.data.System.get(NGC_1317)).planets)
                .withContext('NGC-1317 has no stellars').toEqual([]);

            const { world, uuids, objective, systemId } =
                await worldWithMissionShips(gameData, HYPERIOID_MISSION);
            expect(systemId).toBe(NGC_1317);
            expect(uuids.length).toBe(1);
            expect(world.entities.get(uuids[0])!.components
                .get(MissionShipComponent)!.name).toBe('Hyper Target');

            const { everJumped, present } =
                await stepSeconds(world, uuids, 30);
            expect(present)
                .withContext('the Hyperioid is still there').toEqual(uuids);
            expect(everJumped).toBeFalse();

            // ...and boarding it completes the mission's ship goal.
            world.entities.get(uuids[0])!.components.set(BoardedComponent,
                { boarder: 'owner', plundered: true });
            for (let i = 0; i < 5; i++) {
                world.step();
            }
            expect(objective().satisfied).toBe(1);
            expect(objective().complete).toBeTrue();
        }, 120_000);
});
