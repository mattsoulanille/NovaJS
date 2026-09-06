import { WeaponData } from "novadatainterface/weapon_data";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { WeaponLocalState } from "./fire_weapon_plugin.js";
import { Animation, ExitPoint, getDefaultExitPoints } from 'novadatainterface/animation';


export interface ExitPointData {
    position: [number, number, number],
    upCompress: [number, number],
    downCompress: [number, number],
}

export function getExitPointData(sourceAnimation: Animation,
    weapon: WeaponData, localState: WeaponLocalState): ExitPointData {
    let position: [number, number, number] = [0, 0, 0];

    const exitPoints = sourceAnimation.exitPoints ?? getDefaultExitPoints();
    if (weapon.exitType !== "center") {
        const positions = exitPoints[weapon.exitType];
        position = positions[localState?.exitIndex ?? 0] ?? position;
    }

    return {
        position,
        downCompress: exitPoints.downCompress,
        upCompress: exitPoints.upCompress,
    };
}

/**
 * Which of a ship's exit points (for one `exitType`) a weapon with wëap
 * Flags3 0x0010 — "Weapon fires from whatever weapon exit point is
 * closest to the target" — should fire from.
 *
 * `positions` are the shän's raw [x, y, z] offsets for the weapon's exit
 * class; they are placed in the world exactly the way the firing code
 * places them (rotate by the ship's heading, apply the up/down
 * compression, subtract the z offset — see applyExitPoint) and the one
 * whose world position is nearest `target` wins.
 *
 * SIMULATION state: the returned index decides where the shot or beam
 * spawns, which every peer must agree on. It is pure geometry over
 * replicated state (shän offsets, the firer's rotation/position, the
 * target's position); the transcendentals inside `Vector.rotate` are
 * bit-deterministic in simulating contexts (installDeterministicMath),
 * and ties resolve to the LOWEST index so an exactly-symmetric ship
 * (e.g. the Fed Carrier, whose four beam points are identical) picks the
 * same point everywhere.
 */
export function closestExitPointIndex(positions: ExitPoint,
    compress: Pick<ExitPointData, 'upCompress' | 'downCompress'>,
    sourcePosition: Vector, rotation: Angle, target: Vector): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < positions.length; i++) {
        const offset = applyExitPoint({
            position: positions[i],
            upCompress: compress.upCompress,
            downCompress: compress.downCompress,
        }, rotation);
        const distance = target.subtract(sourcePosition.add(offset)).lengthSquared;
        if (distance < bestDistance) {
            bestDistance = distance;
            best = i;
        }
    }
    return best;
}

export function applyExitPoint(exitPointData: ExitPointData, rotation: Angle): Vector {
    //    var rotation = (this.source.pointing + 1.5 * Math.PI) % (2 * Math.PI);
    const { position, upCompress, downCompress } = exitPointData;
    const exit = new Vector(position[0], -position[1]);
    const rotated = exit.rotate(rotation.angle);

    let compressed: Vector;
    if (Math.abs(rotation.angle) < Math.PI / 2) {
        //if (true) {
        // pointing up
        compressed = new Vector(
            rotated.x * upCompress[0] / 100,
            rotated.y * upCompress[1] / 100,
        );
    } else {
        // pointing down
        compressed = new Vector(
            rotated.x * downCompress[0] / 100,
            rotated.y * downCompress[1] / 100,
        )
    }

    // z offset
    return new Vector(compressed.x, compressed.y - position[2]);
}
