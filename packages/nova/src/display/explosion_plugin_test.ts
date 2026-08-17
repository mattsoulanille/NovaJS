import 'jasmine';
import { ExplosionData, getDefaultExplosionData } from 'novadatainterface/explosion_data';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Entity } from 'nova_ecs/entity';
import { GetEntity } from 'nova_ecs/arg_types';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { World } from 'nova_ecs/world';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ExplosionDataComponent } from '../nova_plugin/animation_plugin.js';
import { AnimationGraphicComponent } from './animation_graphic_plugin.js';
import { DeathEvent, ZeroArmorEvent } from '../nova_plugin/death_plugin.js';
import { DisplayAssetDataResource } from '../nova_plugin/game_data_resource.js';
import { ArmorComponent } from '../nova_plugin/health_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import {
    finalExplosionScale, MAX_SECONDARY_EXPLOSIONS_PER_STEP,
    secondaryExplosionTotal,
} from '../nova_plugin/ship_explosion.js';
import { ShipDataComponent } from '../nova_plugin/ship_plugin.js';
import { SoundEvent, SoundEventData } from '../nova_plugin/sound_plugin.js';
import { Stat } from '../nova_plugin/stat.js';
import {
    ExplosionPlugin, makeExplosion, MAX_EXPLOSION_SPARKS,
    MIN_EXPLOSION_SPARKS, randomSparkCount, SecondaryExplosionComponent,
    SPARK_PERIOD_MS, SPARK_RADIUS,
} from './explosion_plugin.js';
import { SimulationTimeResource } from './simulation_time.js';
import { SOUND_EXPLOSION_LOOP, UiSoundEvent } from './ui_sound.js';

const SHIP = 'player ship';

const EXPLOSION_ID = 'nova:explosion';
/** bööm 132 "ship breakup" plays snd 302 in the real data. */
const BREAKUP_SOUND = 'nova:302';
const FINAL_EXPLOSION_ID = 'nova:final explosion';
/** bööm 133 "ship exploding" plays snd 303. */
const FINAL_SOUND = 'nova:303';
/**
 * Explosion type 0 — bööm 128, "FAE Small" — which is what the Explode2
 * "+1000" sparks must be, NOT another copy of Explode2's own graphic.
 * ship_parse resolves the flag to exactly this id in the ship's id space.
 */
const SPARKS_EXPLOSION_ID = 'nova:128';

/** Just enough of PIXI's ObservablePoint for `container.scale.set(n)`. */
function stubScale(): { x: number, y: number, set(s: number): void } {
    return {
        x: 1, y: 1,
        set(s: number) { this.x = s; this.y = s; },
    };
}

function makeAssets(): DisplayAssetDataInterface {
    const explosions: { [id: string]: ExplosionData } = {
        [EXPLOSION_ID]: {
            ...getDefaultExplosionData(), id: EXPLOSION_ID,
            sound: BREAKUP_SOUND,
        },
        [FINAL_EXPLOSION_ID]: {
            ...getDefaultExplosionData(), id: FINAL_EXPLOSION_ID,
            sound: FINAL_SOUND,
        },
        [SPARKS_EXPLOSION_ID]: {
            ...getDefaultExplosionData(), id: SPARKS_EXPLOSION_ID,
            sound: BREAKUP_SOUND,
        },
    };
    return {
        data: {
            Explosion: {
                getCached: (id: string) => explosions[id],
                get: (id: string) => Promise.resolve(explosions[id]),
            },
        },
    } as unknown as DisplayAssetDataInterface;
}

/**
 * A display world holding one mirrored ship, as the simulation bridge
 * populates it: real armor state, a ship whose shïp data names an
 * initial (secondary) explosion.
 *
 * TWO CLOCKS, deliberately. `TimeResource` is the display's own
 * wall-clock-shaped timer (it drives the explosion animations and the
 * nested fixed-period secondaries); `SimulationTimeResource` is the
 * mirrored simulation clock the bridge writes each frame, and it is what
 * the death sequence's accelerating cadence is scheduled against. Both
 * advance together here, as they do in the real client.
 */
async function displayWorld(armorCurrent: number,
    options: {
        deathDelay?: number, finalExplosion?: string | null,
        finalExplosionSparks?: string | null,
        largeExplosion?: boolean, mass?: number,
        graphics?: boolean,
    } = {}) {
    const world = new World('explosion display test');
    world.resources.set(DisplayAssetDataResource, makeAssets());
    // The display world's clock; advanced by hand below.
    const time = { time: 0, delta_ms: 100, delta_s: 0.1 };
    world.resources.set(TimeResource, time as never);
    await world.addPlugin(ExplosionPlugin);
    const simTime = world.resources.get(SimulationTimeResource)!;
    if (options.graphics) {
        // ExplosionSystem — which is what turns an explosion entity into
        // its bööm's SOUND, and what expires it when its animation ends —
        // needs the PIXI graphic the real display world's providers
        // attach. Stub one: a single 16-frame sprite, the shape of the
        // stock explosion sprite sheets. Opt-in, so the specs that only
        // care about which entities exist keep their simpler world.
        world.addSystem(new System({
            name: 'StubExplosionGraphic',
            args: [ExplosionDataComponent, GetEntity] as const,
            step(_explosion, { components }) {
                if (!components.has(AnimationGraphicComponent)) {
                    components.set(AnimationGraphicComponent, {
                        sprites: new Map([['baseImage', { frames: 16 }]]),
                        progress: 0,
                        // Enough of a PIXI container for the fireball
                        // scale (ExplosionSystem writes it every step,
                        // as pooled graphics come back reset to 1).
                        container: { scale: stubScale() },
                    } as never);
                }
            },
        }));
    }

    const ship = new Entity('ship');
    ship.components.set(ShipDataComponent, {
        ...getDefaultShipData(),
        initialExplosion: EXPLOSION_ID,
        finalExplosion: options.finalExplosion ?? null,
        // shïp Explode2 + 1000 and shïp DeathDelay >= 60: two separate
        // rules, so two separate fields (see ShipFinalExplosionSystem).
        finalExplosionSparks: options.finalExplosionSparks ?? null,
        largeExplosion: options.largeExplosion ?? false,
        physics: {
            ...getDefaultShipData().physics,
            mass: options.mass ?? 100,
        },
        // Seconds, as ship_parse produces (shïp DeathDelay / 30).
        deathDelay: options.deathDelay ?? 1,
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

    /** Advances both clocks and steps once. */
    const stepTime = (ms = 100) => {
        time.time += ms;
        simTime.time += ms;
        world.step();
    };
    /** How many standalone explosion entities exist right now. */
    const explosionCount = () => [...world.entities]
        .filter(([, entity]) =>
            entity.components.has(ExplosionDataComponent)).length;
    /**
     * How many explosion entities have appeared since the last call —
     * counted by uuid, because with graphics stubbed in the entities
     * expire when their animation ends, so a running total would miss the
     * ones that came and went.
     */
    const seenExplosions = new Set<string>();
    /** The bööm id of each explosion that has appeared since the last call. */
    const newExplosionIds = () => {
        const spawned: string[] = [];
        for (const [uuid, entity] of world.entities) {
            const data = entity.components.get(ExplosionDataComponent);
            if (data && !seenExplosions.has(uuid)) {
                seenExplosions.add(uuid);
                spawned.push(data.id);
            }
        }
        return spawned;
    };
    const newExplosions = () => newExplosionIds().length;
    /**
     * The sprite scale ExplosionSystem has written onto the graphic of
     * each explosion entity showing `explosionId`.
     */
    const scalesOf = (explosionId: string) => [...world.entities]
        .filter(([, entity]) => entity.components
            .get(ExplosionDataComponent)?.id === explosionId)
        .map(([, entity]) => (entity.components
            .get(AnimationGraphicComponent) as unknown as
            { container: { scale: { x: number } } }).container.scale.x);

    /** Every SoundEvent id played, in order. */
    const sounds: string[] = [];
    world.events.get(SoundEvent).subscribe(({ data }) => sounds.push(data.id));
    /** The client-local UI sounds (the snd 371 death loop). */
    const uiSounds: SoundEventData[] = [];
    world.events.get(UiSoundEvent).subscribe(
        ({ data }) => uiSounds.push(data));

    /** Starts the death sequence, as the bridge's ZeroArmorEvent does. */
    const zeroArmor = () => world.emit(ZeroArmorEvent,
        { time: simTime.time, delta_ms: 0, delta_s: 0, frame: 0 }, [SHIP]);
    const die = () => world.emit(DeathEvent,
        { time: simTime.time, delta_ms: 0, delta_s: 0, frame: 0 }, [SHIP]);

    return {
        world, ship, stepTime, explosionCount, newExplosions,
        newExplosionIds, scalesOf, time, simTime,
        sounds, uiSounds, zeroArmor, die,
    };
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
            const { ship, stepTime, explosionCount, zeroArmor, die } =
                await displayWorld(0);

            zeroArmor();
            stepTime();
            expect(ship.components.has(SecondaryExplosionComponent))
                .toBeTrue();
            stepTime();
            stepTime();
            expect(explosionCount()).toBeGreaterThan(0);

            die();
            stepTime();
            expect(ship.components.has(SecondaryExplosionComponent))
                .toBeFalse();
        });

    it('ignores a zero-armor event replayed after the respawn', async () => {
        // Armor is already full: this is the state the frame applied
        // before its events are replayed.
        const { ship, stepTime, explosionCount, zeroArmor, die } =
            await displayWorld(100);

        // The bridge's batch order for a player killed while still being
        // shot: the death first, then the stale zero-armor behind it.
        die();
        zeroArmor();
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
                const { ship, stepTime, explosionCount, zeroArmor } =
                    await displayWorld(armorCurrent);
                zeroArmor();
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
            const { world, stepTime, explosionCount, zeroArmor } =
                await displayWorld(0);
            zeroArmor();
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

/**
 * The breakup explosions accelerate toward the final one (Matthew: "the
 * frequency INCREASES as the ship approaches its final explosion"), and
 * the schedule is a function of the MIRRORED SIMULATION clock rather than
 * of this peer's frame rate — so two worlds stepping identically produce
 * identical explosion spawn ticks, with no random draw anywhere.
 */
describe('death sequence explosion cadence', () => {
    /** Runs a whole death sequence, returning the tick each spawn fell on. */
    async function spawnTicks(stepMs: number, deathDelay = 5) {
        const { stepTime, newExplosions, zeroArmor } =
            await displayWorld(0, { deathDelay });
        zeroArmor();
        const ticks: number[] = [];
        // Step through the sequence and a little past its end.
        const steps = Math.ceil(deathDelay * 1000 / stepMs) + 5;
        for (let tick = 1; tick <= steps; tick++) {
            stepTime(stepMs);
            for (let i = 0; i < newExplosions(); i++) {
                ticks.push(tick);
            }
        }
        return ticks;
    }

    it('spawns the whole schedule, accelerating toward the end',
        async () => {
            const deathDelay = 5;
            const ticks = await spawnTicks(50, deathDelay);
            expect(ticks.length)
                .toEqual(secondaryExplosionTotal(deathDelay * 1000));
            // The first gap is much longer than the last: the cadence
            // speeds up as the final explosion nears.
            const gaps = ticks.slice(1).map((t, i) => t - ticks[i]);
            expect(gaps[0]).toBeGreaterThan(gaps[gaps.length - 1]);
            expect(gaps[0]).toBeGreaterThan(2 * gaps[gaps.length - 1]);
        });

    it('produces identical spawn ticks in two identically stepped worlds',
        async () => {
            expect(await spawnTicks(50)).toEqual(await spawnTicks(50));
        });

    it('spawns the same COUNT at a different frame rate', async () => {
        // Frame-rate independence: the schedule is cumulative against sim
        // time, not "one per N frames", so a 30fps client and a 144fps
        // client see the same number of explosions.
        const slow = await spawnTicks(1000 / 30);
        const fast = await spawnTicks(1000 / 144);
        expect(slow.length).toEqual(fast.length);
    });

    it('caps the catch-up burst after a stall', async () => {
        const { stepTime, explosionCount, zeroArmor } =
            await displayWorld(0, { deathDelay: 5 });
        zeroArmor();
        // A single step that jumps past the entire sequence (a tab that
        // was in the background) owes every explosion at once.
        stepTime(60_000);
        expect(explosionCount()).toEqual(MAX_SECONDARY_EXPLOSIONS_PER_STEP);
    });
});

describe('death sequence explosion sounds', () => {
    it('plays the bööm sound for each of an NPC\'s breakup explosions',
        async () => {
            // Explode1 -> bööm 132 "ship breakup" -> snd 302.
            const { stepTime, sounds, zeroArmor } =
                await displayWorld(0, { deathDelay: 5, graphics: true });
            zeroArmor();
            for (let i = 0; i < 120; i++) {
                stepTime(50);
            }
            const breakups = sounds.filter(id => id === BREAKUP_SOUND);
            expect(breakups.length)
                .toEqual(secondaryExplosionTotal(5000));
        });

    it('stays silent on the LOCAL player\'s ship, where snd 371 loops '
        + 'instead', async () => {
            // Reconciling the two: the player's own breakup already has
            // the looping death sound, so layering 302 over it would be
            // playing one event twice.
            const { ship, stepTime, sounds, uiSounds, zeroArmor, die } =
                await displayWorld(0, { deathDelay: 5, graphics: true });
            ship.components.set(PlayerShipSelector, undefined);
            zeroArmor();
            for (let i = 0; i < 120; i++) {
                stepTime(50);
            }
            expect(sounds.filter(id => id === BREAKUP_SOUND).length)
                .toEqual(0);
            expect(uiSounds).toEqual([
                { id: SOUND_EXPLOSION_LOOP, loop: true }]);

            // ...and the loop is stopped by the same death that spawns
            // the final explosion, so the two never overlap.
            die();
            stepTime();
            expect(uiSounds[uiSounds.length - 1])
                .toEqual({ id: SOUND_EXPLOSION_LOOP, stop: true });
        });

    it('leaves a projectile explosion\'s nested secondaries silent',
        async () => {
            // The fixed-period nested cadence (makeExplosion's second
            // argument): the primary explosion already played its sound.
            const { world, stepTime, sounds } =
                await displayWorld(100, { graphics: true });
            const explosion = makeExplosion(
                {
                    ...getDefaultExplosionData(), id: EXPLOSION_ID,
                    sound: BREAKUP_SOUND,
                },
                new Position(0, 0),
                {
                    ...getDefaultExplosionData(), id: EXPLOSION_ID,
                    sound: BREAKUP_SOUND,
                });
            world.entities.set('projectile explosion', explosion);
            for (let i = 0; i < 10; i++) {
                stepTime();
            }
            // Exactly one: the primary's own, from ExplosionSystem.
            expect(sounds.filter(id => id === BREAKUP_SOUND).length)
                .toEqual(1);
        });

    it('gives the final explosion Explode2\'s graphic and sound, for '
        + 'player and NPC alike', async () => {
            for (const isPlayer of [false, true]) {
                const { world, ship, stepTime, sounds, die } =
                    await displayWorld(0, {
                        deathDelay: 1,
                        finalExplosion: FINAL_EXPLOSION_ID,
                        graphics: true,
                    });
                if (isPlayer) {
                    ship.components.set(PlayerShipSelector, undefined);
                }
                die();
                // Two steps: the stubbed graphic lands on the first one,
                // so ExplosionSystem (which plays the sound) picks the
                // entity up on the second.
                stepTime();
                stepTime();
                // The Explode2 bööm's graphic...
                const finals = [...world.entities].filter(([, entity]) =>
                    entity.components.get(ExplosionDataComponent)?.id
                    === FINAL_EXPLOSION_ID);
                expect(finals.length).toEqual(1);
                // ...and its sound, on the everyone-hears channel.
                expect(sounds).toEqual([FINAL_SOUND]);
            }
        });
});

/**
 * The two INDEPENDENT shïp rules for the final explosion, which were
 * collapsed into one `largeExplosion` field until finalExplosionSparks
 * was added — with the result that DeathDelay >= 60 ships nested extra
 * copies of Explode2's OWN graphic around themselves (the sparks
 * behaviour, on the wrong trigger and the wrong bööm) and no ship's
 * fireball ever grew.
 *
 *  - Explode2 + 1000 (EVN Bible ~:2445 -> wëap ExplodType ~:3159):
 *    "Explosion type 0-63, plus a random number of type-0 explosions
 *    around it" — sparks, always bööm 128.
 *  - DeathDelay >= 60 (~:2427): "a huge explosion. The exact size of the
 *    resulting fireball is proportional to the ship's mass."
 */
describe('final explosion sparks and fireball size', () => {
    /** Kills a ship and steps far enough for every spark to land. */
    async function explode(options: Parameters<typeof displayWorld>[1]) {
        const world = await displayWorld(0, {
            deathDelay: 1, finalExplosion: FINAL_EXPLOSION_ID,
            graphics: true, ...options,
        });
        world.die();
        const ids: string[] = [];
        // Long enough to outlast SPARK_PERIOD_MS * MAX_EXPLOSION_SPARKS.
        for (let i = 0; i < 20; i++) {
            world.stepTime(SPARK_PERIOD_MS);
            ids.push(...world.newExplosionIds());
        }
        return { ...world, ids };
    }

    it('spawns sparks of bööm 128 — NOT a second copy of Explode2 — when '
        + 'the flag is set', async () => {
            const { ids } = await explode({
                finalExplosionSparks: SPARKS_EXPLOSION_ID,
            });
            // Exactly one fireball...
            expect(ids.filter(id => id === FINAL_EXPLOSION_ID).length)
                .toEqual(1);
            // ...surrounded by sparks of explosion type 0.
            const sparks = ids.filter(id => id === SPARKS_EXPLOSION_ID);
            expect(sparks.length).toBeGreaterThanOrEqual(
                MIN_EXPLOSION_SPARKS);
            expect(sparks.length).toBeLessThanOrEqual(MAX_EXPLOSION_SPARKS);
            // Nothing else showed up: no extra Explode2 graphics.
            expect(new Set(ids))
                .toEqual(new Set([FINAL_EXPLOSION_ID, SPARKS_EXPLOSION_ID]));
        });

    it('spawns NO sparks when Explode2 is under 1000', async () => {
        // 109 of the 288 stock ships (Shuttle, Starbridge) are here, and
        // so are the 86 that used to get sparks purely for having
        // DeathDelay >= 60.
        for (const largeExplosion of [false, true]) {
            const { ids } = await explode({
                finalExplosionSparks: null, largeExplosion, mass: 10000,
            });
            expect(ids).withContext(`large: ${largeExplosion}`)
                .toEqual([FINAL_EXPLOSION_ID]);
        }
    });

    /**
     * Kills a ship and reads the scale off its fireball while it is still
     * alive — two steps, since the stubbed graphic lands on the first and
     * ExplosionSystem writes the scale on the second.
     */
    async function fireballScale(largeExplosion: boolean, mass: number) {
        const { stepTime, scalesOf, die } = await displayWorld(0, {
            deathDelay: 1, finalExplosion: FINAL_EXPLOSION_ID,
            graphics: true, largeExplosion, mass,
        });
        die();
        stepTime();
        stepTime();
        return scalesOf(FINAL_EXPLOSION_ID);
    }

    it('scales the fireball with mass only when DeathDelay >= 60',
        async () => {
            // A Leviathan (10000 tons, DeathDelay 250) reaches the blast
            // radius cap, so its fireball draws at 200/32 = 6.25x.
            expect(await fireballScale(true, 10000))
                .toEqual([finalExplosionScale(10000)]);
            expect(finalExplosionScale(10000)).toEqual(6.25);

            // The same hull with DeathDelay < 60 gets "a single fireball"
            // at natural size, however heavy it is.
            expect(await fireballScale(false, 10000)).toEqual([1]);

            // And a qualifying but light hull (Terrapin, 175 tons) is
            // clamped to natural size too.
            expect(await fireballScale(true, 175)).toEqual([1]);
        });

    it('spreads the sparks across the fireball, whatever size it is',
        async () => {
            // Sparks are placed within SPARK_RADIUS * scale of the
            // centre, so a 6.25x fireball does not get them clustered in
            // the middle of it.
            for (const [large, mass] of [[true, 10000], [false, 10000]] as
                const) {
                const { world, stepTime, die } = await displayWorld(0, {
                    deathDelay: 1, finalExplosion: FINAL_EXPLOSION_ID,
                    finalExplosionSparks: SPARKS_EXPLOSION_ID,
                    graphics: true, largeExplosion: large, mass,
                });
                die();
                stepTime();
                const fireball = [...world.entities].find(([, entity]) =>
                    entity.components.get(ExplosionDataComponent)?.id
                    === FINAL_EXPLOSION_ID)!;
                expect(fireball).withContext(`large: ${large}`).toBeDefined();
                const scale = large ? finalExplosionScale(mass) : 1;
                expect(fireball[1].components
                    .get(SecondaryExplosionComponent)?.radius)
                    .withContext(`large: ${large}`)
                    .toEqual(SPARK_RADIUS * scale);
            }
        });

    it('keeps an ordinary explosion at natural size', async () => {
        // makeExplosion's default: a projectile hit, an asteroid breaking
        // up, a breakup secondary — none of them scale.
        const { world, stepTime, scalesOf } = await displayWorld(100,
            { graphics: true });
        world.entities.set('projectile explosion', makeExplosion(
            { ...getDefaultExplosionData(), id: EXPLOSION_ID },
            new Position(0, 0)));
        stepTime();
        stepTime();
        expect(scalesOf(EXPLOSION_ID)).toEqual([1]);
    });
});

/**
 * The wëap half of the same "+1000" rule (ExplodType 1000-1063, ~:3159).
 * weapon_parse resolves it to bööm 128 in the weapon's id space, so this
 * path was already using the right graphic; what it lacked was the
 * Bible's "random NUMBER" bound, which it now shares with the ship path.
 */
describe('weapon explosion sparks', () => {
    it('spawns a bounded random number of sparks around the hit',
        async () => {
            const counts = new Set<number>();
            for (let attempt = 0; attempt < 25; attempt++) {
                const { world, stepTime, newExplosionIds } =
                    await displayWorld(100, { graphics: true });
                world.entities.set('projectile explosion', makeExplosion(
                    { ...getDefaultExplosionData(), id: EXPLOSION_ID },
                    new Position(0, 0),
                    {
                        ...getDefaultExplosionData(),
                        id: SPARKS_EXPLOSION_ID,
                    }));
                const ids: string[] = [];
                for (let i = 0; i < 20; i++) {
                    stepTime(SPARK_PERIOD_MS);
                    ids.push(...newExplosionIds());
                }
                const sparks = ids.filter(id => id === SPARKS_EXPLOSION_ID);
                expect(sparks.length)
                    .toBeGreaterThanOrEqual(MIN_EXPLOSION_SPARKS);
                expect(sparks.length)
                    .toBeLessThanOrEqual(MAX_EXPLOSION_SPARKS);
                counts.add(sparks.length);
            }
            // "A RANDOM number": over 25 hits the count actually varies
            // rather than being a fixed constant.
            expect(counts.size).toBeGreaterThan(1);
        });

    it('stops sparking instead of spraying for the animation\'s whole '
        + 'life', async () => {
            // The old fixed-period cadence was unbounded, so a long
            // primary animation kept emitting one spark every 30 ms.
            const { world, stepTime, newExplosionIds } =
                await displayWorld(100, { graphics: true });
            const explosion = makeExplosion(
                { ...getDefaultExplosionData(), id: EXPLOSION_ID },
                new Position(0, 0),
                { ...getDefaultExplosionData(), id: SPARKS_EXPLOSION_ID });
            world.entities.set('projectile explosion', explosion);
            let sparks = 0;
            for (let i = 0; i < 60; i++) {
                stepTime(SPARK_PERIOD_MS);
                sparks += newExplosionIds()
                    .filter(id => id === SPARKS_EXPLOSION_ID).length;
            }
            expect(sparks).toBeLessThanOrEqual(MAX_EXPLOSION_SPARKS);
            // The component removes itself once the draw is spent.
            expect(explosion.components.has(SecondaryExplosionComponent))
                .toBeFalse();
        });

    it('draws its count uniformly over the documented bounds', () => {
        // Pure function, so this is a cheap sanity check on the Bible's
        // "random number": every value in [MIN, MAX] is reachable and
        // nothing outside it is.
        const seen = new Set<number>();
        for (let i = 0; i < 5000; i++) {
            const count = randomSparkCount();
            expect(Number.isInteger(count)).toBeTrue();
            expect(count).toBeGreaterThanOrEqual(MIN_EXPLOSION_SPARKS);
            expect(count).toBeLessThanOrEqual(MAX_EXPLOSION_SPARKS);
            seen.add(count);
        }
        expect(seen.size)
            .toEqual(MAX_EXPLOSION_SPARKS - MIN_EXPLOSION_SPARKS + 1);
    });
});
