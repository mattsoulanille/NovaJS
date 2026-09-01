import { NovaResources } from "../resource_parsers/resource_holder_base.js";

/**
 * A shän's EXTRA base sprite set (AltImage) drawn on top of the hull.
 *
 * The display composes a ship out of several rlëD layers (see
 * shan_parse.ts / animation_graphic.ts): the base image, an optional
 * always-drawn alt image, and the additive glow/running-light/weapon
 * overlays. Collision, however, reads hulls off the BASE image's sprite
 * sheet alone (nova's collisions_plugin `hullFromAnimation`), because a
 * SpriteSheet is parsed per rlëD and knows nothing about the shän that
 * assembled it.
 *
 * For most ships that is the same thing — they have no alt image. The
 * Aurora Thunderforge (shän nova:380) is the counter-example: its base
 * image is only the fore and aft sections, and the whole spinning drum
 * between them lives in the alt image. Shots flew straight through the
 * middle of the ship.
 *
 * This map lets the sprite-sheet parser find the alt layer belonging to a
 * base image so the two can be unioned into one hull.
 */
export interface HullOverlayEntry {
    /** rlëD global id of the overlay sheet (the shän's AltImage). */
    overlayId: string;
    /**
     * shän FramesPer — sprite frames in one full rotation. The overlay
     * sheet holds `setCount` consecutive sets of this many frames, and
     * which set is on screen is driven by time (a continuous animation)
     * or by fold state, NOT by the ship's heading. So the hull for a
     * given heading is the union of the overlay's frame at that heading
     * across every set.
     */
    framesPer: number;
}

export type HullOverlayMap = { [baseImageGlobalId: string]: HullOverlayEntry };

/**
 * Which alt-image sheet (if any) belongs to each base-image sheet.
 *
 * A base rlëD is routinely shared by many shäns — stock Nova has rlëD
 * nova:1048 behind sixteen different shäns — while hulls are cached per
 * rlëD, so one sheet cannot carry two different overlays. An entry is
 * therefore emitted only when EVERY shän using that base image agrees on
 * the same overlay and FramesPer; a disagreement (a plug-in adding an alt
 * image to a shän that reuses a stock base sheet, say) leaves the base
 * image with no overlay rather than silently inflating the hitboxes of
 * the other ships that share it.
 *
 * Purely a function of the id space, so every peer computes the same map
 * from the same data files — collision geometry has to match across
 * clients.
 */
export function makeHullOverlayMap(idSpace: NovaResources): HullOverlayMap {
    // baseId -> overlay signature, or null once two shäns disagree.
    const candidates = new Map<string, HullOverlayEntry | null>();

    for (const shanGlobalId of Object.keys(idSpace.shän).sort()) {
        const shan = idSpace.shän[shanGlobalId];
        const baseId = shan.idSpace.rlëD[shan.images.baseImage.ID]?.globalID;
        if (!baseId) {
            continue; // No base sheet: nothing to attach an overlay to.
        }

        let entry: HullOverlayEntry | null = null;
        const alt = shan.images.altImage;
        const overlayId = alt
            ? shan.idSpace.rlëD[alt.ID]?.globalID : undefined;
        if (overlayId && shan.framesPer > 0) {
            entry = { overlayId, framesPer: shan.framesPer };
        }

        if (!candidates.has(baseId)) {
            candidates.set(baseId, entry);
            continue;
        }
        const existing = candidates.get(baseId);
        if (!sameOverlay(existing, entry)) {
            candidates.set(baseId, null); // Conflict: no overlay at all.
        }
    }

    const map: HullOverlayMap = {};
    for (const [baseId, entry] of candidates) {
        if (entry) {
            map[baseId] = entry;
        }
    }
    return map;
}

function sameOverlay(a: HullOverlayEntry | null | undefined,
    b: HullOverlayEntry | null | undefined): boolean {
    if (!a || !b) {
        return !a && !b;
    }
    return a.overlayId === b.overlayId && a.framesPer === b.framesPer;
}

/**
 * The overlay frames that must be unioned into the hull of base frame
 * `baseFrame`: the overlay's frame at the same heading in every one of
 * its animation sets.
 *
 * The overlay's set index is chosen by the display from the clock (shän
 * flag 0x0008, "shown in sequence like the alt image") or from fold
 * progress — never from the ship's heading — while the hull is indexed by
 * heading alone (nova's `getFrameFromMovement`). One hull per heading
 * therefore has to cover the whole spin cycle.
 */
export function overlayFramesForBaseFrame(baseFrame: number,
    framesPer: number, overlayFrameCount: number): number[] {
    if (framesPer <= 0 || overlayFrameCount <= 0) {
        return [];
    }
    const heading = ((baseFrame % framesPer) + framesPer) % framesPer;
    const frames: number[] = [];
    for (let frame = heading; frame < overlayFrameCount; frame += framesPer) {
        frames.push(frame);
    }
    return frames;
}
