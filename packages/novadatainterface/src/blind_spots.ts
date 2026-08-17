/**
 * Turret blind spots (EVN Bible, wëap Flags ~:3195 and shïp Flags
 * ~:2527).
 *
 * The same three bits appear in two places, with the same meaning and
 * the same quadrant partition:
 *
 *   0x1000  blind spot to the front
 *   0x2000  blind spot to the sides
 *   0x4000  blind spot to the rear
 *
 * On a wëap ("Turreted weapon has a blind spot to ...") they restrict
 * that one weapon; on a shïp ("Ship's turrets have a blind spot to
 * ...") they restrict every turret the ship mounts. A ship's set and a
 * weapon's set are OR'ed together — each is a restriction, so neither
 * can re-open what the other closes.
 *
 * The sectors are the same 90° quadrants the front/rear-quadrant
 * turrets use: the Bible describes wëap Guidance 7 as firing "+/-45°
 * off the ship's nose" (~:3100), so `front` is the ±45° cone around
 * the ship's heading, `rear` the ±45° cone around its tail, and
 * `sides` the two 90° wedges between them. See getQuadrant in
 * nova_plugin/blind_spots.ts, which is the one implementation of that
 * partition.
 *
 * WHAT THEY GATE — and this is the part that is easy to get wrong: the
 * original game tests the TARGET's bearing, not the firing angle. A
 * turret whose target sits in a live sector fires at whatever angle
 * guidance asks for, even when that lead angle lies inside a blind
 * spot; a turret whose target sits in a blind sector does not fire at
 * all. See shouldBlindSpotBlockFiring.
 */
export interface TurretBlindSpots {
    /** wëap/shïp Flags 0x1000: the ±45° cone around the ship's nose. */
    front: boolean;
    /** wëap/shïp Flags 0x2000: the two 90° wedges either side. */
    sides: boolean;
    /** wëap/shïp Flags 0x4000: the ±45° cone around the ship's tail. */
    rear: boolean;
}

export function getDefaultTurretBlindSpots(): TurretBlindSpots {
    return { front: false, sides: false, rear: false };
}

/** True when no sector is blocked (the overwhelmingly common case). */
export function hasNoBlindSpots(blindSpots: TurretBlindSpots): boolean {
    return !blindSpots.front && !blindSpots.sides && !blindSpots.rear;
}
