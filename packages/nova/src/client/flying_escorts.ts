import { isLeft } from 'fp-ts/lib/Either.js';
import { JumpComponent } from '../nova_plugin/travel/index.js';
import { sweepableEscorts } from '../nova_plugin/escorts/index.js';
import { EscortLandingComponent } from '../nova_plugin/player/index.js';
import { clearPlunderRecord } from '../nova_plugin/ship/index.js';
import type { LiveSystem } from './client_state.js';
import type { ClientRuntime } from './runtime.js';

/**
 * How long a dock departure waits for the simulation to take the escorts
 * it removed (ms, wall clock: display-side bookkeeping). A removal is
 * published on the pump's next step, normally a frame or two away.
 */
const REMOVAL_WAIT_MS = 1500;
const REMOVAL_POLL_MS = 20;

/**
 * ============================================================================
 * The flock still in the air when the player leaves a DOCK for another system
 * ============================================================================
 *
 * A jump and an in-flight move sweep the player's escorts out of the system
 * in the simulation (EscortFollowJumpSystem, MissionSystemMoveSystem): the
 * player is in the world, and the sweep rides his own departure. A departure
 * from a DOCK has no such moment — the player left the world when he landed
 * — so escorts that had not touched down yet (still flying in to land, or
 * held off by a disabled-escort rule that has since cleared) used to stay in
 * the system he left: a landed `Mxxx` / `Nxxx` (client/transit.ts
 * followSpaceportSystemMove; the Auroran finale lands, reads its text and is
 * moved at once, so the flock is usually still on approach) and a hypergate
 * pick from the gate map (leaveGateMap) both stranded them.
 *
 * Now those departures sweep them as a jump would: the escorts the jump rule
 * takes through a GATE (`sweepableEscorts(..., 'gate')`: everything of the
 * player's but mission ships, which their mission respawns — "a gate
 * carries anything", and so does a mission's move, as MissionSystemMoveSystem
 * rules in flight) are copied off the display world's mirror
 * onto the jump roster, exactly as a carry event would have handed them over
 * (the synced components through the serializer, the landing order and the
 * jump sequence dropped, the plunder record cleared — sweepJumpingEscort's
 * stripping), and removed from the simulation by an ordinary owned
 * `removeEntity` input, so every peer sees them leave. The transit's jumpTo
 * then takes the jump roster with the landed one and inserts the lot beside
 * the player in the destination.
 *
 * The roster entry is written BEFORE the removal lands, so the frame pump's
 * lost-escort ledger (FleetLedger.noteRemoved) sees a carried escort, not a
 * lost one. The departure waits (briefly) for the removal to be published —
 * a record scheduled and then torn down with the bridge never leaves this
 * client (system_entry.ts teardownLiveSystem, issue #68).
 */
export async function carryFlyingEscorts(runtime: ClientRuntime,
    live: LiveSystem, playerUuid: string): Promise<number> {
    const { world, bridge, serializer } = live;
    const swept = sweepableEscorts(world.entities, playerUuid, 'gate');
    const removed: string[] = [];
    for (const uuid of swept) {
        const escort = world.entities.get(uuid);
        if (!escort) {
            continue;
        }
        const decoded = serializer.decode(serializer.encode(escort));
        if (isLeft(decoded)) {
            console.warn(`Escort ${uuid} could not be carried from the dock; `
                + 'it stays in the system left behind.');
            continue;
        }
        const entity = decoded.right;
        entity.components.delete(EscortLandingComponent);
        entity.components.delete(JumpComponent);
        clearPlunderRecord(entity);
        runtime.fleet.jumping.push({ player: playerUuid, uuid, entity });
        removed.push(uuid);
        try {
            await bridge.removeEntity(uuid);
        } catch (e) {
            console.warn(`Escort ${uuid}'s removal could not be sent:`, e);
        }
    }
    if (removed.length === 0) {
        return 0;
    }
    const deadline = performance.now() + REMOVAL_WAIT_MS;
    while (removed.some(uuid => world.entities.has(uuid))
        && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, REMOVAL_POLL_MS));
    }
    // An escort that touched down before its removal applied was handed
    // over by its own EscortLandedEvent, onto the landed roster: that row
    // stands, and the copy taken here goes (one escort, one row).
    const landed = new Set(runtime.fleet.landed.map(row => row.uuid));
    const jumping = runtime.fleet.jumping;
    for (let i = jumping.length - 1; i >= 0; i--) {
        if (removed.includes(jumping[i].uuid) && landed.has(jumping[i].uuid)) {
            jumping.splice(i, 1);
        }
    }
    return removed.length;
}
