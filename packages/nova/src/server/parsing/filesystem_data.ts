import * as fs from "fs";
import { AsteroidData } from "novadatainterface/asteroid_data";
import { BaseData } from "novadatainterface/base_data";
import { CicnData } from "novadatainterface/cicn_data";
import { CronData } from "novadatainterface/cron_data";
import { MissionData } from "novadatainterface/mission_data";
import { PlayerStartData } from "novadatainterface/player_start_data";
import { CicnImageData } from "novadatainterface/cicn_image";
import { PpatImageData } from "novadatainterface/ppat_image";
import { ExplosionData } from "novadatainterface/explosion_data";
import { GameDataInterface } from "novadatainterface/game_data_interface";
import { Gettable } from "novadatainterface/gettable";
import { NovaDataInterface } from "novadatainterface/nova_data_interface";
import { NovaIDNotFoundError } from "novadatainterface/nova_id_not_found_error";
import { NovaIDs } from "novadatainterface/nova_ids";
import { OutfitData } from "novadatainterface/outfit_data";
import { PersData } from "novadatainterface/pers_data";
import { PictData } from "novadatainterface/pict_data";
import { PictImageData } from "novadatainterface/pict_image";
import { PlanetData } from "novadatainterface/planet_data";
import { ShipData } from "novadatainterface/ship_data";
import { SoundFile } from "novadatainterface/sound_file";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "novadatainterface/sprite_sheet_data";
import { StatusBarData } from "novadatainterface/status_bar_data";
import { RankData } from "novadatainterface/rank_data";
import { StringTableData } from "novadatainterface/string_table_data";
import { DescriptionData } from "novadatainterface/description_data";
import { SystemData } from "novadatainterface/system_data";
import { GovtData } from "novadatainterface/govt_data";
import { DudeData } from "novadatainterface/dude_data";
import { FleetData } from "novadatainterface/fleet_data";
import { JunkData } from "novadatainterface/junk_data";
import { OopsData } from "novadatainterface/oops_data";
import { TargetCornersData } from "novadatainterface/target_corners_data";
import { WeaponData } from "novadatainterface/weapon_data";
import * as path from "path";


type PathInfo = {
    path: string,
    extension: string
};

const Paths = {
    Asteroid: { path: "Asteroid", extension: "json" } as PathInfo,
    Ship: { path: "Ship", extension: "json" } as PathInfo,
    Outfit: { path: "Outfit", extension: "json" } as PathInfo,
    Weapon: { path: "Weapon", extension: "json" } as PathInfo,
    Pict: { path: "Pict", extension: "json" } as PathInfo,
    PictImage: { path: "PictImage", extension: "png" } as PathInfo,
    Cicn: { path: "Cicn", extension: "json" } as PathInfo,
    CicnImage: { path: "CicnImage", extension: "png" } as PathInfo,
    PpatImage: { path: "PpatImage", extension: "png" } as PathInfo,
    Planet: { path: "Planet", extension: "json" } as PathInfo,
    System: { path: "System", extension: "json" } as PathInfo,
    Govt: { path: "Govt", extension: "json" } as PathInfo,
    Dude: { path: "Dude", extension: "json" } as PathInfo,
    Fleet: { path: "Fleet", extension: "json" } as PathInfo,
    Junk: { path: "Junk", extension: "json" } as PathInfo,
    Oops: { path: "Oops", extension: "json" } as PathInfo,
    Mission: { path: "Mission", extension: "json" } as PathInfo,
    Pers: { path: "Pers", extension: "json" } as PathInfo,
    Cron: { path: "Cron", extension: "json" } as PathInfo,
    PlayerStart: { path: "PlayerStart", extension: "json" } as PathInfo,
    TargetCorners: { path: "TargetCorners", extension: "json" } as PathInfo,
    SpriteSheet: { path: "SpriteSheet", extension: "json" } as PathInfo,
    SpriteSheetImage: { path: "SpriteSheetImage", extension: "png" } as PathInfo,
    SpriteSheetFrames: { path: "SpriteSheetFrames", extension: "json" } as PathInfo,
    StatusBar: { path: "StatusBar", extension: "json" } as PathInfo,
    Explosion: { path: "Explosion", extension: "json" } as PathInfo,
    SoundFile: { path: "SoundFile", extension: "wav" } as PathInfo,
    Rank: { path: "Rank", extension: "json" } as PathInfo,
    StringTable: { path: "StringTable", extension: "json" } as PathInfo,
    Description: { path: "Description", extension: "json" } as PathInfo,
};

class FilesystemData implements GameDataInterface {
    public ids: Promise<NovaIDs>;
    public data: NovaDataInterface;

    constructor(private rootPath: string) {
        this.data = {
            Asteroid: this.getFunction<AsteroidData>(Paths.Asteroid),
            Ship: this.getFunction<ShipData>(Paths.Ship),
            Outfit: this.getFunction<OutfitData>(Paths.Outfit),
            Weapon: this.getFunction<WeaponData>(Paths.Weapon),
            Pict: this.getFunction<PictData>(Paths.Pict),
            PictImage: this.getFunction<PictImageData>(Paths.PictImage),
            Cicn: this.getFunction<CicnData>(Paths.Cicn),
            CicnImage: this.getFunction<CicnImageData>(Paths.CicnImage),
            PpatImage: this.getFunction<PpatImageData>(Paths.PpatImage),
            Planet: this.getFunction<PlanetData>(Paths.Planet),
            System: this.getFunction<SystemData>(Paths.System),
            Govt: this.getFunction<GovtData>(Paths.Govt),
            Dude: this.getFunction<DudeData>(Paths.Dude),
            Fleet: this.getFunction<FleetData>(Paths.Fleet),
            Junk: this.getFunction<JunkData>(Paths.Junk),
            Oops: this.getFunction<OopsData>(Paths.Oops),
            Mission: this.getFunction<MissionData>(Paths.Mission),
            Pers: this.getFunction<PersData>(Paths.Pers),
            Cron: this.getFunction<CronData>(Paths.Cron),
            PlayerStart: this.getFunction<PlayerStartData>(Paths.PlayerStart),
            TargetCorners: this.getFunction<TargetCornersData>(Paths.TargetCorners),
            SpriteSheet: this.getFunction<SpriteSheetData>(Paths.SpriteSheet),
            SpriteSheetImage: this.getFunction<SpriteSheetImageData>(Paths.SpriteSheetImage),
            SpriteSheetFrames: this.getFunction<SpriteSheetFramesData>(Paths.SpriteSheetFrames),
            StatusBar: this.getFunction<StatusBarData>(Paths.StatusBar),
            Explosion: this.getFunction<ExplosionData>(Paths.Explosion),
            SoundFile: this.getFunction<SoundFile>(Paths.SoundFile),
            Rank: this.getFunction<RankData>(Paths.Rank),
            StringTable: this.getFunction<StringTableData>(Paths.StringTable),
            Description: this.getFunction<DescriptionData>(Paths.Description),
        }
        this.ids = this.buildIDs();
    }

    getFunction<T extends BaseData | PictImageData | SpriteSheetFramesData>(p: PathInfo): Gettable<T> {
        // Returns a gettable that loads the resource from a file
        const typeDir = path.resolve(this.rootPath, p.path);
        return new Gettable<T>((id: string) => {
            return new Promise<T>((fulfill, reject) => {
                // Defense in depth: the id is validated at the route layer,
                // but re-check here so this sink is safe even if a future
                // caller forgets to. The resolved path must stay inside the
                // resource type's directory; a trailing separator on the
                // prefix stops a sibling dir that merely shares the prefix
                // (e.g. "Ship" vs "Ship2") from slipping through.
                const filePath = path.resolve(typeDir, id + "." + p.extension);
                if (filePath !== typeDir && !filePath.startsWith(typeDir + path.sep)) {
                    reject(new Error("Invalid resource id"));
                    return;
                }
                fs.readFile(filePath,
                    function(err, contents) {
                        if (err) {
                            // No object file means this overlay source does
                            // not define the id — the aggregator's cue to
                            // try the next source — not a load failure.
                            reject(err.code === "ENOENT"
                                ? new NovaIDNotFoundError(
                                    "No " + p.path + " object file for id " + id)
                                : err);
                        }
                        else {
                            if (p.extension == "json") {
                                fulfill(JSON.parse(contents.toString('utf8')) as T)
                            }
                            else if (p.extension == "png") {
                                fulfill(contents.buffer as T);
                            }
                            else {
                                reject("Unsupported");
                            }
                        }
                    });
            });
        });
    }

    async buildIDs(): Promise<NovaIDs> {
        return {
            Asteroid: await this.buildIDsForPath(Paths.Asteroid),
            Ship: await this.buildIDsForPath(Paths.Ship),
            Outfit: await this.buildIDsForPath(Paths.Outfit),
            Weapon: await this.buildIDsForPath(Paths.Weapon),
            Pict: await this.buildIDsForPath(Paths.Pict),
            PictImage: await this.buildIDsForPath(Paths.PictImage),
            Cicn: await this.buildIDsForPath(Paths.Cicn),
            CicnImage: await this.buildIDsForPath(Paths.CicnImage),
            PpatImage: await this.buildIDsForPath(Paths.PpatImage),
            Planet: await this.buildIDsForPath(Paths.Planet),
            System: await this.buildIDsForPath(Paths.System),
            Govt: await this.buildIDsForPath(Paths.Govt),
            Dude: await this.buildIDsForPath(Paths.Dude),
            Fleet: await this.buildIDsForPath(Paths.Fleet),
            Junk: await this.buildIDsForPath(Paths.Junk),
            Oops: await this.buildIDsForPath(Paths.Oops),
            Mission: await this.buildIDsForPath(Paths.Mission),
            Pers: await this.buildIDsForPath(Paths.Pers),
            Cron: await this.buildIDsForPath(Paths.Cron),
            PlayerStart: await this.buildIDsForPath(Paths.PlayerStart),
            TargetCorners: await this.buildIDsForPath(Paths.TargetCorners),
            SpriteSheet: await this.buildIDsForPath(Paths.SpriteSheet),
            SpriteSheetImage: await this.buildIDsForPath(Paths.SpriteSheetImage),
            SpriteSheetFrames: await this.buildIDsForPath(Paths.SpriteSheetFrames),
            StatusBar: await this.buildIDsForPath(Paths.StatusBar),
            Explosion: await this.buildIDsForPath(Paths.Explosion),
            SoundFile: await this.buildIDsForPath(Paths.SoundFile),
            Rank: await this.buildIDsForPath(Paths.Rank),
            StringTable: await this.buildIDsForPath(Paths.StringTable),
            Description: await this.buildIDsForPath(Paths.Description),
        }
    }

    buildIDsForPath(p: PathInfo): Promise<string[]> {
        return new Promise((fulfill, reject) => {
            fs.readdir(path.join(this.rootPath, p.path), function(error, files) {
                if (error) {
                    if (error.code === "ENOENT") {
                        fulfill([]); // If the directory doesn't exist, then there are no IDs
                    }
                    else {
                        reject(error);
                    }
                }
                else {
                    fulfill(files.filter(function(name) {
                        return name.slice(name.length - (p.extension.length + 1), name.length) === ("." + p.extension);
                    }).map(function(name) {
                        return name.slice(0, name.length - (p.extension.length + 1));
                    }));
                }
            });
        });
    }
};

export { FilesystemData };
