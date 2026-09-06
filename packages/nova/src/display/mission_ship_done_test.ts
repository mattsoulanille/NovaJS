import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { ControlEvent, ControlsSubject } from '../nova_plugin/core/controls_plugin.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/core/game_data_resource.js';
import { MissionShipComponent } from '../nova_plugin/player/mission_ship_component.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    GOAL_BOARD, GOAL_DESTROY, GOAL_RESCUE, ShipObjective,
} from '../nova_plugin/player/mission_ship_state.js';
import { PlayerShipSelector } from '../nova_plugin/player/player_ship_plugin.js';
import {
    ActiveMission, MissionsComponent,
} from '../nova_plugin/player/player_state_plugin.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import {
    clearShipDoneTextShown, takeShipDoneTextShown,
} from '../spaceport/ship_done_shown.js';
import { boardingDialogPhase } from './boarding_plugin.js';
import {
    boardShipDoneStatus, boardShipDoneStatusOf, MissionShipDonePlugin,
    presentBoardShipDone, presentShipDoneText, ShipDonePopupResource,
} from './mission_ship_done_plugin.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';
import { BoardingState } from '../nova_plugin/ship/boarding_component.js';

/**
 * ============================================================================
 * mïsn ShipDoneText appears WHEN THE GOAL COMPLETES, not at the next landing
 * ============================================================================
 *
 * Matthew's report: the Hyperioid mission's boarding text ("You take one
 * of the hyperioid's pods...") only showed up after landing at the
 * destination stellar — long after the boarding it narrates. The Bible
 * calls the field "the desc to show when you complete the special ship
 * goal", so the moment is the completion, in flight.
 *
 * These are the DISPLAY-side specs: the once-guard, the expansion, the
 * board/rescue hand-off to the boarding dialog, and the promise that the
 * landing does not show the same text a second time. The plug-in and
 * stock end-to-end cases live in mission_ship_done_integration_test.ts.
 *
 * THE ONE STOCK MISSION WITH A ShipDoneText is nova:741, "Rescue Heraan
 * Operatives" (ShipGoal 2, ShipCount 1, no ShipDonePict, EMPTY
 * OnShipDone) — the whole stock mïsn set has exactly one, which is why
 * every text-bearing spec here uses it.
 */

/** A popup that records what it was asked to show and dismisses itself. */
class RecordingPopup {
    readonly shows: { text: string, pict?: string | null }[] = [];
    async show(text: string, _buttons: unknown,
        options: { pict?: string | null } = {}) {
        this.shows.push({ text, pict: options.pict });
        return 'accept' as const;
    }
}

function objective(overrides: Partial<ShipObjective> = {}): ShipObjective {
    return {
        goal: GOAL_BOARD, systemId: 'nova:128', shipStart: 0, behavior: -1,
        dudeId: 'nova:130', total: 1, satisfied: 0, complete: false,
        failed: false, shipDonePending: false, live: new Map(),
        ...overrides,
    };
}

function activeMission(id: string,
    shipObjective: ShipObjective | undefined): ActiveMission {
    return {
        id, acceptedAt: 'nova:128', travelPlanet: null, returnPlanet: null,
        cargoType: -1, cargoQty: 0, cargoLoaded: false, legDone: false,
        deadlineDay: null, failed: false, pickupOnBoard: false,
        ...(shipObjective ? { shipObjective } : {}),
    } as unknown as ActiveMission;
}

describe('boardShipDoneStatus (what a boarding owes the mission text)', () => {
    const playerUuid = 'player';
    const targetUuid = 'special';
    const missionShip = { mission: 'nova:741', owner: playerUuid };

    it('ignores hulls that are not the local player\'s own special ships',
        () => {
            // An ordinary hulk: no MissionShipComponent at all.
            expect(boardShipDoneStatus({
                missionShip: undefined, playerUuid, targetUuid,
                objective: objective(), hasText: true,
            })).toBe('none');
            // Another player's mission ship — their mission, their text.
            expect(boardShipDoneStatus({
                missionShip: { mission: 'nova:741', owner: 'someone-else' },
                playerUuid, targetUuid, objective: objective(),
                hasText: true,
            })).toBe('none');
            // An AuxShip is mission atmosphere, never part of the goal.
            expect(boardShipDoneStatus({
                missionShip: { ...missionShip, aux: true },
                playerUuid, targetUuid, objective: objective(),
                hasText: true,
            })).toBe('none');
        });

    it('only claims the boarding goals', () => {
        for (const goal of [GOAL_BOARD, GOAL_RESCUE]) {
            expect(boardShipDoneStatus({
                missionShip, playerUuid, targetUuid,
                objective: objective({ goal, shipDonePending: true }),
                hasText: true,
            })).withContext(`goal ${goal}`).toBe('show');
        }
        // A destroy goal completes by dying, not by boarding: boarding
        // such a ship is an ordinary plunder, and the sweep system shows
        // its text instead.
        expect(boardShipDoneStatus({
            missionShip, playerUuid, targetUuid,
            objective: objective({
                goal: GOAL_DESTROY, shipDonePending: true,
            }),
            hasText: true,
        })).toBe('none');
    });

    it('holds the plunder dialog back until the simulation answers', () => {
        // The mission data has not loaded yet: hold, rather than raising
        // the plunder dialog for the one hull that must not get one.
        expect(boardShipDoneStatus({
            missionShip, playerUuid, targetUuid,
            objective: objective(), hasText: undefined,
        })).toBe('wait');
        // Loaded, no text at all: nothing will ever be shown, so the
        // ordinary plunder dialog opens immediately.
        expect(boardShipDoneStatus({
            missionShip, playerUuid, targetUuid,
            objective: objective(), hasText: false,
        })).toBe('none');
        // The boarding has not been credited yet.
        expect(boardShipDoneStatus({
            missionShip, playerUuid, targetUuid,
            objective: objective(), hasText: true,
        })).toBe('wait');
    });

    it('stops waiting once the sim says the boarding did not finish the '
        + 'goal', () => {
            // Ship 1 of 3 of a board goal: credited (live[uuid].boarded),
            // goal still outstanding. There is no text for this boarding,
            // so the plunder dialog opens as it always has.
            expect(boardShipDoneStatus({
                missionShip, playerUuid, targetUuid,
                objective: objective({
                    total: 3, satisfied: 1,
                    live: new Map([[targetUuid, { boarded: true }]]),
                }),
                hasText: true,
            })).toBe('none');
            // An already-settled goal (an earlier ship finished it, or it
            // has become unachievable) likewise owes this boarding
            // nothing.
            expect(boardShipDoneStatus({
                missionShip, playerUuid, targetUuid,
                objective: objective({ complete: true }), hasText: true,
            })).toBe('none');
            expect(boardShipDoneStatus({
                missionShip, playerUuid, targetUuid,
                objective: objective({ failed: true }), hasText: true,
            })).toBe('none');
        });
});

describe('the boarding dialog while a ship goal settles', () => {
    const boarding: BoardingState = {
        target: 'special', creditsAvailable: 0, ammoAvailable: 0,
        capture: 'none', cargoTaken: false, creditsTaken: false,
        fuelTaken: false, ammoTaken: false, crimeApplied: false,
    };

    it('shows nothing at all while the goal outcome is in flight', () => {
        // The regression this guards: the plunder table flashing up for a
        // frame and being replaced by the mission text.
        expect(boardingDialogPhase(boarding, false, false, true))
            .toBe('missionWait');
        expect(boardingDialogPhase(boarding, false, false, false))
            .toBe('plunder');
    });

    it('lets a captured ship have its assignment dialog', () => {
        // convertToEscort drops the MissionShipComponent, so a prize is
        // no longer a mission ship and must not be held behind a goal.
        expect(boardingDialogPhase({ ...boarding, capture: 'succeeded' },
            false, false, true)).toBe('capture');
    });

    it('ends the boarding with the text, exactly as an offer does', () => {
        // The text is presented on the same shared popup and through the
        // same two phases, so the boarding is over when it is dismissed.
        expect(boardingDialogPhase(boarding, true, false, false))
            .toBe('offer');
        expect(boardingDialogPhase(boarding, false, true, false))
            .toBe('offerOnly');
    });
});

/** A display world with the local player, wired the way the plugin does
 * but with a recording popup in place of the PIXI one. */
async function displayWorld() {
    const gameData = await getIntegrationGameData();
    // Every text path goes through the shared mission universe; loading
    // it here keeps the specs from having to wait out thousands of
    // resources between world.step()s.
    await MissionUniverse.shared(gameData).load();
    const world = new World();
    world.resources.set(SimulationGameDataResource, gameData);
    world.resources.set(DisplayAssetDataResource, {
        spriteFromPict: () => new PIXI.Sprite(),
    } as unknown as DisplayAssetDataInterface);
    world.resources.set(ControlsSubject, new Subject<ControlEvent>());
    world.resources.set(Stage, new PIXI.Container());
    world.resources.set(ScreenSize, { x: 1920, y: 1080 });
    await world.addPlugin(MissionShipDonePlugin);
    const popup = new RecordingPopup();
    world.resources.set(ShipDonePopupResource,
        popup as unknown as OfferPopup);

    const player = new Entity('player');
    player.components.set(PlayerShipSelector, undefined);
    player.components.set(MissionsComponent, new Map());
    world.entities.set('player', player);
    return { world, player, popup };
}

/** Lets the presentation's awaits (mission universe, player identity)
 * settle; the universe is cached across specs after the first load. */
async function settle(times = 12) {
    for (let i = 0; i < times; i++) {
        await new Promise(resolve => setImmediate(resolve));
    }
}

describe('presenting a ShipDoneText in flight', () => {
    // The popup is a PIXI.Graphics, which needs a canvas: install the
    // headless stub here rather than rely on an earlier spec's install
    // (under some random orders this file runs first).
    beforeAll(() => installHeadlessPixi());
    beforeEach(() => clearShipDoneTextShown());
    afterEach(() => clearShipDoneTextShown());

    it('shows the stock text once, expanded, and tells the landing not to '
        + 'show it again (mïsn nova:741)', async () => {
            const { world, player, popup } = await displayWorld();
            const active = activeMission('nova:741',
                objective({ shipDonePending: true }));
            player.components.get(MissionsComponent)!.set('nova:741', active);

            expect(await presentShipDoneText(world, 'nova:741')).toBeTrue();
            expect(popup.shows.length).toBe(1);
            const shown = popup.shows[0];
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:741');
            expect(mission.shipDoneText).withContext('the spec\'s premise')
                .toContain('unlock the bonds of the Heraan Prisoners');
            // Expanded, not raw: the dësc's carriage returns become
            // newlines and no wildcard is left on screen.
            expect(shown.text).toContain('Heraan Prisoners');
            expect(shown.text).not.toContain('\r');
            expect(shown.text).not.toMatch(/<[A-Z]{2,3}>/);
            // nova:741's dësc has no Graphic, so the popup falls back to
            // the plain briefing frame.
            expect(shown.pict).toBe(mission.shipDonePict);

            // The ONCE-GUARD: the sweep runs every frame, and the
            // rollback driver can raise shipDonePending again.
            expect(await presentShipDoneText(world, 'nova:741')).toBeFalse();
            expect(popup.shows.length).toBe(1);

            // ...and the deferred 'shipDone' event is told to stay quiet,
            // exactly once.
            expect(takeShipDoneTextShown('nova:741')).toBeTrue();
            expect(takeShipDoneTextShown('nova:741')).toBeFalse();
        });

    it('shows nothing for a mission with no ShipDoneText', async () => {
        const { world, player, popup } = await displayWorld();
        // mïsn nova:258, "25000 Credit Bounty": ShipGoal 0, no text.
        player.components.get(MissionsComponent)!.set('nova:258',
            activeMission('nova:258', objective({
                goal: GOAL_DESTROY, shipDonePending: true,
            })));
        expect(await presentShipDoneText(world, 'nova:258')).toBeFalse();
        expect(popup.shows.length).toBe(0);
        expect(takeShipDoneTextShown('nova:258')).toBeFalse();
    });

    it('sweeps non-boarding goals automatically, once', async () => {
        // No stock mission pairs a ShipDoneText with a destroy/disable/
        // observe/chase-off goal, so this drives nova:741's dësc through
        // an objective frozen with a DESTROY goal — which is exactly what
        // an accepted mission carries (the goal code is copied onto the
        // ActiveMission at accept, and the display reads it from there).
        const { world, player, popup } = await displayWorld();
        player.components.get(MissionsComponent)!.set('nova:741',
            activeMission('nova:741', objective({
                goal: GOAL_DESTROY, complete: true, satisfied: 1,
                shipDonePending: true,
            })));
        // The first step warms the mission-data cache; the next raises
        // the popup. Stepping on past it must not raise a second.
        for (let i = 0; i < 5; i++) {
            world.step();
            await settle(4);
        }
        expect(popup.shows.length).toBe(1);
        expect(popup.shows[0].text).toContain('Heraan Prisoners');
        expect(takeShipDoneTextShown('nova:741')).toBeTrue();
    });

    it('leaves boarding goals to the boarding dialog', async () => {
        // The sweep must not race BoardingUi for the same moment: a board
        // goal's text replaces the plunder dialog, so only the boarding
        // dialog may present it.
        const { world, player, popup } = await displayWorld();
        player.components.get(MissionsComponent)!.set('nova:741',
            activeMission('nova:741', objective({
                goal: GOAL_BOARD, complete: true, satisfied: 1,
                shipDonePending: true,
            })));
        for (let i = 0; i < 5; i++) {
            world.step();
            await settle(4);
        }
        expect(popup.shows.length).toBe(0);
        expect(takeShipDoneTextShown('nova:741')).toBeFalse();
    });

    it('presents it for the boarded hull, and only for the owner\'s own',
        async () => {
            const { world, player, popup } = await displayWorld();
            player.components.get(MissionsComponent)!.set('nova:741',
                activeMission('nova:741', objective({
                    goal: GOAL_BOARD, complete: true, satisfied: 1,
                    shipDonePending: true,
                })));
            const ship = new Entity('Heraan prisoners');
            ship.components.set(MissionShipComponent,
                { mission: 'nova:741', owner: 'player' });
            world.entities.set('special', ship);

            // Answered on the spot: the mission has been active since a
            // spaceport, so the mission universe is long since loaded and
            // the boarding dialog never has to wait a frame for it.
            expect(boardShipDoneStatusOf(world, 'special')).toBe('show');

            expect(await presentBoardShipDone(world, 'special')).toBeTrue();
            expect(popup.shows.length).toBe(1);
            expect(popup.shows[0].text).toContain('Heraan Prisoners');

            // Another player's special ship: nothing, ever.
            const theirs = new Entity('their target');
            theirs.components.set(MissionShipComponent,
                { mission: 'nova:741', owner: 'peer' });
            world.entities.set('theirs', theirs);
            expect(boardShipDoneStatusOf(world, 'theirs')).toBe('none');
            expect(await presentBoardShipDone(world, 'theirs')).toBeFalse();
            expect(popup.shows.length).toBe(1);

            // An ordinary hulk with no mission ship component at all.
            world.entities.set('hulk', new Entity('hulk'));
            expect(boardShipDoneStatusOf(world, 'hulk')).toBe('none');
        });
});
