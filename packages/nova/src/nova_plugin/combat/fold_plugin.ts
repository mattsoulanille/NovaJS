import { GetEntity } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { System } from 'nova_ecs/system';
import { AnimationComponent } from '../core/index.js';
import { DisabledComponent } from '../ship/index.js';
import { FoldStateComponent, FoldStateType, foldRatePerSecond, moveToward } from '../ship/index.js';
import { ShipComponent } from '../ship/index.js';
import { WeaponsStateComponent } from '../ship/index.js';
import { ActiveSecondaryProvider, WeaponsSystem } from './weapon_plugin.js';

/**
 * Whether any of the ship's weapons are currently trying to fire.
 *
 * Deliberately covers EVERY weapon slot — primary, secondary, and point
 * defense alike: the Bible's 0x0080 reads "ship unfolds when firing
 * weapons, and folds back up when not firing", with no fire-group
 * qualifier, so any firing intent unfolds the ship (and the matching
 * gate in WeaponsSystem blocks ALL of them until unfolded). This
 * matters in stock data: the asteroid miner's only weapon, the Mining
 * Blaster, is a SECONDARY — a primary-only trigger would never unwrap
 * its claws. Intent sources all write WeaponsState.firing: the player's
 * held primary/secondary controls (ControlPlayerWeapons) and NPC fire
 * control (NpcFireControlSystem).
 */
export function wantsToFire(
    weapons: Iterable<readonly [string, { firing: boolean }]>): boolean {
    for (const [, state] of weapons) {
        if (state.firing) {
            return true;
        }
    }
    return false;
}

/**
 * Attaches FoldStateComponent to any ship whose shän animation unfolds to
 * fire (folding + 0x0080). Only these ships need the sim-side fold state
 * (it gates their weapon fire); every other ship — including plain
 * jump-folding ships like the Argosy — is left alone.
 */
export const FoldStateProvider = new System({
    name: 'FoldStateProvider',
    args: [ShipComponent, AnimationComponent, Optional(FoldStateComponent),
        GetEntity] as const,
    step(_ship, animation, foldState, entity) {
        const mode = animation.animationMode;
        const needsFold = mode?.purpose === 'folding' && mode.unfoldWhenFiring;
        if (needsFold && foldState === undefined) {
            entity.components.set(FoldStateComponent, { progress: 0 });
        }
    },
    // #237 pin (shared: entity): FoldPlugin registers after WeaponPlugin.
    after: [ActiveSecondaryProvider],
});

/**
 * Advances a folding-miner's fold progress each tick: toward fully
 * unfolded (1) while the ship intends to fire, toward folded (0) when
 * idle or disabled. Deterministic — time via TimeResource.delta_s, no
 * wall clock, no randomness. Runs before WeaponsSystem so the firing gate
 * (below) sees this tick's progress.
 */
export const FoldAdvanceSystem = new System({
    name: 'FoldAdvanceSystem',
    args: [FoldStateComponent, WeaponsStateComponent, AnimationComponent,
        TimeResource, Optional(DisabledComponent)] as const,
    step(fold, weapons, animation, time, disabled) {
        const mode = animation.animationMode;
        if (!mode || mode.purpose !== 'folding' || !mode.unfoldWhenFiring) {
            return;
        }
        // A disabled ship cannot fire, so its claws wrap back up.
        const target = !disabled && wantsToFire(weapons) ? 1 : 0;
        fold.progress = moveToward(fold.progress, target,
            foldRatePerSecond(mode) * time.delta_s);
    },
    // FoldStateProvider is a #237 pin (shared: FoldState, WeaponsState,
    // Disabled, Animation).
    after: [TimeSystem, FoldStateProvider],
    before: [WeaponsSystem],
});

export const FoldPlugin: Plugin = {
    name: 'FoldPlugin',
    build(world) {
        // Serializer registration makes fold progress real simulation state:
        // hashed for desync detection, cloned into rollback snapshots, and
        // synced to the display world (which maps it to the fold sprite set).
        world.resources.get(SerializerResource)
            ?.addComponent(FoldStateComponent, FoldStateType);
        world.addSystem(FoldStateProvider);
        world.addSystem(FoldAdvanceSystem);
    },
};
