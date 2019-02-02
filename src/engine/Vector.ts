
class Vector {

    readonly x: number
    readonly y: number

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    static add(v1: Vector, v2: Vector) {
        return new Vector(v1.x + v2.x, v1.y + v2.y);
    }

    static rotate(vec: Vector, radians: number) {
        var cos = Math.cos(radians);
        var sin = Math.sin(radians);
        return new Vector(
            cos * vec.x - sin * vec.y,
            sin * vec.x + cos * vec.y
        );
    }

    toJSON(): string {
        return JSON.stringify({ x: this.x, y: this.y });
    }
}

export { Vector }
