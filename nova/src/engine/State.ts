import { Draft } from "immer";
import { Position } from "./Position";
import { Angle, Vector } from "./Vector";

export type Step<T> = ({ state, delta }: { state: Draft<T>, delta: number }) => void;

export interface EngineState {
    systems: Map<string, System>;
}

export interface System {
    spaceObjects: Map<string, SpaceObject>;
}

export enum ObjectType {
    NONE,
    SHIP,
    PLANET,
    PROJECTILE,
    ASTEROID,
}

export interface SpaceObject {
    id: string; // The resource ID
    objectType: ObjectType;

    // Physics
    position: Position;
    velocity: Vector;
    maxVelocity: number;
    rotation: Angle;
    turning: number;
    turnBack: boolean;
    turnRate: number;
    movementType: MovementType;
    acceleration: number;
    accelerating: number;

    // Combat
    shield: number;
    maxShield: number;
    shieldRecharge: number;
    armor: number;
    maxArmor: number;
    armorRecharge: number;
    ionization: number;
    maxIonization: number;
    deionize: number;

    // Graphics

}

export enum MovementType {
    INERTIAL = 0,
    INERTIALESS = 1,
    STATIONARY = 2,
}

export function vectorFactory(): Vector {
    return new Vector(0, 0);
}

