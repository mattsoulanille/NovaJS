import * as PIXI from "pixi.js";
import { SystemState } from "../../engine/SystemState";
import { VectorLike, Vector } from "../../engine/Vector";


class Radar extends PIXI.Graphics {
    iff: boolean;
    density: boolean;
    dimensions: Vector;
    radarScale: number;
    targetPosition: VectorLike;
    constructor({ dimensions, scale, iff, density }:
        {
            dimensions: { x: number, y: number },
            scale?: number,
            iff?: boolean,
            density?: boolean
        }) {
        super();
        this.dimensions = Vector.fromVectorLike(dimensions);

        if (scale) {
            this.radarScale = scale;
        }
        else {
            this.radarScale = 0.05;
        }

        if (iff) {
            this.iff = iff;
        }
        else {
            this.iff = false;
        }

        if (density) {
            this.density = density
        }
        else {
            this.density = false;
        }
        this.targetPosition = { x: 0, y: 0 };

    }

    // Draws a square of side length `size` and
    // color `color` centered at position `coordinates`
    // where coordinates are relative to the center of the
    // radar square.
    private drawDot(coordinates: VectorLike, size: number, color: number) {
        let coords = Vector.fromVectorLike(coordinates);

        // Turn center coords into corner coords that we draw
        coords.add(this.dimensions.scaledBy(0.5));

        // Don't draw points outside the bounds
        // If you do, the screen goes black
        if (coords.x < 0
            || coords.x > this.dimensions.x
            || coords.y < 0
            || coords.y > this.dimensions.y) {
            return;
        }


        // We can only draw coords that are relative to
        // the top left corner, so we transform them from
        // center-of-radar-rectangle coordinates here.
        //coords.add(this.dimensions.scaledBy(0.5));

        // 0 in alignment means draw on the right side
        this.lineStyle(size, color, 1, 0);
        // this.moveTo(0, 0);
        // this.lineTo(this.dimensions.x, this.dimensions.y);
        // this.lineTo(0, this.dimensions.y);

        // We don't have to modify the y coordinate
        // since we're drawing on the riht side
        // of the line only.
        this.moveTo(coords.x - size / 2, coords.y);
        this.lineTo(coords.x + size / 2, coords.y);
    }


    // Draws at a position in the system
    // relative to a specified center position
    private drawPosition(position: VectorLike, size: number, color: number, center: VectorLike) {
        let pos = Vector.fromVectorLike(position);
        pos.subtract(center); // Get pos relative to center

        // Scale to radar-sized coords
        // relative to the center
        pos.scaleBy(this.radarScale);
        this.drawDot(pos, size, color);

    }

    draw(state: SystemState, center: VectorLike) {
        this.clear();
        for (let shipID in state.ships) {
            let shipState = state.ships[shipID];
            this.drawPosition(shipState.position, 1, 0xffffff, center);
        }

        for (let planetID in state.planets) {
            let planetState = state.planets[planetID];
            this.drawPosition(planetState.position, 2, 0xffffff, center);
        }
    }
}

export { Radar }
