import 'jasmine';
import { getDefaultShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import {
    BoardingState, CargoComponent, FuelComponent, ShipDataComponent,
} from '../nova_plugin/ship/index.js';
import { ControlledByComponent } from '../nova_plugin/player/index.js';
import { GovtComponent, Stat } from '../nova_plugin/core/index.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { STANDARD_CARGO_NAMES } from '../nova_plugin/missions/index.js';
import { MAX_ESCORTS_MESSAGE } from '../nova_plugin/escorts/index.js';
import {
    boardingDialogPhase, CAPTURE_PROMPT_BUTTONS, CAPTURE_PROMPT_INDEX,
    CAPTURE_PROMPT_STRING_TABLE, CAPTURE_PROMPT_TEXT, cargoKeyDisplayName,
    plunderDialogContent,
} from './boarding_plugin.js';
import {
    captureAssignedMessage,
} from './status_bar_content.js';

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
        captureOdds: 13, capture: 'none', ...NOTHING_TAKEN, ...overrides,
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

    it('shows the board\'s own drawn odds, not the table\'s mean', () => {
        // Reference "Capture odds, wave 31": one crew-50 hulk read 11, 17,
        // 13, 10, 14% on five boards. The figure is the session's, the
        // very number the simulation rolls against.
        for (const captureOdds of [11, 17]) {
            const { rows } = plunderDialogContent(
                boardingState({ captureOdds }), victim({ crew: 50 }), 10);
            expect(rows[3].rightValue).toEqual(`${captureOdds}%`);
        }
    });

    /**
     * Ruling #378 ("U9 wave 8", item 5): every board of a derelict-govt
     * hulk on the original read "Capture Odds: 0%" with Capture Ship
     * greyed and nothing else said; the booty stays on offer.
     */
    describe('against a DERELICT (gövt Flags1 0x0800)', () => {
        const lookupGovt = (id: string) => id === 'derelict govt'
            ? { flags: { startsDisabled: true } }
            : { flags: { startsDisabled: false } };
        function derelict(govt = 'derelict govt'): Entity {
            const entity = victim({ crew: 1 });
            entity.components.set(GovtComponent, { id: govt });
            return entity;
        }

        it('shows 0% and greys Capture Ship, with no note', () => {
            const { enabledByAction, rows, notes } = plunderDialogContent(
                boardingState(), derelict(), 500, undefined, false,
                lookupGovt);
            expect(enabledByAction['plunderCapture']).toBeFalse();
            expect(rows[3].rightLabel).toEqual('Capture Odds:');
            expect(rows[3].rightValue).toEqual('0%');
            expect(notes).toEqual([]);
            expect(enabledByAction['plunderCredits']).toBeTrue();
            expect(enabledByAction['plunderCargo']).toBeTrue();
        });

        it('a hulk of an ordinary govt shows the board\'s odds', () => {
            // Crew 10 against crew 1: the 75% cap, as the sim drew it.
            const { enabledByAction, rows } = plunderDialogContent(
                boardingState({ captureOdds: 75 }), derelict('live govt'),
                10, undefined, false, lookupGovt);
            expect(enabledByAction['plunderCapture']).toBeTrue();
            expect(rows[3].rightValue).toEqual('75%');
        });
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

        it('reads None for credits and ammo once they are taken', () => {
            const taken = plunderDialogContent(boardingState({
                creditsAvailable: 591_000, creditsTaken: true,
                ammoAvailable: 12, ammoTaken: true,
            }), victim(), 100);
            const text = taken.lines.join('\n');
            expect(text).toContain('Credits:  None');
            expect(text).toContain('Ammo:  None');
            expect(text).not.toContain('591,000');
            expect(taken.enabledByAction['plunderCredits']).toBeFalse();
            const untaken = plunderDialogContent(boardingState({
                creditsAvailable: 591_000, ammoAvailable: 12,
            }), victim(), 100).lines.join('\n');
            expect(untaken).toContain('591,000');
            expect(untaken).toContain('Ammo:  12');
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

/**
 * The capture prompt (space/capture_assignment.png; reference "Capture,
 * wave 33"): the stock question, Use As My Ship over Use As Escort, and no
 * third button. The geometry is pinned in spaceport/hail_layout_test.ts.
 */
describe('the capture prompt', () => {
    it('asks the stock question (STR# 2002 0-based 117)', () => {
        expect(CAPTURE_PROMPT_STRING_TABLE).toEqual('nova:2002');
        expect(CAPTURE_PROMPT_INDEX).toEqual(117);
        expect(CAPTURE_PROMPT_TEXT).toEqual('Do you want to use this ship '
            + 'as an escort, or would you rather trade places with its '
            + 'captain and use it as your own ship?');
    });

    it('offers Use As My Ship over Use As Escort, and nothing else', () => {
        expect(CAPTURE_PROMPT_BUTTONS.map(b => [b.label, b.action])).toEqual([
            ['Use As My Ship', 'plunderCaptureShip'],
            ['Use As Escort', 'plunderCaptureEscort'],
        ]);
    });

    it('is up, over the plunder dialog, only while the capture stands', () => {
        const boarding = {
            target: 't', creditsAvailable: 0, ammoAvailable: 0,
            captureOdds: 75, cargoTaken: false, creditsTaken: false,
            fuelTaken: false, ammoTaken: false, crimeApplied: true,
        };
        expect(boardingDialogPhase({ ...boarding, capture: 'succeeded' },
            false)).toEqual('capture');
        expect(boardingDialogPhase({ ...boarding, capture: 'none' }, false))
            .toEqual('plunder');
    });

    it('answers on the status line with the stock lines (GUESS)', () => {
        expect(captureAssignedMessage('escort', false))
            .toEqual('You assigned this ship to your fleet of escorts.');
        expect(captureAssignedMessage('ship', true))
            .toEqual('You retained your old ship as an escort.');
        expect(captureAssignedMessage('ship', false))
            .toEqual('You were unable to retain your old ship as an escort.');
    });
});
