import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import {
    restoreWorld, snapshotWorld,
} from 'nova_ecs/plugins/snapshot_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { World } from 'nova_ecs/world';
import { WeaponDamage } from 'novadatainterface/weapon_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import {
    deriveEntityComponents, GovtComponent, SystemIdResource,
} from '../core/index.js';
import { makeSystem } from '../make_system.js';
import {
    ControlledByComponent, EscortCommandComponent,
} from '../player/index.js';
import {
    DamagedEvent, FiringGroupComponent, makeShip, SourceComponent,
    TargetComponent,
} from '../ship/index.js';
import { FormationComponent, NpcComponent } from '../npc/index.js';
import { completeEntity, loadWeaponsGameData } from '../spawn/index.js';
import { WeaponEntries } from './fire_weapon_plugin.js';
import { styleForTarget } from './hostility.js';

/**
 * ============================================================================
 * Fleet escorts defend their leader
 * ============================================================================
 *
 * Reference "P1 wave 13: police watching the player hit and kill a third
 * party; fleet escorts defending their leader" (docs/reference_experiments.md),
 * run 6: the player beamed the green AI 1 lead of a three-ship convoy whose
 * govt was neutral to it; both yellow AI 3 guards, never hit themselves,
 * turned back and fired at the player within about 4 s.
 *
 * NovaJS recorded the aggressor only on the ship that was hit, so the guards
 * flew on in formation. npc_targeting.ts's NpcAggressionSystem now records an
 * attack on a ship on its fleet escorts too (provokeFleet). Only the leader
 * -> escorts direction was measured: a hit on an escort is still that
 * escort's alone.
 *
 * Synthetic stand-ins: a Meridian Corsair (AI 1) as the convoy lead, two
 * more Corsairs (AI 3) as its guards, a Skiff as the player.
 */

const CORSAIR = SYNTHETIC.ships.corsair;
const SKIFF = SYNTHETIC.ships.skiff;
const BLASTER = SYNTHETIC.weapons.blaster;
const MERIDIAN = SYNTHETIC.govts.meridian;

type GameData = Awaited<ReturnType<typeof getSyntheticGameData>>;

const NO_DAMAGE: WeaponDamage = {
    shield: 0, armor: 0, ionization: 0, ionizationColor: 0xffffff,
    passThroughShield: 0, knockback: 0,
};

/** Never thinks until a test says so. */
const ASLEEP = Number.MAX_SAFE_INTEGER;

describe('fleet escorts defend their leader (reference P1 wave 13)', () => {
    let gameData: GameData;
    let world: World;

    beforeEach(async () => {
        gameData = await getSyntheticGameData();
        // Thessaly Reach, npcs off: only these ships.
        world = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
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

    const placed = new Map<string, readonly [number, number]>();

    async function addShip(uuid: string, shipId: string, x: number, y: number,
        setup: (ship: Entity) => void) {
        const ship = makeShip(await gameData.data.Ship.get(shipId));
        ship.components.set(MultiplayerData, { owner: 'server' });
        setup(ship);
        await completeEntity(world, ship);
        pin(ship, x, y);
        placed.set(uuid, [x, y]);
        world.entities.set(uuid, ship);
        return ship;
    }

    function step(ticks: number) {
        for (let i = 0; i < ticks; i++) {
            world.step();
        }
    }

    function npc(uuid: string) {
        return world.entities.get(uuid)!.components.get(NpcComponent)!;
    }

    function npcShip(aiType: number) {
        return (ship: Entity) => {
            ship.components.set(NpcComponent,
                { aiType, nextDecision: ASLEEP, departAt: 1e12 });
            ship.components.set(GovtComponent, { id: MERIDIAN });
        };
    }

    function escortOf(leader: string, slot: number, aiType = 3) {
        return (ship: Entity) => {
            npcShip(aiType)(ship);
            ship.components.set(FormationComponent, { leader, slot });
            ship.components.set(FiringGroupComponent, { group: leader });
        };
    }

    /** The player 150 px behind the convoy lead (both face -y), the two
     * guards well off to the side so a shot at the lead cannot touch them. */
    async function scene() {
        placed.clear();
        await addShip('player', SKIFF, 1000, 1000, ship =>
            ship.components.set(ControlledByComponent, { peerId: 'peer' }));
        await addShip('lead', CORSAIR, 1000, 850, npcShip(1));
        await addShip('guardA', CORSAIR, 1400, 900, escortOf('lead', 0));
        await addShip('guardB', CORSAIR, 1500, 900, escortOf('lead', 1));
        step(20); // Providers attach hulls, weapon state, the rest.
        for (const [uuid, [x, y]] of placed) {
            pin(world.entities.get(uuid)!, x, y);
        }
    }

    /** A hit on `victim` through the real DamagedEvent path: the damager is
     * a weapon entity naming its firer (and, for an aimed shot, its target)
     * exactly as a projectile or beam arrives. */
    function hit(victim: string, firer: string,
        { group, aimed }: { group?: string, aimed: boolean }) {
        const shot = new Entity('shot').addComponent(SourceComponent, firer);
        if (group !== undefined) {
            shot.components.set(FiringGroupComponent, { group });
        }
        if (aimed) {
            shot.components.set(TargetComponent, { target: victim });
        }
        const shotUuid = `shot ${world.resources.get(TimeResource)!.time}`;
        world.entities.set(shotUuid, shot);
        world.step();
        world.emit(DamagedEvent, { damage: NO_DAMAGE, damager: shotUuid },
            [victim]);
        world.step(); // Delivered on the next step.
        world.entities.delete(shotUuid);
        world.step();
    }

    function style(uuid: string) {
        return styleForTarget(uuid, world.entities.get(uuid)!, 'player',
            world.entities.get('player')!, gameData,
            id => world.entities.get(id),
            world.resources.get(TimeResource)!.time,
            world.resources.get(SystemIdResource));
    }

    async function playerFiresOnLead() {
        await loadWeaponsGameData(world, [BLASTER]);
        const weapon = world.resources.get(WeaponEntries)!.getCached(BLASTER);
        world.entities.get('player')!.components.set(TargetComponent,
            { target: 'lead' });
        expect(weapon!.fireFromEntity('player', false)).toBeDefined();
        step(40);
    }

    it('a player shot on the lead makes both guards record the player',
        async () => {
            await scene();
            expect(style('guardA')).not.toBe('hostile');
            await playerFiresOnLead();
            expect(npc('lead').aggressor).toBe('player');
            expect(npc('guardA').aggressor).toBe('player');
            expect(npc('guardB').aggressor).toBe('player');
        });

    it('the guards turn on the player within seconds, and read hostile',
        async () => {
            await scene();
            await playerFiresOnLead();
            npc('guardA').nextDecision = 0;
            npc('guardB').nextDecision = 0;
            step(60 * 2);
            for (const guard of ['guardA', 'guardB']) {
                expect(npc(guard).mode).toBe('attack');
                expect(world.entities.get(guard)!.components
                    .get(TargetComponent)?.target).toBe('player');
                expect(style(guard)).toBe('hostile');
            }
        });

    it('a hit on a GUARD stays that guard\'s: the lead and the other guard '
        + 'do not take it up (the reverse was not measured)', async () => {
            await scene();
            hit('guardA', 'player', { group: 'player', aimed: true });
            expect(npc('guardA').aggressor).toBe('player');
            expect(npc('lead').aggressor).toBeUndefined();
            expect(npc('guardB').aggressor).toBeUndefined();
        });

    it('the player\'s ESCORT hitting the lead sets the fleet on that escort, '
        + 'not on the player', async () => {
            await scene();
            await addShip('wing', SKIFF, 900, 1000, ship => {
                ship.components.set(FormationComponent,
                    { leader: 'player', slot: 0 });
                ship.components.set(FiringGroupComponent, { group: 'player' });
            });
            step(1);
            hit('lead', 'wing', { group: 'player', aimed: true });
            expect(npc('lead').aggressor).toBe('wing');
            expect(npc('guardA').aggressor).toBe('wing');
            expect(npc('guardB').aggressor).toBe('wing');
        });

    it('a STRAY from a neutral NPC provokes neither the lead nor its guards; '
        + 'an aimed one provokes all three', async () => {
            await scene();
            await addShip('bystander', CORSAIR, 600, 850, npcShip(3));
            step(1);
            hit('lead', 'bystander', { group: 'bystander', aimed: false });
            expect(npc('lead').aggressor).toBeUndefined();
            expect(npc('guardA').aggressor).toBeUndefined();
            expect(npc('guardB').aggressor).toBeUndefined();
            hit('lead', 'bystander', { group: 'bystander', aimed: true });
            expect(npc('lead').aggressor).toBe('bystander');
            expect(npc('guardA').aggressor).toBe('bystander');
            expect(npc('guardB').aggressor).toBe('bystander');
        });

    it('voids a guard\'s bribe the way a hit on it would', async () => {
        await scene();
        Object.assign(npc('guardA'), { pacifiedFrom: 'player' });
        hit('lead', 'player', { group: 'player', aimed: true });
        expect(npc('guardA').aggressor).toBe('player');
        expect(npc('guardA').pacifiedFrom).toBeUndefined();
    });

    it('leaves a follower under an escort command (a bay fighter) to the '
        + 'escort command framework', async () => {
            await scene();
            world.entities.get('guardB')!.components.set(
                EscortCommandComponent, { command: 'formation' });
            hit('lead', 'player', { group: 'player', aimed: true });
            expect(npc('guardA').aggressor).toBe('player');
            expect(npc('guardB').aggressor).toBeUndefined();
        });

    it('replays identically from a snapshot taken before the shot',
        async () => {
            await scene();
            await loadWeaponsGameData(world, [BLASTER]);
            npc('guardA').nextDecision = 0;
            npc('guardB').nextDecision = 0;
            const before = snapshotWorld(world);
            const record = () => {
                world.entities.get('player')!.components.set(TargetComponent,
                    { target: 'lead' });
                world.resources.get(WeaponEntries)!.getCached(BLASTER)!
                    .fireFromEntity('player', false);
                const hashes: string[] = [];
                for (let i = 0; i < 60 * 3; i++) {
                    world.step();
                    hashes.push(hashWorld(world).hash);
                }
                return { hashes, aggressor: npc('guardA').aggressor };
            };
            const first = record();
            restoreWorld(world, before, deriveEntityComponents);
            const second = record();
            expect(first.aggressor).toBe('player');
            expect(second).toEqual(first);
        });
});
