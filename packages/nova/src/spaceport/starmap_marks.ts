// The starmap's mission indicators: the original game's own cicn icons
// placed beside active-mission and BBS-viewed destination systems.
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { MissionMapMark } from "../nova_plugin/missions/mission_logic.js";
import { scalePos, SYSTEM_RADIUS } from "./starmap_viewport.js";

// Active-mission markers use the original game's own icons: the ORANGE
// cicn 15000 on active-mission destination/ship systems (mission_bbs/
// notes.txt) and the GREEN cicn 15001 on the destinations of the mission
// being viewed in the Mission BBS. The green art mirrors the orange (they
// point down-right and down-left respectively), so the two marks can flank
// a shared system from opposite sides. Placement in placeMarkIcon.
// Exported because the hypergate map (gate_map.ts) draws the same active
// marks on the same SystemGraph.
export const MISSION_MARK_ACTIVE_CICN = 'nova:15000';
export const MISSION_MARK_VIEWED_CICN = 'nova:15001';

/** The original game's mission-mark icons (cicn 15000 orange / 15001
 * green). */
export interface MissionMarkTextures {
    active: PIXI.Texture,
    viewed: PIXI.Texture,
}

/**
 * Builds the active-mission markers using the original game's own cicn
 * icons: cicn 15000 (orange) on active-mission systems and cicn 15001
 * (green) on the destinations of the mission being viewed in the BBS
 * (mission_bbs/notes.txt). Additive and decorative: meant to be baked into
 * the map container like the circles, so the sprites pan/zoom with them and
 * never intercept clicks. Marks whose system is NCB-hidden (not in
 * `systems`) are skipped; marks on unexplored systems still render. When no
 * icons were preloaded (standalone/test graphs), or there are no marks,
 * nothing is built and undefined is returned.
 */
export function buildMissionMarks(systems: ReadonlyMap<string, SystemData>,
    missionMarks: readonly MissionMapMark[],
    viewedMarks: readonly MissionMapMark[],
    textures: MissionMarkTextures | undefined): PIXI.Container | undefined {
    if (!textures) {
        return undefined;
    }
    if (missionMarks.length === 0 && viewedMarks.length === 0) {
        return undefined;
    }
    const container = new PIXI.Container();
    for (const mark of missionMarks) {
        // The orange icon points DOWN-RIGHT (tip at its lower-right
        // corner): it sits above-left of the system dot, aimed at it
        // (mission_bbs/accepted_un_mission_orange_mark...png).
        placeMarkIcon(container, systems.get(mark.systemId),
            textures.active, 1);
    }
    for (const mark of viewedMarks) {
        // The green icon is the mirrored art pointing DOWN-LEFT (tip at
        // its lower-left corner): it sits above-right of the dot, so
        // both icons stay legible when a system has an active AND a
        // viewed mission on it (mission_bbs/notes.txt,
        // selected_mission_destination_green_mark.png).
        placeMarkIcon(container, systems.get(mark.systemId),
            textures.viewed, 0);
    }
    return container;
}

/** Places one mission-mark cicn sprite beside a system, its pointed tip
 * anchored just outside the system circle on the upper diagonal it aims
 * along. `tipAnchorX` is the tip's corner within the art: 1 = lower-right
 * (the orange down-right arrow, placed above-left of the dot), 0 =
 * lower-left (the green down-left arrow, placed above-right).
 * Non-interactive and unscaled, so it reads at its native size. Nothing is
 * placed for a system that is not on the map. */
function placeMarkIcon(container: PIXI.Container,
    system: SystemData | undefined,
    texture: PIXI.Texture, tipAnchorX: number) {
    if (!system) {
        return;
    }
    const [x, y] = scalePos(system.position);
    const sprite = new PIXI.Sprite(texture);
    sprite.eventMode = 'none';
    sprite.anchor.set(tipAnchorX, 1);
    const dx = tipAnchorX === 1 ? -SYSTEM_RADIUS : SYSTEM_RADIUS;
    sprite.position.set(x + dx, y - SYSTEM_RADIUS);
    container.addChild(sprite);
}
