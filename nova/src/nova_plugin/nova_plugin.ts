import { Plugin } from "nova_ecs/plugin";
import { DeltaPlugin, DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { ShipComponent, ShipType } from "./ship_component";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const Nova: Plugin = {
    name: 'Nova',
    build(world) {
        world.addPlugin(DeltaPlugin);
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);

        world.addComponent(ShipComponent);
        deltaMaker.addComponent(ShipComponent, {
            componentType: ShipType
        });
    }
};

