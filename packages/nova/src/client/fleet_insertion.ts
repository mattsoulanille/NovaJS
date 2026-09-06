import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { ShipData } from 'novadatainterface/ship_data';
import { EscortCommandComponent } from '../nova_plugin/escort_command.js';
import { FiringGroupComponent } from '../nova_plugin/firing_group.js';
import {
    FormationComponent, formationSlotPosition,
} from '../nova_plugin/npc_ai_plugin.js';
import { makeNpcShip } from '../nova_plugin/npc_spawn_plugin.js';
import { PlayerEscortComponent } from '../nova_plugin/player_escort.js';
import { ControlledByComponent } from '../nova_plugin/ship_control.js';
import {
    CarriedEscort, prepareCarriedEscorts,
} from '../spaceport/landed_escorts.js';

/**
 * ============================================================================
 * THE ONE "insert the player and its fleet" sequence
 * ============================================================================
 *
 * Three places put the local player's ship (back) into a simulation
 * world, each followed by the ships that travel with it: the arrival in a
 * fresh system (browser.ts's enterSystem — a jump, a gate, the startup
 * entry), the lift-off from a spaceport, and the lift-off from a hypergate
 * whose map was closed without a pick. They used to be three hand-written
 * copies of the same ritual, and the copies had drifted in exactly the
 * places the review found bugs (issue #73): only one stamped the
 * multiplayer identity, only one returned a failed batch to its roster.
 * This module is the single sequence, with a single failure policy.
 *
 * THE SEQUENCE. The player entity is inserted first (every follower's
 * ownership and formation names it), then the carried escorts at
 * formation stations around it, then the escorts hired at the bar, then
 * the mission ships whose spawn this is. Everything goes through the
 * bridge's addEntity, i.e. through the input-record path — deterministic
 * across peers because the fully built entity is baked into the record.
 *
 * THE FAILURE POLICY (issue #31, "never drop a single escort"):
 *  - If the PLAYER's insertion rejects, nothing has gone in. The call
 *    rethrows and the caller keeps everything it was holding: the
 *    escorts go back to the roster they came from, the hires back onto
 *    the docked entity's PendingEscortsComponent.
 *  - If an ESCORT's insertion rejects, that escort is returned in
 *    `failed`, under the uuid it was about to be inserted under, so the
 *    caller can put it back on a roster for the standing flush to retry.
 *    The minted uuid matters: the batch's intra-batch references (a
 *    fighter naming its carrier) have already been rewritten to it, so a
 *    retry that remaps from THIS uuid keeps a carrier-and-wing pair
 *    together even when both failed.
 *  - A hire or a mission ship that cannot be spawned is logged and
 *    dropped. A hire is a ship id whose data the bar has already fetched
 *    and a mission ship is rebuilt by the mission machinery on the next
 *    entry; neither carries state that cannot be rebuilt. (Documented
 *    limit; see the report for issue #31.)
 *
 * Formation slots run from `baseSlot`: the carried escorts first, then the
 * hires. The mission ships were placed by prepareMissionShips from a slot
 * the caller computed the same way, before the player was encoded.
 */

/** The part of the simulation bridge this module needs. */
export interface FleetBridge {
    addEntity(uuid: string, entity: Entity): Promise<void>;
}

export interface FleetInsertion {
    bridge: FleetBridge;
    /** The uuid the player is inserted under. */
    playerUuid: string;
    player: Entity;
    /**
     * The carried escorts to place in formation. Already restocked when
     * the caller is a lift-off (escort_restock.ts).
     */
    escorts: readonly CarriedEscort[];
    /** Ship ids hired at the bar this landing. */
    hires?: readonly string[];
    /** Mission ships, already built by prepareMissionShips. */
    missionShips?: readonly Entity[];
    /**
     * This client's peer uuid. When given, the player is stamped as
     * owned and controlled by it, and every follower as owned by it, so
     * removePeer cleans them all up if this client vanishes.
     */
    ownerUuid?: string;
    /** The first formation slot this insertion may use. */
    baseSlot: number;
    mintUuid: () => string;
    getShip: (id: string) => Promise<ShipData>;
}

export interface FleetInsertionResult {
    /**
     * Escorts whose insertion rejected, keyed by the uuid they were about
     * to be inserted under (see the module comment). Empty on success.
     */
    failed: CarriedEscort[];
    /** The slot after the last one this insertion handed out. */
    nextSlot: number;
}

/**
 * Builds one escort hired at the bar: an NPC hull in formation on the
 * leader, under the default escort command, in the player's firing
 * group, with the durable 'hired' provenance that makes the comm dialog
 * charge a daily wage and refuse to sell it (it was never the player's —
 * see player_escort.ts's provenance and spaceport/escort_fees.ts).
 */
export function buildHiredEscort(shipData: ShipData, leaderUuid: string,
    leader: Entity, slot: number, ownerUuid?: string): Entity | undefined {
    const movement = leader.components.get(MovementStateComponent);
    if (!movement) {
        return undefined;
    }
    const position = formationSlotPosition(
        movement.position, movement.rotation, slot);
    const escort = makeNpcShip(shipData, 0, null, position,
        movement.rotation, new Vector(0, 0));
    escort.components.set(FormationComponent, { leader: leaderUuid, slot });
    // Fresh escorts start under the default escort command; spawning
    // here (on liftoff / system entry) IS the "commands reset to
    // formation" rule.
    escort.components.set(EscortCommandComponent, { command: 'formation' });
    // Hired escorts share the player's firing group so their shots pass
    // through the player (and vice versa via the owner-root fallback) —
    // same friendly-fire immunity as NPC fleets.
    escort.components.set(FiringGroupComponent, { group: leaderUuid });
    // Durable ownership from the first tick (the simulation's
    // MarkPlayerEscortsSystem would stamp this anyway, one tick later,
    // from the formation link).
    escort.components.set(PlayerEscortComponent,
        { player: leaderUuid, parent: leaderUuid, provenance: 'hired' });
    if (ownerUuid) {
        escort.components.set(MultiplayerData, { owner: ownerUuid });
    }
    return escort;
}

/**
 * Inserts a carried batch at formation stations on `leader`, from
 * `baseSlot`. Returns the escorts that could not be inserted (see the
 * module comment) and the next free slot.
 *
 * Fresh uuids: a batch can be re-inserted into a brand new system world,
 * and reusing the old bay-launch ids could collide with a later launch.
 * Intra-batch references are remapped to the new uuids by
 * prepareCarriedEscorts, and a fighter's own identity is component-borne
 * rather than uuid-borne, so re-minting is safe.
 */
export async function insertEscortBatch(bridge: FleetBridge,
    leaderUuid: string, leader: Entity, escorts: readonly CarriedEscort[],
    baseSlot: number, mintUuid: () => string, ownerUuid?: string):
    Promise<FleetInsertionResult> {
    const prepared = prepareCarriedEscorts(escorts, leaderUuid, leader,
        baseSlot, mintUuid, ownerUuid);
    // prepareCarriedEscorts places each roster row's OWN entity object, so
    // a placed entity pairs back with its row; a failure hands the row
    // back under the uuid it was placed under.
    const rows = new Map<Entity, CarriedEscort>(
        escorts.map(escort => [escort.entity, escort]));
    const failed: CarriedEscort[] = [];
    for (const { uuid, entity } of prepared) {
        try {
            await bridge.addEntity(uuid, entity);
        } catch (e) {
            console.warn(`Failed to re-insert carried escort ${uuid}:`, e);
            const row = rows.get(entity);
            if (row) {
                failed.push({ ...row, uuid });
            }
        }
    }
    return { failed, nextSlot: baseSlot + escorts.length };
}

/**
 * The sequence: player, carried escorts, hires, mission ships. See the
 * module comment for the failure policy.
 */
export async function insertPlayerAndFleet(args: FleetInsertion):
    Promise<FleetInsertionResult> {
    const {
        bridge, playerUuid, player, escorts, ownerUuid, baseSlot, mintUuid,
        getShip,
    } = args;
    const hires = args.hires ?? [];
    const missionShips = args.missionShips ?? [];
    // The multiplayer identity, on every path: a ship bought at the
    // shipyard is a fresh entity, and without these no peer's inputs
    // steer it and removePeer never cleans it up. Idempotent for a hull
    // that already carries them (a jump arrival).
    if (ownerUuid) {
        player.components.set(ControlledByComponent, { peerId: ownerUuid });
        player.components.set(MultiplayerData, { owner: ownerUuid });
    }
    // The player first. A rejection here means NOTHING went in: rethrow
    // with the caller's rosters untouched.
    await bridge.addEntity(playerUuid, player);

    const escortResult = await insertEscortBatch(bridge, playerUuid, player,
        escorts, baseSlot, mintUuid, ownerUuid);
    let slot = escortResult.nextSlot;
    for (const shipId of hires) {
        try {
            const shipData = await getShip(shipId);
            const escort = buildHiredEscort(shipData, playerUuid, player,
                slot, ownerUuid);
            if (!escort) {
                console.warn('Hired escorts skipped: leader has no movement '
                    + 'state');
                break;
            }
            await bridge.addEntity(mintUuid(), escort);
            slot++;
        } catch (e) {
            console.warn(`Failed to spawn hired escort ${shipId}:`, e);
        }
    }
    for (const ship of missionShips) {
        try {
            if (ownerUuid) {
                // Like hired escorts: peer-owned so removePeer cleans
                // them up if this client vanishes.
                ship.components.set(MultiplayerData, { owner: ownerUuid });
            }
            await bridge.addEntity(mintUuid(), ship);
        } catch (e) {
            console.warn('Failed to spawn mission ship:', e);
        }
    }
    return { failed: escortResult.failed, nextSlot: slot };
}
