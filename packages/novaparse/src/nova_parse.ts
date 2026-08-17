import * as path from "path";
import { AsteroidData } from "novadatainterface/asteroid_data";
import { ExplosionData } from "novadatainterface/explosion_data";
import { DudeData } from "novadatainterface/dude_data";
import { FleetData } from "novadatainterface/fleet_data";
import { GameDataInterface } from "novadatainterface/game_data_interface";
import { Gettable } from "novadatainterface/gettable";
import { CronData } from "novadatainterface/cron_data";
import { JunkData } from "novadatainterface/junk_data";
import { OopsData } from "novadatainterface/oops_data";
import { GovtData } from "novadatainterface/govt_data";
import { MissionData } from "novadatainterface/mission_data";
import { NovaDataInterface, NovaIDNotFoundError } from "novadatainterface/nova_data_interface";
import { PlayerStartData } from "novadatainterface/player_start_data";
import { NovaIDs } from "novadatainterface/nova_ids";
import { OutfitData } from "novadatainterface/outfit_data";
import { PersData } from "novadatainterface/pers_data";
import { PictData } from "novadatainterface/pict_data";
import { PictImageData } from "novadatainterface/pict_image";
import { CicnImageData } from "novadatainterface/cicn_image";
import { PlanetData } from "novadatainterface/planet_data";
import { PpatImageData } from "novadatainterface/ppat_image";
import { RankData } from "novadatainterface/rank_data";
import { ShipData } from "novadatainterface/ship_data";
import { SpriteSheetData, SpriteSheetFramesData, SpriteSheetImageData } from "novadatainterface/sprite_sheet_data";
import { StatusBarData } from "novadatainterface/status_bar_data";
import { StringTableData } from "novadatainterface/string_table_data";
import { DescriptionData } from "novadatainterface/description_data";
import { SystemData } from "novadatainterface/system_data";
import { TargetCornersData } from "novadatainterface/target_corners_data";
import { WeaponData } from "novadatainterface/weapon_data";
import { DEFAULT_SUB_PATHS, IDSpaceHandler, NovaSubPaths } from "./id_space_handler.js";
import { describeFlagNamespaceReport, FlagNamespaceMap } from "./flag_namespace.js";
import { ControlBitNamespaceMap, describeControlBitNamespaceReport } from "./ncb_namespace.js";
import { ControlBitNamespaces } from "novadatainterface/control_bit_namespaces";
import { AsteroidParse } from "./parsers/asteroid_parse.js";
import { DudeParse } from "./parsers/dude_parse.js";
import { ExplosionParse } from "./parsers/explosion_parse.js";
import { FleetParse } from "./parsers/fleet_parse.js";
import { CharParse } from "./parsers/char_parse.js";
import { CronParse } from "./parsers/cron_parse.js";
import { JunkParse } from "./parsers/junk_parse.js";
import { OopsParse } from "./parsers/oops_parse.js";
import { GovtParse } from "./parsers/govt_parse.js";
import { MisnParse } from "./parsers/misn_parse.js";
import {
    builtInOutfitWeaponId, makeBuiltInAmmoOutfit, makeBuiltInWeaponOutfit,
} from "./built_in_weapon_outfit.js";
import { OutfitParse } from "./parsers/outfit_parse.js";
import { PersParse } from "./parsers/pers_parse.js";
import { PictImageMulti, PictImageMultiParse } from "./parsers/pict_parse.js";
import { PlanetParse } from "./parsers/planet_parse.js";
import { CicnImageParse } from "./parsers/cicn_image_parse.js";
import { PpatImageParse } from "./parsers/ppat_image_parse.js";
import { RankParse } from "./parsers/rank_parse.js";
import { resourceIDNotFoundStrict, resourceIDNotFoundWarn } from "./parsers/resource_id_not_found.js";
import { AmmoOutfitMap, ShipParseClosure, ShipPictMap, WeaponOutfitMap } from "./parsers/ship_parse.js";
import { SpriteSheetMulti, SpriteSheetMultiParse } from "./parsers/sprite_sheet_multi_parse.js";
import { StatusBarParse } from "./parsers/status_bar_parse.js";
import { StringTableParse } from "./parsers/string_table_parse.js";
import { DescriptionParse } from "./parsers/description_parse.js";
import {
    SystemBacklinkMap, SystemParseClosure,
} from "./parsers/system_parse.js";
import { TargetCornersParse } from "./parsers/target_corners_parse.js";
import { WeaponParse } from "./parsers/weapon_parse.js";
import { BoomResource } from "./resource_parsers/boom_resource.js";
import { CicnResource } from "./resource_parsers/cicn_resource.js";
import { BaseResource } from "./resource_parsers/nova_resource_base.js";
import { DudeResource } from "./resource_parsers/dude_resource.js";
import { FletResource } from "./resource_parsers/flet_resource.js";
import { CharResource } from "./resource_parsers/char_resource.js";
import { CronResource } from "./resource_parsers/cron_resource.js";
import { JunkResource } from "./resource_parsers/junk_resource.js";
import { OopsResource } from "./resource_parsers/oops_resource.js";
import { GovtResource } from "./resource_parsers/govt_resource.js";
import { IntfResource } from "./resource_parsers/intf_resource.js";
import { MisnResource } from "./resource_parsers/misn_resource.js";
import { OutfResource } from "./resource_parsers/outf_resource.js";
import { PersResource } from "./resource_parsers/pers_resource.js";
import { PictResource } from "./resource_parsers/pict_resource.js";
import { PpatResource } from "./resource_parsers/ppat_resource.js";
import { RankResource } from "./resource_parsers/rank_resource.js";
import { NovaResources, NovaResourceType, ResList } from "./resource_parsers/resource_holder_base.js";
import { RledResource } from "./resource_parsers/rled_resource.js";
import { RoidResource } from "./resource_parsers/roid_resource.js";
import { ShipResource } from "./resource_parsers/ship_resource.js";
import { SpobResource } from "./resource_parsers/spob_resource.js";
import { StrNResource } from "./resource_parsers/strn_resource.js";
import { DescResource } from "./resource_parsers/desc_resource.js";
import { SystResource } from "./resource_parsers/syst_resource.js";
import { WeapResource } from "./resource_parsers/weap_resource.js";
import { Defaults } from "novadatainterface/defaults";
import { SoundFileParse } from "./parsers/sound_file_parse.js";
import { SndResource } from "./resource_parsers/snd_resource.js";
import { SoundFile } from "novadatainterface/sound_file";


// Pilot (saved-game) file support. Re-exported from the package entry point
// so a future "import pilot file" feature (feeding packages/nova's
// save_game.ts) can `import { readPilot, PilotData } from "novaparse"`. See
// docs/pilot_file_format.md.
export type { PilotData, PilotGlobalsData, PilotPlayerData } from "./pilot/pilot_data.js";
export { parsePilotResources, parsePltPilot, readPilot } from "./pilot/pilot_parse.js";

// Per-plug-in Require/Contribute flag namespacing; see flag_namespace.ts.
export type {
    FlagNamespaceMap, FlagNamespaceReport, FlagCollision, UnsatisfiableRequire,
} from "./flag_namespace.js";
export { describeFlagNamespaceReport, flagBits } from "./flag_namespace.js";

type ParseFunction<T extends BaseResource, O> = (resource: T, errorFunc: (message: string) => void) => Promise<O>;

export class NovaParse implements GameDataInterface {
    private pictImageGettable: Gettable<PictImageData>;
    private pictGettable: Gettable<PictData>;
    private pictMultiGettable: Gettable<PictImageMulti>;
    private spriteSheetDataGettable: Gettable<SpriteSheetData>;
    private spriteSheetFramesGettable: Gettable<SpriteSheetFramesData>;
    private spriteSheetImageGettable: Gettable<SpriteSheetImageData>;
    private spriteSheetMultiGettable: Gettable<SpriteSheetMulti>;

    private shipParser: (s: ShipResource, m: (message: string) => void) => Promise<ShipData>;

    private shipPICTMap: ShipPictMap;
    private systemBacklinkMap: SystemBacklinkMap;
    private weaponOutfitMap: WeaponOutfitMap;
    private ammoOutfitMap: AmmoOutfitMap;
    resourceNotFoundFunction: (message: string) => void;
    public data: NovaDataInterface;
    path: string
    private idSpaceHandler: IDSpaceHandler;

    public readonly ids: Promise<NovaIDs>;
    public readonly idSpace: Promise<NovaResources | Error>;
    // The per-plug-in Require/Contribute flag namespacing (flag_namespace.ts).
    // Rejects when the core data failed to load; parsers that need it then
    // fail the same way idSpace consumers do.
    public readonly flagMap: Promise<FlagNamespaceMap>;
    // The per-plug-in control bit namespacing (ncb_namespace.ts). The map
    // has already been applied to the raw resources by the time it
    // resolves; it is exposed for diagnostics, tests and the client-facing
    // `controlBitNamespaces` below.
    public readonly controlBitMap: Promise<ControlBitNamespaceMap>;
    // GameDataInterface.controlBitNamespaces: the JSON-safe mapping the
    // server hands to the client for save-game (namespace, bit) pairs.
    public readonly controlBitNamespaces: Promise<ControlBitNamespaces>;
    // Where the one-time flag namespace diagnostics (separated cross-plug-in
    // collisions, unsatisfiable Requires) go. Overridable, like
    // resourceNotFoundFunction, so tests can silence it.
    public flagNamespaceWarn: (message: string) => void = console.warn;
    // Same for the control bit namespacing diagnostics.
    public controlBitNamespaceWarn: (message: string) => void = console.warn;

    // subPaths.novaPlugins may be set to null to parse the base "Nova Files"
    // data only, ignoring the Plug-ins directory entirely. The default keeps
    // plug-ins loading, so the game/dev server behaviour is unchanged.
    constructor(dataPath: string, strict: boolean = true,
        subPaths: NovaSubPaths = DEFAULT_SUB_PATHS) {

        // Strict will throw an error if any resource is not found.
        // Otherwise, it will try to substitute default resources whenever possible (success may vary).
        if (strict) {
            this.resourceNotFoundFunction = resourceIDNotFoundStrict;
        }
        else {
            this.resourceNotFoundFunction = resourceIDNotFoundWarn;
        }

        this.path = path.join(dataPath);
        this.idSpaceHandler = new IDSpaceHandler(dataPath, subPaths);
        this.idSpace = this.idSpaceHandler.getIDSpace().catch((e: Error) => {
            // Suppress all promise rejections. These are instead thrown when specific resources are requested
            //console.log("Got an error");
            return e;
        });


        this.idSpace.catch((_e: Error) => { });

        this.flagMap = this.idSpaceHandler.getFlagMap().then(map => {
            const lines = describeFlagNamespaceReport(map.report);
            if (lines.length > 0) {
                this.flagNamespaceWarn(
                    "NovaParse: Require/Contribute flag namespacing:\n    "
                    + lines.join("\n    "));
            }
            return map;
        });
        // Same no-op catch as idSpace: constructing over broken core data
        // must not itself produce an unhandled rejection.
        this.flagMap.catch((_e: Error) => { });

        this.controlBitMap = this.idSpaceHandler.getControlBitMap().then(map => {
            const lines = describeControlBitNamespaceReport(map.report);
            if (lines.length > 0) {
                this.controlBitNamespaceWarn(
                    "NovaParse: control bit namespacing:\n    "
                    + lines.join("\n    "));
            }
            return map;
        });
        this.controlBitMap.catch((_e: Error) => { });
        this.controlBitNamespaces = this.controlBitMap.then(map => map.data);
        this.controlBitNamespaces.catch((_e: Error) => { });

        this.shipPICTMap = this.makeShipPictMap();
        this.systemBacklinkMap = this.makeSystemBacklinkMap();
        this.weaponOutfitMap = this.makeWeaponOutfitMap();
        this.ammoOutfitMap = this.makeAmmoOutfitMap();
        this.shipParser = ShipParseClosure(this.shipPICTMap,
            this.weaponOutfitMap, this.ammoOutfitMap, this.idSpace,
            this.flagMap);


        // Holds spriteSheetMulti which gets split up
        this.spriteSheetMultiGettable = this.makeGettable<RledResource, SpriteSheetMulti>(NovaResourceType.rlëD, SpriteSheetMultiParse);
        // Since everything about a spriteSheet is parsed at once, it needs to be split up here
        this.spriteSheetDataGettable = new Gettable(this.getSpriteSheetData.bind(this));
        this.spriteSheetImageGettable = new Gettable(this.getSpriteSheetImage.bind(this));
        this.spriteSheetFramesGettable = new Gettable(this.getSpriteSheetFrames.bind(this));



        // Similar for pict
        this.pictMultiGettable = this.makeGettable<PictResource, PictImageMulti>(NovaResourceType.PICT, PictImageMultiParse);
        this.pictGettable = new Gettable(this.getPictData.bind(this));
        this.pictImageGettable = new Gettable(this.getPictImage.bind(this));


        this.ids = this.buildIDs();
        // buildIDs() now rejects loudly when the core data fails to load
        // (instead of silently returning empty ids). Attach a no-op catch so
        // that merely constructing a NovaParse whose data is broken doesn't
        // produce an "unhandled promise rejection" for callers that only use
        // `data` (resource-by-id, which throws on demand). Callers that await
        // `ids` still observe the rejection.
        this.ids.catch((_e: Error) => { });
        this.data = this.buildData();

    }

    private buildIDsForResource(resourceList: ResList<BaseResource>): Array<string> {

        return Object.keys(resourceList);
    }

    private async buildIDs(): Promise<NovaIDs> {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            // Fail loudly. Previously this silently returned empty ID defaults,
            // which meant a single unreadable core file (or, before the
            // per-plugin isolation in IDSpaceHandler, a single bad plug-in)
            // would wipe ALL ids — systems, ships, planets, everything — with
            // no error surfaced. The symptoms (blank starmap, "Expected at
            // least one system id") were maximally confusing because
            // fetch-by-id uses a different code path and still half-worked.
            //
            // Individual bad plug-ins are now skipped with a loud log inside
            // IDSpaceHandler and never reach here as an Error. If we DO get an
            // Error here it means the core "Nova Files" data failed to load,
            // without which nothing works — so surface it instead of hiding it.
            console.error(
                "NovaParse: failed to build ID space (core data load failed). " +
                "Underlying error: " + (idSpace.stack ?? idSpace.message),
            );
            throw idSpace;
        }

        return {
            Asteroid: this.buildIDsForResource(idSpace.röid),
            Ship: this.buildIDsForResource(idSpace.shïp),
            Outfit: this.buildIDsForResource(idSpace.oütf),
            Weapon: this.buildIDsForResource(idSpace.wëap),
            Pict: this.buildIDsForResource(idSpace.PICT),
            PictImage: this.buildIDsForResource(idSpace.PICT),
            Cicn: this.buildIDsForResource(idSpace.cicn),
            CicnImage: this.buildIDsForResource(idSpace.cicn),
            PpatImage: this.buildIDsForResource(idSpace.ppat),
            Rank: this.buildIDsForResource(idSpace.ränk),
            Planet: this.buildIDsForResource(idSpace.spöb),
            System: this.buildIDsForResource(idSpace.sÿst),
            Govt: this.buildIDsForResource(idSpace.gövt),
            Dude: this.buildIDsForResource(idSpace.düde),
            Fleet: this.buildIDsForResource(idSpace.flët),
            Junk: this.buildIDsForResource(idSpace.jünk),
            Oops: this.buildIDsForResource(idSpace.öops),
            Mission: this.buildIDsForResource(idSpace.mïsn),
            Pers: this.buildIDsForResource(idSpace.përs),
            Cron: this.buildIDsForResource(idSpace.crön),
            PlayerStart: this.buildIDsForResource(idSpace.chär),
            TargetCorners: [], // TODO: parse these
            SpriteSheet: this.buildIDsForResource(idSpace.rlëD),
            SpriteSheetImage: this.buildIDsForResource(idSpace.rlëD),
            SpriteSheetFrames: this.buildIDsForResource(idSpace.rlëD),
            StatusBar: this.buildIDsForResource(idSpace.ïntf),
            Explosion: this.buildIDsForResource(idSpace.bööm),
            SoundFile: this.buildIDsForResource(idSpace["snd "]),
            StringTable: this.buildIDsForResource(idSpace["STR#"]),
            Description: this.buildIDsForResource(idSpace.dësc),
        }
    }

    // Assigns all the gettables to this.data
    private buildData(): NovaDataInterface {
        // This should really use NovaDataType.Ship etc but that isn't allowed when constructing like this.
        var data: NovaDataInterface = {
            Asteroid: this.makeGettable<RoidResource, AsteroidData>(NovaResourceType.röid, AsteroidParse),
            Ship: this.makeGettable<ShipResource, ShipData>(NovaResourceType.shïp, this.shipParser),
            Outfit: this.makeOutfitGettable(),
            Weapon: this.makeGettable<WeapResource, WeaponData>(NovaResourceType.wëap, WeaponParse),
            Pict: this.pictGettable,
            PictImage: this.pictImageGettable,
            Cicn: new Gettable(async () => Defaults.Cicn), // TODO: parse cicn metadata
            CicnImage: this.makeGettable<CicnResource, CicnImageData>(NovaResourceType.cicn, CicnImageParse),
            PpatImage: this.makeGettable<PpatResource, PpatImageData>(NovaResourceType.ppat, PpatImageParse),
            Rank: this.makeGettable<RankResource, RankData>(NovaResourceType.ränk,
                async (rank, notFound) => RankParse(rank, notFound, await this.flagMap)),
            Planet: this.makeGettable<SpobResource, PlanetData>(NovaResourceType.spöb, PlanetParse),
            System: this.makeGettable<SystResource, SystemData>(
                NovaResourceType.sÿst,
                SystemParseClosure(this.systemBacklinkMap)),
            Govt: this.makeGettable<GovtResource, GovtData>(NovaResourceType.gövt, GovtParse),
            Dude: this.makeGettable<DudeResource, DudeData>(NovaResourceType.düde, DudeParse),
            Fleet: this.makeGettable<FletResource, FleetData>(NovaResourceType.flët, FleetParse),
            Junk: this.makeGettable<JunkResource, JunkData>(NovaResourceType.jünk, JunkParse),
            Oops: this.makeGettable<OopsResource, OopsData>(NovaResourceType.öops, OopsParse),
            Mission: this.makeGettable<MisnResource, MissionData>(NovaResourceType.mïsn,
                async (misn, notFound) => MisnParse(misn, notFound, await this.flagMap)),
            Pers: this.makeGettable<PersResource, PersData>(NovaResourceType.përs, PersParse),
            Cron: this.makeGettable<CronResource, CronData>(NovaResourceType.crön,
                async (cron, notFound) => CronParse(cron, notFound, await this.flagMap)),
            PlayerStart: this.makeGettable<CharResource, PlayerStartData>(NovaResourceType.chär, CharParse),
            TargetCorners: this.makeGettable<BaseResource, TargetCornersData>(NovaResourceType.cicn, TargetCornersParse),
            SpriteSheet: this.spriteSheetDataGettable,
            SpriteSheetImage: this.spriteSheetImageGettable,
            SpriteSheetFrames: this.spriteSheetFramesGettable,
            StatusBar: this.makeGettable<IntfResource, StatusBarData>(NovaResourceType.ïntf, StatusBarParse),
            Explosion: this.makeGettable<BoomResource, ExplosionData>(NovaResourceType.bööm, ExplosionParse),
            SoundFile: this.makeGettable<SndResource, SoundFile>(NovaResourceType.snd, SoundFileParse),
            StringTable: this.makeGettable<StrNResource, StringTableData>(NovaResourceType.STRH, StringTableParse),
            Description: this.makeGettable<DescResource, DescriptionData>(NovaResourceType.dësc, DescriptionParse),
        }

        return data;
    }

    private makeGettable<T extends BaseResource, O>(resourceType: NovaResourceType, parseFunction: ParseFunction<T, O>): Gettable<O> {
        return new Gettable(async (id: string) => {
            var idSpace = await this.idSpace; // May be an error
            if (idSpace instanceof Error) {
                throw idSpace;
            }

            var resource = <T>idSpace[resourceType][id];

            // Shouldn't this just call resourceNotFoundFunction???
            if (typeof resource === "undefined") {
                throw new NovaIDNotFoundError("NovaParse could not find " + resourceType + " of ID " + id + ".");
            }

            return await parseFunction(resource, this.resourceNotFoundFunction);
        });
    }

    // shïps whose corresponding PICT does not exist
    // use the PICT of the first shïp that had the same baseImage ID
    private async makeShipPictMap(): ShipPictMap {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        // Maps shïp ids to their baseImage ids
        var shipPICTMap: { [index: string]: string } = {};

        // maps baseImage ids to pict ids
        var baseImagePICTMap: { [index: string]: string } = {};

        // Populate baseImagePICTMap
        for (let shipGlobalID in idSpace.shïp) {
            var ship = idSpace.shïp[shipGlobalID];
            var pict = ship.idSpace.PICT[ship.pictID];

            if (!pict) {
                continue; // Ship has no corresponding pict, so don't set anything.
            }

            var shan = ship.idSpace.shän[ship.id];
            if (!shan) {
                this.resourceNotFoundFunction("shïp id " + ship.globalID + " missing shan");
                continue; // If it's not found, there's no baseImage to map from
            }
            var baseImageLocalID = shan.images.baseImage.ID;
            var baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID]?.globalID;
            if (!baseImageGlobalID) {
                continue;
            }

            // Don't overwrite if it already exists. The first ship with the
            // baseImage determines the PICT
            if (!baseImagePICTMap[baseImageGlobalID]) {
                // The base image corresponds to this pict.
                baseImagePICTMap[baseImageGlobalID] = pict.globalID;
            }
        }

        // Populate shipPICTMap
        for (let shipGlobalID in idSpace.shïp) {
            var ship = idSpace.shïp[shipGlobalID];
            var pict = ship.idSpace.PICT[ship.pictID];

            if (pict) {
                // Then there is a pict for this ship.
                // Set it in the map.
                shipPICTMap[shipGlobalID] = pict.globalID;
            }
            else {
                // No pict found for this ship, so look up the first
                // ship's baseImage in the baseImagePICTMap
                var shan = ship.idSpace.shän[ship.id];
                if (!shan) {
                    continue
                }
                var baseImageLocalID = shan.images.baseImage.ID;
                var baseImageGlobalID = shan.idSpace.rlëD[baseImageLocalID]?.globalID;
                if (baseImageGlobalID) {
                    shipPICTMap[shipGlobalID] = baseImagePICTMap[baseImageGlobalID];
                } else {
                    shipPICTMap[shipGlobalID] = "default";
                }
            }
        }
        return shipPICTMap;
    }

    /**
     * The oütf resources, plus the implicit outfits that mount a ship's
     * built-in weapons when no oütf provides them (see
     * built_in_weapon_outfit.ts). Implicit ids resolve here but are
     * deliberately absent from `ids.Outfit`, so nothing enumerating the
     * outfit catalogue — the outfitter's shelves above all — ever offers
     * one for sale.
     */
    private makeOutfitGettable(): Gettable<OutfitData> {
        const resources = this.makeGettable<OutfResource, OutfitData>(
            NovaResourceType.oütf,
            async (outf, notFound) => OutfitParse(outf, notFound, await this.flagMap));
        return new Gettable(async (id: string, priority: number) => {
            const builtIn = builtInOutfitWeaponId(id);
            if (builtIn === undefined) {
                return resources.get(id, priority);
            }
            const weapon = await this.data.Weapon.get(
                builtIn.weaponId, priority);
            return builtIn.kind === "weapon"
                ? makeBuiltInWeaponOutfit(weapon)
                : makeBuiltInAmmoOutfit(weapon);
        });
    }

    /**
     * For each system, the OTHER systems that name it in their own
     * Con1-Con16 — the half of its adjacency it does not declare itself.
     *
     * A hyperspace link is undirected: "Each system can be linked to up
     * to 16 other systems, and the player can make hyperspace jumps back
     * and forth between them" (EVN Bible, the sÿst resource). Data in
     * the wild leans on that. Stock Nova has 49 links declared from one
     * end only — every swapped duplicate system (the five Glimmers, the
     * Procyons, SPC-1421) is entered through one — and the Singularity
     * plug-in's AP Fringe IX declares its links to Fer'I'Jus from its own
     * end alone, which is exactly why the system was unreachable.
     *
     * Built from the raw resources (no full parse) and sorted, so a
     * system's completed link list is identical on every peer.
     */
    private async makeSystemBacklinkMap(): SystemBacklinkMap {
        const idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        const backlinks: { [index: string]: Set<string> } = {};
        for (const systemID in idSpace.sÿst) {
            const system = idSpace.sÿst[systemID];
            for (const localLink of system.links) {
                const target = system.idSpace.sÿst[localLink];
                if (!target || target.globalID === system.globalID) {
                    continue;
                }
                (backlinks[target.globalID] ??= new Set())
                    .add(system.globalID);
            }
        }
        return Object.fromEntries(Object.entries(backlinks)
            .map(([id, sources]) => [id, [...sources].sort()]));
    }

    private async makeWeaponOutfitMap(): WeaponOutfitMap {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        // Maps a weapon to the first outfit that provides it.
        var weaponOutfitMap: { [index: string]: string } = {};

        for (let outfitID in idSpace.oütf) {

            var outfit = await this.data.Outfit.get(outfitID);
            for (let weaponID in outfit.weapons) {
                if (!(weaponOutfitMap[weaponID])) {
                    weaponOutfitMap[weaponID] = outfitID;
                }
            }
        }
        return weaponOutfitMap;
    }

    private async makeAmmoOutfitMap(): AmmoOutfitMap {
        var idSpace = await this.idSpace;
        if (idSpace instanceof Error) {
            return {};
        }

        // Maps a weapon to the first outfit that is its ammo.
        var ammoOutfitMap: { [index: string]: string } = {};

        for (let outfitID in idSpace.oütf) {
            var outfit = await this.data.Outfit.get(outfitID);
            if (outfit.ammoFor && !(ammoOutfitMap[outfit.ammoFor])) {
                ammoOutfitMap[outfit.ammoFor] = outfitID;
            }
        }
        return ammoOutfitMap;
    }

    private async getSpriteSheetData(id: string): Promise<SpriteSheetData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheet
    }
    private async getSpriteSheetImage(id: string): Promise<SpriteSheetImageData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheetImage;
    }
    private async getSpriteSheetFrames(id: string): Promise<SpriteSheetFramesData> {
        var multi: SpriteSheetMulti = await this.spriteSheetMultiGettable.get(id);
        return multi.spriteSheetFrames;
    }

    private async getPictData(id: string): Promise<PictData> {
        var multi: PictImageMulti = await this.pictMultiGettable.get(id);
        return multi.pict;
    }
    private async getPictImage(id: string): Promise<PictImageData> {
        var multi: PictImageMulti = await this.pictMultiGettable.get(id);
        return multi.image;
    }
}
