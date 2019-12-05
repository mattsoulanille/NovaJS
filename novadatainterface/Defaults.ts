import { DefaultShipData } from "./ShipData";
import { DefaultOutfitData } from "./OutiftData";
import { DefaultProjectileWeaponData } from "./WeaponData";
import { DefaultPictData } from "./PictData";
import { DefaultPictImageData } from "./PictImage";
import { DefaultPlanetData } from "./PlanetData";
import { DefaultSystemData } from "./SystemData";
import { DefaultTargetCornersData } from "./TargetCornersData";
import { DefaultSpriteSheetData, DefaultSpriteSheetImage, DefaultSpriteSheetFrames } from "./SpriteSheetData";
import { DefaultStatusBarData } from "./StatusBarData";
import { DefaultExplosionData } from "./ExplosionData";

// Should have one for every NovaDataType
const Defaults = {
    Ship: DefaultShipData,
    Outfit: DefaultOutfitData,
    Weapon: DefaultProjectileWeaponData,
    Pict: DefaultPictData,
    PictImage: DefaultPictImageData,
    Planet: DefaultPlanetData,
    System: DefaultSystemData,
    TargetCorners: DefaultTargetCornersData,
    SpriteSheet: DefaultSpriteSheetData,
    SpriteSheetImage: DefaultSpriteSheetImage,
    SpriteSheetFrames: DefaultSpriteSheetFrames,
    StatusBar: DefaultStatusBarData,
    Explosion: DefaultExplosionData
};

export { Defaults }
