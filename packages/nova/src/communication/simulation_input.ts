import { isLeft } from "fp-ts/lib/Either.js";
import { EncodedEntity, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { World } from "nova_ecs/world";
import { ControlEvent, ControlsSubject, EcsControlEvent } from "../nova_plugin/controls_plugin.js";
import { loadEntityGameData } from "../nova_plugin/entity_data_loader.js";
import { deriveEntityComponents } from "../nova_plugin/entity_factory.js";
import { JumpRouteComponent } from "../nova_plugin/jump_plugin.js";
import { PlayerShipSelector } from "../nova_plugin/player_ship_plugin.js";
import { applyAnalogControl, applyControlEvents, ControlledByComponent } from "../nova_plugin/ship_control.js";
import { applySetTarget } from "../nova_plugin/target_plugin.js";
import { applySetPlanetTarget } from "../nova_plugin/planet_plugin.js";
import { applyHail, HailAction } from "../nova_plugin/hail_plugin.js";
import { AcceptedMission, applyAcceptMission } from "../nova_plugin/mission_accept.js";
import { applyEscortAction, EscortAction } from "../nova_plugin/escort_action.js";

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
     * two deals are deferred to the next shipyard, where the money moves
     * (spaceport/escort_deals.ts).
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
            // settles the deal at a shipyard — spaceport/escort_deals.ts.)
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
            for (const encoded of entities) {
                const decoded = serializer.decode(encoded);
                if (!isLeft(decoded)) {
                    await loadEntityGameData(world, decoded.right);
                }
            }
        }
    }
}

/**
 * Applies a tick's inputs, in order. Called by the rollback driver
 * immediately before stepping that tick — both live and during
 * resimulation — so it must be deterministic and synchronous.
 */
export function applySimulationInputs(world: World, inputs: SimulationInput[],
    peerId?: string) {
    for (const input of inputs) {
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
                    console.warn(`Dropping addEntity input for ${input.uuid}: `
                        + serializer.describeDecodeFailure(input.entity, decoded.left));
                    break;
                }
                deriveEntityComponents(world, decoded.right);
                world.entities.set(input.uuid, decoded.right);
                break;
            }
            case 'acceptMission': {
                applyAcceptMission(world, peerId, input.accepted);
                break;
            }
            case 'escortAction': {
                applyEscortAction(world, peerId, input.action);
                break;
            }
            case 'removeEntity': {
                world.entities.delete(input.uuid);
                break;
            }
            case 'removePeer': {
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
}
