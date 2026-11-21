import 'jasmine';
import { World } from 'nova_ecs/world';
import type { StatusBar } from './status_bar.js';
import { speedReadout } from './status_bar_content.js';
import { StatusBarResource } from './status_bar_resource.js';
import { DrawStatusBarSpeed, RoomSpeedResource, SpeedPane } from './status_bar_speed.js';

describe('speedReadout (#371)', () => {
    it('returns null when undefined or idle at 1x', () => {
        expect(speedReadout(undefined)).toBeNull();
        expect(speedReadout({
            speed: 1, fastVotes: 0, totalVoters: 2, wantFast: false, inSpace: true,
        })).toBeNull();
    });

    it('shows bright 2× when the room is running at 2x', () => {
        expect(speedReadout({
            speed: 2, fastVotes: 2, totalVoters: 2, wantFast: true, inSpace: true,
        })).toEqual({ text: '2×', dim: false });
        // Even while landed, if the room's in-space players are at 2x, show 2×.
        expect(speedReadout({
            speed: 2, fastVotes: 1, totalVoters: 1, wantFast: false, inSpace: false,
        })).toEqual({ text: '2×', dim: false });
    });

    it('shows waiting count when in space and wanting 2x while others do not', () => {
        expect(speedReadout({
            speed: 1, fastVotes: 2, totalVoters: 3, wantFast: true, inSpace: true,
        })).toEqual({ text: '2× — waiting for 1 of 3', dim: true });
        expect(speedReadout({
            speed: 1, fastVotes: 1, totalVoters: 3, wantFast: true, inSpace: true,
        })).toEqual({ text: '2× — waiting for 2 of 3', dim: true });
    });

    it('does not flash "waiting for 1 of 1" for a solo player', () => {
        expect(speedReadout({
            speed: 1, fastVotes: 0, totalVoters: 1, wantFast: true, inSpace: true,
        })).toBeNull();
    });

    it('shows how many others are ready when another player wants 2x', () => {
        expect(speedReadout({
            speed: 1, fastVotes: 2, totalVoters: 3, wantFast: false, inSpace: true,
        })).toEqual({ text: '2× — 2 of 3 ready', dim: true });
        // A landed player with Caps Lock on is not voting, so they see the
        // in-space tally rather than "waiting for ...".
        expect(speedReadout({
            speed: 1, fastVotes: 1, totalVoters: 2, wantFast: true, inSpace: false,
        })).toEqual({ text: '2× — 1 of 2 ready', dim: true });
    });
});

describe('SpeedPane and DrawStatusBarSpeed', () => {
    it('does not throw if drawSpeed runs before build / mid-reload', () => {
        const pane = new SpeedPane();
        expect(() => pane.drawSpeed({ text: '2×', dim: false })).not.toThrow();
        expect(() => pane.drawSpeed(null)).not.toThrow();
    });

    it('forwards RoomSpeedResource updates to statusBar.speed.drawSpeed', () => {
        const world = new World('speed indicator test');
        const drawSpeed = jasmine.createSpy('drawSpeed');
        world.resources.set(StatusBarResource,
            { speed: { drawSpeed } } as unknown as StatusBar);
        const holder: { status?: import('../communication/simulation_frame.js').RoomSpeedStatus } = {};
        world.resources.set(RoomSpeedResource, holder);
        world.addSystem(DrawStatusBarSpeed);

        world.step();
        expect(drawSpeed).toHaveBeenCalledWith(null);

        holder.status = {
            speed: 1, targetSpeed: 1, atTick: 0,
            fastVotes: 2, totalVoters: 3, wantFast: true, inSpace: true,
        };
        world.step();
        expect(drawSpeed).toHaveBeenCalledWith({
            text: '2× — waiting for 1 of 3', dim: true,
        });

        holder.status = {
            speed: 2, targetSpeed: 2, atTick: 10,
            fastVotes: 3, totalVoters: 3, wantFast: true, inSpace: true,
        };
        world.step();
        expect(drawSpeed).toHaveBeenCalledWith({ text: '2×', dim: false });
    });
});
