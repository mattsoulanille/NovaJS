import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    restoreWorld, snapshotWorld, SnapshotPoliciesResource,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { deriveEntityComponents, GovtComponent } from '../core/index.js';
import { BayFighterComponent } from '../escorts/index.js';
import { makeSystem } from '../make_system.js';
import {
    DamagedEvent, DisabledComponent, FiringGroupComponent, makeShip,
    OwnerComponent, ShipComponent, SourceComponent, TargetComponent,
} from '../ship/index.js';
import { completeEntity } from '../spawn/index.js';
import { ControlledByComponent } from '../player/index.js';
import { NpcComponent } from './npc_component.js';
import { FormationComponent } from './npc_formation.js';
import { aimedAt, responsibleShip } from './npc_targeting.js';

/**
 * An NPC records the SHIP that attacked it, and one ship per attacking
 * flock (npc_targeting.ts's responsibleShip).
 *
 * Matthew's Heraan playtest (2026-11-23): a fleeing trader's recorded
 * aggressor was sometimes a projectile (`nova:443:projectile:243`, a
 * submunition naming the projectile it split from), and in a fight with a
 * carrier it alternated between the carrier and each of its bay fighters
 * hit by hit, so the trader swung its flee heading from one to the next.
 */

function lookup(entities: Record<string, Entity>) {
    return (uuid: string) => entities[uuid];
}

function ship(): Entity {
    return new Entity().addComponent(ShipComponent, { id: 'test:hull' });
}

describe('responsibleShip', () => {
    it('resolves a submunition to the ship that fired its parent', () => {
        const firer = ship();
        const parent = new Entity().addComponent(SourceComponent, 'firer');
        const sub = new Entity().addComponent(SourceComponent, 'parent');
        expect(responsibleShip(sub, lookup({ firer, parent })))
            .toBe('firer');
    });

    it("prefers the weapon's firing-group root: a bay fighter's shot is "
        + 'its carrier\'s', () => {
            const carrier = ship();
            const fighter = ship()
                .addComponent(SourceComponent, 'carrier')
                .addComponent(OwnerComponent, { owner: 'carrier' });
            const shot = new Entity()
                .addComponent(SourceComponent, 'fighter')
                .addComponent(OwnerComponent, { owner: 'carrier' })
                .addComponent(FiringGroupComponent, { group: 'carrier' });
            expect(responsibleShip(shot, lookup({ carrier, fighter })))
                .toBe('carrier');
        });

    it('falls back to the firer when the root has left the world or lies '
        + 'disabled', () => {
            const escort = ship();
            const shot = new Entity()
                .addComponent(SourceComponent, 'escort')
                .addComponent(FiringGroupComponent, { group: 'leader' });
            // The fleet's leader is dead; its escorts fight on.
            expect(responsibleShip(shot, lookup({ escort }))).toBe('escort');
            const leader = ship().addComponent(DisabledComponent, { repairAt: null });
            expect(responsibleShip(shot, lookup({ escort, leader })))
                .toBe('escort');
        });

    it('stops at the first ship: a group-less fighter shot is the '
        + "fighter's, not its carrier's", () => {
            const carrier = ship();
            const fighter = ship().addComponent(SourceComponent, 'carrier');
            const shot = new Entity().addComponent(SourceComponent, 'fighter');
            expect(responsibleShip(shot, lookup({ carrier, fighter })))
                .toBe('fighter');
        });

    describe('a PLAYER\'s flock (reference "A trader shot by the player\'s '
        + 'escort, wave 12")', () => {
        function player(): Entity {
            return ship().addComponent(ControlledByComponent,
                { peerId: 'peer' });
        }

        it('records the escort that fired, not the player', () => {
            const escort = ship()
                .addComponent(FormationComponent, { leader: 'player', slot: 0 })
                .addComponent(FiringGroupComponent, { group: 'player' });
            const shot = new Entity()
                .addComponent(SourceComponent, 'escort')
                .addComponent(FiringGroupComponent, { group: 'player' });
            expect(responsibleShip(shot,
                lookup({ player: player(), escort }))).toBe('escort');
        });

        it('the player\'s own shot is the player\'s', () => {
            const shot = new Entity()
                .addComponent(SourceComponent, 'player')
                .addComponent(FiringGroupComponent, { group: 'player' });
            expect(responsibleShip(shot, lookup({ player: player() })))
                .toBe('player');
        });

        it('a bay fighter\'s shot is its CARRIER\'s: the player\'s own '
            + 'fighters\' the player\'s, an escort carrier\'s the escort\'s',
            () => {
                const fighter = ship()
                    .addComponent(SourceComponent, 'player')
                    .addComponent(OwnerComponent, { owner: 'player' })
                    .addComponent(FiringGroupComponent, { group: 'player' });
                const shot = new Entity()
                    .addComponent(SourceComponent, 'fighter')
                    .addComponent(FiringGroupComponent, { group: 'player' });
                expect(responsibleShip(shot,
                    lookup({ player: player(), fighter }))).toBe('player');

                const carrier = ship()
                    .addComponent(FormationComponent,
                        { leader: 'player', slot: 0 })
                    .addComponent(FiringGroupComponent, { group: 'player' });
                const escortFighter = ship()
                    .addComponent(SourceComponent, 'carrier')
                    .addComponent(FiringGroupComponent, { group: 'player' });
                const escortShot = new Entity()
                    .addComponent(SourceComponent, 'escortFighter')
                    .addComponent(FiringGroupComponent, { group: 'player' });
                expect(responsibleShip(escortShot, lookup({
                    player: player(), carrier, escortFighter,
                }))).toBe('carrier');
                // A disabled carrier's fighter fights on in its own name.
                carrier.components.set(DisabledComponent, { repairAt: null });
                expect(responsibleShip(escortShot, lookup({
                    player: player(), carrier, escortFighter,
                }))).toBe('escortFighter');
            });

        it('the root still answers when the firer has left the world', () => {
            const shot = new Entity()
                .addComponent(SourceComponent, 'gone')
                .addComponent(FiringGroupComponent, { group: 'player' });
            expect(responsibleShip(shot, lookup({ player: player() })))
                .toBe('player');
        });
    });

    it('resolves nothing when the whole chain is gone', () => {
        const sub = new Entity().addComponent(SourceComponent, 'parent');
        expect(responsibleShip(sub, lookup({}))).toBeUndefined();
        expect(responsibleShip(undefined, lookup({}))).toBeUndefined();
    });
});

describe('aimedAt (only an aimed hit is an attack)', () => {
    it("reads the shot's own target, its firer's, or the root's", () => {
        const firer = ship();
        const leader = ship();
        const shot = new Entity().addComponent(SourceComponent, 'firer');
        const get = lookup({ firer, leader });
        expect(aimedAt('victim', shot, 'leader', get)).toBeFalse();
        firer.components.set(TargetComponent, { target: 'victim' });
        expect(aimedAt('victim', shot, 'leader', get)).toBeTrue();
        firer.components.set(TargetComponent, { target: 'player' });
        leader.components.set(TargetComponent, { target: 'victim' });
        expect(aimedAt('victim', shot, 'leader', get)).toBeTrue();
        leader.components.set(TargetComponent, { target: undefined });
        expect(aimedAt('victim', shot, 'leader', get)).toBeFalse();
        // Fired at the victim, though the firer has since switched.
        shot.components.set(TargetComponent, { target: 'victim' });
        expect(aimedAt('victim', shot, 'leader', get)).toBeTrue();
    });
});

const WARDEN = SYNTHETIC.ships.warden;
const CORSAIR = SYNTHETIC.ships.corsair;
const MERIDIAN = SYNTHETIC.govts.meridian;
const RAIDERS = SYNTHETIC.govts.raiders;

describe('An NPC fighting a carrier and its wing', () => {
    async function carrierFight() {
        const gameData = await getSyntheticGameData();
        // Thessaly Reach: no asteroids; npcs off, so only these ships.
        const world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        async function addShip(uuid: string, shipId: string, x: number,
            setup: (ship: Entity) => void) {
            const entity = makeShip(await gameData.data.Ship.get(shipId));
            entity.components.set(MultiplayerData, { owner: 'server' });
            setup(entity);
            await completeEntity(world, entity);
            entity.components.set(MovementStateComponent, {
                position: new Position(x, 0), velocity: new Vector(0, 0),
                rotation: new Angle(0), accelerating: 0, turning: 0,
                turnBack: false,
            });
            world.entities.set(uuid, entity);
        }
        // A raider warship. It stands and fights, so the carrier's wing
        // (no faster than it) reaches it: a corsair that RAN outpaced the
        // skiffs and was only ever hit by the carrier.
        await addShip('raider', CORSAIR, 500, entity => {
            entity.components.set(GovtComponent, { id: RAIDERS });
            entity.components.set(NpcComponent,
                { aiType: 3, nextDecision: 0, departAt: 1e9 });
        });
        // The Heron Warden (Skiff Bay, two skiffs aboard) set on it.
        await addShip('carrier', WARDEN, 0, entity => {
            entity.components.set(NpcComponent,
                { aiType: 3, aggressor: 'raider', departAt: 1e9 });
            entity.components.set(GovtComponent, { id: MERIDIAN });
            entity.components.set(TargetComponent, { target: 'raider' });
        });
        return world;
    }

    /** Steps `ticks` ticks; notes who landed hits on the raider and the
     * aggressor it held after each tick, and counts the times that
     * changed from one ship to another. */
    function fight(world: World, ticks: number) {
        const hitters = new Set<string>();
        const recorded = new Set<string>();
        let switches = 0;
        const raider = world.entities.get('raider')!;
        const subscription = world.events.get(DamagedEvent).subscribe(
            ({ data, entities }) => {
                if (!entities?.some(e => e === raider || e === 'raider')) {
                    return;
                }
                const { damager } = data as { damager: string };
                const firer = world.entities.get(damager)
                    ?.components.get(SourceComponent);
                if (firer) {
                    hitters.add(world.entities.get(firer)?.components
                        .has(BayFighterComponent) ? 'fighter' : firer);
                }
            });
        let last: string | undefined;
        for (let i = 0; i < ticks; i++) {
            world.step();
            const aggressor = raider.components.get(NpcComponent)?.aggressor;
            if (aggressor !== undefined) {
                recorded.add(aggressor);
                if (last !== undefined && aggressor !== last) {
                    switches++;
                }
                last = aggressor;
            }
        }
        subscription.unsubscribe();
        return { hitters, recorded, switches };
    }

    it("records the carrier for its fighters' hits too", async () => {
        const world = await carrierFight();
        const { hitters, recorded, switches } = fight(world, 60 * 8);
        // Both the carrier's guns and its skiffs hit the raider...
        expect(hitters).toContain('carrier');
        expect(hitters).toContain('fighter');
        // ...and the only aggressor it ever held is the carrier, so it
        // fights (or would flee) the one ship. Before the fix: the
        // carrier and a skiff, swapping 4 times in these 8 s.
        expect([...recorded]).toEqual(['carrier']);
        expect(switches).toBe(0);
    });

    it('replays identically from a snapshot mid-fight', async () => {
        const world = await carrierFight();
        for (let i = 0; i < 60 * 3; i++) {
            world.step();
        }
        const atBreak = snapshotWorld(world);
        const record = () => {
            const hashes: string[] = [];
            const aggressors: (string | undefined)[] = [];
            for (let i = 0; i < 60 * 4; i++) {
                world.step();
                hashes.push(hashWorld(world).hash);
                aggressors.push(world.entities.get('raider')?.components
                    .get(NpcComponent)?.aggressor);
            }
            return { hashes, aggressors };
        };
        const first = record();
        restoreWorld(world, atBreak, deriveEntityComponents);
        const second = record();
        expect(second.aggressors).toEqual(first.aggressors);
        expect(second.hashes).toEqual(first.hashes);
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        expect([...policies.unhandled]).toEqual([]);
    });
});
