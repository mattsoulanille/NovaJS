import { readResourceFork } from "resource_fork";
import { NovaResources, NovaResourceType } from "./resource_parsers/resource_holder_base.js";
import { BoomResource } from "./resource_parsers/boom_resource.js";
import { CharResource } from "./resource_parsers/char_resource.js";
import { CicnResource } from "./resource_parsers/cicn_resource.js";
import { ColrResource } from "./resource_parsers/colr_resource.js";
import { CronResource } from "./resource_parsers/cron_resource.js";
import { DescResource } from "./resource_parsers/desc_resource.js";
import { DudeResource } from "./resource_parsers/dude_resource.js";
import { FletResource } from "./resource_parsers/flet_resource.js";
import { GovtResource } from "./resource_parsers/govt_resource.js";
import { IntfResource } from "./resource_parsers/intf_resource.js";
import { JunkResource } from "./resource_parsers/junk_resource.js";
import { MisnResource } from "./resource_parsers/misn_resource.js";
import { NebuResource } from "./resource_parsers/nebu_resource.js";
import { BaseResource } from "./resource_parsers/nova_resource_base.js";
import { OopsResource } from "./resource_parsers/oops_resource.js";
import { OutfResource } from "./resource_parsers/outf_resource.js";
import { PersResource } from "./resource_parsers/pers_resource.js";
import { PictResource } from "./resource_parsers/pict_resource.js";
import { PpatResource } from "./resource_parsers/ppat_resource.js";
import { RankResource } from "./resource_parsers/rank_resource.js";
import { RledResource } from "./resource_parsers/rled_resource.js";
import { RoidResource } from "./resource_parsers/roid_resource.js";
import { ShanResource } from "./resource_parsers/shan_resource.js";
import { ShipResource } from "./resource_parsers/ship_resource.js";
import { SpinResource } from "./resource_parsers/spin_resource.js";
import { SpobResource } from "./resource_parsers/spob_resource.js";
import { StrResource } from "./resource_parsers/str_resource.js";
import { StrNResource } from "./resource_parsers/strn_resource.js";
import { SystResource } from "./resource_parsers/syst_resource.js";
import { VersResource } from "./resource_parsers/vers_resource.js";
import { WeapResource } from "./resource_parsers/weap_resource.js";
import { SndResource } from "./resource_parsers/snd_resource.js";
import { $enum } from "ts-enum-util";
import * as path from "path";


// Reads a single plugin or nova file
// Puts results in localIDSpace.
// Returns the number of resources parsed from the file. A count of zero for a
// file that should contain resources is a strong signal that its resource fork
// was lost (see the macOS xattr / resource-fork gotcha in id_space_handler.ts).
//
// Each resource is constructed in isolation. Most constructors read through
// Reader, whose past-the-end reads fall back to defaults, but a few reject
// malformed input outright (BoomResource with no graphic, ShanResource with
// no base image, RledResource shorter than its size header). Resources are
// written into the shared id space type by type as they are constructed, so
// letting one such throw escape left the file HALF loaded — every type
// before it in enum order present, everything after it missing — while the
// caller's log claimed the whole file was skipped. A malformed resource is
// therefore dropped and named here, and the rest of the file loads; a
// reference to the dropped resource then fails as "not found", which is the
// truthful outcome.
//
// This applies to the core "Nova Files" exactly as to plug-ins, and that is
// deliberate. The FILE-level policy is unchanged: a core file that cannot be
// read at all (missing, no resource fork) is still fatal in
// IDSpaceHandler.addNovaFilesDirectory, where a plug-in file is skipped. But
// a single malformed resource INSIDE a readable core file used to be fatal
// too (the throw escaped to addPlugin and took the id space with it); it now
// degrades the same way as in a plug-in — dropped, named, and whatever
// references it fails as not-found (weapon_parse "Missing rlëD",
// getOverlayFrames -> undefined). Stock data has no such resource, so this
// only ever changes what a corrupt install does: a loud drop that names the
// resource, instead of a hard stop that named the whole file. Pinned by
// bad_plugin_test.ts ("drops only the malformed resource of a CORE file").
async function readNovaFile(filePath: string, localIDSpace: NovaResources): Promise<number> {
    const rf = await read(filePath);

    let resourceCount = 0;
    for (const resourceType of $enum(NovaResourceType).values()) {
        const parser = getParser(<NovaResourceType>resourceType);

        for (const id in rf[resourceType]) {
            let resource: BaseResource;
            try {
                resource = new parser(rf[resourceType][id], localIDSpace);
            } catch (e) {
                console.error("NovaParse: SKIPPED malformed " + resourceType
                    + " id " + id + " in " + filePath + ": "
                    + (e instanceof Error ? e.message : String(e)));
                continue;
            }
            localIDSpace[resourceType][id] = resource;
            resourceCount++;
        }
    }
    return resourceCount;
}

// Files whose resources live in the DATA fork: the Nova Data files and
// Windows-style plug-in containers. Everything else (a classic Mac plug-in,
// usually with no extension at all) is read from its resource fork.
const DATA_FORK_EXTENSIONS: ReadonlySet<string> =
    new Set([".ndat", ".npif", ".rez"]);

function read(filePath: string) {
    const useRF = !DATA_FORK_EXTENSIONS.has(path.extname(filePath).toLowerCase());
    return readResourceFork(filePath, useRF);
}


// Since we're storing subclasses, not instances of subclasses.
// Still missing: DITL, DLOG (classic Mac UI resources) and rlë8
// (8-bit sprites; Nova's data has a single one, unused by the game).
const parserMap: { [index: string]: typeof BaseResource } = {};
parserMap[NovaResourceType.bööm] = BoomResource;
parserMap[NovaResourceType.chär] = CharResource;
parserMap[NovaResourceType.cicn] = CicnResource;
parserMap[NovaResourceType.cölr] = ColrResource;
parserMap[NovaResourceType.crön] = CronResource;
parserMap[NovaResourceType.dësc] = DescResource;
//parserMap[NovaResourceType.DITL] = ;
//parserMap[NovaResourceType.DLOG] = ;
parserMap[NovaResourceType.düde] = DudeResource;
parserMap[NovaResourceType.flët] = FletResource;
parserMap[NovaResourceType.gövt] = GovtResource;
parserMap[NovaResourceType.ïntf] = IntfResource;
parserMap[NovaResourceType.jünk] = JunkResource;
parserMap[NovaResourceType.mïsn] = MisnResource;
parserMap[NovaResourceType.nëbu] = NebuResource;
parserMap[NovaResourceType.öops] = OopsResource;
parserMap[NovaResourceType.oütf] = OutfResource;
parserMap[NovaResourceType.përs] = PersResource;
parserMap[NovaResourceType.PICT] = PictResource;
parserMap[NovaResourceType.ppat] = PpatResource;
parserMap[NovaResourceType.ränk] = RankResource;
//parserMap[NovaResourceType.rlë8] = ;
parserMap[NovaResourceType.rlëD] = RledResource;
parserMap[NovaResourceType.röid] = RoidResource;
parserMap[NovaResourceType.shän] = ShanResource;
parserMap[NovaResourceType.shïp] = ShipResource;
parserMap[NovaResourceType.snd] = SndResource;
parserMap[NovaResourceType.spïn] = SpinResource;
parserMap[NovaResourceType.spöb] = SpobResource;
parserMap[NovaResourceType.STR] = StrResource;
parserMap[NovaResourceType.STRH] = StrNResource;
parserMap[NovaResourceType.sÿst] = SystResource;
parserMap[NovaResourceType.vers] = VersResource;
parserMap[NovaResourceType.wëap] = WeapResource;


function getParser(resourceType: NovaResourceType): typeof BaseResource {
    if (parserMap[resourceType]) {
        return parserMap[resourceType];
    }
    else {
        return BaseResource;
        //throw new Error("Unknown data type " + resourceType);
    }
}

export { readNovaFile };
