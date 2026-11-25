import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { GateMapCancelledSystem, LeaveGateMapEvent } from './gate_map_plugin.js';
import { HYPERGATE_JUMP_CANCELLED_MESSAGE } from './status_bar_content.js';
import { StatusLineResource } from './status_message_plugin.js';

/**
 * Measured: reference "Wave-24 leftovers, wave 25" (Kit Gate A1, 10 fps).
 * Done on the gate map with no pick prints "Hypergate jump cancelled." (stock
 * STR# 2002 one-based 50) as the ship lifts back off at the gate.
 */
describe('GateMapCancelledSystem', () => {
    function makeDisplayWorld() {
        const world = new World();
        const lines: string[] = [];
        world.resources.set(StatusLineResource, {
            setMessage: (message: string) => lines.push(message),
        } as never);
        world.resources.set(TimeResource,
            { time: 1_000, delta_ms: 16, delta_s: 0.016, frame: 1 });
        world.addSystem(GateMapCancelledSystem);
        return { world, lines };
    }

    it('is STR# 2002 #50, verbatim', () => {
        expect(HYPERGATE_JUMP_CANCELLED_MESSAGE)
            .toBe('Hypergate jump cancelled.');
    });

    it('says "Hypergate jump cancelled." on Done with no pick', () => {
        const { world, lines } = makeDisplayWorld();
        world.emit(LeaveGateMapEvent,
            { ship: new Entity(), destinationSpob: null });
        world.step();
        expect(lines).toEqual(['Hypergate jump cancelled.']);
    });

    it('says nothing when a destination was picked', () => {
        const { world, lines } = makeDisplayWorld();
        world.emit(LeaveGateMapEvent,
            { ship: new Entity(), destinationSpob: 'nova:1401' });
        world.step();
        expect(lines).toEqual([]);
    });
});
