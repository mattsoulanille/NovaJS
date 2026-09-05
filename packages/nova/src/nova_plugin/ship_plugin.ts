import * as t from 'io-ts';
import { OutfitData } from "novadatainterface/outfit_data";
import { ShipData, ShipPhysics } from "novadatainterface/ship_data";
import { DEFAULT_IONIZE_COLOR } from "novadatainterface/weapon_data";
import { GetEntity } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { System } from 'nova_ecs/system';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { MovementPhysics, MovementPhysicsComponent, MovementStateComponent, MovementType } from 'nova_ecs/plugins/movement_plugin';
import { passthroughType, SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Provide } from 'nova_ecs/provide';
import { RandomResource } from 'nova_ecs/plugins/random_plugin';
import { ProvideFromCache } from './provide_from_cache.js';
import { AnimationComponent } from './animation_plugin.js';
import { CollisionVulnerabilityComponent } from './collision_interaction.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { ArmorComponent, AUTO_REFUEL_PER_SECOND, FuelComponent, IonizationColorComponent, IonizationComponent, ShieldComponent } from './health_plugin.js';
import { applyOutfitPhysics, OutfitsState, OutfitsStateComponent } from './outfit_plugin.js';
import { registerEntityDeriver } from './entity_factory.js';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { ControlledByComponent } from './ship_control.js';
import { Stat } from './stat.js';
import { TargetComponent } from './target_component.js';

export const ShipType = t.type({
    id: t.string // Not a UUID. A nova id.
});
export type ShipType = t.TypeOf<typeof ShipType>;

export const ShipComponent = new Component<ShipType>('Ship');

export const ShipDataComponent = new Component<ShipData>('ShipData');

function deriveShipData(gameData: SimulationGameDataInterface, ship: { id: string }) {
    return gameData.data.Ship.getCached(ship.id);
}

export const ShipDataProvider = ProvideFromCache({
    name: "ShipDataProvider",
    provided: ShipDataComponent,
    args: [SimulationGameDataResource, ShipComponent] as const,
    update: [ShipComponent],
    factory: deriveShipData,
});

/**
 * A ship class's STOCK loadout as an outfits state. Exported because the
 * escort upgrade replaces a ship's class in place (escort_action.ts) and
 * must write the new class's loadout itself rather than hoping the provider
 * below re-derives it in the right order relative to ShipDataProvider.
 */
export function deriveShipOutfits(shipData: ShipData): OutfitsState {
    return new Map(Object.entries(shipData.outfits)
        .map(([id, count]) => [id, { count }]));
}

export const ShipOutfitsProvider = Provide({
    name: "ShipOutfitsProvider",
    provided: OutfitsStateComponent,
    args: [ShipDataComponent] as const,
    // Not ShipDataComponent because then this would always be provided
    // since ShipDataComponent is always provided since it's not multiplayer.
    update: [ShipComponent],
    factory: deriveShipOutfits,
});

export const ShipPhysicsComponent = new Component<ShipPhysics>('ShipPhysicsComponent');

/**
 * A ship's OUTFITTED physics: its hull's ShipPhysics with every owned
 * outfit's modifiers summed on top. Returns undefined when an owned
 * outfit's data is not cached yet, so the caller can retry (the provider
 * next step; a UI caller after awaiting the loads itself).
 *
 * Exported because this is the ONE derivation of a ship's physics: the
 * provider and the takeoff deriver below, and the docked spaceport
 * dialogs (spaceport/player_info.ts, which have no ShipPhysicsComponent
 * to read while the outfitter has deleted it), all go through it — so
 * what the player reads while landed is exactly what the relaunched ship
 * flies with. Off-world callers must not ATTACH the result to the
 * detached entity; see the reconciliation note further down.
 */
export function deriveShipPhysics(shipData: ShipData,
    gameData: SimulationGameDataInterface, outfitsState: OutfitsState) {
    const outfits: (readonly [OutfitData, number])[] = [];
    for (const [id, { count }] of outfitsState) {
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            // Not loaded yet; retry next step.
            return undefined;
        }
        outfits.push([outfit, count] as const);
    }
    return applyOutfitPhysics(shipData.physics, outfits);
}

export const ShipPhysicsProvider = ProvideFromCache({
    name: "ShipPhysicsProvider",
    provided: ShipPhysicsComponent,
    args: [ShipDataComponent, SimulationGameDataResource, OutfitsStateComponent] as const,
    update: [ShipDataComponent, OutfitsStateComponent],
    factory: deriveShipPhysics,
});

export function getShipMovementPhysics(physics: ShipPhysics): MovementPhysics {
    return {
        acceleration: physics.acceleration,
        maxVelocity: physics.speed,
        movementType: physics.inertialess
            ? MovementType.INERTIALESS : MovementType.INERTIAL,
        turnRate: physics.turnRate,
    };
}

/**
 * MovementPhysicsComponent is only ATTACHED here. Its values are
 * rewritten from ShipPhysicsComponent every tick by
 * EffectiveMovementPhysicsSystem (afterburner_plugin.ts), which layers
 * the afterburner boost, the ionization slowdown and the hyperspace
 * departure burn on top of the base numbers — so it, not this provider,
 * is what keeps a ship's speed and turn rate following its outfits.
 * Re-deriving here as well would clobber that system's work on whichever
 * ticks it ran second.
 */
export const ShipMovementPhysicsProvider = Provide({
    name: "ShipMovementPhysicsProvider",
    provided: MovementPhysicsComponent,
    update: [ShipPhysicsComponent],
    args: [ShipPhysicsComponent] as const,
    factory: getShipMovementPhysics,
});

/**
 * WHY THE STATS BELOW ARE RECONCILED EVERY STEP INSTEAD OF `Provide`d
 * ONCE.
 *
 * `Provide` re-derives on a ChangeEvent for the component it watches,
 * and a ChangeEvent only fires for a component set on an entity that is
 * ALREADY IN A WORLD (ProvidePlugin subscribes to the entity map's
 * changeComponent event). Every path that recomputes a ship's physics
 * does it OFF-WORLD, on a detached entity:
 *
 *   - the spaceport's outfitter deletes ShipPhysicsComponent from the
 *     DETACHED docked entity so it is rebuilt with the new outfits
 *     (spaceport.ts showOutfitter), and the relaunch rebuilds it in
 *     deriveEntityComponents *before* world.entities.set (see
 *     simulation_input.ts, 'addEntity');
 *   - snapshots skip ShipPhysicsComponent (snapshot_policies.ts) and a
 *     restore re-derives it the same detached way.
 *
 * The stats, by contrast, are serializer-registered, so they ride
 * through the landing (and through a snapshot restore) carrying the
 * values they already had. Nothing fired, so a ship kept the capacity
 * of its PREVIOUS outfit set indefinitely: buy the third Battery Pack
 * for a 400-energy hull whose two Organic Armors eat 400, and
 * FuelComponent.max stayed at 200 (two jumps) instead of 300 — and
 * because Stat.step clamps `current` into [min, max] every tick, the
 * fuel really was gone, not just mis-drawn. Only a page reload (which
 * rebuilds the ship from the save, with no stat to carry over) cleared
 * it. Shield and armor capacity went stale by the same route.
 *
 * Reconciling is idempotent — the derived fields are written only when
 * they actually differ — so resimulation stays deterministic and the
 * stat delta channel is not flooded with unchanged values.
 */

/** A ship stat's bounds and recharge, as its physics dictates them. */
interface StatBounds {
    max: number;
    min: number;
    recharge: number;
}

/**
 * A system that attaches `component` when the ship has no such stat yet,
 * and otherwise keeps the stat's derived fields (max, min, recharge) in
 * step with the ship's physics. `current` is simulation state and is
 * never re-derived — buying a bigger tank does not fill it — but it is
 * clamped back into range when the capacity it lives in shrinks.
 */
function shipStatSystem(name: string, component: Component<Stat>,
    bounds: (physics: ShipPhysics) => StatBounds,
    initialCurrent: (physics: ShipPhysics) => number) {
    return new System({
        name,
        args: [ShipPhysicsComponent, Optional(component), GetEntity] as const,
        step(physics, stat, entity) {
            reconcileStat(entity, component, stat, bounds(physics),
                initialCurrent(physics));
        }
    });
}

/** The step of shipStatSystem, shared with the fuel provider below. */
function reconcileStat(entity: Entity, component: Component<Stat>,
    stat: Stat | undefined, { max, min, recharge }: StatBounds,
    initialCurrent: number): void {
    if (!stat) {
        entity.components.set(component, new Stat({
            current: initialCurrent, max, min, recharge,
        }));
        return;
    }
    if (stat.max === max && stat.min === min
        && stat.recharge === recharge) {
        return;
    }
    // Through the setters, which flag the change for the stat
    // delta channel (getStatDelta) — a brand new Stat would
    // report no change at all and leave other peers on the old
    // capacity.
    stat.max = max;
    stat.min = min;
    stat.recharge = recharge;
    // Selling the tank spills what no longer fits. The recharge
    // systems clamp too, but only after this tick's readers
    // (the jump check, the status bar) have looked.
    const clamped = Math.max(min, Math.min(max, stat.current));
    if (stat.current !== clamped) {
        stat.current = clamped;
    }
}

const ShipAnimationProvider = Provide({
    name: "ShipAnimationProvider",
    provided: AnimationComponent,
    update: [ShipDataComponent],
    args: [ShipDataComponent],
    factory: shipData => shipData.animation,
});

function deriveShipVulnerability(shipData: ShipData | undefined) {
    return {
        // 'debris' lets asteroid resource-boxes (which hit nothing
        // else) collide with ships for scooping.
        //
        // 'pointDefense' rides in from the ship's own data (shïp Flags2
        // 0x0008, EVN Bible ~:2572: "Ship can be fired on by point
        // defense systems"), which ship_parse folds into the same
        // `vulnerableTo` list the weapon parser uses. Without the tag a
        // PD shot passes straight through, which is the Bible's rule:
        // point defense damages incoming guided weapons and the ship
        // classes that opt in, and nothing else. A fighter's PD marker
        // (VulnerableToPD, which is what a turret AIMS at) is derived
        // from the same field in fire_weapon_plugin, so a turret can
        // never target something its shots cannot hurt.
        //
        // `shipData` is optional because this provider can run on the
        // tick before ShipDataProvider has attached it; `update`
        // re-derives the moment it lands. Re-deriving is safe: the
        // 'return_escorts' tag a carrier needs is re-added every step by
        // bay_plugin's ReturnVulnerabilitySystem, which exists precisely
        // because this set is rebuilt whenever the ship is.
        vulnerableTo: new Set<unknown>(
            shipData?.vulnerableTo.includes('pointDefense')
                ? ['normal', 'debris', 'pointDefense']
                : ['normal', 'debris']),
    };
}

const ShipCollisionInteractionProvider = Provide({
    name: "ShipCollisionInteractionProvider",
    provided: CollisionVulnerabilityComponent,
    update: [ShipDataComponent],
    args: [ShipComponent, Optional(ShipDataComponent)] as const,
    factory: (_ship, shipData) => deriveShipVulnerability(shipData),
});

const ShipShieldProvider = shipStatSystem(
    "ShipShieldProvider", ShieldComponent,
    physics => ({
        max: physics.shield,
        min: -physics.shield * 0.05,
        recharge: physics.shieldRecharge,
    }),
    physics => physics.shield);

const ShipArmorProvider = shipStatSystem(
    "ShipArmorProvider", ArmorComponent,
    physics => ({
        max: physics.armor,
        min: 0,
        recharge: physics.armorRecharge,
    }),
    physics => physics.armor);

/**
 * A ship's fuel bounds: capacity, and the per-second recharge from three
 * sources — fuel scoops (oütf ModType 18), an auto-refueller (ModType 19,
 * a slow constant trickle), and the hull's own shïp FuelRegen.
 *
 * THE HULL TERM IS GATED FOR THE PLAYER. shïp Flags 0x0008 is "Player
 * ship takes advantage of FuelRegen property" (EVN Bible ~:2517), and
 * FuelRegen itself says "for the player to be able to use this field, the
 * 0x0008 flag must also be set (this allows you to give enemy ships
 * built-in fuel scoops but still make the player have to buy his own)"
 * (~:2554). `physics.energyRecharge` is hull plus outfits (outfit_plugin's
 * applyOutfitPhysics sums them), so the hull's share — the class's own
 * ShipData.physics.energyRecharge — is subtracted back out for a
 * player-controlled ship whose class lacks the flag. Outfit scoops stay.
 *
 * Every stock regenerating class sets the flag, so stock is unchanged;
 * without the gate thirteen plug-in hulls handed the player free fuel
 * (the Purveyor, the X-wing) and arpia's two FuelRegen -1 hulls (421
 * Frandall, 422 Uhngys) DRAINED a player's 300-unit tank in ten seconds,
 * where the original drains nothing.
 *
 * "The player" is a ControlledByComponent ship: peer-controlled, and
 * synced, so every peer derives the same stat. Escorts are AI-flown and
 * keep their class's regeneration, as the Bible's "enemy ships" do.
 */
export function shipFuelBounds(physics: ShipPhysics, shipData: ShipData,
    playerControlled: boolean): StatBounds {
    const hullRegen = playerControlled && !shipData.playerFuelRegen
        ? shipData.physics.energyRecharge : 0;
    return {
        max: physics.energy,
        min: 0,
        recharge: physics.energyRecharge - hullRegen
            + (physics.autoRefuel ? AUTO_REFUEL_PER_SECOND : 0),
    };
}

const ShipFuelProvider = new System({
    name: "ShipFuelProvider",
    args: [ShipPhysicsComponent, ShipDataComponent,
        Optional(ControlledByComponent), Optional(FuelComponent),
        GetEntity] as const,
    step(physics, shipData, controlledBy, fuel, entity) {
        reconcileStat(entity, FuelComponent, fuel,
            shipFuelBounds(physics, shipData, controlledBy !== undefined),
            physics.energy);
    },
});

const ShipIonizationProvider = shipStatSystem(
    "ShipIonizationProvider", IonizationComponent,
    physics => ({
        max: physics.ionization,
        min: 0,
        recharge: -physics.deionize,
    }),
    () => 0);

/**
 * A ship's ionization colour before any ionizing weapon has hit it.
 *
 * DamageSystem overwrites this with the wëap IonizeColor of each
 * ionizing hit, so in practice a ship is never displayed on this value —
 * you cannot be ionized without having been hit by something that
 * ionizes. It stands in for the Bible's zero sentinel: any future
 * non-weapon ionization source gets "a default bluish color" for free
 * rather than a hardcoded grey that no wëap field ever asked for.
 */
const ShipIonizationColorProvider = Provide({
    name: "ShipIonizationColorProvider",
    provided: IonizationColorComponent,
    args: [] as const,
    factory() {
        return { color: DEFAULT_IONIZE_COLOR };
    }
});

const ShipMovementStateProvider = Provide({
    name: "ShipMovementStateProvider",
    provided: MovementStateComponent,
    args: [ShipComponent, RandomResource] as const,
    factory(_ship, random) {
        return {
            accelerating: 0,
            position: new Position(600 * (random.next() - 0.5),
                (600 * (random.next() - 0.5))),
            rotation: new Angle(random.next() * 2 * Math.PI),
            turnBack: false,
            turning: 0,
            velocity: new Vector(0, 0),
        }
    }
});

const ShipTargetComponentProvider = Provide({
    name: "ShipTaretComponentProvider",
    provided: TargetComponent,
    args: [ShipComponent],
    factory() {
        return { target: undefined };
    }
});

export const ShipPlugin: Plugin = {
    name: "ShipPlugin",
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(ShipComponent);
        world.addComponent(ShipDataComponent);
        world.resources.get(SerializerResource)?.addComponent(
            ShipDataComponent, passthroughType<ShipData>('ShipDataComponentType'));

        // Derivers attach these components synchronously when an
        // entity is completed (staged insertion, snapshot restore).
        // The provider systems below remain as the fallback for
        // entities that bypass staging.
        registerEntityDeriver(world, {
            name: 'ShipDataDeriver',
            provided: ShipDataComponent,
            requires: [ShipComponent],
            derive: (entity, gameData) =>
                deriveShipData(gameData, entity.components.get(ShipComponent)!),
        });
        registerEntityDeriver(world, {
            name: 'ShipOutfitsDeriver',
            provided: OutfitsStateComponent,
            requires: [ShipDataComponent],
            derive: (entity) =>
                deriveShipOutfits(entity.components.get(ShipDataComponent)!),
        });
        registerEntityDeriver(world, {
            name: 'ShipPhysicsDeriver',
            provided: ShipPhysicsComponent,
            requires: [ShipDataComponent, OutfitsStateComponent],
            derive: (entity, gameData) => deriveShipPhysics(
                entity.components.get(ShipDataComponent)!,
                gameData,
                entity.components.get(OutfitsStateComponent)!),
        });

        world.addSystem(ShipCollisionInteractionProvider);
        world.addSystem(ShipDataProvider);
        world.addSystem(ShipAnimationProvider);
        world.addSystem(ShipOutfitsProvider);
        world.addSystem(ShipPhysicsProvider);
        world.addSystem(ShipMovementPhysicsProvider);
        world.addSystem(ShipShieldProvider);
        world.addSystem(ShipArmorProvider);
        world.addSystem(ShipFuelProvider);
        world.addSystem(ShipIonizationProvider);
        world.addSystem(ShipIonizationColorProvider);
        world.addSystem(ShipMovementStateProvider);
        world.addSystem(ShipTargetComponentProvider);

        deltaMaker.addComponent(ShipComponent, {
            componentType: ShipType,
        });
    }
}
