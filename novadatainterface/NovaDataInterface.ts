import { ExplosionData } from "./ExplosionData";
import { Gettable } from "./Gettable";
import { OutfitData } from "./OutiftData";
import { PictData } from "./PictData";
import { PictImageData } from "./PictImage";
import { PlanetData } from "./PlanetData";
import { ShipData } from "./ShipData";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "./SpriteSheetData";
import { StatusBarData } from "./StatusBarData";
import { SystemData } from "./SystemData";
import { TargetCornersData } from "./TargetCornersData";
import { WeaponData } from "./WeaponData";

enum NovaDataType {
    Ship = "Ship",
    Outfit = "Outfit",
    Weapon = "Weapon",
    Pict = "Pict",
    PictImage = "PictImage",
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
