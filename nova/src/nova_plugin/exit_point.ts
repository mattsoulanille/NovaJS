import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";


export function applyExitPoint(offset: [number, number, number], rotation: Angle,
    upCompress: [number, number], downCompress: [number, number]): Vector {
    //    var rotation = (this.source.pointing + 1.5 * Math.PI) % (2 * Math.PI);

    const exit = new Vector(offset[0], offset[1]);
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
    return new Vector(compressed.x, compressed.y - offset[2]);
}
