import { ISpaceObjectState } from "novajs/nova/src/proto/protobufjs_bundle";
//import { StateSpreader } from "../StateSpreader";
import { SpaceObjectView } from "../TreeView";
import { stateSpreader } from "../StateSpreader";
import { GetNextState } from "../Stateful";
import { ship } from "./Ship";
import { movement } from "./Movement";
import { planet } from "./Planet";
//import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";




//export class SpaceObject extends StateSpreader<SpaceObjectView> { }

const newSpaceObjectView = () => new SpaceObjectView();

const shipNextState = stateSpreader([
    ship,
    movement
], newSpaceObjectView)

const planetNextState = stateSpreader([
    planet
], newSpaceObjectView);

export const spaceObject: GetNextState<SpaceObjectView> = function(args) {
    if (args.state.protobuf.shipState) {
        return shipNextState(args);
    } else if (args.state.protobuf.planetState) {
        return planetNextState(args);
    } else {
        throw new Error(`Unknown spaceObject type.`);
    }
}

