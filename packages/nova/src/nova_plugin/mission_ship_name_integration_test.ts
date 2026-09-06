import 'jasmine';
import {
    getIntegrationGameData, getPluginGameData,
} from '../communication/simulation_test_fixture.js';
import { MissionSession } from '../spaceport/mission_session.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { makeShip } from './make_ship.js';
import { startMissionById } from './mission_logic.js';
import { buildMissionShipSpawns } from './mission_ship_spawn.js';
import { MissionShipComponent } from './mission_ship_component.js';
import { ControlBitsComponent } from './ncb_plugin.js';
import {
    CreditsComponent, GameDateComponent, MissionsComponent,
} from './player_state_plugin.js';
import { GameDataAggregator } from '../server/parsing/game_data_aggregator.js';

/**
 * mïsn ShipNameID / ShipSubtitle end to end, against real resources:
 * from the STR# list the parser resolves, through the pick frozen on
 * the ActiveMission at accept, onto the MissionShipComponent that the
 * spawned ship carries into the world — which is the component the
 * target pane and the hail dialog read (target_identity.ts).
 *
 * The bug this pins: the name only ever reached Entity.name, a
 * debugging label that is not serializer-registered and so never
 * crosses into the display world. Ships spawned by the stock bounty
 * missions and by third-party missions alike showed nothing but their
 * ship class, while the briefing named them.
 */
async function acceptAndSpawn(gameData: GameDataAggregator,
    missionId: string) {
    const universe = MissionUniverse.shared(gameData);
    await universe.load();
    const start = await gameData.data.PlayerStart.get('nova:128');
    const shipData = await gameData.data.Ship.get(start.ship);
    const entity = makeShip(shipData);
    entity.components.set(GameDateComponent, { ...start.date });
    entity.components.set(CreditsComponent, { credits: start.credits });
    entity.components.set(ControlBitsComponent, new Set([0]));

    const session = await MissionSession.create(
        entity, gameData, universe, 'nova:128');
    startMissionById(session.machinery, missionId);
    session.commit();
    const active = entity.components.get(MissionsComponent)!.get(missionId)!;
    const ships = await buildMissionShipSpawns(entity, 'owner',
        active.shipObjective!.systemId!, gameData, universe);
    return { entity, active, ships, universe };
}

describe('mission special ships wear their mïsn-given name', () => {
    /**
     * The recurring bounty-hunter missions. mïsn nova:258 ("25000
     * Credit Bounty;Bounty Hunter1a") is the repeatable one offered
     * from the mission computer once you have joined the Guild:
     * ShipCount 1, ShipGoal 0 (destroy), ShipDude nova:251, and a
     * ShipNameID pointing at STR# nova:25000, "Auroran Warships"
     * (Dechanik, Blood Honor, Frunch'eck, ...). Its QuickBrief says
     * "Locate and destroy the <SN>", so the ship in the system has to
     * BE that <SN>.
     */
    it('spawns the stock bounty target under the name <SN> expands to '
        + '(mïsn nova:258)', async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:258');
            const nameList = await gameData.data.StringTable.get('nova:25000');
            expect(nameList.name).toBe('Auroran Warships');
            expect(mission.shipNames).toEqual(nameList.strings);
            expect(mission.quickBrief).toContain('destroy the <SN>');

            const { active, ships } = await acceptAndSpawn(gameData,
                'nova:258');
            expect(nameList.strings).toContain(active.shipName!);
            expect(ships.length).toBe(1);
            // The whole point: the name is on the SYNCED component, not
            // just on the entity's debugging label.
            expect(ships[0].components.get(MissionShipComponent)!.name)
                .toBe(active.shipName);
        });

    /**
     * mïsn nova:685 ("Assassinate Krane;Auroran 028") is the mirror
     * case: ShipNameID -1, but a ShipSubtitle STR# (nova:25024) that
     * subtitles the target "Krane". Its QuickBrief still writes "<SN>",
     * which the Bible's own note says the original gets wrong; what
     * identifies the ship in the system is the subtitle.
     */
    it('subtitles a special ship from ShipSubtitle even when it has no '
        + 'name (mïsn nova:685)', async () => {
            const gameData = await getIntegrationGameData();
            const mission = await gameData.data.Mission.get('nova:685');
            expect(mission.shipNames).toEqual([]);
            expect(mission.shipSubtitles).toContain('Krane');

            const { active, ships } = await acceptAndSpawn(gameData,
                'nova:685');
            expect(active.shipName).toBeUndefined();
            expect(active.shipSubtitle).toBe('Krane');
            // The mission also flies aux ships (atmosphere), which the
            // Bible gives no names or subtitles.
            const tagged = ships.map(
                s => s.components.get(MissionShipComponent)!);
            const special = tagged.filter(t => !t.aux);
            expect(special.length).toBe(1);
            expect(special[0].name).toBeUndefined();
            expect(special[0].subtitle).toBe('Krane');
            expect(tagged.filter(t => t.aux).length).toBeGreaterThan(0);
            for (const aux of tagged.filter(t => t.aux)) {
                expect(aux.subtitle).toBeUndefined();
            }
        });

    /**
     * A THIRD-PARTY mission, to prove the STR# lookup follows the
     * plug-in's own id space rather than falling through to the base
     * game's. "More Blasters CHEAT" adds mïsn 1000/1001 ("Take
     * Hyperioid sample", from the bar and from the mission BBS): one
     * special ship, ShipGoal 2 (board), with a ShipNameID pointing at
     * the plug-in's private STR# 25077 — which does not exist in the
     * stock data at all. Both missions must come out named "Hyper
     * Target", and the id must be namespaced to the plug-in.
     */
    it("resolves a plug-in mission's ShipNameID inside the plug-in's own "
        + 'id space (More Blasters CHEAT)', async () => {
            const gameData = await getPluginGameData('More Blasters CHEAT');
            if (!gameData) {
                pending('More Blasters CHEAT plug-in not installed');
                return;
            }
            const nameList = await gameData.data.StringTable
                .get('More Blasters CHEAT:25077');
            expect(nameList.name).toBe('Hyper Target');
            expect(nameList.strings.length).toBe(10);
            expect(new Set(nameList.strings)).toEqual(new Set(['Hyper Target']));

            for (const id of ['More Blasters CHEAT:1000',
                'More Blasters CHEAT:1001']) {
                const mission = await gameData.data.Mission.get(id);
                expect(mission.name).toContain('Take Hyperioid sample');
                expect(mission.shipCount).toBe(1);
                // A real STR# entry, not an empty list from a missed
                // lookup — the plug-in's 25077 is not a stock id.
                expect(mission.shipNames).toEqual(nameList.strings);
            }

            const { active, ships } = await acceptAndSpawn(gameData,
                'More Blasters CHEAT:1000');
            expect(active.shipName).toBe('Hyper Target');
            expect(ships.length).toBe(1);
            expect(ships[0].components.get(MissionShipComponent)!.name)
                .toBe('Hyper Target');
        });

    /**
     * Multi-hop: chase the bounty target out of its system and back,
     * and it is still the same named ship. The ships are rebuilt from
     * the frozen ActiveMission on every system entry, so nothing is
     * re-rolled — which is also why every client agrees on the name.
     */
    it('keeps the name across system re-entries', async () => {
        const gameData = await getIntegrationGameData();
        const { entity, active, universe } = await acceptAndSpawn(gameData,
            'nova:258');
        const systemId = active.shipObjective!.systemId!;
        const seen = new Set<string | undefined>();
        for (let i = 0; i < 4; i++) {
            const ships = await buildMissionShipSpawns(entity, 'owner',
                systemId, gameData, universe);
            for (const ship of ships) {
                seen.add(ship.components.get(MissionShipComponent)?.name);
            }
        }
        expect([...seen]).toEqual([active.shipName]);
    });
});
