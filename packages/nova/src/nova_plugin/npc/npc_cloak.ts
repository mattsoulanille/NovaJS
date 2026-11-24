import { Entity } from 'nova_ecs/entity';
import { EscortCommandComponent } from '../player/index.js';
import {
    CloakActiveComponent, CloakCapability, CloakComponent, DisabledComponent,
    FuelComponent, isCloaked, ShieldComponent, ShipDataComponent,
} from '../ship/index.js';
import { NpcState } from './npc_component.js';

/**
 * ============================================================================
 * NPC cloaking: "cloak when just flying around" (shïp Flags2 0x0800)
 * ============================================================================
 *
 * EVN Bible, shïp Flags2 0x0100-0x4000: the occasions an AI ship cloaks
 * (on burst reload, when running away, when hyperspacing, when just flying
 * around, stays cloaked until close to its target, when docking, when
 * preemptively attacked). Each needs a cloaking device (oütf ModType 17)
 * aboard; the bits only say when the AI uses it.
 *
 * Reference "W1 / C1 / H1 wave 15" (docs/reference_experiments.md), disc
 * hulls carrying the stock Wraith Cloaking Device, one bit each:
 *  - the AI 1 trader with 0x0800 was on screen only twice in about four
 *    minutes, each time APPEARING beside the port the player sat at (no
 *    entry from the screen edge) and flying off it to the edge, visible
 *    for 4-5 s; every other trader parked beside that port, visibly, for
 *    13-15 s;
 *  - the hostile AI 3 ships with 0x0800 + 0x1000 were VISIBLE the whole
 *    time they attacked, from the moment they came in from the screen
 *    edge: they do not fight cloaked;
 *  - 0x0400, 0x2000 and 0x4000 ships were never seen cloaked.
 * And "J wave 6" (same doc, "Cloaked targets"): an immobile AI 3 hull with
 * the stock Wraith flags (0x5F00, 0x0800 among them) was targetable until
 * the player fired on it, and cloaked within 5 s of that.
 *
 * Here, the one case measured: an AI 1 or AI 2 TRADER of a 0x0800 hull
 * that can cloak flies its planet-to-planet loop cloaked — travelling,
 * parked at a stellar ('dwell', NovaJS's stand-in for a landing) and
 * flying out to jump ('depart') — and is VISIBLE for
 * NPC_CLOAK_REVEAL_AFTER_STAY_MS after each stay ends, as it pulls away
 * from the stellar. In every other mode (fleeing, fighting, mining) and
 * while it has an aggressor it is uncloaked, and so it is while disabled.
 *
 * Warships and interceptors with 0x0800 are left alone (never cloaked by
 * this rule): the hostile ones were visible while attacking, which an
 * uncloaked NovaJS warship already is, and J wave 6's idle one was not
 * cloaked either. The other bits are not implemented. All of it is listed
 * as guesses in docs/npc_behavior_gaps.md (C1).
 *
 * Stock: the only 0x0800 hulls are the Wraith (Adult) and (Youth), shïp
 * 168 and 169, with the Wraith Cloaking Device. They fly as AI 2 in the
 * "Wraith (nice)" düdes 143 and 187, which this cloaks as they travel, and
 * as AI 4 in "Wraith (nasty)" 144, which it leaves alone.
 *
 * A device that drains fuel or shield (oütf ModVal 0x0010-0x0800) is
 * engaged only with that resource above NPC_CLOAK_RESUME_FRACTION of its
 * capacity, so a ship whose drain ran it dry (CloakDrainSystem drops the
 * cloak) does not flicker in and out as it recharges. The stock Wraith
 * device drains nothing.
 *
 * Synced state and the sim clock only; no PRNG. Writes the same
 * CloakActiveComponent the player's toggle does, so the display, targeting
 * and the NPC brains already treat the ship as cloaked.
 */

/** How long a cloaking trader stays visible after a stay at a stellar
 * ends. GUESS fitted to the two reference sightings (4-5 s from the port
 * to the screen edge). */
export const NPC_CLOAK_REVEAL_AFTER_STAY_MS = 4000;
/** A draining cloak is engaged only with its resource above this fraction
 * of capacity. GUESS (no draining device was measured). */
export const NPC_CLOAK_RESUME_FRACTION = 0.5;

/** The trader modes "just flying around" covers. */
const FLYING_AROUND_MODES: ReadonlySet<string> =
    new Set(['travel', 'dwell', 'depart']);

/**
 * Whether a 0x0800 NPC trader (see the module comment) wants its cloak on
 * at sim time `now`. Pure; synced state only.
 */
export function npcCloaksWhileFlying(npc: NpcState, now: number): boolean {
    if (npc.aiType !== 1 && npc.aiType !== 2) {
        return false;
    }
    if (npc.mode === undefined || !FLYING_AROUND_MODES.has(npc.mode)
        || npc.aggressor !== undefined) {
        return false;
    }
    // `until` is when the last stay ended (or will end, while dwelling).
    const stayEnd = npc.until;
    return npc.mode === 'dwell' || stayEnd === undefined
        || now < stayEnd || now >= stayEnd + NPC_CLOAK_REVEAL_AFTER_STAY_MS;
}

interface Drained {
    current: number;
    max: number;
}

/** Whether a cloak can be (re-)engaged without its drain running dry. */
export function cloakSustainable(cloak: CloakCapability,
    shield: Drained | undefined, fuel: Drained | undefined): boolean {
    const above = (stat: Drained | undefined) => stat !== undefined
        && stat.max > 0
        && stat.current > NPC_CLOAK_RESUME_FRACTION * stat.max;
    return (cloak.fuelPerSecond <= 0 || above(fuel))
        && (cloak.shieldPerSecond <= 0 || above(shield));
}

/**
 * Engages or drops a 0x0800 trader's cloak (npcCloaksWhileFlying) at sim
 * time `now`. Only ever touches NPCs of such hulls that carry a working
 * cloak (CloakComponent, derived from outfits); the player's own toggle
 * (CloakControlSystem) never reaches an NPC, and a player-commanded escort
 * is left to its command.
 *
 * Called by NpcSteeringSystem at the top of each tick, before any of its
 * early returns, so it runs for every NPC every tick in the steering
 * system's declared place in the order; it reads the entity through the
 * same GetEntity. The one mode change steering itself makes that matters
 * here, travel to 'dwell', is cloaked on both sides, so reading the mode
 * before the arm runs changes nothing.
 */
export function updateNpcCloak(entity: Entity, npc: NpcState, now: number) {
    const components = entity.components;
    const cloak = components.get(CloakComponent);
    if (!cloak?.canCloak || components.has(EscortCommandComponent)
        || !components.get(ShipDataComponent)?.aiFlags.cloak.whenFlyingAround) {
        return;
    }
    const active = components.get(CloakActiveComponent);
    const shield = components.get(ShieldComponent);
    const current = isCloaked(active);
    const want = !components.has(DisabledComponent)
        && npcCloaksWhileFlying(npc, now)
        && (current || cloakSustainable(cloak, shield,
            components.get(FuelComponent)));
    if (want === current) {
        return;
    }
    if (active) {
        active.active = want;
    } else {
        components.set(CloakActiveComponent, { active: want });
    }
    if (want && cloak.dropsShieldsOnActivate && shield) {
        // As the player's toggle: activation drops shields (0x0004).
        shield.current = shield.min;
    }
}
