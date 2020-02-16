import { fail } from "assert";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import "mocha";
import { PersistentDrawer } from "../../../src/client/display/PersistentDrawer";
import { Drawable } from "../../../src/client/display/Drawable";
import { Position } from "../../../src/engine/Position";

before(function() {
    chai.should();
    chai.use(chaiAsPromised);
});


class TestDrawable implements Drawable<string> {
    displayObject: PIXI.DisplayObject = new PIXI.Container();
    val: string = "default";
    center: Position = new Position(0, 0);

    drawSuccess = true;

    draw(state: string, center: Position): boolean {
        if (this.drawSuccess) {
            this.val = state;
            this.center = center;
            return true;
        }
        else {
            return false;
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((fulfill) => {
        setTimeout(fulfill, ms);
    });
}

let count = 0;
async function buildFunction() {
    await sleep(50);
    count += 1;
    //    return new NumberHolder(count);
}

describe("PersistentDrawer", function() {

    this.beforeEach(() => {
        count = 0;
    });

    it("Should do stuff", async function() {

    })
});

