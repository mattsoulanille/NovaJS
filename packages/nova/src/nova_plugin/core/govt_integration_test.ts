import 'jasmine';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    getIntegrationGameData, getSyntheticGameData,
} from '../../communication/simulation_test_fixture.js';
import { completeEntity } from '../spawn/index.js';
import { GovtComponent } from './govt_component.js';
import { JammingComponent } from '../combat/index.js';
import { makeShip } from '../ship/index.js';
import { makeSystem } from '../make_system.js';

// These assertions stay on the real Nova game data (Nova_Data): the whole
// point of this describe is to pin a few known STOCK governments' parsed
// values (allies/enemies/MaxOdds/InhJam), which no other data set has. The
// rule that InhJam does NOT reach a ship's JammingComponent is
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

// gövt InhJam is parsed (pinned above) but NOT applied to a ship's jamming:
// a target of an InhJam1 100 government jammed none of 149 missiles in the
// reference (docs/reference_experiments.md, "J-series wave 3", finding 5).
describe('a ship\'s government does not add to its jamming (InhJam ignored)', () => {
    it("leaves a jammer-less ship of a weak-InhJam govt at zero", async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Wren Skiff carries no jamming outfits; the Verge Raiders have
        // InhJam [7, 5, 0, 0], which is not applied.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.skiff);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(GovtComponent, { id: SYNTHETIC.govts.raiders });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([0, 0, 0, 0]);
    });

    it("keeps a ship's outfit jamming under a strong-InhJam govt", async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        // The Shrike Ghost's jammers give [20, 15, 0, 0]. The Amber Compact's
        // InhJam [50, 50, 35, 20] would dominate every type if it applied.
        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        ship.components.set(GovtComponent, { id: SYNTHETIC.govts.compact });
        await completeEntity(system, ship);

        expect(ship.components.get(JammingComponent)).toEqual([20, 15, 0, 0]);
    });

    it('gives the same jamming with no GovtComponent (outfit-only)', async () => {
        const gameData = await getSyntheticGameData();
        const system = await makeSystem(SYNTHETIC.systems.thessaly, gameData,
            undefined, { npcs: false });

        const shipData = await gameData.data.Ship.get(SYNTHETIC.ships.ghost);
        const ship = makeShip(shipData);
        ship.components.set(MultiplayerData, { owner: 'server' });
        await completeEntity(system, ship);

        expect(ship.components.get(GovtComponent)).toBeUndefined();
        expect(ship.components.get(JammingComponent)).toEqual([20, 15, 0, 0]);
    });
});
