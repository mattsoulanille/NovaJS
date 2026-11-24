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
import { BayFighterComponent } from '../escorts/index.js';
import { makeSystem } from '../make_system.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { ControlledByComponent } from '../player/index.js';
import {
    BLAST_FLOCK_RULE, DamagedEvent, DisabledComponent, FiringGroupComponent,
    makeShip, TargetComponent,
} from '../ship/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { AggressionComponent } from './aggression.js';
import { WeaponEntries } from './fire_weapon_plugin.js';

/**
 * ============================================================================
 * Splash damage inside a flock: who gets hurt, and who turns hostile
 * ============================================================================
 *
 * Matthew's report (2026-11-23): an AI with a carried ship or escort may
 * turn hostile to that escort when the escort fires a missile that explodes
 * near the parent and damages it.
 *
 * Direct hits pass through the flock (firing_group.ts). BLASTS do too,
 * unless the weapon lacks wëap Flags 0x0100 ("blast doesn't hurt the
 * player"): such a blast carries no firing group at all and hurts every
 * ship in its radius — the firer's leader, carrier and wingmates included
 * (BLAST_FLOCK_RULE, ship/firing_group.ts). The damage is a game rule still
 * being checked against the original; the HOSTILITY that followed from it
 * was a bug whatever the answer: NpcAggressionSystem recorded the blast's
 * firer as the parent's aggressor, and a warship parent then hunted its own
 * escort. A ship never takes its own flock as an aggressor.
 *
 * All on the synthetic data set: its splash weapons (Scatter Rocket,
 * Flashpoint Charge and its 0x0100 twin, the Tethered Flashpoint) are fired
 * through the real weapon pipeline, and the bay fighter is a real launch
 * from the Heron Warden's Skiff Bay.
 */

const CORSAIR = SYNTHETIC.ships.corsair;
const WARDEN = SYNTHETIC.ships.warden;
const SKIFF = SYNTHETIC.ships.skiff;
const SKIFF_BAY = SYNTHETIC.weapons.skiffBay;
const SCATTER_ROCKET = SYNTHETIC.weapons.scatterRocket;
const FLASHPOINT = SYNTHETIC.weapons.flashpoint;
const TETHERED_FLASHPOINT = SYNTHETIC.weapons.tetheredFlashpoint;
const MERIDIAN = SYNTHETIC.govts.meridian;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

describe('splash damage inside a flock', () => {
    let gameData: GameData;
    let world: World;
    let damaged: Array<{ uuid: string, damager: string }>;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach: no asteroids, and npcs off, so nothing else is
        // in the world.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        damaged = [];
        world.addSystem(new System({
            name: 'DamageRecorder',
            events: [DamagedEvent],
            args: [DamagedEvent, UUID] as const,
            step({ damager }, uuid) {
                damaged.push({ uuid, damager });
            },
        }));
    });

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
        setup: (ship: Entity) => void = () => { }) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        world.entities.set(uuid, ship);
        return ship;
    }

    /** A Meridian warship brain: the AI type that hunts its aggressor. */
    function npc(ship: Entity) {
        ship.components.set(NpcComponent, { aiType: 3 });
        ship.components.set(GovtComponent, { id: MERIDIAN });
    }

    /** A fleet as npc_spawn_plugin builds one: leader + formation escort,
     * one firing group named for the leader. */
    async function addFleet() {
        const leader = await addShip('leader', CORSAIR, 1000, 1000, ship => {
            npc(ship);
            ship.components.set(FiringGroupComponent, { group: 'leader' });
        });
        const escort = await addShip('escort', SKIFF, 1000, 1060, ship => {
            npc(ship);
            ship.components.set(FormationComponent,
                { leader: 'leader', slot: 0 });
            ship.components.set(FiringGroupComponent, { group: 'leader' });
        });
        await settle();
        return { leader, escort };
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    /** Lets the providers attach hulls, weapon state and the rest. */
    async function settle() {
        step(20);
    }

    /** Fires `weaponId` once from `from`, staged the way the loader stages
     * a ship's own weapons (see firing_group_integration_test.ts), with
     * inaccuracy off. */
    async function fire(weaponId: string, from: string) {
        await loadWeaponsGameData(world, [weaponId]);
        const weapon = world.resources.get(WeaponEntries)!.getCached(weaponId);
        expect(weapon).withContext(`${weaponId} staged`).toBeDefined();
        const shot = weapon!.fireFromEntity(from, false);
        expect(shot).withContext(`${from} fired ${weaponId}`).toBeDefined();
        return shot!;
    }

    function hitsOn(uuid: string) {
        return damaged.filter(hit => hit.uuid === uuid);
    }

    function aggressorOf(ship: Entity) {
        return ship.components.get(NpcComponent)?.aggressor;
    }

    /** Launches one real fighter from `carrier`'s Skiff Bay, through the
     * bay's own weapon entry (BayWeaponEntry: formation slot, owner chain,
     * govt, firing group — everything a launch stamps). */
    async function launchFighter(carrier: string): Promise<[string, Entity]> {
        await fire(SKIFF_BAY, carrier);
        step(2);
        const launched = [...world.entities].filter(([, entity]) =>
            entity.components.has(BayFighterComponent));
        expect(launched.length).withContext('one fighter launched').toBe(1);
        return launched[0];
    }

    it('runs under the current blast rule', () => {
        // The default this file's damage expectations are written for;
        // flipping the switch changes who is HURT, never who turns
        // hostile.
        expect(BLAST_FLOCK_RULE).toBe('firerFlagSparesFlock');
    });

    describe('an NPC fleet', () => {
        it('a 1-frame huge blast from the escort hurts the leader, '
            + 'who does not turn on its escort', async () => {
            const { leader, escort } = await addFleet();
            pin(leader, 1000, 1000);
            pin(escort, 1000, 1060);
            await fire(FLASHPOINT, 'escort');
            step(5);

            // (a) The blast (no 0x0100: it carries no firing group) DOES
            // reach the leader — and the escort itself.
            expect(hitsOn('leader').length)
                .withContext('blast damage reaches the leader').toBe(1);
            expect(hitsOn('escort').length)
                .withContext('and the firer').toBe(1);
            // (b) The bug: the leader recorded its escort as aggressor.
            expect(aggressorOf(leader))
                .withContext('leader never takes its escort as aggressor')
                .toBeUndefined();

            // And so never hunts it: a warship with an aggressor and no
            // other ship in range would lock straight onto it.
            step(120);
            expect(leader.components.get(TargetComponent)?.target)
                .not.toBe('escort');
            expect(leader.components.get(NpcComponent)?.mode)
                .not.toBe('attack');
        });

        it('the leader\'s own splash does not turn its escort', async () => {
            const { leader, escort } = await addFleet();
            pin(leader, 1000, 1000);
            pin(escort, 1000, 1060);
            await fire(FLASHPOINT, 'leader');
            step(5);
            expect(hitsOn('escort').length).toBe(1);
            expect(aggressorOf(escort)).toBeUndefined();
            expect(aggressorOf(leader)).toBeUndefined();
        });

        it('an ordinary blast rocket at an outsider beside the leader: '
            + 'the outsider retaliates, the leader does not', async () => {
            const { leader, escort } = await addFleet();
            const outsider = await addShip('outsider', SKIFF, 1000, 860,
                ship => ship.components.set(NpcComponent, { aiType: 3 }));
            await settle();
            // The rocket flies -y from the escort into the outsider 200px
            // on; the leader sits beside the impact point, inside the 60px
            // blast but off the rocket's line.
            pin(escort, 1000, 1060);
            pin(leader, 1045, 870);
            pin(outsider, 1000, 860);
            // Aimed at the outsider: only an aimed hit is an attack.
            escort.components.set(TargetComponent, { target: 'outsider' });
            await fire(SCATTER_ROCKET, 'escort');
            step(40);

            expect(hitsOn('outsider').length)
                .withContext('direct hit + no double blast').toBe(1);
            expect(hitsOn('leader').length)
                .withContext('the splash reaches the leader').toBe(1);
            // ...against the FLEET, named for its leader: the escort's shot
            // roots at its firing group (npc_targeting.ts's responsibleShip).
            expect(aggressorOf(outsider))
                .withContext('a real victim still retaliates').toBe('leader');
            expect(aggressorOf(leader)).toBeUndefined();
        });

        it('a 0x0100 blast spares the flock; a DISABLED leader is hit but '
            + 'still does not turn', async () => {
            const { leader, escort } = await addFleet();
            pin(leader, 1000, 1000);
            pin(escort, 1000, 1060);
            await fire(TETHERED_FLASHPOINT, 'escort');
            step(5);
            expect(hitsOn('leader')).toEqual([]);
            expect(hitsOn('escort')).toEqual([]);

            // A disabled ship forfeits flock immunity (firing_group.ts). A
            // hulk stays disabled whatever its armor reads.
            leader.components.set(DisabledComponent,
                { repairAt: null, hulk: true });
            pin(leader, 1000, 1000);
            pin(escort, 1000, 1060);
            await fire(TETHERED_FLASHPOINT, 'escort');
            step(5);
            expect(hitsOn('leader').length).toBe(1);
            expect(aggressorOf(leader)).toBeUndefined();
        });
    });

    describe('an NPC carrier and its bay fighter', () => {
        it('the fighter\'s splash hurts the carrier, which does not turn',
            async () => {
                // A brain that has not thought yet: an idle carrier that
                // HAS (patrol) recalls its wing at once (NpcWingCommand-
                // System), and this fighter, launched beside it, would dock
                // before it could fire.
                const carrier = await addShip('carrier', WARDEN, 1000, 1000,
                    ship => {
                        npc(ship);
                        ship.components.set(NpcComponent, {
                            ...ship.components.get(NpcComponent)!,
                            nextDecision: Number.MAX_SAFE_INTEGER,
                        });
                    });
                await settle();
                const [fighterUuid, fighter] = await launchFighter('carrier');
                expect(fighter.components.get(FiringGroupComponent)?.group
                    ?? 'carrier').toBe('carrier');
                pin(carrier, 1000, 1000);
                pin(fighter, 1000, 1080);
                await fire(FLASHPOINT, fighterUuid);
                step(5);

                expect(hitsOn('carrier').length).toBe(1);
                expect(aggressorOf(carrier))
                    .withContext('carrier never takes its fighter as aggressor')
                    .toBeUndefined();
            });
    });

    describe('the player', () => {
        async function addPlayer() {
            const player = await addShip('player', WARDEN, 1000, 1000,
                ship => ship.components.set(ControlledByComponent,
                    { peerId: 'peer' }));
            await settle();
            return player;
        }

        it('the player\'s own fighter splashing the player records no '
            + 'aggression', async () => {
            const player = await addPlayer();
            const [fighterUuid, fighter] = await launchFighter('player');
            // Twice: 80 points, past the stray-damage threshold.
            for (let i = 0; i < 2; i++) {
                pin(player, 1000, 1000);
                pin(fighter, 1000, 1080);
                await fire(FLASHPOINT, fighterUuid);
                step(5);
            }
            expect(hitsOn('player').length).toBe(2);
            expect(player.components.get(AggressionComponent)
                ?.has(fighterUuid) ?? false)
                .withContext('own fighter is not an aggressor')
                .toBeFalse();
        });

        it('a protecting NPC in the player\'s flock, splashed by the '
            + 'player, does not record the player', async () => {
            const player = await addPlayer();
            const guard = await addShip('guard', SKIFF, 1000, 1080, ship => {
                npc(ship);
                ship.components.set(FormationComponent,
                    { leader: 'player', slot: 0 });
                ship.components.set(FiringGroupComponent, { group: 'player' });
            });
            await settle();
            pin(player, 1000, 1000);
            pin(guard, 1000, 1080);
            await fire(FLASHPOINT, 'player');
            step(5);
            expect(hitsOn('guard').length).toBe(1);
            expect(aggressorOf(guard)).toBeUndefined();
        });
    });
});
