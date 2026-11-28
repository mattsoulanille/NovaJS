/**
 * Counting outfits the player owns but that are not physically aboard
 * while docked — today, fighters still flying after their carrier
 * landed.
 *
 * Why this exists (Matthew's rule): a launched fighter has already been
 * removed from the carrier's OutfitsStateComponent (weapon_plugin's
 * consumeAmmo spent it), so landing with fighters out would otherwise
 * look to the outfitter like free magazine space, and the player could
 * buy past the bay's capacity. Every deployed fighter therefore still
 * counts against both the outfit's Max and its launcher's ammo
 * capacity.
 *
 * Deliberately NOT folded in: free mass, cargo, hardpoints, and
 * Contribute flags all keep reading only what is physically installed
 * (outfitter_rules' ownedOutfits). RULING (Matthew, 2026-08-09): this is
 * correct by design — fighters don't have mass; the mass cost is paid by
 * installing the BAY. Verified against stock data + every bundled
 * plugin: all 48 fighter ammo outfits have mass 0, so a deployed
 * fighter never represents tonnage the ship gets back on docking.
 *
 * ---------------------------------------------------------------------
 * EXTENSION SEAM for the landed-escort roster
 * ---------------------------------------------------------------------
 * `DeployedOutfitCounts` is a provider function, not a value, precisely
 * so more sources of "owned but not aboard" can be added without
 * touching outfitter_rules or the Outfitter menu. To add a source
 * (e.g. hired escorts that are still in the system when the player
 * lands, each of which cost an outfit-like slot), write another
 * counting function beside `countDeployedFighters` and compose the two
 * with `mergeDeployedCounts` at the wiring site in
 * display/spaceport_plugin.ts. Nothing downstream needs to know how
 * many sources there are.
 */
import { OutfitData } from 'novadatainterface/outfit_data';
import { Entity } from 'nova_ecs/entity';
import { BayFighterComponent } from '../nova_plugin/escorts/index.js';
import { SourceComponent } from '../nova_plugin/ship/index.js';

/**
 * Outfit global id -> how many units of it the player owns that are not
 * currently installed on the docked ship.
 *
 * Resolved lazily (a function, not a map) because the display world
 * keeps stepping and syncing while the player is docked: a fighter can
 * still be shot down mid-visit, and the outfitter re-reads the counts
 * on every trade-state refresh.
 *
 * The argument is the set of outfit ids the player owns, which is how a
 * fighter is attributed to a specific ammo outfit — see
 * `countDeployedFighters`.
 */
export type DeployedOutfitCounts =
    (ownedOutfitIds: Iterable<string>) => ReadonlyMap<string, number>;

/** Sums several deployed-count providers into one. */
export function mergeDeployedCounts(...providers: DeployedOutfitCounts[]):
    DeployedOutfitCounts {
    return ownedOutfitIds => {
        const ids = [...ownedOutfitIds];
        const total = new Map<string, number>();
        for (const provider of providers) {
            for (const [id, count] of provider(ids)) {
                total.set(id, (total.get(id) ?? 0) + count);
            }
        }
        return total;
    };
}

/**
 * Bay weapon id -> the owned outfit that supplies it: the LOWEST-sorted
 * owned outfit whose `ammoFor` is that bay. Shared by both counters so
 * their attribution cannot drift apart.
 */
function ammoOutfitIndex(ownedOutfitIds: Iterable<string>,
    getOutfit: (id: string) => OutfitData | undefined):
    Map<string, string> {
    const ammoOutfitFor = new Map<string, string>();
    for (const id of [...ownedOutfitIds].sort()) {
        const ammoFor = getOutfit(id)?.ammoFor;
        if (ammoFor && !ammoOutfitFor.has(ammoFor)) {
            ammoOutfitFor.set(ammoFor, id);
        }
    }
    return ammoOutfitFor;
}

/**
 * The outfit a bay fighter is charged to on the docked ship, or
 * undefined when it is not one of the docked ship's own.
 *
 * Only a fighter launched straight from the docked ship's OWN bays
 * counts (SourceComponent === the docked ship's uuid). A fighter from a
 * carrier ESCORT's bays — even a level-2 Dart whose Tender the player
 * launched — draws on that escort's outfits, never the player's: it is
 * not refunded to the player's magazine when it docks (bay_plugin's
 * nested-bay rules credit it to its own carrier, or to nothing), so it
 * must not hold a slot of the player's own bay either. RULING (Matthew,
 * 2026-11-27): "Another carrier escort's dart should not count against
 * your limit." The owner chain is therefore deliberately NOT walked.
 */
function chargedOutfit(entity: Entity, carrierUuid: string,
    ammoOutfitFor: ReadonlyMap<string, string>): string | undefined {
    const fighter = entity.components.get(BayFighterComponent);
    if (!fighter
        || entity.components.get(SourceComponent) !== carrierUuid) {
        return undefined;
    }
    return ammoOutfitFor.get(fighter.bayWeaponId);
}

/**
 * Counts the docked player's still-flying bay fighters, keyed by the
 * ammo outfit each one came out of.
 *
 * A fighter carries only the id of the bay weapon that launched it
 * (BayFighterComponent), so it is attributed to the LOWEST-sorted owned
 * outfit whose `ammoFor` is that bay weapon. That is exactly the outfit
 * weapon_plugin's consumeAmmo spent and bay_plugin's refundFighterToBay
 * credits back, so the outfitter's arithmetic lines up with the
 * simulation's even when two outfits supply one bay.
 *
 * A fighter whose bay weapon matches no owned outfit id goes uncounted
 * — the same blind spot as the refund path, and for the same reason:
 * nothing here can enumerate every outfit in the game data to invent an
 * id. In practice consumeAmmo leaves spent entries at zero rather than
 * deleting them, so the id is present.
 *
 * Only fighters launched from the docked ship's OWN bays count; a
 * carrier escort's fighters do not, even on a bay the player also
 * mounts (see chargedOutfit). countLandedFighters applies the same rule
 * to the landed roster, so a fighter counts the same in flight or down.
 *
 * `carrierUuid` is the docked ship's uuid. It is still meaningful even
 * though the ship itself has been pulled out of the display world
 * (browser.ts removes it before opening the spaceport): the fighters
 * left behind still point at it.
 */
export function countDeployedFighters(
    entities: ReadonlyMap<string, Entity>,
    carrierUuid: string,
    getOutfit: (id: string) => OutfitData | undefined): DeployedOutfitCounts {
    return ownedOutfitIds => {
        const ammoOutfitFor = ammoOutfitIndex(ownedOutfitIds, getOutfit);
        const counts = new Map<string, number>();
        for (const entity of entities.values()) {
            const outfitId = chargedOutfit(entity, carrierUuid, ammoOutfitFor);
            if (outfitId !== undefined) {
                counts.set(outfitId, (counts.get(outfitId) ?? 0) + 1);
            }
        }
        return counts;
    };
}

/**
 * Counts the docked player's bay fighters that LANDED with them (the
 * landed-escort roster, spaceport/landed_escorts.ts) — a landed fighter
 * is still deployed (landing does not stow it back into its bay), so it
 * still occupies its magazine slot exactly like one that stayed in
 * flight.
 *
 * Attribution mirrors countDeployedFighters: the fighter names its bay
 * weapon (BayFighterComponent) and is charged to the lowest-sorted owned
 * outfit whose `ammoFor` is that bay — the same outfit consumeAmmo spent
 * and refundFighterToBay would credit.
 *
 * Only fighters launched from the PLAYER'S OWN bays count
 * (SourceComponent === the docked ship's uuid): a fighter from a carrier
 * ESCORT's bays draws on that escort's outfits, which travel inside the
 * escort's own carried entity and never appear in the player's outfitter.
 *
 * `roster` is a getter, not a snapshot: escorts keep landing while the
 * player shops, so the roster grows mid-visit as in-flight fighters
 * (counted by countDeployedFighters) touch down and move over to it —
 * the composed total stays constant.
 */
export function countLandedFighters(
    roster: () => readonly { player: string, entity: Entity }[],
    carrierUuid: string,
    getOutfit: (id: string) => OutfitData | undefined): DeployedOutfitCounts {
    return ownedOutfitIds => {
        const ammoOutfitFor = ammoOutfitIndex(ownedOutfitIds, getOutfit);
        const counts = new Map<string, number>();
        for (const { player, entity } of roster()) {
            if (player !== carrierUuid) {
                continue;
            }
            const outfitId = chargedOutfit(entity, carrierUuid, ammoOutfitFor);
            if (outfitId !== undefined) {
                counts.set(outfitId, (counts.get(outfitId) ?? 0) + 1);
            }
        }
        return counts;
    };
}
