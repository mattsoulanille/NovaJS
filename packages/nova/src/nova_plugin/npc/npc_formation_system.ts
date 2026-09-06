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
import { FormationComponent, steerFormation } from './npc_formation.js';
import { EscortLandingComponent } from '../player/index.js';
import { ShipPhysicsComponent } from '../ship/index.js';

/**
 * Station-keeping for ships holding a formation slot (the geometry and the
 * follower controller are in npc_formation.ts).
 */

export const AllFormationsQuery = new Query([FormationComponent] as const);

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
        // Engaged escorts fight (or go plundering); FormationSystem only
        // holds station.
        if (npc && !escortCommand && (npc.mode === 'attack'
            || npc.mode === 'flee' || npc.mode === 'depart'
            || npc.mode === 'board')) {
            return;
        }
        // Player-commanded escorts: station-keep only while the
        // command is formation (or defend with no intruder engaged) —
        // the command behavior system steers everything else.
        if (escortCommand && !(escortCommand.command === 'formation'
            || (escortCommand.command === 'defend'
                && escortCommand.target === undefined))) {
            return;
        }
        const leader = entities.get(formation.leader)?.components
            .get(MovementStateComponent);
        if (!leader) {
            // Leader gone: escorts revert to their own AI (the
            // decision system re-plans since mode stays whatever it
            // was); bay fighters are handed back to bay_plugin, which
            // watches for this.
            entity.components.delete(FormationComponent);
            return;
        }
        // Rank + live count drive the per-count symmetric layouts:
        // the ship's persistent slot number is only an ORDER; its
        // station comes from its rank among the live same-leader
        // slots. Deterministic (sorting synced slot numbers) and
        // cheap (formations are tiny); an escort joining or leaving
        // re-flows the rest to the new count's layout.
        const siblingSlots = allFormations
            .filter(([other]) => other.leader === formation.leader)
            .map(([other]) => other.slot)
            .sort((a, b) => a - b);
        const rank = siblingSlots.indexOf(formation.slot);
        // Base acceleration (not the per-tick effective physics):
        // afterburners must not boost the RCS budget.
        steerFormation(movement, leader, formation,
            physics.acceleration, time.delta_s,
            rank < 0 ? formation.slot : rank, siblingSlots.length);
    },
    after: [TimeSystem, NpcDecisionSystem],
    before: [MovementSystem],
});
