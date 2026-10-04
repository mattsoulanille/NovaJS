import 'jasmine';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SentHail, SentHailComponent } from '../nova_plugin/encounters/index.js';
import { PlayerShipSelector } from '../nova_plugin/player/index.js';
import { ShipDataComponent } from '../nova_plugin/ship/index.js';
import { playerHailMessage } from './status_bar_content.js';
import {
    PLAYER_HAIL_FRESH_MS, SeenPlayerHailsResource, ShowPlayerHailMessage,
    StatusLineResource,
} from './status_message_plugin.js';
import { SimulationTimeResource } from './simulation_time.js';

/**
 * Matthew's ruling on #332: "For now, buttons pressed should just send the
 * message to the bottom left info text area on that player's screen."
 *
 * The sender's press is recorded on the SENDER's own ship (hail_plugin's
 * SentHail); this is the RECIPIENT's client finding it and printing it.
 */
describe('ShowPlayerHailMessage (another player hailed us, #332)', () => {
    const ME = 'my-ship';
    const SENDER = 'their-ship';
    const NOW = 100_000;

    function makeDisplayWorld() {
        const world = new World();
        const lines: string[] = [];
        world.resources.set(StatusLineResource, {
            setMessage: (message: string) => lines.push(message),
        } as never);
        world.resources.set(TimeResource,
            { time: 1_700_000_000_000, delta_ms: 16, delta_s: 0.016, frame: 1 });
        world.resources.set(SimulationTimeResource,
            { time: NOW, delta_ms: 16, delta_s: 0.016, frame: 6000 });
        world.resources.set(SeenPlayerHailsResource, new Map());
        world.addSystem(ShowPlayerHailMessage);
        world.entities.set(ME, new Entity()
            .addComponent(PlayerShipSelector, undefined));
        const sender = new Entity()
            .addComponent(ShipDataComponent,
                { ...getDefaultShipData(), name: 'Starbridge;dev note' });
        world.entities.set(SENDER, sender);
        return { world, lines, sender };
    }

    function hail(overrides: Partial<SentHail> = {}): SentHail {
        return { to: ME, message: 'greetings', seq: 1, at: NOW - 100,
            ...overrides };
    }

    it('prints a hail addressed to this player, naming the sender\'s ship',
        () => {
            const { world, lines, sender } = makeDisplayWorld();
            sender.components.set(SentHailComponent, hail());
            world.step();
            // The developer-only ";" suffix is hidden, as everywhere else.
            expect(lines).toEqual([playerHailMessage('Starbridge', 'greetings')]);
            expect(lines[0]).toBe('The Starbridge hails you: "Greetings."');
        });

    it('prints each message ONCE, and the next press again', () => {
        const { world, lines, sender } = makeDisplayWorld();
        sender.components.set(SentHailComponent, hail());
        world.step();
        world.step();
        expect(lines.length).toBe(1);
        sender.components.set(SentHailComponent,
            hail({ seq: 2, message: 'mercy' }));
        world.step();
        expect(lines).toEqual([
            playerHailMessage('Starbridge', 'greetings'),
            playerHailMessage('Starbridge', 'mercy'),
        ]);
    });

    it('ignores a hail to somebody else — the sender\'s own screen included',
        () => {
            const { world, lines, sender } = makeDisplayWorld();
            sender.components.set(SentHailComponent,
                hail({ to: 'a third ship' }));
            world.step();
            expect(lines).toEqual([]);
        });

    it('does not replay a stale hail it only now meets', () => {
        const { world, lines, sender } = makeDisplayWorld();
        sender.components.set(SentHailComponent,
            hail({ at: NOW - PLAYER_HAIL_FRESH_MS - 1 }));
        world.step();
        expect(lines).toEqual([]);
    });
});

describe('playerHailMessage', () => {
    it('words each button, falling back when the ship is unnamed', () => {
        expect(playerHailMessage('Shuttle', 'assistance'))
            .toBe('The Shuttle hails you, requesting assistance.');
        expect(playerHailMessage('Shuttle', 'mercy'))
            .toBe('The Shuttle hails you, begging for mercy.');
        expect(playerHailMessage(undefined, 'greetings'))
            .toBe('Another pilot hails you: "Greetings."');
    });
});
