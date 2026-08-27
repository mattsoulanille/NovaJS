/**
 * The rules for buying a ship in the shipyard, per the EVN Bible's shïp
 * Cost field (~:2420):
 *
 *   "The cost of buying a ship is always the cost of the new ship minus
 *    25% of the original cost of your current ship and upgrades. (i.e.
 *    you always 'trade up' to a new ship)"
 *
 * plus the oütf persistence flag 0x0004 (~:1962): "This item stays with
 * you when you trade ships (persistent)".
 *
 * Pure logic; the Shipyard menu supplies the context. This is the
 * shipyard's counterpart to outfitter_rules.ts, and deliberately does
 * NOT reuse that file's 50% outfit resale fraction: the outfitter's
 * resale rule governs selling an outfit over the counter, while the
 * Bible's 25% here is a single valuation of the whole ship-plus-outfits
 * package being traded in. See the JUDGMENT CALLS block below for the
 * points the Bible leaves open.
 */
import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { Cargo, CargoComponent, cargoUsed } from '../nova_plugin/cargo_plugin.js';
import { makeShip } from '../nova_plugin/make_ship.js';
import {
    ActiveRanksComponent, AggressionSuppressGovtsComponent,
    ControlBitsComponent,
} from '../nova_plugin/ncb_plugin.js';
import { OutfitsStateComponent } from '../nova_plugin/outfit_plugin.js';
import { PlayerShipSelector } from '../nova_plugin/player_ship_plugin.js';
import {
    CreditsComponent,
    CronStatesComponent,
    GameDateComponent,
    MissionsComponent,
    PendingMissionNoticesComponent,
} from '../nova_plugin/player_state_plugin.js';
import {
    CombatRatingComponent,
    LegalRecordsComponent,
} from '../nova_plugin/reputation_plugin.js';
import { ControlledByComponent } from '../nova_plugin/ship_control.js';
import { PendingEscortsComponent } from './pending_escorts.js';
import { DeployedOutfitCounts } from './deployed_outfits.js';
import { ensurePlayerStateComponents } from './mission_session.js';
import { modifiedPrice } from './price_mod.js';

/**
 * The fraction of the current ship-and-outfits value that is credited
 * against the new ship's price (EVN Bible ~:2421).
 */
export const SHIP_TRADE_IN_FRACTION = 0.25;

export interface ShipPurchaseContext {
    /** The hull the player is flying right now. */
    currentShip: ShipData;
    /** The outfits aboard the current ship: outfit id -> count. */
    outfits: ReadonlyMap<string, number>;
    /**
     * Already-loaded outfit data. An id this returns undefined for is
     * valued at 0 and treated as non-persistent — see JUDGMENT CALLS.
     * The Shipyard menu preloads every owned outfit before enabling
     * Buy, so that fallback should never fire in the real UI.
     */
    getOutfit(id: string): OutfitData | undefined;
    /** The player's credits (the working copy while docked). */
    credits: number;
    /**
     * Outfit id -> units the player owns that are NOT aboard the docked
     * ship: bay fighters still flying, or landed as escorts (see
     * spaceport/deployed_outfits.ts, the same provider the outfitter
     * uses). Absent or empty means everything owned is aboard.
     *
     * A trade-in hands the whole hull over, bays included, so any deployed
     * fighter would be left with no hangar to come home to — canBuyShip
     * refuses the purchase while one is out. See judgment call 8.
     */
    deployedCounts?: ReadonlyMap<string, number>;
    /**
     * The ränk PriceMod percentage in force at the docked stellar
     * (price_mod.ts). Absent means 100 -- prices unchanged. It scales the NEW
     * hull's price only; the trade-in valuation stays on "original cost" (see
     * judgment call 9).
     */
    priceMod?: number;
}

/*
 * JUDGMENT CALLS. The Bible states the 25% formula in one sentence and
 * leaves these open; each is decided here and pinned by a spec in
 * shipyard_rules_test.ts.
 *
 * 1. "upgrades" includes AMMUNITION outfits. Ammo rounds are ordinary
 *    oütf resources with a Cost, and the Bible draws no distinction, so
 *    each round is valued like any other outfit. (Consequence: a full
 *    magazine is worth 25% of its list price on a trade, the same as
 *    selling it at 50% would be worth half of that. Nothing in the
 *    Bible suggests ammo is special here.)
 *
 * 2. The 25% is taken on ORIGINAL (list) cost -- OutfitData.price and
 *    ShipData.price -- not on any depreciated or resale value. The
 *    Bible says "original cost" explicitly.
 *
 * 3. STOCK outfits count. The player's outfit list does not record
 *    which units arrived with the hull and which were bought, so every
 *    non-persistent outfit aboard is valued. This DOES double-count:
 *    a shïp's Cost is its price as sold, with the standard loadout
 *    already installed (see ShipData.freeSpace, "free outfit space with
 *    the ship's stock outfits already installed"). The simple uniform
 *    rule is kept anyway -- it is the only one expressible from the
 *    state the game actually keeps, and it errs in the player's favour
 *    rather than against them. The alternative (subtract the hull's
 *    ShipData.outfits from the valued set) is a one-line change flagged
 *    as a seam at the bottom of this file.
 *
 * 4. CLAMP AT ZERO. If the trade-in exceeds the new ship's price the
 *    purchase is free, not profitable: the shipyard never pays you to
 *    take a ship. The Bible is silent; this matches the common
 *    understanding of the original and avoids an infinite-money loop
 *    (buy expensive, trade down repeatedly).
 *
 * 5. PERSISTENT outfits (0x0004) are excluded from the trade-in
 *    valuation AND carried onto the new hull. You keep them, so you are
 *    not selling them, so they must not be paid for twice.
 *
 * 6. Persistence IGNORES the new hull's limits -- gun/turret
 *    hardpoints, free mass, and the outfit's own Max. This is forced by
 *    the stock data: the four Vell-os beams (oütf 221 Flower Of Spring
 *    and 224 Winter Tempest are fixed guns; 222 Summer Bloom and 223
 *    Autumn Petal are turrets) are persistent, cantSell, price 0 and
 *    mass 0, and are granted by the Vell-os plot rather than bought. A
 *    limit check would silently destroy plot-critical, unrebuyable
 *    items when the player trades into a hull with fewer hardpoints.
 *    The outfitter's own caps still prevent BUYING past a limit
 *    (outfitter_rules.ts); a granted item is allowed to exceed it.
 *
 * 7. An UNKNOWN outfit id (game data not loaded) is valued at 0 and
 *    treated as non-persistent. Valuing it would invent credits, and
 *    the menu preloads owned outfits before enabling Buy.
 *
 * 8. DEPLOYED FIGHTERS BLOCK THE TRADE. A player who lands with bay
 *    fighters out and trades hulls hands over the bay with the old ship,
 *    so those fighters have no hangar left. The two available answers
 *    were "let them be lost" (what falls out of doing nothing) and
 *    "refuse the trade"; the trade is refused.
 *
 *    Doing nothing is not merely lossy, it is inconsistent: the fighters
 *    are not in `outfits`, so they are never valued in the trade-in, yet
 *    the player is charged nothing for destroying them either. Worse, a
 *    new hull whose STANDARD LOADOUT happens to mount the same bay weapon
 *    would collect the returning fighters into ITS magazine
 *    (refundFighterToBay keys on the bay weapon id, not on the ship), so
 *    "trade into a carrier while your fighters are out" quietly moved a
 *    free complement onto the new ship. Refusing closes both.
 *
 *    It also matches how this file already treats player property that a
 *    trade would otherwise eat: mission cargo is never jettisoned
 *    (cargoForNewShip) and hired-but-unspawned escorts are carried across
 *    (CARRIED_COMPONENTS), both on the principle that shopping must not
 *    silently destroy something the player paid for.
 *
 *    Nothing DOWNSTREAM crashes if a fighter is stranded anyway (an older
 *    save, or a mission Dxxx that removes the bay — see the seam at the
 *    bottom of this file): bay_plugin's ReturnAI only needs the carrier
 *    entity, which still exists, and refundFighterToBay finds zero bays
 *    mounted, so the magazine capacity is zero and the fighter is absorbed
 *    on docking without a refund. The graceful-loss path is the fallback,
 *    not the plan.
 *
 * 9. ränk PriceMod SCALES THE NEW HULL, NOT THE TRADE-IN. PriceMod modifies
 *    ship prices at planets owned by the affiliated government (ships and not
 *    outfitter items, per Matthew's ruling -- price_mod.ts has the evidence),
 *    and the price of a ship is what the shipyard asks for it. THIS is the
 *    shop PriceMod is for: the whole point of Extra Outfits' four PriceMod-1
 *    Spica ranks is that the hulls you commissioned come free from your own
 *    yard. The trade-in is not a price but a valuation of the player's
 *    own property, and the Bible pins it to "25% of the ORIGINAL cost of your
 *    current ship and upgrades" -- so a discount rank must not also devalue
 *    what the player brings in. Nothing can be farmed either way: the
 *    trade-in only ever offsets a purchase and is clamped at zero (judgment
 *    call 4), so it never pays out cash. See price_mod.ts.
 */

/** Whether this outfit survives a ship trade (oütf flag 0x0004). */
export function isPersistent(outfit: OutfitData | undefined): boolean {
    return outfit?.persistent ?? false;
}

/**
 * Splits the outfits aboard into the units that follow the player onto
 * the new hull (0x0004) and the units traded in with the old one.
 */
export function partitionOutfits(context: ShipPurchaseContext): {
    kept: Map<string, number>,
    tradedIn: Map<string, number>,
} {
    const kept = new Map<string, number>();
    const tradedIn = new Map<string, number>();
    for (const [id, count] of context.outfits) {
        if (count <= 0) {
            continue;
        }
        if (isPersistent(context.getOutfit(id))) {
            kept.set(id, count);
        } else {
            tradedIn.set(id, count);
        }
    }
    return { kept, tradedIn };
}

/**
 * What the player's current ship and its non-persistent outfits are
 * worth against a new hull: 25% of the hull's list price plus 25% of
 * every traded-in outfit's list price, floored to whole credits.
 */
export function tradeInValue(context: ShipPurchaseContext): number {
    const { tradedIn } = partitionOutfits(context);
    let total = context.currentShip.price;
    for (const [id, count] of tradedIn) {
        total += (context.getOutfit(id)?.price ?? 0) * count;
    }
    return Math.floor(total * SHIP_TRADE_IN_FRACTION);
}

/**
 * `newShip`'s asking price at this shipyard: its shïp Cost after the docked
 * stellar's ränk PriceMod (price_mod.ts). This is the figure the grid's "Ship
 * Price" line shows and the one shipPurchasePrice deducts the trade-in from,
 * so the display and the charge can never disagree.
 */
export function shipListPrice(newShip: ShipData,
    context: ShipPurchaseContext): number {
    return modifiedPrice(newShip.price, context.priceMod);
}

/**
 * The credits the player is actually charged for `newShip`: its asking price
 * less the trade-in, never below zero (judgment call 4).
 */
export function shipPurchasePrice(newShip: ShipData,
    context: ShipPurchaseContext): number {
    return Math.max(0, shipListPrice(newShip, context) - tradeInValue(context));
}

export type ShipDenialReason = 'fightersDeployed' | 'credits';

export type ShipyardCheck =
    | { allowed: true }
    | { allowed: false, reason: ShipDenialReason, message: string };

/**
 * Units the player owns that are not aboard the ship being traded in —
 * bay fighters still flying or landed as escorts. Every such unit would
 * lose its hangar with the hull, so the total is all canBuyShip needs;
 * WHICH bay each fighter came from does not change the answer.
 */
export function deployedUnitCount(context: ShipPurchaseContext): number {
    let deployed = 0;
    for (const count of context.deployedCounts?.values() ?? []) {
        if (count > 0) {
            deployed += count;
        }
    }
    return deployed;
}

/**
 * Whether the player can buy `newShip` right now: no bay fighters may be
 * deployed (judgment call 8 — the trade would hand over their hangar),
 * and the charge must not exceed the player's credits, so a trade can
 * never drive the balance negative.
 *
 * The fighter check comes first because it is structural: coming back with
 * more money does not make the trade safe, whereas recalling the fighters
 * does.
 */
export function canBuyShip(newShip: ShipData,
    context: ShipPurchaseContext): ShipyardCheck {
    if (deployedUnitCount(context) > 0) {
        return {
            allowed: false, reason: 'fightersDeployed',
            message: "You must recall your fighters before trading in "
                + "your ship!",
        };
    }
    const price = shipPurchasePrice(newShip, context);
    if (price > context.credits) {
        return {
            allowed: false, reason: 'credits',
            message: "You can't afford this ship!",
        };
    }
    return { allowed: true };
}

/**
 * The outfits the newly bought hull starts with: its own standard
 * loadout (shïp StandardOutfits, which ShipData exposes as `outfits`)
 * plus every persistent unit carried over from the old ship. Counts add
 * where both supply the same outfit.
 *
 * Returned in OutfitsStateComponent's shape so the caller can set it
 * directly. Setting it matters: ShipOutfitsProvider only derives the
 * stock loadout when the component is ABSENT, so a carried-over outfit
 * has to be merged with the stock list here rather than added later.
 */
export function outfitsForNewShip(newShip: ShipData,
    context: ShipPurchaseContext): Map<string, { count: number }> {
    const merged = new Map<string, { count: number }>();
    for (const [id, count] of Object.entries(newShip.outfits)) {
        if (count > 0) {
            merged.set(id, { count });
        }
    }
    for (const [id, count] of partitionOutfits(context).kept) {
        const existing = merged.get(id);
        merged.set(id, { count: (existing?.count ?? 0) + count });
    }
    return merged;
}

/**
 * The cargo hold the new ship starts with.
 *
 * JUDGMENT CALL: cargo transfers, but the new hull may have a smaller
 * hold. Rather than refuse the sale (which would strand a player who
 * happened to be carrying freight) or silently keep an over-full hold,
 * ordinary commodity and junk cargo is jettisoned until the load fits.
 * MISSION cargo ("mission:" keys) is never dropped -- losing it would
 * fail a mission as a side effect of shopping -- so a hold packed with
 * mission freight can still end up over capacity. Commodities are
 * dropped in descending-key order so the result is deterministic across
 * peers rather than dependent on Map insertion order.
 */
export function cargoForNewShip(cargo: Cargo, newCapacity: number): Cargo {
    const result = new Map(cargo);
    if (cargoUsed(result) <= newCapacity) {
        return result;
    }
    const droppable = [...result.keys()]
        .filter(key => !key.startsWith('mission:'))
        .sort()
        .reverse();
    for (const key of droppable) {
        if (cargoUsed(result) <= newCapacity) {
            break;
        }
        const held = result.get(key) ?? 0;
        const over = cargoUsed(result) - newCapacity;
        if (held <= over) {
            result.delete(key);
        } else {
            result.set(key, held - over);
        }
    }
    return result;
}

/**
 * The player-scoped components that follow the player onto a newly
 * bought hull. Everything ship-scoped or derived (ShipData, physics,
 * weapons, shield/armor/fuel/ionization, animation) is deliberately
 * absent so the providers rebuild it for the new ship -- which is also
 * what makes the new hull arrive fully repaired and fuelled.
 *
 * Credits, outfits and cargo are NOT listed: each is transformed by the
 * purchase rather than copied, so buildPurchasedShip sets them itself.
 */
export const CARRIED_COMPONENTS: readonly Component<any>[] = [
    ControlledByComponent,
    ControlBitsComponent,
    // The player's ränks. Not carrying them wiped every rank the pilot
    // held the moment they traded hulls (ensurePlayerStateComponents seeds
    // the new entity with an empty set), which is plot state, a shipyard
    // gate (rank Contribute) and a price discount (ränk PriceMod) all at
    // once — a second purchase in the same visit would have re-quoted at
    // full price against a grid that had just lost its rank-gated hulls.
    ActiveRanksComponent,
    // ... and the ränk privileges baked off them for the simulation
    // (ncb_plugin's AggressionSuppressGovtsComponent). Carried in the same
    // breath as the ranks: leaving it behind would hand the new hull a
    // pilot whose 0x0100 rank had silently stopped working.
    AggressionSuppressGovtsComponent,
    GameDateComponent,
    MissionsComponent,
    CronStatesComponent,
    PendingMissionNoticesComponent,
    LegalRecordsComponent,
    CombatRatingComponent,
    // Escorts hired at the bar THIS landing, not yet spawned (they spawn
    // at liftoff, browser.ts). Buying a ship between hiring and lifting
    // off must not discard them - the hire fee is already paid. (Review
    // round 6 finding; the loss predated the shipyard-economy rework.)
    PendingEscortsComponent,
];

/**
 * The purchase context describing an entity as it stands: the hull it
 * flies, the outfits aboard and the credits it holds.
 *
 * `currentShip` must be the ShipData for the entity's OWN ShipComponent
 * -- after a purchase that is the ship just bought, not the one traded
 * in, which is what makes a second trade in the same visit price
 * correctly.
 *
 * `deployedCounts` is the provider the spaceport hands every venue
 * (spaceport/deployed_outfits.ts). It is resolved against the ids this
 * entity owns, because a flying fighter names only its bay weapon and has
 * to be attributed back to one of the player's ammo outfits -- the same
 * resolution the Outfitter's makeContext does.
 */
export function purchaseContextFrom(entity: Entity, currentShip: ShipData,
    getOutfit: (id: string) => OutfitData | undefined,
    deployedCounts?: DeployedOutfitCounts,
    priceMod?: number): ShipPurchaseContext {
    const outfitsState = entity.components.get(OutfitsStateComponent);
    const outfits = new Map([...outfitsState ?? []].map(
        ([id, { count }]) => [id, count]));
    return {
        currentShip,
        outfits,
        getOutfit,
        credits: entity.components.get(CreditsComponent)?.credits ?? 0,
        deployedCounts: deployedCounts?.(outfits.keys()),
        priceMod,
    };
}

/** The new hull's hold: its own capacity plus freeCargo from its outfits. */
export function newShipCargoCapacity(newShip: ShipData,
    outfits: ReadonlyMap<string, { count: number }>,
    context: ShipPurchaseContext): number {
    let capacity = newShip.physics.freeCargo;
    for (const [id, { count }] of outfits) {
        capacity += (context.getOutfit(id)?.physics.freeCargo ?? 0) * count;
    }
    return Math.max(0, capacity);
}

/**
 * Builds the entity the player flies away in after buying `newShip`,
 * given the entity they arrived in. Charges the trade-up price, carries
 * the player-scoped state across, merges persistent outfits into the new
 * hull's stock loadout and moves the cargo that still fits.
 *
 * Callers must have checked canBuyShip first -- this charges
 * unconditionally, and would drive credits negative for an unaffordable
 * ship.
 *
 * The old entity is left untouched, so a caller that abandons the
 * purchase still has a valid ship.
 */
export function buildPurchasedShip(oldShip: Entity, newShip: ShipData,
    context: ShipPurchaseContext): Entity {
    const price = shipPurchasePrice(newShip, context);
    const outfits = outfitsForNewShip(newShip, context);
    const entity = makeShip(newShip);

    entity.components.set(PlayerShipSelector, undefined);
    const multiplayerData = oldShip.components.get(MultiplayerData);
    if (multiplayerData) {
        entity.components.set(MultiplayerData, multiplayerData);
    }
    for (const component of CARRIED_COMPONENTS) {
        const value = oldShip.components.get(component);
        if (value !== undefined) {
            entity.components.set(component, value);
        }
    }
    // Set explicitly: ShipOutfitsProvider only derives the stock loadout
    // when the component is ABSENT, so a carried-over persistent outfit
    // has to be merged with the stock list here rather than added later.
    entity.components.set(OutfitsStateComponent, outfits);
    entity.components.set(CargoComponent, cargoForNewShip(
        oldShip.components.get(CargoComponent) ?? new Map(),
        newShipCargoCapacity(newShip, outfits, context)));
    entity.components.set(CreditsComponent,
        { credits: context.credits - price });
    // Safety net for state an older save never carried.
    ensurePlayerStateComponents(entity);
    return entity;
}

/*
 * SEAMS left deliberately open.
 *
 * - TECH LEVEL. The shipyard still stocks every ship in the game. Ships
 *   carry the same TechLevel / SpecialTech structure as outfits, so
 *   outfitter_rules.ts meetsTechLevel(ship.techLevel, stellarOf(planet))
 *   is the intended hook; wiring it needs the docked PlanetData plumbed
 *   into the Shipyard menu, which is a separate change from the
 *   economy.
 * - STOCK-OUTFIT DOUBLE COUNTING (judgment call 3). If the trade-in
 *   proves too generous in play, subtract the current hull's
 *   ShipData.outfits from the valued set in tradeInValue.
 * - CONFIRMATION DIALOG. The original asks the player to confirm the
 *   trade before charging. There is no reference screenshot of it in
 *   ui_screenshots/original_macos_screenshots/shipyard, so the Buy
 *   button commits directly and simply greys out when unaffordable.
 * - oütf 0x0200 (price proportional to ship mass) is not decoded
 *   anywhere yet, so such an outfit is valued at its base Cost here.
 */
