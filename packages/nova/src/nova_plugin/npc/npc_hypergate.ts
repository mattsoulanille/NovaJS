import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';
import { GovtData } from 'novadatainterface/govt_data';
import { PlanetData } from 'novadatainterface/planet_data';
import { landable } from '../core/index.js';

/**
 * ============================================================================
 * NPC hypergate traffic (gövt Flags2 0x0020 / 0x0040)
 * ============================================================================
 *
 * EVN Bible, gövt Flags2: "0x0020 Ships of this govt don't use hypergates",
 * "0x0040 Ships of this govt prefer to use hypergates instead of jumping
 * out". Stock: every government sets 0x0020 except Rebellion (141), ATMOS
 * (161), Ambrosia (167) and Sigma Shipyards (172), which set 0x0040, and
 * Nil'kemorya (147), Mu'Hari (168), the gate govt (183) and United
 * Shipping's free-refuel govt (190), which set neither. Every system with a
 * working stock gate lists düde 211 Sigma Shipyards (AI 1) in its traffic,
 * which is what Matthew remembered: "govt Sigma ships ... use hypergates".
 *
 * MEASURED (docs/reference_experiments.md "NPC hypergate traffic, wave 60":
 * stock HG-Tichel moved on screen, Tichel's traffic replaced by Sigma
 * Mod Starbridges and Civvies Shuttles half and half, 11 minutes a rig):
 *  - a ship ARRIVING through a gate: the gate opens, about 1.9 s later a
 *    grey silhouette of the hull fades in at the gate's centre, and the
 *    ship flies out along the gate's emergence angle (its CustSndID, 120
 *    for the stock gates) at about twice its top speed, ~1,000 px straight
 *    out, and jumps away: no port visit (Sigma with 0x0040: 38 arrivals in
 *    11 minutes, every one through the gate; as AI 3 warships the same);
 *  - a ship LEAVING by a gate flies to it like a landing (the gate opens
 *    while it is still ~250 px out), turns grey at the centre and is gone:
 *    the 0x0040 Sigma ships already in the system at launch, traders and
 *    warships alike, all did so within 8 s;
 *  - with the flags swapped (Sigma with neither flag, Civvies with 0x0040)
 *    the Civvies Shuttles came out of the gate instead, and the Sigma ships
 *    used it both ways now and then (about 10 out, 12 in);
 *  - a 0x0020 govt never goes near a gate (the Civvies of the base rig:
 *    none out, none in), and the stock gates' govt 183 / MinStatus 32767,
 *    which lock the PLAYER out, stop no NPC.
 *
 * How NovaJS plays that:
 *  - `gateUse` sorts a govt into 'never' (0x0020), 'prefer' (0x0040) or
 *    'may' (neither; also a ship with no govt);
 *  - a traffic respawn (spawn/npc_spawn_plugin.ts gateArrivalState) of a
 *    'prefer' govt in a system with a working gate comes out of it
 *    (`gateEmergenceState`), a 'may' govt's with MAY_GATE_ARRIVAL_CHANCE,
 *    and leaves at once: mode 'depart' with `departHeading` the emergence
 *    angle, jumping out past the no-jump zone (npc_steering.ts);
 *  - a trader's stops (npc_decision.ts traderDestinations): 'never' and a
 *    held ship leave working gates out, 'may' keeps them among its stops,
 *    'prefer' goes to a gate and nowhere else; a stop at a gate is not a
 *    park but the way out (mode 'gate': fly to the centre, then leave the
 *    world); a 'prefer' warship takes it whenever it has nothing to fight;
 *    a fleet escort follows its leader in;
 *  - the display opens the gate for a ship coming out (it appears beside
 *    it) and for one flying in once it is GATE_NPC_OPEN_RANGE away
 *    (display/gate_animation_plugin.ts). NOT modelled: the ~1.9 s the
 *    original's gate stands open before a ship comes out, and the grey
 *    silhouette fade either way (the ship simply appears / vanishes).
 */

export type GateUse = 'never' | 'may' | 'prefer';

/** How ships of `govt` treat hypergates (gövt Flags2 0x0020 / 0x0040).
 * 0x0020 wins if a plug-in sets both. No govt (an independent ship):
 * neither flag, so 'may'. */
export function gateUse(govt: GovtData | undefined): GateUse {
    if (govt?.flags2.doesntUseHypergates) {
        return 'never';
    }
    return govt?.flags2.prefersHypergates ? 'prefer' : 'may';
}

/** A hypergate an NPC can fly through: a hypergate (not a wormhole), a
 * port by the landing predicate (the 16 destroyed stock gates are not),
 * and linked somewhere. The gate's govt and MinStatus do not matter
 * (wave 60: the stock gates' MinStatus 32767 stopped no NPC). */
export function isWorkingHypergate(data: PlanetData): boolean {
    return data.gate?.kind === 'hypergate' && landable(data)
        && data.gate.destinations.length > 0;
}

/** How fast an NPC flies out of a gate, as a multiple of its top speed.
 * MEASURED (wave 60): a Mod Starbridge (top speed 202.5 px/s) covered
 * about 40-50 px per 1/10 s in its first frames out of the gate, so about
 * twice its top speed, the excess bleeding off as it flew on. */
export const GATE_EMERGENCE_SPEED_FACTOR = 2;

/** The chance that a respawn of a govt with NEITHER gate flag arrives
 * through a working gate rather than by jump. GUESS from wave 60's swap
 * rig (Sigma with neither flag): about 10 of its Mod Starbridges came out
 * of the gate in 11 minutes while about as many flew into it; the number
 * that jumped in was not counted. A 0x0040 govt always comes through the
 * gate (wave 60: every Sigma arrival of the base rig did), a 0x0020 govt
 * never does. */
export const MAY_GATE_ARRIVAL_CHANCE = 0.5;

/**
 * Where and how an NPC arriving through a gate at `gatePosition` appears:
 * AT the gate's centre (wave 60: the silhouette fades in at the centre),
 * facing and flying out along the emergence angle (the gate's CustSndID,
 * Bible: 0-359 exact, anything else random: `emergenceAngle` null, drawn
 * from `random`) at GATE_EMERGENCE_SPEED_FACTOR times its top speed. The
 * angle is a compass heading (0 = up, clockwise), the convention the
 * player's GateArrivalSystem uses.
 *
 * One draw when the angle is random, none otherwise.
 */
export function gateEmergenceState(gatePosition: Position,
    emergenceAngle: number | null, topSpeed: number,
    random: { next(): number }) {
    const heading = emergenceAngle !== null
        ? new Angle(emergenceAngle * Math.PI / 180)
        : new Angle(random.next() * 2 * Math.PI);
    const unit = heading.getUnitVector();
    return {
        position: new Position(gatePosition.x, gatePosition.y),
        rotation: heading,
        velocity: unit.scale(topSpeed * GATE_EMERGENCE_SPEED_FACTOR),
    };
}

/** Within this distance of a gate's centre (and slow enough) an NPC flying
 * into it is gone. Tighter than a trader's park (90 px): the original's
 * ship turned grey ON the gate's centre. */
export const GATE_ENTER_RADIUS = 40;
/** ...and below this speed (px/s). */
export const GATE_ENTER_SPEED = 80;

/** The display opens a gate for an NPC flying into it once it is this
 * close (wave 60: the gate was open while the ship was still about 250 px
 * out, several seconds before it went in). */
export const GATE_NPC_OPEN_RANGE = 300;
