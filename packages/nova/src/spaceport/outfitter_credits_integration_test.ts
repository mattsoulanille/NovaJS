import 'jasmine';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { MissionSession } from './mission_session.js';
import { MissionUniverse } from './mission_universe.js';
import { outfitResaleValue } from './outfitter_rules.js';

/**
 * The outfitter charges/credits the docked entity's CreditsComponent
 * through the same MissionSession working-copy + commit path the outfit
 * mutations use. These tests drive that path against parsed Nova data
 * (the synthetic set: a default pilot in a Wren Skiff docked at Port
 * Amberline), covering the two properties hardest to check in the (PIXI)
 * UI class: that a buy/sell reaches CreditsComponent across the depart
 * commit, and that mission-granted outfits (Gxxx) never route through
 * the charge.
 */
describe('outfitter credits against parsed Nova data', () => {
    async function dockedPilot(credits: number) {
        const gameData = await getSyntheticGameData();
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
        const shipData = await gameData.data.Ship.get(start.ship);
        const entity = makeShip(shipData);
        entity.components.set(CreditsComponent, { credits });
        const session = await MissionSession.create(
            entity, gameData, universe, SYNTHETIC.planets.port);
        return { gameData, universe, entity, session };
    }

    it('deducts the price on buy and persists it across the commit', async () => {
        const { gameData, entity, session } = await dockedPilot(100000);
        const outfitId = (await gameData.ids).Outfit[0];
        const outfit = await gameData.data.Outfit.get(outfitId);

        // What the outfitter's applyBuy does: charge the price, add the
        // unit — both on the shared session working copies.
        const before = session.state.credits.credits;
        session.state.credits.credits -= outfit.price;
        session.outfits.set(outfitId, (session.outfits.get(outfitId) ?? 0) + 1);
        session.commit();

        expect(entity.components.get(CreditsComponent)!.credits)
            .toBe(before - outfit.price);
        expect(entity.components.get(OutfitsStateComponent)!.get(outfitId))
            .toEqual({ count: 1 });
    });

    it('credits 50% of the price on sell', async () => {
        const { gameData, entity, session } = await dockedPilot(0);
        const outfitId = (await gameData.ids).Outfit[0];
        const outfit = await gameData.data.Outfit.get(outfitId);
        session.outfits.set(outfitId, 1);

        // applySell for a pre-owned unit: credit the resale value, drop it.
        session.state.credits.credits += outfitResaleValue(outfit);
        session.outfits.delete(outfitId);
        session.commit();

        expect(entity.components.get(CreditsComponent)!.credits)
            .toBe(Math.floor(outfit.price * 0.5));
        expect(entity.components.get(OutfitsStateComponent)!.has(outfitId))
            .toBe(false);
    });

    it('grants a mission outfit (Gxxx) without charging credits', async () => {
        const { gameData, entity, session } = await dockedPilot(500);
        const outfitId = (await gameData.ids).Outfit[0];
        // Resource-local id for the Gxxx operator (e.g. nova:128 -> 128).
        const localId = Number(outfitId.split(':')[1]);
        const before = session.state.credits.credits;

        // The grant path the outfitter runs for set strings — the same
        // one Sxxx/Gxxx mission grants use. It must not touch credits.
        session.runMissionSet(`G${localId}`, 'nova');
        session.commit();

        expect(entity.components.get(CreditsComponent)!.credits).toBe(before);
        expect(entity.components.get(OutfitsStateComponent)!.get(outfitId))
            .toEqual({ count: 1 });
    });
});
