// How the starmap paints: the colors and line weights measured off the
// original, the shared bitmap label font, and the painters for system dots,
// lanes and the route / destination-picker overlays. (Government territory
// has its own module, starmap_borders.ts.)
// Every painter draws into a caller-supplied PIXI.Graphics at laid-out
// coordinates (starmap_viewport.ts scalePos) and knows nothing about
// which systems exist or which are selected — SystemGraph decides that.
import { SystemData } from "novadatainterface/system_data";
import * as PIXI from 'pixi.js';
import { displayName } from "../nova_plugin/core/index.js";
import { BASE_SCALE, scalePos, SYSTEM_RADIUS } from "./starmap_viewport.js";

const GREY = 0x666666;
// System-dot colors, sampled off the original at 1:1 in
// ui_screenshots/original_macos_screenshots/map/govt_borders.png (see
// drawSystem for the rule each one encodes). All four share one black
// interior.
/** An EXPLORED system that has at least one port. */
export const SYSTEM_INHABITED_COLOR = 0x0000ff;
/** An EXPLORED system with no port. */
export const SYSTEM_UNINHABITED_COLOR = 0xc6c6c6;
/** A system the player has never entered — nothing is known about it. */
export const SYSTEM_UNEXPLORED_COLOR = 0x424242;
/** An EXPLORED system whose every port would refuse the player's landing
 * (reference "Map dot colours, wave 23", Kit Map Wanted, 1:1 ring pixels). */
export const SYSTEM_REFUSING_COLOR = 0xff0000;
export const SYSTEM_INTERIOR_COLOR = 0x000000;
// Hypergate network links, drawn in a distinct cyan so the instant-travel
// hypergate routes read apart from the grey normal-jump hyperspace links.
export const HYPERGATE_LINK_COLOR = 0x00cccc;
// Route colors (map/notes.txt): the multi-jump route is the STRONGER green
// line; the single-jump route is the WEAKER one.
const ROUTE_MULTI_COLOR = 0x00ff00;
const ROUTE_MULTI_WIDTH = 3;
const ROUTE_SINGLE_COLOR = 0x00b400;
const ROUTE_SINGLE_WIDTH = 1;
/** The minimap's route (mini_map.png): a thin (1-2px) green line laid
 * along the grey lane, for both kinds of route. */
const MINI_ROUTE_WIDTH = 2;
const SELECT_COLOR = 0x00ff00;
/**
 * The filled centre of the CURRENT system's dot: #00adef, sampled on both
 * maps — Sol in govt_borders.png and Tau Ceti in mini_map/mini_map.png
 * (a 4px disc inside the black interior).
 */
export const CURRENT_SYSTEM_CENTER_COLOR = 0x00adef;
const LABEL_FONT_NAME = 'StarmapSystemLabel';
const LABEL_FONT_SIZE = 10;

// Rendering every system name as its own PIXI.Text gives each label a
// distinct texture, which overwhelms the renderer's texture batching (the map
// dropped to ~4 FPS with 631 labels). A shared bitmap font lets all labels
// batch into a single draw call, and generating the glyph atlas once up front
// avoids the multi-hundred-ms rasterization hitch (which stalled the main
// thread long enough to desync the simulation) the first time the map
// rendered.
/** The glyphs the installed label font holds (see installLabelFont). */
let installedLabelChars = new Set<string>();

export function installLabelFont(systems: SystemData[]) {
    // BitmapFont rasterizes glyphs through a DOM canvas. In a headless
    // context (Node unit/integration tests) there's no document, so skip the
    // atlas; label BitmapText is likewise skipped when the font is absent.
    // Clicks resolve from clickTargets' coordinates, not the labels, so
    // hit-testing is unaffected.
    if (typeof document === 'undefined') {
        return;
    }
    const chars = new Set<string>([' ', ...installedLabelChars]);
    for (const system of systems) {
        for (const char of system.name) {
            chars.add(char);
        }
    }
    // Several maps share the one font — the full map and the in-flight
    // minimap can both be up — and uninstalling it destroys the glyph
    // pages every live label points at. So the font only ever GROWS: an
    // install that adds no new glyph is skipped, and one that does keeps
    // every glyph it had.
    if (PIXI.BitmapFont.available[LABEL_FONT_NAME]) {
        if (chars.size === installedLabelChars.size) {
            return;
        }
        PIXI.BitmapFont.uninstall(LABEL_FONT_NAME);
    }
    installedLabelChars = chars;
    PIXI.BitmapFont.from(LABEL_FONT_NAME, {
        fontFamily: 'Geneva',
        fontSize: LABEL_FONT_SIZE,
        fill: 0xffffff,
    }, {
        chars: [...chars],
        // Rasterize at double size so labels stay reasonably crisp when the
        // map is zoomed in.
        resolution: 2,
    });
}

/** Whether the shared label font is installed (it is not in a headless test
 * context, where installLabelFont is a no-op). */
export function labelFontReady(): boolean {
    return !!PIXI.BitmapFont.available[LABEL_FONT_NAME];
}

/** A system's name label in the shared bitmap font, beside its dot. */
export function makeSystemLabel(system: SystemData, x: number, y: number)
    : PIXI.BitmapText {
    const label = new PIXI.BitmapText(displayName(system.name), {
        fontName: LABEL_FONT_NAME,
        fontSize: LABEL_FONT_SIZE,
    });
    label.position.set(x + 10, y);
    label.anchor.set(0, 0.5);
    return label;
}

/**
 * The color of a system's dot on the map. THREE questions, in this order —
 * the first two measured on the original at 1:1 in
 * ui_screenshots/original_macos_screenshots/map/govt_borders.png, whose 40
 * dots were matched back to sÿst ids through the map's own layout:
 *
 *  1. HAS THE PLAYER EXPLORED IT? Every one of the 22 dark grey (#424242)
 *     dots is an unlabeled system, and every labeled system is either blue
 *     or light grey. Unexplored systems are drawn dim whatever is in them:
 *     Sirius (2 ports), Aldebaran (3) and Gefjon (2) are all #424242 there.
 *     This is what keeps a "secret" installation secret — an inhabited
 *     station in a system the player has never entered does not advertise
 *     itself on the map.
 *
 *  2. IS IT INHABITED? An explored system is BLUE iff it contains at least
 *     one PORT — a stellar that is landable (spöb Flags 0x0001) AND not
 *     uninhabited (0x0020 clear); see landable.ts isPort, which is also
 *     what fills the "Ports:" readout. All 15 blue dots have >= 1 port and
 *     all 3 light grey (#c6c6c6) ones have none. Landability alone is NOT
 *     enough: HJG-1034's UHP-0474 and Procyon's UHP-1002 are both landable
 *     but flagged uninhabited, and both systems draw light grey.
 *
 *     A WORKING HYPERGATE IS NOT A SETTLEMENT (reference "Map dot colours,
 *     wave 23"): VNP-001 and VNP-002, whose only stellar is a working gate,
 *     and Vellos (gate + an uninhabited planet) are #c6c6c6, although the
 *     gate is a port in the Ports line. landable.ts systemIsInhabited.
 *
 *  3. DOES IT LET THE PLAYER LAND? An inhabited system whose every port
 *     would refuse the player's landing (the landing-clearance rule of
 *     stellar_clearance.ts: MinStatus, a travel permit, a ränk 0x0200
 *     override, a bribe, a mission destination) is RED, #ff0000. Measured
 *     on one system, Kit Map Wanted (record -500, its only port MinStatus
 *     0, "Docking request denied."), red from a neighbour and as the current
 *     system. GUESS: a mixed system (one port open) stays blue; see
 *     landable.ts systemRefusesLanding.
 *
 * NOT THE LEGAL STATUS WORD, NOR THE GOVERNMENT'S FLAGS (Matthew's playtest,
 * 2026-11-24: "the system does not like me, but it's still blue instead of
 * orange or red", South Manchester at "Criminal"). A bad record alone does
 * not redden a dot whose ports still let the player land, measured twice:
 *  - CURRENT system, hostile: reference "A14" cell c1 (A14 Own, record -500
 *    against CrimeTol 10, the map reads "Legal Status: Criminal" and the
 *    owner's warships open fire, but its port is MinStatus -32767): the
 *    ring is #0000ff, the centre #00adef
 *    (evidence 20261123-a14/c1/.../01-map.png);
 *  - a NON-current system past tolerance: "A14 wave 15" unowned run, Kit
 *    Spread Unowned selected at "Minor Offender" (record below -CrimeTol):
 *    #0000ff (evidence 20261124-w15/unowned/.../06-map2.png).
 * And a govt hostile by its FLAGS (gövt 0x0004 always-attacks, 0x0001
 * xenophobic) leaves its systems blue (wave 23, Kit Map Attacks / Kit Map
 * Xeno, as neighbours and as the current system).
 *
 * Rule 2's corner — a stellar that is inhabited but NOT landable, as in the
 * four stock Wraith systems (sÿst 510/521/582/593) — was measured on the
 * original with a test system (docs/reference_experiments.md, "M5
 * leftover: which systems radiate borders", sÿst 2156 Map B Unland, spöb
 * Flags 0x0002): its dot is light grey (#c6c6c6), so the dot really is
 * showing ports. Its Show Borders territory is a different question with a
 * different answer — it DOES radiate, because the border asks "is anybody
 * there?" (landable.ts systemHasInhabitedStellar, starmap_borders.ts).
 *
 * WHY 0x0020 AND NOT THE STELLAR'S GOVERNMENT (Matthew, 2026-09-02, "why is
 * Heraan Hiro grey? it has a station with a mission BBS"). Every reference
 * capture is centred on Sol or Kania, so nothing measures the Auroran half of
 * the galaxy, and rule 2 has a rival that the screenshots alone cannot rule
 * out: "landable AND (0x0020 clear OR the stellar has a government)". That
 * rule would flip Heraan Hiro (sÿst 340) blue, because its lone stellar
 * Mortosch (spöb 357, Flags 0x00000031 = land + station + uninhabited, no
 * service bits, TechLevel -1) belongs to gövt 135 Family Heraan.
 *
 * The stock data refutes it anyway, in New Ireland's four-state story arc —
 * one planet, one government, four spöbs the NCB swaps between:
 *
 *   Tuatha nova:185 (!b850)        New Ireland 139  0x1041224f  tech 5
 *   Tuatha nova:762 (b850 & !b851) New Ireland 506  0x10012221  tech 0
 *   Tuatha nova:763 (b851 & !b852) New Ireland 507  0x40201443  tech 5
 *   Tuatha nova:764 (b852)         New Ireland 508  0x1001224f  tech 5
 *
 * gövt 144 throughout; what moves is 0x0020 and the service bits, as the
 * world is devastated and then rebuilt. If a government overrode 0x0020 the
 * depopulated state would still draw blue, and the arc would say nothing.
 * 0x0020 IS the habitation switch, and the government is orthogonal to it.
 *
 * So a landable, uninhabited, serviceless station draws grey even though its
 * spaceport still opens and its Mission BBS still lists work. That is not an
 * inconsistency: no spöb flag governs the Mission BBS at all (the Flags word
 * has bits for the commodity exchange, outfitter, shipyard and bar and none
 * for the mission computer), so the BBS button is unconditional on every
 * landable stellar, and the missions Mortosch offers reach it through
 * AvailStel 10007, "a stellar of gövt 135" — a selector the Bible does not
 * habitation-filter, unlike AvailStel -1 "any inhabited stellar". A BBS with
 * missions on it is therefore no evidence of habitation.
 */
export function systemDotColor(explored: boolean,
    inhabited: boolean, refusesLanding = false): number {
    if (!explored) {
        return SYSTEM_UNEXPLORED_COLOR;
    }
    if (!inhabited) {
        return SYSTEM_UNINHABITED_COLOR;
    }
    return refusesLanding ? SYSTEM_REFUSING_COLOR : SYSTEM_INHABITED_COLOR;
}

export function drawSystem(graphics: PIXI.Graphics,
    x: number, y: number, explored: boolean, inhabited: boolean,
    refusesLanding = false) {
    const outColor = systemDotColor(explored, inhabited, refusesLanding);
    graphics.lineStyle(1, outColor);
    graphics.beginFill(outColor);
    graphics.drawCircle(x, y, SYSTEM_RADIUS);
    graphics.beginFill(SYSTEM_INTERIOR_COLOR);
    graphics.drawCircle(x, y, 1.8 * BASE_SCALE);
    graphics.endFill();
}

export function drawLink(graphics: PIXI.Graphics, a: SystemData, b: SystemData,
    color = GREY, thickness = 1) {
    graphics.lineStyle(thickness, color);
    graphics.moveTo(...scalePos(a.position));
    graphics.lineTo(...scalePos(b.position));
}

/**
 * Draws the hyperspace lanes, then the hypergate network links over them in
 * a distinct color so the instant-travel routes are legible as their own
 * layer.
 */
export function drawLinks(graphics: PIXI.Graphics,
    links: readonly [SystemData, SystemData][],
    gateLinks: readonly [SystemData, SystemData][]) {
    graphics.clear();
    for (const [source, dest] of links) {
        drawLink(graphics, source, dest);
    }
    for (const [source, dest] of gateLinks) {
        drawLink(graphics, source, dest, HYPERGATE_LINK_COLOR, 1);
    }
}

/** What the route overlay shows, already resolved to systems on the map. */
export interface RouteOverlay {
    /** The system the player is in (absent if not on the map). */
    current?: SystemData;
    /** The single-jump destination, if one is set and on the map. */
    single?: SystemData;
    /** The expanded multi-jump route, in order, systems on the map only. */
    multi: SystemData[];
    /** The pinned waypoints that are on the map. */
    pinned: SystemData[];
    /** The inspected system, when it is not the current one. */
    info?: SystemData;
    /** Paint in the minimap's style (SystemGraphOptions.miniMap): thin
     * route lines, no pinned-waypoint boxes, and no dashed ring round the
     * current system. */
    miniMap?: boolean;
}

/**
 * Draws the route overlay: the WEAK single-jump line, the STRONG
 * multi-jump line over it, pinned-waypoint boxes, the current system's
 * ring, and the properties-selection brackets.
 */
export function drawRouteOverlay(g: PIXI.Graphics, route: RouteOverlay) {
    g.clear();
    const mini = route.miniMap ?? false;

    // Single-jump route: the weaker green line.
    if (route.single && route.current) {
        drawLink(g, route.current, route.single,
            ROUTE_SINGLE_COLOR, mini ? MINI_ROUTE_WIDTH : ROUTE_SINGLE_WIDTH);
    }

    // Multi-jump route: the stronger green line, over the single one.
    let prev = route.current;
    for (const system of route.multi) {
        if (prev) {
            drawLink(g, prev, system, ROUTE_MULTI_COLOR,
                mini ? MINI_ROUTE_WIDTH : ROUTE_MULTI_WIDTH);
        }
        prev = system;
    }

    // Pinned waypoints: a small green box marks each explicitly
    // selected system (they always stay in the route). Not on the
    // minimap, which cannot edit them and shows only the route itself.
    for (const system of mini ? [] : route.pinned) {
        const [x, y] = scalePos(system.position);
        const r = SYSTEM_RADIUS + 2;
        g.lineStyle(1, ROUTE_MULTI_COLOR);
        g.drawRect(x - r, y - r, 2 * r, 2 * r);
    }

    // The current system: a cyan centre on both maps, and on the full map
    // a dashed green ring as well (the original's marker).
    if (route.current) {
        const [cx, cy] = scalePos(route.current.position);
        g.lineStyle(0);
        g.beginFill(CURRENT_SYSTEM_CENTER_COLOR);
        g.drawCircle(cx, cy, 1.1 * BASE_SCALE);
        g.endFill();
    }
    if (route.current && !mini) {
        const [x, y] = scalePos(route.current.position);
        const r = SYSTEM_RADIUS + 2.5;
        g.lineStyle(1.2, SELECT_COLOR);
        const segments = 8;
        for (let i = 0; i < segments; i++) {
            const a0 = (i * 2 * Math.PI) / segments;
            const a1 = a0 + Math.PI / segments;
            g.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0));
            g.arc(x, y, r, a0, a1);
        }
    }

    // The inspected system: green corner brackets around it.
    if (route.info) {
        const [x, y] = scalePos(route.info.position);
        const r = SYSTEM_RADIUS + 3;
        const arm = 3;
        g.lineStyle(1, SELECT_COLOR);
        for (const [sx, sy] of
            [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
            g.moveTo(x + sx * r - sx * arm, y + sy * r);
            g.lineTo(x + sx * r, y + sy * r);
            g.lineTo(x + sx * r, y + sy * r - sy * arm);
        }
    }
}

/**
 * Draws the destination-picker overlay on the route layer: a ring around
 * each offered system, and a filled highlight on the picked one.
 */
export function drawSelectionOverlay(g: PIXI.Graphics,
    offered: readonly { system: SystemData, picked: boolean }[]) {
    g.clear();
    for (const { system, picked } of offered) {
        const [x, y] = scalePos(system.position);
        g.lineStyle(picked ? 2 : 1, picked ? 0x00ff00 : HYPERGATE_LINK_COLOR);
        g.drawCircle(x, y, SYSTEM_RADIUS + 3);
    }
}
