import { GovtData } from "novadatainterface/govt_data";
import { LegalRecords, recordHostile, recordWith } from "./reputation.js";

/**
 * How one government regards another ship, per the EVN Bible's gövt
 * model: allies/enemies are expressed as *class numbers* — a govt is
 * allied with any govt whose `classes` intersect its `allies`, and
 * hostile to any whose `classes` intersect its `enemies`. A govt is
 * always allied with itself.
 *
 * Ships with no government (the player, dev-spawned ships, düdes with
 * govt -1) are "independent": most governments regard them as neutral,
 * but xenophobic governments (pirates and nasties, Flags1 0x0001
 * "warships attack everyone except allies") and governments flagged
 * alwaysAttacksPlayer treat them as enemies.
 *
 * This is the single source of truth for NPC target selection and for
 * radar blip coloring.
 *
 * Reputation: ships that carry legal records (players) are judged
 * per-record on top of the political baseline — a govt whose record
 * with THAT player is below -CrimeTol treats the player as an enemy
 * (govtDispositionTo). Records are synced sim state, so every peer
 * draws the same conclusion about the same player.
 */
export type Disposition = 'ally' | 'neutral' | 'enemy';

function intersects(a: number[], b: number[]): boolean {
    return a.some(x => b.includes(x));
}

/**
 * The disposition of a ship of govt `self` toward a ship of govt
 * `other`. Either may be undefined (independent). Not necessarily
 * symmetric: disposition is always evaluated from the acting ship's
 * side.
 */
export function govtDisposition(self: GovtData | undefined,
    other: GovtData | undefined): Disposition {
    if (!self) {
        // Independent ships have no politics; they fight only when
        // provoked (aggression is tracked per-ship, not per-govt).
        return 'neutral';
    }
    if (other && other.id === self.id) {
        return 'ally';
    }
    if (other && intersects(self.allies, other.classes)) {
        return 'ally';
    }
    if (other && intersects(self.enemies, other.classes)) {
        return 'enemy';
    }
    if (self.flags.xenophobic) {
        // Xenophobic warships attack everyone except allies.
        return 'enemy';
    }
    if (!other && self.flags.alwaysAttacksPlayer) {
        // Approximation: alwaysAttacksPlayer applies to the player's
        // ship specifically; independent NPCs are lumped in with the
        // player until per-ship player identification matters here.
        return 'enemy';
    }
    return 'neutral';
}

/**
 * The disposition of a ship of govt `self` toward a specific ship,
 * folding in the target's legal records when it has any (players):
 * a criminal record with `self` (record < -CrimeTol, the Bible's
 * warships-attack threshold) makes the target an enemy, unless the
 * govt never attacks the player. All other pairs fall back to the
 * political govtDisposition.
 */
export function govtDispositionTo(self: GovtData | undefined,
    other: GovtData | undefined,
    otherRecords?: LegalRecords,
    /**
     * ränk Flags 0x0100: "Ships of the affiliated government will not
     * automatically attack the player when he has this rank" — true when the
     * TARGET holds an active rank affiliated with `self` carrying that bit
     * (rank_logic.ts's ranksSuppressAggression).
     *
     * "AUTOMATICALLY" is the operative word, and it is why this only
     * suppresses the disposition: the aggressor path in npc_ai_plugin's
     * target selection is untouched, so a ship the player shoots at still
     * fights back. The rank buys you their goodwill, not immunity.
     */
    otherRankSuppresses?: boolean): Disposition {
    const base = govtDisposition(self, other);
    if (otherRankSuppresses) {
        // The rank buys off the automatic hostility and nothing else: an
        // 'enemy' becomes 'neutral', an existing 'ally' stays an ally, and
        // the criminal-record test below is skipped (a rank the govt itself
        // granted outranks the record they hold on you — that is the point
        // of "will not automatically attack").
        return base === 'enemy' ? 'neutral' : base;
    }
    if (base !== 'enemy' && self && otherRecords
        && !self.flags.neverAttacksPlayer
        && recordHostile(recordWith(otherRecords, self.id, self),
            self.crimeTol)) {
        return 'enemy';
    }
    return base;
}

/**
 * A ship's effective combat strength: the shïp Strength rating scaled
 * between 30% and 100% by its current shield level (EVN Bible, gövt
 * MaxOdds).
 */
export function effectiveStrength(strength: number,
    shieldFraction: number): number {
    const clamped = Math.max(0, Math.min(1, shieldFraction));
    return strength * (0.3 + 0.7 * clamped);
}

/**
 * Whether a ship of a govt with `maxOdds` considers a fight against
 * `enemyStrength` favorable enough to engage (or keep fighting).
 * MaxOdds 100 = a 1-to-1 fight; higher = willing to fight when
 * outmatched. Both strengths are effective strengths (shield-scaled).
 * A zero own-strength ship never considers combat favorable.
 */
export function oddsFavorable(maxOdds: number, ownStrength: number,
    enemyStrength: number): boolean {
    if (ownStrength <= 0) {
        return false;
    }
    return enemyStrength / ownStrength * 100 <= maxOdds;
}
