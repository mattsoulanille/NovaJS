import { Plugin } from "../ecs/plugin";
import { MovementPlugin } from "../ecs/plugins/movement_plugin";
import { TimePlugin } from "../ecs/plugins/time_plugin";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const Nova: Plugin = {
    name: 'Nova',
    build(world) {
        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);
    }
};

