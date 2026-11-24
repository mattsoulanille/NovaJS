import { Plugin } from "nova_ecs/plugin";
import { Resource } from "nova_ecs/resource";
import { System } from "nova_ecs/system";
import { SingletonComponent } from "nova_ecs/world";
import * as PIXI from "pixi.js";
import type { RoomSpeedStatus } from "../communication/simulation_frame.js";
import { DisplayAssetDataResource } from "../nova_plugin/core/index.js";
import { Stage } from "./stage_resource.js";

/**
 * The original EV Nova 2x-speed badge icon: a 32x16 grey badge with a red
 * "x2" drawn at the top-left corner of the space view (R3 #371).
 */
export const SPEED_BADGE_CICN = 'nova:20000';

/** Top-left inset on the UI layer (`Stage`): flush with the corner
 * (Matthew, 2026-11-23: "shove the 2x indicator flush to the top left"). */
export const SPEED_INDICATOR_INSET_X = 0;
export const SPEED_INDICATOR_INSET_Y = 0;

/**
 * Latest room speed status delivered by the simulation bridge
 * (`SimulationFrame.roomSpeed`, #371). Display-only; written by the frame
 * pump and read by {@link DrawSpeedIndicator}.
 */
export const RoomSpeedResource =
    new Resource<{ status?: RoomSpeedStatus }>('RoomSpeed');

/** Pure display state for the top-left room speed indicator (R3 #371). */
export type SpeedIndicatorState =
    | { readonly kind: 'badge' }
    | { readonly kind: 'waiting', readonly text: string }
    | { readonly kind: 'hidden' };

/**
 * Computes what the top-left space-view speed indicator should show (R3 #371):
 * - When the room runs at 2x: show the cicn `nova:20000` badge.
 * - When this player is in space wanting 2x while the room is at 1x waiting
 *   on other in-space voters: show `"x2 — waiting for N of M"`.
 * - Show nothing otherwise.
 */
export function speedIndicatorState(status: {
    speed: 1 | 2;
    fastVotes: number;
    totalVoters: number;
    wantFast: boolean;
    inSpace: boolean;
} | undefined): SpeedIndicatorState {
    if (!status) {
        return { kind: 'hidden' };
    }
    if (status.speed === 2) {
        return { kind: 'badge' };
    }
    const waiting = Math.max(0, status.totalVoters - status.fastVotes);
    if (status.inSpace && status.wantFast && status.totalVoters > 1 && waiting > 0) {
        return {
            kind: 'waiting',
            text: `x2 — waiting for ${waiting} of ${status.totalVoters}`,
        };
    }
    return { kind: 'hidden' };
}

/**
 * Top-left HUD overlay on `Stage` showing the original `nova:20000` x2 badge
 * when the room is at 2x, or a small unobtrusive waiting line when this
 * player wants 2x at 1x.
 */
export class SpeedIndicator {
    readonly container = new PIXI.Container();
    readonly badge: PIXI.Sprite;
    readonly waitingText: PIXI.Text;
    private lastKey = 'hidden';

    constructor(badgeTexture: PIXI.Texture) {
        this.container.name = 'SpeedIndicator';
        this.container.position.set(
            SPEED_INDICATOR_INSET_X, SPEED_INDICATOR_INSET_Y);
        this.container.eventMode = 'none';

        this.badge = new PIXI.Sprite(badgeTexture);
        this.badge.name = 'SpeedBadge';
        this.badge.visible = false;
        this.badge.eventMode = 'none';

        this.waitingText = new PIXI.Text('', new PIXI.TextStyle({
            fontFamily: 'Geneva',
            fontSize: 11,
            fill: 0xc0c0c0,
        }));
        this.waitingText.name = 'SpeedWaitingText';
        this.waitingText.visible = false;
        this.waitingText.eventMode = 'none';

        this.container.addChild(this.badge, this.waitingText);
    }

    update(state: SpeedIndicatorState) {
        const key = state.kind === 'waiting'
            ? `waiting:${state.text}` : state.kind;
        if (key === this.lastKey) {
            return;
        }
        this.lastKey = key;
        if (state.kind === 'badge') {
            this.badge.visible = true;
            this.waitingText.visible = false;
            return;
        }
        if (state.kind === 'waiting') {
            this.badge.visible = false;
            this.waitingText.text = state.text;
            this.waitingText.visible = true;
            return;
        }
        this.badge.visible = false;
        this.waitingText.visible = false;
    }

    destroy() {
        if (!this.container.destroyed) {
            this.container.destroy({ children: true });
        }
    }
}

export const SpeedIndicatorResource =
    new Resource<SpeedIndicator>('SpeedIndicator');

/**
 * Updates the top-left 2x speed indicator every display step. Runs on the
 * singleton so the badge stays visible when the room runs at 2x regardless
 * of local ship state.
 */
export const DrawSpeedIndicator = new System({
    name: 'DrawSpeedIndicator',
    args: [SpeedIndicatorResource, RoomSpeedResource, SingletonComponent] as const,
    step(indicator, speedHolder) {
        indicator.update(speedIndicatorState(speedHolder.status));
    },
});

export const SpeedIndicatorPlugin: Plugin = {
    name: 'SpeedIndicator',
    async build(world) {
        const stage = world.resources.get(Stage);
        if (!stage) {
            throw new Error('Expected Stage resource to exist');
        }
        const displayAssets = world.resources.get(DisplayAssetDataResource);
        if (!displayAssets) {
            throw new Error('Expected DisplayAssetDataResource to exist');
        }

        let badgeTexture = PIXI.Texture.EMPTY;
        try {
            badgeTexture = await displayAssets.textureFromCicn(SPEED_BADGE_CICN);
        } catch (e) {
            console.warn(`Failed to load 2x badge cicn ${SPEED_BADGE_CICN}:`, e);
        }

        const indicator = new SpeedIndicator(badgeTexture);
        stage.addChild(indicator.container);
        world.resources.set(SpeedIndicatorResource, indicator);
        if (!world.resources.get(RoomSpeedResource)) {
            world.resources.set(RoomSpeedResource, {});
        }
        world.addSystem(DrawSpeedIndicator);
    },
    remove(world) {
        world.removeSystem(DrawSpeedIndicator);
        const stage = world.resources.get(Stage);
        const indicator = world.resources.get(SpeedIndicatorResource);
        if (indicator) {
            if (stage) {
                stage.removeChild(indicator.container);
            }
            indicator.destroy();
        }
        world.resources.delete(SpeedIndicatorResource);
        world.resources.delete(RoomSpeedResource);
    },
};
