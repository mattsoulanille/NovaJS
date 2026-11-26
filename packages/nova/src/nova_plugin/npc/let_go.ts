import { Entity } from 'nova_ecs/entity';
import { ShipDataComponent, ShipPhysicsComponent, TargetComponent } from '../ship/index.js';
import { AggressionComponent } from './aggression.js';
import { isInFlock } from './allegiance.js';
import { NpcState } from './npc_component.js';
import { heldInSystem } from './system_hold.js';

/**
 * LETTING A SHIP GO: what an NPC does once it has been paid off by one
 * — a Beg For Mercy bribe it accepted (encounters/hail_plugin.ts's
 * applyHail), or a disabled player it has just plundered
 * (npc_plunder_board.ts). The original does the same thing at the end of
 * both, so both go through here:
 *
 *  - reference "A paid ship bribe (A8), wave 37": non-hostile at once (no
 *    Status line, yellow brackets); a MOBILE warship flies off and jumps,
 *    an anchored one stays bought for the visit;
 *  - reference "Pirates and a disabled player (A9), wave 38": after "<N>
 *    tons of cargo and <M> credits stolen!" the pirate's brackets are
 *    yellow, it flies off and leaves the system, and the disabled player
 *    is not shot again.
 *
 * Only THIS ship lets go, and only of `letGoUuid` (and that pilot's
 * flock's quarrel with it): the system's other warships are untouched.
 */

/**
 * Whether a ship that has let somebody go LEAVES the system: it moves (its
 * effective speed and acceleration, outfits included, are above 0; GUESS:
 * either at 0 anchors it) and nothing holds it here (system_hold.ts: a
 * refuel offer on the table, a rescue target waiting). It leaves by the
 * ordinary NPC jump-out ('depart': straight out past the no-jump zone,
 * then the jump), so when it is gone depends on where it is and how fast
 * it flies (the A8 bribe's measured 13-23 s is the stock kit warship's).
 */
export function shipLeavesWhenLettingGo(ship: Entity): boolean {
    const physics = ship.components.get(ShipPhysicsComponent)
        ?? ship.components.get(ShipDataComponent)?.physics;
    return physics !== undefined && physics.speed > 0
        && physics.acceleration > 0 && !heldInSystem(ship);
}

/**
 * Makes `ship` (whose NPC brain is `npc`) let `letGoUuid` go: never again
 * a hostile to it for the rest of this ship's visit (`pacifiedFrom`;
 * NpcDecisionSystem honours it, and only a provocation by that pilot's
 * side ends it — npc_targeting.ts's provoke), its quarrel with that pilot
 * and their flock forgotten, any attack on them dropped, and — when it
 * can leave (shipLeavesWhenLettingGo) — off at once by the ordinary
 * jump-out, whatever it was about.
 *
 * Both sides' AggressionComponent entries naming the other are dropped
 * too (see hail_plugin's note "WHAT ELSE A PAID BRIBE HAS TO ERASE"): the
 * pilot's memory of the shots this ship landed is tier 3b of the one
 * hostility rule, and would otherwise keep it bracketed red — and its
 * point defense firing — after it has let them go.
 *
 * Deterministic: keyed writes and deletes on synced components; the flock
 * walk follows synced leader links. No clock, no PRNG.
 */
export function letGo(ship: Entity, shipUuid: string, npc: NpcState,
    letGoUuid: string, getEntity: (uuid: string) => Entity | undefined) {
    npc.pacifiedFrom = letGoUuid;
    // The pilot's escorts too: a ship one of them provoked records that
    // escort as its aggressor (npc_targeting.ts's responsibleShip).
    if (npc.aggressor === letGoUuid || (npc.aggressor !== undefined
        && isInFlock(npc.aggressor, letGoUuid, getEntity))) {
        npc.aggressor = undefined;
    }
    const target = ship.components.get(TargetComponent);
    if (npc.mode === 'attack' && target?.target === letGoUuid) {
        npc.mode = undefined;
        target.target = undefined;
    }
    if (shipLeavesWhenLettingGo(ship)) {
        // Off at once, by the ordinary jump-out (the out-of-ammo exit's
        // shape: whatever it was about is dropped).
        npc.mode = 'depart';
        if (target) {
            target.target = undefined;
        }
        npc.boardTarget = undefined;
        delete npc.boardUntil;
        delete npc.mineTarget;
        delete npc.scanTarget;
        delete npc.scanSatOn;
    }
    getEntity(letGoUuid)?.components.get(AggressionComponent)
        ?.delete(shipUuid);
    ship.components.get(AggressionComponent)?.delete(letGoUuid);
}
