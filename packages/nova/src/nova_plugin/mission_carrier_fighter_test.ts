import 'jasmine';
import { getDefaultGovtData } from 'novadatainterface/govt_data';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultOutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import {
    BayWeaponData, getDefaultBayWeaponData,
} from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { World } from 'nova_ecs/world';
import { BayFighterComponent } from './bay_plugin.js';
import { completeEntity } from './entity_data_loader.js';
import { EscortCommandComponent } from './escort_command.js';
import { FiringGroupComponent } from './firing_group.js';
import { isInFlock } from './flock.js';
import { GovtComponent } from './govt_component.js';
import { makeShip } from './make_ship.js';
import { makeSystem } from './make_system.js';
import { MissionShipComponent } from './mission_ship_component.js';
import { FormationComponent, NpcComponent } from './npc_ai_plugin.js';
import { PlayerEscortComponent } from './player_escort.js';
import {
    escortsOnPayroll, playerEscortLink, sweepableEscorts,
} from './player_escort_plugin.js';
import { ActiveMission, MissionsComponent } from './player_state_plugin.js';
import { ControlledByComponent } from './ship_control.js';
import { TargetComponent } from './target_component.js';
import { OwnerComponent, SourceComponent } from './weapon_components.js';

/**
 * ============================================================================
 * A MISSION CARRIER'S WING BELONGS TO THE MISSION, NOT TO THE PLAYER
 * ============================================================================
 *
 * Matthew's playtest, still growing after the one-batch-per-system fix
 * (2a565960): "I gain more escorts every time I change systems" — 0 -> 10
 * -> 18 across two systems, with mïsn 792 active.
 *
 * mïsn 792's ShipBehav 1 special ship is düde nova:241, which is always
 * shïp nova:302 — an Aurora Carrier with eight fighter bays — and the
 * mission spawns two of them (ShipCount 1 plus one AuxShip) in whatever
 * system the player is in. ShipBehav 1 flies each one in FORMATION on the
 * player, sharing the player's firing group, so a fighter it launches has
 * the chain
 *
 *     fighter --Owner/Formation--> carrier --Formation--> player
 *
 * and the escort-ownership walk topped out at the PLAYER. The mission-ship
 * exclusions in MarkPlayerEscortsSystem and sweepableEscorts missed them,
 * because the FIGHTERS are not mission ships. They were marked
 * PlayerEscort, swept through the jump, re-parented straight onto the
 * player at the far end (their carrier is not in the batch), and could
 * never dock again — while the destination system spawned a fresh pair of
 * carriers that launched a fresh wing.
 *
 * The rule these specs pin: the escort-ownership walk STOPS at a mission
 * ship, so a candidate whose chain passes through one is that mission
 * ship's wing and is nobody's escort (playerEscortLink, "THE MISSION-SHIP
 * BOUNDARY"). The mechanism is exercised here against a synthetic carrier
 * so the whole launch chain runs; mission_ship_transition_test.ts pins the
 * same rule against the REAL mïsn 792 / düde nova:241 / shïp nova:302
 * data.
 *
 * The FLOCK semantics are deliberately untouched, and the last spec says
 * so: combat, point defense, friendly fire and the target cycle must all
 * keep reading the wing as part of the player's flock. Only "is this ship
 * mine, to carry and to pay for?" changed.
 */

const CARRIER_SHIP = 'test:carrierShip';
const FIGHTER_SHIP = 'test:fighterShip';
const ENEMY_SHIP = 'test:enemyShip';
const BAY_ID = 'test:bay';
const BAY_OUTFIT = 'test:bayOutfit';
const FIGHTER_OUTFIT = 'test:fighterOutfit';

const PLAYER = 'test player';
const CARRIER = 'test carrier';
const ENEMY = 'test enemy';
const PEER = 'test peer';
const MISSION = 'test:mission';

/** Xenophobic, and willing to take any odds: it engages on sight. */
const PIRATE = 'test:pirate';
const MEEK = 'test:meek';

async function stepWorld(world: World, steps: number) {
    for (let i = 0; i < steps; i++) {
        world.step();
        await new Promise(resolve => setImmediate(resolve));
    }
}

function fighters(world: World): [string, Entity][] {
    return [...world.entities]
        .filter(([, entity]) => entity.components.has(BayFighterComponent))
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
}

/** A minimal active mission, so the owner-absence cleanup keeps the ship. */
function activeMission(): ActiveMission {
    return {
        id: MISSION,
        acceptedDay: 0,
        acceptedAt: 'test:planet',
        travelPlanet: null,
        returnPlanet: null,
        cargoType: -1,
        cargoQty: 0,
        cargoLoaded: false,
        travelDone: false,
        deadlineDay: null,
    };
}

/**
 * A player, a carrier flying formation on them, and an enemy for the
 * carrier to engage.
 *
 * `mission: true` makes the carrier a mïsn ShipBehav 1 special ship (the
 * bug's shape); `mission: false` makes it an ordinary HIRED carrier escort
 * (the control, whose wing genuinely IS the player's).
 */
async function makeWorld({ mission }: { mission: boolean }) {
    const gameData = new MockGameData();

    const bay: BayWeaponData = {
        ...getDefaultBayWeaponData(),
        id: BAY_ID,
        shipID: FIGHTER_SHIP,
        ammoType: ['weapon', BAY_ID],
        maxAmmo: 4,
        fireGroup: 'secondary',
        reload: 1,
    };
    gameData.data.Weapon.map.set(BAY_ID, bay);
    gameData.data.Outfit.map.set(BAY_OUTFIT, {
        ...getDefaultOutfitData(), id: BAY_OUTFIT, weapons: { [BAY_ID]: 1 },
    });
    gameData.data.Outfit.map.set(FIGHTER_OUTFIT, {
        ...getDefaultOutfitData(), id: FIGHTER_OUTFIT, ammoFor: BAY_ID,
    });
    gameData.data.Ship.map.set(FIGHTER_SHIP, {
        ...getDefaultShipData(), id: FIGHTER_SHIP,
    });
    gameData.data.Ship.map.set(ENEMY_SHIP, {
        ...getDefaultShipData(), id: ENEMY_SHIP, strength: 1,
    });
    const carrierData: ShipData = {
        ...getDefaultShipData(),
        id: CARRIER_SHIP,
        strength: 100,
        outfits: { [BAY_OUTFIT]: 1, [FIGHTER_OUTFIT]: 2 },
    };
    gameData.data.Ship.map.set(CARRIER_SHIP, carrierData);

    const pirate = getDefaultGovtData();
    pirate.id = PIRATE;
    pirate.flags.xenophobic = true;
    // A present MaxOdds of 0 means "never accept a fight"; the default
    // govt has one, so a default-govt warship refuses to engage anything.
    pirate.maxOdds = 300;
    gameData.data.Govt.map.set(PIRATE, pirate);
    const meek = getDefaultGovtData();
    meek.id = MEEK;
    gameData.data.Govt.map.set(MEEK, meek);
    await gameData.data.Govt.get(PIRATE);
    await gameData.data.Govt.get(MEEK);

    const world = await makeSystem('test:system', gameData, undefined,
        { npcs: false });

    async function addShip(uuid: string, shipId: string, x: number,
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(gameData.data.Ship.map.get(shipId)!);
        ship.components.set(MovementStateComponent, {
            accelerating: 0,
            position: new Position(x, 0),
            rotation: new Angle(0),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        });
        setup(ship);
        await completeEntity(world, ship);
        world.entities.set(uuid, ship);
        return ship;
    }

    const player = await addShip(PLAYER, CARRIER_SHIP, 0, ship => {
        ship.components.set(ControlledByComponent, { peerId: PEER });
        ship.components.set(MissionsComponent,
            new Map([[MISSION, activeMission()]]));
        // The player's own bays stay shut: every fighter in these specs
        // comes out of the carrier below.
        ship.components.set(TargetComponent, { target: undefined });
    });

    const carrier = await addShip(CARRIER, CARRIER_SHIP, 200, ship => {
        ship.components.set(NpcComponent, { aiType: 3 });
        ship.components.set(GovtComponent, { id: PIRATE });
        ship.components.set(TargetComponent, { target: undefined });
        // ShipBehav 1 / a hired escort look identical from here: formation
        // on the player, sharing the player's firing group.
        ship.components.set(FormationComponent, { leader: PLAYER, slot: 0 });
        ship.components.set(FiringGroupComponent, { group: PLAYER });
        if (mission) {
            ship.components.set(MissionShipComponent,
                { mission: MISSION, owner: PLAYER });
        } else {
            ship.components.set(PlayerEscortComponent,
                { player: PLAYER, parent: PLAYER, provenance: 'hired' });
        }
    });

    await addShip(ENEMY, ENEMY_SHIP, 500, ship => {
        ship.components.set(GovtComponent, { id: MEEK });
    });

    // The carrier's first think ran with an empty sky; force the next one.
    carrier.components.get(NpcComponent)!.nextDecision = 0;
    await stepWorld(world, 6);
    return { world, player, carrier, gameData };
}

describe('a mission carrier\'s bay fighters', () => {
    it('launches them as its OWN wing, chained through the carrier',
        async () => {
            const { world } = await makeWorld({ mission: true });
            const wing = fighters(world);
            expect(wing.length).withContext('fighters launched')
                .toBeGreaterThan(0);
            for (const [, fighter] of wing) {
                expect(fighter.components.get(OwnerComponent)?.owner)
                    .toBe(CARRIER);
                expect(fighter.components.get(SourceComponent)).toBe(CARRIER);
                expect(fighter.components.get(FormationComponent)?.leader)
                    .toBe(CARRIER);
            }
        });

    it('never marks them as the player\'s escorts', async () => {
        const { world } = await makeWorld({ mission: true });
        const wing = fighters(world);
        expect(wing.length).toBeGreaterThan(0);
        for (const [uuid, fighter] of wing) {
            expect(playerEscortLink(uuid, u => world.entities.get(u)))
                .withContext(`ownership walk from ${uuid}`)
                .toBeUndefined();
            expect(fighter.components.has(PlayerEscortComponent))
                .withContext(`${uuid} marked as a player escort`)
                .toBeFalse();
        }
    });

    it('never sweeps them through a jump or a gate', async () => {
        const { world } = await makeWorld({ mission: true });
        expect(fighters(world).length).toBeGreaterThan(0);
        for (const kind of ['jump', 'gate'] as const) {
            expect(sweepableEscorts(world.entities, PLAYER, kind))
                .withContext(`${kind} sweep`)
                .toEqual([]);
        }
    });

    /**
     * The accumulation itself, in one assertion: the fighters were swept,
     * so they arrived in the next system AND a fresh batch of carriers
     * launched a fresh wing there. Sweeping nothing is what stops it.
     */
    it('leaves the flock the same size after leaving and re-entering '
        + 'a system', async () => {
            const { world } = await makeWorld({ mission: true });
            const before = fighters(world).length;
            expect(before).toBeGreaterThan(0);
            // The player departs (JumpFromSystem / the landing removal
            // both do exactly this) and the world keeps running.
            expect(sweepableEscorts(world.entities, PLAYER, 'jump'))
                .toEqual([]);
            world.entities.delete(PLAYER);
            await stepWorld(world, 5);
            // Nothing was carried out, so nothing arrives anywhere: the
            // whole wing stays with the system it was launched in.
            expect(fighters(world).length).toBeLessThanOrEqual(before);
        });

    it('never puts them on the payroll', async () => {
        const { world } = await makeWorld({ mission: true });
        expect(fighters(world).length).toBeGreaterThan(0);
        expect(escortsOnPayroll(world.entities, PLAYER)).toEqual([]);
    });

    /**
     * The despawn consequence. MissionShipCleanupSystem deletes a mission
     * ship whose owner has left the simulation (or whose mission ended);
     * its wing is then an orphaned NPC wing, and
     * bay_plugin's OrphanedBayFighterSystem — which exempts only
     * PlayerEscort-marked fighters, precisely the mark these no longer
     * carry — hands each one the graceful exit every other orphaned wing
     * gets: escort command and formation dropped, NPC 'depart' mode, flown
     * out of the system and deleted at NPC_DEPART_RADIUS.
     */
    it('retires them like any orphaned NPC wing when the carrier goes',
        async () => {
            const { world } = await makeWorld({ mission: true });
            const wing = fighters(world);
            expect(wing.length).toBeGreaterThan(0);
            // The mission ends / the owner leaves: cleanup takes the
            // carrier.
            world.entities.delete(CARRIER);
            await stepWorld(world, 3);
            for (const [uuid, fighter] of fighters(world)) {
                expect(fighter.components.get(NpcComponent)?.mode)
                    .withContext(`${uuid} departing`)
                    .toBe('depart');
                expect(fighter.components.has(EscortCommandComponent))
                    .withContext(`${uuid} still under escort command`)
                    .toBeFalse();
                expect(fighter.components.has(PlayerEscortComponent))
                    .withContext(`${uuid} claimed by the player on the way out`)
                    .toBeFalse();
            }
        });

    /**
     * THE CONTROL. The same carrier, the same launch chain, the same
     * formation on the player — but an ordinary hired escort rather than a
     * mission ship. Its wing IS the player's, transitively, and must keep
     * every bit of the behaviour the mission case gives up.
     */
    it('still marks and sweeps a HIRED carrier escort\'s wing', async () => {
        const { world } = await makeWorld({ mission: false });
        const wing = fighters(world);
        expect(wing.length).toBeGreaterThan(0);
        for (const [uuid, fighter] of wing) {
            expect(playerEscortLink(uuid, u => world.entities.get(u)))
                .withContext(`ownership walk from ${uuid}`)
                .toEqual({ player: PLAYER, parent: CARRIER });
            expect(fighter.components.get(PlayerEscortComponent))
                .withContext(`${uuid}'s ownership marker`)
                .toEqual({ player: PLAYER, parent: CARRIER });
        }
        const swept = sweepableEscorts(world.entities, PLAYER, 'jump');
        for (const [uuid] of wing) {
            expect(swept).withContext(`${uuid} swept`).toContain(uuid);
        }
        expect(swept).withContext('the carrier itself').toContain(CARRIER);
    });

    /**
     * FLOCK SEMANTICS ARE UNCHANGED. flock.ts answers a different question
     * — "may I shoot this, may my point defense aim at it, does the target
     * cycle hide it?" — and a mission carrier's wing flies with the player
     * sharing their firing group, so the answer there must still be yes.
     * Changing flockParent instead of the ownership walk would have turned
     * the player's own escorts into legitimate targets.
     */
    it('keeps them inside the player\'s flock for combat purposes',
        async () => {
            const { world } = await makeWorld({ mission: true });
            const wing = fighters(world);
            expect(wing.length).toBeGreaterThan(0);
            for (const [uuid] of wing) {
                expect(isInFlock(uuid, PLAYER, u => world.entities.get(u)))
                    .withContext(`${uuid} in the player's flock`)
                    .toBeTrue();
            }
        });
});
