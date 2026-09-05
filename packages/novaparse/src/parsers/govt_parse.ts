import { GovtData } from "novadatainterface/govt_data";
import { BaseData } from "novadatainterface/base_data";
import { GovtResource } from "../resource_parsers/govt_resource.js";
import { BaseParse } from "./base_parse.js";
import { FlagNamespaceMap, resolveResourceFlags } from "../flag_namespace.js";


/**
 * Maps a parsed gövt resource onto the GovtData shape served through the data
 * interface. The GovtResource already decodes every field (including the two
 * flag words into named booleans) and verifies its layout against the gövt
 * TMPL, so this is a straight projection plus the shared BaseData fields.
 */
/**
 * Generic comms-dialog greetings live in one STR# resource per government,
 * ten alternative lines each, starting at STR# 7000 for the first government
 * (local id 128): strnId = GREETING_STRN_BASE + (govtLocalId - FIRST_GOVT_ID).
 * (The Bible's Appendix III 'STR ' patch range 10000+ — "first 10 for govt -1,
 * second 10 for govt 0, ..." — is an indirection over these resources; the
 * stock scenario leaves 10000+ empty and stores the data here. STR# 6999 holds
 * the independent/no-government greetings, unreachable through a real gövt.)
 * Governments with no greeting resource (many mission-only ones) resolve to an
 * empty list, and the hail dialog falls back to a synthetic line.
 */
const GREETING_STRN_BASE = 7000;
const FIRST_GOVT_ID = 128;

export async function GovtParse(govt: GovtResource,
    notFoundFunction: (m: string) => void,
    flagMap: FlagNamespaceMap | null = null): Promise<GovtData> {
    const base: BaseData = await BaseParse(govt, notFoundFunction);

    const greetingStrn = GREETING_STRN_BASE + (govt.id - FIRST_GOVT_ID);
    // Drop blank and "*" entries — Nova's convention for an unused STR# slot.
    const commGreetings = [...(govt.idSpace["STR#"][greetingStrn]?.strings ?? [])]
        .filter(line => line.trim() !== "" && line.trim() !== "*");

    return {
        ...base,
        classes: [...govt.classes],
        allies: [...govt.allies],
        enemies: [...govt.enemies],
        maxOdds: govt.maxOdds,
        skillMult: govt.skillMult,
        inhJam: [
            govt.inhJam[0] ?? 0,
            govt.inhJam[1] ?? 0,
            govt.inhJam[2] ?? 0,
            govt.inhJam[3] ?? 0,
        ],
        crimeTol: govt.crimeTol,
        scanFine: govt.scanFine,
        scanMask: govt.scanMask,
        smugglePenalty: govt.smugPenalty,
        disablePenalty: govt.disabPenalty,
        boardPenalty: govt.boardPenalty,
        killPenalty: govt.killPenalty,
        shootPenalty: govt.shootPenalty,
        initialRecord: govt.initialRec,
        flags: {
            xenophobic: govt.xenophobic,
            attacksPlayerIfCriminal: govt.attacksPlayerIfCriminal,
            alwaysAttacksPlayer: govt.alwaysAttacksPlayer,
            playerShotsPassThrough: govt.playerShotsPassThrough,
            warshipsRetreatAt25: govt.warshipsRetreatAt25,
            ignoredByOtherNosyGovts: govt.ignoredByOtherNosyGovts,
            neverAttacksPlayer: govt.neverAttacksPlayer,
            freightersHalfJamming: govt.freightersHalfJamming,
            persShipsImmortal: govt.persShipsImmortal,
            warshipsTakeBribes: govt.warshipsTakeBribes,
            cantBeHailed: govt.cantBeHailed,
            startsDisabled: govt.startsDisabled,
            plundersBeforeDestroying: govt.plundersBeforeDestroying,
            freightersTakeBribes: govt.freightersTakeBribes,
            planetsTakeBribes: govt.planetsTakeBribes,
            largerBribes: govt.largerBribes,
        },
        flags2: {
            noAssistOrMercy: govt.noAssistOrMercy,
            minorMapBoundaries: govt.minorMapBoundaries,
            noMapBoundaries: govt.noMapBoundaries,
            noDistressMessages: govt.noDistressMessages,
            roadsideAssistance: govt.roadsideAssistance,
            doesntUseHypergates: govt.doesntUseHypergates,
            prefersHypergates: govt.prefersHypergates,
            prefersWormholes: govt.prefersWormholes,
        },
        commName: govt.commName,
        targetCode: govt.targetCode,
        mediumName: govt.mediumName,
        color: govt.color,
        shipColor: govt.shipColor,
        // Namespaced like a mïsn's Require (same encoding: decimal), so a
        // plug-in gövt's travel permit is satisfiable by the plug-in's own
        // Contribute bits. See flag_namespace.ts.
        require: resolveResourceFlags(flagMap, govt, govt.require).toString(),
        voiceType: govt.voiceType,
        newsPic: govt.newsPic >= 128
            ? govt.idSpace.PICT[govt.newsPic]?.globalID ?? null
            : null,
        // gövt Interface: the status bar for a player flying this
        // government's ships. "Values less than 128 will be interpreted as
        // 128" (the default bar), which the null stands for.
        statusBar: govt.interface >= 128
            ? govt.idSpace.ïntf[govt.interface]?.globalID ?? null
            : null,
        commGreetings,
    };
}
