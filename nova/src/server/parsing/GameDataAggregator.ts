import { GameDataInterface, PreloadData } from "novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novadatainterface/NovaDataInterface";
import { Gettable, GettableData } from "novadatainterface/Gettable";
import { BaseData } from "novadatainterface/BaseData";
import { ShipData } from "novadatainterface/ShipData";
import { OutfitData } from "novadatainterface/OutiftData";
import { WeaponData } from "novadatainterface/WeaponData";
import { PictData } from "novadatainterface/PictData";
import { PlanetData } from "novadatainterface/PlanetData";
import { SystemData } from "novadatainterface/SystemData";
import { TargetCornersData } from "novadatainterface/TargetCornersData";
import { SpriteSheetData, SpriteSheetImageData, SpriteSheetFramesData } from "novadatainterface/SpriteSheetData";
import { StatusBarData } from "novadatainterface/StatusBarData";
import { ExplosionData } from "novadatainterface/ExplosionData";
import { PictImageData } from "novadatainterface/PictImage";
import { getDefaultNovaIDs, NovaIDs } from "novadatainterface/NovaIDs";
import { Defaults } from "novadatainterface/Defaults";
import { CicnImageData } from "novadatainterface/CicnImage";
import { CicnData } from "novadatainterface/CicnData";
import { SoundFile } from "novadatainterface/SoundFile";

/**
 * Combines multiple GameDataInterface instances into a single GameDataInterface
 * with access to all of their data.
 */
class GameDataAggregator implements GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
    readonly preloadData: Promise<PreloadData>;
    private dataSources: Array<GameDataInterface>;
    private warningReporter: (w: string) => void;

    constructor(dataSources: Array<GameDataInterface>, warningReporter = console.log) {
        this.dataSources = dataSources;
        this.warningReporter = warningReporter;

        // Is there a better way?
        this.data = {
            Ship: this.makeAggregator<ShipData>(NovaDataType.Ship),
            Outfit: this.makeAggregator<OutfitData>(NovaDataType.Outfit),
            Weapon: this.makeAggregator<WeaponData>(NovaDataType.Weapon),
            Pict: this.makeAggregator<PictData>(NovaDataType.Pict),
            PictImage: this.makeAggregator<PictImageData>(NovaDataType.PictImage),
            Cicn: this.makeAggregator<CicnData>(NovaDataType.Cicn),
            CicnImage: this.makeAggregator<CicnImageData>(NovaDataType.CicnImage),
            Planet: this.makeAggregator<PlanetData>(NovaDataType.Planet),
            System: this.makeAggregator<SystemData>(NovaDataType.System),
            TargetCorners: this.makeAggregator<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.makeAggregator<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.makeAggregator<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.makeAggregator<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.makeAggregator<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.makeAggregator<ExplosionData>(NovaDataType.Explosion),
            SoundFile: this.makeAggregator<SoundFile>(NovaDataType.SoundFile),
        };

        this.ids = this.getAllIDs();

        this.preloadData = this.getPreloadData();
    }

    getDataSources() {
        return this.dataSources;
    }

    private makeAggregator<T extends (BaseData | ArrayBuffer | SpriteSheetFramesData)>(dataType: NovaDataType): Gettable<T> {
        // Arrow functions automatically bind this
        return new Gettable<T>(async (id: string): Promise<T> => {
            var errors: Array<string> = [];

            for (var i in this.getDataSources()) {
                var dataSource: GameDataInterface = this.dataSources[i];
                try {
                    return <T>await dataSource.data[dataType].get(id);
                }
                catch (e) {
                    if (e instanceof Error) {
                        if (e.stack) {
                            errors.push(e.stack);
                        }
                    }
                    else {
                        errors.push(e.toString());
                    }
                }
            }

            this.warningReporter(id + " not found under " + dataType + ". Using default instead. "
                + "\nStacktraces:\n"
                + errors.join("\n"));

            return <T>Defaults[dataType];
        });
    }

    private async getAllIDs(): Promise<NovaIDs> {
        const IDs = getDefaultNovaIDs();

        for (let i in this.dataSources) {
            var dataSource = this.dataSources[i];
            var newIDs = await dataSource.ids;
            for (let dataType in newIDs) {
                IDs[<NovaDataType>dataType] = [...IDs[<NovaDataType>dataType], ...newIDs[<NovaDataType>dataType]];
            }
        }
        return IDs;
    }

    private async getPreloadData() {
        const preloadDataList = (await Promise.all(this.dataSources.map(d => d.preloadData)))
            .filter((d: PreloadData | undefined): d is PreloadData => Boolean(d));

        const preloadData: PreloadData = {};
        for (const entry of preloadDataList) {
            for (const [uncastKey, dataMap] of Object.entries(entry)) {
                const key = uncastKey as keyof typeof entry;
                if (!preloadData[key]) {
                    preloadData[key] = {};
                }
                const fullMap = preloadData[key]!;
                for (const [id, val] of Object.entries(dataMap)) {
                    fullMap[id] = val;
                }
            }
        }

        const outfit = this.preloadResource(NovaDataType.Outfit);
        const ships = this.preloadResource(NovaDataType.Ship);
        preloadData.Outfit = await outfit;
        preloadData.Ship = await ships;
        return preloadData;
    }

    private async preloadResource<Data extends NovaDataType>(dataType: Data) {
        const allIds = await this.ids;
        const ids = allIds[dataType];

        const loaded = await Promise.all(ids.map(async (id) => {
            const data = await this.data[dataType].get(id);
            return [id, data];
        }));
        return Object.fromEntries(loaded) as {
            [index: string]: GettableData<NovaDataInterface[Data]>
        };
    }
}

export { GameDataAggregator };

