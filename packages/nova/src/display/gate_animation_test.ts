import "jasmine";
import { Angle } from "nova_ecs/datatypes/angle";
import { Position } from "nova_ecs/datatypes/position";
import { Vector } from "nova_ecs/datatypes/vector";
import { Entity } from "nova_ecs/entity";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { World } from "nova_ecs/world";
import { getDefaultGovtData } from "novadatainterface/govt_data";
import { MockGameData } from "novadatainterface/mock_game_data";
import { getDefaultPlanetData } from "novadatainterface/planet_data";
import { getDefaultRankData, getDefaultRankFlags } from "novadatainterface/rank_data";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { ActiveRanksComponent } from "../nova_plugin/ncb/ncb_plugin.js";
import { LegalRecordsComponent } from "../nova_plugin/reputation/reputation_plugin.js";
import { GATE_EMERGENCE_DISTANCE } from "../nova_plugin/travel/gate_transit_plugin.js";
import { PlanetComponent, PlanetDataComponent, PlanetTargetComponent } from "../nova_plugin/travel/planet_plugin.js";
import { ShipComponent } from "../nova_plugin/ship/ship_plugin.js";
import { AnimationGraphicComponent } from "./animation_graphic_plugin.js";
import {
    GateAnimationComponent, GateAnimationPlugin, GateAnimationState,
    GateAnticipationResource, GateArrivalAnticipationEvent, GATE_FRAME_MS,
    stepGateAnimation,
} from "./gate_animation_plugin.js";

const FRAMES = 42;

function makeState(): GateAnimationState {
    return { mode: 'closed', frame: 0, lastAdvance: 0 };
}

/** Reads the mode un-narrowed (TS otherwise narrows across mutating calls). */
const modeOf = (state: GateAnimationState): string => state.mode;

/** Advances the pure machine by one frame interval. */
function tick(state: GateAnimationState, wantOpen: boolean, now: number) {
    stepGateAnimation(state, wantOpen, FRAMES, now);
}

describe('stepGateAnimation', () => {
    it('idles closed and frozen while nothing wants it open', () => {
        const state = makeState();
        for (let t = 0; t < 20 * GATE_FRAME_MS; t += GATE_FRAME_MS) {
            tick(state, false, t);
            expect(state.mode).toBe('closed');
            expect(state.frame).toBe(0);
        }
    });

    it('plays forward when selected, then alternates the last two frames',
        () => {
        const state = makeState();
        let now = 0;
        tick(state, true, now);
        expect(state.mode).toBe('opening');

        // The sequence advances one frame per interval, in order.
        const seen: number[] = [];
        while (state.mode === 'opening') {
            now += GATE_FRAME_MS;
            tick(state, true, now);
            seen.push(state.frame);
        }
        // Strictly forward, no skips, ending at the last frame.
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i]).toBe(seen[i - 1] + 1);
        }
        expect(state.frame).toBe(FRAMES - 1);
        expect(state.mode).toBe('flicker');

        // The open gate alternates between the last two frames only.
        const flickerFrames = new Set<number>();
        for (let i = 0; i < 6; i++) {
            now += GATE_FRAME_MS;
            tick(state, true, now);
            flickerFrames.add(state.frame);
        }
        expect([...flickerFrames].sort()).toEqual([FRAMES - 2, FRAMES - 1]);
    });

    it('reverses from the current frame when deselected mid-opening', () => {
        const state = makeState();
        let now = 0;
        tick(state, true, now);
        // Open partway: advance 10 frames.
        for (let i = 0; i < 10; i++) {
            now += GATE_FRAME_MS;
            tick(state, true, now);
        }
        const reachedFrame = state.frame;
        expect(reachedFrame).toBe(10);

        // Deselect: the very next step flips to closing WITHOUT jumping.
        tick(state, false, now);
        expect(state.mode).toBe('closing');
        expect(state.frame).toBe(reachedFrame);

        // It steps backwards one frame per interval down to closed.
        const seen: number[] = [];
        while (state.mode === 'closing') {
            now += GATE_FRAME_MS;
            tick(state, false, now);
            seen.push(state.frame);
        }
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i]).toBe(seen[i - 1] - 1);
        }
        expect(state.mode).toBe('closed');
        expect(state.frame).toBe(0);
    });

    it('resumes opening from the current frame when re-selected mid-close',
        () => {
        const state = makeState();
        let now = 0;
        tick(state, true, now);
        for (let i = 0; i < 20; i++) {
            now += GATE_FRAME_MS;
            tick(state, true, now);
        }
        // Close partway...
        tick(state, false, now);
        for (let i = 0; i < 5; i++) {
            now += GATE_FRAME_MS;
            tick(state, false, now);
        }
        const midFrame = state.frame;
        expect(state.mode).toBe('closing');
        expect(midFrame).toBe(15);
        // ...then re-select: opening resumes upward from where it is.
        tick(state, true, now);
        expect(state.mode).toBe('opening');
        expect(state.frame).toBe(midFrame);
        now += GATE_FRAME_MS;
        tick(state, true, now);
        expect(state.frame).toBe(midFrame + 1);
    });

    it('closes back down when deselected while flickering', () => {
        const state = makeState();
        let now = 0;
        tick(state, true, now);
        while (modeOf(state) !== 'flicker') {
            now += GATE_FRAME_MS;
            tick(state, true, now);
        }
        tick(state, false, now);
        expect(modeOf(state)).toBe('closing');
        while (modeOf(state) === 'closing') {
            now += GATE_FRAME_MS;
            tick(state, false, now);
        }
        expect(modeOf(state)).toBe('closed');
        expect(state.frame).toBe(0);
    });

    it('does nothing for single-frame (static) gates', () => {
        const state = makeState();
        stepGateAnimation(state, true, 1, GATE_FRAME_MS);
        expect(state.mode).toBe('closed');
        expect(state.frame).toBe(0);
    });
});

/**
 * ECS-level trigger tests: a tiny display-less world with a fake gate whose
 * "graphic" is just a frames/frame record, driven by a manually-advanced
 * clock.
 */
describe('GateAnimationSystem triggers', () => {
    const GATE_UUID = 'planet gate';
    let world: World;
    let time: { time: number, delta_ms: number, delta_s: number, frame: number };
    let sprite: { frames: number, frame: number };

    beforeEach(async () => {
        world = new World('gate animation test');
        time = { time: 0, delta_ms: 16, delta_s: 0.016, frame: 0 };
        world.resources.set(TimeResource, time);
        await world.addPlugin(GateAnimationPlugin);

        sprite = { frames: FRAMES, frame: 0 };
        const gate = new Entity('gate');
        gate.components.set(PlanetComponent, { id: 'nova:1401' });
        gate.components.set(PlanetDataComponent, {
            ...getDefaultPlanetData(),
            gate: { kind: 'hypergate', destinations: [], emergenceAngle: 120 },
        });
        gate.components.set(AnimationGraphicComponent,
            { sprites: new Map([['base', sprite]]) } as never);
        gate.components.set(MovementStateComponent, {
            position: new Position(0, 0), velocity: new Vector(0, 0),
            rotation: new Angle(0), accelerating: 0, turnBack: false,
            turning: 0,
        });
        world.entities.set(GATE_UUID, gate);
    });

    function step(ms = GATE_FRAME_MS) {
        time.time += ms;
        world.step();
    }

    function gateState() {
        return world.entities.get(GATE_UUID)!.components
            .get(GateAnimationComponent)!;
    }

    it('stays closed with no selection and no arrival', () => {
        for (let i = 0; i < 10; i++) {
            step();
        }
        expect(gateState().mode).toBe('closed');
        expect(sprite.frame).toBe(0);
    });

    it("opens while any ship's landing target is the gate, closes after",
        () => {
        const ship = new Entity('ship');
        ship.components.set(PlanetTargetComponent, { target: GATE_UUID });
        world.entities.set('ship uuid', ship);

        step();
        step();
        expect(gateState().mode).toBe('opening');
        expect(sprite.frame).toBeGreaterThan(0);

        // Deselect: it reverses back down to closed.
        ship.components.set(PlanetTargetComponent, { target: undefined });
        step();
        expect(gateState().mode).toBe('closing');
        for (let i = 0; i < FRAMES + 2; i++) {
            step();
        }
        expect(gateState().mode).toBe('closed');
        expect(sprite.frame).toBe(0);
    });

    it('ignores a PLAYER without access to a locked gate, opens for one '
        + 'holding the unlocking rank, and still opens for NPC selections',
        async () => {
        // A stock working gate: MinStatus 32767 under the Hypergate govt,
        // unlocked only by a rank carrying 0x0200 for that govt.
        const gameData = new MockGameData();
        const govt = { ...getDefaultGovtData(), id: 'nova:183' };
        gameData.data.Govt.map.set('nova:183', govt);
        await gameData.data.Govt.get('nova:183');
        const rank = {
            ...getDefaultRankData(), id: 'nova:147', affilGovt: 'nova:183',
            rankFlags: {
                ...getDefaultRankFlags(), canAlwaysLandOnGovtStellars: true,
            },
        };
        gameData.data.Rank.map.set('nova:147', rank);
        await gameData.data.Rank.get('nova:147');
        world.resources.set(SimulationGameDataResource, gameData);
        const gate = world.entities.get(GATE_UUID)!;
        gate.components.set(PlanetDataComponent, {
            ...gate.components.get(PlanetDataComponent)!,
            govt: 'nova:183', minStatus: 32767,
        });

        // A player (has a legal record) without the rank: the gate ignores
        // their selection.
        const player = new Entity('player');
        player.components.set(PlanetTargetComponent, { target: GATE_UUID });
        player.components.set(LegalRecordsComponent, new Map());
        world.entities.set('player uuid', player);
        for (let i = 0; i < 5; i++) {
            step();
        }
        expect(gateState().mode).toBe('closed');
        expect(sprite.frame).toBe(0);

        // Grant the rank: it opens.
        player.components.set(ActiveRanksComponent, new Set(['nova:147']));
        step();
        step();
        expect(gateState().mode).toBe('opening');

        // An NPC (no legal record) selecting it opens it as before.
        world.entities.delete('player uuid');
        const npc = new Entity('npc');
        npc.components.set(PlanetTargetComponent, { target: GATE_UUID });
        world.entities.set('npc uuid', npc);
        for (let i = 0; i < FRAMES + 2; i++) {
            step();
        }
        expect(gateState().mode).not.toBe('closed');
    });

    it('opens on an announced arrival (browser anticipation event)', () => {
        world.emit(GateArrivalAnticipationEvent, { spob: 'nova:1401' });
        step();
        step();
        expect(gateState().mode).toBe('opening');
    });

    it('opens when a ship appears at its emergence point', () => {
        // Let the provider run once so the gate has animation state.
        step();
        const arriving = new Entity('arriving ship');
        arriving.components.set(ShipComponent, { id: 'nova:128' });
        arriving.components.set(MovementStateComponent, {
            position: new Position(GATE_EMERGENCE_DISTANCE, 0),
            velocity: new Vector(0, 0), rotation: new Angle(0),
            accelerating: 0, turnBack: false, turning: 0,
        });
        world.entities.set('arriving uuid', arriving);
        step();
        step();
        expect(gateState().mode).toBe('opening');
        // The anticipation was recorded for this gate.
        expect(world.resources.get(GateAnticipationResource)!
            .has('nova:1401')).toBeTrue();
    });
});
