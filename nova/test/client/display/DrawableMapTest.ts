import { DrawableMap } from "novajs/nova/src/client/display/DrawableMap";
import { Position } from "novajs/nova/src/engine/Position";
import { Drawable } from "novajs/nova/src/client/display/Drawable";
import * as PIXI from "pixi.js";

interface TestState {
    foo: string
}

class TestDrawable implements Drawable<TestState> {
    displayObject = new PIXI.Container();
    foo?: string;
    center?: Position;

    draw(state: TestState, center: Position): boolean {
        this.foo = state.foo;
        this.center = center;
        return true;
    }
}


function getDrawableFactory(): [() => TestDrawable, TestDrawable[]] {
    const drawables: TestDrawable[] = [];
    function factory() {
        const drawable = new TestDrawable();
        drawables.push(drawable);
        return drawable;
    }

    return [factory, drawables];
}

describe("AnimationGraphic", function() {
    let drawables: TestDrawable[];
    let factory: () => TestDrawable;

    beforeEach(() => {
        [factory, drawables] = getDrawableFactory();
    });

    it("Should be created", () => {
        const drawableMap = new DrawableMap(factory);
        expect(drawableMap).toBeDefined();
    });

    it("Should create drawables for each UUID", () => {
        const drawableMap = new DrawableMap(factory);
        const states: [string, TestState][] = [
            ["uuid1", { foo: "uuid 1 foo" }],
            ["uuid2", { foo: "uuid 2 foo" }],
            ["uuid3", { foo: "uuid 3 foo" }],
        ];
        drawableMap.draw(states, new Position(0, 0));

        expect(drawables.length).toEqual(3);
        expect(drawables[0].foo).toEqual(states[0][1].foo);
        expect(drawables[1].foo).toEqual(states[1][1].foo);
        expect(drawables[2].foo).toEqual(states[2][1].foo);

        expect(drawableMap.displayObject.children).toEqual([
            drawables[0].displayObject,
            drawables[1].displayObject,
            drawables[2].displayObject,
        ]);
    });

    it("Should delete drawables", () => {
        const drawableMap = new DrawableMap(factory);
        const states: [string, TestState][] = [
            ["uuid1", { foo: "uuid 1 foo" }],
            ["uuid2", { foo: "uuid 2 foo" }],
            ["uuid3", { foo: "uuid 3 foo" }],
        ];
        drawableMap.draw(states, new Position(0, 0));

        const states2: [string, TestState][] = [
            ["uuid1", { foo: "uuid 1 foo 2" }],
            ["uuid3", { foo: "uuid 3 foo 2" }],
        ]
        drawableMap.draw(states2, new Position(0, 0));

        expect(drawableMap.displayObject.children).toEqual([
            drawables[0].displayObject,
            drawables[2].displayObject,
        ]);
    });
});

