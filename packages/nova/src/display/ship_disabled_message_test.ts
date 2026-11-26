import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { ShipDisabledEvent } from '../nova_plugin/encounters/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { SHIP_DISABLED_MESSAGE } from './status_bar_content.js';
import {
    ShowShipDisabledMessage, StatusLineResource,
} from './status_message_plugin.js';

/**
 * Reference "A disabled player (A10), wave 37", finding 3: the original
 * prints "Ship disabled." (stock STR# 2002 0-based 286) on the status line
 * at the moment the player's ship is disabled.
 */
describe('ShowShipDisabledMessage (A10, wave 37)', () => {
    const ME = 'my-ship';
    const OTHER = 'their-ship';

    function makeDisplayWorld() {
        const world = new World();
        const lines: string[] = [];
        world.resources.set(StatusLineResource, {
            setMessage: (message: string) => lines.push(message),
        } as never);
        world.resources.set(TimeResource,
            { time: 1_700_000_000_000, delta_ms: 16, delta_s: 0.016, frame: 1 });
        world.addSystem(ShowShipDisabledMessage);
        world.entities.set(ME, new Entity()
            .addComponent(PlayerShipSelector, undefined));
        world.entities.set(OTHER, new Entity());
        return { world, lines };
    }

    it('says "Ship disabled." when this player\'s ship is disabled', () => {
        const { world, lines } = makeDisplayWorld();
        world.emit(ShipDisabledEvent, {}, [ME]);
        world.step();
        expect(lines).toEqual([SHIP_DISABLED_MESSAGE]);
        expect(SHIP_DISABLED_MESSAGE).toBe('Ship disabled.');
    });

    it('says nothing for another player\'s ship', () => {
        const { world, lines } = makeDisplayWorld();
        world.emit(ShipDisabledEvent, {}, [OTHER]);
        world.step();
        expect(lines).toEqual([]);
    });
});
