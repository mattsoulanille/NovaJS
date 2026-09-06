import 'jasmine';
import { v4 } from 'uuid';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { getIntegrationGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';
import { JammingComponent, SystemInterferenceResource } from './jamming_plugin.js';

// These assertions run against the real Nova game data (Nova_Data), pinning the
// jamming wiring end to end: oütf ModTypes -> OutfitData.jamming -> ship's
// derived JammingComponent, and sÿst interference -> SystemInterferenceResource.
describe('jamming wiring against real Nova data', () => {
    it('derives a ship JammingComponent by summing its stock jammer outfits', async () => {
        const gameData = await getIntegrationGameData();
        const system = await makeSystem('nova:130', gameData, undefined, { npcs: false });

        // nova:133 (Starbridge; Class A) stocks the Civilian IR Jammer
        // (nova:238 -> [20,0,0,0]) and the Civilian Radar Jammer
        // (nova:239 -> [0,15,0,0]), so its accumulated jamming is [20,15,0,0].
        const shipData = await gameData.data.Ship.get('nova:133');
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        const jamming = ship.components.get(JammingComponent);
        expect(jamming).toBeDefined();
        expect(jamming).toEqual([20, 15, 0, 0]);
    });

    it('sets the system interference resource from SystemData.interference', async () => {
        const gameData = await getIntegrationGameData();
        // nova:130 is a clear system; nova:155 is a reference murky/static one.
        const clear = await makeSystem('nova:130', gameData, undefined, { npcs: false });
        expect(clear.resources.get(SystemInterferenceResource))
            .toEqual({ interference: 0 });

        const staticky = await makeSystem('nova:155', gameData, undefined, { npcs: false });
        expect(staticky.resources.get(SystemInterferenceResource))
            .toEqual({ interference: 50 });
    });

    it('gives a ship with no jammer outfits an all-zero JammingComponent', async () => {
        const gameData = await getIntegrationGameData();
        const system = await makeSystem('nova:130', gameData, undefined, { npcs: false });

        // nova:128 (Shuttle) carries no jamming outfits.
        const shipData = await gameData.data.Ship.get('nova:128');
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([0, 0, 0, 0]);
    });
});
