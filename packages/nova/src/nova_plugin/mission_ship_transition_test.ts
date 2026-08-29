import 'jasmine';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { v4 } from 'uuid';
import {
    getIntegrationGameData,
} from '../communication/simulation_test_fixture.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { completeEntity } from './entity_data_loader.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { MissionShipComponent } from './mission_ship_plugin.js';
import {
    buildMissionShipSpawns, liveMissionShips,
} from './mission_ship_spawn.js';
import { ShipObjective } from './mission_ship_state.js';
import { ControlBitsComponent } from './ncb_plugin.js';
import { FormationComponent } from './npc_ai_plugin.js';
import { PlayerEscortComponent } from './player_escort.js';
import { escortsOnPayroll, sweepableEscorts } from './player_escort_plugin.js';
import { PlayerShipSelector } from './player_ship_plugin.js';
import {
    ActiveMission, MissionsComponent,
} from './player_state_plugin.js';
import { ControlledByComponent } from './ship_control.js';

/**
 * ============================================================================
 * One batch of a mission's special ships per system
 * ============================================================================
 *
 * Matthew's playtest report: "With 'Cause Havoc for Dani' active, I gain
 * more escorts every time I change systems."
 *
 * Stock mïsn 665 ("Cause Havoc for Dani", Auroran 11) runs `S792` on
 * accept, starting the invisible companion mïsn 792, whose whole job is
 * ShipCount 1 / ShipSyst -6 / ShipBehav 1: Karrod's flagship, in whatever
 * system the player is in, protecting them. ShipBehav 1 puts it in
 * FORMATION on the player sharing their firing group (mission_ship_spawn),
 * which is exactly what a hired escort looks like — so if anything ever
 * treated it as one, it would ride the jump AND be respawned at the far
 * end, and the flock would grow by one every hop.
 *
 * THE BIBLE'S RULING (mïsn ShipSyst): "-6  Whatever system the player is
 * in (i.e. follow him around)". The parenthetical describes the EFFECT —
 * the ships keep turning up wherever you go — not a hyperspace escort. The
 * mechanism is the one the field is a member of, a SPAWN SYSTEM selector:
 * every other value (-1 initial, -3 TravelStel's, a specific id, a govt's)
 * names where the ships appear, and -6 names "here, wherever here is".
 * So one batch is live at a time: the ships are despawned with the system
 * the player leaves and a fresh batch appears in the one they enter. That
 * is also the design the rest of this engine is built on — see the despawn
 * comment in mission_ship_plugin.ts and the roster clearing in
 * buildMissionShipSpawns.
 *
 * These specs pin that invariant against the REAL mïsn 792 data across
 * repeated system entries, in both directions of travel and through a
 * revisit, and pin the two ways a special ship must NOT be mistaken for an
 * escort: the jump/gate sweep and the payroll.
 */

const PLAYER = 'player uuid';
const PEER = 'test peer';

/** The real mïsn 792 objective, resolved the way an accept would. */
async function karrodObjective(): Promise<{
    objective: ShipObjective, auxCount: number,
}> {
    const gameData = await getIntegrationGameData();
    const mission = await gameData.data.Mission.get('nova:792');
    // ShipSyst -6 is the whole point of this spec; a data change that
    // moved it would silently make these specs test nothing.
    expect(mission.shipSyst).toBe(-6);
    expect(mission.shipBehav).toBe(1);
    expect(mission.shipCount).toBe(1);
    return {
        objective: {
            goal: mission.shipGoal,
            // -6: "whatever system the player is in" (resolveShipSystem).
            systemId: null,
            shipStart: mission.shipStart,
            behavior: mission.shipBehav,
            dudeId: mission.shipDudeId!,
            total: mission.shipCount,
            satisfied: 0,
            complete: false,
            failed: false,
            shipDonePending: false,
            live: new Map(),
        },
        auxCount: mission.auxShipCount,
    };
}

function activeMission(objective: ShipObjective): ActiveMission {
    return {
        id: 'nova:792',
        acceptedDay: 0,
        acceptedAt: 'nova:128',
        travelPlanet: null,
        returnPlanet: null,
        cargoType: -1,
        cargoQty: 0,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: null,
        shipObjective: objective,
    };
}

/**
 * The player as they cross between systems: the same ENTITY (and the same
 * uuid) is carried out of one world and inserted into the next, which is
 * what browser.ts's jumpTo does and why the mission state — including the
 * objective this spec watches — survives the hop.
 */
async function makeTraveller(objective: ShipObjective) {
    const gameData = await getIntegrationGameData();
    const shipData = await gameData.data.Ship.get('nova:164');
    const player = makeShip(shipData);
    player.components.set(MultiplayerData, { owner: PEER });
    player.components.set(ControlledByComponent, { peerId: PEER });
    player.components.set(PlayerShipSelector, undefined);
    player.components.set(ControlBitsComponent, new Set());
    player.components.set(MissionsComponent,
        new Map([['nova:792', activeMission(objective)]]));
    return player;
}

/** A system world with no ambient traffic, so every ship in it is ours. */
async function enterSystem(systemId: string, player: import(
    'nova_ecs/entity').Entity) {
    const gameData = await getIntegrationGameData();
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const world = await makeSystem(systemId, gameData, undefined,
        { npcs: false });
    // browser.ts's order: the spawns are BUILT (clearing the stale
    // rosters on the player entity) before the player is inserted, then
    // pushed in after it.
    const ships = await buildMissionShipSpawns(player, PLAYER, systemId,
        gameData, universe, 0, () => 0.5);
    await completeEntity(world, player);
    world.entities.set(PLAYER, player);
    for (const ship of ships) {
        ship.components.set(MultiplayerData, { owner: PEER });
        await completeEntity(world, ship);
        world.entities.set(v4(), ship);
    }
    for (let i = 0; i < 5; i++) {
        world.step();
    }
    return { world, universe };
}

function missionShipsIn(world: import('nova_ecs/world').World) {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(MissionShipComponent));
}

/**
 * Leaving a system, as the simulation sees it: the player's entity goes
 * out of the world (JumpFromSystem / the landing removal both do exactly
 * this) and the world keeps stepping. What is left after that is what
 * would still be there to be carried, if anything carried it.
 */
function leaveSystem(world: import('nova_ecs/world').World) {
    world.entities.delete(PLAYER);
    for (let i = 0; i < 5; i++) {
        world.step();
    }
}

describe('mïsn 792 (Karrod\'s flagship) across system changes', () => {
    it('spawns exactly ShipCount special ships plus its aux ship in every '
        + 'system, and never more', async () => {
            const { objective, auxCount } = await karrodObjective();
            const player = await makeTraveller(objective);
            const route = ['nova:130', 'nova:129', 'nova:130', 'nova:131'];
            for (const systemId of route) {
                const { world } = await enterSystem(systemId, player);
                const ships = missionShipsIn(world);
                const special = ships.filter(([, e]) =>
                    !e.components.get(MissionShipComponent)!.aux);
                const aux = ships.filter(([, e]) =>
                    e.components.get(MissionShipComponent)!.aux);
                expect(special.length)
                    .withContext(`special ships in ${systemId}`)
                    .toBe(objective.total);
                expect(aux.length)
                    .withContext(`aux ships in ${systemId}`)
                    .toBe(auxCount);
                leaveSystem(world);
                // Nothing is left behind to be carried anywhere.
                expect(missionShipsIn(world).length)
                    .withContext(`mission ships left in ${systemId}`)
                    .toBe(0);
            }
        });

    it('flies its special ship in formation on the player, but never as a '
        + 'player escort', async () => {
            const { objective } = await karrodObjective();
            const player = await makeTraveller(objective);
            const { world } = await enterSystem('nova:130', player);
            const special = missionShipsIn(world).find(([, e]) =>
                !e.components.get(MissionShipComponent)!.aux)!;
            expect(special).toBeDefined();
            // ShipBehav 1: formation on the player, like a hired escort.
            expect(special[1].components.get(FormationComponent)?.leader)
                .toBe(PLAYER);
            // ...but NOT one. The durable marker is what makes a ship the
            // player's: without it there is no jump carry, no payroll, and
            // no comm-channel escort management.
            expect(special[1].components.has(PlayerEscortComponent))
                .withContext('special ship marked as a player escort')
                .toBeFalse();
        });

    it('is not swept into hyperspace or through a gate with the player',
        async () => {
            const { objective } = await karrodObjective();
            const player = await makeTraveller(objective);
            const { world } = await enterSystem('nova:130', player);
            expect(missionShipsIn(world).length).toBeGreaterThan(0);
            for (const kind of ['jump', 'gate'] as const) {
                expect(sweepableEscorts(world.entities, PLAYER, kind))
                    .withContext(`${kind} sweep`)
                    .toEqual([]);
            }
        });

    /**
     * The exclusion has to hold whatever markers the ship is wearing. A
     * mission ship that acquired an ownership marker by ANY route would
     * otherwise ride the jump and be respawned at the far end, which is
     * the accumulation itself. (A genuine prize is a different ship: taking
     * one strips its MissionShipComponent — see boarding_plugin.)
     */
    it('is not swept even when it is wearing an ownership marker',
        async () => {
            const { objective } = await karrodObjective();
            const player = await makeTraveller(objective);
            const { world } = await enterSystem('nova:130', player);
            const ships = missionShipsIn(world);
            expect(ships.length).toBeGreaterThan(0);
            for (const [, entity] of ships) {
                entity.components.set(PlayerEscortComponent,
                    { player: PLAYER, parent: PLAYER });
            }
            for (const kind of ['jump', 'gate'] as const) {
                expect(sweepableEscorts(world.entities, PLAYER, kind))
                    .withContext(`${kind} sweep of marked mission ships`)
                    .toEqual([]);
            }
            // ...and it still draws no wage.
            expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
        });

    it('never draws a wage: mission ships are not employees', async () => {
        const { objective } = await karrodObjective();
        const player = await makeTraveller(objective);
        const { world } = await enterSystem('nova:130', player);
        expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
    });

    /**
     * A LIFT-OFF is the one entry into a system whose world can already
     * hold the mission's ships: the player comes back to the very system
     * they landed in, and the owner-absence cleanup that despawns the batch
     * (MissionShipCleanupSystem) may not have run yet — a gate map closed
     * without a pick puts the player back within a frame or two. Building a
     * full ShipCount there is exactly how the batch doubles.
     */
    it('builds nothing extra when the system still holds the batch',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const { objective, auxCount } = await karrodObjective();
            const player = await makeTraveller(objective);
            const { world } = await enterSystem('nova:130', player);
            const before = missionShipsIn(world);
            expect(before.length).toBe(objective.total + auxCount);

            // The player lands and lifts straight back off: same world,
            // batch still flying.
            const census = liveMissionShips(world.entities, PLAYER);
            const again = await buildMissionShipSpawns(player, PLAYER,
                'nova:130', gameData, universe, 0, () => 0.5, census);
            expect(again.length)
                .withContext('a second batch was built on top of the first')
                .toBe(0);
            // And the surviving ships keep their roster entries — with them
            // whatever the goal has already banked against those hulls.
            const live = player.components.get(MissionsComponent)!
                .get('nova:792')!.shipObjective!.live;
            const specialUuids = before
                .filter(([, e]) => !e.components.get(MissionShipComponent)!.aux)
                .map(([uuid]) => uuid);
            for (const uuid of specialUuids) {
                expect(live.has(uuid))
                    .withContext(`roster entry for surviving ${uuid}`)
                    .toBeTrue();
            }
        });

    it('tops the batch back up to ShipCount when only some survive',
        async () => {
            const gameData = await getIntegrationGameData();
            const universe = MissionUniverse.shared(gameData);
            await universe.load();
            const { objective } = await karrodObjective();
            // A two-ship batch, so there is a partial state to be in.
            objective.total = 2;
            const player = await makeTraveller(objective);
            const { world } = await enterSystem('nova:130', player);
            const special = missionShipsIn(world)
                .filter(([, e]) => !e.components.get(MissionShipComponent)!.aux);
            expect(special.length).toBe(2);
            // One of them is destroyed / has flown off.
            world.entities.delete(special[0][0]);
            const census = liveMissionShips(world.entities, PLAYER);
            const topUp = await buildMissionShipSpawns(player, PLAYER,
                'nova:130', gameData, universe, 0, () => 0.5, census);
            const newSpecial = topUp.filter(ship =>
                !ship.components.get(MissionShipComponent)!.aux);
            expect(newSpecial.length).toBe(1);
        });

    it('keeps the objective\'s own progress state across the hop', async () => {
        const { objective } = await karrodObjective();
        const player = await makeTraveller(objective);
        const { world } = await enterSystem('nova:130', player);
        const live = player.components.get(MissionsComponent)!
            .get('nova:792')!.shipObjective!;
        // The ships that are here are tracked...
        expect(live.live.size).toBeGreaterThan(0);
        leaveSystem(world);
        const { world: next } = await enterSystem('nova:129', player);
        const after = player.components.get(MissionsComponent)!
            .get('nova:792')!.shipObjective!;
        // ...and the roster is the NEW system's ships, not both systems'.
        expect(after.live.size).toBe(missionShipsIn(next)
            .filter(([, e]) => !e.components.get(MissionShipComponent)!.aux)
            .length);
        expect(after.total).toBe(objective.total);
        expect(after.satisfied).toBe(0);
        expect(after.complete).toBeFalse();
        expect(after.failed).toBeFalse();
    });
});
