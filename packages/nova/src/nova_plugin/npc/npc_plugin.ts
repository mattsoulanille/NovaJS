import { ShipData } from "novadatainterface/ship_data";
import { Entities, GetWorld, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import * as t from 'io-ts';
import { CommunicatorResource, ExcludedMultiplayerComponentsResource, MultiplayerData } from "nova_ecs/plugins/multiplayer_plugin";
import { markerType, SerializerResource } from "nova_ecs/plugins/serializer_plugin";
import { RandomResource } from "nova_ecs/plugins/random_plugin";
import { TimeResource, TimeSystem } from "nova_ecs/plugins/time_plugin";
import { Optional } from "nova_ecs/optional";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { CloakActiveComponent, CloakActiveState, isTargetable } from "../ship/index.js";
import { DeathEvent } from "../ship/index.js";
import { DisabledComponent, DisabledState } from "../ship/index.js";
import { makeShip } from "../ship/index.js";
import { ShipComponent } from "../ship/index.js";
import { TargetComponent } from "../ship/index.js";
import { WeaponsStateComponent } from "../ship/index.js";
import { SimulationGameDataResource } from "../core/index.js";

/**
 * ============================================================================
 * LEGACY AI PRIMITIVES — migration status
 * ============================================================================
 *
 * This module predates rollback multiplayer: its components are
 * excluded from the (state-sync era) multiplayer component set and its
 * ChooseRandomTarget behavior was designed to run on the owner's sim
 * only. In the input-driven shared simulation every peer runs these
 * systems on every entity that carries the components, so in practice
 * they already execute deterministically-in-sim; the exclusions remain
 * only so the legacy state-sync path (multiplayer_plugin) doesn't
 * churn on them.
 *
 * MIGRATION DECISION: real NPCs (dude/fleet traffic) use the new
 * deterministic AI in npc_ai_plugin.ts + npc_spawn_plugin.ts, whose
 * state is serializer-registered (hashed, snapshotted, wire-carried).
 * What remains here serves two callers:
 *  - makeNpc: the dev "Add Enemy" button and test harnesses, which
 *    want an unconditionally aggressive ship with no govt politics.
 *  - Bay fighters (bay_plugin.ts): Follow/ShootAllWeapons while they
 *    have a target; their no-target holding pattern lives in
 *    npc_ai_plugin's FormationComponent.
 * When those callers move to the new AI (e.g. "Add Enemy" spawning a
 * govt warship), delete the ChooseRandomTarget path outright.
 *
 * Known wart, documented not fixed: ChooseRandomTargetAI picks from
 * raw query iteration order. Entity-map order is deterministic for
 * peers that share a genesis + input history, but a wire-restored
 * world may iterate differently; the new AI sorts/tie-breaks by uuid
 * instead (see chooseNearest in npc_ai_plugin.ts).
 */

// Cloaked ships (CloakActiveComponent.active) are invisible to NPC AI, so
// they are excluded as valid targets — same rule the player's targeting
// uses. A cloak scanner would reveal them, but that outfit is not wired.
// Disabled ships (DisabledComponent) are excluded too: a disabled ship
// stops being a valid attack target (same rule as the modern NPC AI).
const TargetsQuery = new Query([UUID, ShipComponent, Optional(CloakActiveComponent),
    Optional(DisabledComponent)] as const);
export function getValidTargets(
    targets: Array<readonly [string, unknown, CloakActiveState | undefined,
        DisabledState?]>,
    selfUuid: string): string[] {
    return targets
        .filter(([targetId, , cloak, disabled]) => targetId !== selfUuid
            && isTargetable(cloak) && !disabled)
        .map(([uuid]) => uuid);
}

export const ChooseRandomTargetComponent = new Component<{
    interval: number,
    nextTime?: number,
}>('ChooseRandomTargetComponent');

const ChooseRandomTargetAI = new System({
    name: 'ChooseRandomTarget',
    args: [TargetComponent, TargetsQuery, ChooseRandomTargetComponent,
        TimeResource, UUID, Entities, RandomResource] as const,
    step(target, targets, randomTargetData, time, uuid, entities, random) {
        if ((randomTargetData.nextTime ?? 0) > time.time
            && target.target && entities.has(target.target)
            // A target that got disabled is dropped at once, not held
            // until the next re-roll.
            && !entities.get(target.target)!.components
                .has(DisabledComponent)) {
            return;
        }
        randomTargetData.nextTime = time.time + randomTargetData.interval;

        const validTargets = getValidTargets(targets, uuid);

        if (validTargets.length === 0) {
            target.target = undefined;
            return;
        }

        target.target = validTargets[random.below(validTargets.length)];
    },
    // Determinism rule 4: the re-roll timer compares against time.time,
    // so this must run after TimeSystem advances the clock.
    after: [TimeSystem],
});

export const FollowComponent = new Component<undefined>('FollowComponent');
export const FollowAI = new System({
    name: 'FollowAndShootAI',
    args: [MovementStateComponent, TargetComponent, FollowComponent] as const,
    step(movementState, target) {
        movementState.turnTo = target.target;
        movementState.accelerating = 1;
    }
});

export const ShootAllWeaponsComponent = new Component<undefined>('ShootAllWeaponsComponent');
const ShootAllWeaponsAI = new System({
    name: 'ShootAllWeaponsAI',
    args: [WeaponsStateComponent, SimulationGameDataResource, TargetComponent,
        Entities, ShootAllWeaponsComponent] as const,
    step(weapons, gameData, { target }, entities) {
        // Bays fire like any other weapon now that a bay's ammo is its
        // fighters (weapon_parse's AmmoTypeParse), so the magazine and
        // the reload clock bound how many launch — but ONLY at a live
        // target. This AI holds `firing` on every weapon whether or not
        // it has something to shoot at, which is harmless for a gun and
        // ruinous for a bay: a carrier with no target would empty its
        // hangar into open space, one fighter per reload, and each
        // launch spends a fighter outfit that only docking refunds.
        const hasLiveTarget = target !== undefined && entities.has(target);
        for (const [id, weapon] of weapons) {
            const weaponType = gameData.data.Weapon.getCached(id)?.type;
            if (weaponType == null) {
                continue;
            }
            if (weaponType === 'BayWeaponData' && !hasLiveTarget) {
                weapon.firing = false;
                continue;
            }
            weapon.target = target;
            weapon.firing = true;
        }
    }
});


export const DeathAIComponent = new Component<undefined>('DeathAIComponent');
export const DeathAISystem = new System({
    name: 'DeathAISystem',
    events: [DeathEvent],
    args: [Entities, UUID, DeathAIComponent] as const,
    step(entities, uuid) {
        // In input-driven multiplayer every peer simulates the same
        // deaths at the same ticks, so removal needs no authority or
        // message: it is deterministic.
        entities.delete(uuid);
    }
})

export function makeNpc(shipData: ShipData) {
    const ship = makeShip(shipData);
    ship.components.set(ChooseRandomTargetComponent, {
        interval: 10_000,
    });
    ship.components.set(FollowComponent, undefined);
    ship.components.set(ShootAllWeaponsComponent, undefined);
    ship.components.set(DeathAIComponent, undefined);
    return ship;
}

export const NpcPlugin: Plugin = {
    name: 'NpcPlugin',
    build(world) {
        // NPC AI components must survive the serializer roundtrip that
        // entity-insertion inputs go through, but they are excluded
        // from multiplayer state: only the owner's sim runs the AI.
        const serializer = world.resources.get(SerializerResource);
        serializer?.addComponent(ChooseRandomTargetComponent, t.intersection([
            t.type({ interval: t.number }),
            t.partial({ nextTime: t.number }),
        ]));
        serializer?.addComponent(FollowComponent, markerType);
        serializer?.addComponent(ShootAllWeaponsComponent, markerType);
        serializer?.addComponent(DeathAIComponent, markerType);
        const excluded = world.resources.get(ExcludedMultiplayerComponentsResource)
            ?? new Set<string>();
        for (const component of [ChooseRandomTargetComponent, FollowComponent,
            ShootAllWeaponsComponent, DeathAIComponent]) {
            excluded.add(component.name);
        }
        world.resources.set(ExcludedMultiplayerComponentsResource, excluded);

        world.addSystem(ChooseRandomTargetAI);
        world.addSystem(FollowAI);
        world.addSystem(ShootAllWeaponsAI);
        world.addSystem(DeathAISystem);
    },
    remove(world) {
        world.removeSystem(ChooseRandomTargetAI);
        world.removeSystem(FollowAI);
        world.removeSystem(ShootAllWeaponsAI);
    }
}

