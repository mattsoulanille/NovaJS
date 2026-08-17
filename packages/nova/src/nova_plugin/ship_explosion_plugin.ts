import { Entities, UUID } from 'nova_ecs/arg_types';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Vector } from 'nova_ecs/datatypes/vector';
import { Entity } from 'nova_ecs/entity';
import { Plugin } from 'nova_ecs/plugin';
import { MovementStateComponent } from 'nova_ecs/plugins/movement_plugin';
import { System } from 'nova_ecs/system';
import SAT from 'sat';
import { BlastDamageComponent, BlastIgnoreComponent } from './blast_data.js';
import { CollisionHitterComponent } from './collision_interaction.js';
import { CompositeHull, HurtboxHullComponent } from './collisions_plugin.js';
import { DeathEvent, PlayerDeathSystem } from './death_plugin.js';
import { IdFactoryResource } from './id_factory.js';
import { DeathAISystem } from './npc_plugin.js';
import {
    shipExplosionDamage, ShipExplosionComponent, shipExplosionRadius,
} from './ship_explosion.js';
import { ShipDataComponent } from './ship_plugin.js';

/**
 * ============================================================================
 * A ship's final explosion damages everything around it
 * ============================================================================
 *
 * The Bible's rule and the tunables are in ship_explosion.ts; this is the
 * simulation half that applies it. On the tick a ship's death sequence
 * finishes — the DeathEvent, which is also the tick the display shows the
 * Explode2 fireball — the dying hull drops a BLAST at its own position,
 * reusing the machinery a wëap BlastRadius already uses
 * (blast_plugin.ts): the blast lives for exactly one collision pass,
 * CollisionSystem discovers everything its circle overlaps and emits the
 * collisions in canonical uuid-sorted order, BlastCollisionSystem turns
 * each into a DamagedEvent, and KnockbackSystem shoves each victim
 * radially outward from the blast's center. Nothing here iterates
 * entities itself, so there is no new ordering to get wrong.
 *
 * WHAT IT HITS. `hitTypes` carries BOTH 'normal' (every ship, and the
 * asteroids that share the tag, which a big enough blast shatters) and
 * 'pointDefense' (guided missiles in flight, plus the ship classes that
 * set shïp Flags2 0x0008): a hull coming apart takes the ordnance in the
 * neighbourhood with it. Missiles die outright — the non-lethal clamp is
 * a ship rule (DamageSystem gates it on ShipDataComponent) — which is
 * the reading Matthew left open ("probably yes for PD-vulnerable
 * things"). Damage does not fall off with distance, matching the wëap
 * BlastRadius machinery it reuses: inside the circle is inside.
 *
 * NO FRIENDLY FIRE EXEMPTION. The blast deliberately carries no
 * FiringGroupComponent, so firing-group immunity (which is a property of
 * *aimed fire* passing through fleetmates, see firing_group.ts) does not
 * apply: an exploding carrier scorches its own escorts. The Bible says
 * nothing either way; a shock wave that politely avoids one fleet is the
 * less defensible reading, and Matthew's ruling was "not exempt unless
 * the Bible says so".
 *
 * NOT AN ATTACK. Carrying no firing group ALSO means the blast carries no
 * damager identity at all (no OwnerComponent, no SourceComponent), which
 * is what keeps an explosion from being treated as an act of war:
 * DamageAttributionSystem (kill credit / legal records),
 * AggressionDamageSystem (player hostility) and NpcAggressionSystem
 * (NPC grudges) all resolve responsibility by querying the damager
 * entity for exactly those components and bail out when none resolve.
 * So the damage lands with no kill credit, no combat rating, no legal
 * penalty and nobody turning hostile.
 *
 * The exploding ship itself is in the blast's ignore set: it is already
 * dead, and a player's is about to respawn.
 *
 * DETERMINISM. Position and mass come from synced state and static shïp
 * data, the id from the deterministic IdFactory, and no random draw is
 * made — every peer spawns an identical blast on the same tick.
 */

const ShipExplosionBlastSystem = new System({
    name: 'ShipExplosionBlastSystem',
    events: [DeathEvent],
    // Before the two systems that end a death: DeathAISystem deletes the
    // NPC entity, and PlayerDeathSystem teleports a player's ship to the
    // origin — either way the position the blast belongs at is gone.
    // (ShipFinalExplosionSystem, the display's Explode2 fireball, orders
    // itself against the same pair for the same reason.)
    before: [PlayerDeathSystem, DeathAISystem],
    args: [ShipDataComponent, MovementStateComponent, Entities,
        IdFactoryResource, UUID] as const,
    step(shipData, movement, entities, ids, uuid) {
        const mass = shipData.physics.mass;
        const radius = shipExplosionRadius(mass);
        const blast = new Entity(`${shipData.name} Explosion`)
            .addComponent(BlastDamageComponent, shipExplosionDamage(mass))
            .addComponent(ShipExplosionComponent, { mass })
            // The wreck does not damage itself.
            .addComponent(BlastIgnoreComponent, new Set([uuid]))
            .addComponent(HurtboxHullComponent, new CompositeHull(
                [new SAT.Circle(new SAT.Vector(0, 0), radius)]))
            .addComponent(CollisionHitterComponent, {
                hitTypes: new Set(['normal', 'pointDefense']),
            })
            .addComponent(MovementStateComponent, {
                position: movement.position,
                accelerating: 0,
                rotation: new Angle(0),
                turning: 0,
                turnBack: false,
                velocity: new Vector(0, 0),
            });
        entities.set(ids.next('shipExplosion'), blast);
    },
});

export const ShipExplosionPlugin: Plugin = {
    name: 'ShipExplosionPlugin',
    build(world) {
        world.addSystem(ShipExplosionBlastSystem);
    },
    remove(world) {
        world.removeSystem(ShipExplosionBlastSystem);
    },
};
