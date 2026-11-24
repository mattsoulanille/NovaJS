import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The asteroid field's synced entity components. The systems that move,
 * break and scoop them live in combat/asteroid_plugin.ts (which
 * re-exports these); the components sit here, at the bottom of the
 * domain graph, because the NPC brain reads them too: a miner (npc/
 * npc_mining.ts) looks for rocks to shoot and debris to scoop, and npc
 * sits below combat.
 */

/**
 * A live asteroid. `id` is the röid's global id, `health` its remaining
 * strength. The tumble is purely cosmetic (TumbleAnimationComponent,
 * rendered by TumbleDrawSystem); the sim rotation stays fixed.
 * Queryable by NPC AI: a miner looks for asteroids to shoot.
 */
export const AsteroidType = t.type({
    id: t.string, // Not a UUID. A nova id.
    health: t.number,
});
export type AsteroidType = t.TypeOf<typeof AsteroidType>;
export const AsteroidComponent = new Component<AsteroidType>('Asteroid');

/**
 * A scoopable resource-box ejected by a destroyed asteroid. `commodity`
 * is the cargo key it grants (see CargoComponent), `expires` the sim
 * time (ms) at which it fades away. Queryable by NPC AI: a miner with a
 * scoop flies over debris.
 */
export const DebrisType = t.type({
    commodity: t.string,
    expires: t.number,
});
export type DebrisType = t.TypeOf<typeof DebrisType>;
export const DebrisComponent = new Component<DebrisType>('Debris');
