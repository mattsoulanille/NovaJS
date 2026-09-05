import * as t from 'io-ts';
import { GovtData } from 'novadatainterface/govt_data';
import { Entities, GetEntity, RunQuery, UUID } from 'nova_ecs/arg_types';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';
import { Optional } from 'nova_ecs/optional';
import { Plugin } from 'nova_ecs/plugin';
import { DeltaResource } from 'nova_ecs/plugins/delta_plugin';
import { Query } from 'nova_ecs/query';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { armorFullyRestored, DamagedEvent, DeathEvent, ZeroArmorEvent } from './death_plugin.js';
import { DisabledComponent } from './disabled_component.js';
import { FiringGroupComponent } from './firing_group.js';
import { SourceComponent } from './weapon_components.js';
import { SimulationGameDataResource } from './game_data_resource.js';
import { GovtComponent } from './govt_component.js';
import { ArmorComponent } from './health_plugin.js';
import { applyCrime } from './reputation.js';
import { ShipDataComponent } from './ship_plugin.js';

/**
 * ============================================================================
 * Reputation: per-player legal records and combat rating (sim side)
 * ============================================================================
 *
 * The pure math lives in reputation.ts; this module owns the
 * components and the simulation systems that feed them.
 *
 * STATE MODEL: LegalRecordsComponent and CombatRatingComponent live on
 * PLAYER ship entities only (ensurePlayerStateComponents /
 * browser.ts), like Credits and Missions — but unlike those, they are
 * mutated INSIDE the simulation (kill/disable credit), so they are
 * real synced sim state: every peer applies the same crime to the
 * same player's records on the same tick, and NPC hostility derived
 * from them stays identical everywhere. Two players can hold
 * different records with the same govt; each is judged separately.
 *
 * ATTRIBUTION: DamagedEvent's `damager` is the weapon entity
 * (projectile/beam/blast). Its FiringGroupComponent carries the
 * owner-chain root — the fleet leader for escorts, the carrier root
 * for bay fighters — so an escort's kills credit its leader, which is
 * the Bible-adjacent behavior (the Bible is silent on escort kill
 * attribution; NovaJS credits the group root). The last such root is
 * remembered on the victim (DamageAttributionComponent) and consulted
 * when the victim's armor reaches zero (kill) or it becomes disabled.
 *
 * The kill fires on ZeroArmorEvent — the moment the ship starts
 * exploding — not on the delayed DeathEvent, so the record flip is
 * immediate. `killCredited` guards the repeat ZeroArmorEvents emitted
 * while an exploding hulk keeps taking hits; DeathEvent clears the
 * attribution so a respawning player ship starts a fresh life.
 */

export const LegalRecordsType = map(t.string, t.number);
export type LegalRecordsState = t.TypeOf<typeof LegalRecordsType>;
export const LegalRecordsComponent =
    new Component<LegalRecordsState>('LegalRecords');

export const CombatRatingType = t.type({
    /** Appendix I kill points: summed strengths of destroyed ships. */
    kills: t.number,
});
export type CombatRatingState = t.TypeOf<typeof CombatRatingType>;
export const CombatRatingComponent =
    new Component<CombatRatingState>('CombatRating');

/**
 * Who is responsible for a ship's latest damage (the damager's firing
 * group root), plus the once-only guards for kill/disable credit.
 */
export const DamageAttributionType = t.partial({
    /** Owner-chain root uuid of the last damager. */
    root: t.string,
    killCredited: t.boolean,
    disableCredited: t.boolean,
    /**
     * Whether the ship was ALREADY disabled when `root` was last
     * written. A hit on a hulk (a spawn-disabled derelict, a mïsn
     * rescue target, a ship disabled by an unattributed cause) must
     * not credit the shooter with disabling it. Additive: records
     * without it read as "not disabled at the hit".
     */
    disabledAtHit: t.boolean,
});
export type DamageAttribution = t.TypeOf<typeof DamageAttributionType>;
export const DamageAttributionComponent =
    new Component<DamageAttribution>('DamageAttribution');

/**
 * Every gövt in the scenario, keyed by global id in SORTED id order,
 * set by makeSystem before the world steps. Static data (never
 * mutated), staged up front so record propagation over allies/enemies
 * is synchronous and identical on every peer.
 */
export const GovtsResource =
    new Resource<Map<string, GovtData>>('GovtsResource');

const DamagerQuery = new Query([Optional(FiringGroupComponent),
    Optional(SourceComponent)] as const);

/**
 * Remembers who last damaged a ship: the weapon's firing-group root
 * (which is the fleet leader / carrier root, so escorts' and bay
 * fighters' shots attribute to their leader), else the firing ship.
 */
const DamageAttributionSystem = new System({
    name: 'DamageAttributionSystem',
    events: [DamagedEvent],
    args: [DamagedEvent, ShipDataComponent, GetEntity, UUID,
        RunQuery, Optional(DisabledComponent)] as const,
    step({ damager }, _shipData, { components }, uuid, runQuery, disabled) {
        const result = runQuery(DamagerQuery, damager)[0];
        if (!result) {
            return;
        }
        const [group, source] = result;
        const root = group?.group ?? source;
        if (!root || root === uuid) {
            return;
        }
        // Whether the victim was a hulk when this hit landed. The hit
        // that disables a ship lands while it is still enabled:
        // ShipDisableSystem attaches DisabledComponent from the armor
        // it finds on its next step, after this event is handled.
        const disabledAtHit = disabled !== undefined;
        const attribution = components.get(DamageAttributionComponent);
        if (attribution) {
            attribution.root = root;
            attribution.disabledAtHit = disabledAtHit;
        } else {
            components.set(DamageAttributionComponent,
                { root, disabledAtHit });
        }
    },
});

/**
 * Credits a kill when a ship's armor reaches zero: the responsible
 * root's combat rating grows by the victim's shïp Strength (Appendix
 * I), and — when the victim has a government — the root's legal
 * records take that govt's kill penalty with ally/enemy propagation.
 * Roots without the components (NPCs) are unaffected.
 */
const KillCreditSystem = new System({
    name: 'KillCreditSystem',
    events: [ZeroArmorEvent],
    args: [ZeroArmorEvent, ShipDataComponent, Optional(GovtComponent),
        Optional(DamageAttributionComponent), GetEntity, Entities,
        Optional(GovtsResource), SimulationGameDataResource,
        Optional(ArmorComponent)] as const,
    step(_time, shipData, govt, attribution, { components }, entities,
        govts, gameData, armor) {
        if (attribution?.killCredited) {
            return;
        }
        // A ZeroArmorEvent that arrives after its subject already
        // respawned (see armorFullyRestored) must not mark the new life
        // as already-killed: whoever destroys it next would then get no
        // combat rating and no legal penalty for the kill.
        if (armorFullyRestored(armor)) {
            return;
        }
        if (attribution) {
            attribution.killCredited = true;
        } else {
            components.set(DamageAttributionComponent,
                { killCredited: true });
        }
        const root = attribution?.root
            ? entities.get(attribution.root) : undefined;
        if (!root) {
            return;
        }
        const rating = root.components.get(CombatRatingComponent);
        if (rating) {
            rating.kills += Math.max(0, shipData.strength);
        }
        const records = root.components.get(LegalRecordsComponent);
        if (records && govt) {
            const govtData = gameData.data.Govt.getCached(govt.id);
            if (govtData) {
                applyCrime(records, govtData, 'kill', govts ?? []);
            }
        }
    },
});

/**
 * Applies the disable penalty once per disablement: when a govt ship
 * carries DisabledComponent and its last damager root has legal
 * records, that player takes the DisabPenalty (with propagation).
 * The guard resets when the ship is repaired, so disabling it again
 * counts again. Dead ships (armor 0 — a hulk mid-explosion is
 * "below the disable threshold" too) charge the KILL penalty only.
 *
 * Only a hit that landed while the ship was still ENABLED can have
 * disabled it (`disabledAtHit`, recorded with the root above). A ship
 * that was already a hulk when its last damager hit it — a
 * spawn-disabled derelict (gövt Flags 0x0800), a mïsn ShipGoal-5
 * rescue target, or a ship disabled by an unattributed cause — charges
 * that damager nothing: they did not disable it. Stock derelict govts
 * carry DisabPenalty 0 so this only ever mattered for a rescue hulk of
 * a penalising government, but the logic was wrong either way.
 */
const DisableCreditSystem = new System({
    name: 'DisableCreditSystem',
    args: [DamageAttributionComponent, Optional(DisabledComponent),
        Optional(ArmorComponent), Optional(GovtComponent), Entities,
        Optional(GovtsResource), SimulationGameDataResource] as const,
    step(attribution, disabled, armor, govt, entities, govts, gameData) {
        if (!disabled) {
            if (attribution.disableCredited) {
                attribution.disableCredited = false;
            }
            return;
        }
        if (attribution.disableCredited || attribution.killCredited
            || !armor || armor.current <= 0) {
            return;
        }
        if (attribution.disabledAtHit) {
            // The last damager shot a hulk; nobody gets this disable.
            // Consumed like a credit so the next hit on the hulk is
            // judged afresh (it re-records disabledAtHit) and repair
            // resets the guard as usual.
            attribution.disableCredited = true;
            return;
        }
        attribution.disableCredited = true;
        const root = attribution.root
            ? entities.get(attribution.root) : undefined;
        if (!root || !govt) {
            return;
        }
        const records = root.components.get(LegalRecordsComponent);
        if (!records) {
            return;
        }
        const govtData = gameData.data.Govt.getCached(govt.id);
        if (govtData) {
            applyCrime(records, govtData, 'disable', govts ?? []);
        }
    },
});

/** A ship that finished dying starts its next life unattributed. */
const AttributionResetSystem = new System({
    name: 'AttributionResetSystem',
    events: [DeathEvent],
    args: [DeathEvent, GetEntity] as const,
    step(_time, { components }) {
        components.delete(DamageAttributionComponent);
    },
});

export const ReputationPlugin: Plugin = {
    name: 'ReputationPlugin',
    build(world) {
        const deltaMaker = world.resources.get(DeltaResource);
        if (!deltaMaker) {
            throw new Error('Expected delta maker resource to exist');
        }
        // Delta-registered like the other per-player state (Credits,
        // Missions, FiringGroup): hashed, snapshotted, and carried on
        // the wire.
        deltaMaker.addComponent(LegalRecordsComponent, {
            componentType: LegalRecordsType,
        });
        deltaMaker.addComponent(CombatRatingComponent, {
            componentType: CombatRatingType,
        });
        deltaMaker.addComponent(DamageAttributionComponent, {
            componentType: DamageAttributionType,
        });
        world.addSystem(DamageAttributionSystem);
        world.addSystem(KillCreditSystem);
        world.addSystem(DisableCreditSystem);
        world.addSystem(AttributionResetSystem);
    },
    remove(world) {
        world.removeSystem(DamageAttributionSystem);
        world.removeSystem(KillCreditSystem);
        world.removeSystem(DisableCreditSystem);
        world.removeSystem(AttributionResetSystem);
    },
};
