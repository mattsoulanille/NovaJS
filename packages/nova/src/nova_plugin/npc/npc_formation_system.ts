import { Entities, GetEntity, UUID } from 'nova_ecs/arg_types';
import { Optional } from 'nova_ecs/optional';
import { MovementStateComponent, MovementSystem } from 'nova_ecs/plugins/movement_plugin';
import { TimeResource, TimeSystem } from 'nova_ecs/plugins/time_plugin';
import { Query } from 'nova_ecs/query';
import { System } from 'nova_ecs/system';
import { DisabledComponent } from '../ship/index.js';
import { EscortCommandComponent } from '../player/index.js';
import { JumpComponent } from '../travel/index.js';
import { NpcComponent } from './npc_component.js';
import { NpcDecisionSystem } from './npc_decision.js';
import {
    FormationComponent, formationSpacing, offFormationBusiness, steerFormation,
} from './npc_formation.js';
import { EscortLandingComponent } from '../player/index.js';
import { ShipDataComponent, ShipPhysicsComponent } from '../ship/index.js';

/**
 * Station-keeping for ships holding a formation slot (the geometry and the
 * follower controller are in npc_formation.ts).
 */

/** Every formation member, with its hull's data for the group spacing
 * (ShipData.spriteFrameWidth). */
export const AllFormationsQuery = new Query(
    [FormationComponent, Optional(ShipDataComponent)] as const);

export const FormationSystem = new System({
    name: 'FormationSystem',
    args: [FormationComponent, MovementStateComponent, ShipPhysicsComponent,
        Optional(NpcComponent), Optional(EscortCommandComponent),
        Optional(EscortLandingComponent), Optional(JumpComponent),
        Optional(DisabledComponent), AllFormationsQuery, TimeResource,
        Entities, GetEntity, UUID] as const,
    step(formation, movement, physics, npc, escortCommand, landing, jump,
        disabled, allFormations, time, entities, entity) {
        if (disabled) {
            // A hulk drifts. DisabledMovementSystem runs after this one and
            // erases steering intent, but the RCS regime writes
            // movement.velocity DIRECTLY — and all that erasure does to a
            // direct velocity write is bleed it off at
            // DISABLED_DECELERATION, which is exactly the station-keeping
            // nudge again next tick. So a disabled escort held its slot,
            // matching its leader's course while dead in space. Ordering
            // cannot fix that (same reason the jump bail below exists); the
            // gate has to be here, before anything is written.
            return;
        }
        if (landing) {
            // Following the player down to a planet: EscortLandingSystem
            // owns this ship's steering until it lands.
            return;
        }
        if (jump) {
            // Committed to a hyperspace jump — an escort warping out with
            // its player, or a formation leader of its own doing so.
            // JumpSequenceSystem owns the steering until the ship leaves.
            // Station-keeping must not run alongside it: the RCS regime
            // nudges velocity DIRECTLY, so ordering alone would not stop a
            // ship that is supposed to be holding still for its spin-up
            // from creeping toward its slot. Same bail NpcSteeringSystem
            // takes, for the same reason.
            return;
        }
        // Engaged escorts fight (or go plundering, or scanning);
        // FormationSystem only holds station. The same list as
        // NpcSteeringSystem's (offFormationBusiness).
        if (npc && !escortCommand && offFormationBusiness(npc.mode)) {
            return;
        }
        // Player-commanded escorts: station-keep only while the
        // command is formation (or defend with no intruder engaged, or
        // attack given with no target) — the command behavior system
        // steers everything else.
        if (escortCommand && !(escortCommand.command === 'formation'
            || ((escortCommand.command === 'defend'
                || escortCommand.command === 'attack')
                && escortCommand.target === undefined))) {
            return;
        }
        const leaderEntity = entities.get(formation.leader);
        const leader = leaderEntity?.components.get(MovementStateComponent);
        if (!leader) {
            // Leader gone: escorts revert to their own AI (the
            // decision system re-plans since mode stays whatever it
            // was); bay fighters are handed back to bay_plugin, which
            // watches for this.
            entity.components.delete(FormationComponent);
            return;
        }
        // The ship's persistent slot number is only an ORDER; its
        // station comes from its rank among the live same-leader
        // slots. Deterministic (sorting synced slot numbers) and
        // cheap (formations are tiny); an escort leaving moves the
        // ones behind it up the V.
        const siblings = allFormations
            .filter(([other]) => other.leader === formation.leader);
        const siblingSlots = siblings.map(([other]) => other.slot)
            .sort((a, b) => a - b);
        const rank = siblingSlots.indexOf(formation.slot);
        // The step of the V scales with the LARGEST sprite frame among
        // the leader and every ship in its formation (reference F1b), so
        // it is recomputed from the live group: an escort joining or
        // leaving re-spaces everyone. Max over synced hull ids, so order
        // independent and the same on every peer.
        let frameWidth = leaderEntity?.components.get(ShipDataComponent)
            ?.spriteFrameWidth ?? 0;
        for (const [, shipData] of siblings) {
            frameWidth = Math.max(frameWidth, shipData?.spriteFrameWidth ?? 0);
        }
        // Base acceleration and turn rate (not the per-tick effective
        // physics): afterburners must not boost the RCS budget.
        // The follower count goes along for count-dependent layouts
        // (FORMATION_COUNT_LAYOUTS). Every ship holding a formation on
        // this leader counts, bay fighters and escorts alike: they share
        // one set of ranks (split them here if the original doesn't).
        steerFormation(movement, leader, formation,
            physics.acceleration, time.delta_s,
            rank < 0 ? formation.slot : rank, physics.turnRate,
            formationSpacing(frameWidth), siblingSlots.length);
    },
    after: [TimeSystem, NpcDecisionSystem],
    before: [MovementSystem],
});
