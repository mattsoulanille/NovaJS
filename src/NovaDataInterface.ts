import { Gettable } from "./Gettable";
import { BaseData } from "./BaseData";
import { ShipData } from "./ShipData";


// const NovaDataTypes = [
//     ShipResource
// ];

enum NovaDataType {
    Ship = "Ship",
    Outfit = "Outfit",
    Weapon = "Weapon",
    Pict = "Pict",
    Planet = "Planet",
    System = "System",
    TargetCorner = "TargetCorner",
    SpriteSheet = "SpriteSheet",
    SpriteSheetImage = "SpriteSheetImage",
    SpriteSheetFrames = "SpriteSheetFrames",
    StatusBar = "StatusBar",
    Explosion = "Explosion"
};


// index: NovaDataType
type NovaDataInterface = {
    [index: string]: Gettable<BaseData>,
    Ship: Gettable<ShipData>
}
class NovaIDNotFoundError extends Error { };

export { NovaDataInterface, NovaDataType, NovaIDNotFoundError };
