import 'jasmine';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { MultiplayerData } from 'nova_ecs/plugins/multiplayer_plugin';
import { EncodedEntity, Serializer, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import {
    ComponentSnapshotPolicy, restoreWorld, SnapshotPoliciesResource,
    snapshotWorld, toJsonSafe, wireSnapshotOfSnapshot, wireSnapshotWorld,
} from 'nova_ecs/plugins/snapshot_plugin';
import { hashWorld } from 'nova_ecs/plugins/world_hash';
import { UnknownComponent } from 'nova_ecs/component';
import { World } from 'nova_ecs/world';
import { WeaponEntries } from '../nova_plugin/combat/index.js';
import { deriveEntityComponents, GovtComponent } from '../nova_plugin/core/index.js';
import { makeSystem } from '../nova_plugin/make_system.js';
import { makeNpc } from '../nova_plugin/npc/index.js';
import { completeEntity } from '../nova_plugin/spawn/index.js';
import { DeltaFrameEncoder, EntityDelta, EntityFrame } from './simulation_frame.js';
import { makeSyntheticGameData } from './simulation_test_fixture.js';

/**
 * Equivalence specs for the rollback / display-encode fast paths
 * (perf-neon-1127): on a real fight (synthetic data: Gannet Corsairs and
 * Heron Wardens, whose skiff bays launch fighters, plus a scripted missile
 * battery and point defence), each fast path must give the same result as
 * the slow path it replaced.
 */

/** The pre-optimisation DeltaFrameEncoder, verbatim, as the reference. */
class ReferenceDeltaFrameEncoder {
    private lastSent = new Map<string, {
        name: string | undefined,
        components: Map<string, string>,
    }>();

    encode(world: World, serializer: Serializer): EntityFrame {
        const added: [string, EncodedEntity][] = [];
        const changed: [string, EntityDelta][] = [];
        const seen = new Set<string>();
        for (const [uuid, entity] of world.entities) {
            if (uuid === 'singleton') {
                continue;
            }
            seen.add(uuid);
            const previous = this.lastSent.get(uuid);
            const encodedComponents: [string, unknown][] = [];
            const record = {
                name: entity.name,
                components: new Map<string, string>(),
            };
            for (const [component, data] of entity.components) {
                if (!serializer.hasComponent(component)) {
                    continue;
                }
                const encoded = serializer.encodeComponent(component, data);
                encodedComponents.push([component.name, encoded]);
                record.components.set(component.name,
                    JSON.stringify(encoded) ?? 'undefined');
            }
            if (!previous) {
                added.push([uuid, { name: entity.name, components: encodedComponents }]);
            } else {
                const delta: EntityDelta = { changed: [], removed: [] };
                if (previous.name !== entity.name) {
                    delta.name = entity.name;
                }
                for (const [componentName, encoded] of encodedComponents) {
                    if (previous.components.get(componentName)
                        !== record.components.get(componentName)) {
                        delta.changed.push([componentName, encoded]);
                    }
                }
                for (const componentName of previous.components.keys()) {
                    if (!record.components.has(componentName)) {
                        delta.removed.push(componentName);
                    }
                }
                if (delta.name !== undefined || delta.changed.length > 0
                    || delta.removed.length > 0) {
                    changed.push([uuid, delta]);
                }
            }
            this.lastSent.set(uuid, record);
        }
        const removed: string[] = [];
        for (const uuid of this.lastSent.keys()) {
            if (!seen.has(uuid)) {
                removed.push(uuid);
                this.lastSent.delete(uuid);
            }
        }
        return { added, changed, removed };
    }
}

/** JSON with sorted object keys: the display world's view of a value. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) => {
        if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
            const record = v as Record<string, unknown>;
            return Object.fromEntries(Object.keys(record).sort()
                .map(key => [key, record[key]]));
        }
        return v;
    }) ?? 'undefined';
}

/** What a receiver holds after applying a stream of frames. */
class Mirror {
    readonly entities = new Map<string, { name?: string, components: Map<string, string> }>();

    apply(frame: EntityFrame) {
        for (const [uuid, entity] of frame.added) {
            this.entities.set(uuid, {
                name: entity.name,
                components: new Map(entity.components.map(
                    ([name, data]) => [name, canonical(data)])),
            });
        }
        for (const [uuid, delta] of frame.changed) {
            const entity = this.entities.get(uuid);
            if (!entity) {
                throw new Error(`delta for unknown entity ${uuid}`);
            }
            if (delta.name !== undefined) {
                entity.name = delta.name;
            }
            for (const [name, data] of delta.changed) {
                entity.components.set(name, canonical(data));
            }
            for (const name of delta.removed) {
                entity.components.delete(name);
            }
        }
        for (const uuid of frame.removed) {
            this.entities.delete(uuid);
        }
    }

    dump(): string {
        return JSON.stringify([...this.entities].sort(([a], [b]) => a < b ? -1 : 1)
            .map(([uuid, { name, components }]) =>
                [uuid, name, [...components].sort(([a], [b]) => a < b ? -1 : 1)]));
    }
}

/** A fixed LCG: the scripted battery's choices, identical every run. */
function lcg(seed: number) {
    let state = seed >>> 0;
    return () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

/**
 * The serializer-registered components that used to snapshot through the
 * codec and now have an in-memory 'clone' / 'share' policy.
 */
const FAST_POLICY_COMPONENTS = new Set([
    'MovementState', 'MovementPhysics', 'Shield', 'Armor', 'Fuel',
    'Ionization', 'VulnerableToPD', 'IsIonizedComponent',
    'IonizationColorComponent', 'TumbleAnimation', 'Projectile',
    'FiringGroup', 'Owner', 'Asteroid', 'Debris', 'TargetComponent',
    'PlanetTargetComponent', 'JamDecisionComponent', 'JammingComponent',
    'GovtComponent', 'Ship', 'Planet', 'MultiplayerData', 'EscortCommand',
    'FormationComponent', 'NpcComponent', 'OutfitsStateComponent', 'Cargo',
    'WeaponsStateComponent',
]);

const MISSILE = 'nova:129';
const POINT_DEFENSE = 'nova:132';

/** The big_fight_benchmark scene, scaled down. */
async function makeFight(brawlers = 24) {
    const gameData = makeSyntheticGameData();
    await gameData.data.Weapon.get(MISSILE);
    await gameData.data.Weapon.get(POINT_DEFENSE);
    const world = await makeSystem('nova:130', gameData, 'worker');
    const factions: string[][] = [[], []];
    const ring = [[1, 0], [0, 1], [-1, 0], [0, -1],
        [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7], [0.7, -0.7]];
    for (let i = 0; i < brawlers; i++) {
        const side = i % 2;
        // Gannet Corsairs and Heron Wardens (skiff bay: fighters).
        const shipId = ['nova:129', 'nova:130'][Math.floor(i / 2) % 2];
        const npc = makeNpc(await gameData.data.Ship.get(shipId));
        npc.components.set(MultiplayerData, { owner: 'server' });
        npc.components.set(GovtComponent, { id: ['nova:128', 'nova:129'][side] });
        await completeEntity(world, npc);
        const [dx, dy] = ring[i % ring.length];
        const radius = 300 + 120 * Math.floor(i / ring.length);
        npc.components.set(MovementStateComponent, {
            position: new Position(dx * radius, dy * radius),
            velocity: new Vector(0, 0),
            rotation: new Angle(0),
            accelerating: 0,
            turning: 0,
            turnBack: false,
        });
        const uuid = `brawler-${i}`;
        world.entities.set(uuid, npc);
        factions[side].push(uuid);
    }
    const weaponEntries = world.resources.get(WeaponEntries)!;
    weaponEntries.get(MISSILE);
    weaponEntries.get(POINT_DEFENSE);
    const random = lcg(12345);
    const pick = (list: string[]) => {
        const live = list.filter(uuid => world.entities.has(uuid));
        return live.length ? live[Math.floor(random() * live.length)] : undefined;
    };
    let tick = 0;
    /** One scripted battery volley, then one world step. */
    function step() {
        const missile = weaponEntries.getCached(MISSILE);
        const pd = weaponEntries.getCached(POINT_DEFENSE);
        for (let n = 0; missile && n < 3; n++) {
            const side = Math.floor(random() * 2);
            const shooter = pick(factions[side]);
            const target = pick(factions[1 - side]);
            if (shooter && target) {
                missile.fireFromEntity(shooter, true, target);
            }
        }
        for (let i = 0; pd && i < 6; i++) {
            const uuid = factions[i % 2][Math.floor(i / 2)];
            if ((tick + i) % 6 === 0 && world.entities.has(uuid)) {
                pd.fireFromEntity(uuid);
            }
        }
        world.step();
        tick++;
    }
    return { world, step };
}

describe('perf fast paths on a fight', () => {
    it('DeltaFrameEncoder leaves the receiver in the same state as the reference encoder', async () => {
        const { world, step } = await makeFight();
        const serializer = world.resources.get(SerializerResource)!;
        const fast = new DeltaFrameEncoder();
        const reference = new ReferenceDeltaFrameEncoder();
        const fastMirror = new Mirror();
        const referenceMirror = new Mirror();
        let fastDeltas = 0;
        let referenceDeltas = 0;
        for (let i = 0; i < 240; i++) {
            step();
            const fastFrame = fast.encode(world, serializer);
            const referenceFrame = reference.encode(world, serializer);
            fastDeltas += fastFrame.changed.length;
            referenceDeltas += referenceFrame.changed.length;
            expect(fastFrame.added.map(([uuid]) => uuid))
                .toEqual(referenceFrame.added.map(([uuid]) => uuid));
            expect(fastFrame.removed).toEqual(referenceFrame.removed);
            fastMirror.apply(fastFrame);
            referenceMirror.apply(referenceFrame);
            if (i % 20 === 0 || i === 239) {
                expect(fastMirror.dump()).toEqual(referenceMirror.dump());
            }
        }
        // The fight really moved things around (and the fast encoder
        // skipped no change the reference sent: the mirrors agree).
        expect(referenceDeltas).toBeGreaterThan(1000);
        expect(fastDeltas).toBeLessThanOrEqual(referenceDeltas);
    });

    it('fast snapshot policies restore exactly what the codec round trip restores', async () => {
        const { world, step } = await makeFight();
        for (let i = 0; i < 90; i++) {
            step();
        }
        const policies = world.resources.get(SnapshotPoliciesResource)!;
        const serializer = world.resources.get(SerializerResource)!;
        // Every component a fast policy now covers is serializer-registered
        // (the policy changes only HOW it is captured, never WHETHER).
        const fastPolicies = new Map<UnknownComponent, ComponentSnapshotPolicy>();
        for (const [component, policy] of policies.components) {
            if (FAST_POLICY_COMPONENTS.has(component.name)) {
                expect(serializer.hasComponent(component))
                    .withContext(component.name).toBeTrue();
                fastPolicies.set(component, policy);
            }
        }
        expect([...fastPolicies.keys()].map(c => c.name).sort())
            .toEqual([...FAST_POLICY_COMPONENTS].sort());

        const fastSnapshot = snapshotWorld(world);
        const liveWire = canonical(toJsonSafe(wireSnapshotWorld(world)));
        const liveHash = hashWorld(world).hash;
        // The stored form crosses the wire exactly as the live world does.
        expect(canonical(toJsonSafe(wireSnapshotOfSnapshot(world, fastSnapshot))))
            .toEqual(liveWire);

        // The same tick captured through the codec for every one of them.
        for (const component of fastPolicies.keys()) {
            policies.components.delete(component);
        }
        const codecSnapshot = snapshotWorld(world);
        for (const [component, policy] of fastPolicies) {
            policies.components.set(component, policy);
        }

        const fastRestoreHash = (() => {
            restoreWorld(world, fastSnapshot, deriveEntityComponents);
            return hashWorld(world).hash;
        })();
        const codecRestoreHash = (() => {
            restoreWorld(world, codecSnapshot, deriveEntityComponents);
            return hashWorld(world).hash;
        })();
        expect(fastRestoreHash).toEqual(liveHash);
        expect(codecRestoreHash).toEqual(liveHash);

        // Replays from each restore, with no scripted volleys (they would
        // draw from the battery's RNG differently): pure simulation.
        const replay = (snapshot: typeof fastSnapshot) => {
            restoreWorld(world, snapshot, deriveEntityComponents);
            const hashes: string[] = [];
            for (let i = 0; i < 60; i++) {
                world.step();
                if (i % 10 === 9) {
                    hashes.push(hashWorld(world).hash);
                }
            }
            return hashes;
        };
        const fromFast = replay(fastSnapshot);
        const fromCodec = replay(codecSnapshot);
        // Restoring the fast snapshot a second time (after continued
        // simulation mutated the restored entities) replays identically:
        // the snapshot was not aliased by the live world.
        const fromFastAgain = replay(fastSnapshot);
        expect(fromFast).toEqual(fromCodec);
        expect(fromFastAgain).toEqual(fromFast);
    });
});
