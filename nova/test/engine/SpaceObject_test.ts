import "jasmine";
import { SpaceObject } from "novajs/nova/src/engine/SpaceObject";
import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
import { VectorState } from "novajs/nova/src/proto/vector_state_pb";


describe("SpaceObject", function() {

    it("should be instantiated", () => {
        const spaceObject = new SpaceObject();
        expect(spaceObject).toBeDefined();
    });

    it("setState sets the state and getState gets it", () => {
        const testState = new SpaceObjectState();

        const position = new VectorState();
        position.setX(500);
        position.setY(600);
        testState.setPosition(position);

        const velocity = new VectorState();
        velocity.setX(20);
        velocity.setY(-30);
        testState.setVelocity(velocity);

        testState.setRotation(3);
        testState.setAcceleration(120);
        testState.setAccelerating(2);
        testState.setMaxvelocity(2500);
        testState.setMovementtype(SpaceObjectState.MovementType.INERTIAL);
        testState.setTurnback(false);
        testState.setTurning(8);
        testState.setTurnrate(200);

        const spaceObject = new SpaceObject();
        spaceObject.setState(testState);
        expect(spaceObject.getState().toObject())
            .toEqual(testState.toObject());
    });

    it("computes new positions from velocity", () => {
        const testState = new SpaceObjectState();

        const position = new VectorState();
        position.setX(500);
        position.setY(600);
        testState.setPosition(position);

        const velocity = new VectorState();
        velocity.setX(20);
        velocity.setY(-30);
        testState.setVelocity(velocity);

        testState.setMaxvelocity(1000);

        const spaceObject = new SpaceObject(testState);
        // Step a full second
        spaceObject.step(1000);

        const expectedState = new SpaceObjectState();
        const expectedPos = new VectorState();
        expectedPos.setX(520);
        expectedPos.setY(570);
        expectedState.setPosition(expectedPos);

        expectedState.setVelocity(velocity);
        expectedState.setMaxvelocity(1000);

        expect(spaceObject.getState().toObject())
            .toEqual(expectedState.toObject());
    });

    it("computes new velocity from acceleration", () => {
        const testState = new SpaceObjectState();

        const velocity = new VectorState();
        velocity.setX(20);
        velocity.setY(-30);
        testState.setVelocity(velocity);

        testState.setMaxvelocity(1000);
        testState.setAcceleration(100);
        testState.setAccelerating(0.75);
        const angle = Math.PI / 3; // 60 Deg
        testState.setRotation(angle);

        const spaceObject = new SpaceObject(testState);
        // Step a full second
        spaceObject.step(1000);

        const newState = spaceObject.getState();
        const newVelocity = newState.getVelocity();


        // Y inverted clock angles. See Vector.ts
        expect(newVelocity!.getX())
            .toBeCloseTo(20 + 75 * Math.sin(angle));
        expect(newVelocity!.getY())
            .toBeCloseTo(-30 + 75 * -Math.cos(angle));
    });

    it("computes turn angle when turning", () => {
        const testState = new SpaceObjectState();
        testState.setRotation(2);
        testState.setTurnrate(12);
        testState.setTurning(0.5);

        const spaceObject = new SpaceObject(testState);
        // Step a full second
        spaceObject.step(1000);

        const newState = spaceObject.getState();
        const newRotation = newState.getRotation();
        expect(newRotation).toEqual((2 + 12 * 0.5) % (2 * Math.PI));
    });

    it("stops at the opposite velocity vector when turning back", () => {
        const testState = new SpaceObjectState();

        const velocity = new VectorState();
        const angle = 2;
        // Inverted y clock angles. See Vector.ts
        velocity.setX(10 * Math.sin(angle));
        velocity.setY(10 * -Math.cos(angle));
        testState.setVelocity(velocity);
        testState.setMaxvelocity(1000);
        testState.setTurnrate(1);
        testState.setTurnback(true);

        const spaceObject = new SpaceObject(testState);
        // Step ten seconds, enough time to turn back.
        spaceObject.step(1e4);

        const newState = spaceObject.getState();
        const newRotation = newState.getRotation();
        expect(newRotation).toEqual(angle + Math.PI);
    });

    it("turns left if its the shortest path when turning back", () => {
        const testState = new SpaceObjectState();

        const velocity = new VectorState();
        const angle = 1; // Turns away from this angle
        // Inverted y clock angles. See Vector.ts
        velocity.setX(10 * Math.sin(angle));
        velocity.setY(10 * -Math.cos(angle));
        testState.setVelocity(velocity);
        testState.setMaxvelocity(1000);
        testState.setRotation(6);
        testState.setTurnrate(1);
        testState.setTurnback(true);

        const spaceObject = new SpaceObject(testState);
        // Step one second
        spaceObject.step(1e3);

        const newState = spaceObject.getState();
        const newRotation = newState.getRotation();
        expect(newRotation).toEqual(5);
    });

    it("turns right if its the shortest path when turning back", () => {
        const testState = new SpaceObjectState();

        const velocity = new VectorState();
        const angle = 3; // Turns away from this angle
        // Inverted y clock angles. See Vector.ts
        velocity.setX(10 * Math.sin(angle));
        velocity.setY(10 * -Math.cos(angle));
        testState.setVelocity(velocity);
        testState.setMaxvelocity(1000);
        testState.setRotation(4);
        testState.setTurnrate(1);
        testState.setTurnback(true);

        const spaceObject = new SpaceObject(testState);
        // Step one second
        spaceObject.step(1e3);

        const newState = spaceObject.getState();
        const newRotation = newState.getRotation();
        expect(newRotation).toEqual(5);
    });
});
