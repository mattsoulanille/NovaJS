import { Gettable } from "./Gettable";
import { BaseData } from "./BaseData";
import { ShipData } from "./ShipData";
import { OutfitData } from "./OutiftData";
import { ExplosionData } from "./ExplosionData";
import { WeaponData } from "./WeaponData";
import { PictData } from "./PictData";
import { PlanetData } from "./PlanetData";
import { SystemData } from "./SystemData";
import { TargetCornersData } from "./TargetCornersData";
import { SpriteSheetData, SpriteSheetImageData, SpriteSheetFramesData } from "./SpriteSheetData";
import { StatusBarData } from "./StatusBarData";
import { PictImageData } from "./PictImage";

enum NovaDataType {
    Ship = "Ship",
    Outfit = "Outfit",
    Weapon = "Weapon",
    Pict = "Pict",
    Planet = "Planet",
    System = "System",
    TargetCorners = "TargetCorners",
    SpriteSheet = "SpriteSheet",
    SpriteSheetImage = "SpriteSheetImage",
    SpriteSheetFrames = "SpriteSheetFrames",
    StatusBar = "StatusBar",
    Explosion = "Explosion"
};


// index: NovaDataType
type NovaDataInterface = {
    Ship: Gettable<ShipData>,
    Outfit: Gettable<OutfitData>,
    Weapon: Gettable<WeaponData>,
    Pict: Gettable<PictData>,
    PictImage: Gettable<PictImageData>,
    Planet: Gettable<PlanetData>,
    System: Gettable<SystemData>,
    TargetCorners: Gettable<TargetCornersData>,
    SpriteSheet: Gettable<SpriteSheetData>,
    SpriteSheetImage: Gettable<SpriteSheetImageData>,
    SpriteSheetFrames: Gettable<SpriteSheetFramesData>,
    StatusBar: Gettable<StatusBarData>,
    Explosion: Gettable<ExplosionData>

}
class NovaIDNotFoundError extends Error { };

export { NovaDataInterface, NovaDataType, NovaIDNotFoundError };
