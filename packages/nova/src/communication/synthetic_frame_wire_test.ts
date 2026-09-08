import 'jasmine';
import { isLeft, isRight } from 'fp-ts/lib/Either.js';
import { Entity } from 'nova_ecs/entity';
import { Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';
import { ProjectileWeaponData } from 'novadatainterface/weapon_data';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import {
    AnimationComponent, ProjectileComponent, ProjectileDataComponent,
} from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { makeNpc } from '../nova_plugin/npc/index.js';
import { ShipDataComponent } from '../nova_plugin/ship/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import {
    applySimulationFrame, stageSimulationFrameGameData,
} from './apply_simulation_frame.js';
import { makeDeterminismWorld } from './determinism_harness.js';
import {
    DeltaFrameEncoder, SimulationFrame, SimulationFrameType,
} from './simulation_frame.js';
import { getSyntheticGameData, makeSyntheticGameData } from './simulation_test_fixture.js';
import { avroWireCodec, decodeWireOrThrow } from './wire_codec.js';
import { simulationFrameDerivation } from './wire_schemas.js';

/**
 * The seam between the reference wire (#225: ShipData & co. cross as
 * ids into the receiver's OWN game data, AnimationComponent as its
 * owner's id) and the synthetic data set the engine specs run on: a
 * frame from a synthetic simulation world crosses the Avro frame codec
 * and rehydrates in a receiver that parsed the synthetic set for
 * itself, from a cold cache — exactly the display's path
 * (system_entry.ts: a serializer world over its own data, the frame's
 * references staged, then applied).
 */
describe('a synthetic frame over the Avro wire', () => {
    const shipId = SYNTHETIC.ships.warden;
    const weaponId = SYNTHETIC.weapons.blaster;
    let frame: SimulationFrame;
    let senderSerializer: Serializer;

    beforeAll(async () => {
        const gameData = await getSyntheticGameData();
        const source = await makeDeterminismWorld(0, 'worker', getSyntheticGameData());
        const warden = makeNpc(await gameData.data.Ship.get(shipId));
        await completeEntity(source, warden);
        source.entities.set('warden', warden);
        // The provider systems (ShipAnimationProvider) run on the step.
        source.step();
        expect(warden.components.get(ShipDataComponent)?.id).toBe(shipId);
        expect(warden.components.get(AnimationComponent)?.id).toBe(shipId);

        // A shot too: its ProjectileData references the Weapon table,
        // which building a world does NOT warm (the Ship table it does),
        // so this is the reference a receiver must stage.
        const blaster = await gameData.data.Weapon.get(weaponId) as ProjectileWeaponData;
        source.entities.set('shot', new Entity('shot')
            .addComponent(ProjectileComponent, { id: weaponId })
            .addComponent(ProjectileDataComponent, blaster)
            .addComponent(AnimationComponent, blaster.animation));

        senderSerializer = source.resources.get(SerializerResource)!;
        frame = {
            ...new DeltaFrameEncoder().encode(source, senderSerializer),
            events: [],
        };
    }, 60_000);

    function onTheWire(of: SimulationFrame, uuid: string) {
        const added = of.added.find(([id]) => id === uuid);
        if (!added) {
            throw new Error(`${uuid} is not in the frame`);
        }
        return { entity: added[1], components: new Map(added[1].components) };
    }

    it('carries the game-data components as references', () => {
        const warden = onTheWire(frame, 'warden').components;
        expect(warden.get('ShipData')).toEqual({ id: shipId });
        expect(warden.get('AnimationComponent')).toEqual({ owner: 'ship', id: shipId });
        const shot = onTheWire(frame, 'shot').components;
        expect(shot.get('ProjectileData')).toEqual({ id: weaponId });
        expect(shot.get('AnimationComponent')).toEqual({ owner: 'weapon', id: weaponId });
    });

    it('rehydrates in a receiver on its own synthetic data once the frame is staged', async () => {
        // The frame as bytes, through the frame schema derived from the
        // sender's serializer, back to a frame.
        const codec = avroWireCodec(simulationFrameDerivation(senderSerializer).schema);
        const received = decodeWireOrThrow(codec, SimulationFrameType, codec.encode(frame));
        const warden = onTheWire(received, 'warden');
        const shot = onTheWire(received, 'shot');
        expect(warden.components.get('ShipData')).toEqual({ id: shipId });

        // The receiver: a serializer world over a FRESH parse of the
        // synthetic set. Building it stages the Ship table; the Weapon
        // table stays cold.
        const receiverData = makeSyntheticGameData();
        const systemId = [...(await receiverData.ids).System].sort()[0]!;
        const receiver = await makeSystem(systemId, receiverData, 'worker', { npcs: false });
        const serializer = receiver.resources.get(SerializerResource)!;
        expect(receiverData.data.Weapon.getCached(weaponId)).toBeUndefined();

        // Unstaged, the reference cannot resolve: the decode says so.
        const cold = serializer.decodeComponent(
            'ProjectileData', shot.components.get('ProjectileData'));
        expect(cold && isLeft(cold)).withContext('ProjectileData decodes on a cold cache')
            .toBeTrue();

        await stageSimulationFrameGameData(receiverData, received);
        const ship = await receiverData.data.Ship.get(shipId);
        const weapon = await receiverData.data.Weapon.get(weaponId) as ProjectileWeaponData;
        expect(receiverData.data.Weapon.getCached(weaponId)).toBe(weapon);

        // Staged, every reference resolves to the receiver's OWN data
        // objects: the records, and the Animations those records own.
        const decoded = (uuid: 'warden' | 'shot', name: string) => {
            const result = serializer.decodeComponent(
                name, onTheWire(received, uuid).components.get(name));
            return result && isRight(result) ? result.right[1] : undefined;
        };
        expect(decoded('warden', 'ShipData')).toBe(ship);
        expect(decoded('warden', 'AnimationComponent')).toBe(ship.animation);
        expect(decoded('shot', 'ProjectileData')).toBe(weapon);
        expect(decoded('shot', 'AnimationComponent')).toBe(weapon.animation);

        // And the whole frame applies, as the display applies it, with
        // nothing dropped.
        const display = new World('display');
        const warn = spyOn(console, 'warn');
        applySimulationFrame(received, serializer, display);
        const mirroredWarden = display.entities.get('warden');
        expect(mirroredWarden?.components.get(ShipDataComponent)).toBe(ship);
        expect(mirroredWarden?.components.get(AnimationComponent)).toBe(ship.animation);
        expect(mirroredWarden?.components.size).toBe(warden.entity.components.length);
        const mirroredShot = display.entities.get('shot');
        expect(mirroredShot?.components.get(ProjectileDataComponent)).toBe(weapon);
        expect(mirroredShot?.components.get(AnimationComponent)).toBe(weapon.animation);
        expect(warn).not.toHaveBeenCalled();
    }, 60_000);
});
