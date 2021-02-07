import { Plugin } from "novajs/nova_ecs/plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { ShipComponent } from "./ship_component";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const Nova: Plugin = {
    name: 'Nova',
    build(world) {
        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);
        world.addComponent(ShipComponent);
    }
};

