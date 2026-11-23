import { NovaDataType } from "./nova_data_interface.js";

export type NovaIDs = {
    [index in NovaDataType]: Array<string>
}

export function getDefaultNovaIDs(): NovaIDs {
    return {
        Asteroid: [],
        Explosion: [],
        Outfit: [],
        Pict: [],
        PictImage: [],
        Cicn: [],
        CicnImage: [],
        PpatImage: [],
        Rank: [],
        Planet: [],
        Ship: [],
        SpriteSheet: [],
        SpriteSheetFrames: [],
        SpriteSheetImage: [],
        StatusBar: [],
        System: [],
        Govt: [],
        Dude: [],
        Fleet: [],
        Junk: [],
        Oops: [],
        Mission: [],
        Pers: [],
        Cron: [],
        PlayerStart: [],
        TargetCorners: [],
        Weapon: [],
        SoundFile: [],
        StringTable: [],
        Description: [],
        InterfaceColors: [],
    }
}
