import 'jasmine';
import { getDefaultOutfitData, OutfitData } from 'novadatainterface/outfit_data';
import { getDefaultShipData, ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { CargoComponent } from '../nova_plugin/cargo_plugin.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import {
    ActiveRanksComponent, ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { EscortPayrollComponent } from '../nova_plugin/player_escort.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import {
    CreditsComponent,
    GameDateComponent,
} from '../nova_plugin/player_state_plugin.js';
import { CombatRatingComponent } from '../nova_plugin/reputation_plugin.js';
import { ShipComponent } from '../nova_plugin/ship_plugin.js';
import {
    buildChangedShip,
    buildPurchasedShip,
    canBuyShip,
    cargoForNewShip,
    outfitsAfterShipChange,
    outfitsForNewShip,
    runShipTradeSetStrings,
    partitionOutfits,
    purchaseContextFrom,
    ShipPurchaseContext,
    shipPurchasePrice,
    SHIP_TRADE_IN_FRACTION,
    tradeInValue,
} from './shipyard_rules.js';

/**
 * The shipyard's trade-up pricing and outfit-persistence rules (EVN
 * Bible ~:2421 for the 25% formula, ~:1962 for oütf flag 0x0004).
 */
describe('shipyard purchase rules', () => {
    function outfit(id: string, fields: Partial<OutfitData> = {}): OutfitData {
        return {
            ...getDefaultOutfitData(), id, ...fields,
            physics: { freeMass: 0, ...fields.physics },
        };
    }

    function ship(id: string, fields: Partial<ShipData> = {}): ShipData {
        const base = getDefaultShipData();
        return {
            ...base, id, ...fields,
            physics: { ...base.physics, ...fields.physics },
        };
    }

    /** A context whose outfit catalogue is the given outfits. */
    function context(fields: {
        currentShip: ShipData,
        outfits?: [string, number][],
        catalogue?: OutfitData[],
        credits?: number,
    }): ShipPurchaseContext {
        const byId = new Map((fields.catalogue ?? []).map(o => [o.id, o]));
        return {
            currentShip: fields.currentShip,
            outfits: new Map(fields.outfits ?? []),
            getOutfit: id => byId.get(id),
            credits: fields.credits ?? Infinity,
        };
    }

    describe('trade-in valuation', () => {
        it('values a bare hull at 25% of its price', () => {
            const ctx = context({ currentShip: ship('nova:100', { price: 40000 }) });
            expect(SHIP_TRADE_IN_FRACTION).toBe(0.25);
            expect(tradeInValue(ctx)).toBe(10000);
        });

        it('adds 25% of each outfit at its ORIGINAL list price', () => {
            // Judgment call 2: the 25% is taken on list price, not on the
            // outfitter's 50% resale value.
            const cannon = outfit('nova:200', { price: 12000 });
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:200', 2]],
                catalogue: [cannon],
            });
            // 0.25 * (40000 + 2*12000) = 16000
            expect(tradeInValue(ctx)).toBe(16000);
        });

        it('counts ammunition outfits like any other upgrade', () => {
            // Judgment call 1: ammo rounds are ordinary outfits with a
            // Cost, so each round is valued.
            const rocket = outfit('nova:300', {
                price: 400, ammoFor: 'nova:500',
            });
            const ctx = context({
                currentShip: ship('nova:100', { price: 0 }),
                outfits: [['nova:300', 10]],
                catalogue: [rocket],
            });
            expect(tradeInValue(ctx)).toBe(1000);
        });

        it('EXCLUDES persistent outfits from the valuation', () => {
            // Judgment call 5: you keep them, so you are not selling them.
            const beam = outfit('nova:221', { price: 90000, persistent: true });
            const cannon = outfit('nova:200', { price: 12000 });
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:221', 1], ['nova:200', 1]],
                catalogue: [beam, cannon],
            });
            // The persistent beam contributes nothing: 0.25*(40000+12000)
            expect(tradeInValue(ctx)).toBe(13000);
        });

        it('values an unknown outfit id at zero', () => {
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:999', 3]],
                catalogue: [],
            });
            expect(tradeInValue(ctx)).toBe(10000);
        });

        it('ignores outfits held at a non-positive count', () => {
            const cannon = outfit('nova:200', { price: 12000 });
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:200', 0]],
                catalogue: [cannon],
            });
            expect(tradeInValue(ctx)).toBe(10000);
        });

        it('floors a fractional valuation to whole credits', () => {
            const ctx = context({ currentShip: ship('nova:100', { price: 4002 }) });
            // 0.25 * 4002 = 1000.5
            expect(tradeInValue(ctx)).toBe(1000);
        });

        it('values a ship-mass-proportional outfit at what it cost on '
            + 'THIS hull (oütf 0x0200)', () => {
                // Carbon Fiber (Cost 250, flag 0x0200) on a Leviathan
                // (Mass 10,000) cost 2,500,000 cr, and that is its
                // "original cost" for the 25%.
                const plating = outfit('nova:180', {
                    price: 250, priceScalesWithShipMass: true,
                });
                const leviathan = ship('nova:131', {
                    price: 12_000_000,
                    physics: { ...getDefaultShipData().physics, mass: 10_000 },
                });
                const ctx = context({
                    currentShip: leviathan,
                    outfits: [['nova:180', 2]],
                    catalogue: [plating],
                });
                // 0.25 * (12,000,000 + 2 * 2,500,000)
                expect(tradeInValue(ctx)).toBe(4_250_000);
            });
    });

    describe('purchase price', () => {
        it('charges the new price minus the trade-in', () => {
            const ctx = context({ currentShip: ship('nova:100', { price: 40000 }) });
            const target = ship('nova:101', { price: 100000 });
            expect(shipPurchasePrice(target, ctx)).toBe(90000);
        });

        it('CLAMPS at zero rather than paying the player to trade down', () => {
            // Judgment call 4: the shipyard never pays you to take a ship.
            const ctx = context({
                currentShip: ship('nova:100', { price: 10000000 }),
            });
            const target = ship('nova:101', { price: 50000 });
            expect(tradeInValue(ctx)).toBe(2500000);
            expect(shipPurchasePrice(target, ctx)).toBe(0);
        });
    });

    describe('affordability', () => {
        it('allows a purchase the player can exactly afford', () => {
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                credits: 90000,
            });
            expect(canBuyShip(ship('nova:101', { price: 100000 }), ctx))
                .toEqual({ allowed: true });
        });

        it('REFUSES a purchase one credit out of reach', () => {
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                credits: 89999,
            });
            const check = canBuyShip(ship('nova:101', { price: 100000 }), ctx);
            expect(check.allowed).toBe(false);
            expect(check.allowed ? '' : check.reason).toBe('credits');
        });

        it('allows a clamped (free) purchase even with zero credits', () => {
            const ctx = context({
                currentShip: ship('nova:100', { price: 10000000 }),
                credits: 0,
            });
            expect(canBuyShip(ship('nova:101', { price: 50000 }), ctx).allowed)
                .toBe(true);
        });
    });

    /*
     * Judgment call 8: a trade-in hands over the hull with its bays, so a
     * fighter still out would have no hangar to return to. The outfitter
     * refuses to sell the bay for the same reason (outfitter_rules
     * canSellOutfit); this is the other half of that rule.
     */
    describe('deployed bay fighters', () => {
        const fighter = outfit('nova:158', { ammoFor: 'nova:149' });

        it('REFUSES the trade while a fighter is deployed', () => {
            const ctx = {
                ...context({
                    currentShip: ship('nova:100', { price: 40000 }),
                    outfits: [['nova:158', 0]],
                    catalogue: [fighter],
                    credits: Infinity,
                }),
                deployedCounts: new Map([['nova:158', 2]]),
            };
            const check = canBuyShip(ship('nova:101', { price: 100000 }), ctx);
            expect(check.allowed).toBe(false);
            expect(check.allowed ? '' : check.reason).toBe('fightersDeployed');
        });

        it('refuses even a trade the player could easily afford', () => {
            // Structural, not financial: the fighter check runs before
            // affordability, so more money does not unlock it.
            const ctx = {
                ...context({
                    currentShip: ship('nova:100', { price: 10000000 }),
                    credits: Infinity,
                }),
                deployedCounts: new Map([['nova:158', 1]]),
            };
            const check = canBuyShip(ship('nova:101', { price: 1 }), ctx);
            expect(check.allowed ? '' : check.reason).toBe('fightersDeployed');
        });

        it('allows the trade once the fighters are back aboard', () => {
            const ctx = {
                ...context({
                    currentShip: ship('nova:100', { price: 40000 }),
                    outfits: [['nova:158', 2]],
                    catalogue: [fighter],
                    credits: 90000,
                }),
                deployedCounts: new Map<string, number>(),
            };
            expect(canBuyShip(ship('nova:101', { price: 100000 }), ctx))
                .toEqual({ allowed: true });
        });

        it('ignores zero-count deployed entries', () => {
            // The provider leaves a spent magazine's key in place; a zero
            // must not read as "a fighter is out".
            const ctx = {
                ...context({
                    currentShip: ship('nova:100', { price: 40000 }),
                    outfits: [['nova:158', 2]],
                    catalogue: [fighter],
                    credits: 90000,
                }),
                deployedCounts: new Map([['nova:158', 0]]),
            };
            expect(canBuyShip(ship('nova:101', { price: 100000 }), ctx))
                .toEqual({ allowed: true });
        });

        it('allows the trade when nothing supplies deployed counts', () => {
            // No provider (headless tests, an old save) means "everything
            // owned is aboard", the behaviour before this rule existed.
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                credits: 90000,
            });
            expect(ctx.deployedCounts).toBeUndefined();
            expect(canBuyShip(ship('nova:101', { price: 100000 }), ctx))
                .toEqual({ allowed: true });
        });

        it('does not pay for the deployed fighters it refuses to strand',
            () => {
                // Belt and braces on the money side: a deployed fighter is
                // absent from `outfits`, so even if the trade went through
                // it would never be valued into the trade-in.
                const ctx = {
                    ...context({
                        currentShip: ship('nova:100', { price: 40000 }),
                        outfits: [['nova:158', 0]],
                        catalogue: [outfit('nova:158', {
                            ammoFor: 'nova:149', price: 20000,
                        })],
                    }),
                    deployedCounts: new Map([['nova:158', 4]]),
                };
                expect(tradeInValue(ctx)).toBe(10000);
            });
    });

    describe('outfit persistence', () => {
        const beam = outfit('nova:221', { price: 0, persistent: true });
        const cannon = outfit('nova:200', { price: 12000 });

        it('splits persistent outfits from traded-in ones', () => {
            const ctx = context({
                currentShip: ship('nova:100'),
                outfits: [['nova:221', 2], ['nova:200', 3]],
                catalogue: [beam, cannon],
            });
            const { kept, tradedIn } = partitionOutfits(ctx);
            expect([...kept]).toEqual([['nova:221', 2]]);
            expect([...tradedIn]).toEqual([['nova:200', 3]]);
        });

        it('merges kept outfits into the new hull stock loadout', () => {
            const ctx = context({
                currentShip: ship('nova:100'),
                outfits: [['nova:221', 1], ['nova:200', 4]],
                catalogue: [beam, cannon],
            });
            const target = ship('nova:101', { outfits: { 'nova:400': 2 } });
            const result = outfitsForNewShip(target, ctx);
            // Stock loadout survives, the persistent beam comes along,
            // and the mundane cannon does NOT.
            expect([...result].sort()).toEqual([
                ['nova:221', { count: 1 }],
                ['nova:400', { count: 2 }],
            ]);
        });

        it('adds counts when the new hull already stocks a kept outfit', () => {
            const ctx = context({
                currentShip: ship('nova:100'),
                outfits: [['nova:221', 2]],
                catalogue: [beam],
            });
            const target = ship('nova:101', { outfits: { 'nova:221': 1 } });
            expect(outfitsForNewShip(target, ctx).get('nova:221'))
                .toEqual({ count: 3 });
        });

        it('transfers a persistent outfit regardless of hardpoint limits', () => {
            // Judgment call 6: the stock Vell-os beams are fixed guns and
            // turrets, granted by the plot and unrebuyable, so a hull with
            // no hardpoints must not destroy them.
            const gun = outfit('nova:221', { persistent: true, fixedGun: true });
            const turret = outfit('nova:222', { persistent: true, turret: true });
            const ctx = context({
                currentShip: ship('nova:100'),
                outfits: [['nova:221', 1], ['nova:222', 1]],
                catalogue: [gun, turret],
            });
            const target = ship('nova:101', {
                physics: {
                    ...getDefaultShipData().physics,
                    maxGuns: 0, maxTurrets: 0, freeMass: 0,
                },
            });
            const result = outfitsForNewShip(target, ctx);
            expect(result.get('nova:221')).toEqual({ count: 1 });
            expect(result.get('nova:222')).toEqual({ count: 1 });
        });
    });

    describe('cargo transfer', () => {
        it('moves the whole hold when it fits', () => {
            const cargo = new Map([['cargo:1', 10], ['cargo:2', 5]]);
            expect([...cargoForNewShip(cargo, 20)].sort())
                .toEqual([['cargo:1', 10], ['cargo:2', 5]]);
        });

        it('jettisons commodities down to the new capacity', () => {
            const cargo = new Map([['cargo:1', 10], ['cargo:2', 10]]);
            const result = cargoForNewShip(cargo, 12);
            expect([...result.values()].reduce((a, b) => a + b, 0)).toBe(12);
        });

        it('never jettisons mission cargo', () => {
            const cargo = new Map([['mission:nova:128', 15], ['cargo:1', 10]]);
            const result = cargoForNewShip(cargo, 10);
            expect(result.get('mission:nova:128')).toBe(15);
            expect(result.has('cargo:1')).toBe(false);
        });

        it('leaves an over-full hold of pure mission cargo intact', () => {
            const cargo = new Map([['mission:nova:128', 25]]);
            expect([...cargoForNewShip(cargo, 5)])
                .toEqual([['mission:nova:128', 25]]);
        });
    });

    describe('buildPurchasedShip', () => {
        const beam = outfit('nova:221', { price: 0, persistent: true });
        const cannon = outfit('nova:200', { price: 12000 });

        function oldPlayer(): Entity {
            const entity = makeShip(ship('nova:100', { price: 40000 }));
            entity.components.set(CreditsComponent, { credits: 500000 });
            entity.components.set(OutfitsStateComponent, new Map([
                ['nova:221', { count: 1 }], ['nova:200', { count: 2 }],
            ]));
            entity.components.set(CargoComponent, new Map([['cargo:1', 3]]));
            entity.components.set(ControlBitsComponent, new Set([7]));
            entity.components.set(GameDateComponent,
                { day: 4, month: 5, year: 1177 });
            entity.components.set(CombatRatingComponent, { kills: 12 });
            entity.components.set(ActiveRanksComponent,
                new Set(['nova:150', 'nova:151']));
            entity.components.set(MultiplayerData, { owner: 'peer-1' });
            return entity;
        }

        function purchase() {
            const old = oldPlayer();
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:221', 1], ['nova:200', 2]],
                catalogue: [beam, cannon],
                credits: 500000,
            });
            const target = ship('nova:101', {
                price: 200000,
                outfits: { 'nova:400': 1 },
                physics: { ...getDefaultShipData().physics, freeCargo: 50 },
            });
            return { old, ctx, target, bought: buildPurchasedShip(old, target, ctx) };
        }

        it('charges the trade-up price, not the whole balance', () => {
            const { bought } = purchase();
            // trade-in = 0.25*(40000 + 2*12000) = 16000; 200000-16000
            expect(bought.components.get(CreditsComponent))
                .toEqual({ credits: 500000 - 184000 });
        });

        it('flies the new hull', () => {
            const { bought } = purchase();
            expect(bought.components.get(ShipComponent)).toEqual({ id: 'nova:101' });
        });

        it('carries bar-hired pending escorts across the hull swap', () => {
            // Review round 6: escorts hired THIS landing (spawned only at
            // liftoff) were silently dropped by a ship purchase - the fee
            // was already paid, so they must ride CARRIED_COMPONENTS.
            const old = oldPlayer();
            old.components.set(PendingEscortsComponent,
                ['nova:128', 'nova:129']);
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:221', 1], ['nova:200', 2]],
                catalogue: [beam, cannon],
                credits: 500000,
            });
            const bought = buildPurchasedShip(old,
                ship('nova:101', { price: 200000 }), ctx);
            expect(bought.components.get(PendingEscortsComponent))
                .toEqual(['nova:128', 'nova:129']);
        });

        it('carries the escort PAYROLL across the hull swap', () => {
            // The payroll mirror is the only record of the wage-drawing
            // escorts that exists while the player is docked (the escorts
            // themselves are out of the world, on the landed roster). Left
            // behind, every date advance for the rest of that docked window
            // charged nothing at all — a free day's wages for trading hulls.
            const old = oldPlayer();
            old.components.set(EscortPayrollComponent,
                ['nova:130', 'nova:134']);
            const ctx = context({
                currentShip: ship('nova:100', { price: 40000 }),
                outfits: [['nova:221', 1], ['nova:200', 2]],
                catalogue: [beam, cannon],
                credits: 500000,
            });
            const bought = buildPurchasedShip(old,
                ship('nova:101', { price: 200000 }), ctx);
            expect(bought.components.get(EscortPayrollComponent))
                .toEqual(['nova:130', 'nova:134']);
        });

        it('carries player state across the hull swap', () => {
            const { bought } = purchase();
            expect(bought.components.get(ControlBitsComponent)).toEqual(new Set([7]));
            expect(bought.components.get(GameDateComponent))
                .toEqual({ day: 4, month: 5, year: 1177 });
            expect(bought.components.get(CombatRatingComponent)).toEqual({ kills: 12 });
            expect(bought.components.get(MultiplayerData)).toEqual({ owner: 'peer-1' });
            expect(bought.components.get(CargoComponent)).toEqual(new Map([['cargo:1', 3]]));
        });

        it('carries the pilot\'s ränks across the hull swap', () => {
            // They were not on CARRIED_COMPONENTS, so a trade handed the
            // new hull to ensurePlayerStateComponents, which seeded an
            // EMPTY rank set: every rank the pilot had earned was gone the
            // instant they bought a ship — losing plot state, the shipyard's
            // own rank Contribute gates, and any ränk PriceMod discount.
            const { bought } = purchase();
            expect(bought.components.get(ActiveRanksComponent))
                .toEqual(new Set(['nova:150', 'nova:151']));
        });

        it('keeps the persistent outfit and drops the mundane one', () => {
            const { bought } = purchase();
            const outfits = bought.components.get(OutfitsStateComponent)!;
            expect(outfits.get('nova:221')).toEqual({ count: 1 });
            expect(outfits.has('nova:200')).toBe(false);
            expect(outfits.get('nova:400')).toEqual({ count: 1 });
        });

        it('leaves the derived stat components absent to be re-derived', () => {
            // Shield/armor/fuel/physics/weapons must come from the new
            // hull's providers, which only run when the component is
            // absent -- that is also what makes the ship arrive full.
            const { bought } = purchase();
            for (const name of ['ShipPhysicsComponent', 'WeaponsStateComponent',
                'Shield', 'Armor', 'Fuel']) {
                expect([...bought.components.keys()].map(c => c.name))
                    .not.toContain(name);
            }
        });

        it('does not mutate the ship being traded in', () => {
            const { old, bought } = purchase();
            expect(old.components.get(CreditsComponent)).toEqual({ credits: 500000 });
            expect(old.components.get(ShipComponent)).toEqual({ id: 'nova:100' });
            expect(old).not.toBe(bought);
        });

        it('prices a SECOND purchase against the ship just bought', () => {
            // A visit can contain two trades. The second must value the
            // hull the player now owns, not the one already traded away.
            const { bought, target } = purchase();
            const next = purchaseContextFrom(bought, target,
                id => new Map([['nova:221', beam], ['nova:200', cannon]]).get(id));
            expect(next.currentShip.id).toBe('nova:101');
            expect(next.credits).toBe(500000 - 184000);
            // The new hull (200000) plus the free stock outfit and the
            // carried, zero-priced persistent beam.
            expect(tradeInValue(next)).toBe(50000);

            const third = ship('nova:102', { price: 300000 });
            const bought2 = buildPurchasedShip(bought, third, next);
            expect(bought2.components.get(CreditsComponent))
                .toEqual({ credits: 500000 - 184000 - 250000 });
            // The Vell-os beam survives a second trade too.
            expect(bought2.components.get(OutfitsStateComponent)!.get('nova:221'))
                .toEqual({ count: 1 });
        });

        it('resolves the deployed-count provider against the owned ids',
            () => {
                // The provider is a function, not a map, because a flying
                // fighter names only its bay weapon and has to be
                // attributed back to one of the player's ammo outfits --
                // so it has to be handed the ids this entity owns.
                const { bought, target } = purchase();
                let sawIds: string[] = [];
                const ctx = purchaseContextFrom(bought, target,
                    id => new Map([['nova:221', beam]]).get(id),
                    ids => {
                        sawIds = [...ids];
                        return new Map([['nova:158', 3]]);
                    });
                expect(sawIds).toEqual(
                    [...bought.components.get(OutfitsStateComponent)!.keys()]);
                expect(ctx.deployedCounts).toEqual(new Map([['nova:158', 3]]));
                // ...and that is enough to stop a third trade.
                const check = canBuyShip(ship('nova:103', { price: 1 }), ctx);
                expect(check.allowed ? '' : check.reason)
                    .toBe('fightersDeployed');
            });
    });

    /**
     * shïp OnRetire (~:2639) and OnPurchase (~:2598) at a trade, on the
     * entity the trade built.
     */
    describe('the shïp set strings a trade fires', () => {
        /** Every stock hull's OnPurchase; Pegasus;rogue's OnRetire. */
        const rogue = ship('nova:377',
            { onPurchase: 'b4322', onRetire: '!b4322' });
        const starbridge = ship('nova:133',
            { onPurchase: 'b8888 G200', writerPrefix: 'nova' });

        function traded(bits: number[], retired: ShipData, bought: ShipData) {
            const entity = makeShip(bought);
            entity.components.set(ControlBitsComponent, new Set(bits));
            entity.components.set(OutfitsStateComponent, new Map());
            runShipTradeSetStrings(entity, retired, bought,
                { outfitExists: id => id === 'nova:200' });
            return entity;
        }

        it('runs the old class\'s OnRetire, then the new class\'s OnPurchase',
            () => {
                const entity = traded([4322], rogue, starbridge);
                const bits = entity.components.get(ControlBitsComponent)!;
                expect(bits.has(4322)).toBe(false);
                expect(bits.has(8888)).toBe(true);
            });

        it('retires BEFORE buying, so a shared bit ends up set', () => {
            // Two hulls that set and clear the same "flying one of ours"
            // bit: trading between them must leave it set.
            const a = ship('nova:300', { onPurchase: 'b20289', onRetire: '!b20289' });
            const b = ship('nova:301', { onPurchase: 'b20289', onRetire: '!b20289' });
            expect(traded([20289], a, b).components
                .get(ControlBitsComponent)!.has(20289)).toBe(true);
        });

        it('writes a NEW bit set, leaving the traded-in entity\'s alone',
            () => {
                const old = makeShip(rogue);
                const shared = new Set([4322]);
                old.components.set(ControlBitsComponent, shared);
                const bought = makeShip(starbridge);
                bought.components.set(ControlBitsComponent, shared);
                runShipTradeSetStrings(bought, rogue, starbridge);
                expect(old.components.get(ControlBitsComponent)).toBe(shared);
                expect(shared.has(4322)).toBe(true);
                expect(bought.components.get(ControlBitsComponent)!.has(4322))
                    .toBe(false);
            });

        it('applies a Gxxx grant to the new hull\'s outfits', () => {
            const entity = traded([], rogue, starbridge);
            expect(entity.components.get(OutfitsStateComponent)!.get('nova:200'))
                .toEqual({ count: 1 });
        });

        it('is a no-op for blank strings and a missing retired class', () => {
            const plain = ship('nova:128');
            const entity = makeShip(plain);
            entity.components.set(ControlBitsComponent, new Set([1]));
            runShipTradeSetStrings(entity, undefined, plain);
            expect([...entity.components.get(ControlBitsComponent)!])
                .toEqual([1]);
        });
    });

    /**
     * The mission set operators Cxxx / Exxx / Hxxx (EVN Bible ~:230-240),
     * as an oütf OnPurchase like stock 314's `H165` runs them.
     */
    describe('a mission set operator changing the ship', () => {
        /** 0x0020: survives an H change. NOT 0x0004 (the shipyard's bit). */
        const vellosBeam = outfit('nova:221',
            { price: 0, persistentOnShipChange: true });
        /** 0x0004 only: survives a TRADE, not an H change. */
        const tradeKeeper = outfit('nova:222', { price: 10, persistent: true });
        const cannon = outfit('nova:200', { price: 12000 });
        /** The new class's stock loadout: two cannons and a rack. */
        const modStarbridge = ship('nova:165', {
            price: 750000, outfits: { 'nova:200': 2, 'nova:300': 1 },
        });
        const owned: [string, number][] =
            [['nova:221', 1], ['nova:222', 1], ['nova:200', 1]];
        const catalogue = new Map([
            ['nova:221', vellosBeam], ['nova:222', tradeKeeper],
            ['nova:200', cannon],
        ]);
        const getOutfit = (id: string) => catalogue.get(id);

        it('Cxxx keeps every outfit and grants none of the defaults', () => {
            expect(outfitsAfterShipChange(modStarbridge, new Map(owned),
                getOutfit, 'keep')).toEqual(new Map([
                    ['nova:221', { count: 1 }],
                    ['nova:222', { count: 1 }],
                    ['nova:200', { count: 1 }],
                ]));
        });

        it('Exxx keeps every outfit AND grants the defaults', () => {
            expect(outfitsAfterShipChange(modStarbridge, new Map(owned),
                getOutfit, 'keepAndGrantDefaults')).toEqual(new Map([
                    ['nova:200', { count: 3 }],
                    ['nova:300', { count: 1 }],
                    ['nova:221', { count: 1 }],
                    ['nova:222', { count: 1 }],
                ]));
        });

        it('Hxxx drops everything but the 0x0020 items and grants the '
            + 'defaults', () => {
                // The shipyard's 0x0004 does not save nova:222 here.
                expect(outfitsAfterShipChange(modStarbridge, new Map(owned),
                    getOutfit, 'dropAndGrantDefaults')).toEqual(new Map([
                        ['nova:200', { count: 2 }],
                        ['nova:300', { count: 1 }],
                        ['nova:221', { count: 1 }],
                    ]));
            });

        it('ignores non-positive counts and unknown outfits under H', () => {
            expect(outfitsAfterShipChange(modStarbridge,
                new Map([['nova:221', 0], ['nova:999', 2]]), getOutfit,
                'dropAndGrantDefaults')).toEqual(new Map([
                    ['nova:200', { count: 2 }],
                    ['nova:300', { count: 1 }],
                ]));
        });

        it('builds the new hull with the credits carried over unchanged',
            () => {
                const bought = makeShip(ship('nova:137', { price: 350000 }));
                bought.components.set(MultiplayerData, { owner: 'peer-1' });
                bought.components.set(CreditsComponent, { credits: 123456 });
                bought.components.set(ControlBitsComponent, new Set([4000]));
                bought.components.set(OutfitsStateComponent,
                    new Map(owned.map(([id, count]) => [id, { count }])));
                const before = bought.components.get(CreditsComponent)!.credits;
                const changed = buildChangedShip(bought, modStarbridge,
                    new Map(owned), getOutfit, 'dropAndGrantDefaults');
                expect(changed).not.toBe(bought);
                expect(changed.components.get(ShipComponent))
                    .toEqual({ id: 'nova:165' });
                // No price, no trade-in: a gift is not a purchase.
                expect(changed.components.get(CreditsComponent))
                    .toEqual({ credits: before });
                expect(changed.components.get(OutfitsStateComponent)!
                    .get('nova:222')).toBeUndefined();
                expect(changed.components.get(OutfitsStateComponent)!
                    .get('nova:221')).toEqual({ count: 1 });
                // The player-scoped state followed, as on a purchase.
                expect(changed.components.get(ControlBitsComponent))
                    .toBe(bought.components.get(ControlBitsComponent));
                expect(changed.components.get(MultiplayerData))
                    .toEqual(bought.components.get(MultiplayerData));
            });
    });
});
