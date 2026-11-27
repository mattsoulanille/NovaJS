import 'jasmine';
import { World } from 'nova_ecs/world';
import { Subject } from 'rxjs';
import { ControlEvent, EcsControlEvent } from '../nova_plugin/core/index.js';
import { MenuControls } from '../spaceport/menu_controls.js';
import { ARRIVAL_GATE_MAX_MS, ControlRouter, ControlRouteTargets } from './control_routing.js';

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

    describe('the held-j route jump', () => {
        /** A router whose ORIGIN arrival is long decided, with j pressed
         * there (the jump that brings the ship to `destination`). */
        function afterJump(origin: FakeBridge) {
            const router = new ControlRouter();
            let now = 0;
            const at = (bridge: FakeBridge) => ({ ...targets(bridge), now });
            const frame = (bridge: FakeBridge, hidden: boolean) => {
                now += 17;
                router.frame({
                    bridge, arrivalHidden: hidden, send: call => void call, now,
                });
            };
            frame(origin, false);
            frame(origin, false);
            for (let i = 0; i < 4; i++) {
                frame(origin, false);
            }
            router.route([start('hyperjump')], at(origin));
            return {
                router, frame, at,
                /** Frames until the arrival is decided. */
                show(bridge: FakeBridge) {
                    for (let i = 0; i < 6; i++) {
                        frame(bridge, false);
                    }
                },
            };
        }
        const pressed = (bridge: FakeBridge) => bridge.records.flat()
            .filter(event => event.action === 'hyperjump'
                && event.state !== false);

        it('a press in a long-visible system goes straight through', () => {
            const origin = new FakeBridge();
            afterJump(origin);
            expect(origin.records).toEqual([[start('hyperjump')]]);
        });

        it('does not re-assert a held jump key to a new system while its arrival is hidden, nor once it shows if the key was let go', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { router, frame, at, show } = afterJump(origin);
            // Arrived, still behind the flash: repeats go nowhere...
            frame(destination, true);
            router.route([repeat('hyperjump')], at(destination));
            frame(destination, true);
            router.route([repeat('hyperjump')], at(destination));
            // ...and the key is let go before the player sees the system.
            router.route([release('hyperjump')], at(destination));
            show(destination);
            expect(pressed(destination)).toEqual([]);
        });

        it('re-asserts a key still down once the arrival has shown: holding through keeps chaining', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { router, frame, at, show } = afterJump(origin);
            frame(destination, true);
            router.route([repeat('hyperjump')], at(destination));
            show(destination);
            router.route([repeat('hyperjump')], at(destination));
            expect(destination.records).toEqual([[repeat('hyperjump')]]);
        });

        it('needs no auto-repeat to re-assert it', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { frame, show } = afterJump(origin);
            frame(destination, true);
            frame(destination, true);
            show(destination);
            expect(destination.records).toEqual([[repeat('hyperjump')]]);
        });

        it('decides only after the first frame that shows the arrival: a release queued behind that frame wins', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { router, frame, at, show } = afterJump(origin);
            frame(destination, true);
            // The long first frame: the flash clears inside it...
            frame(destination, false);
            // ...and the key events the player made during it come after.
            router.route([repeat('hyperjump')], at(destination));
            router.route([repeat('hyperjump')], at(destination));
            router.route([release('hyperjump')], at(destination));
            show(destination);
            expect(pressed(destination)).toEqual([]);
        });

        it('drops a tap on the white screen, and takes a press there that is still held', () => {
            const origin = new FakeBridge();
            const tapped = new FakeBridge();
            const { router, frame, at, show } = afterJump(origin);
            router.route([release('hyperjump')], { ...targets(undefined) });
            frame(tapped, true);
            router.route([start('hyperjump')], at(tapped));
            router.route([release('hyperjump')], at(tapped));
            show(tapped);
            expect(pressed(tapped)).toEqual([]);

            const held = new FakeBridge();
            frame(held, true);
            router.route([start('hyperjump')], at(held));
            show(held);
            expect(pressed(held)).toEqual([repeat('hyperjump')]);
        });

        it('forgets the key when the window loses focus (no key-up will come)', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { router, frame, show } = afterJump(origin);
            router.releaseKeys();
            frame(destination, true);
            show(destination);
            expect(pressed(destination)).toEqual([]);
        });

        it('leaves every other key alone, hidden or not', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { router, frame, at } = afterJump(origin);
            frame(destination, true);
            router.route([repeat('accelerate')], at(destination));
            router.route([start('firePrimary')], at(destination));
            expect(destination.records).toEqual([
                [repeat('accelerate')], [start('firePrimary')]]);
        });

        it('decides anyway if the flash never reports clear', () => {
            const origin = new FakeBridge();
            const destination = new FakeBridge();
            const { frame } = afterJump(origin);
            for (let i = 0; i < Math.ceil(ARRIVAL_GATE_MAX_MS / 17) + 6; i++) {
                frame(destination, true);
            }
            expect(destination.records).toEqual([[repeat('hyperjump')]]);
        });
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
