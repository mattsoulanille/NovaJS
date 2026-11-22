import 'jasmine';
import { World } from 'nova_ecs/world';
import { Subject } from 'rxjs';
import { ControlEvent, EcsControlEvent } from '../nova_plugin/core/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { ControlRouter, ControlRouteTargets } from './control_routing.js';

class FakeBridge {
    readonly records: ControlEvent[][] = [];
    controlEvents(events: ControlEvent[]) {
        this.records.push(events.map(e => ({ ...e })));
        return Promise.resolve();
    }
}

function targets(bridge: FakeBridge | undefined,
    controlsSubject = new Subject<ControlEvent>(),
    displayWorld?: World): ControlRouteTargets {
    return {
        consumeLocal: () => false,
        displayWorld,
        controlsSubject,
        bridge,
        send: call => void call,
    };
}

const start = (action: ControlEvent['action']): ControlEvent =>
    ({ action, state: 'start' });
const repeat = (action: ControlEvent['action']): ControlEvent =>
    ({ action, state: 'repeat' });
const release = (action: ControlEvent['action']): ControlEvent =>
    ({ action, state: false });

describe('ControlRouter', () => {
    it('sends a held key\'s auto-repeats to no bridge (input) record', () => {
        const router = new ControlRouter();
        const bridge = new FakeBridge();
        const to = targets(bridge);
        router.route([start('accelerate')], to);
        for (let i = 0; i < 30; i++) {
            router.route([repeat('accelerate')], to);
        }
        router.route([start('turnLeft')], to);
        for (let i = 0; i < 30; i++) {
            router.route([repeat('turnLeft')], to);
        }
        router.route([release('turnLeft')], to);
        router.route([release('accelerate')], to);

        expect(bridge.records).toEqual([
            [start('accelerate')],
            [start('turnLeft')],
            [release('turnLeft')],
            [release('accelerate')],
        ]);
    });

    it('still delivers every repeat to the UI: a MenuControls list scrolls while the key is held', () => {
        const controlsSubject = new Subject<ControlEvent>();
        let scrolled = 0;
        const menu = new MenuControls(controlsSubject, {
            down: () => scrolled++,
        });
        menu.bind();
        const seen: ControlEvent[] = [];
        const sub = controlsSubject.subscribe(e => seen.push(e));
        try {
            const router = new ControlRouter();
            const bridge = new FakeBridge();
            const to = targets(bridge, controlsSubject);
            router.route([start('down')], to);
            for (let i = 0; i < 10; i++) {
                router.route([repeat('down')], to);
            }
            router.route([release('down')], to);

            expect(scrolled).toBe(11);
            expect(seen.filter(e => e.state === 'repeat').length).toBe(10);
            expect(bridge.records.length).toBe(2);
        } finally {
            sub.unsubscribe();
            menu.release();
        }
    });

    it('emits repeats on the display world too (display-only, never the bridge)', () => {
        const world = new World('control routing display');
        const emitted: ControlEvent[] = [];
        world.events.get(EcsControlEvent).subscribe(
            ({ data }) => emitted.push(...data));
        const router = new ControlRouter();
        const to = targets(new FakeBridge(), new Subject(), world);
        router.route([start('down')], to);
        router.route([repeat('down')], to);
        expect(emitted).toEqual([start('down'), repeat('down')]);
    });

    it('forwards ONE repeat for a key whose press the sim never saw (pressed under a menu)', () => {
        const router = new ControlRouter();
        const bridge = new FakeBridge();
        const to = targets(bridge);
        // The press went to the menu layer only; the menu has closed and
        // the key is still held: the sim learns it is down, once.
        router.route([repeat('accelerate')], to);
        router.route([repeat('accelerate')], to);
        router.route([repeat('accelerate')], to);
        router.route([release('accelerate')], to);
        router.route([repeat('accelerate')], to);

        expect(bridge.records).toEqual([
            [repeat('accelerate')],
            [release('accelerate')],
            [repeat('accelerate')],
        ]);
    });

    it('treats a new bridge (a new system) as knowing nothing about held keys', () => {
        const router = new ControlRouter();
        const first = new FakeBridge();
        const second = new FakeBridge();
        router.route([start('accelerate')], targets(first));
        router.route([repeat('accelerate')], targets(first));
        router.route([repeat('accelerate')], targets(second));
        router.route([repeat('accelerate')], targets(second));

        expect(first.records).toEqual([[start('accelerate')]]);
        expect(second.records).toEqual([[repeat('accelerate')]]);
    });

    it('keeps client-local actions out of every path, and sends nothing for an empty remainder', () => {
        const router = new ControlRouter();
        const bridge = new FakeBridge();
        const seen: ControlEvent[] = [];
        const subject = new Subject<ControlEvent>();
        subject.subscribe(e => seen.push(e));
        const to: ControlRouteTargets = {
            ...targets(bridge, subject),
            consumeLocal: e => e.action === 'toggleFpsMeter',
        };
        router.route([start('toggleFpsMeter')], to);
        router.route([start('toggleFpsMeter'), start('firePrimary')], to);

        expect(seen).toEqual([start('firePrimary')]);
        expect(bridge.records).toEqual([[start('firePrimary')]]);
    });
});
