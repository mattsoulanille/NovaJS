import 'jasmine';
import { Entity } from 'nova_ecs/entity';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { CargoComponent } from '../nova_plugin/ship/cargo_plugin.js';
import { ControlEvent } from '../nova_plugin/core/controls_plugin.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { ControlBitsComponent } from '../nova_plugin/ncb/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/ship/outfit_plugin.js';
import { CreditsComponent } from '../nova_plugin/player/player_state_plugin.js';
import { commitVenueCredits, creditBalance } from './credit_commit.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import { Outfitter } from './outfitter.js';
import { TradeCenter } from './trade_center.js';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { PlayerEscortComponent } from '../nova_plugin/player/player_escort.js';
import { ShipComponent, ShipDataComponent } from '../nova_plugin/ship/ship_plugin.js';
import { EscortDealEntry, settleEscortDeals } from './escort_deals.js';

/**
 * THE DOCKED-VENUE CREDIT SEAM (credit_commit.ts).
 *
 * A venue snapshots the player's balance when it opens and writes it back
 * when the player presses Done, but it is not the only writer while the
 * dialog is up: the spaceport's refuel button decrements the live
 * component in place, and (until ruling #249 moved the settlement to the
 * lift-off) the client settled queued escort deals straight onto the
 * docked entity on every docked frame. Committing the snapshot as an
 * ABSOLUTE erased them — buy a hold of food, have a 40,000 credit external
 * payment land mid-visit, press Done, and the payment was gone. The
 * mid-visit escort sale is kept below as the concurrent writer these specs
 * drive: the rule is about any writer outside the venue.
 *
 * These drive the REAL menus (headless PIXI, parsed Nova data — the
 * synthetic set) through exactly that sequence.
 */
describe('venue credit commits compose with concurrent writers', () => {
    beforeAll(() => installHeadlessPixi());

    /** Port Amberline: a stellar with a trade centre, an outfitter and a shipyard. */
    const PORT = SYNTHETIC.planets.port;
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

    /** A landed pilot in the default starting ship, holding `credits`. */
    async function dockedPilot(credits: number): Promise<Entity> {
        const gameData = await getSyntheticGameData();
        const start = await gameData.data.PlayerStart.get(SYNTHETIC.playerStart);
        const entity = makeShip(await gameData.data.Ship.get(start.ship));
        entity.components.set(CreditsComponent, { credits });
        entity.components.set(CargoComponent, new Map());
        entity.components.set(ControlBitsComponent, new Set<number>());
        return entity;
    }

    /**
     * A writer outside the venue adding to the LIVE component
     * (`credits.credits += ...`) while the venue is open — what a venue
     * holding a snapshot used to overwrite.
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
            const gameData = await getSyntheticGameData();
            const entity = await dockedPilot(100_000);
            const exchange = new TradeCenter(displayAssets(), gameData,
                new Subject<ControlEvent>(), PORT);
            await exchange.buildPromise;

            const shown = exchange.show(entity);
            await untilShown(exchange);
            // Buy the first commodity the port trades: the working copy is
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
            const gameData = await getSyntheticGameData();
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

    /**
     * THE GATE, NOT JUST THE ARITHMETIC. An escort UPGRADE settling while
     * a venue's working copy is open is a spend: the settlement asks
     * whether the player can afford it, then debits. Read off the live
     * balance while the working copy had already spent most of it, the
     * upgrade went through and Done rebased the visit's spend to a
     * negative balance. It is gated on the WORKING balance
     * (LandedTransaction.spendable; landed_transaction_test drives the
     * real transaction) — modelled here as the balance a venue's live
     * status hands back, so the delta arithmetic can be pinned on its own.
     */
    describe('a mid-visit escort upgrade is gated on the venue\'s balance',
        () => {
            const PLAYER = 'player-uuid';
            const ESCORT = 'test:terrapin';
            const BETTER = 'test:terrapin-2';
            const ships = (upgradeCost: number) => new Map<string, ShipData>([
                [ESCORT, {
                    ...getDefaultShipData(), id: ESCORT, price: 150_000,
                    escortUpgradeShip: BETTER, escortUpgradeCost: upgradeCost,
                }],
                [BETTER, { ...getDefaultShipData(), id: BETTER, price: 400_000 }],
            ]);
            /** A landed escort with an upgrade queued, on the roster. */
            function roster(catalogue: Map<string, ShipData>): EscortDealEntry[] {
                return [{
                    player: PLAYER, uuid: 'escort-uuid',
                    entity: new Entity('escort')
                        .addComponent(ShipComponent, { id: ESCORT })
                        .addComponent(ShipDataComponent, catalogue.get(ESCORT)!)
                        .addComponent(PlayerEscortComponent, {
                            player: PLAYER, parent: PLAYER,
                            provenance: 'hired', pendingUpgrade: BETTER,
                        }),
                }];
            }
            /**
             * A settlement gated on the working balance (the venue's live
             * status when one is open, else the live component), debited
             * on the live component.
             */
            function settleFrame(entity: Entity, deals: EscortDealEntry[],
                catalogue: Map<string, ShipData>,
                liveStatus?: () => { credits?: number }) {
                const settled = settleEscortDeals(deals, PLAYER,
                    liveStatus?.().credits ?? creditBalance(entity),
                    id => catalogue.get(id));
                entity.components.get(CreditsComponent)!.credits +=
                    settled.credits;
                return settled;
            }

            it('leaves an upgrade the working balance cannot cover QUEUED, '
                + 'so Done never goes negative', () => {
                    // 100,000 cr; the outfitter's working copy has spent
                    // 90,000 of it; a 50,000 upgrade lands mid-visit.
                    const entity = new Entity();
                    entity.components.set(CreditsComponent, { credits: 100_000 });
                    const working = { credits: 10_000 };
                    const catalogue = ships(50_000);
                    const deals = roster(catalogue);

                    const settled = settleFrame(entity, deals, catalogue,
                        () => ({ credits: working.credits }));
                    expect(settled.upgraded).toEqual([]);
                    expect(creditBalance(entity)).toBe(100_000);
                    // Still queued: it will settle at a later departure.
                    expect(deals[0].entity.components.get(PlayerEscortComponent)!
                        .pendingUpgrade).toBe(BETTER);

                    // Done: the venue's delta lands and the balance is what
                    // the player saw — not the -40,000 the live gate gave.
                    commitVenueCredits(entity, 100_000, () => entity.components
                        .set(CreditsComponent, { credits: working.credits }));
                    expect(creditBalance(entity)).toBe(10_000);
                });

            it('settles an upgrade the working balance CAN cover, composed '
                + 'with the venue\'s delta at Done', () => {
                    const entity = new Entity();
                    entity.components.set(CreditsComponent, { credits: 100_000 });
                    const working = { credits: 10_000 };
                    const catalogue = ships(5_000);
                    const deals = roster(catalogue);

                    const settled = settleFrame(entity, deals, catalogue,
                        () => ({ credits: working.credits }));
                    expect(settled.upgraded.length).toBe(1);
                    expect(creditBalance(entity)).toBe(95_000);

                    commitVenueCredits(entity, 100_000, () => entity.components
                        .set(CreditsComponent, { credits: working.credits }));
                    expect(creditBalance(entity)).toBe(5_000);
                });

            it('reads the live balance when no venue is open', () => {
                const entity = new Entity();
                entity.components.set(CreditsComponent, { credits: 100_000 });
                const catalogue = ships(50_000);
                const settled = settleFrame(entity, roster(catalogue), catalogue);
                expect(settled.upgraded.length).toBe(1);
                expect(creditBalance(entity)).toBe(50_000);
            });
        });
});
