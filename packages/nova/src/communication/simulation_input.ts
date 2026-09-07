import { isLeft } from "fp-ts/lib/Either.js";
import * as t from 'io-ts';
import { Entity } from "nova_ecs/entity";
import { CommunicatorResource, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { EncodedEntity, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { World } from "nova_ecs/world";
import { warnThrottled } from "../common/log_throttle.js";
import { ControlEvent, ControlEventType, ControlsSubject } from "../nova_plugin/core/controls_plugin.js";
import { loadEntityGameData, loadOutfitsGameData } from "../nova_plugin/spawn/entity_data_loader.js";
import { SimulationGameDataResource } from "../nova_plugin/core/game_data_resource.js";
import { stageEncodedComponentsGameData } from "../nova_plugin/core/game_data_ref.js";
import { deriveEntityComponents } from "../nova_plugin/core/entity_factory.js";
import { JumpRouteComponent } from "../nova_plugin/travel/jump_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player/player_ship_plugin.js";
import { applyAnalogControl, applyControlEvents, ControlledByComponent } from "../nova_plugin/player/ship_control.js";
import { applySetTarget } from "../nova_plugin/combat/target_plugin.js";
import { applySetPlanetTarget } from "../nova_plugin/travel/planet_plugin.js";
import { applyHail, HailAction, HailActionType } from "../nova_plugin/encounters/hail_plugin.js";
import { AcceptedMission, AcceptedMissionType, applyAcceptMission } from "../nova_plugin/missions/mission_accept.js";
import { applyEscortAction, EscortAction, EscortActionType } from "../nova_plugin/escorts/escort_action.js";

/**
 * Everything that changes the simulation from outside is an input,
 * recorded against the tick it applies to. Inputs are the only wire
 * format rollback multiplayer needs in steady state: they are
 * structured-cloneable, and applying the same inputs at the same tick
 * to the same state is deterministic.
 *
 * Entity insertion is an input too: the entity is staged (its game
 * data loaded) *before* the input is scheduled, so applying the input
 * is synchronous. The insertion tick may vary between runs — inputs
 * are external by definition — but resimulating a recorded history
 * replays it exactly.
 */
export type SimulationInput =
    | { kind: 'control', events: ControlEvent[] }
    /** Virtual joystick / autopilot steering. Null fields hand the
     * corresponding axis back to the digital controls. */
    | { kind: 'analogControl', heading: number | null, throttle: number | null }
    /** Explicit target choice (tap/click on a ship); null clears. */
    | { kind: 'setTarget', target: string | null }
    /** Explicit stellar selection (tap/click on a planet); null clears. */
    | { kind: 'setPlanetTarget', target: string | null }
    /** A hail dialog action (request assistance / bribe) against a ship. The
     * effect (repair, credit change, pacify) is recomputed sim-side. */
    | { kind: 'hail', action: HailAction }
    /**
     * An in-flight mission acceptance (a përs ship's LinkMission, offered
     * on hail or on boarding). The client resolves the offer — the sim
     * has no access to mission data at all — and bakes the RESULT in as
     * deltas, together with any special/aux ships the accept spawns.
     * See mission_accept.ts for where the trust boundary sits and why.
     */
    | { kind: 'acceptMission', accepted: AcceptedMission }
    /**
     * A hail-dialog ESCORT MANAGEMENT action against one of the player's
     * own escorts: release it, or queue/cancel an upgrade or a sale
     * (escort_action.ts). Provenance and eligibility are recomputed
     * sim-side; the record carries only which escort and (for an upgrade)
     * which class the client resolved, which the sim verifies against the
     * escort's own shïp UpgradeTo. No PRICE is involved either way — the
     * two deals are deferred to the next spaceport departure, where the
     * money moves (spaceport/escort_deals.ts).
     */
    | { kind: 'escortAction', action: EscortAction }
    | { kind: 'addEntity', uuid: string, entity: EncodedEntity }
    | { kind: 'removeEntity', uuid: string }
    | { kind: 'setJumpRoute', route: string[] }
    /** Server-authored when a peer disconnects. */
    | { kind: 'removePeer', peerId: string };

/**
 * A peer's inputs for one simulation tick. The steady-state wire
 * format of rollback multiplayer, and the unit the rollback driver
 * records per tick.
 */
export interface InputRecord {
    /** Undefined only for local play before a connection exists. */
    peerId?: string;
    tick: number;
    /**
     * Sender-assigned sequence number. When the relay retimes a record
     * (clamping a stale tick into the future), it echoes the retimed
     * record to the sender, who finds its local application by `seq`
     * and moves it to the room's tick — otherwise the room applies the
     * record at one tick and the sender at another, a silent permanent
     * divergence (the cause of the first real recorded desync).
     */
    seq?: number;
    inputs: SimulationInput[];
}

/**
 * ============================================================================
 * Wire validation
 * ============================================================================
 *
 * Records arrive from other peers as JSON that the relay used to cast and
 * forward verbatim. A record whose `inputs` was not an array threw inside
 * every peer's `step()` on every subsequent tick (the inputs map still
 * held it), was archived, and was served to every joiner forever: one
 * message bricked a room for everyone. These codecs are the boundary; the
 * relay and the bridge decode with them and drop what fails.
 *
 * Every member is `t.strict`, so unknown fields are STRIPPED rather than
 * carried along: a record is logged, relayed to the room, and served to
 * every later joiner, so a kilobyte of junk on one would be amplified
 * for the room's whole life.
 */

/**
 * A non-negative safe integer: what a tick or sequence number must be on
 * the wire. `t.number` would admit 1e300, which the relay's clamp
 * arithmetic and the tick-keyed maps downstream then choke on.
 */
export const WireTick = new t.Type<number, number, unknown>(
    'WireTick',
    (u): u is number => typeof u === 'number' && Number.isSafeInteger(u) && u >= 0,
    (u, c) => typeof u === 'number' && Number.isSafeInteger(u) && u >= 0
        ? t.success(u) : t.failure(u, c),
    t.identity,
);

export const SimulationInputType: t.Type<SimulationInput, unknown> = t.union([
    t.strict({ kind: t.literal('control'), events: t.array(ControlEventType) }),
    t.strict({
        kind: t.literal('analogControl'),
        heading: t.union([t.number, t.null]),
        throttle: t.union([t.number, t.null]),
    }),
    t.strict({ kind: t.literal('setTarget'), target: t.union([t.string, t.null]) }),
    t.strict({ kind: t.literal('setPlanetTarget'), target: t.union([t.string, t.null]) }),
    t.strict({ kind: t.literal('hail'), action: HailActionType }),
    t.strict({ kind: t.literal('acceptMission'), accepted: AcceptedMissionType }),
    t.strict({ kind: t.literal('escortAction'), action: EscortActionType }),
    t.strict({ kind: t.literal('addEntity'), uuid: t.string, entity: EncodedEntity }),
    t.strict({ kind: t.literal('removeEntity'), uuid: t.string }),
    t.strict({ kind: t.literal('setJumpRoute'), route: t.array(t.string) }),
    t.strict({ kind: t.literal('removePeer'), peerId: t.string }),
]);

export const InputRecordType: t.Type<InputRecord, unknown> = t.exact(t.intersection([
    t.type({
        tick: WireTick,
        inputs: t.array(SimulationInputType),
    }),
    t.partial({
        peerId: t.string,
        seq: WireTick,
    }),
]));

/**
 * Applies a tick's input records. Records sort by peerId so every
 * peer applies the same tick's inputs in the same order regardless of
 * arrival order.
 */
export function applyInputRecords(world: World, records: InputRecord[]) {
    const sorted = [...records].sort((a, b) => {
        const peerA = a.peerId ?? '';
        const peerB = b.peerId ?? '';
        return peerA < peerB ? -1 : peerA > peerB ? 1 : 0;
    });
    for (const record of sorted) {
        applySimulationInputs(world, record.inputs, record.peerId);
    }
}

/** The outfit ids an acceptance GRANTS (positive deltas): the ids whose
 * game data every world applying the record must have staged. */
export function grantedOutfitIds(accepted: AcceptedMission): string[] {
    return (accepted.outfitsDelta ?? [])
        .filter(([, delta]) => delta > 0)
        .map(([id]) => id);
}

/**
 * Loads the game data for every entity inserted by these records, so
 * applying (or replaying) them is synchronous. The originating peer
 * stages before scheduling; every *other* world applying the record —
 * a late joiner replaying the log, the server's archive — must stage
 * from the record itself before applying it.
 */
export async function loadInputRecordsGameData(
    world: World, records: InputRecord[]) {
    const serializer = world.resources.get(SerializerResource);
    if (!serializer) {
        return;
    }
    for (const record of records) {
        for (const input of record.inputs) {
            // (An escortAction stages NOTHING. Queueing an upgrade records
            // the target class's id on the escort's ownership marker and
            // builds no ship; the class is loaded by the client that
            // settles the deal at lift-off — spaceport/escort_deals.ts.)
            //
            // Every input that carries an ENTITY must stage it, or a peer
            // that did not originate the record derives against unloaded
            // game data and diverges. acceptMission carries a BATCH of
            // them (a mission's special/aux ships), so it is staged here
            // exactly like addEntity's single one.
            const entities: EncodedEntity[] =
                input.kind === 'addEntity' ? [input.entity]
                    : input.kind === 'acceptMission'
                        ? (input.accepted.ships ?? []).map(
                            ship => ship.entity as EncodedEntity)
                        : [];
            // The entity's game-data REFERENCES (ShipData & co., see
            // core/game_data_ref.ts) resolve during the decode itself,
            // so they are staged before it; the decoded entity's
            // closure follows, as genesis stages it.
            const gameData = world.resources.get(SimulationGameDataResource);
            if (gameData && entities.length > 0) {
                await stageEncodedComponentsGameData(gameData,
                    entities.map(encoded => encoded.components));
            }
            for (const encoded of entities) {
                const decoded = serializer.decode(encoded);
                if (!isLeft(decoded)) {
                    await loadEntityGameData(world, decoded.right);
                }
            }
            // Every input that carries a GAME-DATA ID the sim will derive
            // from must stage that too. An acceptance's OnAccept Gxxx
            // grants put NEW outfit ids into the player's OutfitsState,
            // and applying it drops WeaponsState/ShipPhysics for the
            // providers to rebuild from `Outfit.getCached` /
            // `Weapon.getCached` — which miss on every world that never
            // staged those ids, re-attaching at a load-timing-dependent
            // tick that differs per peer (the "purchased outfits never
            // staged" desync class, docs/rollback_multiplayer.md (11),
            // in its third costume).
            if (input.kind === 'acceptMission') {
                await loadOutfitsGameData(world,
                    grantedOutfitIds(input.accepted));
            }
        }
    }
}

/**
 * ============================================================================
 * Authorisation: which entities a record's peer may act on
 * ============================================================================
 *
 * (Item 5 of the trust model in rollback_protocol.ts; the rest of the
 * model — relay stamping, validation, server-only acceptance — is what
 * makes `peerId` here trustworthy.)
 *
 * The relay stamps every record with its sender, so `peerId` is trusted
 * identity — but the PAYLOAD is the sender's to choose, and the
 * entity-level inputs name their targets by uuid. Without a check, any
 * peer's record could delete or replace any other peer's ship (and,
 * being logged and served to every joiner, permanently). The rule:
 *
 *  - A peer OWNS an entity whose `ControlledBy.peerId` or
 *    `MultiplayerData.owner` is that peer: its player ship, the escorts,
 *    mission ships and NPCs it inserted (browser.ts stamps every one of
 *    those with its uuid; spawnNpc likewise).
 *  - `removeEntity` and an `addEntity` that would REPLACE an existing
 *    uuid need ownership of the target. A fresh `addEntity` may not
 *    declare another peer as controller or owner either, or the victim's
 *    control records would steer the attacker's hull (findControlledEntity
 *    takes the first match).
 *  - `removePeer` is server-authored (the relay writes it on
 *    disconnect); only a record stamped with a server's uuid may carry it.
 *  - The servers themselves are exempt: the relay's own records are the
 *    room's ground truth.
 *  - A record with NO peerId is local play before any connection exists
 *    (there is nobody else to protect), so nothing is checked.
 *
 * Deterministic by construction: every input is a pure function of the
 * world's synced ownership state plus the record's stamped peer, so all
 * peers drop (or apply) the same input at the same tick.
 */

/**
 * The server's uuid when a world has no communicator to ask (the
 * server's own archive sim, offline log replay in analyze_desync.mjs).
 * CommunicatorServer refuses any other uuid for itself, so this is the
 * only value a server-stamped record can ever carry.
 */
const DEFAULT_SERVER_PEERS: ReadonlySet<string> = new Set(['server']);

/** The world's singleton entity key (nova_ecs/world.ts). Deleting or
 * replacing it throws inside step() — the legacy multiplayer plugin's
 * remove-of-singleton crash — so no peer-authored input may name it. */
const SINGLETON_UUID = 'singleton';

function isServerPeer(world: World, peerId: string): boolean {
    const servers = world.resources.get(CommunicatorResource)?.servers.value
        ?? DEFAULT_SERVER_PEERS;
    return servers.has(peerId);
}

function ownsEntity(entity: Entity, peerId: string): boolean {
    return entity.components.get(ControlledByComponent)?.peerId === peerId
        || entity.components.get(MultiplayerData)?.owner === peerId;
}

/** Whether `peerId` may remove (or overwrite) the entity at `uuid`. */
function mayActOn(world: World, peerId: string | undefined,
    uuid: string): boolean {
    if (peerId === undefined || isServerPeer(world, peerId)) {
        return true;
    }
    if (uuid === SINGLETON_UUID) {
        return false;
    }
    const entity = world.entities.get(uuid);
    return entity !== undefined && ownsEntity(entity, peerId);
}

/** Whether `peerId` may insert `entity` at `uuid`. */
function mayInsert(world: World, peerId: string | undefined, uuid: string,
    entity: Entity): boolean {
    if (peerId === undefined || isServerPeer(world, peerId)) {
        return true;
    }
    if (uuid === SINGLETON_UUID) {
        return false;
    }
    const existing = world.entities.get(uuid);
    if (existing && !ownsEntity(existing, peerId)) {
        return false;
    }
    const controller = entity.components.get(ControlledByComponent)?.peerId;
    if (controller !== undefined && controller !== peerId) {
        return false;
    }
    const owner = entity.components.get(MultiplayerData)?.owner;
    if (owner !== undefined && owner !== peerId) {
        return false;
    }
    return true;
}

/**
 * The acceptance with any special ship the peer may not insert removed
 * (the same rule as addEntity, applied to the record's batch).
 */
function authorizeMissionShips(world: World, peerId: string | undefined,
    accepted: AcceptedMission): AcceptedMission {
    const serializer = world.resources.get(SerializerResource);
    if (!accepted.ships || !serializer) {
        return accepted;
    }
    const ships = accepted.ships.filter(ship => {
        const decoded = serializer.decode(ship.entity as EncodedEntity);
        if (isLeft(decoded)) {
            // applyAcceptMission drops (and reports) undecodable ships.
            return true;
        }
        if (mayInsert(world, peerId, ship.uuid, decoded.right)) {
            return true;
        }
        warnDrop(peerId, 'missionShip', () =>
            `Dropping mission ship ${ship.uuid} from ${peerId}: `
            + 'not authorised to insert it');
        return false;
    });
    return ships.length === accepted.ships.length
        ? accepted : { ...accepted, ships };
}

/**
 * Every drop here is a per-input decision, so a peer streaming records
 * whose inputs are all rejected would otherwise log a line per input at
 * record rate — the same log flood the relay's drop paths already
 * throttle (common/log_throttle.ts). One line per second per peer and
 * kind, with the rest counted. Logging only: the drop itself is
 * unconditional and deterministic.
 */
function warnDrop(peerId: string | undefined, kind: unknown,
    message: () => string) {
    warnThrottled(`input-drop:${peerId ?? 'local'}:${String(kind)}`, message);
}

/**
 * Applies a tick's inputs, in order. Called by the rollback driver
 * immediately before stepping that tick — both live and during
 * resimulation — so it must be deterministic and synchronous.
 *
 * Each input is applied in its own try/catch: a throw here would recur
 * on every later step of every world holding the record (it stays in
 * the tick's input map), wedging the room. Dropping the offending input
 * is deterministic — the same input throws identically everywhere.
 */
export function applySimulationInputs(world: World, inputs: SimulationInput[],
    peerId?: string) {
    for (const input of inputs) {
        try {
            applySimulationInput(world, input, peerId);
        } catch (error) {
            const kind = (input as { kind?: unknown })?.kind;
            warnDrop(peerId, kind, () =>
                `Dropping ${kind} input from ${peerId ?? 'local'}: ${String(error)}`);
        }
    }
}

function applySimulationInput(world: World, input: SimulationInput,
    peerId: string | undefined) {
    switch (input.kind) {
        case 'control': {
            applyControlEvents(world, peerId, input.events);
            const subject = world.resources.get(ControlsSubject);
            if (subject) {
                for (const event of input.events) {
                    subject.next(event);
                }
            }
            break;
        }
        case 'analogControl': {
            applyAnalogControl(world, peerId,
                { heading: input.heading, throttle: input.throttle });
            break;
        }
        case 'setTarget': {
            applySetTarget(world, peerId, input.target);
            break;
        }
        case 'setPlanetTarget': {
            applySetPlanetTarget(world, peerId, input.target);
            break;
        }
        case 'hail': {
            applyHail(world, peerId, input.action);
            break;
        }
        case 'addEntity': {
            const serializer = world.resources.get(SerializerResource);
            if (!serializer) {
                throw new Error('Expected serializer resource to exist');
            }
            const decoded = serializer.decode(input.entity);
            if (isLeft(decoded)) {
                warnDrop(peerId, input.kind, () =>
                    `Dropping addEntity input for ${input.uuid}: `
                    + serializer.describeDecodeFailure(input.entity, decoded.left));
                break;
            }
            if (!mayInsert(world, peerId, input.uuid, decoded.right)) {
                warnDrop(peerId, input.kind, () =>
                    `Dropping addEntity input for ${input.uuid} `
                    + `from ${peerId}: not authorised to insert it`);
                break;
            }
            deriveEntityComponents(world, decoded.right);
            world.entities.set(input.uuid, decoded.right);
            break;
        }
        case 'acceptMission': {
            applyAcceptMission(world, peerId,
                authorizeMissionShips(world, peerId, input.accepted));
            break;
        }
        case 'escortAction': {
            applyEscortAction(world, peerId, input.action);
            break;
        }
        case 'removeEntity': {
            if (!mayActOn(world, peerId, input.uuid)) {
                warnDrop(peerId, input.kind, () =>
                    `Dropping removeEntity input for ${input.uuid} `
                    + `from ${peerId}: not authorised to remove it`);
                break;
            }
            world.entities.delete(input.uuid);
            break;
        }
        case 'removePeer': {
            if (peerId === undefined || !isServerPeer(world, peerId)) {
                warnDrop(peerId, input.kind, () =>
                    `Dropping removePeer input for ${input.peerId} `
                    + `from ${peerId}: only the server removes peers`);
                break;
            }
            for (const [uuid, entity] of [...world.entities]) {
                if (entity.components.get(ControlledByComponent)?.peerId
                    === input.peerId) {
                    world.entities.delete(uuid);
                }
            }
            break;
        }
        case 'setJumpRoute': {
            for (const entity of world.entities.values()) {
                const controlled = peerId !== undefined
                    ? entity.components.get(ControlledByComponent)?.peerId === peerId
                    : entity.components.has(PlayerShipSelector);
                if (!controlled) {
                    continue;
                }
                const jumpRoute = entity.components.get(JumpRouteComponent);
                if (jumpRoute) {
                    jumpRoute.route = [...input.route];
                }
                break;
            }
            break;
        }
    }
}
