import * as t from 'io-ts';
import { CloakData, getDefaultCloakData } from 'novadatainterface/cloak_data';
import { CloakScannerData, getDefaultCloakScannerData } from 'novadatainterface/cloak_scanner_data';
import { Emit, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { System } from 'nova_ecs/system';
import { SimulationGameDataInterface } from '../../client/gamedata/simulation_game_data.js';
import { registerEntityDeriver } from '../core/index.js';
import { SimulationGameDataResource } from '../core/index.js';
import { DamagedEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { FuelComponent, FuelRechargeSystem, ShieldComponent } from './health_plugin.js';
import { OutfitsState, OutfitsStateComponent } from './outfit_plugin.js';
import { ProvideFromCache } from '../core/index.js';
import { ShipControlEvent, ShipControlStateComponent } from '../player/index.js';
import { PlayerSoundEvent } from '../core/index.js';

// The stock Nova cloak sounds (snd resources in the Nova Files id space).
// Emitted on the PlayerSoundEvent channel targeted at the cloaking ship,
// so only that ship's own pilot hears them (same rule as the warp
// sounds); the display's PlayerSoundSystem does the local-player filter.
export const CLOAK_ON_SOUND = 'nova:381';  // snd 381 "Cloak On"
export const CLOAK_OFF_SOUND = 'nova:380'; // snd 380 "Cloak Off"

/**
 * A ship's cloaking capability, derived from its owned cloaking-device
 * outfits (oütf ModType 17). This is derived state, re-computed whenever
 * OutfitsStateComponent changes, exactly like WeaponsStateComponent — so
 * it is NOT snapshotted (the restore path re-derives it). See
 * novadatainterface/cloak_data.ts for the ModVal bitfield semantics.
 *
 * When a ship owns several cloaking devices we merge them conservatively:
 * boolean qualities OR together, and drain rates take the MINIMUM nonzero
 * rate (the cheapest device to run). `canCloak` is true iff at least one
 * cloak outfit is present.
 */
export interface CloakCapability extends CloakData {
    canCloak: boolean;
}

export const CloakComponent = new Component<CloakCapability>('CloakComponent');

/**
 * A ship's cloak-SCANNER capability, derived from owned cloak-scanner
 * outfits (oütf ModType 30). Like CloakComponent it is derived from
 * outfits and re-derived at restore, so it is skipped from snapshots.
 * `hasScanner` is true iff at least one scanner outfit is present.
 */
export interface CloakScannerCapability extends CloakScannerData {
    hasScanner: boolean;
}

export const CloakScannerComponent =
    new Component<CloakScannerCapability>('CloakScannerComponent');

/**
 * The live cloak toggle. This IS deterministic simulation state: it is
 * flipped by the 'cloak' control input (so every peer agrees) and must
 * survive rollback snapshots. Registered with the serializer/delta layer
 * and given an explicit snapshot policy in snapshot_policies.ts.
 */
export interface CloakActiveState {
    active: boolean;
}
export const CloakActiveType = t.type({ active: t.boolean });
export const CloakActiveComponent =
    new Component<CloakActiveState>('CloakActiveComponent');

/**
 * Whether a ship is currently cloaked (its CloakActiveComponent, if any,
 * is active). Undefined means the ship has no cloak state and so is not
 * cloaked.
 */
export function isCloaked(active: CloakActiveState | undefined): boolean {
    return active?.active === true;
}

/**
 * Whether a target ship can be seen / targeted by an observer. Per the
 * EVN Bible a cloaked ship is untargetable unless the observer has a
 * cloak scanner with the "allow targeting of cloaked ships" bit (ModVal
 * 0x0008). Pass the observer's scanner capability (undefined = none).
 */
export function isTargetable(targetActive: CloakActiveState | undefined,
    observerScanner?: CloakScannerCapability | undefined): boolean {
    if (!isCloaked(targetActive)) {
        return true;
    }
    return observerScanner?.targetsCloaked === true;
}

/**
 * Merges every owned cloak scanner into one capability. Boolean reveal /
 * targeting bits OR together. Returns undefined only when outfit game
 * data is not yet cached (retry next step).
 */
export function deriveCloakScanner(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): CloakScannerCapability | undefined {
    let merged: CloakScannerCapability = {
        ...getDefaultCloakScannerData(),
        hasScanner: false,
    };

    for (const [id, state] of outfits) {
        if (state.count <= 0) {
            continue;
        }
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            return undefined;
        }
        const scanner = outfit.cloakScanner;
        if (!scanner.isCloakScanner) {
            continue;
        }
        merged = {
            isCloakScanner: true,
            hasScanner: true,
            revealsOnRadar: merged.revealsOnRadar || scanner.revealsOnRadar,
            revealsOnScreen: merged.revealsOnScreen || scanner.revealsOnScreen,
            targetsUntargetable:
                merged.targetsUntargetable || scanner.targetsUntargetable,
            targetsCloaked: merged.targetsCloaked || scanner.targetsCloaked,
            rawModVal: merged.rawModVal | scanner.rawModVal,
        };
    }
    return merged;
}

/**
 * Merges every owned cloaking device into a single capability. Returns a
 * non-cloak capability (canCloak: false) when the ship owns no cloak
 * outfits. Returns undefined only when outfit game data is not yet
 * cached (retry next step), matching the ProvideFromCache contract.
 */
export function deriveCloak(outfits: OutfitsState,
    gameData: SimulationGameDataInterface): CloakCapability | undefined {
    let merged: CloakCapability = {
        ...getDefaultCloakData(),
        canCloak: false,
    };

    for (const [id, state] of outfits) {
        if (state.count <= 0) {
            continue;
        }
        const outfit = gameData.data.Outfit.getCached(id);
        if (!outfit) {
            // Not loaded yet; retry next step.
            return undefined;
        }
        const cloak = outfit.cloak;
        if (!cloak.isCloak) {
            continue;
        }

        merged = {
            isCloak: true,
            canCloak: true,
            // Boolean qualities OR across devices.
            fasterFading: merged.fasterFading || cloak.fasterFading,
            hidesFromRadar: merged.hidesFromRadar || cloak.hidesFromRadar,
            dropsShieldsOnActivate:
                merged.dropsShieldsOnActivate || cloak.dropsShieldsOnActivate,
            deactivatesWhenHit:
                merged.deactivatesWhenHit || cloak.deactivatesWhenHit,
            areaCloak: merged.areaCloak || cloak.areaCloak,
            // Cheapest device wins: minimum nonzero drain.
            fuelPerSecond: minNonzero(merged.fuelPerSecond, cloak.fuelPerSecond),
            shieldPerSecond:
                minNonzero(merged.shieldPerSecond, cloak.shieldPerSecond),
            rawModVal: merged.rawModVal | cloak.rawModVal,
        };
    }

    return merged;
}

function minNonzero(a: number, b: number): number {
    if (a === 0) return b;
    if (b === 0) return a;
    return Math.min(a, b);
}

const CloakProvider = ProvideFromCache({
    name: 'CloakProvider',
    provided: CloakComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveCloak,
    // #237 pin (shared: Fuel, DisabledComponent): CloakPlugin registers
    // after HealthPlugin's recharges.
    after: [FuelRechargeSystem],
});

const CloakScannerProvider = ProvideFromCache({
    name: 'CloakScannerProvider',
    provided: CloakScannerComponent,
    update: [OutfitsStateComponent],
    args: [OutfitsStateComponent, SimulationGameDataResource] as const,
    factory: deriveCloakScanner,
    // #237 pin (shared: entity, SimulationGameData).
    after: [CloakProvider],
});

/** A minimal Stat-like value the pure transition helpers operate on. */
export interface StatLike {
    current: number;
    min: number;
}
/** @deprecated Use StatLike. Kept as an alias for existing call sites. */
export type ShieldLike = StatLike;

/**
 * Pure toggle transition. Given the current active flag and capability,
 * returns the next active flag and whether shields should be dropped to
 * their floor on this transition. Returns `next === current` (no-op) when
 * the ship cannot cloak. Extracted from CloakControlSystem so the state
 * machine is unit-testable without a world.
 */
export function applyCloakToggle(current: boolean, cloak: CloakCapability): {
    next: boolean;
    dropShields: boolean;
} {
    if (!cloak.canCloak) {
        return { next: current, dropShields: false };
    }
    const next = !current;
    return {
        next,
        dropShields: next && cloak.dropsShieldsOnActivate,
    };
}

/**
 * Pure per-tick drain transition. Mutates the given shield and/or fuel
 * stats (if present) and returns the next active flag. Per the ModVal
 * bitfield, a cloak can drain shields (bits 0x0100-0x0800) and/or fuel
 * (bits 0x0010-0x0080) per second. Running either resource to its floor
 * forces a decloak. Extracted from CloakDrainSystem for testing.
 *
 * A cloak whose ModVal requests fuel drain but whose ship carries no fuel
 * stat (fuel === undefined) is treated as unable to sustain the cloak and
 * decloaks immediately — draining a resource the ship lacks fails.
 */
export function applyCloakDrain(active: boolean, cloak: CloakCapability,
    delta_s: number, shield?: StatLike, fuel?: StatLike): boolean {
    if (!active) {
        return false;
    }

    if (cloak.shieldPerSecond > 0 && shield) {
        shield.current -= cloak.shieldPerSecond * delta_s;
        if (shield.current <= shield.min) {
            shield.current = shield.min;
            return false;
        }
    }

    if (cloak.fuelPerSecond > 0) {
        if (!fuel) {
            // The cloak needs fuel but the ship has no fuel stat.
            return false;
        }
        fuel.current -= cloak.fuelPerSecond * delta_s;
        if (fuel.current <= fuel.min) {
            fuel.current = fuel.min;
            return false;
        }
    }

    return active;
}

/**
 * Pure decloak-on-hit transition: returns the next active flag when the
 * ship takes damage. Only cloaks with the deactivates-when-hit bit drop.
 */
export function applyDecloakOnHit(active: boolean, cloak: CloakCapability): boolean {
    if (active && cloak.deactivatesWhenHit) {
        return false;
    }
    return active;
}

/**
 * Toggles the cloak on the 'cloak' control edge. Runs on every peer's
 * ship from its own input record, so the toggle is deterministic. The
 * CloakActiveComponent is created lazily on first toggle: a ship that
 * never cloaks never carries one, and drain/decloak systems only run
 * once it exists.
 */
export const CloakControlSystem = new System({
    name: 'CloakControlSystem',
    events: [ShipControlEvent],
    args: [ShipControlStateComponent, CloakComponent,
        Optional(CloakActiveComponent), Optional(ShieldComponent),
        Optional(DisabledComponent), GetEntity, UUID, Emit] as const,
    step(controlState, cloak, active, shield, disabled, entity, uuid, emit) {
        if (controlState.get('cloak') !== 'start') {
            return;
        }
        if (!cloak.canCloak) {
            return;
        }
        // A disabled ship's cloaking device is offline: disabling
        // force-decloaks (ShipDisableSystem), and the cloak cannot be
        // re-engaged until the ship is repaired.
        if (disabled) {
            return;
        }
        const current = active?.active ?? false;
        const { next, dropShields } = applyCloakToggle(current, cloak);
        if (active) {
            active.active = next;
        } else {
            entity.components.set(CloakActiveComponent, { active: next });
        }
        if (dropShields && shield) {
            // Activation immediately drops shields (bit 0x0004).
            shield.current = shield.min;
        }
        if (next !== current) {
            emit(PlayerSoundEvent, {
                id: next ? CLOAK_ON_SOUND : CLOAK_OFF_SOUND,
            }, [uuid]);
        }
    },
});

/**
 * Per-tick cloak drain and resource-exhaustion decloak. While cloaked,
 * shields and/or fuel drain per the ModVal bitfield; running either to
 * its floor drops the cloak. Fuel is the FuelComponent Stat (100 units =
 * one jump) added by the fuel system.
 */
export const CloakDrainSystem = new System({
    name: 'CloakDrainSystem',
    args: [CloakActiveComponent, CloakComponent, TimeResource,
        Optional(ShieldComponent), Optional(FuelComponent),
        UUID, Emit] as const,
    step(active, cloak, time, shield, fuel, uuid, emit) {
        const was = active.active;
        active.active = applyCloakDrain(
            active.active, cloak, time.delta_s, shield, fuel);
        if (was && !active.active) {
            // Resource exhaustion dropped the cloak.
            emit(PlayerSoundEvent, { id: CLOAK_OFF_SOUND }, [uuid]);
        }
    },
    // Determinism rule 4: reads time.delta_s to drain the cloak's
    // resource cost, so it must run after TimeSystem produces this
    // tick's delta. CloakScannerProvider is a #237 pin (shared:
    // CloakActive, Cloak, Fuel, Shield).
    after: [TimeSystem, CloakScannerProvider],
});

/**
 * Decloaks a ship the moment it takes damage, for cloaking devices whose
 * ModVal sets bit 0x0008 ("Cloak deactivates when ship takes damage").
 */
export const CloakDecloakOnHitSystem = new System({
    name: 'CloakDecloakOnHitSystem',
    events: [DamagedEvent],
    args: [CloakActiveComponent, CloakComponent, UUID, Emit] as const,
    step(active, cloak, uuid, emit) {
        const was = active.active;
        active.active = applyDecloakOnHit(active.active, cloak);
        if (was && !active.active) {
            emit(PlayerSoundEvent, { id: CLOAK_OFF_SOUND }, [uuid]);
        }
    },
});

export const CloakPlugin: Plugin = {
    name: 'CloakPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }

        world.addComponent(CloakComponent);
        world.addComponent(CloakScannerComponent);
        world.addComponent(CloakActiveComponent);

        // The active toggle is deterministic sim state: sync it as a
        // delta so a peer that missed the toggle input still converges,
        // and so late joiners see cloaked ships as cloaked.
        deltaMaker.addComponent(CloakActiveComponent, {
            componentType: CloakActiveType,
        });

        // Re-derive the capabilities wherever a full entity is built
        // (staged insertion, snapshot restore) so they are available on
        // the same tick, like weapons.
        registerEntityDeriver(world, {
            name: 'CloakDeriver',
            provided: CloakComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveCloak(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });
        registerEntityDeriver(world, {
            name: 'CloakScannerDeriver',
            provided: CloakScannerComponent,
            requires: [OutfitsStateComponent],
            derive: (entity, gameData) => deriveCloakScanner(
                entity.components.get(OutfitsStateComponent)!, gameData),
        });

        world.addSystem(CloakProvider);
        world.addSystem(CloakScannerProvider);
        world.addSystem(CloakControlSystem);
        world.addSystem(CloakDrainSystem);
        world.addSystem(CloakDecloakOnHitSystem);
    },
};
