import 'jasmine';
import type { SimulationFrame } from '../communication/simulation_frame.js';
import { FrameBacklog, HOLD_MS } from './frame_backlog.js';

/**
 * A frame the pump has taken is a delta the host counts as delivered, so a
 * failed game-data load must hold it, not drop it (client/frame_backlog.ts;
 * the dropped re-add behind the escort double of 2026-11-27).
 */
describe('the frame backlog', () => {
    function frame(added: string): SimulationFrame {
        return {
            added: [[added, { components: [] } as never]],
            changed: [], removed: [], events: [],
        };
    }
    const names = (frames: SimulationFrame[]) =>
        frames.map(f => f.added[0][0]);

    it('holds a frame whose staging fails, and the frames after it, then '
        + 'applies them all in order once the data loads', async () => {
            const backlog = new FrameBacklog();
            const applied: SimulationFrame[] = [];
            let online = false;
            const stage = async () => {
                if (!online) {
                    throw new Error('server restarting');
                }
            };
            const now = () => 0;
            backlog.push(frame('re-added escort'));
            expect(await backlog.drain(stage, f => applied.push(f), () => true,
                now)).toEqual(new Error('server restarting'));
            backlog.push(frame('next'));
            await backlog.drain(stage, f => applied.push(f), () => true, now);
            expect(applied).toEqual([]);
            expect(backlog.length).toBe(2);

            online = true;
            expect(await backlog.drain(stage, f => applied.push(f), () => true,
                now)).toBeUndefined();
            expect(names(applied)).toEqual(['re-added escort', 'next']);
            expect(backlog.length).toBe(0);
        });

    it('applies a frame without its data once it has waited HOLD_MS, '
        + 'rather than freeze the display for good', async () => {
            const backlog = new FrameBacklog();
            const applied: SimulationFrame[] = [];
            let clock = 1000;
            const stage = async () => { throw new Error('never loads'); };
            spyOn(console, 'error');
            backlog.push(frame('stuck'));
            await backlog.drain(stage, f => applied.push(f), () => true,
                () => clock);
            clock += HOLD_MS - 1;
            await backlog.drain(stage, f => applied.push(f), () => true,
                () => clock);
            expect(applied).toEqual([]);
            clock += 1;
            await backlog.drain(stage, f => applied.push(f), () => true,
                () => clock);
            expect(names(applied)).toEqual(['stuck']);
            expect(console.error).toHaveBeenCalledTimes(1);
        });

    it('stops at a transition, and a new live system starts empty', async () => {
        const backlog = new FrameBacklog();
        const applied: SimulationFrame[] = [];
        backlog.push(frame('old system'));
        await backlog.drain(async () => undefined, f => applied.push(f),
            () => false);
        expect(applied).toEqual([]);
        backlog.clear();
        expect(backlog.length).toBe(0);
    });
});
