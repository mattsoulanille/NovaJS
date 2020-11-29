import produce from "immer";
import "jasmine";
import { Position, BOUNDARY } from "novajs/nova/src/engine/Position";

describe("Position", () => {
    it("can be drafted with immer", () => {
        const pos1 = new Position(1, 2);
        const pos2 = produce(pos1, draft => {
            draft.x = 4;
            draft.y = 5;
        });
        expect(pos1.x).toEqual(1);
        expect(pos1.y).toEqual(2);

        expect(pos2.x).toEqual(4);
        expect(pos2.y).toEqual(5);
    });

    it("wraps position when setting", () => {
        const pos = new Position(0, 0);
        pos.x = 15000;
        expect(pos.x).toEqual(-5000);
    });
});