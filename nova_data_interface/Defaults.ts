import { getDefaultCicnData } from "./CicnData";
import { getDefaultCicnImageData } from "./CicnImage";
import { getDefaultSpriteSheetImage } from "./DefaultSpriteSheetImage";
import { getDefaultExplosionData } from "./ExplosionData";
import { getDefaultOutfitData } from "./OutiftData";
import { getDefaultPictData } from "./PictData";
import { getDefaultPictImageData } from "./PictImage";
import { getDefaultPlanetData } from "./PlanetData";
import { getDefaultShipData } from "./ShipData";
import { getDefaultSoundFile } from "./SoundFile";
import { getDefaultSpriteSheetData, getDefaultSpriteSheetFrames } from "./SpriteSheetData";
import { getDefaultStatusBarData } from "./StatusBarData";
import { getDefaultSystemData } from "./SystemData";
import { getDefaultTargetCornersData } from "./TargetCornersData";
import { getDefaultProjectileWeaponData } from "./WeaponData";

// Should have one for every NovaDataType
export const Defaults = {
    get Ship() { return getDefaultShipData() },
    get Outfit() { return getDefaultOutfitData() },
    get Weapon() { return getDefaultProjectileWeaponData() },
    get Pict() { return getDefaultPictData() },
    get PictImage() { return getDefaultPictImageData() },
    get Cicn() { return getDefaultCicnData() },
    get CicnImage() { return getDefaultCicnImageData() },
    get Planet() { return getDefaultPlanetData() },
    get System() { return getDefaultSystemData() },
    get TargetCorners() { return getDefaultTargetCornersData() },
    get SpriteSheet() { return getDefaultSpriteSheetData() },
    get SpriteSheetImage() { return getDefaultSpriteSheetImage() },
    get SpriteSheetFrames() { return getDefaultSpriteSheetFrames() },
    get StatusBar() { return getDefaultStatusBarData() },
    get Explosion() { return getDefaultExplosionData() },
    get SoundFile() { return getDefaultSoundFile() },
}
