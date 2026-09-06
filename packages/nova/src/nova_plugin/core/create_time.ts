import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { Plugin } from 'nova_ecs/plugin';
import { SerializerPlugin, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provide';
import { ProvideArg } from 'nova_ecs/provide_arg';


export const CreateTime = new Component<number>('ProjectileFireTime');
export const CreateTimeProvider = Provide({
    name: "CreateTimeProvider",
    provided: CreateTime,
    args: [TimeResource] as const,
    // Determinism rule 4: stamps entities with time.time as their creation
    // time, so it must run after TimeSystem advances the clock — otherwise
    // an entity created on the first tick after a restore could be stamped
    // with the previous tick's time, diverging peers.
    after: [TimeSystem],
    factory({ time }) {
        return time;
    }
});

// Used in cases where the creation time is needed on the same frame
// e.g. BeamSystem.
export const CreateTimeArgProvider = ProvideArg({
    provided: CreateTime,
    args: [TimeResource] as const,
    factory({ time }) {
        return time;
    }
});

export const CreateTimePlugin: Plugin = {
    name: "CreateTimePlugin",
    build(world) {
        // CreateTime must be serializer-registered to reach the display
        // world at all. SimulationBridgeHost.snapshot() encodes only the
        // components the serializer knows (`serializer.hasComponent`), so
        // an unregistered component is silently dropped from every
        // simulation frame — and a display system that queries it then
        // matches NOTHING, with no error anywhere. That was the
        // projectile-fade bug: ProjectileFadeSystem was added, its clock
        // (SimulationTimeResource) was live, but display projectiles had
        // no ProjectileFireTime, so shots rendered at alpha 1 for their
        // whole flight and popped out at expiry.
        //
        // Registration does not change snapshot or wire-snapshot
        // behaviour: configureSnapshotPolicies sets CreateTime's policy
        // ('share') and wire codec explicitly, and explicit entries are
        // consulted before the serializer-registered default.
        //
        // SerializerPlugin is added here rather than assumed, because
        // SystemPlugin builds this plugin BEFORE DeltaPlugin — the
        // plugin that normally creates SerializerResource. The usual
        // `world.resources.get(SerializerResource)?.addComponent(...)`
        // idiom would silently no-op at this point in the build order.
        // addPlugin is idempotent and SerializerPlugin builds
        // synchronously, so this is the same thing DeltaPlugin does.
        world.addPlugin(SerializerPlugin);
        const serializer = world.resources.get(SerializerResource);
        if (!serializer) {
            throw new Error('Expected a serializer to register CreateTime');
        }
        serializer.addComponent(CreateTime, t.number);
        world.addSystem(CreateTimeProvider);
    }
}
