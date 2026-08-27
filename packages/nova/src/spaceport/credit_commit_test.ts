import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { getIntegrationGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/controls_plugin.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import { ControlBitsComponent } from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { CreditsComponent } from '../nova_plugin/player_state_plugin.js';
import { commitVenueCredits, creditBalance } from './credit_commit.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Outfitter } from './outfitter.js';
import { TradeCenter } from './trade_center.js';

/**
 * THE DOCKED-VENUE CREDIT SEAM (credit_commit.ts).
 *
 * A venue snapshots the player's balance when it opens and writes it back
 * when the player presses Done, but it is not the only writer while the
 * dialog is up: browser.ts settles queued escort deals straight onto the
 * docked entity on EVERY docked frame at a shipyard, and the spaceport's
 * refuel button decrements the live component in place. Committing the
 * snapshot as an ABSOLUTE erased them — buy a hold of food, have a 40,000
 * credit escort sale settle mid-visit, press Done, and the sale was gone
 * though the escort had already left the roster for good.
 *
 * These drive the REAL menus (headless PIXI, real Nova data) through exactly
 * that sequence.
 */
describe('venue credit commits compose with concurrent writers', () => {
    beforeAll(() => installHeadlessPixi());

    /** Earth: a stellar with a trade centre, an outfitter and a shipyard. */
    const EARTH = 'nova:128';
    /** What an escort sale settling mid-visit pays into the live component. */
    const SALE_PAYOUT = 40_000;

    function displayAssets(): DisplayAssetDataInterface {
        return {
            spriteFromPict: () => new PIXI.Sprite(),
            spriteFromPictAsync: async () => new PIXI.Sprite(),
            textureFromPict: () => PIXI.Texture.EMPTY,
            textureFromPictAsync: async () => PIXI.Texture.EMPTY,
            textureFromCicn: async () => PIXI.Texture.EMPTY,
            textureFromPpat: async () => PIXI.Texture.EMPTY,
            data: {},
        } as unknown as DisplayAssetDataInterface;
    }

    /** A landed pilot in the stock starting ship, holding `credits`. */
    async function dockedPilot(credits: number): Promise<Entity> {
        const gameData = await getIntegrationGameData();
        const start = await gameData.data.PlayerStart.get(EARTH);
        const entity = makeShip(await gameData.data.Ship.get(start.ship));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(CargoComponent, new Map());
        entity.components.set(ControlBitsComponent, new Set<number>());
        return entity;
    }

    /**
     * An escort deal settling on a docked frame: browser.ts's
     * settleDockedEscortDeals adds the net proceeds to the LIVE component
     * (`credits.credits += ...`), which is what a venue holding a snapshot
     * used to overwrite.
     */
    function escortDealSettles(entity: Entity, amount: number) {
        entity.components.get(CreditsComponent)!.credits += amount;
    }

    /**
     * Waits until a menu's show() has actually put it up. show() is async
     * (it loads planet/junk data, or builds a whole MissionSession) and
     * only reaches Menu.show — which is what makes dismiss() work — once
     * those loads land.
     */
    async function untilShown(menu: { container: PIXI.Container }) {
        for (let i = 0; i < 6000 && !menu.container.visible; i++) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(menu.container.visible).toBe(true);
    }

    it('keeps a mid-visit escort sale AND the goods cost at the exchange',
        async () => {
            const gameData = await getIntegrationGameData();
            const entity = await dockedPilot(100_000);
            const exchange = new TradeCenter(displayAssets(), gameData,
                new Subject<ControlEvent>(), EARTH);
            await exchange.buildPromise;

            const shown = exchange.show(entity);
            await untilShown(exchange);
            // Buy the first commodity Earth trades: the working copy is
            // charged, the entity is not (that is what Done is for).
            (exchange as any).buy();
            const spent = 100_000 - (exchange as any).state.credits.credits;
            expect(spent).toBeGreaterThan(0);
            expect(creditBalance(entity)).toBe(100_000);

            // ...and while the exchange is open, a queued escort sale
            // settles onto the live component.
            escortDealSettles(entity, SALE_PAYOUT);

            exchange.dismiss();
            await shown;

            // BOTH survive. Before the delta rule this was 100_000 - spent.
            expect(creditBalance(entity)).toBe(100_000 - spent + SALE_PAYOUT);
            // The goods really were bought, so the cost is not a phantom.
            expect([...entity.components.get(CargoComponent)!.values()]
                .reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
        }, 120_000);

    it('keeps a mid-visit escort sale AND the outfit cost at the outfitter',
        async () => {
            const gameData = await getIntegrationGameData();
            const entity = await dockedPilot(100_000);
            const outfitter = new Outfitter(displayAssets(), gameData,
                new Subject<ControlEvent>());
            await outfitter.buildPromise;

            const shown = outfitter.show(entity);
            // show() builds a whole MissionSession before Menu.show seeds
            // the working copies from it.
            await untilShown(outfitter);
            const outfitId = (await gameData.ids).Outfit[0];
            const outfit = await gameData.data.Outfit.get(outfitId);
            (outfitter as any).applyBuy(outfit);
            const spent = 100_000 - (outfitter as any).credits.credits;
            expect(spent).toBeGreaterThan(0);
            expect(creditBalance(entity)).toBe(100_000);

            escortDealSettles(entity, SALE_PAYOUT);

            outfitter.dismiss();
            await shown;

            expect(creditBalance(entity)).toBe(100_000 - spent + SALE_PAYOUT);
            expect(entity.components.get(OutfitsStateComponent)!.get(outfitId))
                .toEqual({ count: 1 });
        }, 120_000);

    it('is unchanged when nothing else writes (every older spec)', () => {
        // The delta collapses to the absolute the venue wrote whenever the
        // live balance still equals the baseline, which is the ordinary
        // case and the one every pre-existing spec exercises.
        const entity = new Entity();
        entity.components.set(CreditsComponent, { credits: 500 });
        const baseline = commitVenueCredits(entity, 500,
            () => entity.components.set(CreditsComponent, { credits: 300 }));
        expect(creditBalance(entity)).toBe(300);
        expect(baseline).toBe(300);
    });

    it('does not charge twice when a commit is repeated', () => {
        // Menu.dismiss() calls done(), and done() is reachable from a
        // button too; a delta applied twice would double the spend.
        const entity = new Entity();
        entity.components.set(CreditsComponent, { credits: 500 });
        const working = { credits: 300 };
        let baseline = 500;
        const write = () => entity.components.set(CreditsComponent,
            { credits: working.credits });
        baseline = commitVenueCredits(entity, baseline, write);
        baseline = commitVenueCredits(entity, baseline, write);
        expect(creditBalance(entity)).toBe(300);
    });

    it('leaves an entity with no credits component alone', () => {
        const entity = new Entity();
        expect(commitVenueCredits(entity, 0, () => undefined)).toBe(0);
        expect(entity.components.has(CreditsComponent)).toBe(false);
    });
});
