import 'jasmine';
import { UnknownComponent } from 'nova_ecs/component';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import {
    Serializer, SerializerResource,
} from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import {
    emitSimulationBridgeEvent,
} from '../communication/simulation_bridge_events.js';
import {
    getSyntheticGameData, makeSimulationBridgeHarness,
} from '../communication/simulation_test_fixture.js';
import { completeEntity } from '../nova_plugin/spawn/entity_data_loader.js';
import { EscortCommandComponent } from '../nova_plugin/player/escort_command.js';
import { ArmorComponent } from '../nova_plugin/ship/health_plugin.js';
import { makeShip } from '../nova_plugin/ship/make_ship.js';
import { FormationComponent } from '../nova_plugin/npc/npc_ai_plugin.js';
import { PlanetComponent } from '../nova_plugin/travel/planet_plugin.js';
import { Stat } from '../nova_plugin/core/stat.js';
import {
    EscortLandingComponent, PlayerEscortComponent,
} from '../nova_plugin/player/player_escort.js';
import {
    EscortLanded, EscortLandedEvent,
} from '../nova_plugin/escorts/player_escort_plugin.js';

/**
 * The escort lifecycle relies on two pieces of sim -> client wiring, and
 * both fail SILENTLY when unregistered (see source_component_bridge_test's
 * account of the same failure mode):
 *
 *  - PlayerEscortComponent / EscortLandingComponent must be
 *    serializer-registered, or they are dropped from simulation frames and
 *    from the serialized entity a carry event hands over — an escort would
 *    come back out of a landing or a jump with its ownership erased.
 *  - EscortLandedEvent / EscortJumpEvent must be registered both as bridge
 *    events and with the serializer's event codecs, or the client never
 *    hears that an escort left the simulation and the escort is lost.
 *
 * These specs pin the wiring by driving a real simulation world through the
 * real bridge and decoding the frame into a display world.
 */
describe('player escort sim -> client wiring', () => {
    let serializer: Serializer;

    beforeAll(async () => {
        const harness = await makeSimulationBridgeHarness(getSyntheticGameData());
        serializer = harness.world.resources.get(SerializerResource)!;
    });

    it('registers the escort ownership components with the serializer', () => {
        expect(serializer.hasComponent(
            PlayerEscortComponent as UnknownComponent)).toBeTrue();
        expect(serializer.hasComponent(
            EscortLandingComponent as UnknownComponent)).toBeTrue();
    });

    it('delivers a landed escort to the client as a decodable entity',
        async () => {
            const { client, world, gameData, shipId, shipUuid } =
                await makeSimulationBridgeHarness(getSyntheticGameData());
            const sim = world.resources.get(SerializerResource)!;

            // A real stellar in this system to land on.
            let planetUuid: string | undefined;
            let planetPosition: Position | undefined;
            for (const [uuid, entity] of world.entities) {
                const movement = entity.components.get(MovementStateComponent);
                if (entity.components.has(PlanetComponent) && movement) {
                    planetUuid = uuid;
                    planetPosition = Position.fromVectorLike(movement.position);
                    break;
                }
            }
            expect(planetUuid).toBeDefined();

            // An owned escort already on final approach, so the landing
            // lands on the very next step.
            const escort = makeShip(await gameData.data.Ship.get(shipId));
            escort.components.set(MovementStateComponent, {
                accelerating: 0,
                position: planetPosition!,
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, 0),
            });
            escort.components.set(FormationComponent,
                { leader: shipUuid, slot: 0 });
            escort.components.set(EscortCommandComponent,
                { command: 'formation' });
            escort.components.set(PlayerEscortComponent,
                { player: shipUuid, parent: shipUuid });
            escort.components.set(EscortLandingComponent,
                { planet: planetUuid! });
            // Battle damage, set directly: the armor Stat's Provide
            // system keeps an existing `current` (it only refreshes max
            // and recharge), so this survives insertion.
            escort.components.set(ArmorComponent, new Stat({
                current: 23, max: 100, min: 0, recharge: 0,
            }));
            await completeEntity(world, escort);
            world.entities.set('landing escort', escort);

            world.step();
            expect(world.entities.has('landing escort')).toBeFalse();

            const frame = client.snapshot();
            const landedEvents = frame.events.filter(
                event => event.name === 'EscortLandedEvent');
            expect(landedEvents.length).toEqual(1);

            // The client re-emits frame events into its display world; the
            // subscriber there is what browser.ts's roster listens to.
            const displayWorld = new World('escort bridge test display');
            const received: EscortLanded[] = [];
            displayWorld.events.get(EscortLandedEvent).subscribe(
                ({ data }) => received.push(data));
            emitSimulationBridgeEvent(landedEvents[0], sim, displayWorld);

            expect(received.length).toEqual(1);
            expect(received[0].uuid).toEqual('landing escort');
            expect(received[0].player).toEqual(shipUuid);
            expect(received[0].planet).toEqual(planetUuid!);
            // The whole escort survived the trip, ownership included.
            expect(received[0].entity.components
                .get(PlayerEscortComponent)?.player).toEqual(shipUuid);
            expect(received[0].entity.components.get(ArmorComponent)?.current)
                .toEqual(23);
            expect(received[0].entity.components.has(EscortLandingComponent))
                .toBeFalse();
        });

    /**
     * Matthew's item 4 depends on a path the specs above do NOT cover: the
     * status bar reads PlayerEscortComponent off a LIVE, in-world escort in
     * the display world, which arrives through ordinary entity mirroring
     * (snapshot's added/changed), not through a carry event's serialized
     * entity. A component can be registered well enough for the event path
     * and still be missing here, and the failure is silent — the govt line
     * would simply never say "Escort".
     */
    it('mirrors a live escort\'s ownership to the client every frame',
        async () => {
            const { client, world, gameData, shipId, shipUuid } =
                await makeSimulationBridgeHarness(getSyntheticGameData());

            const escort = makeShip(await gameData.data.Ship.get(shipId));
            escort.components.set(MovementStateComponent, {
                accelerating: 0,
                position: new Position(200, 0),
                rotation: new Angle(0),
                turnBack: false,
                turning: 0,
                velocity: new Vector(0, 0),
            });
            escort.components.set(FormationComponent,
                { leader: shipUuid, slot: 0 });
            escort.components.set(PlayerEscortComponent,
                { player: shipUuid, parent: shipUuid });
            await completeEntity(world, escort);
            world.entities.set('live escort', escort);

            world.step();
            // Still flying: this is the in-world case, not a carry.
            expect(world.entities.has('live escort')).toBeTrue();

            const frame = client.snapshot();
            const mirrored = frame.added.find(
                ([uuid]) => uuid === 'live escort');
            expect(mirrored)
                .withContext('the escort never reached the client at all')
                .toBeDefined();
            const componentNames =
                mirrored![1].components.map(([name]) => name);
            expect(componentNames)
                .withContext('PlayerEscortComponent was dropped by the '
                    + 'bridge, so the status bar can never tag an escort')
                .toContain('PlayerEscort');
        });
});
