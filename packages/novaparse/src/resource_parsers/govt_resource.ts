import { Resource } from "resource_fork";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";
import { NovaResources } from "./resource_holder_base.js";

/**
 * A government: a collection of ships and planets that react collectively to
 * the actions of the player and other ships.
 *
 * Field layout follows ResForge's gövt template (192 bytes), documented in
 * the EVN Bible pp. 27-30.
 */
class GovtResource extends BaseResource {
    /**
     * Voice set used by escorts of this govt. 0-7 picks 'snd ' resources
     * 1x00-1x29; 1000-1007 forces odd sounds, 2000-2007 forces even sounds;
     * -1 disables speech.
     */
    voiceType: number;

    flags: number;
    xenophobic: boolean;
    attacksPlayerIfCriminal: boolean;
    alwaysAttacksPlayer: boolean;
    playerShotsPassThrough: boolean;
    warshipsRetreatAt25: boolean;
    ignoredByOtherNosyGovts: boolean;
    neverAttacksPlayer: boolean;
    freightersHalfJamming: boolean;
    persShipsImmortal: boolean;
    warshipsTakeBribes: boolean;
    cantBeHailed: boolean;
    startsDisabled: boolean;
    plundersBeforeDestroying: boolean;
    freightersTakeBribes: boolean;
    planetsTakeBribes: boolean;
    largerBribes: boolean;

    flags2: number;
    noAssistOrMercy: boolean;
    minorMapBoundaries: boolean;
    noMapBoundaries: boolean;
    noDistressMessages: boolean;
    roadsideAssistance: boolean;
    doesntUseHypergates: boolean;
    prefersHypergates: boolean;
    prefersWormholes: boolean;

    /** Maximum player evilness before this govt's warships attack. */
    crimeTol: number;
    /** >0: fine amount; 0: warning only; <0: percent of player's cash. */
    scanFine: number;
    smugPenalty: number;
    disabPenalty: number;
    boardPenalty: number;
    killPenalty: number;
    /** Currently ignored by the game engine. */
    shootPenalty: number;
    initialRec: number;
    /** Max combat odds this govt's ships consider favourable; 100 = 1-to-1. */
    maxOdds: number;

    /** Up to four class numbers this govt belongs to; unused entries omitted. */
    classes: number[];
    /** Class numbers this govt is allied with. */
    allies: number[];
    /** Class numbers this govt is enemies with. */
    enemies: number[];

    /** Skill multiplier for this govt's ships in percent; 100 = stock. */
    skillMult: number;
    /**
     * Matched against mïsn, jünk and oütf ScanMask: any shared 1 bit makes
     * that mission cargo, commodity or outfit illegal to this government.
     */
    scanMask: number;
    /** Shown when ships of this government are hailed. */
    commName: string;
    /** Shown in the target display for this government's ships. */
    targetCode: string;
    /** 64-bit flags and'ed against the player's Contribute bits to land. */
    require: bigint;
    /** Inherent jamming for the four jamming types, 0-100%. */
    inhJam: number[];
    /** Used in "Sensors detect xxx reinforcement fleet approaching." */
    mediumName: string;
    /** Theme colour as 00RRGGBB. */
    color: number;
    /** Ship paint colour as 00RRGGBB; 0 means unpainted. */
    shipColor: number;
    /** ïntf resource id used when flying this govt's ships; <128 means 128. */
    interface: number;
    /** PICT id for the news window background; <128 means the default. */
    newsPic: number;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        this.voiceType = r.int16();

        this.flags = r.uint16();
        this.xenophobic = Boolean(this.flags & 0x0001);
        this.attacksPlayerIfCriminal = Boolean(this.flags & 0x0002);
        this.alwaysAttacksPlayer = Boolean(this.flags & 0x0004);
        this.playerShotsPassThrough = Boolean(this.flags & 0x0008);
        this.warshipsRetreatAt25 = Boolean(this.flags & 0x0010);
        this.ignoredByOtherNosyGovts = Boolean(this.flags & 0x0020);
        this.neverAttacksPlayer = Boolean(this.flags & 0x0040);
        this.freightersHalfJamming = Boolean(this.flags & 0x0080);
        this.persShipsImmortal = Boolean(this.flags & 0x0100);
        this.warshipsTakeBribes = Boolean(this.flags & 0x0200);
        this.cantBeHailed = Boolean(this.flags & 0x0400);
        this.startsDisabled = Boolean(this.flags & 0x0800);
        this.plundersBeforeDestroying = Boolean(this.flags & 0x1000);
        this.freightersTakeBribes = Boolean(this.flags & 0x2000);
        this.planetsTakeBribes = Boolean(this.flags & 0x4000);
        this.largerBribes = Boolean(this.flags & 0x8000);

        this.flags2 = r.uint16();
        this.noAssistOrMercy = Boolean(this.flags2 & 0x0001);
        this.minorMapBoundaries = Boolean(this.flags2 & 0x0002);
        this.noMapBoundaries = Boolean(this.flags2 & 0x0004);
        this.noDistressMessages = Boolean(this.flags2 & 0x0008);
        this.roadsideAssistance = Boolean(this.flags2 & 0x0010);
        this.doesntUseHypergates = Boolean(this.flags2 & 0x0020);
        this.prefersHypergates = Boolean(this.flags2 & 0x0040);
        this.prefersWormholes = Boolean(this.flags2 & 0x0080);

        this.scanFine = r.int16();
        this.crimeTol = r.int16();
        this.smugPenalty = r.int16();
        this.disabPenalty = r.int16();
        this.boardPenalty = r.int16();
        this.killPenalty = r.int16();
        this.shootPenalty = r.int16();
        this.initialRec = r.int16();
        this.maxOdds = r.int16();

        const usedClasses = (classes: number[]) =>
            classes.filter(c => c !== -1);
        this.classes = usedClasses(r.array(4, () => r.int16(-1)));
        this.allies = usedClasses(r.array(4, () => r.int16(-1)));
        this.enemies = usedClasses(r.array(4, () => r.int16(-1)));

        this.skillMult = r.int16();
        this.scanMask = r.uint16();
        this.commName = r.string(16);
        this.targetCode = r.string(16);
        this.require = r.uint64();
        this.inhJam = r.array(4, () => r.int16());
        this.mediumName = r.string(64);
        this.color = r.uint32();
        this.shipColor = r.uint32();
        this.interface = r.int16();
        this.newsPic = r.int16();
    }
}

export { GovtResource };
