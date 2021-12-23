import { GameDataInterface, PreloadData } from "nova_data_interface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "nova_data_interface/NovaDataInterface";
import { Gettable, GettableData } from "nova_data_interface/Gettable";
import { BaseData } from "nova_data_interface/BaseData";
import { ShipData } from "nova_data_interface/ShipData";
import { OutfitData } from "nova_data_interface/OutiftData";
import { WeaponData } from "nova_data_interface/WeaponData";
import { PictData } from "nova_data_interface/PictData";
import { PlanetData } from "nova_data_interface/PlanetData";
import { SystemData } from "nova_data_interface/SystemData";
import { TargetCornersData } from "nova_data_interface/TargetCornersData";
import { SpriteSheetData, SpriteSheetImageData, SpriteSheetFramesData } from "nova_data_interface/SpriteSheetData";
import { StatusBarData } from "nova_data_interface/StatusBarData";
import { ExplosionData } from "nova_data_interface/ExplosionData";
import { PictImageData } from "nova_data_interface/PictImage";
import { getDefaultNovaIDs, NovaIDs } from "nova_data_interface/NovaIDs";
import { Defaults } from "nova_data_interface/Defaults";
import { CicnImageData } from "nova_data_interface/CicnImage";
import { CicnData } from "nova_data_interface/CicnData";
import { SoundFile } from "nova_data_interface/SoundFile";

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
                        errors.push(String(e));
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
        const systems = this.preloadResource(NovaDataType.System);
        preloadData.Outfit = await outfit;
        preloadData.Ship = await ships;
        preloadData.System = await systems;
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

