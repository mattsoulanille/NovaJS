import 'jasmine';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { BoardingState } from '../nova_plugin/ship/boarding_component.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { FuelComponent } from '../nova_plugin/ship/health_plugin.js';
import { ControlledByComponent } from '../nova_plugin/player/ship_control.js';
import { ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { Stat } from '../nova_plugin/core/stat.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { STANDARD_CARGO_NAMES } from '../nova_plugin/missions/mission_logic.js';
import { MAX_ESCORTS_MESSAGE } from '../nova_plugin/escorts/escort_cap.js';
import {
    boardingDialogPhase, cargoKeyDisplayName, plunderDialogContent,
} from './boarding_plugin.js';

/**
 * The plunder dialog's rules, read off the synced boarding state and the
 * victim entity (plunderDialogContent — the pure half of the PIXI widget).
 *
 * The load-bearing case here is Matthew's playtest bug 1: a disabled ship
 * somebody is still FLYING can be robbed but never taken, so the dialog
 * must not offer Capture Ship against one. The dialog reads the same
 * predicate the simulation's capture roll does, off the same synced
 * ControlledByComponent, so the two can never disagree.
 */

const NOTHING_TAKEN = {
    cargoTaken: false, creditsTaken: false, fuelTaken: false,
    ammoTaken: false, crimeApplied: false,
};

function boardingState(overrides: Partial<BoardingState> = {}): BoardingState {
    return {
        target: 'victim', creditsAvailable: 1000, ammoAvailable: 4,
        capture: 'none', ...NOTHING_TAKEN, ...overrides,
    };
}

function victim({ controlled = false, crew = 10 } = {}): Entity {
    const entity = new Entity('victim');
    entity.components.set(ShipDataComponent,
        { ...getDefaultShipData(), crew });
    entity.components.set(CargoComponent, new Map([['Food', 3]]));
    entity.components.set(FuelComponent,
        new Stat({ current: 200, max: 400, min: 0, recharge: 0 }));
    if (controlled) {
        entity.components.set(ControlledByComponent,
            { peerId: 'the other peer' });
    }
    return entity;
}

describe('plunder dialog content', () => {
    it('offers every booty and the capture against an NPC hulk', () => {
        const { enabledByAction, lines } =
            plunderDialogContent(boardingState(), victim(), 100);
        expect(enabledByAction['plunderCargo']).toBeTrue();
        expect(enabledByAction['plunderCredits']).toBeTrue();
        expect(enabledByAction['plunderFuel']).toBeTrue();
        expect(enabledByAction['plunderAmmo']).toBeTrue();
        expect(enabledByAction['plunderCapture']).toBeTrue();
        expect(lines.join('\n')).toContain('Capture Odds:');
    });

    describe('against a ship somebody is flying', () => {
        it('greys Capture Ship but keeps every booty action', () => {
            const { enabledByAction } = plunderDialogContent(
                boardingState(), victim({ controlled: true }), 100);
            expect(enabledByAction['plunderCapture']).toBeFalse();
            // Piracy is still on the menu.
            expect(enabledByAction['plunderCargo']).toBeTrue();
            expect(enabledByAction['plunderCredits']).toBeTrue();
            expect(enabledByAction['plunderFuel']).toBeTrue();
            expect(enabledByAction['plunderAmmo']).toBeTrue();
            expect(enabledByAction['plunderDone']).toBeTrue();
        });

        it('drops the odds readout and says why instead', () => {
            const { lines } = plunderDialogContent(
                boardingState(), victim({ controlled: true }), 100);
            const text = lines.join('\n');
            expect(text).not.toContain('Capture Odds:');
            expect(text).toContain('cannot capture');
        });

        it('greys it even after a hand-forced capture state', () => {
            // The sim can never reach 'succeeded' here; the dialog does
            // not depend on that to keep the action off the menu.
            const { enabledByAction } = plunderDialogContent(
                boardingState({ capture: 'failed' }),
                victim({ controlled: true }), 100);
            expect(enabledByAction['plunderCapture']).toBeFalse();
        });
    });


    /**
     * ========================================================================
     * EVERY ROW IS DATA-DRIVEN (Matthew's ruling)
     * ========================================================================
     *
     * "Every button whose resource the victim doesn't have (no cargo, no
     * credits, no fuel, no compatible ammo, no capture possible) is grey."
     * Each of these greys off state the SIMULATION owns and the delta
     * bridge mirrors here, so the dialog can never offer an action the sim
     * would refuse.
     */
    /**
     * CargoComponent keys are internal ("cargo:<0-5>", "junk:<globalID>",
     * "mission:<id>") and were printed verbatim — "12 tons of cargo:3".
     * The single-commodity line reads the commodity's display name.
     */
    describe('the single-commodity cargo line', () => {
        function holding(key: string, tons: number): Entity {
            const hulk = victim();
            hulk.components.set(CargoComponent, new Map([[key, tons]]));
            return hulk;
        }
        const cargoLine = (entity: Entity,
            cargoName?: (key: string) => string) =>
            plunderDialogContent(boardingState(), entity, 100, cargoName)
                .rows[0].value;

        it('names a standard commodity, never its key', () => {
            const line = cargoLine(holding('cargo:3', 12));
            expect(line).toEqual(`12 tons of ${STANDARD_CARGO_NAMES[3]}`);
            expect(line).not.toContain('cargo:');
        });

        it('names a jünk commodity from the game data', () => {
            const gameData = {
                data: {
                    Junk: {
                        getCached: (id: string) => id === 'nova:128'
                            ? { name: 'Medical Supplies', abbrev: 'Med' }
                            : undefined,
                    },
                },
            } as unknown as SimulationGameDataInterface;
            expect(cargoLine(holding('junk:nova:128', 5),
                key => cargoKeyDisplayName(key, gameData)))
                .toEqual('5 tons of Medical Supplies');
        });

        it('falls back to "cargo" for a jünk whose data is not cached', () => {
            expect(cargoLine(holding('junk:nova:128', 5)))
                .toEqual('5 tons of cargo');
        });

        it('calls mission freight mission cargo', () => {
            expect(cargoLine(holding('mission:nova:700', 8)))
                .toEqual('8 tons of mission cargo');
        });

        it('summarises a mixed hold by tonnage alone', () => {
            const hulk = victim();
            hulk.components.set(CargoComponent,
                new Map([['cargo:0', 4], ['cargo:2', 6]]));
            expect(cargoLine(hulk)).toEqual('10 tons');
        });
    });

    describe('rows grey off what the victim actually has', () => {
        it('greys Cargo for an empty hold', () => {
            const empty = victim();
            empty.components.set(CargoComponent, new Map());
            expect(plunderDialogContent(boardingState(), empty, 100)
                .enabledByAction['plunderCargo']).toBeFalse();
            // ...and says so in the readout.
            expect(plunderDialogContent(boardingState(), empty, 100)
                .lines.join('\n')).toContain('Cargo:  None');
        });

        it('greys Credits when the money booty is zero', () => {
            expect(plunderDialogContent(
                boardingState({ creditsAvailable: 0 }), victim(), 100)
                .enabledByAction['plunderCredits']).toBeFalse();
        });

        it('greys Energy for a dry tank', () => {
            const dry = victim();
            dry.components.set(FuelComponent,
                new Stat({ current: 0, max: 400, min: 0, recharge: 0 }));
            expect(plunderDialogContent(boardingState(), dry, 100)
                .enabledByAction['plunderFuel']).toBeFalse();
        });

        it('greys Ammo when nothing aboard fits the boarder\'s launchers',
            () => {
                // ammoAvailable is the sim's own planAmmoPlunder sum,
                // frozen at board time — the dialog never re-derives it.
                expect(plunderDialogContent(
                    boardingState({ ammoAvailable: 0 }), victim(), 100)
                    .enabledByAction['plunderAmmo']).toBeFalse();
            });

        it('greys Capture for a boarder with no crew to send', () => {
            // Bible, shïp Crew: "Ships with 0 crew can't be boarded, nor
            // can they capture any other ships."
            const { enabledByAction, lines } =
                plunderDialogContent(boardingState(), victim(), 0);
            expect(enabledByAction['plunderCapture']).toBeFalse();
            expect(lines.join('\n')).not.toContain('Capture Odds:');
            expect(lines.join('\n')).toContain('no crew to send');
        });

        it('greys everything at once when there is nothing left to take',
            () => {
                const stripped = victim();
                stripped.components.set(CargoComponent, new Map());
                stripped.components.set(FuelComponent,
                    new Stat({ current: 0, max: 400, min: 0, recharge: 0 }));
                const { enabledByAction } = plunderDialogContent(
                    boardingState({
                        creditsAvailable: 0, ammoAvailable: 0,
                        capture: 'failed',
                    }), stripped, 100);
                for (const action of ['plunderCargo', 'plunderCredits',
                    'plunderFuel', 'plunderAmmo', 'plunderCapture']) {
                    expect(enabledByAction[action])
                        .withContext(action).toBeFalse();
                }
                // Leaving is always possible.
                expect(enabledByAction['plunderDone']).toBeTrue();
            });
    });

    /**
     * ONE CAPTURE ATTEMPT (Matthew's ruling). Any state but 'none' means
     * the session's single attempt has been used. A repelled attempt also
     * ENDS the session, so the sim drops BoardingComponent on the same
     * tick and the dialog closes — 'failed' is pinned here as the
     * belt-and-braces rendering of a state nothing should linger in.
     */
    describe('the capture row after the one attempt', () => {
        for (const capture of
            ['failed', 'succeeded', 'assigned'] as const) {
            it(`is grey once capture is '${capture}'`, () => {
                expect(plunderDialogContent(
                    boardingState({ capture }), victim(), 100)
                    .enabledByAction['plunderCapture']).toBeFalse();
            });
        }

        it('still shows the booty rows on a repelled attempt', () => {
            // The rows are independent: what stops the player going back
            // for the cargo is the SESSION ending, not a greyed button.
            const { enabledByAction } = plunderDialogContent(
                boardingState({ capture: 'failed' }), victim(), 100);
            expect(enabledByAction['plunderCargo']).toBeTrue();
            expect(enabledByAction['plunderCapture']).toBeFalse();
        });

    });

    /**
     * THE ESCORT CAP (ruling #250): at MAX_ESCORTS hired-or-captured
     * escorts the Capture option is GREYED — unavailable before any
     * press, with the bar's own STR# 2002 #123 line as the note and no
     * odds to show — while the booty stays on offer. There is no refused
     * state to render any more: nothing happens on a press.
     */
    describe('the capture row at the escort cap', () => {
        it('greys Capture, drops the odds, and says why, with the booty '
            + 'still on offer', () => {
                const { enabledByAction, notes, rows } = plunderDialogContent(
                    boardingState(), victim(), 100, undefined, true);
                expect(enabledByAction['plunderCapture']).toBeFalse();
                expect(enabledByAction['plunderCargo']).toBeTrue();
                expect(enabledByAction['plunderDone']).toBeTrue();
                expect(notes).toEqual([MAX_ESCORTS_MESSAGE]);
                expect(rows[3].rightLabel).toBeUndefined();
            });

        it('lights Capture under the cap, exactly as before', () => {
            const { enabledByAction, notes } = plunderDialogContent(
                boardingState(), victim(), 100, undefined, false);
            expect(enabledByAction['plunderCapture']).toBeTrue();
            expect(notes).toEqual([]);
        });

        it('lets the other reasons speak first: a flown ship is "cannot '
            + 'capture" whether or not the fleet is full', () => {
                const flown = victim();
                flown.components.set(ControlledByComponent,
                    { peerId: 'someone' });
                const { notes } = plunderDialogContent(
                    boardingState(), flown, 100, undefined, true);
                expect(notes).toEqual(
                    ['Her captain still holds the bridge: cannot capture.']);
            });
    });

    it('greys a booty already taken, and Capture after it succeeded', () => {
        const { enabledByAction } = plunderDialogContent(
            boardingState({ cargoTaken: true, capture: 'succeeded' }),
            victim(), 100);
        expect(enabledByAction['plunderCargo']).toBeFalse();
        expect(enabledByAction['plunderCapture']).toBeFalse();
    });
});
