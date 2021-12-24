import { NovaDataType } from "./NovaDataInterface";

export type NovaIDs = {
    [index in NovaDataType]: Array<string>
}

export function getDefaultNovaIDs(): NovaIDs {
    return {
        Explosion: [],
        Outfit: [],
        Pict: [],
        PictImage: [],
        Cicn: [],
        CicnImage: [],
        Planet: [],
        Ship: [],
        SpriteSheet: [],
        SpriteSheetFrames: [],
        SpriteSheetImage: [],
        StatusBar: [],
        System: [],
        TargetCorners: [],
        Weapon: [],
        SoundFile: [],
    }
}
