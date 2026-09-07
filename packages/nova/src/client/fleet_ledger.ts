/**
 * ============================================================================
 * The client's fleet bookkeeping
 * ============================================================================
 *
 * What the client holds for the local player's fleet while the fleet is
 * not (all) in the simulation: the two escort rosters
 * (spaceport/landed_escorts.ts explains them), the LOST roster (escorts
 * that vanished from the world without dying — ruling #148, see
 * `noteRemoved`), the formation-slot floor, and the escorts a loaded save
 * is still carrying as encoded blobs. Plus the operations over them that
 * browser.ts used to spread across a dozen functions: the take-and-restock
 * drains, the standing flushes, the bar hire spawn, the mission-ship
 * preparation, and the "what escorts does this pilot own" read the save
 * takes.
 *
 * One ledger per client, RESET by the session teardown: the rosters
 * belong to a session, and a batch left over would be dealt into the next
 * pilot's first system.
 *
 * Client-local module: everything here goes into the simulation through
 * the bridge's input-record path (client/fleet_insertion.ts).
 */
import { isLeft } from 'fp-ts/lib/Either.js';
import type { Entity } from 'nova_ecs/entity';
import type { Serializer } from 'nova_ecs/plugins/serializer_plugin';
import type { World } from 'nova_ecs/world';
import { v4 } from 'uuid';
import type {
    AsyncSimulationBridgeClient,
} from '../communication/async_simulation_bridge_client.js';
import { countsTowardEscortCap } from '../nova_plugin/escorts/index.js';
import {
    buildMissionShipSpawns, liveMissionShips,
} from '../nova_plugin/missions/index.js';
import { FormationComponent } from '../nova_plugin/npc/index.js';
import { PlayerEscortComponent, PlayerShipSelector } from '../nova_plugin/player/index.js';
import {
    collectEscortsToSave, EscortToSave, SavedEscort,
} from '../nova_plugin/pilot/index.js';
import { restockCarriedEscorts } from '../spaceport/escort_restock.js';
import {
    carriedBatchSettled, CarriedEscort, escortsAccountedFor,
    takeCarriedEscorts,
} from '../spaceport/landed_escorts.js';
import { MissionUniverse } from '../spaceport/mission_universe.js';
import {
    buildHiredEscort, insertEscortBatch,
} from './fleet_insertion.js';
import type { SimulationGameData } from './gamedata/simulation_game_data.js';

/**
 * The escorts a loaded save is still holding, as ENCODED blobs, with the
 * two facts needed to decode them faithfully.
 *
 * They cannot be decoded when the save is read: startGame reads it
 * before any system world exists, and the entity serializer comes out of
 * that world. So the blobs wait here and are drained by the first system
 * entry — which, for a session that loaded a save, is the startup
 * transit. Draining makes it one-shot, and the escorts join that
 * transition's ordinary carried batch, so they re-enter through the same
 * prepareCarriedEscorts / addEntity path a liftoff or a jump uses rather
 * than a second pipeline.
 */
export interface RestoredSaveEscorts {
    readonly escorts: SavedEscort[];
    /**
     * The player ship uuid the save was written under. The restored
     * player is a NEW entity under a NEW uuid, so every reference the
     * saved escorts hold to their player is stale; carried onto each
     * restored entry as CarriedEscort.priorPlayer, which is what lets
     * prepareCarriedEscorts rewrite a player-launched fighter's
     * OwnerComponent/SourceComponent onto the live player.
     */
    readonly playerUuid: string | undefined;
    /**
     * The weapon ids the save's OWN outfits mount or feed
     * (savedFleetArmament). Used only to spot the PHANTOM BAY FIGHTERS an
     * older build could write into a save's escort array. Undefined when
     * the pilot's outfits could not all be resolved, which disables the
     * cleanup outright. See SavedFleetOwner in save_game.ts.
     */
    readonly armament: ReadonlySet<string> | undefined;
}

export class FleetLedger {
    /**
     * Escorts that landed with the player (EscortLandedEvent), held while
     * the player is docked and respawned on departure. The client-side
     * half of the landing split, exactly like the docked ship.
     */
    readonly landed: CarriedEscort[] = [];
    /**
     * Escorts the simulation handed over because their player is jumping
     * (EscortJumpEvent). Filled synchronously while the frame's events are
     * dispatched and consumed by the jumpTo they belong to — which always
     * runs later, because the FinishJumpEvent handler awaits the date
     * advance before calling it. That is the ordering guarantee that
     * keeps the carry ahead of the origin teardown's entity purge.
     *
     * Also where a batch WAITS OUT a multi-jump chain. The arrival hands
     * the batch back to this array instead of inserting it whenever the
     * arriving player is going to auto-continue (multiJumpChainContinues),
     * so each further hop simply picks it up again; flushCarriedJumpEscorts
     * puts it down once the chain settles. That is what stops the chain
     * out-running the insertion records and stranding escorts in an
     * intermediate system.
     */
    readonly jumping: CarriedEscort[] = [];
    /**
     * ========================================================================
     * LOST, NOT DESTROYED (maintainer ruling #148)
     * ========================================================================
     *
     * Hired and captured escorts that LEFT THE WORLD WITHOUT DYING and
     * without being carried: an insertion that never took (a rejected
     * record), a rollback correction or a resync that removed the entity,
     * a desync of any kind. The ruling is that such a ship must not
     * disappear and never return, while a ship that was DESTROYED stays
     * destroyed — so the two are told apart here, at the one place the
     * client sees every removal: the display world's mirror of the
     * simulation ({@link noteRemoved}, fed by the frame pump).
     *
     *   destroyed   a DeathEvent was seen for the uuid ({@link noteDeath})
     *               — the entity is gone for good and is NOT recorded;
     *   carried     the same frame's EscortJumpEvent / EscortLandedEvent
     *               filed it on `jumping` / `landed` — not lost, it is
     *               riding a roster already;
     *   lost        everything else: recorded here, whole, as the escort
     *               stood on its last mirrored frame (the synced
     *               components, through the serializer), and RETRIED on
     *               the player's next system entry through the ordinary
     *               carried batch (system_entry.ts takes this roster with
     *               the other two — fresh uuids, formation stations,
     *               commands reset). Until then it rides the save like a
     *               landed escort, so it survives a session too.
     *
     * Bay fighters and mission escorts are never recorded: a fighter that
     * docks with its carrier is deleted without dying and is the
     * magazine's business, and a mission ship is respawned by the mission
     * machinery (mission_ship_spawn.ts). An entity the world re-adds
     * under the same uuid (a correction that removed and restored it) is
     * taken back off this roster ({@link escortReturned}).
     *
     * A per-player client roster like the other two: entries for other
     * peers' players are dropped when the roster is taken, never
     * respawned by this client.
     */
    readonly lost: CarriedEscort[] = [];
    /**
     * Uuids a DeathEvent was seen for, so a removal that follows one is
     * read as a destruction (see `lost`). Bounded: the newest
     * RECENT_DEATHS entries are kept, which is orders of magnitude more
     * than the frames between a death and its entity's removal.
     */
    private readonly recentDeaths = new Set<string>();
    /** See RestoredSaveEscorts. Drained by the first system entry. */
    restoredSave: RestoredSaveEscorts | undefined;
    /**
     * The end of the formation-slot run the client has already handed out
     * for a player, so a later insertion in the same session cannot reuse
     * those slots. The display world is not a safe floor on its own: it
     * does not see a launch's own batches until a later frame, and an
     * insertion record can land beyond the ticks a frame stepped (see
     * SimulationBridgeClient.schedule), so a late flush could otherwise
     * duplicate the launch's slots and stack two escorts on one station.
     */
    private slotFloor: { player: string, next: number } | undefined;

    /** Every roster, in the order the save unions them. */
    get rosters(): readonly CarriedEscort[][] {
        return [this.landed, this.jumping, this.lost];
    }

    // ── Lost versus destroyed (ruling #148; see `lost`) ─────────────────

    /** A DeathEvent was seen for `uuid`: its removal is a destruction. */
    noteDeath(uuid: string): void {
        this.recentDeaths.add(uuid);
        if (this.recentDeaths.size > RECENT_DEATHS) {
            const oldest = this.recentDeaths.values().next().value;
            if (oldest !== undefined) {
                this.recentDeaths.delete(oldest);
            }
        }
    }

    /**
     * The display world is about to drop `entity` (the simulation removed
     * it this frame; the frame's events have already been emitted, so a
     * carry event has filed it and a death has been noted). Records it on
     * `lost` when it is a hired or captured escort of `player` (or of any
     * player when `player` is undefined — the local player is between
     * worlds; the take filters by player) that neither died nor was
     * carried. Returns whether it was recorded.
     *
     * The entity kept is a serializer round trip of the display entity:
     * the synced components only, as a carry event would have handed
     * them over, and a copy the display world's teardown cannot touch. A
     * display entity that does not round-trip is kept as it is rather
     * than dropped.
     */
    noteRemoved(uuid: string, entity: Entity, player: string | undefined,
        serializer: Serializer): boolean {
        const marker = entity.components.get(PlayerEscortComponent);
        if (!marker || (player !== undefined && marker.player !== player)) {
            return false;
        }
        if (!countsTowardEscortCap(entity) || this.recentDeaths.has(uuid)) {
            return false;
        }
        if (this.rosters.some(roster => roster.some(row => row.uuid === uuid))) {
            return false;
        }
        const decoded = serializer.decode(serializer.encode(entity));
        const kept = isLeft(decoded) ? entity : decoded.right;
        this.lost.push({ player: marker.player, uuid, entity: kept });
        console.warn(`Escort ${uuid} left the world without dying; it will `
            + 'be respawned when its player next enters a system.');
        return true;
    }

    /**
     * The world holds `uuid` again (a correction removed and restored the
     * same entity): it was never lost.
     */
    escortReturned(uuid: string): void {
        const index = this.lost.findIndex(row => row.uuid === uuid);
        if (index >= 0) {
            this.lost.splice(index, 1);
        }
    }

    /**
     * Takes the lost roster for `player` — the retry, at a system entry
     * — dropping other peers' entries (this client never respawns them),
     * and any entry the caller's batch already carries under the same
     * uuid (an escort carried by a jump AND recorded lost by a correction
     * in between must not be doubled).
     */
    takeLost(player: string, carried: Iterable<string> = []): CarriedEscort[] {
        const already = new Set(carried);
        const taken = takeCarriedEscorts(this.lost, player)
            .filter(row => !already.has(row.uuid));
        this.lost.length = 0;
        return taken;
    }

    /**
     * Records that this client has handed out formation slots up to (but
     * not including) `next` for `player`.
     */
    noteSlotsUsed(player: string, next: number): void {
        this.slotFloor = this.slotFloor?.player === player
            ? { player, next: Math.max(this.slotFloor.next, next) }
            : { player, next };
    }

    /** A fresh world has a fresh slot run. */
    resetSlotFloor(): void {
        this.slotFloor = undefined;
    }

    /** The first slot a fresh insertion for `player` may use. */
    nextClientSlot(displayWorld: World, player: string): number {
        const floor = this.slotFloor?.player === player
            ? this.slotFloor.next : 0;
        return Math.max(nextFormationSlot(displayWorld, player), floor);
    }

    /**
     * Files a carry event's escort on a roster, DEDUPED BY UUID: the
     * bridge's rollback dedup (settle-tick stamps) keeps a correction
     * from re-forwarding these, but a duplicate here would silently CLONE
     * an escort at the next transition — cheap insurance at the seam that
     * turns events into roster rows (deep audit follow-up, 2026-08-29).
     * The newest handover wins: the sim serialized the entity at the
     * moment it left the world.
     */
    pushCarried(rows: CarriedEscort[],
        data: { player: string, uuid: string, entity: Entity }): void {
        const row = { player: data.player, uuid: data.uuid, entity: data.entity };
        const existing = rows.findIndex(r => r.uuid === data.uuid);
        if (existing >= 0) {
            rows[existing] = row;
            return;
        }
        rows.push(row);
    }

    /**
     * Takes the landed roster for `player`, dropping other peers' entries
     * (this client would never respawn them). No restock: the callers
     * that are a lift-off use `takeLandedEscortsRestocked`.
     */
    takeLandedEscorts(player: string): CarriedEscort[] {
        const taken = takeCarriedEscorts(this.landed, player);
        this.landed.length = 0;
        return taken;
    }

    /**
     * Takes the landed roster for `player` and hands it back refuelled
     * and rearmed: an escort that put down with its player leaves the pad
     * with full fuel and full magazines, free of charge (escort_restock.ts
     * explains why that differs from the player's own PAID refuel).
     *
     * ONLY THE LIFT-OFF PATHS USE THIS. The service is for escorts that
     * actually spent time at a port: the spaceport launch, the gate
     * lift-off that puts the player back in the system it docked from,
     * and the late flush that catches an escort which landed just after
     * one of those. The jump roster never gets it, and neither does a
     * transit's drain of the landed roster — a hypergate or wormhole
     * transit taken while docked AT the gate carries the landed escorts
     * through to another system, and passing through a gate is not a
     * port visit (takeEscortsForTransition).
     */
    async takeLandedEscortsRestocked(player: string,
        gameData: SimulationGameData): Promise<CarriedEscort[]> {
        const taken = this.takeLandedEscorts(player);
        try {
            await restockCarriedEscorts(taken, {
                getOutfit: id => gameData.data.Outfit.get(id),
                getWeapon: id => gameData.data.Weapon.get(id),
            });
        } catch (e) {
            // The roster was emptied before the (network-bound) restock;
            // a failure there must not take the batch with it (issue #31).
            this.landed.push(...taken);
            throw e;
        }
        return taken;
    }

    /**
     * Every escort belonging to `player` that this client can still
     * account for, as the save wants them: the ones live in the system
     * (in flight), the landed roster held while docked, any batch riding
     * a jump, and the lost roster (an escort that vanished without dying
     * is still the player's, and comes back at the next system entry —
     * of this session or the next). The rosters are disjoint in practice
     * but unioned by uuid anyway, because the landing window overlaps
     * them — an escort still flying to the planet is in the world while
     * its already-landed wingmates are on the roster.
     *
     * ESCORTS IN OTHER SYSTEMS ARE NOT HERE, by construction: this reads
     * the active system and the client's own rosters, and a ship left
     * behind by the zero-energy jump exclusion is in neither.
     */
    escortsToSave(player: string, displayWorld: World | undefined):
        EscortToSave[] {
        return collectEscortsToSave(player, displayWorld?.entities ?? [],
            this.rosters);
    }

    /**
     * The same-system convergence invariant, live (the `novaEscortAudit`
     * lever). Called with no `expected` it is a REPORT — where the local
     * player's escorts are right now; with a list of uuids it is a CHECK
     * and `stranded` must be empty. A headless harness that knows what it
     * spawned is the caller that can supply real ground truth.
     */
    audit(displayWorld: World, expected?: string[]) {
        const playerUuid = localPlayerShipUuid(displayWorld);
        if (!playerUuid) {
            return null;
        }
        const inWorld: string[] = [];
        for (const [entityUuid, entity] of displayWorld.entities) {
            if (entity.components.get(PlayerEscortComponent)?.player
                === playerUuid) {
                inWorld.push(entityUuid);
            }
        }
        const known = expected ?? [...inWorld, ...this.rosters.flatMap(
            roster => roster.filter(({ player }) => player === playerUuid)
                .map(({ uuid }) => uuid))];
        return escortsAccountedFor(playerUuid, known, inWorld, this.rosters);
    }

    /** What the client is holding, by uuid (the `novaEscortRosters` lever). */
    summary() {
        const strip = ({ player, uuid }: CarriedEscort) => ({ player, uuid });
        return {
            landed: this.landed.map(strip),
            jumping: this.jumping.map(strip),
            lost: this.lost.map(strip),
        };
    }

    /** The session is over: nothing held carries into the next one. */
    reset(): void {
        this.landed.length = 0;
        this.jumping.length = 0;
        this.lost.length = 0;
        this.recentDeaths.clear();
        this.restoredSave = undefined;
        this.slotFloor = undefined;
    }
}

/** How many death uuids the ledger remembers (see FleetLedger.noteDeath). */
const RECENT_DEATHS = 256;

/** The local player's ship uuid in a display world, if it is in flight. */
export function localPlayerShipUuid(displayWorld: World): string | undefined {
    for (const [uuid, entity] of displayWorld.entities) {
        if (entity.components.has(PlayerShipSelector)) {
            return uuid;
        }
    }
    return undefined;
}

/** The local player's ship entity in a display world, if in flight. */
export function getPlayerShipEntity(displayWorld: World): Entity | undefined {
    for (const entity of displayWorld.entities.values()) {
        if (entity.components.has(PlayerShipSelector)) {
            return entity;
        }
    }
    return undefined;
}

/**
 * The first free formation slot on `leaderUuid` in the display world
 * (used to continue slot numbering across spawn batches).
 */
export function nextFormationSlot(displayWorld: World, leaderUuid: string):
    number {
    let slot = 0;
    for (const entity of displayWorld.entities.values()) {
        const formation = entity.components.get(FormationComponent);
        if (formation?.leader === leaderUuid) {
            slot = Math.max(slot, formation.slot + 1);
        }
    }
    return slot;
}

/** The dependencies the insertion helpers below need. */
export interface FleetContext {
    readonly fleet: FleetLedger;
    readonly gameData: SimulationGameData;
    /** This client's peer uuid, once the socket has one. */
    ownerUuid(): string | undefined;
}

/**
 * The bar-hire spawn on its own, for the `novaSpawnEscorts` test lever:
 * the lift-off paths spawn their hires inside the one fleet-insertion
 * sequence (client/fleet_insertion.ts), and this is the same builder
 * without the player insertion in front of it.
 */
export async function spawnHiredEscorts(ctx: FleetContext,
    bridge: AsyncSimulationBridgeClient, displayWorld: World,
    leaderUuid: string, leader: Entity, shipIds: string[]): Promise<void> {
    let slot = ctx.fleet.nextClientSlot(displayWorld, leaderUuid);
    ctx.fleet.noteSlotsUsed(leaderUuid, slot + shipIds.length);
    for (const shipId of shipIds) {
        let escort: Entity | undefined;
        try {
            const shipData = await ctx.gameData.data.Ship.get(shipId);
            escort = buildHiredEscort(shipData, leaderUuid, leader, slot,
                ctx.ownerUuid());
        } catch (e) {
            console.warn(`Failed to build hired escort ${shipId}:`, e);
            continue;
        }
        if (!escort) {
            console.warn('Hired escorts skipped: leader has no movement '
                + 'state');
            return;
        }
        const uuid = v4();
        try {
            await bridge.addEntity(uuid, escort);
        } catch (e) {
            // Same policy as the lift-off's insertion (fleet_insertion.ts,
            // ruling #148): a built hire that could not go in is the
            // player's already, and the standing flush retries it.
            console.warn(`Failed to insert hired escort ${shipId}; it will `
                + 'be retried:', e);
            ctx.fleet.jumping.push({ player: leaderUuid, uuid, entity: escort });
        }
        slot++;
    }
}

/**
 * Re-inserts escorts the simulation handed over (landed with the player,
 * or departed with them into hyperspace) at formation stations on their
 * leader, and RETURNS THE ONES THAT COULD NOT BE INSERTED so the caller
 * can put them back on a roster (client/fleet_insertion.ts has the whole
 * policy; issue #31). The standing flushes retry them on a later frame.
 */
async function insertCarriedEscorts(ctx: FleetContext,
    bridge: AsyncSimulationBridgeClient, displayWorld: World,
    leaderUuid: string, leader: Entity, escorts: CarriedEscort[]):
    Promise<CarriedEscort[]> {
    const base = ctx.fleet.nextClientSlot(displayWorld, leaderUuid);
    ctx.fleet.noteSlotsUsed(leaderUuid, base + escorts.length);
    const { failed } = await insertEscortBatch(bridge, leaderUuid, leader,
        escorts, base, v4, ctx.ownerUuid());
    return failed;
}

/**
 * Re-inserts any landed escorts that arrived AFTER the launch already
 * consumed the roster. An escort can slip into the landing window in the
 * very simulation step that applies the player's relaunch record, and it
 * must not be stranded out of the world (ownership is never lost by
 * landing and departing). Also drops other peers' entries, which this
 * client never respawns.
 */
export async function flushLandedEscorts(ctx: FleetContext,
    bridge: AsyncSimulationBridgeClient, displayWorld: World): Promise<void> {
    const playerUuid = localPlayerShipUuid(displayWorld);
    if (!playerUuid) {
        return; // Not in flight yet; keep holding the roster.
    }
    const leader = displayWorld.entities.get(playerUuid);
    if (!leader) {
        return; // Keep the roster rather than dropping it on the floor.
    }
    const mine = await ctx.fleet.takeLandedEscortsRestocked(playerUuid,
        ctx.gameData);
    if (mine.length === 0) {
        return;
    }
    // Whatever could not go in goes back on the roster for the next frame.
    ctx.fleet.landed.push(...await insertCarriedEscorts(ctx, bridge,
        displayWorld, playerUuid, leader, mine));
}

/**
 * Puts down a batch that has been riding along with a multi-jump chain,
 * once the chain has settled (the player is in flight with no jump in
 * progress and no auto-continue pending — multiJumpChainSettled).
 *
 * Runs every frame the player is in flight and not docked, so it is also
 * the recovery path for a chain that ended early (route exhausted, fuel
 * out) and for the ordinary case of a batch that somehow outlived its
 * arrival. While the player is between simulations there is no display
 * entity to ask, so the batch is simply kept: dropping it is the one
 * thing that must never happen.
 */
export async function flushCarriedJumpEscorts(ctx: FleetContext,
    bridge: AsyncSimulationBridgeClient, displayWorld: World): Promise<void> {
    const playerUuid = localPlayerShipUuid(displayWorld);
    if (!playerUuid) {
        return; // Mid-transition; keep holding the batch.
    }
    const leader = displayWorld.entities.get(playerUuid);
    if (!leader || !carriedBatchSettled(leader)) {
        // Still chaining, still being placed at the arrival gate, or
        // nothing to read: hold.
        return;
    }
    const mine = takeCarriedEscorts(ctx.fleet.jumping, playerUuid);
    ctx.fleet.jumping.length = 0;
    if (mine.length === 0) {
        return;
    }
    // Whatever could not go in goes back on the roster for the next frame.
    ctx.fleet.jumping.push(...await insertCarriedEscorts(ctx, bridge,
        displayWorld, playerUuid, leader, mine));
}

/**
 * Mission special/aux ships entering with the player — the owning
 * client's half of the multiplayer design in mission_ship_plugin.ts.
 * Must run BEFORE the player entity is encoded into its own insertion
 * record: it reconciles the mission-ship rosters on the entity (so the
 * reconciled state rides that record) and builds the ships whose spawn
 * system matches. The fleet insertion then pushes them through the same
 * input-record addEntity path as hired escorts, after the owner is in
 * (the goal systems track ships against their owner's mission state).
 *
 * `world` is the world the player is entering, when it is one that can
 * ALREADY HOLD this mission's ships: a LIFT-OFF puts the player back
 * into the very system they landed in, whose previous batch is swept by
 * the owner-absence cleanup but need not have been swept yet. Only the
 * shortfall is then built, so a batch is never doubled (see
 * liveMissionShips). A jump or a gate transit passes nothing: that
 * destination world is built from scratch and holds none of them.
 */
export async function prepareMissionShips(gameData: SimulationGameData,
    playerEntity: Entity, playerUuid: string, systemId: string,
    firstSlot: number, world?: World): Promise<Entity[]> {
    try {
        const universe = MissionUniverse.shared(gameData);
        await universe.load();
        return await buildMissionShipSpawns(playerEntity, playerUuid,
            systemId, gameData, universe, firstSlot, Math.random,
            world ? liveMissionShips(world.entities, playerUuid) : undefined);
    } catch (e) {
        console.warn('Failed to prepare mission ships:', e);
        return [];
    }
}
