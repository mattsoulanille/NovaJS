import { NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { ShipData } from "novajs/novadatainterface/ShipData";
import { EngineMod } from "./EngineMod";
import { MovementMod, MovementType } from "./MovementMod";
import { StateTreeDeclaration } from "./StateTree";

function movementModFactory(shipData: ShipData) {
    return new MovementMod({
        acceleration: shipData.physics.acceleration,
        maxVelocity: shipData.physics.speed,
        // TODO: Parse movement type
        movementType: MovementType.INERTIAL,
        turnRate: shipData.physics.turnRate,
    });
}

export const shipTree: StateTreeDeclaration<NovaDataType.Ship> = {
    name: 'Ship',
    dataType: NovaDataType.Ship,
    mods: new Set([movementModFactory]),
}

export const shipMod: EngineMod = {
    stateTreeDeclarations: [shipTree]
}
