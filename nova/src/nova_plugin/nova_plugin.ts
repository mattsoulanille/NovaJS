import { Plugin } from "nova_ecs/plugin";
import { DeltaPlugin } from "nova_ecs/plugins/delta_plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { OutfitPlugin } from "./outfit_plugin";
import { PlanetPlugin } from "./planet_plugin";
import { PlatformPlugin } from "./platform_plugin";
import { ProjectilePlugin } from "./projectile_plugin";
import { ShipController } from "./ship_controller_plugin";
import { ShipPlugin } from "./ship_plugin";
import { WeaponPlugin } from "./weapon_plugin";
import { CollisionsPlugin } from './collisions_plugin';
import { HealthPlugin } from "./health_plugin";
import { TargetPlugin } from "./target_plugin";
import { BeamPlugin } from "./beam_plugin";
import { FireWeaponPlugin } from "./fire_weapon_plugin";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const Nova: Plugin = {
    name: 'Nova',
    build(world) {
        world.addPlugin(PlatformPlugin);
        world.addPlugin(DeltaPlugin);
        world.addPlugin(ShipPlugin);
        world.addPlugin(ShipController);
        world.addPlugin(PlanetPlugin);
        world.addPlugin(TimePlugin);
        world.addPlugin(MovementPlugin);
        world.addPlugin(FireWeaponPlugin);
        world.addPlugin(ProjectilePlugin);
        world.addPlugin(WeaponPlugin);
        world.addPlugin(OutfitPlugin);
        world.addPlugin(CollisionsPlugin);
        world.addPlugin(HealthPlugin);
        world.addPlugin(TargetPlugin);
        world.addPlugin(BeamPlugin);
    }
};

