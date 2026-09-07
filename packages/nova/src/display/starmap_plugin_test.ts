import 'jasmine';
import { MockGameData } from 'novadatainterface/mock_game_data';
import { getDefaultMissionData } from 'novadatainterface/mission_data';
import { getDefaultPlanetData } from 'novadatainterface/planet_data';
import { getDefaultSystemData } from 'novadatainterface/system_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { ControlBitsComponent } from '../nova_plugin/ncb/index.js';
import {
    PlayerShipSelector, ActiveMission, MissionsComponent,
} from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import { DockedShip, DockedShipResource } from './docked_ship.js';
import { playerComponent, playerMissionMarks } from './starmap_plugin.js';

/**
 * Review findings #29 and #65: what the in-flight starmap plugin knows
 * about the player.
 *
 * #29 — Landing removes the player's ship from the simulation and hence
 * from the display world, so the plugin's PlayerShipSelector scan came
 * up empty for the whole visit and the DOCKED map was filtered against
 * an empty control-bit set (every bXXX-gated system gone, every !bXXX
 * stacked duplicate back, no Legal Status line). The docked entity is
 * held by DockedShipResource — the handle the status bar already reads —
 * so the lookup falls back to it.
 *
 * #65 — The active-mission marks resolved a stellar's system WITHOUT the
 * player's bits, so a destination stacked in NCB-duplicate systems was
 * marked in the pre-story copy the graph then filtered out: no orange
 * arrow for exactly the storyline missions that unlock new copies.
 */
describe('the starmap plugin\'s view of the player', () => {
    function activeMission(partial: Partial<ActiveMission>): ActiveMission {
        return {
            id: 'nova:737', acceptedDay: 0, acceptedAt: 'nova:128',
            travelPlanet: null, returnPlanet: null, cargoType: -1,
            cargoQty: 0, cargoLoaded: false, travelDone: false,
            deadlineDay: null, ...partial,
        };
    }

    /** Auroran LP I (nova:333) stacked in nova:308 "!b995" / nova:765
     * "b995", the mïsn 737 "Destroy Moash Fleet" shape from stock data. */
    async function stackedUniverse(): Promise<MissionUniverse> {
        const gameData = new MockGameData();
        gameData.data.Mission.map.set('nova:737', {
            ...getDefaultMissionData(), id: 'nova:737',
        });
        gameData.data.Planet.map.set('nova:333', {
            ...getDefaultPlanetData(), id: 'nova:333', name: 'Auroran LP I',
        });
        gameData.data.System.map.set('nova:308', {
            ...getDefaultSystemData(), id: 'nova:308', name: 'SPC-1421',
            planets: ['nova:333'], visibility: '!b995', position: [10, 20],
        });
        gameData.data.System.map.set('nova:765', {
            ...getDefaultSystemData(), id: 'nova:765', name: 'SPC-1421',
            planets: ['nova:333'], visibility: 'b995', position: [10, 20],
        });
        const universe = new MissionUniverse(gameData);
        await universe.load();
        return universe;
    }

    function pilot(bits: number[]): Entity {
        return new Entity('pilot')
            .addComponent(ControlBitsComponent, new Set(bits))
            .addComponent(LegalRecordsComponent, new Map([['nova:128', 5]]))
            .addComponent(MissionsComponent, new Map([['nova:737',
                activeMission({ returnPlanet: 'nova:333' })]]));
    }

    describe('playerComponent', () => {
        it('reads the in-world player ship in flight', () => {
            const world = new World();
            const ship = pilot([9995]);
            ship.components.set(PlayerShipSelector, undefined);
            world.entities.set('ship', ship);
            expect(playerComponent(world, ControlBitsComponent))
                .toEqual(new Set([9995]));
        });

        it('falls back to the DOCKED ship the spaceport is holding (#29)',
            () => {
                const world = new World();
                const docked = pilot([9995]);
                // Out of the world, exactly as browser.ts leaves it while
                // landed; only the docked handle knows it.
                world.resources.set(DockedShipResource,
                    { current: new DockedShip(docked) });
                expect(playerComponent(world, ControlBitsComponent))
                    .toEqual(new Set([9995]));
                expect(playerComponent(world, LegalRecordsComponent))
                    .toEqual(new Map([['nova:128', 5]]));
            });

        it('is undefined in flight with nobody docked and no player', () => {
            const world = new World();
            world.resources.set(DockedShipResource, {});
            expect(playerComponent(world, ControlBitsComponent))
                .toBeUndefined();
        });
    });

    describe('playerMissionMarks', () => {
        it('marks the stacked copy the player\'s bits make VISIBLE (#65)',
            async () => {
                const universe = await stackedUniverse();
                const world = new World();
                const ship = pilot([995]);
                ship.components.set(PlayerShipSelector, undefined);
                world.entities.set('ship', ship);
                expect(playerMissionMarks(world, universe)).toEqual([{
                    systemId: 'nova:765', kind: 'destination',
                    missionId: 'nova:737',
                }]);
            });

        it('marks the pre-story copy while the bit is unset', async () => {
            const universe = await stackedUniverse();
            const world = new World();
            const ship = pilot([]);
            ship.components.set(PlayerShipSelector, undefined);
            world.entities.set('ship', ship);
            expect(playerMissionMarks(world, universe).map(m => m.systemId))
                .toEqual(['nova:308']);
        });

        it('derives the docked ship\'s marks too', async () => {
            const universe = await stackedUniverse();
            const world = new World();
            world.resources.set(DockedShipResource,
                { current: new DockedShip(pilot([995])) });
            expect(playerMissionMarks(world, universe).map(m => m.systemId))
                .toEqual(['nova:765']);
        });
    });
});
