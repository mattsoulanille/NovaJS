
// type ControlEvent =
//     "accelerate" |
//     "reverse" |
//     "turnLeft" |
//     "turnRight" |
//     "pointTo" |
//     "afterburner" |
//     "firePrimary" |
//     "fireSecondary" |
//     "cycleTarget" |
//     "nearestTarget" |
//     "cycleSecondary" |
//     "resetSecondary" |
//     "land" |
//     "depart" |
//     "map" |
//     "hyperjump";


// const ControlEventList: ControlEvent[] = [
//     "accelerate",
//     "reverse",
//     "turnLeft",
//     "turnRight",
//     "pointTo",
//     "afterburner",
//     "firePrimary",
//     "fireSecondary",
//     "cycleTarget",
//     "nearestTarget",
//     "cycleSecondary",
//     "resetSecondary",
//     "land",
//     "depart",
//     "map",
//     "hyperjump",
// ];
import { $enum } from "ts-enum-util";

enum ControlEvent {
    fullscreen = "fullscreen",
    accelerate = "accelerate",
    reverse = "reverse",
    turnLeft = "turnLeft",
    turnRight = "turnRight",
    pointTo = "pointTo",
    afterburner = "afterburner",
    firePrimary = "firePrimary",
    fireSecondary = "fireSecondary",
    cycleTarget = "cycleTarget",
    nearestTarget = "nearestTarget",
    cycleSecondary = "cycleSecondary",
    resetSecondary = "resetSecondary",
    land = "land",
    depart = "depart",
    map = "map",
    smallMap = "smallMap",
    resetNav = "resetNav",
    board = "board",
    hyperjump = "hyperjump",
    formation = "formation",
    defend = "defend",
    escorts = "escorts",
    attack = "attack",
    holdPosition = "holdPosition",
    missions = "missions",
    properties = "properties",
    hail = "hail",
    up = "up",
    down = "down",
    left = "left",
    right = "right",
    buy = "buy",
    sell = "sell",
    bar = "bar",
    missionBBS = "missionBBS",
    outfitter = "outfitter",
    shipyard = "shipyard",
    tradeCenter = "tradeCenter",
}

type ControlEventInfo = {
    keyDown: boolean, // Corresponds to the keyDown event
    keyRepeat: boolean,
    keyPressed: boolean // The state of the key (pressed or not)
}


type ControlState = { [index in ControlEvent]: ControlEventInfo };

interface Controller {
    poll(): ControlState
}

function makeControlEventInfo(): ControlEventInfo {
    return {
        keyDown: false,
        keyRepeat: false,
        keyPressed: false,
    }
}

function makeControlState(): ControlState {
    var output: { [index in ControlEvent]?: ControlEventInfo } = {};

    for (let val of $enum(ControlEvent).getValues()) {
        output[val] = makeControlEventInfo();
    }
    return output as ControlState;
}

export { Controller, ControlState, ControlEventInfo, ControlEvent, makeControlState }
