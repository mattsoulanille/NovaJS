import * as t from 'io-ts';
import { isLeft } from 'fp-ts/lib/Either.js';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { SerializerResource } from 'nova_ecs/plugins/serializer_plugin';
import { World } from 'nova_ecs/world';

/**
 * ============================================================================
 * Room rules: simulation departures every peer of a room shares
 * ============================================================================
 *
 * A departure from the original that changes how the SIMULATION runs
 * cannot be a per-player toggle (two peers with different toggles would
 * desync; docs/novajs_enhancements.md). It is a room rule instead: the
 * server picks it (settings/server.json `roomRules`, or an environment
 * override; server.ts) and the relay logs it as a server-authored
 * `roomRules` input in the room's first record, beside the room seed
 * (rollback_relay.ts). Every world of the room (the archive, the first
 * entrant, a later joiner through the log or through a baseline) applies
 * the same rules at the same tick, so every peer runs the same rules.
 *
 * The rules live on the world as synced state: a RoomRulesComponent on
 * the entity ROOM_RULES_UUID, which the record creates. A baseline
 * carries it like any other entity, and a rollback restoring a snapshot
 * from before the record simply replays it. A world that never saw the
 * record (local play, specs, benchmarks) runs DEFAULT_ROOM_RULES.
 *
 * The rules today:
 *  - `limits`: the engine's population limits (projectiles, beams, ships
 *    in a system; combat/engine_limits.ts). 'original' is the original's
 *    fixed table (Max Shots On Screen 128, Max Beams On Screen 64, Max
 *    Ships In System 64, measured on the reference Mac); 'novajs' is
 *    Matthew's higher limits, the default ("firing a weapon and having
 *    the projectiles never appear" was one of the things he wanted to
 *    change in the rewrite).
 */

export const LimitsRuleType = t.union([
    t.literal('original'),
    t.literal('novajs'),
]);
export type LimitsRule = t.TypeOf<typeof LimitsRuleType>;

export const RoomRulesType = t.strict({
    limits: LimitsRuleType,
});
export type RoomRules = t.TypeOf<typeof RoomRulesType>;

/** What a room runs when nothing says otherwise. */
export const DEFAULT_ROOM_RULES: Readonly<RoomRules> = Object.freeze({
    limits: 'novajs',
});

export const RoomRulesComponent = new Component<RoomRules>('RoomRules');

/** The deterministic uuid of the entity that holds the room's rules. */
export const ROOM_RULES_UUID = 'room rules';

/** The rules `entities` runs: its record's, else the defaults. */
export function roomRulesOf(
    entities: { get(uuid: string): Entity | undefined }): Readonly<RoomRules> {
    return entities.get(ROOM_RULES_UUID)?.components.get(RoomRulesComponent)
        ?? DEFAULT_ROOM_RULES;
}

/**
 * Applies a room's `roomRules` record: sets (or replaces) the rules
 * entity. Synchronous and a pure function of the record, so it is
 * idempotent under rollback.
 */
export function applyRoomRules(world: World, rules: RoomRules) {
    const copy: RoomRules = { limits: rules.limits };
    const existing = world.entities.get(ROOM_RULES_UUID);
    if (existing) {
        existing.components.set(RoomRulesComponent, copy);
        return;
    }
    world.entities.set(ROOM_RULES_UUID, new Entity(ROOM_RULES_UUID)
        .setName(ROOM_RULES_UUID)
        .addComponent(RoomRulesComponent, copy));
}

/**
 * Parses the server's room rules (server.json `roomRules`, merged over
 * the defaults). A missing or malformed value falls back to the default
 * for that rule; `overrideLimits` (NOVA_ROOM_LIMITS) wins when set.
 * Throws on an override that names no rule, so a typo in a deployment's
 * environment fails loudly instead of silently running the default.
 */
export function parseRoomRules(settings: unknown,
    overrideLimits?: string): RoomRules {
    const rules: RoomRules = { ...DEFAULT_ROOM_RULES };
    const partial = t.partial({ limits: LimitsRuleType }).decode(settings);
    if (!isLeft(partial) && partial.right.limits !== undefined) {
        rules.limits = partial.right.limits;
    }
    if (overrideLimits !== undefined && overrideLimits !== '') {
        const decoded = LimitsRuleType.decode(overrideLimits);
        if (isLeft(decoded)) {
            throw new Error(`NOVA_ROOM_LIMITS must be 'original' or `
                + `'novajs', not '${overrideLimits}'`);
        }
        rules.limits = decoded.right;
    }
    return rules;
}

/** Registers the rules' wire codec. */
export const RoomRulesPlugin: Plugin = {
    name: 'RoomRulesPlugin',
    build(world) {
        world.resources.get(SerializerResource)?.addComponent(
            RoomRulesComponent, RoomRulesType);
    },
};
