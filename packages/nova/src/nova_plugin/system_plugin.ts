import { Plugin } from "nova_ecs/plugin";
import { DeltaPlugin } from "nova_ecs/plugins/delta_plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import { AfterburnerPlugin } from "./afterburner_plugin.js";
import { AnimationPlugin } from "./animation_plugin.js";
import { DisabledPlugin } from "./disabled_plugin.js";
import { AsteroidPlugin } from "./asteroid_plugin.js";
import { BayPlugin } from "./bay_plugin.js";
import { CargoPlugin } from "./cargo_plugin.js";
import { BoardingPlugin } from "./boarding_plugin.js";
import { BeamPlugin } from "./beam_plugin.js";
import { BlastPlugin } from "./blast_plugin.js";
import { CloakPlugin } from "./cloak_plugin.js";
import { DebugCheatPlugin } from "./debug_cheat_plugin.js";
import { AggressionPlugin } from "./aggression_plugin.js";
import { IffPlugin } from "./iff_plugin.js";
import { CollisionsPlugin } from './collisions_plugin.js';
import { ControlsPlugin } from "./controls_plugin.js";
import { CreateTimePlugin } from "./create_time.js";
import { DeathPlugin } from "./death_plugin.js";
import { EscortCommandPlugin } from "./escort_command_plugin.js";
import { HailPlugin } from "./hail_plugin.js";
import { FireWeaponPlugin } from "./fire_weapon_plugin.js";
import { HealthPlugin } from "./health_plugin.js";
import { IonizedPlugin } from "./ionization_plugin.js";
import { JammingPlugin } from "./jamming_plugin.js";
import { JumpPlugin } from "./jump_plugin.js";
import { GateTransitPlugin } from "./gate_transit_plugin.js";
import { MissionShipPlugin } from "./mission_ship_plugin.js";
import { PersPlugin } from "./pers_plugin.js";
import { NCBPlugin } from "./ncb_plugin.js";
import { NpcAiPlugin } from "./npc_ai_plugin.js";
import { NpcPlugin } from "./npc_plugin.js";
import { NpcSpawnPlugin } from "./npc_spawn_plugin.js";
import { OutfitPlugin } from "./outfit_plugin.js";
import { PlanetPlugin } from "./planet_plugin.js";
import { PlatformPlugin } from "./platform_plugin.js";
import { PlayerEscortPlugin } from "./player_escort_plugin.js";
import { PlayerStatePlugin } from "./player_state_plugin.js";
import { ProjectilePlugin } from "./projectile_plugin.js";
import { ReputationPlugin } from "./reputation_plugin.js";
import { ReturnToQueuePlugin } from "./return_to_queue_plugin.js";
import { ShipController } from "./ship_controller_plugin.js";
import { ShipExplosionPlugin } from "./ship_explosion_plugin.js";
import { ShipPlugin } from "./ship_plugin.js";
import { SoundEventPlugin } from "./sound_plugin.js";
import { TargetPlugin } from "./target_plugin.js";
import { WeaponPlugin } from "./weapon_plugin.js";
import { FoldPlugin } from "./fold_plugin.js";

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const SystemPlugin: Plugin = {
    name: 'SystemPlugin',
    build(world) {
        world.addPlugin(TimePlugin);
        world.addPlugin(CreateTimePlugin);
        world.addPlugin(ReturnToQueuePlugin);
        world.addPlugin(PlatformPlugin);
        world.addPlugin(DeltaPlugin);
        world.addPlugin(ShipPlugin);
        world.addPlugin(AnimationPlugin);
        world.addPlugin(ControlsPlugin);
        world.addPlugin(ShipController);
        world.addPlugin(PlanetPlugin);
        world.addPlugin(MovementPlugin);
        world.addPlugin(DeathPlugin);
        world.addPlugin(FireWeaponPlugin);
        world.addPlugin(ProjectilePlugin);
        world.addPlugin(WeaponPlugin);
        // After WeaponPlugin: the fold gate orders before WeaponsSystem and
        // its state is read by the miner firing gate there.
        world.addPlugin(FoldPlugin);
        world.addPlugin(OutfitPlugin);
        world.addPlugin(NCBPlugin);
        world.addPlugin(PlayerStatePlugin);
        world.addPlugin(ReputationPlugin);
        // Debug cheat buttons (status_bar.ts). After PlayerState and
        // Reputation: the cheats mutate the Credits / LegalRecords those
        // plugins own.
        world.addPlugin(DebugCheatPlugin);
        world.addPlugin(JammingPlugin);
        world.addPlugin(CollisionsPlugin);
        world.addPlugin(HealthPlugin);
        world.addPlugin(CloakPlugin);
        world.addPlugin(IffPlugin);
        // Before TargetPlugin: the 'r' key's nearest-hostile scan reads
        // the aggression state this plugin records.
        world.addPlugin(AggressionPlugin);
        world.addPlugin(TargetPlugin);
        world.addPlugin(SoundEventPlugin);
        world.addPlugin(BeamPlugin);
        world.addPlugin(BayPlugin);
        world.addPlugin(EscortCommandPlugin);
        world.addPlugin(JumpPlugin);
        world.addPlugin(GateTransitPlugin);
        world.addPlugin(NpcPlugin);
        world.addPlugin(NpcAiPlugin);
        world.addPlugin(HailPlugin);
        world.addPlugin(PersPlugin);
        world.addPlugin(NpcSpawnPlugin);
        world.addPlugin(MissionShipPlugin);
        // After NpcAiPlugin (orders against FormationSystem), JumpPlugin
        // (orders against JumpFromSystem) and MissionShipPlugin (whose
        // MissionShipComponent it excludes from player-escort ownership).
        world.addPlugin(PlayerEscortPlugin);
        world.addPlugin(IonizedPlugin);
        world.addPlugin(AfterburnerPlugin);
        // After every plugin whose systems it orders against (controls,
        // jump, afterburner, NPC AI): ship disabling erases their
        // movement writes each tick while a ship is disabled.
        world.addPlugin(DisabledPlugin);
        world.addPlugin(BlastPlugin);
        // After BlastPlugin: a ship's final explosion spawns one of its
        // blasts (and orders against DeathPlugin's and NpcPlugin's death
        // handlers, both already added).
        world.addPlugin(ShipExplosionPlugin);
        world.addPlugin(CargoPlugin);
        // After Cargo/Disabled/Reputation/EscortCommand: boarding reads
        // cargo, requires the disabled gate, charges legal-record crimes,
        // and converts captures into escorts.
        world.addPlugin(BoardingPlugin);
        world.addPlugin(AsteroidPlugin);
    }
};
