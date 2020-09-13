import { GameDataInterface } from "novajs/novadatainterface/GameDataInterface";
import { NovaDataInterface, NovaDataType } from "novajs/novadatainterface/NovaDataInterface";
import { Gettable } from "novajs/novadatainterface/Gettable";
import { BaseData } from "novajs/novadatainterface/BaseData";
import { ShipData } from "novajs/novadatainterface/ShipData";
import { OutfitData } from "novajs/novadatainterface/OutiftData";
import { WeaponData } from "novajs/novadatainterface/WeaponData";
import { PictData } from "novajs/novadatainterface/PictData";
import { PlanetData } from "novajs/novadatainterface/PlanetData";
import { SystemData } from "novajs/novadatainterface/SystemData";
import { TargetCornersData } from "novajs/novadatainterface/TargetCornersData";
import { SpriteSheetData, SpriteSheetImageData, SpriteSheetFramesData } from "novajs/novadatainterface/SpriteSheetData";
import { StatusBarData } from "novajs/novadatainterface/StatusBarData";
import { ExplosionData } from "novajs/novadatainterface/ExplosionData";
import { PictImageData } from "novajs/novadatainterface/PictImage";
import { NovaIDs } from "novajs/novadatainterface/NovaIDs";
import { Defaults } from "novajs/novadatainterface/Defaults";

/**
 * Combines multiple GameDataInterface instances into a single GameDataInterface
 * with access to all of their data.
 */
class GameDataAggregator implements GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
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
            Planet: this.makeAggregator<PlanetData>(NovaDataType.Planet),
            System: this.makeAggregator<SystemData>(NovaDataType.System),
            TargetCorners: this.makeAggregator<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.makeAggregator<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.makeAggregator<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.makeAggregator<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.makeAggregator<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.makeAggregator<ExplosionData>(NovaDataType.Explosion)
        };

        this.ids = this.getAllIDs();
    }


    getDataSources() {
        return this.dataSources;
    }

    private makeAggregator<T extends (BaseData | Buffer | SpriteSheetFramesData)>(dataType: NovaDataType): Gettable<T> {
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
        var IDs: NovaIDs = {
            Explosion: [],
            Outfit: [],
            Pict: [],
            PictImage: [],
            Planet: [],
            Ship: [],
            SpriteSheet: [],
            SpriteSheetFrames: [],
            SpriteSheetImage: [],
            StatusBar: [],
            System: [],
            TargetCorners: [],
            Weapon: []
        };

        for (let i in this.dataSources) {
            var dataSource = this.dataSources[i];
            var newIDs = await dataSource.ids;
            for (let dataType in newIDs) {
                IDs[<NovaDataType>dataType] = [...IDs[<NovaDataType>dataType], ...newIDs[<NovaDataType>dataType]];
            }
        }
        return IDs;
    }
}

export { GameDataAggregator };

