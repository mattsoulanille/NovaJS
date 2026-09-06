import 'jasmine';
import * as PIXI from 'pixi.js';
import { Entity } from 'nova_ecs/entity';
import { TimeResource } from 'nova_ecs/plugins/time_plugin';
import { World } from 'nova_ecs/world';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { SimulationGameDataResource } from '../nova_plugin/core/game_data_resource.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import { ShipComponent } from '../nova_plugin/ship/ship_plugin.js';
import { StatusBar } from './status_bar.js';
import { CARGO_READOUT_PERIOD_MS, DrawStatusBarCargo } from './status_bar_cargo.js';
import { statFullness } from './status_bar_gauges.js';
import { StatusBarResource } from './status_bar_resource.js';
import { TargetPane } from './status_bar_target.js';

/**
 * The stat bars' fullness. A stat whose max is 0 — the stock Escape Pod,
 * shïp nova:895, has shield 0 and armor 0 — used to divide 0 by 0 and
 * hand NaN to the line drawing.
 */
describe('statFullness', () => {
    it('is the current fraction of max', () => {
        expect(statFullness({ current: 50, max: 200 })).toEqual(0.25);
        expect(statFullness({ current: 200, max: 200 })).toEqual(1);
    });

    it('never goes negative', () => {
        expect(statFullness({ current: -5, max: 200 })).toEqual(0);
    });

    it('is an empty bar, not NaN, when there is no max to fill', () => {
        expect(statFullness({ current: 0, max: 0 })).toEqual(0);
        expect(statFullness({ current: 0, max: NaN })).toEqual(0);
    });
});

/**
 * reload() (an ïntf swap while flying) destroys the bar's texts and
 * rebuilds them once the new PICT has loaded. Every draw method has to
 * wait that window out: drawTarget did not, and with a target locked it
 * threw on the first frame — which, with no per-system try/catch in the
 * ECS flush, skipped every later draw system that frame.
 *
 * A target pane in exactly the mid-reload state: constructed (no
 * PIXI.Text is made until build(), so no canvas is needed here) but
 * never built, which is what reload() leaves behind until the new
 * PICT arrives.
 */
describe('StatusBar draw methods mid-reload', () => {
    function unbuiltPane(): TargetPane {
        return new TargetPane({} as PIXI.IRenderer);
    }

    it('drawTarget waits for the rebuild instead of throwing', () => {
        expect(() => unbuiltPane().drawTarget('Shuttle', 50, 50)).not.toThrow();
    });

    it('clearTarget waits for the rebuild instead of throwing', () => {
        expect(() => unbuiltPane().clearTarget()).not.toThrow();
    });
});

/**
 * The in-flight cargo readout walks every entity and sums the fleet's
 * holds for a readout that changes about once a minute, so it is
 * throttled like the radar rather than recomputed every frame.
 */
describe('DrawStatusBarCargo throttle', () => {
    const gameData = {
        data: {
            Ship: {
                getCached: () => ({ inherentAI: 3, physics: { freeCargo: 100 } }),
            },
            Outfit: { getCached: () => undefined },
            Junk: { getCached: () => undefined },
        },
    } as unknown as SimulationGameDataInterface;

    function cargoWorld() {
        const world = new World('cargo readout test');
        const time = { time: 0, delta_ms: 16, delta_s: 0.016 };
        world.resources.set(TimeResource, time as never);
        world.resources.set(SimulationGameDataResource, gameData);
        const drawCargo = jasmine.createSpy('drawCargo');
        world.resources.set(StatusBarResource,
            { cargo: { drawCargo } } as unknown as StatusBar);
        world.addSystem(DrawStatusBarCargo);
        const player = new Entity('player');
        player.components.set(PlayerShipSelector, undefined);
        player.components.set(ShipComponent, { id: 'nova:128' });
        world.entities.set('player', player);
        const stepAt = (ms: number) => {
            time.time = ms;
            world.step();
        };
        return { drawCargo, stepAt };
    }

    it('draws on the first frame', () => {
        const { drawCargo, stepAt } = cargoWorld();
        stepAt(0);
        expect(drawCargo).toHaveBeenCalledTimes(1);
    });

    it('redraws at most once per period', () => {
        const { drawCargo, stepAt } = cargoWorld();
        stepAt(0);
        stepAt(16);
        stepAt(CARGO_READOUT_PERIOD_MS / 2);
        stepAt(CARGO_READOUT_PERIOD_MS - 1);
        expect(drawCargo).toHaveBeenCalledTimes(1);
        stepAt(CARGO_READOUT_PERIOD_MS);
        expect(drawCargo).toHaveBeenCalledTimes(2);
        stepAt(CARGO_READOUT_PERIOD_MS + 16);
        expect(drawCargo).toHaveBeenCalledTimes(2);
        stepAt(3 * CARGO_READOUT_PERIOD_MS);
        expect(drawCargo).toHaveBeenCalledTimes(3);
    });
});
