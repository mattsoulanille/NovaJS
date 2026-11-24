import 'jasmine';
import { v4 } from 'uuid';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/index.js';
import { makeShip, OutfitsStateComponent } from '../ship/index.js';
import { makeSystem } from '../make_system.js';
import { JammingComponent, SystemInterferenceResource } from './jamming_plugin.js';

// These assertions run against parsed game data, pinning the jamming
// wiring end to end: oütf ModTypes -> OutfitData.jamming (and shïp
// InherentGovt -> gövt InhJam -> ShipData.inheritedJamming) -> ship's
// derived JammingComponent, and sÿst interference -> SystemInterferenceResource.
describe('jamming wiring against parsed game data', () => {
    it('derives a ship JammingComponent from its jammer outfits plus its hull InhJam', async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Shrike Ghost stocks the IR Baffler (ModType 33 -> [20,0,0,0])
        // and the Radar Baffler (ModType 34 -> [0,15,0,0]), and its
        // InherentGovt (the Verge Raiders) adds InhJam [7,5,0,0], so its
        // jamming is [27,20,0,0].
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        const jamming = ship.components.get(JammingComponent);
        expect(jamming).toBeDefined();
        expect(jamming).toEqual([27, 20, 0, 0]);
    });

    it('re-derives live as outfits change: different jammers add, copies count once', async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        // Warm the outfit cache (the provider reads getCached).
        await gameData.data.Outfit.get(SYNTHETIC.outfits.irBaffler);
        await gameData.data.Outfit.get(SYNTHETIC.outfits.radarBaffler);

        // The Wren Skiff: no jammers and no InherentGovt.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);
        system.entities.set('skiff', ship);
        system.step();
        const live = () => system.entities.get('skiff')!
            .components.get(JammingComponent);
        expect(live()).toEqual([0, 0, 0, 0]);

        const outfits = (extra: Array<[string, number]>) => {
            const base = new Map(system.entities.get('skiff')!
                .components.get(OutfitsStateComponent)!);
            for (const [id, count] of extra) {
                base.set(id, { count });
            }
            system.entities.get('skiff')!.components
                .set(OutfitsStateComponent, base);
            system.step();
        };
        outfits([[SYNTHETIC.outfits.irBaffler, 1]]);
        expect(live()).toEqual([20, 0, 0, 0]);
        // Three copies of the same jammer still count once.
        outfits([[SYNTHETIC.outfits.irBaffler, 3]]);
        expect(live()).toEqual([20, 0, 0, 0]);
        // A different jammer adds.
        outfits([[SYNTHETIC.outfits.radarBaffler, 1]]);
        expect(live()).toEqual([20, 15, 0, 0]);
    });

    it('sets the system interference resource from SystemData.interference', async () => {
        const gameData = await getSyntheticGameData();
        // Thessaly Reach is a clear system; Ossory Shoal is the murky,
        // static-filled one.
        const clear = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });
        expect(clear.resources.get(SystemInterferenceResource))
            .toEqual({ interference: 0 });

        const staticky = await makeSystem(SYNTHETIC.systems.ossory, gameData,
            undefined, { npcs: false });
        expect(staticky.resources.get(SystemInterferenceResource))
            .toEqual({ interference: 50 });
    });

    it('gives a ship with no jammer outfits an all-zero JammingComponent', async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Wren Skiff carries no jamming outfits.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([0, 0, 0, 0]);
    });
});
