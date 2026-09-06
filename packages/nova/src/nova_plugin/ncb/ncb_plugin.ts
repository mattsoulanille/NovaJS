import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { set } from 'nova_ecs/datatypes/set';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { RankLookup, suppressAggressionGovts } from './rank_logic.js';

/**
 * The player's Nova control bits (see ncb.ts): the set of PHYSICAL bit
 * numbers that are currently set — stock bits under their own numbers
 * (b0 - b9999) and plug-in-private bits renumbered by NovaParse (see
 * novadatainterface/control_bit_namespaces.ts). Bits are player-scoped
 * state; they live on the player's ship entity and follow the player when
 * they trade ships. Saves persist them as (namespace, bit) pairs so that
 * they survive a change of plug-in set (control_bit_namespaces.ts here).
 */
export const ControlBitsType = set(t.number);
export type ControlBits = t.TypeOf<typeof ControlBitsType>;

export const ControlBitsComponent = new Component<ControlBits>('ControlBitsComponent');

/**
 * The player's active ränks (see rank_logic.ts): the set of global ränk ids
 * (e.g. 'nova:147') currently active. Ranks are set and cleared by the same
 * control-bit set strings the bits are (the `Kxxx` / `Lxxx` operators), so
 * they are player-scoped state with exactly the same lifecycle: they live on
 * the player's ship entity, follow the player when they trade ships, and
 * reach peers only as committed component state.
 */
export const ActiveRanksType = set(t.string);
export type ActiveRanks = t.TypeOf<typeof ActiveRanksType>;

export const ActiveRanksComponent =
    new Component<ActiveRanks>('ActiveRanksComponent');

/**
 * The governments whose ships will not automatically attack this player,
 * baked from the active ränks' 0x0100 flag at the moment they are granted,
 * loaded or migrated (see rank_logic.ts's `suppressAggressionGovts`).
 *
 * It rides beside ActiveRanksComponent rather than inside it because 0x0100
 * is read where no data lookup belongs: NpcDecisionSystem scores every ship
 * in the system against every NPC's government, every tick. The other
 * privileges the simulation reads synchronously — landing clearance's
 * 0x0200 and applyHail's 0x0400 — are per-event, and are served instead by
 * makeSystem staging the whole ränk table at world genesis (see the note
 * there). The rest (price mods, salaries, Contribute, <PRK>) are read only
 * by player-local, asynchronous code that can simply await the resource.
 *
 * ADDITIVE: an entity written by an older build has no such component,
 * which reads as "no government suppressed" — the state every pilot
 * without a 0x0100 rank is in anyway. `commitActiveRanks` is the single
 * writer that keeps the two in step.
 */
export const AggressionSuppressGovtsType = set(t.string);
export type AggressionSuppressGovts =
    t.TypeOf<typeof AggressionSuppressGovtsType>;

export const AggressionSuppressGovtsComponent =
    new Component<AggressionSuppressGovts>('AggressionSuppressGovtsComponent');

/**
 * Writes the player's active ränks AND the suppression facts the
 * simulation reads off them. Every writer of ActiveRanksComponent goes
 * through here (or copies both components together), so the baked set can
 * never lag the ranks it was derived from.
 */
export function commitActiveRanks(entity: Entity, ranks: ActiveRanks,
    getRank: RankLookup): void {
    entity.components.set(ActiveRanksComponent, ranks);
    entity.components.set(AggressionSuppressGovtsComponent,
        suppressAggressionGovts(ranks, getRank));
}

export const NCBPlugin: Plugin = {
    name: 'NCBPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        world.addComponent(ControlBitsComponent);
        deltaMaker.addComponent(ControlBitsComponent, {
            componentType: ControlBitsType,
        });
        world.addComponent(ActiveRanksComponent);
        deltaMaker.addComponent(ActiveRanksComponent, {
            componentType: ActiveRanksType,
        });
        world.addComponent(AggressionSuppressGovtsComponent);
        deltaMaker.addComponent(AggressionSuppressGovtsComponent, {
            componentType: AggressionSuppressGovtsType,
        });
    }
};
