import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Emit, Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent, teleport } from 'nova_ecs/plugins/movement_plugin';
import { Optional } from 'nova_ecs/optional';
import { EncodedEntity, Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { registerSimulationBridgeEvent } from '../../communication/simulation_bridge_events.js';
import { deImmerify } from '../../util/deimmerify.js';
import { JumpRouteProvider, WARP_OUT_SOUND } from './jump_plugin.js';
import { LandEvent, PlanetComponent, PlanetDataComponent } from './planet_plugin.js';
import { getShipMovementPhysics, ShipPhysicsComponent } from '../ship/index.js';
import { PlayerSoundEvent } from '../core/index.js';

/**
 * Hypergate / wormhole transit. Landing on a stellar whose spöb has the
 * hypergate (0x1000) or wormhole (0x2000) flag transports the ship to a linked
 * gate/wormhole in another system instead of opening the spaceport (EVN Bible
 * p. 61).
 *
 * Two flows share the arrival machinery here:
 *
 * - WORMHOLE: no choice — {@link GateDepartureSystem} picks the exit with the
 *   replicated RandomResource, removes the ship, and emits
 *   {@link GateTransitEvent} (mirroring FinishJumpEvent: it carries the whole
 *   serialized entity across the worker/room boundary). The browser resolves
 *   the exit spöb to its system and calls the same `jumpTo` room switch the
 *   jump sequence uses.
 *
 * - HYPERGATE: landing docks the ship like a spaceport landing (the browser
 *   removes it through the dock machinery) and opens the hypergate map
 *   (gate_map_plugin.ts / GateMap), where the player picks one of the gate's
 *   linked neighbors. On selection the browser tags the ship with a
 *   {@link GateArrivalComponent} and rides the same `jumpTo` room switch;
 *   closing the map without a pick relaunches the ship at the origin gate.
 *
 * Arrival in the destination system is positioned by {@link GateArrivalSystem}:
 * the ship appears at the arrival gate's centre, flying out — the sim world there
 * already has that gate loaded as a planet entity, so no cross-system data
 * lookup is needed mid-step.
 *
 * Determinism: the wormhole choice is sim-side seeded random (every peer picks
 * the same exit); the hypergate choice is the player's own input, carried in
 * the re-insertion input record like any other player decision. The spöb ->
 * system *resolution* and the room switch are player-local (only the
 * transiting player follows), exactly like a normal jump.
 */

/**
 * A ship emerges AT the destination gate's centre and coasts straight out of
 * it at this fraction of its top speed (reference "Hypergate emergence, wave
 * 59": on the original the first frame put the ship within a few px of the
 * gate's centre for 40, 150 and 325 px gate art alike, then it coasted at
 * 0.49-0.52 of the hull's top speed, a Leviathan 22 px/s and a Starbridge
 * 87-91, inertial or inertialess, facing the way it flew).
 */
export const GATE_EMERGENCE_SPEED_FRACTION = 0.5;

/**
 * Rides on a transiting ship to its destination system and positions it at the
 * arrival gate. `destinationSpob` is the global id of the gate/wormhole to
 * emerge at; null means a random wormhole whose exit is resolved on arrival by
 * the browser (which knows the full wormhole list). `randomDraw` is a
 * replicated [0,1) draw used to pick that random exit deterministically.
 * Serializer-registered, so it crosses the wire with the entity and rides the
 * default rollback-snapshot codec (no snapshot_policies entry needed).
 */
export const GateArrivalType = t.intersection([
    t.type({
        emergenceAngle: t.union([t.number, t.null]),
        randomDraw: t.number,
    }),
    t.partial({
        destinationSpob: t.union([t.string, t.null]),
    }),
]);
export type GateArrival = t.TypeOf<typeof GateArrivalType>;
export const GateArrivalComponent = new Component<GateArrival>('GateArrival');

export interface GateTransit {
    entity: Entity,
    uuid: string,
    /** The departure gate/wormhole spöb global id (so a random wormhole can be
     * resolved to a *different* exit). */
    fromSpob: string,
    /** Destination gate/wormhole spöb global id, or null for a random
     * wormhole (resolved by the browser from the full wormhole list). */
    destinationSpob: string | null,
}
export const GateTransitEvent = new EcsEvent<GateTransit>('GateTransitEvent');

const EncodedGateTransitEvent = t.type({
    entity: EncodedEntity,
    uuid: t.string,
    fromSpob: t.string,
    destinationSpob: t.union([t.string, t.null]),
});

export function GateTransitEventType(serializer: Serializer) {
    return new t.Type<GateTransit, {
        entity: EncodedEntity,
        uuid: string,
        fromSpob: string,
        destinationSpob: string | null,
    }>(
        'GateTransitEventType',
        (_u): _u is GateTransit => true,
        (input, context) => {
            const encoded = EncodedGateTransitEvent.validate(input, context);
            if (isLeft(encoded)) {
                return encoded;
            }
            const decoded = serializer.decode(encoded.right.entity);
            if (isLeft(decoded)) {
                return t.failure(
                    encoded.right.entity,
                    context,
                    serializer.describeDecodeFailure(encoded.right.entity, decoded.left),
                );
            }
            return t.success({
                entity: decoded.right,
                uuid: encoded.right.uuid,
                fromSpob: encoded.right.fromSpob,
                destinationSpob: encoded.right.destinationSpob,
            });
        },
        (data) => ({
            entity: serializer.encode(data.entity),
            uuid: data.uuid,
            fromSpob: data.fromSpob,
            destinationSpob: data.destinationSpob,
        }),
    );
}

registerSimulationBridgeEvent({ event: GateTransitEvent });

/**
 * On landing, if the landed stellar is a WORMHOLE, choose the exit, tag the
 * ship with a {@link GateArrivalComponent}, remove it from this system, and
 * emit {@link GateTransitEvent} to carry it across. A wormhole offers no
 * choice (EVN Bible p. 61), so the whole transit is sim-side and immediate.
 *
 * Hypergates are NOT handled here: landing on one docks the ship like a
 * spaceport landing (the browser removes it through the same dock machinery)
 * and opens the hypergate map, where the player picks one of the gate's
 * linked neighbors. See the browser's gate-map flow and gate_map_plugin.ts.
 *
 * Runs on the landing ship (LandEvent is targeted at it). The refuel-on-land
 * system also fires on this event; that is harmless (the ship simply arrives
 * refuelled).
 */
export const GateDepartureSystem = new System({
    name: 'GateDepartureSystem',
    events: [LandEvent],
    args: [LandEvent, GetEntity, UUID, Entities, RandomResource,
        new Query([PlanetComponent, PlanetDataComponent] as const), Emit] as const,
    step(landed, entity, uuid, entities, random, planets, emit) {
        // Find the landed planet's data to read its gate info.
        let gate = undefined;
        for (const [planet, planetData] of planets) {
            if (planet.id === landed.id) {
                gate = planetData.gate;
                break;
            }
        }
        if (gate?.kind !== 'wormhole') {
            // Ordinary planet: normal landing. Hypergate: the browser docks
            // the ship and opens the hypergate map instead.
            return;
        }

        // Choose the exit. A wormhole with links exits at a seeded-random one
        // of them; a link-less wormhole exits at a random other link-less
        // wormhole, resolved by the browser (which has the full list) from
        // randomDraw. The draw comes from the replicated RandomResource, so
        // every peer picks the same exit.
        const randomDraw = random.next();
        const destinationSpob = gate.destinations.length === 0
            ? null
            : gate.destinations[Math.floor(randomDraw * gate.destinations.length)];

        entity.components.set(GateArrivalComponent, {
            destinationSpob,
            emergenceAngle: gate.emergenceAngle,
            randomDraw,
        });

        entities.delete(uuid);
        deImmerify(entity);
        emit(GateTransitEvent,
            { entity, uuid, fromSpob: landed.id, destinationSpob }, [uuid]);
    },
});

/**
 * The first tick after a transiting ship arrives in the destination system.
 * The ship appears AT the arrival gate's centre (matched by spöb global id
 * among the system's planet entities), facing the emergence direction and
 * coasting along it at half its top speed (GATE_EMERGENCE_SPEED_FRACTION),
 * with the "jump in" sound (snd 130 "Warp out" — the same sound a hyperspace
 * arrival plays; the data has no gate-specific sound). The DESTINATION
 * gate's CustSndID decides the direction (0-359 an exact clock angle; every
 * stock gate says 120); anything else means "random", chosen
 * deterministically from the replicated randomDraw. On the original a random
 * gate's direction does not follow the departure heading (wave 59: six
 * departures at 140-170 deg came out at 100, 290, 150, 100, 320 and 310).
 *
 * The sound is emitted targeted at the ship, so only that ship's own pilot
 * hears it (the display's PlayerSoundSystem plays player-targeted sounds for
 * the local player's ship only) — the established self-only sound channel the
 * jump sequence uses.
 */
export const GateArrivalSystem = new System({
    name: 'GateArrivalSystem',
    args: [GateArrivalComponent, MovementStateComponent, GetEntity, UUID,
        Optional(ShipPhysicsComponent), Emit,
        new Query([PlanetComponent, MovementStateComponent,
            PlanetDataComponent] as const)] as const,
    step(arrival, movement, entity, uuid, shipPhysics, emit, planets) {
        // The browser resolves destinationSpob to a concrete gate before
        // re-inserting the ship (random wormholes and the hypergate map's
        // pick both happen there), so by the time this runs it should name a
        // real gate in this system.
        let gatePosition: Position | undefined;
        let gateAngle: number | null = null;
        if (arrival.destinationSpob) {
            for (const [planet, planetMovement, planetData] of planets) {
                if (planet.id === arrival.destinationSpob) {
                    gatePosition = planetMovement.position;
                    // The DESTINATION gate's own CustSndID controls the angle
                    // ships emerge from it (Bible p. 60). The carried angle
                    // (from the departure side) is the fallback.
                    gateAngle = planetData.gate?.emergenceAngle
                        ?? arrival.emergenceAngle;
                    break;
                }
            }
        }

        if (gatePosition) {
            // Emerge at the gate's centre, facing the emergence angle (or a
            // seeded-random direction when the angle is unspecified) and
            // coasting along it at half the hull's top speed; targetSpeed
            // keeps an inertialess hull coasting too, as on the original.
            const angle = gateAngle !== null
                ? new Angle(gateAngle * Math.PI / 180)
                : new Angle(arrival.randomDraw * 2 * Math.PI - Math.PI);
            const speed = shipPhysics
                ? getShipMovementPhysics(shipPhysics).maxVelocity
                    * GATE_EMERGENCE_SPEED_FRACTION
                : 0;
            teleport(movement, new Position(gatePosition.x, gatePosition.y),
                angle.getUnitVector().scale(speed));
            movement.rotation = angle;
            movement.targetSpeed = speed;
        }
        // If the gate wasn't found (shouldn't happen), the ship simply keeps
        // the position it arrived with rather than getting stuck.
        emit(PlayerSoundEvent, { id: WARP_OUT_SOUND }, [uuid]);
        entity.components.delete(GateArrivalComponent);
    },
    // #237 pin (shared: ControlledBy, JumpRouteComponent): GateTransitPlugin
    // registers after JumpPlugin.
    after: [JumpRouteProvider],
});

export const GateTransitPlugin: Plugin = {
    name: 'GateTransitPlugin',
    build(world) {
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(GateArrivalComponent, GateArrivalType);
        if (serializer) {
            serializer.addEvent(GateTransitEvent, GateTransitEventType(serializer));
        }
        world.addSystem(GateDepartureSystem);
        world.addSystem(GateArrivalSystem);
    },
};
