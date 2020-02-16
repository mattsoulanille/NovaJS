import { GameDataInterface } from "./GameDataInterface";
import { Gettable } from "./Gettable";
import { NovaDataInterface } from "./NovaDataInterface";
import { NovaIDs } from "./NovaIDs";
import { DefaultExplosionData } from "./ExplosionData";
import { DefaultOutfitData } from "./OutiftData";
import { DefaultPictData } from "./PictData";
import { DefaultPictImageData } from "./PictImage";
import { DefaultPlanetData } from "./PlanetData";
import { DefaultShipData } from "./ShipData";
import { DefaultSpriteSheetData, DefaultSpriteSheetFrames } from "./SpriteSheetData";
import { DefaultStatusBarData } from "./StatusBarData";
import { DefaultSystemData } from "./SystemData";
import { DefaultTargetCornersData } from "./TargetCornersData";
import { DefaultNotBayWeaponData, DefaultProjectileWeaponData } from "./WeaponData";

// TODO: Make gettable an interface so you
// don't have to do this awkward extension
class MockGettable<T> extends Gettable<T> {
    map = new Map<string, T>();
    getIds(): string[] {
        return [...this.map.keys()];
    }
    constructor(public defaultValue?: T) {
        super((_id: string) => null as any as Promise<T>);
    }

    async get(id: string): Promise<T> {
        const val = this.map.get(id);
        if (val !== undefined) {
            return val;
        }
        else if (this.defaultValue !== undefined) {
            return this.defaultValue;
        }
        else {
            throw new Error(`id ${id} not found`);
        }
    }
}

type ExtractGettableType<T> = T extends Gettable<infer T> ? T : never;

type MockNovaDataInterface = {
    [P in keyof NovaDataInterface]: MockGettable<ExtractGettableType<NovaDataInterface[P]>>
}

export class MockGameData implements GameDataInterface {
    data: MockNovaDataInterface = {
        Explosion: new MockGettable(DefaultExplosionData),
        Outfit: new MockGettable(DefaultOutfitData),
        Pict: new MockGettable(DefaultPictData),
        PictImage: new MockGettable(new Uint8Array(0) as Buffer),
        Planet: new MockGettable(DefaultPlanetData),
        Ship: new MockGettable(DefaultShipData),
        SpriteSheet: new MockGettable(DefaultSpriteSheetData),
        SpriteSheetFrames: new MockGettable(DefaultSpriteSheetFrames),
        SpriteSheetImage: new MockGettable(new Uint8Array(0) as Buffer),
        StatusBar: new MockGettable(DefaultStatusBarData),
        System: new MockGettable(DefaultSystemData),
        TargetCorners: new MockGettable(DefaultTargetCornersData),
        Weapon: new MockGettable(DefaultProjectileWeaponData),
    };
    get ids(): Promise<NovaIDs> {
        const ids: NovaIDs = {} as NovaIDs;
        for (const [key, val] of Object.entries(this.data)) {
            ids[key as keyof NovaDataInterface] = (val as MockGettable<unknown>).getIds();
        }

        return Promise.resolve<NovaIDs>(ids);
    }
}
