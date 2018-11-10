import { Gettable } from "../../common/Gettable";

import { BaseResource } from "./BaseResource";
import { ShipResource } from "./ShipResource";



// const NovaDataTypes = [
//     ShipResource
// ];

enum NovaDataType {
    Ship,
    Outfit,
    Weapon,
    Pict,
    Planet,
    System,
    TargetCorner,
    SpriteSheet,
    SpriteSheetImage,
    SpriteSheetFrames,
    StatusBar
};



// var NovaDataInterface = {};
// NovaDataInterface[NovaDataType.Ship];

// interface NovaDataInterface {
//     g: (n: NovaDataType) => Gettable<BaseResource>
// }


// type NovaDataInterface = {
//     Ship: Gettable<ShipResource>,
//     Outfit: Gettable<BaseResource>,
//     Weapon: Gettable<BaseResource>,
//     Pict: Gettable<BaseResource>,
//     Planet: Gettable<BaseResource>,
//     System: Gettable<BaseResource>,
//     TargetCorner: Gettable<BaseResource>,
//     SpriteSheet: Gettable<BaseResource>,
//     SpriteSheetImage: Gettable<BaseResource>,
//     SpriteSheetFrames: Gettable<BaseResource>,
//     StatusBar: Gettable<BaseResource>
// };

interface NovaDataInterface { [index: string]: Gettable<BaseResource> }

export { NovaDataInterface, NovaDataType };
