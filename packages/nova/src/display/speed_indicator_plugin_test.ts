import 'jasmine';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import type { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { DisplayAssetDataResource } from '../nova_plugin/core/index.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import {
    RoomSpeedResource, SPEED_BADGE_CICN, SPEED_INDICATOR_INSET_X,
    SPEED_INDICATOR_INSET_Y, SpeedIndicatorPlugin, SpeedIndicatorResource,
    speedIndicatorState,
} from './speed_indicator_plugin.js';
import { Stage } from './stage_resource.js';

describe('speedIndicatorState (#371 R3)', () => {
    it('is hidden when undefined or idle at 1x', () => {
        expect(speedIndicatorState(undefined)).toEqual({ kind: 'hidden' });
        expect(speedIndicatorState({
            speed: 1, fastVotes: 0, totalVoters: 2, wantFast: false, inSpace: true,
        })).toEqual({ kind: 'hidden' });
    });

    it('shows the cicn badge whenever the room runs at 2x', () => {
        expect(speedIndicatorState({
            speed: 2, fastVotes: 2, totalVoters: 2, wantFast: true, inSpace: true,
        })).toEqual({ kind: 'badge' });
        expect(speedIndicatorState({
            speed: 2, fastVotes: 1, totalVoters: 1, wantFast: false, inSpace: false,
        })).toEqual({ kind: 'badge' });
    });

    it('shows "x2 — waiting for N of M" only when this in-space player wants 2x at 1x', () => {
        expect(speedIndicatorState({
            speed: 1, fastVotes: 2, totalVoters: 3, wantFast: true, inSpace: true,
        })).toEqual({ kind: 'waiting', text: 'x2 — waiting for 1 of 3' });
        expect(speedIndicatorState({
            speed: 1, fastVotes: 1, totalVoters: 3, wantFast: true, inSpace: true,
        })).toEqual({ kind: 'waiting', text: 'x2 — waiting for 2 of 3' });
    });

    it('shows nothing when a solo player is at 1x, when another player waits, or while landed', () => {
        expect(speedIndicatorState({
            speed: 1, fastVotes: 0, totalVoters: 1, wantFast: true, inSpace: true,
        })).toEqual({ kind: 'hidden' });
        expect(speedIndicatorState({
            speed: 1, fastVotes: 2, totalVoters: 3, wantFast: false, inSpace: true,
        })).toEqual({ kind: 'hidden' });
        expect(speedIndicatorState({
            speed: 1, fastVotes: 1, totalVoters: 2, wantFast: true, inSpace: false,
        })).toEqual({ kind: 'hidden' });
    });
});

describe('SpeedIndicatorPlugin (#371 R3)', () => {
    beforeAll(() => installHeadlessPixi());

    it('loads cicn nova:20000 at top-left, toggles badge vs waiting text, and destroys cleanly', async () => {
        const requestedCicns: string[] = [];
        const displayAssets = {
            textureFromCicn: async (id: string) => {
                requestedCicns.push(id);
                return PIXI.Texture.EMPTY;
            },
        } as unknown as DisplayAssetDataInterface;

        const world = new World('speed indicator plugin test');
        const stage = new PIXI.Container();
        world.resources.set(Stage, stage);
        world.resources.set(DisplayAssetDataResource, displayAssets);

        await world.addPlugin(SpeedIndicatorPlugin);

        expect(requestedCicns).toEqual([SPEED_BADGE_CICN]);
        const indicator = world.resources.get(SpeedIndicatorResource)!;
        expect(indicator).toBeDefined();
        expect(indicator.container.parent).toBe(stage);
        expect(indicator.container.position.x).toBe(SPEED_INDICATOR_INSET_X);
        expect(indicator.container.position.y).toBe(SPEED_INDICATOR_INSET_Y);

        // Idle: both hidden.
        world.step();
        expect(indicator.badge.visible).toBeFalse();
        expect(indicator.waitingText.visible).toBeFalse();

        // Waiting on others: text visible, badge hidden.
        const holder = world.resources.get(RoomSpeedResource)!;
        holder.status = {
            speed: 1, targetSpeed: 1, atTick: 0,
            fastVotes: 2, totalVoters: 3, wantFast: true, inSpace: true,
        };
        world.step();
        expect(indicator.badge.visible).toBeFalse();
        expect(indicator.waitingText.visible).toBeTrue();
        expect(indicator.waitingText.text).toBe('x2 — waiting for 1 of 3');

        // Active 2x: badge visible, text hidden.
        holder.status = {
            speed: 2, targetSpeed: 2, atTick: 10,
            fastVotes: 3, totalVoters: 3, wantFast: true, inSpace: true,
        };
        world.step();
        expect(indicator.badge.visible).toBeTrue();
        expect(indicator.waitingText.visible).toBeFalse();

        // Back to 1x idle: both hidden.
        holder.status = {
            speed: 1, targetSpeed: 1, atTick: 20,
            fastVotes: 0, totalVoters: 3, wantFast: false, inSpace: true,
        };
        world.step();
        expect(indicator.badge.visible).toBeFalse();
        expect(indicator.waitingText.visible).toBeFalse();

        // Teardown detaches and destroys the container and its Text.
        await world.removePlugin(SpeedIndicatorPlugin);
        expect(stage.children).not.toContain(indicator.container);
        expect(indicator.container.destroyed).toBeTrue();
        expect(indicator.waitingText.destroyed).toBeTrue();
        expect(world.resources.has(SpeedIndicatorResource)).toBeFalse();
        expect(world.resources.has(RoomSpeedResource)).toBeFalse();
    });
});
