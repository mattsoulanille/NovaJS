import 'jasmine';
import { UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { GovtComponent } from '../core/index.js';
import { makeSystem } from '../make_system.js';
import { DeathAIComponent, NpcComponent } from '../npc/index.js';
import {
    ActiveMission, ControlledByComponent, GOAL_DISABLE, MissionShipComponent,
    MissionsComponent, ShipObjective,
} from '../player/index.js';
import {
    CombatRatingComponent, DamageAttributionComponent,
} from '../reputation/index.js';
import {
    ArmorComponent, DamagedEvent, DeathEvent, DisabledComponent, makeShip,
    ShieldComponent, ShipPhysicsComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { WeaponEntries } from '../combat/index.js';

/**
 * ============================================================================
 * "Fight to be Thurokiir": duellists hitting each other in a disable duel
 * ============================================================================
 *
 * Matthew (2026-11-23), playing stock mïsn 674 "Fight to be Thurokiir"
 * (ShipCount 5, ShipDude 224 "Duellists" = five Abomination-hull ships of
 * gövt 175 "Duellist", ShipGoal 1 "Disable but don't destroy them",
 * ShipBehav 0 "always attack the player"): "Can you check on this mission
 * whether disabled enemies are able to hit each other? They did just now".
 *
 * Only with a beam or a blast. All the duellists share one government,
 * so a duellist's BOLT passes through a fellow duellist
 * (SAME_GOVT_FIRING_IMMUNITY), DISABLED or not: on the original a
 * duellist's bolts aimed at the player flew through a disabled duellist
 * for 52 s (reference "The 'Fight to be Thurokiir' duel, wave 12"), so
 * firingImmune's disabled carve-out (ship/firing_group.ts) cancels only
 * the group immunity. A BEAM or a BLAST never spared a same-govt ship, so
 * it catches a duellist whether it is disabled or not.
 *
 * What these specs pin (synthetic stand-in: two Verge Raiders Corsairs as
 * the duellists, one government and no quarrel with each other, a third
 * Corsair as the player):
 *
 *  1. A duellist the PLAYER disabled is not hit by another duellist's bolt
 *     at the player.
 *  2. TODAY'S BEHAVIOUR, reference pending: a duellist that was NOT yet
 *     disabled and is destroyed by another duellist's splash fails the
 *     mission, though the player killed nobody. The goal bookkeeping
 *     (mission_ship_state.ts's shipDied) does not ask who killed the ship;
 *     whether the original does is what the reference Mac is to measure.
 */

const CORSAIR = SYNTHETIC.ships.corsair;
const BLASTER = SYNTHETIC.weapons.blaster;
const SCATTER_ROCKET = SYNTHETIC.weapons.scatterRocket;
const RAIDERS = SYNTHETIC.govts.raiders;
const MISSION_ID = 'nova:674';

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('a disable-goal duel where the duellists hit each other', () => {
    let gameData: GameData;
    let world: World;
    let hits: Array<{ uuid: string, damager: string }>;
    let deaths: string[];

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        hits = [];
        deaths = [];
        world.addSystem(new System({
            name: 'DuelRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                hits.push({ uuid, damager });
            },
        }));
        world.addSystem(new System({
            name: 'DuelDeathRecorder',
            events: [DeathEvent],
            args: [UUID] as const,
            step(uuid) {
                deaths.push(uuid);
            },
        }));
    });

    function objective(): ShipObjective {
        return {
            goal: GOAL_DISABLE, systemId: null, shipStart: 1, behavior: 0,
            dudeId: 'nova:224', total: 2, satisfied: 0, complete: false,
            failed: false, shipDonePending: false, live: new Map(),
        };
    }

    function active(): ActiveMission {
        return {
            id: MISSION_ID, acceptedDay: 0, acceptedAt: 'nova:128',
            travelPlanet: null, returnPlanet: 'nova:128', cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null, shipObjective: objective(),
        };
    }

    function pin(ship: Entity, x: number, y: number) {
        ship.components.set(MovementStateComponent, {
            position: new Position(x, y),
            velocity: new Vector(0, 0),
            rotation: new Angle(0), // Facing -y.
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
    }

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    /** A duellist: one government, a mission ship of the player's, and a
     * brain born asleep so only the spec's own shots are in the air. */
    function duellist(ship: Entity) {
        ship.components.set(NpcComponent,
            { aiType: 4, nextDecision: Number.MAX_SAFE_INTEGER });
        ship.components.set(GovtComponent, { id: RAIDERS });
        // Wrecks are removed when they finish exploding, as every NPC's.
        ship.components.set(DeathAIComponent, undefined);
        ship.components.set(MissionShipComponent,
            { mission: MISSION_ID, owner: 'player' });
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    function stats(ship: Entity) {
        return {
            armor: ship.components.get(ArmorComponent)!,
            shield: ship.components.get(ShieldComponent)!,
        };
    }

    function missionObjective() {
        return world.entities.get('player')!.components
            .get(MissionsComponent)!.get(MISSION_ID)!.shipObjective!;
    }

    async function fire(weaponId: string, from: string) {
        await loadWeaponsGameData(world, [weaponId]);
        const weapon = world.resources.get(WeaponEntries)!.getCached(weaponId);
        expect(weapon).withContext(`${weaponId} staged`).toBeDefined();
        expect(weapon!.fireFromEntity(from, false))
            .withContext(`${from} fired ${weaponId}`).toBeDefined();
    }

    /** Where the three ships sit. The shooter is always at the bottom
     * facing up (-y) toward the player at the top. */
    interface Layout { player: Position, victim: Position }

    /** The other duellist on the line between, nearer the shooter. */
    const IN_THE_LINE: Layout = {
        player: new Position(1000, 550), victim: new Position(1000, 850),
    };

    async function scene(layout: Layout) {
        const player = await addShip('player', CORSAIR,
            layout.player.x, layout.player.y, ship => {
                ship.components.set(ControlledByComponent, { peerId: 'peer' });
                ship.components.set(MissionsComponent,
                    new Map([[MISSION_ID, active()]]));
                ship.components.set(CombatRatingComponent, { kills: 0 });
            });
        const shooter = await addShip('shooter', CORSAIR, 1000, 1000,
            duellist);
        const victim = await addShip('victim', CORSAIR,
            layout.victim.x, layout.victim.y, duellist);
        step(20); // Providers attach hulls, weapon state, the rest.
        const objective = missionObjective();
        expect(objective.live.has('shooter')).toBeTrue();
        expect(objective.live.has('victim')).toBeTrue();
        return { player, shooter, victim };
    }

    function pinScene(ships: { player: Entity, shooter: Entity,
        victim: Entity }, layout: Layout) {
        pin(ships.player, layout.player.x, layout.player.y);
        pin(ships.shooter, 1000, 1000);
        pin(ships.victim, layout.victim.x, layout.victim.y);
    }

    function stepUntilDead(uuid: string, maxTicks: number) {
        for (let i = 0; i < maxTicks && !deaths.includes(uuid); i++) {
            world.step();
        }
        step(5);
        return deaths.includes(uuid);
    }

    it('another duellist\'s bolt at the player passes through a duellist '
        + 'the player disabled', async () => {
            const ships = await scene(IN_THE_LINE);
            const { victim, shooter } = ships;

            // The player disables it (as the last to damage it).
            const victimStats = stats(victim);
            victimStats.shield.current = 0;
            victimStats.armor.current = victimStats.armor.max * 0.05;
            victim.components.set(DamageAttributionComponent,
                { root: 'player', disabledAtHit: false });
            step(5);
            expect(victim.components.has(DisabledComponent)).toBeTrue();
            expect(missionObjective().satisfied).toBe(1);

            // The other duellist fires at the player, through the hulk.
            shooter.components.set(TargetComponent, { target: 'player' });
            pinScene(ships, IN_THE_LINE);
            hits = [];
            await fire(BLASTER, 'shooter');
            step(40);
            expect(hits.filter(hit => hit.uuid === 'victim'))
                .withContext('a disabled ship keeps its same-govt bolt '
                    + 'immunity')
                .toEqual([]);
            expect(deaths).not.toContain('victim');
            expect(missionObjective().failed).toBeFalse();
        });

    it('TODAY\'S BEHAVIOUR (reference pending): a duellist NOT yet disabled '
        + 'killed by another duellist\'s splash fails the mission, though '
        + 'the player killed nobody', async () => {
            // The victim beside the player (200 px ahead of the shooter),
            // inside the rocket's 60 px blast when it bursts on the player.
            const besideThePlayer: Layout = {
                player: new Position(1000, 800),
                victim: new Position(1040, 810),
            };
            const ships = await scene(besideThePlayer);
            const { victim, shooter, player } = ships;

            // Not disabled, but one splash from dead: shrink its hull so
            // the 15-point blast takes it straight from above the disable
            // threshold to zero.
            const physics = victim.components.get(ShipPhysicsComponent)!;
            victim.components.set(ShipPhysicsComponent,
                { ...physics, shield: 0, armor: 20 });
            step(2);
            const victimStats = stats(victim);
            victimStats.shield.current = 0;
            victimStats.armor.current = 14;
            step(2);
            expect(victimStats.armor.max).toBe(20);
            expect(victim.components.has(DisabledComponent)).toBeFalse();

            shooter.components.set(TargetComponent, { target: 'player' });
            pinScene(ships, besideThePlayer);
            hits = [];
            await fire(SCATTER_ROCKET, 'shooter');
            for (let i = 0; i < 120 && !hits.some(hit => hit.uuid === 'victim');
                i++) {
                pinScene(ships, besideThePlayer);
                step(1);
            }
            expect(hits.some(hit => hit.uuid === 'victim'))
                .withContext('the splash reaches the duellist beside the player')
                .toBeTrue();
            expect(stepUntilDead('victim', 600)).toBeTrue();

            const objective = missionObjective();
            expect(objective.satisfied).toBe(0);
            expect(objective.failed)
                .withContext('shipDied fails a ship that died undisabled, '
                    + 'whoever killed it')
                .toBeTrue();
            expect(player.components.get(CombatRatingComponent)!.kills)
                .toBe(0);
        });
});
