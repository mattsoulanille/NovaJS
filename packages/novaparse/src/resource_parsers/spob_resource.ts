import { Resource } from "resource_fork";
import { NovaResources } from "./resource_holder_base.js";
import { BaseResource } from "./nova_resource_base.js";
import { Reader } from "./reader.js";

/**
 * A spöb (stellar object) resource: a planet or space station.
 *
 * Field layout follows ResForge's spöb template (1118 bytes, matching Nova's
 * own data exactly), documented in the EVN Bible pp. 59-62.
 */
class SpobResource extends BaseResource {
    /** Position in the system; (0, 0) is centred. */
    position: number[];
    /**
     * A LINEAR APPROXIMATION of the rlëD id (2000 + Type, less a one-id gap
     * above the missing rlëD 2056). This is only a fallback: Nova actually
     * resolves Type through the spïn (sprite-info) resource at (1000 + Type),
     * whose SpriteID names the real rlëD sprite sheet (EVN Bible p. 13). The
     * rlëD ids are not a contiguous 2000+Type run — e.g. wormholes (Type 59)
     * point at rlëD 2300 — so PlanetParse does the authoritative spïn lookup
     * (it runs after the whole id space is built; the spïn a spöb references
     * may live in a different data file, so a constructor-time lookup here
     * would race the parse order). Callers wanting the true graphic should
     * resolve via spïn and fall back to this.
     */
    graphic: number;
    /**
     * The raw stellar Type (0-based graphic index) as stored, WITHOUT the
     * rlëD gap adjustment applied to `graphic`. Keys the standard landscape
     * PICT at 10000 + type shown when there is no custom landscape.
     */
    type: number;
    /** 32-bit flag set (landability, trade prices, station/bar/... — p. 59). */
    flags: number;
    /** Daily tribute when dominated; 0/-1 = default (1000 x tech level). */
    tribute: number;
    /** Base tech level available here. */
    techLevel: number;
    /** Special tech levels: exactly-matched techs made available here. */
    specialTech: number[];
    /** Owning gövt id; -1 = independent. */
    government: number;
    /** Minimum legal status required to land; -32767 = always, 32767 = never. */
    minStatus: number;
    /** Custom landscape PICT id shown when landed; -1 = standard display. */
    landingPictID: number;
    /** dësc id of the landing description; equals this spöb's own id. */
    landingDescID: number;
    /** 'snd ' id of the ambient sound; -1 = none. */
    ambientSound: number;
    /** düde id of the defence fleet; -1 = none. */
    defenseDude: number;
    /** Number of defence ships, raw; 1000+ is the wave encoding decoded by
     * planet_parse.ts decodeDefenseCount (EVN Bible p. 60). */
    defenseCount: number;
    /** Second 16-bit flag set (animation, hypergate/wormhole, ... — p. 61). */
    flags2: number;
    /**
     * True if flags2 bit 0x1000 is set: landing on this stellar offers travel
     * to one of the linked hypergates (EVN Bible p. 61). Hypergate and wormhole
     * are mutually exclusive in stock data but the flags are independent bits.
     */
    isHypergate: boolean;
    /**
     * True if flags2 bit 0x2000 is set: landing on this stellar transports the
     * player through a wormhole (EVN Bible p. 61). If no HyperLink fields are
     * defined (see `hyperlinks`), the wormhole connects to a random other
     * link-less wormhole; otherwise it exits at one of its linked wormholes.
     */
    isWormhole: boolean;
    /** Frames between animation frames, in 30ths of a second. */
    animationDelay: number;
    /** Multiplier extending the display time of the first animation frame. */
    frame0Bias: number;
    /** spöb ids of hypergate/wormhole destinations; ids < 128 dropped. */
    hyperlinks: number[];
    /** NCB set evaluated when the player dominates this stellar. */
    onDominate: string;
    /** NCB set evaluated when this stellar is released from domination. */
    onRelease: string;
    /** Landing fee deducted from the player's credits. */
    landingFee: number;
    /** Stellar gravity; 0 = none, +pull, -push. */
    gravity: number;
    /** wëap id of the stellar's weapon; -1/0 = none. */
    weapon: number;
    /** Combined mass+energy damage the stellar absorbs; 0/-1 = invulnerable. */
    strength: number;
    /** Type of the destroyed graphic (0-255); -1 = unchanged when destroyed. */
    deadType: number;
    /** Days before a destroyed stellar regenerates; 0 = daily, -1 = never. */
    deadTime: number;
    /**
     * bööm id of the death explosion; null = none. `explosionSparks` is set
     * when the stored value carried the +1000 "explosion + sparks" bias.
     */
    explosion: number | null;
    explosionSparks: boolean;
    /** NCB set evaluated when the stellar is destroyed. */
    onDestroy: string;
    /** NCB set evaluated when the stellar regenerates. */
    onRegen: string;

    constructor(resource: Resource, idSpace: NovaResources) {
        super(resource, idSpace);
        const r = new Reader(this.data);

        this.position = [r.int16(), r.int16()];

        // Linear-approximation fallback only; PlanetParse resolves the real
        // rlëD through the spïn (1000 + Type) indirection. See the `graphic`
        // field doc for why the authoritative lookup can't happen here.
        this.type = r.int16();
        this.graphic = this.type + 2000;
        if (this.graphic > 2058) {
            this.graphic -= 1;
        }

        this.flags = r.uint32();
        this.tribute = r.int16();
        this.techLevel = r.int16();

        // Three special tech slots are stored inline here; the remaining five
        // live near the end of the resource and are appended below.
        this.specialTech = [r.int16(), r.int16(), r.int16()];

        this.government = r.int16(-1);
        this.minStatus = r.int16();
        this.landingPictID = r.uint16();
        this.landingDescID = this.id;

        this.ambientSound = r.int16(-1);
        this.defenseDude = r.int16(-1);
        this.defenseCount = r.int16();
        this.flags2 = r.uint16();
        this.isHypergate = (this.flags2 & 0x1000) !== 0;
        this.isWormhole = (this.flags2 & 0x2000) !== 0;
        this.animationDelay = r.int16();
        this.frame0Bias = r.int16();

        this.hyperlinks = r.array(8, () => r.int16(-1)).filter(id => id >= 128);

        this.onDominate = r.string(0xff);
        this.onRelease = r.string(0xff);
        this.landingFee = r.int32();
        this.gravity = r.int16();
        this.weapon = r.int16(-1);
        this.strength = r.int32();
        this.deadType = r.int16(-1);
        this.deadTime = r.int16();

        let explosion = r.int16(-1);
        this.explosionSparks = explosion >= 1000;
        if (this.explosionSparks) {
            explosion -= 1000;
        }
        this.explosion = explosion === -1 ? null : explosion + 128;

        this.onDestroy = r.string(0xff);
        this.onRegen = r.string(0xff);

        // The remaining five special tech slots (TMPL offset 1092).
        this.specialTech.push(...r.array(5, () => r.int16()));
    }

}



export { SpobResource }
