import * as t from 'io-ts';
import { ShipData } from 'novadatainterface/ship_data';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { DisabledComponent } from './disabled_component.js';
import { EscortCommandComponent } from './escort_command.js';
import { escortParent } from './escort_command_plugin.js';
import { FiringGroupComponent } from './firing_group.js';
import { flockParent } from './flock.js';
import { GovtComponent } from './govt_component.js';
import {
    ArmorComponent, FuelComponent, IonizationComponent, ShieldComponent,
} from './health_plugin.js';
import { IsIonizedComponent } from './ionization_plugin.js';
import { NpcComponent } from './npc_ai_plugin.js';
import { FormationComponent } from './npc_ai_plugin.js';
import { OutfitsStateComponent } from './outfit_plugin.js';
import {
    EscortDeal, escortDeal, EscortLandingComponent, escortProvenance,
    NO_DEAL, PlayerEscortComponent, withEscortDeal,
} from './player_escort.js';
import { ControlledByComponent, findControlledEntity } from './ship_control.js';
import {
    deriveShipOutfits, ShipComponent, ShipDataComponent,
    ShipPhysicsComponent,
} from './ship_plugin.js';
import { SystemHoldComponent } from './system_hold.js';
import { TargetComponent } from './target_component.js';
import { SourceComponent } from './weapon_components.js';
import { WeaponsStateComponent } from './weapons_state.js';
import { CargoComponent, cargoUsed } from './cargo_plugin.js';

/**
 * ============================================================================
 * Escort management — the simulation side (deterministic)
 * ============================================================================
 *
 * Hailing one of your OWN escorts opens a management dialog rather than a
 * conversation (PICT 8513; hail/hail_escort.png and
 * hail/hail_captured_escort.png). Its three functions are:
 *
 *   RELEASE  (both kinds)      let the ship go; it stops being yours.
 *                              IMMEDIATE — it happens over the channel.
 *   SELL     (captured only)   cash the hull in for its shïp EscSellValue.
 *                              DEFERRED to the next shipyard.
 *   UPGRADE  (both kinds)      swap the escort's class for its shïp
 *                              UpgradeTo class, for EscUpgrdCost.
 *                              DEFERRED to the next shipyard.
 *
 * The DIALOG is client-side (display/hail_dialog_plugin.ts), like every
 * other comm dialog; each of these has a simulation effect, and every one
 * of them flows through the deterministic input path as an
 * `{ kind: 'escortAction' }` SimulationInput (communication/
 * simulation_input.ts), applied by {@link applyEscortAction} on every peer
 * at the same tick — exactly as a hail bribe is. That is what keeps every
 * peer's picture of the player's fleet identical: nobody's client mutates
 * the world directly, and nothing here draws on a clock or a PRNG.
 *
 * THE RECORD CARRIES INTENT, NOT PRICES. Which escort, and (for an upgrade)
 * which class it claims to be upgrading to; nothing else. Costs, payouts,
 * eligibility and provenance are all recomputed — here for the ones this
 * module settles, and at the pad by spaceport/escort_deals.ts for the two
 * that are deferred — so a tampered client cannot sell a hired escort,
 * upgrade to an arbitrary hull, or name its own price.
 *
 * ---------------------------------------------------------------------------
 * UPGRADE AND SELL ARE DEFERRED, AS IN THE ORIGINAL
 * ---------------------------------------------------------------------------
 *
 * Pressing Upgrade Escort does not refit anything: it QUEUES the deal. The
 * reference captures show the whole flow —
 *
 *   hail/hail_escort_upgrading.png   the readout's "Upgrade Cost:" line has
 *                                    become "Will be upgraded at next
 *                                    shipyard" (STR# 2002 index 291), the
 *                                    channel is still OPEN, and the top
 *                                    button now reads "Cancel Upgrade"
 *                                    (STR# 150 index 52).
 *   hail/sell_captured_escort.png    the same for a sale: "Will be sold off
 *                                    at next shipyard" (STR# 2002 294) in
 *                                    the "Sell Price:" slot, and "Cancel
 *                                    Sale" (STR# 150 54) on the button. The
 *                                    Upgrade Escort button beside it is
 *                                    still LIVE.
 *
 * So the two flags this module writes are the whole of an upgrade's and a
 * sale's simulation effect. They live on the escort's own durable ownership
 * marker (player_escort.ts's PlayerEscort.pendingUpgrade / pendingSale),
 * which is serializer-registered — so they cross the wire, ride rollback
 * snapshots, survive a landing and a jump, and go into the save.
 *
 * WHERE THE MONEY MOVES: at the pad, not here. spaceport/escort_deals.ts
 * settles a queued deal the next time the player lands on a stellar with a
 * shipyard (spöb hasShipyard) — charging EscUpgrdCost and swapping the
 * class, or paying EscSellValue and dropping the escort from the roster
 * that would otherwise lift off with the player. Nothing is charged or
 * paid at queue time, and cancelling costs nothing. That reading is the
 * original's: STR# 2002 keeps "escort was" / "escorts were" / "sold for a
 * profit of" / "upgraded at a cost of" (297-300) as the message it prints
 * when the deal SETTLES, which is where it names the sum.
 *
 * WHY QUEUEING IS NOT GATED ON CREDITS. The button greys when the player
 * cannot afford the upgrade today, but this module accepts the record
 * anyway: a queue is a statement of intent that costs nothing, the money
 * is re-checked when it is actually taken, and a wallet that dips below
 * the price for one tick (a rollback reordering a purchase, say) must not
 * be able to refuse a queue on one peer and accept it on another.
 *
 * RELEASE STAYS IMMEDIATE. There is nothing to settle: the ship simply
 * stops being the player's and flies away.
 */

/**
 * What the player can do to one of their own escorts. `target` is the
 * escort's uuid.
 *
 * Four of the five are TOGGLES of the two queued deals, because the
 * original's buttons are toggles: Upgrade Escort becomes Cancel Upgrade
 * and back, as many times as the player likes, with nothing charged either
 * way.
 */
export type EscortAction =
    /** Let the escort go: it is nobody's, and it leaves the system. */
    | { kind: 'releaseEscort', target: string }
    /**
     * Queue a sale of a CAPTURED escort's hull, to be settled at the next
     * shipyard. Cancels any queued upgrade — an escort is never both.
     */
    | { kind: 'queueSale', target: string }
    /** Un-queue a sale. Nothing was charged, so nothing is refunded. */
    | { kind: 'cancelSale', target: string }
    /**
     * Queue a refit to the escort's shïp UpgradeTo class. `toShip` is the
     * global ship id the client resolved; it is re-derived and checked
     * here, so it can only ever confirm what the escort's own class says,
     * and it is STORED so the settlement can spot a deal whose escort has
     * since changed class some other way. Cancels any queued sale.
     */
    | { kind: 'queueUpgrade', target: string, toShip: string }
    /** Un-queue an upgrade. Nothing was charged, so nothing is refunded. */
    | { kind: 'cancelUpgrade', target: string };

export const EscortActionType: t.Type<EscortAction> = t.union([
    t.type({ kind: t.literal('releaseEscort'), target: t.string }),
    t.type({ kind: t.literal('queueSale'), target: t.string }),
    t.type({ kind: t.literal('cancelSale'), target: t.string }),
    t.type({
        kind: t.literal('queueUpgrade'), target: t.string,
        toShip: t.string,
    }),
    t.type({ kind: t.literal('cancelUpgrade'), target: t.string }),
]);

/**
 * The ship class an upgrade of `escort` would produce, or undefined when it
 * has none — the one place the display and the simulation both ask. Reads
 * the escort's CURRENT class, so an escort that has already been upgraded
 * offers the next step of its chain (a stock Rebel Viper walks Interceptor
 * -> Hvy Fighter -> Light Gunboat this way).
 */
export function escortUpgradeTarget(escort: Entity): string | undefined {
    return escort.components.get(ShipDataComponent)
        ?.escortUpgradeShip ?? undefined;
}

/**
 * Whether `escortUuid` is an escort the hailing player may MANAGE — the
 * same question the comm dialog asks before showing the management box, so
 * the buttons and the simulation cannot disagree about who is manageable:
 *
 *  - it is a ship, and not a player's own ship;
 *  - it is a DIRECT escort of this player (one parent hop — escortParent,
 *    the same link the escort command keys address). A fighter launched
 *    from a carrier ESCORT's bays is indirect and is not manageable on its
 *    own; it belongs to its carrier and goes wherever the carrier goes;
 *  - it is not one of the player's OWN bay fighters (SourceComponent,
 *    which bay_plugin stamps and neither spawnHiredEscorts nor
 *    convertToEscort does). A launched fighter has no wage, no resale value
 *    and no upgrade path — it is ammunition, and selling it would sell a
 *    round out of the player's own magazine.
 */
export function manageableEscort(escort: Entity, playerUuid: string): boolean {
    return escort.components.has(ShipComponent)
        && !escort.components.has(ControlledByComponent)
        && !escort.components.has(SourceComponent)
        && escortParent(escort) === playerUuid;
}

/**
 * Everything that makes a ship the player's, removed — the whole of
 * {@link releaseEscort}'s effect on the named ship.
 *
 * Split out so the two ways an escort stops being yours (Release, and the
 * departure half of a Sell) cannot drift apart.
 *
 * WHY EACH LINK GOES:
 *  - PlayerEscortComponent is the DURABLE ownership marker: while it stands
 *    the escort is swept along on every jump and landing (player_escort_
 *    plugin), is re-attached to the player's formation on arrival, and is
 *    written into the save. Dropping it is what "stops being persisted with
 *    the player" means.
 *  - Formation / bay owner / firing group are the LIVE chain
 *    (flock.ts's flockParent). All three must go together, because
 *    MarkPlayerEscortsSystem re-stamps the marker from whichever of them
 *    survives — leaving any one of them would silently re-recruit the ship
 *    on the next tick. Dropping the firing group also means the player's
 *    shots can hit it and its shots can hit the player again, which is the
 *    honest consequence of letting a ship go.
 *  - The escort command goes so NpcDecisionSystem takes the wheel back (it
 *    yields entirely to an escort command), and the landing order goes
 *    because the stellar it names is the player's business, not this ship's.
 *  - The GOVERNMENT goes: a released escort has no affiliation (Matthew's
 *    spec). It is the same shedding convertToEscort does when the hull was
 *    taken, and it means the ship is neither hostile nor friendly to
 *    anyone — nobody has a reason to shoot it on its way out.
 *  - SystemHoldComponent goes because the whole point is that it LEAVES:
 *    a hold (an unfinished mission errand, a rescue that was waiting) is
 *    exactly what departByJump refuses to jump through, so a held ship
 *    would be released into the system and then stay there forever.
 *
 * Then it is an ordinary NPC that leaves at once: mode 'depart' is the
 * NPC AI's own departure state, and NpcSteeringSystem hands a departing
 * ship to the hyperspace jump sequence on the very next tick (departByJump)
 * — so a released escort visibly stops, turns, spins up and warps out like
 * any other traffic. A ship that somehow has no NPC brain at all (nothing
 * in the escort paths produces one, but a plug-in or a future spawn might)
 * is given one, seeded from its own shïp InherentAI so no PRNG is drawn.
 */
function letGo(escort: Entity): void {
    escort.components.delete(PlayerEscortComponent);
    escort.components.delete(EscortLandingComponent);
    escort.components.delete(EscortCommandComponent);
    escort.components.delete(FormationComponent);
    escort.components.delete(FiringGroupComponent);
    escort.components.delete(GovtComponent);
    escort.components.delete(SystemHoldComponent);

    const target = escort.components.get(TargetComponent);
    if (target) {
        target.target = undefined;
    }
    const npc = escort.components.get(NpcComponent);
    if (npc) {
        npc.mode = 'depart';
        // It has no quarrel with anyone any more, and nowhere it was going.
        npc.aggressor = undefined;
        npc.destination = undefined;
        npc.boardTarget = undefined;
    } else {
        escort.components.set(NpcComponent, {
            aiType: escort.components.get(ShipDataComponent)?.inherentAI ?? 1,
            mode: 'depart',
        });
    }
}

/**
 * Lets `escortUuid` go, together with anything that was following IT.
 *
 * The subtree matters because a carrier escort can have a wing of its own
 * (fighters launched from its bays). Those wings were the player's only
 * through their carrier; once the carrier is nobody's, they must stop being
 * swept along on the player's jumps too, or the player would keep a
 * squadron whose carrier they just gave away. They keep their carrier links
 * — they belong to it, and they leave with it — so only the ownership
 * marker is taken off them; the full release treatment is for the ship the
 * player actually named.
 *
 * The walk is bounded by the entity count and driven by `flockParent`, the
 * same one-hop chain every other ownership question uses, and the released
 * set is returned in uuid order so callers (and specs) see a fixed order on
 * every peer.
 */
export function releaseEscort(escortUuid: string,
    entities: { [Symbol.iterator](): Iterator<[string, Entity]>,
        get(uuid: string): Entity | undefined }): string[] {
    const escort = entities.get(escortUuid);
    if (!escort) {
        return [];
    }
    letGo(escort);
    const released = new Set<string>([escortUuid]);
    // Repeat until nothing new is found: a wing's own wing (a fighter
    // launched from a fighter) is two hops down. Bounded by the number of
    // entities, since each pass adds at least one or stops.
    for (let grew = true; grew;) {
        grew = false;
        for (const [uuid, entity] of entities) {
            if (released.has(uuid)) {
                continue;
            }
            const parent = flockParent(entity);
            if (parent === undefined || !released.has(parent)) {
                continue;
            }
            entity.components.delete(PlayerEscortComponent);
            released.add(uuid);
            grew = true;
        }
    }
    return [...released].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

/**
 * Replaces `escort`'s ship class with `shipData` in place — the upgrade's
 * whole effect on the hull. The uuid, the formation slot, the escort
 * command and the ownership marker are all untouched: it is the same
 * escort, in a better ship.
 *
 * WRITTEN EXPLICITLY, not left to the change-event cascade. ShipDataProvider
 * and ShipOutfitsProvider both re-derive on a ShipComponent change, and
 * their relative order is not declared — so a bare `set(ShipComponent)`
 * could hand the outfits provider the PREVIOUS class's data. Setting the
 * data first and the loadout last means the final state is right whatever
 * order the providers happen to run in, and the writes are idempotent with
 * what they would have produced.
 *
 * The rest is DELETED so it is rebuilt from the new class:
 *  - physics and weapon state are pure derivations of class + outfits (the
 *    outfitter already deletes ShipPhysicsComponent for exactly this reason
 *    — see ship_plugin's note on off-world re-derivation);
 *  - the STATS go so the hull comes back at full shields, armor, fuel and
 *    no ionization: this is a new ship, not a repair. shipStatSystem
 *    re-attaches each of them from the new physics with its full initial
 *    value, which is also why the damage a stat carried cannot leak into a
 *    smaller (or larger) new capacity. Any lingering disable goes with them
 *    — a hulk that was disabled is not disabled once it is a different ship.
 *
 * There is a one-tick window in which the escort has no physics and no
 * stats while the providers catch up. That is the same window every
 * freshly inserted entity has, and it is identical on every peer because
 * the input applies at the same tick everywhere and the target class's game
 * data is staged before it does.
 */
export function replaceEscortShipClass(escort: Entity, shipId: string,
    shipData: ShipData): void {
    escort.components.set(ShipDataComponent, shipData);
    escort.components.set(ShipComponent, { id: shipId });
    escort.components.set(OutfitsStateComponent, deriveShipOutfits(shipData));
    escort.components.delete(ShipPhysicsComponent);
    escort.components.delete(WeaponsStateComponent);
    escort.components.delete(ShieldComponent);
    escort.components.delete(ArmorComponent);
    escort.components.delete(FuelComponent);
    escort.components.delete(IonizationComponent);
    escort.components.delete(IsIonizedComponent);
    escort.components.delete(DisabledComponent);
    // Fleet cargo lives in the escort's own hold (fleet_cargo.ts). A hull
    // swap to a smaller ship would otherwise carry tons above the new
    // capacity into the fleet manifest and the save (review r15 C3). The
    // physics that knows the exact outfit-adjusted capacity is rebuilt
    // asynchronously, so clamp to the new hull's BASE hold now, evicting
    // by sorted key for determinism; the provider-derived free space can
    // only be larger than that, never smaller (stock loadouts add hold,
    // never remove it), so nothing legitimately aboard is dropped.
    const cargo = escort.components.get(CargoComponent);
    if (cargo) {
        let over = cargoUsed(cargo) - shipData.physics.freeCargo;
        for (const key of [...cargo.keys()].sort().reverse()) {
            if (over <= 0) {
                break;
            }
            const tons = cargo.get(key) ?? 0;
            const drop = Math.min(tons, over);
            over -= drop;
            if (drop >= tons) {
                cargo.delete(key);
            } else {
                cargo.set(key, tons - drop);
            }
        }
    }
}

/**
 * Rewrites the escort's ownership marker with its queued deal set to
 * `deal`, leaving every other field alone (player_escort.ts's
 * withEscortDeal, which is also what keeps the two deal kinds exclusive
 * and an unqueued deal ABSENT rather than undefined).
 *
 * `set(...)` rather than a field assignment: the marker is a plain
 * serialized object, and writing a whole new value is what the delta maker
 * and the desync hash see.
 */
function setEscortDeal(escort: Entity, deal: EscortDeal): void {
    const existing = escort.components.get(PlayerEscortComponent);
    if (!existing) {
        return;
    }
    escort.components.set(PlayerEscortComponent,
        withEscortDeal(existing, deal));
}

/**
 * Applies an escort-management action deterministically on every peer.
 * Resolves the acting player from `peerId` and the escort from the record,
 * then re-checks EVERYTHING against synced state before mutating anything:
 * ownership, provenance, and the upgrade target.
 *
 * Only RELEASE has an effect on the world here. The other four write (or
 * clear) the two queued-deal flags on the escort's ownership marker; the
 * money and the hull swap happen at the next shipyard, in
 * spaceport/escort_deals.ts. See the module comment.
 */
export function applyEscortAction(world: World, peerId: string | undefined,
    action: EscortAction): void {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const escort = world.entities.get(action.target);
    if (!escort || !manageableEscort(escort, found.uuid)) {
        return;
    }
    // Ownership is checked TWICE, and deliberately: the live one-hop link
    // above says the player commands it, and the durable marker says it is
    // theirs. They agree in every ordinary case; requiring both means a
    // ship that merely happens to hold formation on the player (an NPC
    // fleet member whose leader the player became) cannot be sold.
    const owned = escort.components.get(PlayerEscortComponent);
    if (owned?.player !== found.uuid) {
        return;
    }

    switch (action.kind) {
        case 'releaseEscort':
            releaseEscort(action.target, world.entities);
            return;
        case 'cancelUpgrade':
            // Always honoured: un-queueing must never be refusable, or a
            // player whose circumstances changed (they sold the outfit that
            // unlocked the target class, they went broke) would be stuck
            // with a deal they cannot cancel. Cancels ONLY an upgrade: a
            // queued sale is a different deal and stays.
            if (escortDeal(owned).kind === 'upgrade') {
                setEscortDeal(escort, NO_DEAL);
            }
            return;
        case 'cancelSale':
            if (escortDeal(owned).kind === 'sale') {
                setEscortDeal(escort, NO_DEAL);
            }
            return;
        case 'queueSale': {
            // ONLY A CAPTURED HULL IS THE PLAYER'S TO SELL. A hired pilot's
            // ship was never the player's property — the original greys
            // "Sell Escort" on hail/hail_escort.png for exactly this reason
            // — so a record naming a hired escort is refused rather than
            // honoured. The price is NOT computed here; escort_deals.ts
            // re-derives shïp EscSellValue when the sale settles.
            if (escortProvenance(escort) !== 'captured') {
                return;
            }
            // Mutually exclusive with an upgrade: an escort cannot be both
            // sold off and refitted at the same visit, and the original
            // keeps the other button LIVE rather than greying it
            // (hail/sell_captured_escort.png still offers Upgrade Escort),
            // so pressing one CANCELS the other rather than being refused.
            setEscortDeal(escort, { kind: 'sale' });
            return;
        }
        case 'queueUpgrade': {
            const shipData = escort.components.get(ShipDataComponent);
            if (!shipData) {
                return; // Not fully built yet; the player can press again.
            }
            // The class comes from the escort's OWN shïp UpgradeTo, never
            // from the record: `toShip` is only allowed to confirm it.
            const upgradeTo = shipData.escortUpgradeShip;
            if (upgradeTo === null || upgradeTo !== action.toShip) {
                return;
            }
            // NOT gated on credits, and nothing is staged: no ship is built
            // on this tick. The target class is loaded (and the money
            // checked) by the client that settles the deal at the pad.
            setEscortDeal(escort, { kind: 'upgrade', toShip: upgradeTo });
            return;
        }
    }
}
