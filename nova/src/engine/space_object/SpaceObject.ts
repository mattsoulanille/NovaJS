import { StepState } from "../Stateful";
//import { StateSpreader } from "../StateSpreader";
import { stateSpreader } from "../StateSpreader";
import { spaceObjectViewFactory, SpaceObjectView } from "../TreeView";
import { movement } from "./Movement";
import { planet } from "./Planet";
import { ship } from "./Ship";
//import { SpaceObjectState } from "novajs/nova/src/proto/space_object_state_pb";
//export class SpaceObject extends StateSpreader<SpaceObjectView> { }


const shipNextState = stateSpreader([
    ship,
    movement
], spaceObjectViewFactory)

const planetNextState = stateSpreader([
    planet
], spaceObjectViewFactory);

export const spaceObject: StepState<SpaceObjectView> = function(args) {
    if (args.state.sharedData.shipState) {
        return shipNextState(args);
    } else if (args.state.sharedData.planetState) {
        return planetNextState(args);
    } else {
        throw new Error(`Unknown spaceObject type.`);
    }
}

