/**
 * ============================================================================
 * WHAT A POINT DEFENSE TURRET SHOOTS AT
 * ============================================================================
 *
 * The EVN Bible gives point defense two kinds of prey, not one. wëap
 * Guidance (~:3103):
 *
 *      9      Point defense turret (fires automatically at incoming
 *               guided weapons and nearby ships)
 *      10     Point defense beam (fires automatically at incoming
 *               guided weapons and nearby ships)
 *
 * and neither kind is "any ship". Both halves are opt-in on the data:
 *
 *  - a MISSILE is prey when its wëap Flags lack 0x0080 (~:3189, "Weapon
 *    can't be targeted by point defense systems (works only for homing
 *    weapons)"), which weapon_parse turns into `vulnerableTo:
 *    ["pointDefense"]`;
 *  - a SHIP is prey when its shïp Flags2 carries 0x0008 (~:2572, "Ship
 *    can be fired on by point defense systems"), which ship_parse turns
 *    into the same `vulnerableTo` entry. 131 of the 288 stock shïp
 *    resources set it and they are, as you would expect, the fighters
 *    and small craft: Viper (nova:167), Fed Viper (nova:144), Lightning
 *    (nova:135), Thunderhead (nova:157), Firebird (nova:155), Shuttle
 *    (nova:128). The capital ships do not: Fed Carrier (nova:143), Fed
 *    Destroyer (nova:141), IDA Frigate (nova:140), Leviathan (nova:131).
 *
 * Both flags land on the SAME field, so one marker component
 * (VulnerableToPD) and one collision tag ('pointDefense') cover
 * projectiles and ships alike, and a PD turret can only ever aim at
 * something its shots can actually damage.
 *
 * This module is the choice itself, and nothing else: a pure function
 * over already-gathered facts, so it can be unit-tested without a world
 * and so the priority rule is readable in one place. Gathering the facts
 * (running the query, asking hostility.ts for a verdict) is
 * fire_weapon_plugin's job.
 *
 * DETERMINISM. The caller iterates an entity query whose order differs
 * between a peer that built its entity map by insertion and one restored
 * from a wire snapshot, so the winner must not depend on that order.
 * `selectPointDefenseTarget` therefore breaks EXACT ties — same kind,
 * bit-identical squared distance — toward the lexicographically smaller
 * uuid, the same rule selectNearestHostile and the NPC chooseNearest
 * use. No PRNG, no clock.
 */

/**
 * Which half of the Bible's "incoming guided weapons and nearby ships"
 * a candidate is. Missiles outrank fighters (see
 * `selectPointDefenseTarget`).
 */
export type PointDefenseKind = 'missile' | 'fighter';

/** One thing a point defense turret could shoot at, already measured. */
export interface PointDefenseCandidate {
    uuid: string;
    /** 'fighter' when the candidate is a ship, 'missile' otherwise. */
    kind: PointDefenseKind;
    /** Squared distance from the turret's exit point. */
    distanceSquared: number;
    /**
     * The candidate's owner (the uuid of the ship that fired the shot or
     * launched the fighter), or its own uuid when it has no owner.
     */
    owner: string;
    /** What the candidate currently has targeted, if anything. */
    target?: string;
    /**
     * Whether the FIRING side calls this candidate hostile, per the one
     * hostility rule (hostility.ts). Always false for missiles, which
     * are judged by who they are flying at instead.
     */
    hostile: boolean;
    /**
     * Whether the candidate belongs to the firing side's own flock —
     * its escorts, its bay fighters, and anything transitively following
     * them (flock.ts).
     */
    inFlock: boolean;
}

/** The turret asking the question. */
export interface PointDefenseFirer {
    /**
     * The uuid the firing entity belongs to: the carrier for a bay
     * fighter, the player for a hired escort, the ship itself for an
     * independent. This is the "us" a missile has to be flying at.
     */
    owner: string;
    /** The uuid of the entity the turret is bolted to. */
    source: string;
    /** The turret's reach, squared. */
    rangeSquared: number;
}

/**
 * THE CANDIDACY RULE.
 *
 * Common to both kinds: in range, not us, not ours, not our flock's.
 * `owner === firer.owner` is what keeps a turret from shooting its own
 * side's shots and its own carrier's other fighters; `inFlock` extends
 * that through the follow chain (our escort's bay fighters are ours
 * too, even though their owner uuid is the escort rather than us).
 *
 * Then the halves differ, deliberately:
 *
 *  - A MISSILE is prey only when it is flying at US (its target is our
 *    owner or the turret's own ship). This is the rule point defense has
 *    always had here, kept verbatim: a missile crossing the screen on
 *    its way to someone else is not "incoming", and burning rounds on it
 *    would drain a turret that exists to save its own ship.
 *
 *  - A FIGHTER is prey ONLY when it is HOSTILE to us (hostility.ts — the
 *    same verdict that paints the target corners red and that the 'r'
 *    key scans for). Merely having us TARGETED is not enough: a player
 *    in a fighter selects a neutral ship to hail it (or just to read its
 *    stats), and a turret that answered the lock with fire started a war
 *    over a comm call. Nothing is lost by waiting for hostility: the
 *    hostility verdict already covers the fighter that fires at us
 *    (recent-aggression flips it red the moment its shot lands or its
 *    missile locks on), the fighter in an 'attack' posture, and the
 *    fighter of an enemy government — and it catches the one strafing
 *    our formation with its lock on our escort rather than on us. The
 *    hostility half is what makes the flag safe to honour at all:
 *    without it, "PD-vulnerable ship in range" would include our own
 *    wing, passing traders and allied patrols, and a point defense
 *    turret would start wars on its own.
 */
export function isPointDefenseCandidate(candidate: PointDefenseCandidate,
    firer: PointDefenseFirer): boolean {
    if (candidate.distanceSquared > firer.rangeSquared) {
        return false;
    }
    if (candidate.uuid === firer.source || candidate.uuid === firer.owner) {
        return false;
    }
    if (candidate.owner === firer.owner) {
        return false;
    }
    if (candidate.inFlock) {
        return false;
    }
    if (candidate.kind === 'missile') {
        return candidate.target === firer.owner
            || candidate.target === firer.source;
    }
    return candidate.hostile;
}

/**
 * THE PRIORITY RULE: MISSILES FIRST.
 *
 * Among everything eligible (`isPointDefenseCandidate`), the closest
 * missile wins outright, however much closer a fighter is. Only when no
 * missile is in reach does the turret take the closest hostile fighter.
 * A missile is a one-shot kill on the ship the turret is protecting and
 * a fighter is not, so a turret that spent its reload on the fighter
 * while a torpedo closed would be doing its job backwards.
 *
 * Ties within a kind break on exact squared distance, then on uuid — see
 * the determinism note at the top of the file.
 *
 * Generic in the candidate type so callers can hang whatever they still
 * need (the movement state to aim at) off the object they get back.
 */
export function selectPointDefenseTarget<T extends PointDefenseCandidate>(
    candidates: Iterable<T>, firer: PointDefenseFirer): T | undefined {
    let best: T | undefined;
    for (const candidate of candidates) {
        if (!isPointDefenseCandidate(candidate, firer)) {
            continue;
        }
        if (best === undefined || outranks(candidate, best)) {
            best = candidate;
        }
    }
    return best;
}

/** Whether `candidate` is a better point defense target than `best`. */
function outranks(candidate: PointDefenseCandidate,
    best: PointDefenseCandidate): boolean {
    if (candidate.kind !== best.kind) {
        return candidate.kind === 'missile';
    }
    if (candidate.distanceSquared !== best.distanceSquared) {
        return candidate.distanceSquared < best.distanceSquared;
    }
    return candidate.uuid < best.uuid;
}

/**
 * WHAT A POINT DEFENSE SHOT MAY HURT — the collision-time twin of the
 * candidacy rule above (Matthew's ruling): a PD round or beam damages
 * only something the turret would have FILTERED THROUGH to aim at — a
 * missile flying at us, a ship hostile to us — never merely "a fighter"
 * or "a missile". A stray burst that crosses a neutral PD-vulnerable
 * fighter, or somebody else's missile, passes straight through instead
 * of landing the few points of damage that turn a bystander into an
 * enemy (recent aggression flips them red at the first hit).
 *
 * Exactly isPointDefenseCandidate with range ignored (the shot has
 * already reached the thing), so the two can never disagree.
 */
export function pointDefenseMayDamage(candidate: Omit<PointDefenseCandidate,
    'distanceSquared'>, firer: Omit<PointDefenseFirer, 'rangeSquared'>):
    boolean {
    return isPointDefenseCandidate({ ...candidate, distanceSquared: 0 },
        { ...firer, rangeSquared: Infinity });
}
