import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { World } from 'nova_ecs/world';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { v4 } from 'uuid';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { BoardedComponent } from '../nova_plugin/boarding_component.js';
import { ControlEvent, ControlsSubject } from '../nova_plugin/controls_plugin.js';
import { completeEntity } from '../nova_plugin/entity_data_loader.js';
import {
    DisplayAssetDataResource, SimulationGameDataResource,
} from '../nova_plugin/game_data_resource.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { startMissionById } from '../nova_plugin/mission_logic.js';
import { buildMissionShipSpawns } from '../nova_plugin/mission_ship_spawn.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
    PendingMissionNoticesComponent,
} from '../nova_plugin/player_state_plugin.js';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';
import {
    advanceEntityDate, MissionSession,
} from '../spaceport/mission_session.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { OfferPopup } from '../spaceport/offer_popup.js';
import { installHeadlessPixi } from '../spaceport/headless_pixi_fixture.js';
import { clearShipDoneTextShown } from '../spaceport/ship_done_shown.js';
import {
    boardShipDoneStatusOf, MissionShipDonePlugin, presentBoardShipDone,
    ShipDonePopupResource,
} from './mission_ship_done_plugin.js';
import { ScreenSize } from './screen_size_plugin.js';
import { Stage } from './stage_resource.js';

/**
 * ============================================================================
 * BOARDING THE SPECIAL SHIP SHOWS THE MISSION TEXT, AND LANDING DOES NOT
 * REPEAT IT
 * ============================================================================
 *
 * Matthew's report, verbatim in shape: "On missions about boarding ships
 * ... the Hyperioid mission showed its boarding mission text only when I
 * landed at the destination stellar." mïsn ShipDoneText is "the desc to
 * show when you complete the special ship goal" (EVN Bible), so the
 * moment is the boarding.
 *
 * Both cases here run the WHOLE chain against real resource data:
 *
 *   accept the mission -> spawn its special ship into its own system ->
 *   board it in the shared simulation (which raises shipDonePending) ->
 *   the owner's DISPLAY presents the ShipDoneText -> the next date
 *   advance runs OnShipDone and does NOT queue the text a second time.
 *
 * The last step is the half that would regress silently: the deferred
 * pass still builds a 'shipDone' event, and the spaceport still renders
 * one, so each case also runs the same landing WITHOUT the in-flight
 * presentation and pins that the text does appear there — the fallback
 * for a client that never got to show it.
 */

const HYPERIOID_PLUGIN = 'More Blasters CHEAT';
/** "Take Hyperioid sample;from bar": ShipGoal 2, ShipCount 1, in NGC-1317
 * (nova:500), with a ShipDoneText AND a ShipDonePict. */
const HYPERIOID_MISSION = `${HYPERIOID_PLUGIN}:1000`;
/**
 * "Rescue Heraan Operatives": the ONLY stock mïsn with a ShipDoneText.
 * ShipGoal 2 (board), ShipCount 1, düde nova:130, sÿst nova:138, no
 * ShipDonePict, and an EMPTY OnShipDone.
 */
const STOCK_MISSION = 'nova:741';

/** A popup that records what it was asked to show and dismisses itself. */
class RecordingPopup {
    readonly shows: { text: string, pict?: string | null }[] = [];
    async show(text: string, _buttons: unknown,
        options: { pict?: string | null } = {}) {
        this.shows.push({ text, pict: options.pict });
        return 'accept' as const;
    }
}

/**
 * Accepts `missionId` on a fresh pilot at the stock starting stellar and
 * spawns its special ships, exactly as the owner's client does on
 * entering their system. (The same opening
 * mission_ship_hold_integration_test uses.)
 */
async function acceptAndSpawn(gameData: GameDataAggregator,
    missionId: string) {
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const start = await gameData.data.PlayerStart.get('nova:128');
    const shipData = await gameData.data.Ship.get(start.ship);
    const owner = makeShip(shipData);
    owner.components.set(GameDateComponent, { ...start.date });
    owner.components.set(CreditsComponent, { credits: start.credits });
    owner.components.set(ControlBitsComponent, new Set([0]));

    const session = await MissionSession.create(
        owner, gameData, universe, 'nova:128');
    startMissionById(session.machinery, missionId);
    session.commit();
    const active = owner.components.get(MissionsComponent)!.get(missionId)!;
    const systemId = active.shipObjective!.systemId!;
    const ships = await buildMissionShipSpawns(owner, 'owner',
        systemId, gameData, universe);
    return { owner, active, ships, systemId, universe };
}

/**
 * Runs the real simulation far enough for the owner's boarding of the
 * special ship to be credited to the goal, and returns the owner entity
 * (now carrying shipDonePending) with the boarded hull's uuid.
 */
async function boardTheSpecialShip(gameData: GameDataAggregator,
    missionId: string) {
    const { owner, ships, systemId, universe } =
        await acceptAndSpawn(gameData, missionId);
    const world = await makeSystem(systemId, gameData, undefined,
        { npcs: false });
    owner.components.set(MultiplayerData, { owner: 'owner' });
    await completeEntity(world, owner);
    world.entities.set('owner', owner);
    expect(ships.length).withContext('one special ship').toBe(1);
    const shipUuid = v4();
    ships[0].components.set(MultiplayerData, { owner: 'owner' });
    await completeEntity(world, ships[0]);
    world.entities.set(shipUuid, ships[0]);

    // The durable record BoardingGateSystem stamps the instant a plunder
    // session opens; MissionShipTrackSystem credits the goal off it.
    world.entities.get(shipUuid)!.components.set(BoardedComponent,
        { boarder: 'owner', plundered: true });
    for (let i = 0; i < 5; i++) {
        world.step();
    }
    const objective = world.entities.get('owner')!.components
        .get(MissionsComponent)!.get(missionId)!.shipObjective!;
    expect(objective.complete).withContext('the board goal completed')
        .toBeTrue();
    expect(objective.shipDonePending)
        .withContext('OnShipDone/ShipDoneText are due').toBeTrue();
    return {
        owner: world.entities.get('owner')!, shipUuid,
        shipEntity: world.entities.get(shipUuid)!, universe, gameData,
    };
}

/** A display world holding the owner (as the LOCAL player) and the hull
 * they just boarded, with a recording popup in place of the PIXI one. */
async function displayWorldFor(gameData: GameDataAggregator, owner: Entity,
    shipUuid: string, shipEntity: Entity) {
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
    // The display world's mirror of the player is the same entity here;
    // only its components are read.
    owner.components.set(PlayerShipSelector, undefined);
    world.entities.set('owner', owner);
    world.entities.set(shipUuid, shipEntity);
    return { world, popup };
}

/** The 'shipDone' notices the next date advance queued for the spaceport. */
function shipDoneNotices(owner: Entity) {
    return (owner.components.get(PendingMissionNoticesComponent) ?? [])
        .filter(notice => notice.type === 'shipDone');
}

describe('a mission ship goal completing in flight', () => {
    // The popup is a PIXI.Graphics, which needs a canvas: install the
    // headless stub here rather than rely on an earlier spec's install
    // (under some random orders this file runs first).
    beforeAll(() => installHeadlessPixi());
    beforeEach(() => clearShipDoneTextShown());
    afterEach(() => clearShipDoneTextShown());

    it('shows the Hyperioid text on the boarding, and the landing does not '
        + `repeat it (${HYPERIOID_MISSION})`, async () => {
            const gameData = await getPluginGameData(HYPERIOID_PLUGIN);
            if (!gameData) {
                pending('More Blasters CHEAT plug-in not installed');
                return;
            }
            const mission =
                await gameData.data.Mission.get(HYPERIOID_MISSION);
            // The premise: a board goal whose text is the boarding.
            expect(mission.shipGoal).toBe(2);
            expect(mission.shipDoneText)
                .toContain("You take one of the hyperioid's pods");
            expect(mission.shipDonePict).toBe(`${HYPERIOID_PLUGIN}:6392`);

            const { owner, shipUuid, shipEntity, universe } =
                await boardTheSpecialShip(gameData, HYPERIOID_MISSION);
            const { world, popup } = await displayWorldFor(gameData, owner,
                shipUuid, shipEntity);

            // The boarding dialog asks whose ship this is and whether it
            // owes a text; the answer is "show it instead of the plunder
            // table".
            expect(boardShipDoneStatusOf(world, shipUuid)).toBe('show');
            expect(await presentBoardShipDone(world, shipUuid)).toBeTrue();
            expect(popup.shows.length).toBe(1);
            expect(popup.shows[0].text)
                .toContain("You take one of the hyperioid's pods");
            // With its dësc picture (the plug-in's own PICT 6392).
            expect(popup.shows[0].pict).toBe(`${HYPERIOID_PLUGIN}:6392`);

            // A second frame's worth of asking shows nothing more (the
            // once-guard; the sweep and a rollback both re-enter here).
            expect(await presentBoardShipDone(world, shipUuid)).toBeFalse();
            expect(popup.shows.length).toBe(1);

            // NOW LAND. The deferred pass runs OnShipDone (empty for this
            // mission) and clears the flag — but must not queue the text
            // the player already read in space.
            await advanceEntityDate(owner, 1, universe, gameData);
            expect(owner.components.get(MissionsComponent)!
                .get(HYPERIOID_MISSION)!.shipObjective!.shipDonePending)
                .withContext('OnShipDone has run').toBeFalse();
            expect(shipDoneNotices(owner)).toEqual([]);
        }, 180_000);

    it('still shows the Hyperioid text at the landing when the client never '
        + 'got to show it in flight', async () => {
            // The fallback: the player quit between the boarding and the
            // next date advance, so nothing marked the text as read.
            const gameData = await getPluginGameData(HYPERIOID_PLUGIN);
            if (!gameData) {
                pending('More Blasters CHEAT plug-in not installed');
                return;
            }
            const { owner, universe } =
                await boardTheSpecialShip(gameData, HYPERIOID_MISSION);
            await advanceEntityDate(owner, 1, universe, gameData);
            const notices = shipDoneNotices(owner);
            expect(notices.length).toBe(1);
            expect(notices[0].text)
                .toContain("You take one of the hyperioid's pods");
        }, 180_000);

    it('does the same for the one stock mission that has a ShipDoneText '
        + `(${STOCK_MISSION}, "Rescue Heraan Operatives")`, async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get(STOCK_MISSION);
            expect(mission.shipGoal).toBe(2);
            expect(mission.shipCount).toBe(1);
            expect(mission.shipDoneText)
                .toContain('unlock the bonds of the Heraan Prisoners');
            expect(mission.onShipDone)
                .withContext('nothing deferred is observable here').toBe('');

            const { owner, shipUuid, shipEntity, universe } =
                await boardTheSpecialShip(gameData, STOCK_MISSION);
            const { world, popup } = await displayWorldFor(gameData, owner,
                shipUuid, shipEntity);

            expect(boardShipDoneStatusOf(world, shipUuid)).toBe('show');
            expect(await presentBoardShipDone(world, shipUuid)).toBeTrue();
            expect(popup.shows.length).toBe(1);
            expect(popup.shows[0].text)
                .toContain('unlock the bonds of the Heraan Prisoners');

            await advanceEntityDate(owner, 1, universe, gameData);
            expect(owner.components.get(MissionsComponent)!
                .get(STOCK_MISSION)!.shipObjective!.shipDonePending)
                .toBeFalse();
            expect(shipDoneNotices(owner)).toEqual([]);
        }, 180_000);

    it('queues the stock text at the landing when it was never shown',
        async () => {
            const gameData = await getIntegrationGameData();
            const { owner, universe } =
                await boardTheSpecialShip(gameData, STOCK_MISSION);
            await advanceEntityDate(owner, 1, universe, gameData);
            const notices = shipDoneNotices(owner);
            expect(notices.length).toBe(1);
            expect(notices[0].text)
                .toContain('unlock the bonds of the Heraan Prisoners');
        }, 180_000);
});
