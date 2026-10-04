import "jasmine";
import { Entity } from "nova_ecs/entity";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { DisplayAssetDataInterface } from "../client/gamedata/display_asset_data.js";
import { SimulationGameDataInterface } from "../client/gamedata/simulation_game_data.js";
import {
    DisplayAssetDataResource, PlayerSoundEvent, SimulationGameDataResource,
    SoundEvent,
} from '../nova_plugin/core/index.js';
import { BeamDataComponent } from "../nova_plugin/combat/index.js";
import { PlayerShipSelector } from "../nova_plugin/player/index.js";
import { WeaponsState, WeaponsStateComponent } from "../nova_plugin/ship/index.js";
import { SimulationTimeResource } from "./simulation_time.js";
import { restartLoops, SoundPlugin } from "./sound_plugin.js";
import { SOUND_EXPLOSION_LOOP, UiSoundEvent } from "./ui_sound.js";

const PLAYER_UUID = 'player ship';
const OTHER_UUID = 'other ship';

/** What each play() call asked @pixi/sound for. */
interface PlayCall {
    id: string;
    /** The first argument to play(): options, a complete callback, or nothing. */
    arg: unknown;
}

/**
 * Stands in for @pixi/sound's AudioContext auto-pause: while true, an
 * instance has no source node and `stop()` on it does nothing (exactly
 * WebAudioInstance.stop), until it is un-paused with the context running.
 */
const fakeContext = { paused: false };

interface FakeInstance {
    loop: boolean;
    paused: boolean;
    stop(): void;
}

/** The Raven's Capacitor Pulse Laser (wëap 146): snd 225, loop flag. */
const PULSE_LASER = 'nova:146';
const PULSE_SOUND = 'nova:225';
const PULSE_LASER_DATA = {
    reload: 500, burstCount: 0, burstReload: 0, fireSimultaneously: false,
    loopSound: true, sound: PULSE_SOUND, guidance: 'beam',
};

async function makeSoundWorld(
    weaponData: Record<string, unknown> = { [PULSE_LASER]: PULSE_LASER_DATA }) {
    const world = new World('sound test');
    const played: string[] = [];
    const stopped: string[] = [];
    const plays: PlayCall[] = [];
    /** The live instances of each sound id, as @pixi/sound tracks them. */
    const instances = new Map<string, FakeInstance[]>();
    const sounds = new Map<string, unknown>();
    const fakeSound = (id: string) => {
        const list: FakeInstance[] = [];
        instances.set(id, list);
        return {
            volume: 0,
            isLoaded: true,
            instances: list,
            play(arg?: { loop?: boolean }) {
                played.push(id);
                plays.push({ id, arg });
                const instance: FakeInstance = {
                    loop: Boolean(arg?.loop),
                    paused: false,
                    stop() {
                        if (fakeContext.paused || instance.paused) {
                            return;
                        }
                        const index = list.indexOf(instance);
                        if (index >= 0) {
                            list.splice(index, 1);
                            stopped.push(id);
                        }
                    },
                };
                list.push(instance);
                return instance;
            },
            stop() {
                stopped.push(id);
                list.length = 0;
            },
        };
    };
    const fakeAssets = {
        data: {
            Sound: {
                getCached(id: string) {
                    if (!sounds.has(id)) {
                        sounds.set(id, fakeSound(id));
                    }
                    return sounds.get(id);
                },
                // SoundPlugin pre-warms the UI sounds via get().
                get(id: string) {
                    return Promise.resolve(this.getCached(id));
                },
            },
        },
    } as unknown as DisplayAssetDataInterface;
    world.resources.set(DisplayAssetDataResource, fakeAssets);
    world.resources.set(SimulationGameDataResource, {
        data: { Weapon: { getCached: (id: string) => weaponData[id] } },
    } as unknown as SimulationGameDataInterface);
    // The per-frame sound limiter keys off the display clock, so the
    // sound systems need TimeResource (the real display world always has
    // it — every animation system reads it).
    await world.addPlugin(TimePlugin);
    await world.addPlugin(SoundPlugin);

    const player = new Entity('player');
    player.components.set(PlayerShipSelector, undefined);
    world.entities.set(PLAYER_UUID, player);
    world.entities.set(OTHER_UUID, new Entity('other'));

    /** Instances of `id` that can be heard (not pinned paused). */
    const live = (id: string) =>
        (instances.get(id) ?? []).filter(i => !i.paused).length;
    /** Every instance of `id`, pinned or not. */
    const all = (id: string) => (instances.get(id) ?? []).length;
    /** Sets the mirrored simulation clock, as applySimulationFrame does. */
    const setSimTime = (time: number) => world.resources.set(
        SimulationTimeResource,
        { time, delta_ms: 1000 / 60, delta_s: 1 / 60, frame: 0 });
    /** Gives `entity` the mirrored WeaponsState of one weapon. */
    const arm = (entity: Entity, firing: boolean, lastFired?: number,
        weapon = PULSE_LASER) => {
        const state: WeaponsState = new Map([[weapon,
            lastFired === undefined ? { count: 1, firing }
                : { count: 1, firing, lastFired }]]);
        entity.components.set(WeaponsStateComponent, state);
    };
    return {
        world, played, stopped, plays, instances, live, all, player,
        setSimTime, arm,
    };
}

describe('display sound plugin', () => {
    afterEach(() => { fakeContext.paused = false; });

    it('plays untargeted sounds for everyone', async () => {
        const { world, played } = await makeSoundWorld();
        world.emit(SoundEvent, { id: 'nova:200' });
        world.step();
        // Exactly once: the player-only system must not double-play
        // the everyone-hears channel.
        expect(played).toEqual(['nova:200']);
    });

    it("plays player-only sounds for the local player's ship", async () => {
        const { world, played } = await makeSoundWorld();
        world.emit(PlayerSoundEvent, { id: 'nova:128' }, [PLAYER_UUID]);
        world.step();
        expect(played).toEqual(['nova:128']);
    });

    it("keeps other ships' player-only sounds silent", async () => {
        const { world, played } = await makeSoundWorld();
        world.emit(PlayerSoundEvent, { id: 'nova:128' }, [OTHER_UUID]);
        world.step();
        expect(played).toEqual([]);
    });

    it('stops playback instead of playing when asked', async () => {
        const { world, played, stopped } = await makeSoundWorld();
        world.emit(PlayerSoundEvent,
            { id: 'nova:128', stop: true }, [PLAYER_UUID]);
        world.step();
        expect(played).toEqual([]);
        expect(stopped).toEqual(['nova:128']);
    });

    it("ignores stops targeted at other ships' sounds", async () => {
        const { world, stopped } = await makeSoundWorld();
        world.emit(PlayerSoundEvent,
            { id: 'nova:128', stop: true }, [OTHER_UUID]);
        world.step();
        expect(stopped).toEqual([]);
    });

    // The per-frame cap, through the real plugin rather than the pure
    // limiter (see sound_limiter_test for the logic itself): a fleet of
    // identical escorts told to attack fires on one frame.
    it('caps identical same-frame sounds at three', async () => {
        const { world, played } = await makeSoundWorld();
        for (let i = 0; i < 8; i++) {
            world.emit(SoundEvent, { id: 'nova:200' });
        }
        world.step();
        expect(played).toEqual(['nova:200', 'nova:200', 'nova:200']);
    });

    it('caps each sound id separately in one frame', async () => {
        const { world, played } = await makeSoundWorld();
        for (let i = 0; i < 5; i++) {
            world.emit(SoundEvent, { id: 'nova:200' });
            world.emit(SoundEvent, { id: 'nova:201' });
        }
        world.step();
        expect(played.filter(id => id === 'nova:200').length).toEqual(3);
        expect(played.filter(id => id === 'nova:201').length).toEqual(3);
    });

    /**
     * `{ loop: true }` has to reach @pixi/sound as a per-play OPTION.
     * Sound.play(callback) merges `{ complete }` over `{ loop: false }`, so
     * the old bare callback started every "loop" as a one-shot — the
     * player's death loop (snd 371, 0.46 s) fell silent for the rest of a
     * death sequence that can run 8 s.
     */
    it('starts a looping sound with the loop option', async () => {
        const { world, plays } = await makeSoundWorld();
        world.emit(UiSoundEvent, { id: SOUND_EXPLOSION_LOOP, loop: true });
        world.step();
        expect(plays.length).toEqual(1);
        expect(plays[0].arg).toEqual(jasmine.objectContaining({ loop: true }));
    });

    it('starts a one-shot sound without the loop option', async () => {
        const { world, plays } = await makeSoundWorld();
        world.emit(SoundEvent, { id: 'nova:200' });
        world.step();
        expect(plays.length).toEqual(1);
        expect(plays[0].arg).toBeUndefined();
    });

    it('starts a loop once, however often it is re-requested', async () => {
        // The spaceport ambient re-emits its loop every frame; that must
        // not restart (or stack) a loop that is already running.
        const { world, played } = await makeSoundWorld();
        for (let i = 0; i < 5; i++) {
            world.emit(UiSoundEvent, { id: 'nova:900', loop: true });
            world.step();
        }
        expect(played).toEqual(['nova:900']);
    });

    it('lets a stopped loop start again', async () => {
        const { world, played, stopped } = await makeSoundWorld();
        world.emit(UiSoundEvent, { id: 'nova:900', loop: true });
        world.step();
        world.emit(UiSoundEvent, { id: 'nova:900', stop: true });
        world.step();
        expect(stopped).toEqual(['nova:900']);
        world.emit(UiSoundEvent, { id: 'nova:900', loop: true });
        world.step();
        expect(played).toEqual(['nova:900', 'nova:900']);
    });

    it('stops every running loop when the plugin is removed', async () => {
        // The systems that would stop a loop leave with the world; a loop
        // that outlived them would ring forever.
        const { world, stopped, player, arm, setSimTime, live } =
            await makeSoundWorld();
        world.emit(UiSoundEvent, { id: 'nova:900', loop: true });
        world.emit(UiSoundEvent, { id: 'nova:901', loop: true });
        setSimTime(1000);
        arm(player, true, 1000);
        world.step();
        expect(live(PULSE_SOUND)).toEqual(1);
        await world.removePlugin(SoundPlugin);
        expect(stopped.sort()).toEqual([PULSE_SOUND, 'nova:900', 'nova:901']);
    });

    it('never limits stops, however many arrive at once', async () => {
        // Silencing must always get through — a dropped stop would leave
        // a looping sound ringing forever.
        const { world, stopped } = await makeSoundWorld();
        for (let i = 0; i < 6; i++) {
            world.emit(PlayerSoundEvent,
                { id: 'nova:128', stop: true }, [PLAYER_UUID]);
        }
        world.step();
        expect(stopped.length).toEqual(6);
    });
});

/**
 * #355, "Sounds that loop when firing keep looping after firing is done":
 * the simulation emits `{ loop: true }` with every shot of a loop-flagged
 * weapon and NO stop, ever (reproduced in headless Chrome — not one stop
 * event reached the display). The loop is now derived from the mirrored
 * weapon state each frame.
 */
describe('display weapon-fire loops', () => {
    afterEach(() => { fakeContext.paused = false; });

    /** One frame of firing as the bridge delivers it: state + event. */
    function fireFrame(env: Awaited<ReturnType<typeof makeSoundWorld>>,
        time: number, firing = true) {
        env.setSimTime(time);
        env.arm(env.player, firing, time);
        env.world.emit(SoundEvent, { id: PULSE_SOUND, loop: true });
        env.world.step();
    }

    it('stops the loop when the trigger is released, with no stop event',
        async () => {
            const env = await makeSoundWorld();
            fireFrame(env, 1000);
            expect(env.live(PULSE_SOUND)).toEqual(1);
            expect(env.plays[0].arg)
                .toEqual(jasmine.objectContaining({ loop: true }));

            // Released: only the mirrored state changes.
            env.setSimTime(1020);
            env.arm(env.player, false, 1000);
            env.world.step();
            expect(env.live(PULSE_SOUND)).toEqual(0);
        });

    it('keeps exactly one loop for a run of shots', async () => {
        const env = await makeSoundWorld();
        for (let t = 1000; t < 4000; t += 500) {
            fireFrame(env, t);
            env.setSimTime(t + 250);
            env.world.step();
        }
        expect(env.played).toEqual([PULSE_SOUND]);
        expect(env.live(PULSE_SOUND)).toEqual(1);
    });

    it('stops the loop once shots stop, even with the trigger held',
        async () => {
            const env = await makeSoundWorld();
            fireFrame(env, 1000);
            env.setSimTime(2000);
            env.world.step();
            expect(env.live(PULSE_SOUND)).toEqual(0);
        });

    it('plays one loop for many ships firing the same weapon', async () => {
        const env = await makeSoundWorld();
        env.setSimTime(1000);
        for (const uuid of ['a', 'b', 'c']) {
            const ship = new Entity(uuid);
            env.arm(ship, true, 1000);
            env.world.entities.set(uuid, ship);
        }
        env.world.step();
        env.world.step();
        expect(env.all(PULSE_SOUND)).toEqual(1);
    });

    it('loops a beam\'s sound for as long as the beam exists', async () => {
        const env = await makeSoundWorld({});
        const beam = new Entity('beam');
        beam.components.set(BeamDataComponent,
            { sound: 'nova:232', loopSound: true } as never);
        env.world.entities.set('beam', beam);
        env.world.step();
        expect(env.live('nova:232')).toEqual(1);
        env.world.entities.delete('beam');
        env.world.step();
        expect(env.live('nova:232')).toEqual(0);
    });

    it('plays a loop event the state does not cover as a one-shot',
        async () => {
            // A submunition fired by a projectile has no WeaponsState.
            const env = await makeSoundWorld();
            env.world.emit(SoundEvent, { id: 'nova:777', loop: true });
            env.world.step();
            expect(env.plays).toEqual([{ id: 'nova:777', arg: undefined }]);
            expect(env.instances.get('nova:777')![0].loop).toBeFalse();
        });

    it('restarts a wanted loop that a stop for its sound cut off',
        async () => {
            const env = await makeSoundWorld();
            fireFrame(env, 1000);
            env.world.emit(SoundEvent, { id: PULSE_SOUND, stop: true });
            env.world.step();
            env.setSimTime(1010);
            env.world.step();
            expect(env.live(PULSE_SOUND)).toEqual(1);
        });

    /**
     * #355, "They also loop in different periods if I click off the tab
     * and back on": @pixi/sound pauses on blur and on focus re-plays each
     * looping instance with loopStart = where it paused, so it loops only
     * the tail of the sample. The display stops every loop on focus and
     * visibility change, and reconciliation restarts it from the top.
     */
    it('restarts each loop from the top after a visibility change',
        async () => {
            const env = await makeSoundWorld();
            fireFrame(env, 1000);
            const first = env.instances.get(PULSE_SOUND)![0];
            restartLoops(env.world);
            expect(env.live(PULSE_SOUND)).toEqual(0);
            fireFrame(env, 1020);
            expect(env.all(PULSE_SOUND)).toEqual(1);
            expect(env.instances.get(PULSE_SOUND)![0]).not.toBe(first);
            expect(env.played).toEqual([PULSE_SOUND, PULSE_SOUND]);
        });

    it('restarts loops on a real focus / visibilitychange event',
        async () => {
            const globals = globalThis as { window?: unknown, document?: unknown };
            const hadWindow = 'window' in globals;
            const hadDocument = 'document' in globals;
            const fakeWindow = new EventTarget();
            const fakeDocument = new EventTarget();
            globals.window = fakeWindow;
            globals.document = fakeDocument;
            try {
                const env = await makeSoundWorld();
                fireFrame(env, 1000);
                fakeWindow.dispatchEvent(new Event('focus'));
                expect(env.live(PULSE_SOUND)).toEqual(0);
                fireFrame(env, 1020);
                fakeDocument.dispatchEvent(new Event('visibilitychange'));
                fireFrame(env, 1040);
                expect(env.played)
                    .toEqual([PULSE_SOUND, PULSE_SOUND, PULSE_SOUND]);
                expect(env.all(PULSE_SOUND)).toEqual(1);

                // And the listeners leave with the plugin.
                await env.world.removePlugin(SoundPlugin);
                fakeWindow.dispatchEvent(new Event('focus'));
            } finally {
                if (!hadWindow) {
                    delete globals.window;
                }
                if (!hadDocument) {
                    delete globals.document;
                }
            }
        });

    it('never lets a loop stopped while the context is paused resume',
        async () => {
            const env = await makeSoundWorld();
            fireFrame(env, 1000);
            // Window blurred: @pixi/sound has paused the context, so the
            // instance cannot be stopped yet.
            fakeContext.paused = true;
            env.setSimTime(1020);
            env.arm(env.player, false, 1000);
            env.world.step();
            // Pinned paused, so the resume on focus cannot wake it...
            expect(env.live(PULSE_SOUND)).toEqual(0);
            // ...and stopped for good once the context runs again.
            fakeContext.paused = false;
            env.world.step();
            expect(env.all(PULSE_SOUND)).toEqual(0);
        });
});
