import { Gettable } from "./Gettable";
import { BaseData } from "./BaseData";


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
    StatusBar,
    Explosion
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


// index: NovaDataType
interface NovaDataInterface { [index: number]: Gettable<BaseData> }
class NovaIDNotFoundError extends Error { };

export { NovaDataInterface, NovaDataType, NovaIDNotFoundError };
