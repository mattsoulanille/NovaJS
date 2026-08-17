import 'jasmine';
import { getDefaultExplosionData } from 'novadatainterface/explosion_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ExplosionDataComponent } from '../nova_plugin/animation_plugin.js';
import { DeathEvent, ZeroArmorEvent } from '../nova_plugin/death_plugin.js';
import { DisplayAssetDataResource } from '../nova_plugin/game_data_resource.js';
import { ArmorComponent } from '../nova_plugin/health_plugin.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { Stat } from '../nova_plugin/stat.js';
import { ExplosionPlugin, SecondaryExplosionComponent } from './explosion_plugin.js';

const SHIP = 'player ship';

const EXPLOSION_ID = 'nova:explosion';

function makeAssets(): DisplayAssetDataInterface {
    const explosion = { ...getDefaultExplosionData(), id: EXPLOSION_ID };
    return {
        data: {
            Explosion: {
                getCached: (_id: string) => explosion,
                get: (_id: string) => Promise.resolve(explosion),
            },
        },
    } as unknown as DisplayAssetDataInterface;
}

/**
 * A display world holding one mirrored ship, as the simulation bridge
 * populates it: real armor state, a ship whose shïp data names an
 * initial (secondary) explosion.
 */
async function displayWorld(armorCurrent: number) {
    const world = new World('explosion display test');
    world.resources.set(DisplayAssetDataResource, makeAssets());
    // The display world's clock; advanced by hand below.
    const time = { time: 0, delta_ms: 100, delta_s: 0.1 };
    world.resources.set(TimeResource, time as never);
    await world.addPlugin(ExplosionPlugin);

    const ship = new Entity('ship');
    ship.components.set(ShipDataComponent, {
        ...getDefaultShipData(),
        initialExplosion: EXPLOSION_ID,
        finalExplosion: null,
    } as never);
    ship.components.set(ArmorComponent,
        new Stat({ current: armorCurrent, recharge: 0, max: 100 }));
    ship.components.set(MovementStateComponent, {
        position: new Position(10, 20),
        velocity: new Vector(0, 0),
        rotation: new Angle(0),
        accelerating: 0,
        turning: 0,
        turnBack: false,
    } as never);
    world.entities.set(SHIP, ship);

    /** Advances the display clock and steps once. */
    const stepTime = (ms = 100) => {
        time.time += ms;
        world.step();
    };
    /** How many standalone explosion entities exist right now. */
    const explosionCount = () => [...world.entities]
        .filter(([, entity]) =>
            entity.components.has(ExplosionDataComponent)).length;

    return { world, ship, stepTime, explosionCount, time };
}

/**
 * The visible half of Matthew's playtest bug: "my ship was constantly
 * playing the exploding animation while flying around."
 *
 * The bridge forwards simulation events to the display in *emit* order,
 * batched across every tick since the last frame, and replays them after
 * the frame's state has been applied. A hit landing on the hulk in the
 * tick its explosion finishes emits its ZeroArmorEvent *after* the
 * DeathEvent, so the display replayed [death, zeroArmor] against a ship
 * already showing full armor — setting SecondaryExplosionComponent back
 * on a living ship, where only another DeathEvent would ever remove it.
 */
describe('display secondary explosions', () => {
    it('runs the normal sequence: zero armor starts them, death ends them',
        async () => {
            const { world, ship, stepTime, explosionCount } =
                await displayWorld(0);

            world.emit(ZeroArmorEvent,
                { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
            stepTime();
            expect(ship.components.has(SecondaryExplosionComponent))
                .toBeTrue();
            stepTime();
            stepTime();
            expect(explosionCount()).toBeGreaterThan(0);

            world.emit(DeathEvent,
                { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
            stepTime();
            expect(ship.components.has(SecondaryExplosionComponent))
                .toBeFalse();
        });

    it('ignores a zero-armor event replayed after the respawn', async () => {
        // Armor is already full: this is the state the frame applied
        // before its events are replayed.
        const { world, ship, stepTime, explosionCount } =
            await displayWorld(100);

        // The bridge's batch order for a player killed while still being
        // shot: the death first, then the stale zero-armor behind it.
        world.emit(DeathEvent,
            { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
        world.emit(ZeroArmorEvent,
            { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
        stepTime();

        expect(ship.components.has(SecondaryExplosionComponent)).toBeFalse();
        // ...and the ship does not trail explosions around the system.
        for (let i = 0; i < 20; i++) {
            stepTime();
        }
        expect(explosionCount()).toEqual(0);
    });

    it('self-heals a leaked secondary explosion once armor is back up',
        async () => {
            // Whatever the upstream ordering, a ship above zero armor
            // stops exploding: the level-triggered backstop for the
            // edge-triggered DeathEvent cleanup.
            const { ship, stepTime, explosionCount } =
                await displayWorld(100);
            ship.components.set(SecondaryExplosionComponent, {
                explosion: { ...getDefaultExplosionData(), id: EXPLOSION_ID },
                period: 90,
            });

            stepTime();
            expect(ship.components.has(SecondaryExplosionComponent))
                .toBeFalse();
            for (let i = 0; i < 20; i++) {
                stepTime();
            }
            expect(explosionCount()).toEqual(0);
        });

    // The sweep must not mistake a real hulk for a leak. 0.01 is what a
    // stock armor-recharging ship's armor actually reads for its whole
    // death sequence (one tick of recharge, then frozen by the disable),
    // and 70 of the 288 stock ships are like that.
    for (const armorCurrent of [0, 0.01]) {
        it(`leaves a genuine hulk at ${armorCurrent} armor exploding`,
            async () => {
                const { world, ship, stepTime, explosionCount } =
                    await displayWorld(armorCurrent);
                world.emit(ZeroArmorEvent,
                    { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
                stepTime();
                expect(ship.components.has(SecondaryExplosionComponent))
                    .toBeTrue();
                for (let i = 0; i < 5; i++) {
                    stepTime();
                }
                expect(ship.components.has(SecondaryExplosionComponent))
                    .toBeTrue();
                expect(explosionCount()).toBeGreaterThan(0);
            });
    }

    it('never touches the standalone explosion entities it spawns',
        async () => {
            // makeExplosion's own entities carry
            // SecondaryExplosionComponent and no armor, so the
            // armor-gated sweep must leave them alone.
            const { world, stepTime, explosionCount } =
                await displayWorld(0);
            world.emit(ZeroArmorEvent,
                { time: 0, delta_ms: 0, delta_s: 0 } as never, [SHIP]);
            for (let i = 0; i < 5; i++) {
                stepTime();
            }
            const spawned = explosionCount();
            expect(spawned).toBeGreaterThan(0);
            for (const [, entity] of world.entities) {
                if (entity.components.has(ExplosionDataComponent)) {
                    // Spawned with a nested secondary or not, none of
                    // them were swept for lacking armor.
                    expect(entity.components.has(ArmorComponent)).toBeFalse();
                }
            }
        });
});
