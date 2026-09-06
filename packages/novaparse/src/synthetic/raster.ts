/**
 * An integer-only rasterizer for the synthetic sprites.
 *
 * Everything here is exact integer arithmetic: the rotation table is a
 * hand-written fixed-point table rather than Math.cos/Math.sin (whose
 * last ulps differ between engines and platforms, and a flipped boundary
 * pixel would change the checked-in bytes), the shapes are polygons and
 * circles with integer parameters, and the inside tests are cross
 * products and squared distances. So the frames — and the rlëD bytes and
 * collision hulls built from them — are the same on every machine.
 *
 * Coordinates: a frame is `size` pixels square (or `width` x `height`);
 * shapes are given in HALF-PIXEL units centred on the frame, x to the
 * right and y DOWN (screen space), so the pixel at (px, py) has its centre
 * at (2*px + 1 - width, 2*py + 1 - height). Frame 0 faces up; a rotated
 * frame turns the shape clockwise, which is how Nova's sprite sheets are
 * laid out (rotation frame i of framesPer n is heading i * 360 / n).
 */

/** A frame's pixels, row-major: -1 transparent, else a 0RRRRRGGGGGBBBBB colour. */
export interface RasterFrame {
    width: number;
    height: number;
    pixels: number[];
}

/** rlëD pixels are 15-bit RGB (5 bits per channel, top bit clear). */
export function rgb15(red: number, green: number, blue: number): number {
    const channel = (value: number) => {
        if (!Number.isInteger(value) || value < 0 || value > 31) {
            throw new Error(`${value} is not a 5-bit channel`);
        }
        return value;
    };
    return (channel(red) << 10) | (channel(green) << 5) | channel(blue);
}

export const TRANSPARENT = -1;

/**
 * cos(k * 10 degrees) * 1024 for k = 0..9, rounded; the other quadrants
 * come from symmetry. Ten-degree steps give the 36 headings of a
 * standard ship sheet exactly and every divisor of 36 (12, 9, 4 frames)
 * by stepping through it.
 */
const COS_1024 = [1024, 1008, 962, 887, 784, 658, 512, 350, 178, 0];
export const ROTATION_STEPS = 36;

/** cos and sin of heading `step` (0-35, ten degrees each) times 1024. */
export function rotation(step: number): { cos: number, sin: number } {
    const k = ((step % ROTATION_STEPS) + ROTATION_STEPS) % ROTATION_STEPS;
    const cos = (n: number) => {
        if (n <= 9) return COS_1024[n];
        if (n <= 18) return -COS_1024[18 - n];
        if (n <= 27) return -COS_1024[n - 18];
        return COS_1024[36 - n];
    };
    // `+ 0` turns a negated table zero (-0) back into 0.
    return { cos: cos(k) + 0, sin: cos((k + 27) % ROTATION_STEPS) + 0 };
}

export type Point = readonly [x: number, y: number];

/** A convex polygon (half-pixel units, y down) painted in one colour. */
export interface PolygonShape {
    kind: 'polygon';
    color: number;
    points: readonly Point[];
}

/** A filled circle: centre and radius in half-pixel units. */
export interface CircleShape {
    kind: 'circle';
    color: number;
    center: Point;
    radius: number;
}

export type Shape = PolygonShape | CircleShape;

export function polygon(color: number, points: readonly Point[]): PolygonShape {
    return { kind: 'polygon', color, points };
}

export function circle(color: number, center: Point, radius: number): CircleShape {
    return { kind: 'circle', color, center, radius };
}

/**
 * Rasterizes `shapes` (painted in order, later over earlier) into a
 * `width` x `height` frame, rotated clockwise by `step` tenths of a turn
 * around the frame centre. All arithmetic is on integers scaled by 1024,
 * well inside the exactly-representable range.
 */
export function rasterize(width: number, height: number, shapes: readonly Shape[],
    step = 0): RasterFrame {
    const { cos, sin } = rotation(step);
    const rotate = ([x, y]: Point): [number, number] =>
        [x * cos - y * sin, x * sin + y * cos];

    const pixels: number[] = new Array(width * height).fill(TRANSPARENT);
    for (const shape of shapes) {
        if (shape.kind === 'polygon') {
            paintPolygon(pixels, width, height, shape.points.map(rotate), shape.color);
        } else {
            const [cx, cy] = rotate(shape.center);
            paintCircle(pixels, width, height, cx, cy, shape.radius * 1024, shape.color);
        }
    }
    return { width, height, pixels };
}

/** The 1024-scaled half-pixel coordinates of pixel (px, py)'s centre. */
function pixelCentre(px: number, py: number, width: number, height: number):
    [number, number] {
    return [(2 * px + 1 - width) * 1024, (2 * py + 1 - height) * 1024];
}

function paintPolygon(pixels: number[], width: number, height: number,
    points: readonly (readonly [number, number])[], color: number) {
    if (points.length < 3) {
        throw new Error("A polygon needs at least three points");
    }
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const [x, y] = pixelCentre(px, py, width, height);
            let positive = false;
            let negative = false;
            for (let i = 0; i < points.length; i++) {
                const [ax, ay] = points[i];
                const [bx, by] = points[(i + 1) % points.length];
                const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
                if (cross > 0) positive = true;
                if (cross < 0) negative = true;
            }
            // Inside (or on an edge) when every edge agrees on the side.
            if (!(positive && negative)) {
                pixels[py * width + px] = color;
            }
        }
    }
}

function paintCircle(pixels: number[], width: number, height: number,
    cx: number, cy: number, radius: number, color: number) {
    const r2 = radius * radius;
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const [x, y] = pixelCentre(px, py, width, height);
            const dx = x - cx;
            const dy = y - cy;
            if (dx * dx + dy * dy <= r2) {
                pixels[py * width + px] = color;
            }
        }
    }
}

/**
 * The `frameCount` rotation frames of `shapes`, evenly spaced around a
 * full turn; frameCount must divide the 36 table steps.
 */
export function rotationFrames(width: number, height: number,
    shapes: readonly Shape[], frameCount: number): RasterFrame[] {
    if (ROTATION_STEPS % frameCount !== 0) {
        throw new Error(`${frameCount} frames do not divide ${ROTATION_STEPS} steps`);
    }
    const stride = ROTATION_STEPS / frameCount;
    return Array.from({ length: frameCount },
        (_, i) => rasterize(width, height, shapes, i * stride));
}
