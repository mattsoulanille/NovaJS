import { TurretBlindSpots } from 'novadatainterface/blind_spots';
import { GuidanceType } from 'novadatainterface/weapon_data';
import { Angle } from 'nova_ecs/datatypes/angle';
import { Position } from 'nova_ecs/datatypes/position';

/**
 * Which of the three 90°-ish sectors around a ship a bearing falls in.
 * Named after the wëap guidance types that share the partition, because
 * they are literally the same division of the circle: the Bible
 * describes Guidance 7 as firing "+/-45° off the ship's nose"
 * (~:3100), and the shïp/wëap blind-spot flags (~:2527, ~:3195) name
 * the same front/sides/rear sectors.
 */
export type Quadrant = 'frontQuadrant' | 'sidesQuadrant' | 'rearQuadrant';

/** π/4: half-angle of the front (and rear) quadrant. */
export const QUADRANT_HALF_ANGLE = Math.PI / 4;

/**
 * The quadrant of `source` (facing `angle`) that `target` sits in.
 *
 * Boundaries: the front cone is |bearing| < 45°, the rear cone is
 * |bearing| > 135°, and everything else — including both boundaries
 * exactly — is `sidesQuadrant`. Keeping the sides inclusive means the
 * three sectors partition the circle with no gap and no overlap, which
 * matters because a blind-spot test and a quadrant-turret test both
 * read this and must agree.
 */
export function getQuadrant(source: Position, angle: Angle,
    target: Position): Quadrant {
    const angleToOther = target.subtract(source).angle;
    const relativeAngle = angle.subtract(angleToOther);
    const absAngle = Math.abs(relativeAngle.angle);
    if (absAngle < QUADRANT_HALF_ANGLE) {
        return 'frontQuadrant';
    } else if (absAngle > 3 * QUADRANT_HALF_ANGLE) {
        return 'rearQuadrant';
    }
    return 'sidesQuadrant';
}

/**
 * The guidance types the blind-spot flags apply to.
 *
 * The Bible words both flag sets as being about TURRETS ("Turreted
 * weapon has a blind spot to ...", "Ship's turrets have a blind spot
 * to ..."), so a fixed gun ignores them even when its wëap sets the
 * bits — and the stock data does exactly that on five unguided/beam
 * weapons (nova:128 Light Blaster and nova:146 Pulse Laser among
 * them), which visibly still shoot forward in the original game.
 *
 * The front/rear-quadrant turrets are included because they ARE
 * turrets ("Front-quadrant turret", "Rear-quadrant turret", ~:3100).
 * In practice the quadrant restriction dominates: across the stock
 * data and every installed plug-in there is no quadrant weapon whose
 * own quadrant is blind, and no ship with a front blind spot at all,
 * so including them changes no stock behaviour — it just keeps one
 * rule instead of two.
 *
 * Point defense is NOT included: those turrets pick their own victim
 * out of the world every frame rather than tracking the ship's target,
 * and the Bible attaches no blind-spot rule to them.
 */
export function isTurretedGuidance(guidance: GuidanceType): boolean {
    return guidance === 'turret' || guidance === 'beamTurret'
        || guidance === 'frontQuadrant' || guidance === 'rearQuadrant';
}

const NO_BLIND_SPOTS: TurretBlindSpots =
    { front: false, sides: false, rear: false };

/**
 * The ship-level and weapon-level sets OR'ed together. Each is a
 * restriction on where the turret may shoot, so neither can re-open a
 * sector the other closes.
 */
export function combineBlindSpots(a: TurretBlindSpots | undefined,
    b: TurretBlindSpots | undefined): TurretBlindSpots {
    if (!a) {
        return b ?? NO_BLIND_SPOTS;
    }
    if (!b) {
        return a;
    }
    return {
        front: a.front || b.front,
        sides: a.sides || b.sides,
        rear: a.rear || b.rear,
    };
}

/** Whether the given sector is blocked. */
export function isBlindQuadrant(blindSpots: TurretBlindSpots,
    quadrant: Quadrant): boolean {
    switch (quadrant) {
        case 'frontQuadrant':
            return blindSpots.front;
        case 'sidesQuadrant':
            return blindSpots.sides;
        case 'rearQuadrant':
            return blindSpots.rear;
    }
}

/**
 * Whether a turret's blind spots stop it firing at this target.
 *
 * THE ODD PART, and the whole reason this is a separate predicate: the
 * original game gates on where the TARGET is, not on where the turret
 * is pointing. A turret whose target sits in a live sector fires at
 * whatever angle guidance asks for — including a lead angle that falls
 * inside a blind sector, and including a beam that sweeps through one.
 * A turret whose target sits in a blind sector does not fire at all,
 * even though it could point somewhere legal. So this is one test, on
 * one bearing, taken before the shot is aimed.
 *
 * `targetPosition` undefined means there is nothing to test a bearing
 * against, so nothing is blocked: a targetless full turret has already
 * been stopped by fireFromEntity for its own reasons, and a targetless
 * quadrant turret is in the Bible's "fires straight ahead if no
 * target" case, which names no target to be blind to.
 *
 * Determinism: pure geometry over replicated MovementState plus static
 * game data, so every peer answers identically. No PRNG, no clock.
 */
export function blindSpotBlocksQuadrant(args: {
    guidance: GuidanceType,
    weaponBlindSpots: TurretBlindSpots | undefined,
    shipBlindSpots: TurretBlindSpots | undefined,
    /** The quadrant the TARGET is in, or undefined if there is none. */
    targetQuadrant: Quadrant | undefined,
}): boolean {
    if (!isTurretedGuidance(args.guidance) || !args.targetQuadrant) {
        return false;
    }
    const blindSpots = combineBlindSpots(
        args.shipBlindSpots, args.weaponBlindSpots);
    return isBlindQuadrant(blindSpots, args.targetQuadrant);
}

/**
 * blindSpotBlocksQuadrant for callers that have the target's POSITION
 * rather than its already-computed quadrant.
 */
export function blindSpotBlocksFiring(args: {
    guidance: GuidanceType,
    weaponBlindSpots: TurretBlindSpots | undefined,
    shipBlindSpots: TurretBlindSpots | undefined,
    sourcePosition: Position,
    sourceRotation: Angle,
    targetPosition: Position | undefined,
}): boolean {
    return blindSpotBlocksQuadrant({
        guidance: args.guidance,
        weaponBlindSpots: args.weaponBlindSpots,
        shipBlindSpots: args.shipBlindSpots,
        targetQuadrant: args.targetPosition
            ? getQuadrant(args.sourcePosition, args.sourceRotation,
                args.targetPosition)
            : undefined,
    });
}
