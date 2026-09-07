import 'jasmine';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/entity_data_loader.js';
import { GovtComponent } from './govt_component.js';
import { JammingComponent } from '../combat/jamming_plugin.js';
import { makeShip } from '../ship/make_ship.js';
import { makeSystem } from '../make_system.js';

// These assertions stay on the real Nova game data (Nova_Data): the whole
// point of this describe is to pin a few known STOCK governments' parsed
// values (allies/enemies/MaxOdds/InhJam), which no other data set has. The
// GovtData -> GovtComponent -> InhJam-folded JammingComponent pipeline is
// exercised on the synthetic scenario in the describe below.
describe('GovtData against real Nova data', () => {
    it("pins the Federation's (nova:128) parsed values", async () => {
        const gameData = await getIntegrationGameData();
        const fed = await gameData.data.Govt.get('nova:128');
        expect(fed.name).toBe('Federation');
        // Allies/enemies are expressed as class numbers (Ally1-4 / Enemy1-4).
        expect(fed.allies).toEqual([0, 1, 12, 13]);
        expect(fed.enemies).toEqual([2, 10, 16, 9]);
        expect(fed.classes).toEqual([1]);
        expect(fed.maxOdds).toBe(200);
        expect(fed.skillMult).toBe(100);
        expect(fed.crimeTol).toBe(6);
        expect(fed.inhJam).toEqual([7, 5, 0, 0]);
        // require is a JSON-safe decimal string, not a bigint.
        expect(typeof fed.require).toBe('string');
    });

    it("pins the Vell-os (nova:136) strong inherent jamming", async () => {
        const gameData = await getIntegrationGameData();
        const vellos = await gameData.data.Govt.get('nova:136');
        expect(vellos.name).toBe('Vell-os');
        expect(vellos.inhJam).toEqual([50, 50, 35, 20]);
        expect(vellos.maxOdds).toBe(350);
        expect(vellos.skillMult).toBe(150);
    });

    it("pins the Auroran Empire (nova:129) parsed values", async () => {
        const gameData = await getIntegrationGameData();
        const auroran = await gameData.data.Govt.get('nova:129');
        expect(auroran.name).toBe('Auroran Empire');
        expect(auroran.enemies).toEqual([1, 12, 18]);
        expect(auroran.maxOdds).toBe(250);
        expect(auroran.inhJam).toEqual([8, 3, 0, 0]);
    });

    it("pins Pyrogenesis Skymining's (nova:173) short names", async () => {
        const gameData = await getIntegrationGameData();
        const pyro = await gameData.data.Govt.get('nova:173');
        expect(pyro.name).toBe('Pyrogenesis Skymining');
        // The gövt name-ish fields (gövt TMPL offsets 52/68/100): the
        // Comms Name, the short Target Code the target box shows, and the
        // Medium Name. The full name overflows the target box; "Pyro" is
        // what the original shows there.
        expect(pyro.commName).toBe('Pyrogenesis');
        expect(pyro.targetCode).toBe('Pyro');
        expect(pyro.mediumName).toBe('Pyrogenesis Skymining');
    });

    it("pins the Derelicts govt (nova:160) start-disabled flag", async () => {
        const gameData = await getIntegrationGameData();
        const derelicts = await gameData.data.Govt.get('nova:160');
        expect(derelicts.name).toBe('Derelicts');
        // gövt Flags1 0x0800: "Ships of this govt start out disabled
        // (derelicts)" — the mechanism behind the Drifting Derelict përs.
        expect(derelicts.flags.startsDisabled).toBeTrue();
    });

    it('exposes govt ids through the aggregated data interface', async () => {
        const gameData = await getIntegrationGameData();
        const ids = await gameData.ids;
        expect(ids.Govt).toContain('nova:128');
        expect(ids.Govt).toContain('nova:136');
    });
});

describe('inherent jamming from a ship\'s government', () => {
    it("folds a weak-InhJam govt into a jammer-less ship", async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Wren Skiff carries no jamming outfits, so its jamming comes
        // entirely from its government. The Verge Raiders have
        // InhJam [7, 5, 0, 0].
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(GovtComponent, { id: SYNTHETIC.govts.raiders });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([7, 5, 0, 0]);
    });

    it("takes the max of outfit jamming and a strong govt's InhJam", async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Shrike Ghost stocks jammers summing to [20, 15, 0, 0].
        // The Amber Compact has InhJam [50, 50, 35, 20], which dominates
        // every type, so the per-type max is the Compact's InhJam.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(GovtComponent, { id: SYNTHETIC.govts.compact });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([50, 50, 35, 20]);
    });

    it("leaves a ship's outfit jamming intact where it out-jams its govt", async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Shrike Ghost's jammers -> [20, 15, 0, 0]; the Verge Raiders'
        // InhJam is [7, 5, 0, 0], weaker on every type, so the outfit
        // values win the per-type max.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(GovtComponent, { id: SYNTHETIC.govts.raiders });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([20, 15, 0, 0]);
    });

    it('leaves a ship with no GovtComponent unchanged (outfit-only)', async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The same Ghost, but with no government: jamming stays outfit-only.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        expect(ship.components.get(GovtComponent)).toBeUndefined();
        expect(ship.components.get(JammingComponent)).toEqual([20, 15, 0, 0]);
    });
});
