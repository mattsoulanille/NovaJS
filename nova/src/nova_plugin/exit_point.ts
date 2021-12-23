import { WeaponData } from "nova_data_interface/WeaponData";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { WeaponLocalState } from "./fire_weapon_plugin";
import { Animation, getDefaultExitPoints } from 'nova_data_interface/Animation';


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
