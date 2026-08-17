import { AsteroidData } from "novadatainterface/asteroid_data";
import { GameDataInterface, PreloadData } from "novadatainterface/game_data_interface";
import { NovaDataInterface, NovaDataType } from "novadatainterface/nova_data_interface";
import { Gettable, GettableData } from "novadatainterface/gettable";
import { BaseData } from "novadatainterface/base_data";
import { ShipData } from "novadatainterface/ship_data";
import { OutfitData } from "novadatainterface/outfit_data";
import { WeaponData } from "novadatainterface/weapon_data";
import { PictData } from "novadatainterface/pict_data";
import { PlanetData } from "novadatainterface/planet_data";
import { SystemData } from "novadatainterface/system_data";
import { GovtData } from "novadatainterface/govt_data";
import { DudeData } from "novadatainterface/dude_data";
import { FleetData } from "novadatainterface/fleet_data";
import { JunkData } from "novadatainterface/junk_data";
import { OopsData } from "novadatainterface/oops_data";
import { MissionData } from "novadatainterface/mission_data";
import { PersData } from "novadatainterface/pers_data";
import { CronData } from "novadatainterface/cron_data";
import { PlayerStartData } from "novadatainterface/player_start_data";
import { TargetCornersData } from "novadatainterface/target_corners_data";
import { SpriteSheetData, SpriteSheetImageData, SpriteSheetFramesData } from "novadatainterface/sprite_sheet_data";
import { StatusBarData } from "novadatainterface/status_bar_data";
import { ExplosionData } from "novadatainterface/explosion_data";
import { PictImageData } from "novadatainterface/pict_image";
import { getDefaultNovaIDs, NovaIDs } from "novadatainterface/nova_ids";
import { Defaults } from "novadatainterface/defaults";
import { CicnImageData } from "novadatainterface/cicn_image";
import { CicnData } from "novadatainterface/cicn_data";
import { PpatImageData } from "novadatainterface/ppat_image";
import { SoundFile } from "novadatainterface/sound_file";
import { RankData } from "novadatainterface/rank_data";
import { StringTableData } from "novadatainterface/string_table_data";
import { DescriptionData } from "novadatainterface/description_data";
import {
    ControlBitNamespaces, getDefaultControlBitNamespaces,
} from "novadatainterface/control_bit_namespaces";

/**
 * Combines multiple GameDataInterface instances into a single GameDataInterface
 * with access to all of their data.
 */
class GameDataAggregator implements GameDataInterface {
    readonly data: NovaDataInterface;
    readonly ids: Promise<NovaIDs>;
    readonly preloadData: Promise<PreloadData>;
    readonly controlBitNamespaces: Promise<ControlBitNamespaces>;
    private dataSources: Array<GameDataInterface>;
    private warningReporter: (w: string) => void;

    constructor(dataSources: Array<GameDataInterface>, warningReporter = console.log) {
        this.dataSources = dataSources;
        this.warningReporter = warningReporter;

        // Is there a better way?
        this.data = {
            Asteroid: this.makeAggregator<AsteroidData>(NovaDataType.Asteroid),
            Ship: this.makeAggregator<ShipData>(NovaDataType.Ship),
            Outfit: this.makeAggregator<OutfitData>(NovaDataType.Outfit),
            Weapon: this.makeAggregator<WeaponData>(NovaDataType.Weapon),
            Pict: this.makeAggregator<PictData>(NovaDataType.Pict),
            PictImage: this.makeAggregator<PictImageData>(NovaDataType.PictImage),
            Cicn: this.makeAggregator<CicnData>(NovaDataType.Cicn),
            CicnImage: this.makeAggregator<CicnImageData>(NovaDataType.CicnImage),
            PpatImage: this.makeAggregator<PpatImageData>(NovaDataType.PpatImage),
            Planet: this.makeAggregator<PlanetData>(NovaDataType.Planet),
            System: this.makeAggregator<SystemData>(NovaDataType.System),
            Govt: this.makeAggregator<GovtData>(NovaDataType.Govt),
            Dude: this.makeAggregator<DudeData>(NovaDataType.Dude),
            Fleet: this.makeAggregator<FleetData>(NovaDataType.Fleet),
            Junk: this.makeAggregator<JunkData>(NovaDataType.Junk),
            Oops: this.makeAggregator<OopsData>(NovaDataType.Oops),
            Mission: this.makeAggregator<MissionData>(NovaDataType.Mission),
            Pers: this.makeAggregator<PersData>(NovaDataType.Pers),
            Cron: this.makeAggregator<CronData>(NovaDataType.Cron),
            PlayerStart: this.makeAggregator<PlayerStartData>(NovaDataType.PlayerStart),
            TargetCorners: this.makeAggregator<TargetCornersData>(NovaDataType.TargetCorners),
            SpriteSheet: this.makeAggregator<SpriteSheetData>(NovaDataType.SpriteSheet),
            SpriteSheetImage: this.makeAggregator<SpriteSheetImageData>(NovaDataType.SpriteSheetImage),
            SpriteSheetFrames: this.makeAggregator<SpriteSheetFramesData>(NovaDataType.SpriteSheetFrames),
            StatusBar: this.makeAggregator<StatusBarData>(NovaDataType.StatusBar),
            Explosion: this.makeAggregator<ExplosionData>(NovaDataType.Explosion),
            SoundFile: this.makeAggregator<SoundFile>(NovaDataType.SoundFile),
            Rank: this.makeAggregator<RankData>(NovaDataType.Rank),
            StringTable: this.makeAggregator<StringTableData>(NovaDataType.StringTable),
            Description: this.makeAggregator<DescriptionData>(NovaDataType.Description),
        };

        this.ids = this.getAllIDs();

        this.preloadData = this.getPreloadData();
        this.controlBitNamespaces = this.getControlBitNamespaces();
    }

    /**
     * The control-bit namespacing comes from whichever data source parses
     * plug-ins (NovaParse); there is only ever one such source, so the
     * first that has a mapping wins. None: the default (no plug-ins).
     */
    private async getControlBitNamespaces(): Promise<ControlBitNamespaces> {
        for (const dataSource of this.dataSources) {
            if (dataSource.controlBitNamespaces) {
                return await dataSource.controlBitNamespaces;
            }
        }
        return getDefaultControlBitNamespaces();
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

