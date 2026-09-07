import { Plugin } from "nova_ecs/plugin";
import { DeltaPlugin } from "nova_ecs/plugins/delta_plugin";
import { MovementPlugin } from "nova_ecs/plugins/movement_plugin";
import { TimePlugin } from "nova_ecs/plugins/time_plugin";
import {
    AnimationPlugin, CollisionsPlugin, ControlsPlugin, CreateTimePlugin,
    PlatformPlugin, ReturnToQueuePlugin, SoundEventPlugin,
} from "./core/index.js";
import { PlayerStatePlugin } from "./player/index.js";
import {
    CargoPlugin, CloakPlugin, DeathPlugin, HealthPlugin, IonizedPlugin,
    OutfitPlugin, ShipPlugin,
} from "./ship/index.js";
import { NCBPlugin } from "./ncb/index.js";
import { IffPlugin, ReputationPlugin } from "./reputation/index.js";
import {
    AfterburnerPlugin, GateTransitPlugin, JumpPlugin, PlanetPlugin,
    ShipController,
} from "./travel/index.js";
import { NpcAiPlugin, NpcPlugin } from "./npc/index.js";
import {
    AggressionPlugin, AsteroidPlugin, BeamPlugin, BlastPlugin,
    FireWeaponPlugin, FoldPlugin, JammingPlugin, ProjectilePlugin,
    ShipExplosionPlugin, TargetPlugin, WeaponPlugin,
} from "./combat/index.js";
import { NpcSpawnPlugin, PersPlugin } from "./spawn/index.js";
import {
    BayPlugin, EscortCommandPlugin, PlayerEscortPlugin,
} from "./escorts/index.js";
import { MissionShipPlugin } from "./missions/index.js";
import { BoardingPlugin, DisabledPlugin, HailPlugin } from "./encounters/index.js";
import { DebugCheatPlugin } from "./pilot/index.js";

/**
 * Every simulation plugin, in registration order.
 *
 * THE ORDER IS A DETERMINISM INPUT. The World runs unconstrained system
 * pairs in registration order (#43), so this list — not the domain
 * directories — decides the simulation's system order, and it
 * interleaves domains on purpose: a domain's plugins are registered
 * where the systems around them expect. Each domain's index declares
 * its own plugins in the same relative order (`Domain.plugins`);
 * system_plugin_test checks the two agree and that the resulting
 * `world.systemNames` matches the frozen snapshot in
 * system_order_snapshot.ts. Change the order only with that snapshot,
 * and prove equivalence with the determinism harness.
 */
export const SYSTEM_PLUGIN_ORDER: readonly Plugin[] = [
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
    // After WeaponPlugin: the fold gate orders before WeaponsSystem and
    // its state is read by the miner firing gate there.
    FoldPlugin,
    OutfitPlugin,
    NCBPlugin,
    PlayerStatePlugin,
    ReputationPlugin,
    // Debug cheat buttons (status_bar.ts). After PlayerState and
    // Reputation: the cheats mutate the Credits / LegalRecords those
    // plugins own.
    DebugCheatPlugin,
    JammingPlugin,
    CollisionsPlugin,
    HealthPlugin,
    CloakPlugin,
    IffPlugin,
    // Before TargetPlugin: the 'r' key's nearest-hostile scan reads
    // the aggression state this plugin records.
    AggressionPlugin,
    TargetPlugin,
    SoundEventPlugin,
    BeamPlugin,
    BayPlugin,
    EscortCommandPlugin,
    JumpPlugin,
    GateTransitPlugin,
    NpcPlugin,
    NpcAiPlugin,
    HailPlugin,
    PersPlugin,
    NpcSpawnPlugin,
    MissionShipPlugin,
    // After NpcAiPlugin (orders against FormationSystem), JumpPlugin
    // (orders against JumpFromSystem) and MissionShipPlugin (whose
    // MissionShipComponent it excludes from player-escort ownership).
    PlayerEscortPlugin,
    IonizedPlugin,
    AfterburnerPlugin,
    // After every plugin whose systems it orders against (controls,
    // jump, afterburner, NPC AI): ship disabling erases their
    // movement writes each tick while a ship is disabled.
    DisabledPlugin,
    BlastPlugin,
    // After BlastPlugin: a ship's final explosion spawns one of its
    // blasts (and orders against DeathPlugin's and NpcPlugin's death
    // handlers, both already added).
    ShipExplosionPlugin,
    CargoPlugin,
    // After Cargo/Disabled/Reputation/EscortCommand: boarding reads
    // cargo, requires the disabled gate, charges legal-record crimes,
    // and converts captures into escorts.
    BoardingPlugin,
    AsteroidPlugin,
];

// Users must add the multiplayer plugin and a display plugin.
// Users must also add the NovaData resource.
export const SystemPlugin: Plugin = {
    name: 'SystemPlugin',
    build(world) {
        for (const plugin of SYSTEM_PLUGIN_ORDER) {
            world.addPlugin(plugin);
        }
    }
};
