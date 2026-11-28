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
 * (every ammo outfit, anything with an `ammoFor`, goes back to the escort's
 * REFILL TARGET — for a hired escort its shïp resource's own stock loadout,
 * the counts that variant spawns with; for an OWNED escort, the player's own
 * hull, what the player left aboard when it became an escort; see
 * restockHiredEscortAmmo and restockOwnedEscortAmmo — in both cases only as
 * far as the hull's free mass allows, see massFill), and — since
 * Matthew's playtest ("escorts should repair and deionize when landed") —
 * the HULL: armor and shields to full, any lingering ionization cleared,
 * and DisabledComponent dropped if one somehow rode the landing down. Bay
 * fighters ARE ammo outfits in this data model, so a carrier escort's
 * fighter complement is restored by the same ammo rule, with no special
 * case.
 *
 * WHY THE STOCK LOADOUT, NOT CAPACITY (Matthew, 2026-11-27): "Docking an
 * escort with ammo (including fighters) should replenish the ammo", and
 * landing refills too, to the same amounts: the escort's ship VARIANT's
 * default ammo, not the most its magazines could hold. His example: a Fed
 * Viper comes back with 6 IR missiles, not 200 (the oütf Max). A docked bay
 * fighter relaunches as a fresh hull with exactly that loadout
 * (escorts/bay_plugin.ts), and a landed escort is refilled to the same
 * counts here.
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
 * its slot, so it comes off the bay's refill target. Without it a carrier
 * that lands with fighters deployed is topped back up to its FULL
 * complement and those fighters redeploy on top of the restocked ones,
 * briefly putting it over its loadout. This mirrors the outfitter's
 * deployedCounts hook (ownedAmmoCount in outfitter_rules.ts counts
 * deployed rounds into the total the capacity gates).
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
 * A hull class's STOCK AMMO: `[outfit id, count]` for every ammo outfit (an
 * `ammoFor`, bay fighters included) its shïp resource carries, the counts a
 * ship of that variant spawns with (ship_plugin deriveShipOutfits).
 * Undefined when the escort's hull class is unknown (no ShipComponent, or
 * data without it).
 */
export async function stockAmmoOf(entity: Entity,
    gameData: Pick<RestockGameData, 'getOutfit' | 'getShip'>):
    Promise<Map<string, number> | undefined> {
    const shipId = entity.components.get(ShipComponent)?.id;
    const ship = shipId === undefined ? undefined
        : await gameData.getShip(shipId);
    if (!ship) {
        return undefined;
    }
    const stock = new Map<string, number>();
    for (const [id, count] of Object.entries(ship.outfits)) {
        if (count > 0 && (await gameData.getOutfit(id))?.ammoFor) {
            stock.set(id, count);
        }
    }
    return stock;
}

/**
 * A HIRED escort's rearm: every ammo outfit back to its hull class's stock
 * count (stockAmmoOf), as far as the hull's free mass allows (massFill) —
 * the same loadout a docked bay craft relaunches with. An escort whose hull
 * class is unknown is left as it is.
 *
 * EXACTLY THE STOCK COUNT: unlike an owned escort's top-up, a hired
 * escort's ammo ABOVE its stock count is trimmed back to it. Nothing in
 * play loads a hired escort past its stock any more, but earlier builds
 * refilled every landing to capacity (Matthew's Fed Viper "200, not 6"),
 * and an escort carried in a save from then comes back to its variant's
 * loadout at its next landing. An ammo outfit the hull class does not
 * stock is left alone. Still-deployed fighters come off their bay's
 * target first (deployedByWeapon), so the trim never removes a fighter
 * that is still out.
 */
async function restockHiredEscortAmmo(entity: Entity,
    gameData: RestockGameData,
    deployedByWeapon?: ReadonlyMap<string, number>): Promise<void> {
    const owned = entity.components.get(OutfitsStateComponent);
    const stock = await stockAmmoOf(entity, gameData);
    if (!owned || !stock || stock.size === 0) {
        return;
    }
    // Trim first, so the mass a trim frees is there for the top-up. Per
    // weapon, the stock total less the rounds still deployed is shared out
    // in sorted id order (the order bay_plugin spends and refunds in), each
    // outfit to at most its own stock count.
    const supplying = await ammoByWeapon(stock.keys(), gameData);
    for (const weaponId of [...supplying.keys()].sort()) {
        let left = -(deployedByWeapon?.get(weaponId) ?? 0);
        const group = supplying.get(weaponId)!.sort();
        for (const id of group) {
            left += stock.get(id)!;
        }
        for (const id of group) {
            const target = Math.max(0, Math.min(stock.get(id)!, left));
            left -= target;
            const state = owned.get(id);
            if (state && state.count > target) {
                state.count = target;
            }
        }
    }
    await topUpToTarget(entity, owned, stock, gameData, deployedByWeapon);
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
 * the snapshot, so it never refills past them. Returns whether it wrote
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
 * name is left alone. The COUNT target is the snapshot, not the hull
 * class's stock loadout (a hired escort's target) nor the launcher
 * capacity: the snapshot is what this very hull carried when the player
 * switched off it (Matthew, 2026-11-27: a custom escort refills to the ammo
 * and bay quantities the player left it with). The hull's FREE MASS still
 * gates it exactly as it gates a hired escort's restock (massFill):
 * min(snapshot, what fits).
 *
 * DEPLOYED FIGHTERS still occupy their slots, exactly as in the hired rule:
 * a carrier that lands with k fighters out comes back to its snapshot minus
 * k, or the k redeploy on top of a full bay (topUpToTarget).
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
    await topUpToTarget(entity, owned, stock, gameData, deployedByWeapon);
}

/**
 * Tops every ammo outfit in `target` back UP to its target count, less the
 * rounds still out of its weapon's bays, under the hull's free-mass gate
 * (massFill): the refill both escort kinds share, with their own targets
 * (a hired escort's hull-class stock, an owned escort's snapshot). Never
 * removes anything: an outfit above its target keeps what it has, and does
 * not offset another's shortfall.
 *
 * Several outfits can feed one bay, and a deployed fighter does not say
 * which outfit it was, so for each weapon the shortfalls of its target
 * outfits are summed, the deployed count comes off that, and what is left
 * is filled in sorted id order, each outfit to at most its own target (the
 * order bay_plugin spends and refunds in). An outfit spent to nothing and
 * dropped from the map comes back.
 */
async function topUpToTarget(entity: Entity, owned: OutfitsState,
    target: ReadonlyMap<string, number>, gameData: RestockGameData,
    deployedByWeapon?: ReadonlyMap<string, number>): Promise<void> {
    // The free-mass gate, over everything aboard. A target is a load this
    // hull class carries, so it normally fits; the gate is what keeps it
    // so if anything else aboard has grown since.
    const ownedData = new Map<string, OutfitData>();
    for (const id of owned.keys()) {
        const data = await gameData.getOutfit(id);
        if (data) {
            ownedData.set(id, data);
        }
    }
    const fill = await massFill(entity, owned, ownedData, gameData);

    const supplying = await ammoByWeapon(target.keys(), gameData);
    for (const weaponId of [...supplying.keys()].sort()) {
        const group = supplying.get(weaponId)!.sort();
        let free = -(deployedByWeapon?.get(weaponId) ?? 0);
        for (const id of group) {
            free += Math.max(0, target.get(id)! - (owned.get(id)?.count ?? 0));
        }
        for (const id of group) {
            if (free <= 0) {
                break; // Back at the target.
            }
            const have = owned.get(id)?.count ?? 0;
            const data = ownedData.get(id) ?? await gameData.getOutfit(id);
            const add = data === undefined ? 0
                : fill(data, Math.min(free, target.get(id)! - have));
            if (add <= 0) {
                continue;
            }
            const state = owned.get(id);
            if (state) {
                state.count += add;
            } else {
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
