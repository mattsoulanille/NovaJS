import { OutfitData } from 'novadatainterface/outfit_data';
import { ShipData } from 'novadatainterface/ship_data';
import { WeaponData } from 'novadatainterface/weapon_data';
import { Entity } from 'nova_ecs/entity';
import {
    ammoStockOf, isOwnedEscort, PlayerEscortComponent,
} from '../nova_plugin/player/index.js';
import {
    DisabledComponent, ArmorComponent, FuelComponent, IonizationComponent, ShieldComponent,
    installedOutfitMass, IsIonizedComponent, OutfitsState, OutfitsStateComponent,
    ShipComponent,
} from '../nova_plugin/ship/index.js';
import { deployedFightersByBay } from './landed_escorts.js';

/**
 * ============================================================================
 * Escorts rearm and refuel when they land with you
 * ============================================================================
 *
 * An escort that puts down on the same rock as its player comes back up
 * with full fuel and full magazines, FREE OF CHARGE.
 *
 * WHY FREE, when the player's own refuel is PAID (spaceport.ts charges for
 * it). Matthew's ruling: the FEES are the whole commercial relationship —
 * the hiring price and the daily wage that follows it (escort_fees.ts) — and
 * an escort pilot maintains their own ship out of that, so their upkeep is
 * never itemized back to the player at the pad. Charging separately for it
 * would also need a per-escort price UI that the original never shows. Note
 * this is deliberately NOT symmetric with the player, and the asymmetry is
 * the design, not an oversight.
 *
 * WHAT IS RESTOCKED: fuel (FuelComponent.current -> max), ammunition
 * (every owned outfit with an `ammoFor` goes back to capacity — or, for an
 * OWNED escort, the player's own hull, back up to what the player left
 * aboard when it became an escort; see restockOwnedEscortAmmo — in both
 * cases only as far as the hull's free mass allows, see massFill), and — since
 * Matthew's playtest ("escorts should repair and deionize when landed") —
 * the HULL: armor and shields to full, any lingering ionization cleared,
 * and DisabledComponent dropped if one somehow rode the landing down. Bay
 * fighters ARE ammo outfits in this data model, so a carrier escort's
 * fighter complement is restored by the same ammo rule, with no special
 * case.
 *
 * The hull work is free for the same reason the fuel and ammo are: the
 * hiring price and the daily wage are the whole commercial relationship, and
 * an escort pilot maintains their own ship out of them (Matthew's ruling).
 * It stays deliberately asymmetric with the player, who pays their own bill.
 * A ship that never lands still repairs only by the slow in-flight rules —
 * this is a PORT VISIT, not a free repair beam.
 *
 * WHERE IT RUNS: on the LANDED roster as a LIFT-OFF consumes it
 * (browser.ts's takeLandedEscortsRestocked — the spaceport launch, the
 * gate lift-off back into the system the player docked from, and the late
 * flush that catches an escort which landed just after one of those).
 *
 * Two drains deliberately get nothing. The jump roster is one: an escort
 * that merely rode along through hyperspace never touched a pad. The
 * other is jumpTo's drain of the LANDED roster, which happens when a
 * player docked at a hypergate or wormhole transits to another system
 * carrying escorts that had already been swept up at the gate. Passing
 * through a gate is not a port visit, so that batch travels un-restocked
 * and is serviced by whatever lift-off eventually puts it back down.
 */

/** The data lookups the restock needs, narrowed for testability. */
export interface RestockGameData {
    getOutfit(id: string): Promise<OutfitData | undefined>;
    getWeapon(id: string): Promise<WeaponData | undefined>;
    /** The escort's hull class (its ShipComponent id), for its free mass. */
    getShip(id: string): Promise<ShipData | undefined>;
}

/**
 * A ceiling to fill an ammo outfit up to.
 *
 *  - `shared` is the launcher-derived capacity, and it belongs to the
 *    WEAPON, not to any one outfit: every outfit whose `ammoFor` names
 *    that weapon draws from the same pool. This is the outfitter's model —
 *    ammoCapacity (outfitter_rules.ts) is compared against the SUM of
 *    every supplying outfit's count, not against each one separately.
 *  - `perOutfit` is the Max-field fallback, which genuinely is per outfit
 *    (its `increasesMax` multiplier is keyed on that outfit's id). An
 *    absent capacity there means UNLIMITED — no ceiling to fill to, so the
 *    outfit keeps whatever count it had.
 *
 * Which of the two applies depends only on the supplied weapon and on the
 * launchers aboard, so it is the same answer for every outfit supplying
 * one weapon; only the `perOutfit` VALUE varies between them.
 */
type AmmoCeiling =
    | { kind: 'shared', capacity: number }
    | { kind: 'perOutfit', capacity?: number };

/**
 * The most of `outfit` this ship can hold, mirroring the outfitter's
 * ammoCapacity/effectiveMax pair (outfitter_rules.ts) so a restocked
 * escort ends up exactly where a player buying to the cap would:
 *
 *  - Ammo whose weapon has MaxAmmo > 0 is capped at MaxAmmo per mounted
 *    instance of that SUPPLY weapon (summed over the ship's outfits,
 *    weighted by how many of each it carries), SHARED across every outfit
 *    that supplies that weapon. Instances of weapons that merely DRAW on
 *    the supply do not count — see ammoCapacity in outfitter_rules.ts for
 *    why (the Nuke plug-in's racks versus its tubes).
 *  - Ammo whose weapon has MaxAmmo <= 0 defers to the outfit's own Max
 *    field, multiplied by any owned "increases max" items pointing at it.
 *  - A Max of <= 0 there means UNLIMITED, which has no ceiling to fill to,
 *    so such an outfit is left at whatever count it already had.
 *
 * Both ceilings are COUNT limits only. The purchase's other gate, the
 * hull's free mass, is applied on top by restockEscortEntity (fillable).
 *
 * Returns undefined only when the outfit is not ammunition at all.
 */
async function ammoCeiling(outfit: OutfitData, owned: OutfitsState,
    ownedData: ReadonlyMap<string, OutfitData>,
    gameData: RestockGameData): Promise<AmmoCeiling | undefined> {
    const byOutfitMax = (): AmmoCeiling => {
        if (outfit.max <= 0) {
            return { kind: 'perOutfit' }; // Unlimited: nothing to fill to.
        }
        let multiplier = 0;
        for (const [id, data] of ownedData) {
            if (data.increasesMax === outfit.id) {
                multiplier += owned.get(id)?.count ?? 0;
            }
        }
        return {
            kind: 'perOutfit',
            capacity: outfit.max * Math.max(1, multiplier),
        };
    };

    if (!outfit.ammoFor) {
        return undefined;
    }
    const suppliedWeapon = await gameData.getWeapon(outfit.ammoFor);
    if (!suppliedWeapon || suppliedWeapon.maxAmmo <= 0) {
        return byOutfitMax();
    }

    let mounted = 0;
    for (const [id, data] of ownedData) {
        const outfitCount = owned.get(id)?.count ?? 0;
        if (outfitCount > 0) {
            mounted += (data.weapons[outfit.ammoFor] ?? 0) * outfitCount;
        }
    }
    return { kind: 'shared', capacity: suppliedWeapon.maxAmmo * mounted };
}

/**
 * The hull half of a port visit: armor and shields to full, ionization
 * bled off, and any DisabledComponent removed.
 *
 * WHY THE DISABLED DROP IS NOT DEAD CODE. A disabled escort normally
 * cannot fly itself down to a pad, so it should never be on a landed
 * roster — but the roster is durable state that survives a landing, a
 * lift-off and a jump, and an escort can be disabled by a stray shot in
 * the same tick it is swept up. Coming back up still disabled would strand
 * it on the pad forever: DisabledMovementSystem brakes it, and the repair
 * paths (boarding it, the hail assist) all need it to be somewhere the
 * player can reach. It costs one delete to make that unreachable.
 *
 * IsIonizedComponent is deleted rather than set: it is IonizedSystem's
 * derived cache, and deleting it makes that system recompute (and re-emit
 * its event) from the zeroed stat on the next step, instead of two places
 * writing the same derived answer.
 */
function repairEscortHull(entity: Entity): void {
    const armor = entity.components.get(ArmorComponent);
    if (armor) {
        armor.current = armor.max;
    }
    const shield = entity.components.get(ShieldComponent);
    if (shield) {
        shield.current = shield.max;
    }
    const ionization = entity.components.get(IonizationComponent);
    if (ionization) {
        ionization.current = ionization.min;
    }
    entity.components.delete(IsIonizedComponent);
    entity.components.delete(DisabledComponent);
}

/**
 * Repairs, refuels and rearms one carried escort entity in place. Safe to
 * call on an entity with no fuel stat or no outfits — it simply does less.
 *
 * `deployedByWeapon` is this escort's OWN fighters that are still out of
 * their bays, keyed by bay weapon id: a launched fighter still occupies
 * its slot, so it comes off the bay's ceiling. Without it a carrier that
 * lands with fighters deployed is topped back up to FULL capacity and
 * those fighters redeploy on top of the restocked ones, briefly putting it
 * over capacity. This mirrors the outfitter's deployedCounts hook
 * (ownedAmmoCount in outfitter_rules.ts counts deployed rounds into the
 * total the capacity gates).
 *
 * Deployed counts apply only to the SHARED launcher-derived ceiling, which
 * is the case every bay falls into (a bay's MaxAmmo is its capacity). The
 * per-outfit Max fallback has no launcher-slot notion to occupy, and the
 * outfitter does not gate that case either.
 */
export async function restockEscortEntity(entity: Entity,
    gameData: RestockGameData,
    deployedByWeapon?: ReadonlyMap<string, number>): Promise<void> {
    repairEscortHull(entity);

    const fuel = entity.components.get(FuelComponent);
    if (fuel) {
        fuel.current = fuel.max;
    }

    if (isOwnedEscort(entity)) {
        await restockOwnedEscortAmmo(entity, gameData, deployedByWeapon);
        return;
    }
    await restockHiredEscortAmmo(entity, gameData, deployedByWeapon);
}

/**
 * A HIRED escort's rearm: every ammo outfit back to its count ceiling
 * (ammoCeiling: the launcher-derived pool, or the outfit's own Max), as far
 * as the hull's free mass allows (massFill).
 */
async function restockHiredEscortAmmo(entity: Entity,
    gameData: RestockGameData,
    deployedByWeapon?: ReadonlyMap<string, number>): Promise<void> {
    const owned = entity.components.get(OutfitsStateComponent);
    if (!owned || owned.size === 0) {
        return;
    }
    // Resolve every owned outfit once: the ceiling for any one ammo type
    // depends on the whole loadout (which launchers are aboard).
    const ownedData = new Map<string, OutfitData>();
    for (const id of owned.keys()) {
        const data = await gameData.getOutfit(id);
        if (data) {
            ownedData.set(id, data);
        }
    }
    const fill = await massFill(entity, owned, ownedData, gameData);

    // Ammo outfits grouped by the weapon they supply. TWO OUTFITS CAN FEED
    // ONE LAUNCHER (the bay data model does exactly this: several fighter
    // outfits whose ammoFor is the same bay), and the capacity is a single
    // pool shared between them — topping each one to the full capacity
    // separately would fill the bay twice over.
    const supplying = new Map<string, string[]>();
    for (const [id, data] of ownedData) {
        if (!data.ammoFor) {
            continue;
        }
        const group = supplying.get(data.ammoFor);
        if (group) {
            group.push(id);
        } else {
            supplying.set(data.ammoFor, [id]);
        }
    }

    // Sorted weapon ids, and sorted outfit ids inside each group, so the
    // fill order is the id order the bay's own consume/refund policy uses
    // (bay_plugin spends and refunds the lowest-sorted supplying outfit).
    for (const weaponId of [...supplying.keys()].sort()) {
        const group = supplying.get(weaponId)!.sort();
        const ceiling = await ammoCeiling(ownedData.get(group[0])!, owned,
            ownedData, gameData);
        if (ceiling === undefined) {
            continue;
        }
        if (ceiling.kind === 'perOutfit') {
            // Genuinely per outfit: each has its own Max and its own
            // increasesMax multiplier, so each is topped up on its own.
            for (const id of group) {
                const own = await ammoCeiling(ownedData.get(id)!, owned,
                    ownedData, gameData);
                const capacity = own?.kind === 'perOutfit'
                    ? own.capacity : undefined;
                const state = owned.get(id);
                if (capacity !== undefined && state
                    && state.count < capacity) {
                    // Never trims an overfull magazine — a restock tops up.
                    state.count += fill(ownedData.get(id)!,
                        capacity - state.count);
                }
            }
            continue;
        }

        // One shared pool. Everything already aboard, plus everything
        // still deployed from this weapon's bays, occupies it.
        let free = ceiling.capacity - (deployedByWeapon?.get(weaponId) ?? 0);
        for (const id of group) {
            free -= owned.get(id)?.count ?? 0;
        }
        for (const id of group) {
            if (free <= 0) {
                break; // Full (or overfull: a restock never trims).
            }
            const state = owned.get(id);
            if (!state) {
                continue;
            }
            // The rest of the pool goes to the next supplying outfit when
            // this one's mass runs out (a lighter round may still fit).
            const added = fill(ownedData.get(id)!, free);
            state.count += added;
            free -= added;
        }
    }
}

/** The ammo outfits among `ids`, grouped by the weapon they supply. */
async function ammoByWeapon(ids: Iterable<string>,
    gameData: Pick<RestockGameData, 'getOutfit'>):
    Promise<Map<string, string[]>> {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
        const weaponId = (await gameData.getOutfit(id))?.ammoFor;
        if (!weaponId) {
            continue;
        }
        const group = groups.get(weaponId);
        if (group) {
            group.push(id);
        } else {
            groups.set(weaponId, [id]);
        }
    }
    return groups;
}

/**
 * The FALLBACK for an OWNED escort with no `ammoStock` snapshot — one from a
 * save written before the snapshot existed: its CURRENT ammo counts become
 * the snapshot, so it never refills to capacity. Returns whether it wrote
 * one; a hired escort, or an owned one that already has a snapshot, is left
 * as it is.
 *
 * Run where such an escort first appears — a loaded save's escorts, before
 * the startup transit inserts them (client/system_entry.ts) — so the target
 * is what the pilot saved, and again by every restock as the backstop for
 * anything that reaches a port without one. Both run on the carried entity
 * before an insertion, so every peer receives the same marker.
 */
export async function takeMissingAmmoStock(entity: Entity,
    gameData: Pick<RestockGameData, 'getOutfit'>): Promise<boolean> {
    const marker = entity.components.get(PlayerEscortComponent);
    if (!marker || marker.ammoStock !== undefined || !isOwnedEscort(entity)) {
        return false;
    }
    const owned = entity.components.get(OutfitsStateComponent);
    const ammo = new Set([...(await ammoByWeapon(owned?.keys() ?? [],
        gameData)).values()].flat());
    entity.components.set(PlayerEscortComponent, {
        ...marker,
        ammoStock: ammoStockOf(
            [...owned ?? []].map(([id, { count }]): [string, number] =>
                [id, count]),
            id => ammo.has(id)),
    });
    return true;
}

/**
 * An OWNED escort's rearm (player_escort.ts's OWNED ESCORT AMMO): every ammo
 * outfit in its `ammoStock` snapshot goes back UP to the snapshot's count —
 * what the player left aboard when the hull became an escort — and no
 * further. Nothing is ever removed, and an ammo outfit the snapshot does not
 * name is left alone. The COUNT target is the snapshot, not the launcher
 * capacity: the snapshot is what this very hull carried (a hull's stock
 * AmmoLoad can sit above the launcher-derived cap the outfitter enforces,
 * and the player keeps that). The hull's FREE MASS still gates it exactly
 * as it gates a hired escort's restock (massFill): min(snapshot, what fits).
 *
 * DEPLOYED FIGHTERS still occupy their slots, exactly as in the hired rule:
 * a carrier that lands with k fighters out comes back to its snapshot minus
 * k, or the k redeploy on top of a full bay. Several outfits can feed one
 * bay, and a deployed fighter does not say which outfit it was, so for each
 * weapon the shortfalls of its snapshot outfits are summed, the deployed
 * count comes off that, and what is left is filled in sorted id order, each
 * outfit to at most its own snapshot count (the order bay_plugin spends and
 * refunds in).
 *
 * NO SNAPSHOT (a save from before there was one, normally stamped at load):
 * takeMissingAmmoStock writes its current counts and nothing is added.
 */
async function restockOwnedEscortAmmo(entity: Entity,
    gameData: RestockGameData,
    deployedByWeapon?: ReadonlyMap<string, number>): Promise<void> {
    if (await takeMissingAmmoStock(entity, gameData)) {
        return; // Its target is what it has: nothing to add this visit.
    }
    const stock = new Map(
        entity.components.get(PlayerEscortComponent)?.ammoStock ?? []);
    const owned = entity.components.get(OutfitsStateComponent);
    if (!owned || stock.size === 0) {
        return;
    }

    // The same free-mass gate as a hired escort's restock (massFill), over
    // everything aboard. A snapshot is a load this hull carried, so it
    // normally fits; the gate is what keeps it so if anything else aboard
    // has grown since.
    const ownedData = new Map<string, OutfitData>();
    for (const id of owned.keys()) {
        const data = await gameData.getOutfit(id);
        if (data) {
            ownedData.set(id, data);
        }
    }
    const fill = await massFill(entity, owned, ownedData, gameData);

    const supplying = await ammoByWeapon(stock.keys(), gameData);
    for (const weaponId of [...supplying.keys()].sort()) {
        const group = supplying.get(weaponId)!.sort();
        // Each outfit's shortfall below its own snapshot count (one above
        // it is never trimmed, and does not offset another's shortfall),
        // less the rounds still out of this weapon's bays.
        let free = -(deployedByWeapon?.get(weaponId) ?? 0);
        for (const id of group) {
            free += Math.max(0, stock.get(id)! - (owned.get(id)?.count ?? 0));
        }
        for (const id of group) {
            if (free <= 0) {
                break; // Back at the snapshot.
            }
            const have = owned.get(id)?.count ?? 0;
            const data = ownedData.get(id) ?? await gameData.getOutfit(id);
            const add = data === undefined ? 0
                : fill(data, Math.min(free, stock.get(id)! - have));
            if (add <= 0) {
                continue;
            }
            const state = owned.get(id);
            if (state) {
                state.count += add;
            } else {
                // Spent to nothing and dropped from the map: it comes back.
                owned.set(id, { count: add });
            }
            free -= add;
        }
    }
}

/**
 * THE HULL'S FREE MASS GATES A RESTOCK THE WAY IT GATES A PURCHASE. The
 * outfitter refuses a unit whose mass exceeds what the hull has left
 * (outfitter_rules canBuyOutfit: "You don't have enough free mass."), so a
 * restock topping up to the count ceiling alone could load an escort far
 * past anything its pilot could have bought, and the excess then followed
 * the HULL: swapping into the escort (ship_storage swapWithEscort) handed it
 * to the player. Playtest 2026-11-24 (Matthew, plug-in "More Blasters
 * CHEAT"): its Hyperioid (shïp 171 override, and AngryHyperioid 501) ships
 * with 4 "Hyperioid cell sample" (oütf 520: ammo for its Space Crane wëap
 * 248, which has MaxAmmo 0, so the oütf Max governs; Max 32000, 1 ton
 * each), and one landing filled that to 32000 aboard a hull with 19 tons
 * of free mass and none of it left: Available -31,951 tons after the swap.
 * Stock data has the same overload on a smaller scale (Manticores and Fed
 * Destroyers up to 20 four-ton EMP Torpedoes from 8-10, Starbridges and
 * Rebel ships up to 100 one-ton Gravimetric Missiles).
 *
 * Returns the fill function for one escort: given an ammo outfit and how
 * many units its count ceiling allows, the units that also FIT, spending
 * the mass as it goes so every later fill sees what is left. Massless
 * rounds (nearly all ammo, every fighter) are never limited. Never trims:
 * an escort already over its mass gets nothing more, and keeps what it has.
 * An escort whose hull class is unknown (no ShipComponent, or data without
 * it) is not mass-gated; every real escort is built with one.
 */
async function massFill(entity: Entity, owned: OutfitsState,
    ownedData: ReadonlyMap<string, OutfitData>, gameData: RestockGameData):
    Promise<(outfit: OutfitData, wanted: number) => number> {
    const shipId = entity.components.get(ShipComponent)?.id;
    const ship = shipId === undefined ? undefined
        : await gameData.getShip(shipId);
    if (!ship) {
        return (_outfit, wanted) => wanted;
    }
    const hullMass = ship.physics.mass;
    // outfitter_rules freeMass, over this escort's outfits.
    let freeMass = ship.physics.freeMass;
    for (const [id, data] of ownedData) {
        freeMass -= installedOutfitMass(data, hullMass)
            * (owned.get(id)?.count ?? 0);
    }
    return (outfit, wanted) => {
        const unit = installedOutfitMass(outfit, hullMass);
        if (unit <= 0 || wanted <= 0) {
            return Math.max(0, wanted);
        }
        const fits = Math.max(0, Math.min(wanted, Math.floor(freeMass / unit)));
        freeMass -= fits * unit;
        return fits;
    };
}

/**
 * Refuels and rearms a whole landed batch, in roster order.
 *
 * WHAT COUNTS AS DEPLOYED, at this application point: the fighters IN THIS
 * BATCH. A landed roster is the complete set of ships that came down with
 * the player, so a carrier escort's still-launched fighters are on it too
 * (see the module comment in landed_escorts.ts — landing does not stow a
 * deployed fighter). That makes the batch a self-contained, synchronous,
 * order-independent thing to count, which is what a ceiling wants.
 *
 * Fighters still IN FLIGHT are deliberately not counted. Reaching them
 * would mean reading the live display world from inside the restock — a
 * client-side, best-effort, mid-frame read — to cover a case the landing
 * itself does not produce. The narrowed seam: an escort whose fighter is
 * somehow still airborne when its carrier's roster is drained can still be
 * restocked past that fighter's slot.
 */
export async function restockCarriedEscorts(
    escorts: readonly { uuid?: string, entity: Entity }[],
    gameData: RestockGameData): Promise<void> {
    const deployed = deployedFightersByBay(escorts);
    for (const { uuid, entity } of escorts) {
        await restockEscortEntity(entity, gameData,
            uuid === undefined ? undefined : deployed.get(uuid));
    }
}
