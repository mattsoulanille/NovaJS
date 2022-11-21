import { Plugin } from "nova_ecs/plugin";
import { WorldCopy } from "nova_ecs/plugins/copy_change_detector";
import { DeltaPlugin } from "nova_ecs/plugins/delta_plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { AnimationPlugin } from "./animation_plugin";
import { BayPlugin } from "./bay_plugin";
import { BeamPlugin } from "./beam_plugin";
import { BlastPlugin } from "./blast_plugin";
import { CollisionsPlugin } from './collisions_plugin';
import { ControlsPlugin } from "./controls_plugin";
import { CreateTimePlugin } from "./create_time";
import { DeathPlugin } from "./death_plugin";
import { FireWeaponPlugin } from "./fire_weapon_plugin";
import { GameDataResource } from "./game_data_resource";
import { HealthPlugin } from "./health_plugin";
import { IonizedPlugin } from "./ionization_plugin";
import { JumpPlugin } from "./jump_plugin";
import { NpcPlugin } from "./npc_plugin";
import { OutfitPlugin } from "./outfit_plugin";
import { PlanetPlugin } from "./planet_plugin";
import { PlatformPlugin } from "./platform_plugin";
import { ProjectilePlugin } from "./projectile_plugin";
import { ReturnToQueuePlugin } from "./return_to_queue_plugin";
import { ShipController } from "./ship_controller_plugin";
import { ShipPlugin } from "./ship_plugin";
import { TargetPlugin } from "./target_plugin";
import { WeaponPlugin } from "./weapon_plugin";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const SystemPlugin: Plugin = {
    name: 'SystemPlugin',
    async build(world) {
        const plugins = [
            TimePlugin,
            CreateTimePlugin,
            ReturnToQueuePlugin,
            PlatformPlugin,
            DeltaPlugin,
            ShipPlugin,
            AnimationPlugin,
            ControlsPlugin,
            ShipController,
            PlanetPlugin,
            MovementPlugin,
            DeathPlugin,
            FireWeaponPlugin,
            ProjectilePlugin,
            WeaponPlugin,
            OutfitPlugin,
            CollisionsPlugin,
            HealthPlugin,
            TargetPlugin,
            BeamPlugin,
            BayPlugin,
            JumpPlugin,
            NpcPlugin,
            IonizedPlugin,
            BlastPlugin,
        ];
        
        await world.addPlugins(plugins);
    }
};

