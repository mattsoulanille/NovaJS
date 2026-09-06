import "jasmine";
import { Angle } from "nova_ecs/datatypes/angle";
import { Vector } from "nova_ecs/datatypes/vector";
import { closestExitPointIndex } from "./exit_point.js";

// No perspective correction: 100% compression both ways is the identity
// (the Bible: "Values of zero are interpreted the same as a value of
// 100"; the parse normalizes, so tests pass 100 explicitly).
const NO_COMPRESS = {
    upCompress: [100, 100] as [number, number],
    downCompress: [100, 100] as [number, number],
};

// Two gun mounts on the ship's port and starboard sides. shän exit
// points are in sprite coordinates with +y DOWN the screen, which
// applyExitPoint flips, so [x, 0, 0] is a pure sideways offset.
const PORT_AND_STARBOARD: Array<[number, number, number]> = [
    [20, 0, 0],   // starboard (+x)
    [-20, 0, 0],  // port (-x)
];

const ORIGIN = new Vector(0, 0);
const POINTING_UP = new Angle(0);

describe("closestExitPointIndex", () => {
    it("picks the mount on the target's side", () => {
        // Target far off to +x: the starboard mount (index 0) is nearer.
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(1000, 0))).toEqual(0);
        // ...and mirrored, the port mount (index 1).
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(-1000, 0))).toEqual(1);
    });

    it("follows the ship's rotation", () => {
        // Rotate the ship 180 degrees and the mounts swap sides, so the
        // same target now picks the other index.
        const flipped = new Angle(Math.PI);
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            ORIGIN, flipped, new Vector(1000, 0))).toEqual(1);
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            ORIGIN, flipped, new Vector(-1000, 0))).toEqual(0);
    });

    it("measures from the ship's world position, not the origin", () => {
        const shipAt = new Vector(5000, -3000);
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            shipAt, POINTING_UP, shipAt.add(new Vector(500, 0)))).toEqual(0);
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            shipAt, POINTING_UP, shipAt.add(new Vector(-500, 0)))).toEqual(1);
    });

    it("resolves exact ties to the lowest index, deterministically", () => {
        // Dead ahead is equidistant from both mounts. Every peer must
        // pick the same one, so the tie-break is "first wins".
        expect(closestExitPointIndex(PORT_AND_STARBOARD, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(0, -1000))).toEqual(0);
        // The Fed Carrier's four beam exit points are all identical
        // ([0, -10, 3] x4), which is the degenerate case of the same
        // rule: always index 0.
        const identical: Array<[number, number, number]> = [
            [0, -10, 3], [0, -10, 3], [0, -10, 3], [0, -10, 3],
        ];
        expect(closestExitPointIndex(identical, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(700, 400))).toEqual(0);
    });

    it("accounts for the shän's perspective compression", () => {
        // Compression scales the rotated offsets, so a ship whose x
        // offsets are squashed to nothing has both mounts on the
        // centreline and ties to index 0 rather than picking by side.
        const squashed = {
            upCompress: [0, 100] as [number, number],
            downCompress: [0, 100] as [number, number],
        };
        expect(closestExitPointIndex(PORT_AND_STARBOARD, squashed,
            ORIGIN, POINTING_UP, new Vector(-1000, 0))).toEqual(0);
    });

    it("uses the z offset, which is applied after compression", () => {
        // Same x, different z (screen-up offset): the mount whose z puts
        // it nearer a target below the ship wins. Bible: positive z
        // moves up the screen.
        const stacked: Array<[number, number, number]> = [
            [0, 0, 40],   // 40px up the screen
            [0, 0, -40],  // 40px down the screen
        ];
        expect(closestExitPointIndex(stacked, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(0, 1000))).toEqual(1);
        expect(closestExitPointIndex(stacked, NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(0, -1000))).toEqual(0);
    });

    it("handles a single exit point", () => {
        expect(closestExitPointIndex([[7, 3, 0]], NO_COMPRESS,
            ORIGIN, POINTING_UP, new Vector(-100, -100))).toEqual(0);
    });
});
