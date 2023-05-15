import { ShipData } from "novadatainterface/ShipData";
import { Entities, UUID } from "nova_ecs/arg_types";
import { Component } from "nova_ecs/component";
import { Plugin } from "nova_ecs/plugin";
import { MovementStateComponent } from "nova_ecs/plugins/movement_plugin";
import { TimeResource } from "nova_ecs/plugins/time_plugin";
import { Query } from "nova_ecs/query";
import { System } from "nova_ecs/system";
import { DeathEvent } from "./death_plugin";
import { makeShip } from "./make_ship";
import { ShipComponent } from "./ship_plugin";
import { TargetComponent } from "./target_component";
import { WeaponsStateComponent } from "./weapons_state";
import { GameDataResource } from "./game_data_resource";

const TargetsQuery = new Query([UUID, ShipComponent] as const);
function getValidTargets(targets: Array<readonly [string, any]>, selfUuid: string): string[] {
    return targets.filter(([targetId]) => targetId !== selfUuid)
        .map(([uuid]) => uuid);
}

const ChooseRandomTargetComponent = new Component<{
    interval: number,
    nextTime?: number,
}>('ChooseRandomTargetComponent');

const ChooseRandomTargetAI = new System({
    name: 'ChooseRandomTarget',
    args: [TargetComponent, TargetsQuery, ChooseRandomTargetComponent,
        TimeResource, UUID, Entities] as const,
    step(target, targets, randomTargetData, time, uuid, entities) {
        if ((randomTargetData.nextTime ?? 0) > time.time &&
            target.target && entities.has(target.target)) {
            return;
        }
        randomTargetData.nextTime = time.time + randomTargetData.interval;

        const validTargets = getValidTargets(targets, uuid);

        if (validTargets.length === 0) {
            target.target = undefined;
            return;
        }

        const index = Math.floor(Math.random() * validTargets.length);
        target.target = validTargets[index];
    }
});

export const FollowComponent = new Component<undefined>('FollowComponent');
const FollowAI = new System({
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
    args: [WeaponsStateComponent, GameDataResource, TargetComponent, ShootAllWeaponsComponent] as const,
    step(weapons, gameData, { target }) {
        for (const [id, weapon] of weapons) {
            const weaponType = gameData.data.Weapon.getCached(id)?.type;
            if (weaponType == null || weaponType === 'BayWeaponData') {
                // do not use bay weapons yet since there is no ammo limit.
                continue;
            };
            weapon.target = target;
            weapon.firing = true;
        }
    }
});


export const DeathAIComponent = new Component<undefined>('DeathAIComponent');
const DeathAI = new System({
    name: 'DeathAI',
    events: [DeathEvent],
    args: [Entities, UUID, DeathAIComponent] as const,
    step(entities, uuid) {
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
        world.addSystem(ChooseRandomTargetAI);
        world.addSystem(FollowAI);
        world.addSystem(ShootAllWeaponsAI);
        world.addSystem(DeathAI);
    },
    remove(world) {
        world.removeSystem(ChooseRandomTargetAI);
        world.removeSystem(FollowAI);
        world.removeSystem(ShootAllWeaponsAI);
    }
}

