import { getDefaultShipData } from "./ShipData";
import { getDefaultOutfitData } from "./OutiftData";
import { getDefaultProjectileWeaponData } from "./WeaponData";
import { getDefaultPictData } from "./PictData";
import { getDefaultPictImageData } from "./PictImage";
import { getDefaultPlanetData } from "./PlanetData";
import { getDefaultSystemData } from "./SystemData";
import { getDefaultTargetCornersData } from "./TargetCornersData";
import { getDefaultSpriteSheetData, getDefaultSpriteSheetFrames } from "./SpriteSheetData";
import { getDefaultSpriteSheetImage } from "./DefaultSpriteSheetImage";
import { getDefaultStatusBarData } from "./StatusBarData";
import { getDefaultExplosionData } from "./ExplosionData";

// Should have one for every NovaDataType
export const Defaults = {
    get Ship() { return getDefaultShipData() },
    get Outfit() { return getDefaultOutfitData() },
    get Weapon() { return getDefaultProjectileWeaponData() },
    get Pict() { return getDefaultPictData() },
    get PictImage() { return getDefaultPictImageData() },
    get Planet() { return getDefaultPlanetData() },
    get System() { return getDefaultSystemData() },
    get TargetCorners() { return getDefaultTargetCornersData() },
    get SpriteSheet() { return getDefaultSpriteSheetData() },
    get SpriteSheetImage() { return getDefaultSpriteSheetImage() },
    get SpriteSheetFrames() { return getDefaultSpriteSheetFrames() },
    get StatusBar() { return getDefaultStatusBarData() },
    get Explosion() { return getDefaultExplosionData() }
};
