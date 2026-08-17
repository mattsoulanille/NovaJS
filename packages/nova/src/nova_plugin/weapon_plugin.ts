import * as t from 'io-ts';
import { AmmoType, WeaponData } from 'novadatainterface/weapon_data';
import { Emit, EmitFunction, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { EcsEvent } from 'nova_ecs/events';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { Time, TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Provide } from 'nova_ecs/provide';
import { System } from 'nova_ecs/system';
import { SimulationGameDataInterface } from '../client/gamedata/simulation_game_data.js';
import { registerSimulationBridgeEvent } from '../communication/simulation_bridge_events.js';
import { mod } from '../util/mod.js';
import { ControlledByComponent, ShipControlEvent, ShipControlStateComponent } from './ship_control.js';
import { ExplodingComponent, ZeroArmorEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { FoldStateComponent, foldBlocksFiring } from './fold_state.js';
import { WeaponEntries, WeaponLocalState, WeaponsComponent } from './fire_weapon_plugin.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { ArmorComponent, FuelComponent } from './health_plugin.js';
import { OutfitsState, OutfitsStateComponent } from './outfit_plugin.js';
import { PlatformResource } from './platform_plugin.js';
import { PlayerShipSelector } from './player_ship_plugin.js';
import { Stat } from './stat.js';
import { WeaponsState, WeaponsStateComponent, WeaponState } from './weapons_state.js';

function checkReloaded(weapon: WeaponData, localState: WeaponLocalState,
    state: WeaponState, time: Time): boolean {
    const lastFired = localState.lastFired;

    let reloadTime = weapon.fireSimultaneously
        ? weapon.reload : weapon.reload / state.count;
    let reloadingBurst = false;
    if (localState.burstCount > weapon.burstCount * state.count) {
        reloadTime = weapon.burstReload;
        reloadingBurst = true;
    }

    if (time.time - lastFired < reloadTime) {
        // Still reloading
        return false;
    }

    if (reloadingBurst) {
        localState.burstCount = 0;
    }

    return true;
}

/**
 * Counts the rounds available for a weapon that draws its ammo from the
 * supply of the weapon with global id `sourceWeapon`. Ammo outfits
 * whose data is not cached yet count as zero rounds; entities enter the
 * simulation with their game data preloaded, so that only affects
 * entities that bypassed staging.
 */
export function countAmmo(sourceWeapon: string, outfits: OutfitsState,
    gameData: SimulationGameDataInterface): number {
    let count = 0;
    for (const [id, state] of outfits) {
        if (gameData.data.Outfit.getCached(id)?.ammoFor === sourceWeapon) {
            count += state.count;
        }
    }
    return count;
}

function hasAmmo(ammoType: AmmoType, outfits: OutfitsState | undefined,
    fuel: Stat | undefined, gameData: SimulationGameDataInterface): boolean {
    if (ammoType === 'unlimited') {
        return true;
    }
    if (ammoType[0] === 'energy') {
        // A weapon with a fuel cost can't fire on insufficient fuel.
        return (fuel?.current ?? 0) >= ammoType[1];
    }
    return outfits ? countAmmo(ammoType[1], outfits, gameData) > 0 : false;
}

function consumeAmmo(ammoType: AmmoType, outfits: OutfitsState | undefined,
    fuel: Stat | undefined, gameData: SimulationGameDataInterface) {
    if (ammoType === 'unlimited') {
        return;
    }
    if (ammoType[0] === 'energy') {
        if (fuel) {
            fuel.current = Math.max(fuel.min, fuel.current - ammoType[1]);
        }
        return;
    }
    if (!outfits) {
        return;
    }
    // Consume from the lowest outfit id with rounds left so every peer
    // makes the same choice when multiple outfits hold this ammo.
    const id = [...outfits.keys()]
        .filter(id => gameData.data.Outfit.getCached(id)?.ammoFor === ammoType[1]
            && outfits.get(id)!.count > 0)
        .sort()[0];
    if (id !== undefined) {
        outfits.get(id)!.count--;
    }
}

/**
 * Kills the ship that just fired a wëap with AmmoType -999 ("Ship is
 * destroyed when weapon is fired", EVN Bible ~:3124).
 *
 * It gets the NORMAL death, not a quiet deletion: armor is driven to its
 * floor and a ZeroArmorEvent is emitted, which is exactly what a killing
 * hit does. ShipZeroArmorSystem then starts the shïp's own death
 * sequence (DeathDelay, the Explode1/Explode2 booms on the display), and
 * the DeathEvent at the end of it runs every consumer that a death
 * normally runs: ShipExplosionBlastSystem drops the hull's blast,
 * DeathAISystem removes an NPC (a bay fighter is one), PlayerDeathSystem
 * respawns a player. The Bible says only "destroyed", and destroyed is
 * what every other destroyed ship does.
 *
 * ARMOR IS ZEROED RATHER THAN ONLY SIGNALLED, and that is load-bearing:
 * ShipZeroArmorSystem ignores a ZeroArmorEvent whose subject is back at
 * full armor (armorFullyRestored — the stale-event guard that stops a
 * respawned player re-entering a death sequence). A ship destroyed by
 * its own trigger is at full armor by definition, so signalling alone
 * would be swallowed by that guard and nothing would happen at all.
 *
 * Emitting rather than attaching ExplodingComponent directly keeps this
 * on the one path deaths already take, so nothing here has to know about
 * DeathDelay, the exploding-already case, or the display.
 *
 * DETERMINISM: a component write and a targeted emit off already-synced
 * state; no PRNG, no clock beyond the shared Time the event carries.
 */
export function destroyFiringShip(emit: EmitFunction, uuid: string,
    time: Time, armor?: Stat) {
    if (armor) {
        armor.current = armor.min;
    }
    emit(ZeroArmorEvent, time, [uuid]);
}

export const WeaponsSystem = new System({
    name: 'WeaponsSystem',
    args: [WeaponsStateComponent, WeaponsComponent, TimeResource, UUID,
        WeaponEntries, Optional(OutfitsStateComponent), Optional(FuelComponent),
        SimulationGameDataResource, Optional(DisabledComponent),
        Optional(FoldStateComponent), Emit, Optional(ArmorComponent),
        Optional(ExplodingComponent)] as const,
    step(weaponsState, weaponsLocalState, time, uuid, weaponEntries,
        outfits, fuel, gameData, disabled, foldState, emit, armor,
        exploding) {
        // A disabled ship cannot fire anything — held triggers, NPC fire
        // control, and even automatic point defense are all suspended.
        // (Safe to gate before the localState touch: DisabledComponent
        // is deterministic simulation state, identical on every peer.)
        if (disabled) {
            return;
        }
        // An asteroid miner (folding + unfoldWhenFiring) cannot fire until
        // its claws are fully unfolded. Blocks EVERY weapon slot — primary,
        // secondary (the miner's Mining Blaster is one), and point defense —
        // matching the Bible's unqualified "unfolds when firing weapons".
        // FoldStateComponent is present only on such ships, and it is
        // deterministic sim state, so gating on it is identical on every
        // peer. The firing INTENT stays set on the weapon states, so
        // FoldAdvanceSystem keeps the claws opening.
        if (foldBlocksFiring(foldState)) {
            return;
        }
        for (const [id, state] of weaponsState) {
            // Touch the local state before any cache-dependent guard:
            // the DefaultMap creates entries on access, entries are
            // hashed simulation state, and getCached succeeding is a
            // property of *this world's* load timing — state creation
            // gated on it diverges peers whose caches warm at
            // different ticks.
            const localState = weaponsLocalState.get(id);
            const weapon = weaponEntries.getCached(id);
            if (!weapon) {
                continue;
            }
            if (!checkReloaded(weapon.data, localState, state, time)) {
                continue;
            }

            if (!(state.firing
                || weapon.data.guidance === 'pointDefense'
                || weapon.data.guidance === 'pointDefenseBeam')) {
                continue;
            }

            // A hull that is already coming apart does not throw itself
            // away a second time. The death a self-destruct weapon starts
            // lasts the shïp's DeathDelay, and the trigger that started it
            // is usually still held (a player's key, an AI's latched
            // `firing` flag), so without this the same ship would fire
            // once per reload all the way through its own explosion.
            if (weapon.data.destroyShipWhenFiring && exploding !== undefined) {
                continue;
            }

            // 'Only use ammo at end of burst cycle': shots after the
            // first of a burst neither require nor consume ammo.
            const ammoType = weapon.data.ammoType;
            const usesAmmo = !('oneAmmoPerBurst' in weapon.data
                && weapon.data.oneAmmoPerBurst)
                || localState.burstCount === 0;

            let fired: Entity | undefined = undefined;
            if (weapon.data.fireSimultaneously) {
                for (let i = 0; i < state.count; i++) {
                    if (usesAmmo && !hasAmmo(ammoType, outfits, fuel, gameData)) {
                        break;
                    }
                    const shot = weapon.fireFromEntity(uuid);
                    if (shot && usesAmmo) {
                        consumeAmmo(ammoType, outfits, fuel, gameData);
                    }
                    fired = shot || fired;
                }
            } else {
                if (usesAmmo && !hasAmmo(ammoType, outfits, fuel, gameData)) {
                    continue;
                }
                fired = weapon.fireFromEntity(uuid);
                if (fired && usesAmmo) {
                    consumeAmmo(ammoType, outfits, fuel, gameData);
                }
            }

            if (fired) {
                if (weapon.data.burstCount) {
                    localState.burstCount++;
                }
                localState.lastFired = time.time;
                // The same instant, in SYNCED state, so the display can
                // tell a shot that actually left the ship from a held
                // trigger that produced nothing (targetless turret, empty
                // point-defense sweep, dry ammo). Only the weapon-glow
                // overlay reads it; the reload clock above stays the
                // local copy. See WeaponState.lastFired.
                state.lastFired = time.time;

                // wëap AmmoType -999: the shot left, and it took the ship
                // with it. Returning (rather than continuing the loop)
                // means no LATER weapon of a destroyed ship fires on the
                // same tick; the shot itself is already away, which is
                // the whole point of the field.
                if (weapon.data.destroyShipWhenFiring) {
                    destroyFiringShip(emit, uuid, time, armor);
                    return;
                }
            }
        }
    },
    // Determinism rule 4: reload/burst timing compares against time.time
    // and time.delta_s, so this must run after TimeSystem.
    after: [TimeSystem],
});

type ActiveSecondary = {
    secondary: string | null /* id */,
};

export const ActiveSecondaryWeapon =
    new Component<ActiveSecondary>('ActiveSecondaryWeapon');

const ActiveSecondaryProvider = Provide({
    name: "ActiveSecondaryProvider",
    provided: ActiveSecondaryWeapon,
    // Every controlled ship (any peer's), not just the local player:
    // this is shared simulation state.
    args: [ControlledByComponent] as const,
    factory: () => ({ secondary: null }),
});

export const ChangeSecondaryEvent = new EcsEvent<ActiveSecondary>('ChangeSecondaryEvent');
export const ActiveSecondaryType = t.type({
    secondary: t.union([t.string, t.null]),
});

registerSimulationBridgeEvent({ event: ChangeSecondaryEvent });

const ControlPlayerWeapons = new System({
    name: 'ControlPlayerWeapons',
    events: [ShipControlEvent],
    args: [ShipControlStateComponent, WeaponsStateComponent, WeaponsComponent,
        ActiveSecondaryWeapon, Emit, UUID] as const,
    step(controlState, weaponsState, _weaponsData, activeSecondary, emit, uuid) {
        for (const [, weaponState] of weaponsState) {
            weaponState.firing = false;
        }

        // Selection is a pure function of the synced weapon state:
        // fireGroup rides in WeaponsState (set when it derives), never
        // read from getCached here — a cache-warmth-gated filter at
        // input-application time is per-world state, and cycling on it
        // selects different secondaries on different worlds.
        const secondaryWeapons = [
            undefined, // for when no weapon is selected
            ...[...weaponsState].filter(([, state]) =>
                state.fireGroup === 'secondary').map(([id]) => id)
        ];

        let secondary: WeaponState | undefined;
        let secondaryIndex = 0;
        if (activeSecondary.secondary) {
            // has-guarded: WeaponsState is a DefaultMap, and a bare
            // get() for a STALE active secondary (a saved selection
            // for a weapon this loadout no longer owns) would CREATE
            // a phantom hashed entry. Worlds that later wire-restore
            // re-derive WeaponsState phantom-free, but a world that
            // never restores (the server's archive) keeps it forever
            // — the archive-vs-everyone desync class, finally caught
            // by the archive_state instrumentation.
            secondary = weaponsState.has(activeSecondary.secondary)
                ? weaponsState.get(activeSecondary.secondary) : undefined;
            secondaryIndex = secondaryWeapons.indexOf(activeSecondary.secondary);
        }

        let changedSecondary = false;

        if (controlState.get('resetSecondary') === 'start') {
            secondaryIndex = 0;
            changedSecondary = true;
        } else if (controlState.get('previousSecondary') === 'start') {
            secondaryIndex--;
            changedSecondary = true;
        } else if (controlState.get('nextSecondary') === 'start') {
            secondaryIndex++;
            changedSecondary = true;
        }

        secondaryIndex = mod(secondaryIndex, secondaryWeapons.length);
        activeSecondary.secondary = secondaryWeapons[secondaryIndex] ?? null;

        if (changedSecondary) {
            // Targeted at this ship: every peer simulates every
            // ship's weapon selection, and an untargeted event would
            // redraw every player's status bar with this ship's
            // choice.
            emit(ChangeSecondaryEvent, activeSecondary, [uuid]);
        }

        if (activeSecondary.secondary) {
            // Same has-guard as above: never create entries here.
            secondary = weaponsState.has(activeSecondary.secondary)
                ? weaponsState.get(activeSecondary.secondary) : undefined;
        }

        if (secondary) {
            secondary.firing = Boolean(controlState.get('fireSecondary'));
        }

        const firing = Boolean(controlState.get('firePrimary'));
        for (const [, weaponState] of weaponsState) {
            if (weaponState.fireGroup === 'primary') {
                weaponState.firing = firing;
            }
        }
    }
});

export const WeaponPlugin: Plugin = {
    name: 'WeaponPlugin',
    build(world) {
        const gameData = world.resources.get(SimulationGameDataResource);
        if (!gameData) {
            throw new Error('missing gameData');
        }

        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(WeaponsStateComponent);
        world.resources.get(SerializerResource)?.addComponent(ActiveSecondaryWeapon, ActiveSecondaryType);
        world.resources.get(SerializerResource)?.addEvent(ChangeSecondaryEvent, ActiveSecondaryType);
        world.addSystem(WeaponsSystem);
        // Every simulation runs the same systems regardless of
        // platform, or simulations of the same ships diverge.
        world.addSystem(ActiveSecondaryProvider);
        world.addSystem(ControlPlayerWeapons);
        deltaMaker.addComponent(WeaponsStateComponent, {
            componentType: WeaponsState
        });
    }
}
