import { Emit, Entities, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { DeleteEvent, EcsEvent } from "nova_ecs/events";
import { Optional } from "nova_ecs/optional";
import { Plugin } from "nova_ecs/plugin";
import { DeltaResource } from "nova_ecs/plugins/delta_plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Provide } from "nova_ecs/provide";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { World } from "nova_ecs/world";
import { ExplodingComponent } from "./death_plugin.js";
import { findControlledEntity, ShipControlEvent, ShipControlStateComponent } from "./ship_control.js";
import { CloakActiveComponent, CloakScannerComponent, isTargetable } from "./cloak_plugin.js";
import { DisabledComponent } from "./disabled_component.js";
import { OwnerComponent } from './weapon_components.js';
import { isInFlock } from "./flock.js";
import { SimulationGameDataResource } from "./game_data_resource.js";
import { selectNearestHostile } from "./hostility.js";
import { PlayerShipSelector } from "./player_ship_plugin.js";
import { ShipComponent } from "./ship_plugin.js";
import { Target, TargetComponent } from "./target_component.js";


export const TargetIndexComponent = new Component<{ index: number }>('TargetIndexComponent');

const TargetIndexProvider = Provide({
    name: "TargetIndexProvider",
    provided: TargetIndexComponent,
    args: [] as const,
    factory: () => ({ index: -1 }),
});

export const CycleTargetEvent = new EcsEvent<Target>('CycleTargetEvent');

const TargetsQuery = new Query([UUID, MovementStateComponent,
    Optional(OwnerComponent), ShipComponent, Optional(CloakActiveComponent),
    Optional(ExplodingComponent)] as const);
const ChooseTargetSystem = new System({
    name: 'ChooseTarget',
    events: [ShipControlEvent],
    args: [ShipControlStateComponent, TargetComponent, TargetIndexComponent, UUID,
        TargetsQuery, Emit, MovementStateComponent, Entities,
        Optional(CloakScannerComponent), SimulationGameDataResource,
        TimeResource] as const,
    // MovementStateComponent is kept as a requirement rather than a
    // value: it gates the system on a ship that is actually in space,
    // and the nearest-hostile scan reads the position off the entity
    // itself (selectNearestHostile) so sim and display share one path.
    step(controlState, target, index, uuid, ships, emit, _movementState,
        entities, myScanner, gameData, time) {
        // The ship's own flock — escorts and anything transitively
        // following them (see flock.ts) — is excluded from general
        // targeting (tab / r) and cycled by escortTarget instead.
        // Click/tap targeting still reaches flock members
        // (applySetTarget below).
        const getEntity = (u: string) => entities.get(u);

        // Whether a candidate is hidden from the NORMAL (tab / r) cycle
        // because it is the ship's own flock member (owned fighter or
        // transitive escort). A DISABLED flock member is the exception:
        // dead in space, it rejoins the normal cycle so the player can
        // target it to board and repair it. It stays in the escortTarget
        // cycle regardless (that cycle keeps every flock member).
        const hiddenFromCycle = (u: string, ownerUuid: string | undefined) => {
            if (getEntity(u)?.components.has(DisabledComponent)) {
                return false;
            }
            return ownerUuid === uuid || isInFlock(u, uuid, getEntity);
        };

        if (controlState.get('escortTarget') === 'start') {
            // Cycle the flock in uuid order (deterministic regardless
            // of entity-map iteration order), starting after the
            // current target when it is already a flock member.
            const flock = ships
                .filter(([otherUuid, , , , cloak, exploding]) =>
                    isInFlock(otherUuid, uuid, getEntity)
                    && isTargetable(cloak, myScanner)
                    && exploding === undefined)
                .map(([otherUuid]) => otherUuid)
                .sort();
            if (flock.length === 0) {
                return;
            }
            // The cycle carries a "no target" step at the end, exactly
            // like the normal (tab) cycle below: index -1 means no
            // target, so the sequence is escort1 -> escort2 -> ... ->
            // no target -> escort1. A target that is NOT a flock member
            // (a normal target picked with tab/r) reads as -1 too, so
            // the first press enters the flock at its first member
            // rather than clearing the target.
            const currentIndex = target.target
                ? flock.indexOf(target.target) : -1;
            const nextIndex = (currentIndex + 2) % (flock.length + 1) - 1;
            target.target = nextIndex === -1 ? undefined : flock[nextIndex];
            emit(CycleTargetEvent, target);
            return;
        }

        if (controlState.get('nearestTarget') === 'start') {
            // 'r' picks the nearest HOSTILE ship, not merely the nearest
            // ship. "Hostile" is the shared rule the target corners
            // paint with (hostility.ts), so the key lands on exactly the
            // ships drawn with red brackets — including another player
            // who has recently shot at us, which no political layer
            // could ever call hostile. The rule is behavioral, not
            // equipment-gated: an IFF radar outfit (IffComponent)
            // colours blips and has never had anything to do with
            // targeting, so 'r' works the same with or without one.
            const self = entities.get(uuid);
            if (!self) {
                return;
            }
            const closestUuid = selectNearestHostile({
                viewerUuid: uuid,
                viewerEntity: self,
                entities,
                gameData,
                now: time.time,
            });
            if (closestUuid === undefined) {
                // Nothing hostile in the system: LEAVE THE TARGET (or
                // the lack of one) EXACTLY AS IT IS, and emit nothing —
                // the display plays the "can't do that" beep off this
                // same predicate. Clearing the lock here would punish
                // the player for asking a question.
                return;
            }
            // Keep the tab cycle's cursor in step, so the next 'tab'
            // continues from whatever 'r' just picked.
            index.index = ships.findIndex(([shipUuid]) =>
                shipUuid === closestUuid);
            target.target = closestUuid;
            emit(CycleTargetEvent, target);
            return;
        }

        if (controlState.get('nextTarget') !== 'start') {
            return;
        }

        // The cycle cursor runs over [-1, ships.length), where -1 is the
        // "no target" step, and wraps from the last ship back to -1.
        const advance = (i: number) => (i + 2) % (ships.length + 1) - 1;
        // A ship the tab cycle may land on:
        // Not yourself
        // Not your flock (escorts and their spawn),
        //   UNLESS a flock member is disabled (hiddenFromCycle)
        // Not cloaked (unless a cloak scanner allows it)
        // Not exploding (death sequence started)
        const cycleable = ([targetUuid, _targetMovement, targetOwner, _targetShip,
            targetCloak, targetExploding]: typeof ships[number]) =>
            targetUuid !== uuid
            && !hiddenFromCycle(targetUuid, targetOwner?.owner)
            && isTargetable(targetCloak, myScanner)
            && targetExploding === undefined;

        // Step once, then keep stepping past ships that can't be cycled
        // to. Reaching -1 (a full lap with nothing cycleable) clears the
        // target.
        let next = advance(index.index);
        while (next !== -1 && !cycleable(ships[next])) {
            next = advance(next);
        }
        index.index = next;
        target.target = next === -1 ? undefined : ships[next][0];
        emit(CycleTargetEvent, target);
    }
});

/**
 * Applies a peer's explicit target choice (tap/click on a ship) to the
 * ship it controls: no targeting yourself, or ships your scanner can't
 * see through their cloak. Unlike tab/r cycling, an EXPLICIT click DOES
 * target the player's own flock (escorts, idle bay fighters) — that's
 * how you inspect your own ships. An invalid choice is dropped rather
 * than clamped so every peer resolves the input identically.
 */
export function applySetTarget(world: World, peerId: string | undefined,
    targetUuid: string | null) {
    const found = findControlledEntity(world, peerId);
    if (!found) {
        return;
    }
    const target = found.entity.components.get(TargetComponent);
    if (!target) {
        return;
    }
    if (targetUuid === null) {
        target.target = undefined;
        return;
    }
    const targetEntity = world.entities.get(targetUuid);
    if (!targetEntity
        || targetUuid === found.uuid
        || !targetEntity.components.has(ShipComponent)
        // Exploding ships are untargetable everywhere.
        || targetEntity.components.has(ExplodingComponent)) {
        return;
    }
    const cloak = targetEntity.components.get(CloakActiveComponent);
    const myScanner = found.entity.components.get(CloakScannerComponent);
    if (!isTargetable(cloak, myScanner)) {
        return;
    }
    target.target = targetUuid;
}

export const TargetRemovedEvent = new EcsEvent<string>('TargetRemovedEvent');
const TargetRemovedSystem = new System({
    name: 'TargetRemovedSystem',
    events: [DeleteEvent],
    args: [UUID, new Query([TargetComponent, UUID] as const), Emit] as const,
    step(uuid, withTarget, emit) {
        const targetRemoved: string[] = [];
        for (const [target, targeterUuid] of withTarget) {
            if (target.target === uuid) {
                target.target = undefined;
                targetRemoved.push(targeterUuid);
            }
        }
        emit(TargetRemovedEvent, uuid, targetRemoved);
    }
});

// Drops any SHIP's target that has become cloaked. A ship you were
// targeting that cloaks vanishes from your sensors, so the lock is lost —
// matching the "cloaked ships are untargetable" rule for locks already
// held. A cloak scanner that allows targeting cloaked ships keeps the
// lock. Gated on ShipComponent: projectiles keep their TargetComponent,
// so a homing missile's lock is SUSPENDED while its target is cloaked
// (it stops homing in ProjectileGuidanceSystem) and resumes on decloak,
// per observed original-game behavior.
const CloakedTargetQuery = new Query([UUID, CloakActiveComponent] as const);
const DropCloakedTargetSystem = new System({
    name: 'DropCloakedTarget',
    args: [TargetComponent, ShipComponent, CloakedTargetQuery,
        Optional(CloakScannerComponent)] as const,
    step(target, _ship, cloakedShips, myScanner) {
        if (!target.target) {
            return;
        }
        for (const [uuid, cloak] of cloakedShips) {
            if (uuid === target.target && !isTargetable(cloak, myScanner)) {
                target.target = undefined;
                return;
            }
        }
    }
});

/**
 * Drops ANY entity's target the moment that target starts its death
 * sequence (ExplodingComponent, set at zero armor): an exploding ship
 * is beyond shooting at, so locks break immediately — for the player,
 * NPCs, escorts, and guided weapons alike. ExplodingComponent is
 * shared sim state (snapshot/wire covered), so every peer drops the
 * lock on the same tick.
 */
const ExplodingShipsQuery = new Query([UUID, ExplodingComponent] as const);
const DropExplodingTargetSystem = new System({
    name: 'DropExplodingTarget',
    args: [TargetComponent, ExplodingShipsQuery] as const,
    step(target, explodingShips) {
        if (!target.target) {
            return;
        }
        for (const [uuid] of explodingShips) {
            if (uuid === target.target) {
                target.target = undefined;
                return;
            }
        }
    }
});

export const TargetPlugin: Plugin = {
    name: "TargetPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        deltaMaker.addComponent(TargetComponent, {
            componentType: Target,
        });

        world.addSystem(TargetIndexProvider);
        world.addSystem(ChooseTargetSystem);
        world.addSystem(TargetRemovedSystem);
        world.addSystem(DropCloakedTargetSystem);
        world.addSystem(DropExplodingTargetSystem);
    }
}
