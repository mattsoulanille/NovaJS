import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataResource, SystemIdResource } from '../nova_plugin/core/index.js';
import { GameDateComponent, PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ArrivalRoute } from './status_bar_content.js';
import {
    ArrivalShownResource, DateSuffixResource, DrawStatusMessage,
    setArrivalRoute, StatusLineResource,
} from './status_message_plugin.js';

/**
 * The arrival line names how the player came in: "Jumping into the ..."
 * after a jump, "Exiting hypergate in the ..." after a hypergate (measured:
 * reference "Gate map, wave 27"), "Passing through a wormhole into the ..."
 * after a wormhole (stock STR# 2002's own form). The client's system entry
 * tells the fresh display world the route (setArrivalRoute) before its first
 * step composes the line.
 */
describe('the arrival status line', () => {
    function makeWorld() {
        const world = new World();
        const lines: string[] = [];
        world.resources.set(StatusLineResource, {
            setMessage: (message: string) => lines.push(message),
            update: () => { },
        } as never);
        world.resources.set(TimeResource,
            { time: 1000, delta_ms: 16, delta_s: 0.016, frame: 1 });
        world.resources.set(SimulationGameDataResource, {
            data: {
                System: {
                    getCached: (id: string) => id === 'nova:1206'
                        ? { name: 'Kit Gate N3' } : undefined,
                },
            },
        } as never);
        world.resources.set(SystemIdResource, 'nova:1206');
        world.resources.set(DateSuffixResource, { suffix: ' NC' });
        world.resources.set(ArrivalShownResource,
            { shown: false, route: 'hyperspace' });
        world.addSystem(DrawStatusMessage);
        world.entities.set('me', new Entity()
            .addComponent(PlayerShipSelector, undefined)
            .addComponent(GameDateComponent, { day: 23, month: 6, year: 1177 }));
        return { world, lines };
    }

    it('says "Jumping into the ..." when no route is set', () => {
        const { world, lines } = makeWorld();
        world.step();
        world.step();
        expect(lines).toEqual(
            ['Jumping into the Kit Gate N3 system on June 23rd, 1177 NC.']);
    });

    const cases: [ArrivalRoute, string][] = [
        ['hypergate',
            'Exiting hypergate in the Kit Gate N3 system on June 23rd, 1177 NC.'],
        ['wormhole', 'Passing through a wormhole into the Kit Gate N3 system '
            + 'on June 23rd, 1177 NC.'],
        ['hyperspace',
            'Jumping into the Kit Gate N3 system on June 23rd, 1177 NC.'],
    ];
    for (const [route, line] of cases) {
        it(`says "${line.split(' Kit')[0]} ..." after a ${route} entry`, () => {
            const { world, lines } = makeWorld();
            setArrivalRoute(world, route);
            world.step();
            expect(lines).toEqual([line]);
        });
    }

    it('ignores a route set after the line is up, and a world without the '
        + 'plugin', () => {
        const { world, lines } = makeWorld();
        world.step();
        setArrivalRoute(world, 'hypergate');
        expect(world.resources.get(ArrivalShownResource)?.route)
            .toBe('hyperspace');
        expect(lines.length).toBe(1);
        expect(() => setArrivalRoute(new World(), 'wormhole')).not.toThrow();
    });
});
