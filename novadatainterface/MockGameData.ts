import { getDefaultExplosionData } from "./ExplosionData";
import { GameDataInterface } from "./GameDataInterface";
import { Gettable } from "./Gettable";
import { NovaDataInterface } from "./NovaDataInterface";
import { NovaIDs } from "./NovaIDs";
import { getDefaultOutfitData } from "./OutiftData";
import { getDefaultPictData } from "./PictData";
import { getDefaultPlanetData } from "./PlanetData";
import { getDefaultShipData } from "./ShipData";
import { getDefaultSpriteSheetData, getDefaultSpriteSheetFrames } from "./SpriteSheetData";
import { getDefaultStatusBarData } from "./StatusBarData";
import { getDefaultSystemData } from "./SystemData";
import { getDefaultTargetCornersData } from "./TargetCornersData";
import { getDefaultProjectileWeaponData } from "./WeaponData";

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
        Explosion: new MockGettable(getDefaultExplosionData()),
        Outfit: new MockGettable(getDefaultOutfitData()),
        Pict: new MockGettable(getDefaultPictData()),
        PictImage: new MockGettable(new Uint8Array(0) as Buffer),
        Planet: new MockGettable(getDefaultPlanetData()),
        Ship: new MockGettable(getDefaultShipData()),
        SpriteSheet: new MockGettable(getDefaultSpriteSheetData()),
        SpriteSheetFrames: new MockGettable(getDefaultSpriteSheetFrames()),
        SpriteSheetImage: new MockGettable(new Uint8Array(0) as Buffer),
        StatusBar: new MockGettable(getDefaultStatusBarData()),
        System: new MockGettable(getDefaultSystemData()),
        TargetCorners: new MockGettable(getDefaultTargetCornersData()),
        Weapon: new MockGettable(getDefaultProjectileWeaponData()),
    };
    get ids(): Promise<NovaIDs> {
        const ids: NovaIDs = {} as NovaIDs;
        for (const [key, val] of Object.entries(this.data)) {
            ids[key as keyof NovaDataInterface] = (val as MockGettable<unknown>).getIds();
        }

        return Promise.resolve<NovaIDs>(ids);
    }
}
