import "jasmine";
import { WeaponData } from "novadatainterface/weapon_data";
import { WeaponsState } from "../nova_plugin/ship/index.js";
import {
    LOOP_GRACE_MS, LoopPlayback, LoopVoice, reconcileLoops, wantedWeaponLoops,
    weaponLoopWindowMs,
} from "./looping_sounds.js";

/** The Raven's Capacitor Pulse Laser: wëap 146, snd 225, Flags 0x0010. */
const PULSE_LASER = 'nova:146';
const PULSE_SOUND = 'nova:225';

function weapon(overrides: Partial<WeaponData> = {}): WeaponData {
    return {
        reload: 500, burstCount: 0, burstReload: 0,
        fireSimultaneously: false, loopSound: true, sound: PULSE_SOUND,
        guidance: 'beam',
        ...overrides,
    } as WeaponData;
}

function weapons(entries: [string, Partial<{
    count: number, firing: boolean, lastFired: number,
}>][]): WeaponsState {
    return new Map(entries.map(([id, state]) => [id,
        { count: 1, firing: false, ...state }]));
}

describe('reconcileLoops', () => {
    it('starts what is wanted and stops what is not', () => {
        expect(reconcileLoops(new Set(['a', 'b']), new Set(['b', 'c'])))
            .toEqual({ start: ['a'], stop: ['c'] });
    });

    it('does nothing when the two agree', () => {
        expect(reconcileLoops(new Set(['a']), new Map([['a', 1]])))
            .toEqual({ start: [], stop: [] });
    });

    it('orders its plan by id, not by insertion order', () => {
        expect(reconcileLoops(new Set(['z', 'a', 'm']), new Set()).start)
            .toEqual(['a', 'm', 'z']);
    });
});

describe('wantedWeaponLoops', () => {
    const data = (map: Record<string, WeaponData>) =>
        (id: string) => map[id];

    it('wants the loop while the trigger is held and shots leave', () => {
        expect(wantedWeaponLoops(
            [weapons([[PULSE_LASER, { firing: true, lastFired: 1000 }]])],
            [], 1400, data({ [PULSE_LASER]: weapon() })))
            .toEqual(new Set([PULSE_SOUND]));
    });

    /**
     * The #355 report: "Sounds that loop when firing keep looping after
     * firing is done." The simulation never sends a stop for a weapon
     * loop — there is none to send — so the trigger's state is the stop.
     */
    it('drops the loop the moment the trigger is released', () => {
        expect(wantedWeaponLoops(
            [weapons([[PULSE_LASER, { firing: false, lastFired: 1000 }]])],
            [], 1001, data({ [PULSE_LASER]: weapon() })).size).toEqual(0);
    });

    it('drops the loop once shots stop, trigger held or not', () => {
        // A turret with no target, a weapon out of ammo: intent without
        // emission is silent.
        const reload = 500;
        const window = weaponLoopWindowMs(weapon({ reload }), 1);
        expect(window).toEqual(reload + LOOP_GRACE_MS);
        const state = [weapons([[PULSE_LASER,
            { firing: true, lastFired: 1000 }]])];
        const lookup = data({ [PULSE_LASER]: weapon({ reload }) });
        expect(wantedWeaponLoops(state, [], 1000 + window, lookup).size)
            .toEqual(1);
        expect(wantedWeaponLoops(state, [], 1000 + window + 1, lookup).size)
            .toEqual(0);
    });

    it('never loops a weapon that has not fired', () => {
        expect(wantedWeaponLoops(
            [weapons([[PULSE_LASER, { firing: true }]])],
            [], 1000, data({ [PULSE_LASER]: weapon() })).size).toEqual(0);
    });

    it('ignores weapons without the loop flag', () => {
        expect(wantedWeaponLoops(
            [weapons([[PULSE_LASER, { firing: true, lastFired: 1000 }]])],
            [], 1000, data({ [PULSE_LASER]: weapon({ loopSound: false }) }))
            .size).toEqual(0);
    });

    it('loops point defense without a held trigger', () => {
        expect(wantedWeaponLoops(
            [weapons([[PULSE_LASER, { firing: false, lastFired: 1000 }]])],
            [], 1010, data({
                [PULSE_LASER]: weapon({ guidance: 'pointDefenseBeam' }),
            })).size).toEqual(1);
    });

    it('wants one loop per sound however many ships fire it', () => {
        const ships = [1, 2, 3].map(() => weapons([[PULSE_LASER,
            { firing: true, lastFired: 1000 }]]));
        expect([...wantedWeaponLoops(ships, [], 1000,
            data({ [PULSE_LASER]: weapon() }))]).toEqual([PULSE_SOUND]);
    });

    it('keeps a beam\'s loop while the beam exists', () => {
        expect(wantedWeaponLoops([], [{ sound: 'nova:232', loopSound: true }],
            0, data({}))).toEqual(new Set(['nova:232']));
        expect(wantedWeaponLoops([], [{ sound: 'nova:232', loopSound: false }],
            0, data({})).size).toEqual(0);
    });

    it('spans a burst weapon\'s burst reload and shares out mounts', () => {
        expect(weaponLoopWindowMs(weapon({
            reload: 100, burstCount: 4, burstReload: 2000,
        }), 1)).toEqual(2000 + LOOP_GRACE_MS);
        expect(weaponLoopWindowMs(weapon({ reload: 900 }), 3))
            .toEqual(300 + LOOP_GRACE_MS);
        expect(weaponLoopWindowMs(weapon({
            reload: 900, fireSimultaneously: true,
        }), 3)).toEqual(900 + LOOP_GRACE_MS);
    });
});

/** A voice whose stop can be made to fail, like a blurred @pixi/sound. */
class FakeVoice implements LoopVoice {
    static contextPaused = false;
    live = true;
    constructor(readonly id: string) { }
    alive() { return this.live; }
    stop() {
        if (FakeVoice.contextPaused) {
            return false;
        }
        this.live = false;
        return true;
    }
}

function makePlayback() {
    const voices: FakeVoice[] = [];
    const playback = new LoopPlayback(id => {
        const voice = new FakeVoice(id);
        voices.push(voice);
        return voice;
    });
    const live = (id: string) =>
        voices.filter(v => v.id === id && v.live).length;
    return { playback, voices, live };
}

describe('LoopPlayback', () => {
    afterEach(() => { FakeVoice.contextPaused = false; });

    it('plays exactly one voice per wanted id, frame after frame', () => {
        const { playback, voices } = makePlayback();
        for (let i = 0; i < 5; i++) {
            playback.reconcile(new Set(['a', 'b']));
        }
        expect(voices.map(v => v.id)).toEqual(['a', 'b']);
    });

    it('stops a loop when it stops being wanted, with no stop event', () => {
        const { playback, live } = makePlayback();
        playback.reconcile(new Set(['a']));
        playback.reconcile(new Set());
        expect(live('a')).toEqual(0);
        expect(playback.playing.size).toEqual(0);
    });

    it('restarts a wanted loop something else silenced', () => {
        const { playback, voices, live } = makePlayback();
        playback.reconcile(new Set(['a']));
        voices[0].live = false; // e.g. a `{ stop: true }` for the same id
        playback.reconcile(new Set(['a']));
        expect(voices.length).toEqual(2);
        expect(live('a')).toEqual(1);
    });

    it('restarts every wanted loop afresh after stopAll (hidden tab)',
        () => {
            const { playback, voices, live } = makePlayback();
            playback.reconcile(new Set(['a', 'b']));
            playback.stopAll();
            expect(live('a') + live('b')).toEqual(0);
            playback.reconcile(new Set(['a']));
            expect(voices.length).toEqual(3);
            expect(live('a')).toEqual(1);
            expect(live('b')).toEqual(0);
        });

    it('retries a stop that could not take until it does', () => {
        // @pixi/sound cannot stop an instance its blur auto-pause has
        // paused; the stop must be retried once the context runs again,
        // or the loop resumes on focus with nothing tracking it.
        const { playback, live } = makePlayback();
        playback.reconcile(new Set(['a']));
        FakeVoice.contextPaused = true;
        playback.reconcile(new Set());
        expect(playback.pendingStops).toEqual(1);
        expect(playback.playing.size).toEqual(0);
        FakeVoice.contextPaused = false;
        playback.reconcile(new Set());
        expect(playback.pendingStops).toEqual(0);
        expect(live('a')).toEqual(0);
    });

    it('stops everything at teardown', () => {
        const { playback, voices } = makePlayback();
        playback.reconcile(new Set(['a', 'b', 'c']));
        playback.stopAll();
        expect(voices.every(v => !v.live)).toBeTrue();
    });

    it('leaves an unloaded sound unplayed and tries it again', () => {
        let loaded = false;
        const started: string[] = [];
        const playback = new LoopPlayback(id => {
            if (!loaded) {
                return undefined;
            }
            started.push(id);
            return new FakeVoice(id);
        });
        playback.reconcile(new Set(['a']));
        expect(playback.playing.size).toEqual(0);
        loaded = true;
        playback.reconcile(new Set(['a']));
        expect(started).toEqual(['a']);
    });
});
