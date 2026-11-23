import {
    BAR, BBS, GAMBLE, HIRE, LINE_HEIGHT, MISSION_INFO, ROW_HEIGHT, TRADE,
    listRowY, tradeRowIndex,
} from './dialog_layout.js';

/**
 * These pin the geometry against the 1920x1080 original-hardware
 * captures. Everything is centre-anchored, so a constant's screen
 * position is `960 + x` / `540 + y`; each expectation below states the
 * screen pixels the reference shows, so a future edit that drifts the
 * layout fails against the reference rather than against itself.
 *
 * The Button relation used throughout: a Button of width W paints its
 * red pill face at container x+5, W+15 wide, 5px below the container y.
 */
const screenX = (x: number) => 960 + x;
const screenY = (y: number) => 540 + y;
const faceLeft = (x: number) => screenX(x) + 5;
const faceWidth = (w: number) => w + 15;
const faceTop = (y: number) => screenY(y) + 5;

describe('dialog layout', () => {
    it('steps every list pane on the original 12px pitch', () => {
        expect(ROW_HEIGHT).toBe(12);
        expect(LINE_HEIGHT).toBe(12);
        // earth_mission_bbs.png: the five listings' ink caps are 12px
        // apart (y473, 485, 497, 509, 521).
        expect([0, 1, 2, 3, 4].map(i => screenY(listRowY(BBS.list.y, i))))
            .toEqual([470, 482, 494, 506, 518]);
    });

    describe('mission BBS (PICT 8505)', () => {
        it('puts the header strip caption and date where the original does',
            () => {
                // Strip x715..1114, y444..458; caption ink at x719,
                // date ink ending at x1104.
                expect(screenX(BBS.headerStrip.x)).toBe(715);
                expect(screenX(BBS.headerStrip.x) + BBS.headerStrip.width - 1)
                    .toBe(1114);
                expect(screenY(BBS.headerStrip.y)).toBe(444);
                expect(screenX(BBS.headerText.x)).toBe(719);
                expect(screenX(BBS.dateRight)).toBe(1105);
            });

        it('fits twelve 12px rows in the listing pane', () => {
            // x715..924, y470..613 — 144px is exactly twelve rows.
            expect(screenX(BBS.list.x)).toBe(715);
            expect(BBS.list.width).toBe(210);
            expect(screenY(BBS.list.y)).toBe(470);
            expect(BBS.list.rows * ROW_HEIGHT).toBe(BBS.list.height);
            expect(BBS.list.rows).toBe(12);
            expect(screenY(BBS.list.y) + BBS.list.height - 1).toBe(613);
        });

        it('splits the right side into a name pane and a description pane',
            () => {
                // un_shipping_mission.png: x934..1208, y470..494 and
                // y499..593.
                expect(screenX(BBS.titlePane.x)).toBe(934);
                expect(screenX(BBS.titlePane.x) + BBS.titlePane.width - 1)
                    .toBe(1208);
                expect(screenY(BBS.titlePane.y)).toBe(470);
                expect(screenY(BBS.titlePane.y) + BBS.titlePane.height - 1)
                    .toBe(494);
                expect(screenY(BBS.desc.y)).toBe(499);
                expect(screenY(BBS.desc.y) + BBS.desc.height - 1).toBe(593);
                expect(BBS.desc.x).toBe(BBS.titlePane.x);
            });

        it('lands Accept and Leave on the reference pills', () => {
            // Faces x976..1063 and x1078..1165, y615..627.
            expect(faceLeft(BBS.button.accept)).toBe(976);
            expect(faceLeft(BBS.button.accept) + faceWidth(BBS.button.width) - 1)
                .toBe(1063);
            expect(faceLeft(BBS.button.leave)).toBe(1078);
            expect(faceTop(BBS.button.y)).toBe(615);
        });
    });

    describe('mission info (PICT 8517)', () => {
        it('gives the date a strip of its own and centres it there', () => {
            // Caption strip x734..928, date strip x1068..1188, both
            // y467..477; "Nov. 21st, 1177 NC" spans x1084..1172, whose
            // midpoint is the date strip's midpoint.
            expect(screenX(MISSION_INFO.headerStrip.x)).toBe(734);
            expect(screenX(MISSION_INFO.dateStrip.x)).toBe(1068);
            expect(screenX(MISSION_INFO.dateStrip.x)
                + MISSION_INFO.dateStrip.width - 1).toBe(1188);
            expect(screenX(MISSION_INFO.dateCenter)).toBe(1128);
            expect(screenX(MISSION_INFO.dateCenter)).toBe(
                screenX(MISSION_INFO.dateStrip.x)
                + (MISSION_INFO.dateStrip.width - 1) / 2);
        });

        it('fits seven 12px rows in the mission list', () => {
            // x734..928, y487..570.
            expect(screenY(MISSION_INFO.list.y)).toBe(487);
            expect(MISSION_INFO.list.rows).toBe(7);
            expect(MISSION_INFO.list.rows * ROW_HEIGHT)
                .toBe(MISSION_INFO.list.height);
            expect(screenY(MISSION_INFO.list.y)
                + MISSION_INFO.list.height - 1).toBe(570);
        });

        it('spreads Abort and Done to the reference pills', () => {
            // Faces x787..874 and x1020..1107, y593..605.
            expect(faceLeft(MISSION_INFO.button.abort)).toBe(787);
            expect(faceLeft(MISSION_INFO.button.done)).toBe(1020);
            expect(faceLeft(MISSION_INFO.button.done)
                + faceWidth(MISSION_INFO.button.width) - 1).toBe(1107);
            expect(faceTop(MISSION_INFO.button.y)).toBe(593);
        });
    });

    describe('trade center (PICT 8510)', () => {
        it('keeps a fixed slot for each standard commodity', () => {
            // earth_trade_center.png trades five of the six standard
            // commodities and still puts its jünk row on row 6 (ink cap
            // y515), leaving Equipment's row blank.
            expect(TRADE.standardSlots).toBe(6);
            expect(tradeRowIndex(4, 0)).toBe(4);
            expect(tradeRowIndex(undefined, 0)).toBe(6);
            expect(tradeRowIndex(undefined, 1)).toBe(7);
        });

        it('drops jünk rows the extra pixel the original does', () => {
            // Row 0's selection bar is y440..450; row 6's is y513..524,
            // one lower than a plain 12px grid would put it.
            expect(screenY(listRowY(TRADE.listTop, 0))).toBe(440);
            expect(screenY(listRowY(TRADE.listTop, 6, true))).toBe(513);
            expect(screenY(listRowY(TRADE.listTop, 6))).toBe(512);
            expect(TRADE.junkOffset).toBe(1);
        });

        it('puts the four columns where the reference does', () => {
            // Names' ink at x792, quantities right-aligned at x1026,
            // the Low/Med/High word at x1067 (under the "Price:"
            // header, which starts at the same x), prices right-aligned
            // at x1127.
            expect(screenX(TRADE.nameX)).toBe(792);
            expect(screenX(TRADE.quantityRight)).toBe(1026);
            expect(screenX(TRADE.quantityHeaderX)).toBe(1015);
            expect(screenX(TRADE.tierX)).toBe(1067);
            expect(screenX(TRADE.priceRight)).toBe(1127);
        });

        it('rules the pane and indents the summary as the reference does', () => {
            // Two #404040 rules, x785..1136, at y439 and y538 (every
            // trade capture); the summary's ink starts at x790, a pixel
            // right of its origin.
            expect(screenX(TRADE.rules.x)).toBe(785);
            expect(screenX(TRADE.rules.x) + TRADE.rules.width - 1)
                .toBe(1136);
            expect(TRADE.rules.ys.map(screenY)).toEqual([439, 538]);
            expect(screenX(TRADE.summaryX) + 1).toBe(790);
        });

        it('lands Buy / Sell / Done evenly on the reference pills', () => {
            // Buy's face is x812..899 and Done's x1024..1111, y640..652;
            // Sell sits exactly midway.
            expect(faceLeft(TRADE.button.buy)).toBe(812);
            expect(faceLeft(TRADE.button.buy)
                + faceWidth(TRADE.button.width) - 1).toBe(899);
            expect(faceLeft(TRADE.button.done)).toBe(1024);
            expect(TRADE.button.sell - TRADE.button.buy)
                .toBe(TRADE.button.done - TRADE.button.sell);
            expect(faceTop(TRADE.button.y)).toBe(640);
        });
    });

    describe('bar (PICT 8503)', () => {
        it('keeps the grid asymmetric, as the original draws it', () => {
            // Left column faces x840..974 (135 wide), right column
            // x990..1077 (88), rows at y578 and y607.
            expect(faceLeft(BAR.button.columns[0])).toBe(840);
            expect(faceWidth(BAR.button.widths[0])).toBe(135);
            expect(faceLeft(BAR.button.columns[1])).toBe(990);
            expect(faceWidth(BAR.button.widths[1])).toBe(88);
            expect(faceTop(BAR.button.rows[0])).toBe(578);
            expect(faceTop(BAR.button.rows[1])).toBe(607);
        });

        it('starts its description where the original does', () => {
            // Ink at x845, first cap at y461, inside a pane x836..1081.
            expect(screenX(BAR.pane.x)).toBe(836);
            expect(screenX(BAR.pane.x) + BAR.pane.width - 1).toBe(1081);
            expect(screenY(BAR.pane.y)).toBe(453);
        });
    });

    describe('gamble (PICT 8529)', () => {
        it('spaces the four racer PICTs 115px apart, 1:1', () => {
            // The first 100x100 racer fills x738..837, y513..612.
            // The centres land on a half pixel, so the 100px sprite
            // spans 737.5..837.5 and rasterises onto x738..837.
            expect(GAMBLE.slotSize).toBe(100);
            expect(Math.ceil(
                screenX(GAMBLE.slotCentersX[0]) - GAMBLE.slotSize / 2))
                .toBe(738);
            expect(Math.ceil(
                screenY(GAMBLE.slotCenterY) - GAMBLE.slotSize / 2))
                .toBe(513);
            const gaps = GAMBLE.slotCentersX.slice(1).map(
                (x, i) => x - GAMBLE.slotCentersX[i]);
            expect(gaps).toEqual([115, 115, 115]);
        });

        it('lands Help and Cancel on the reference pills', () => {
            // Faces x859..946 and x973..1060, y626..638.
            expect(faceLeft(GAMBLE.button.help)).toBe(859);
            expect(faceLeft(GAMBLE.button.help)
                + faceWidth(GAMBLE.button.width) - 1).toBe(946);
            expect(faceLeft(GAMBLE.button.cancel)).toBe(973);
            expect(faceTop(GAMBLE.button.y)).toBe(626);
        });
    });

    describe('hire escort (the shipyard frame, PICT 8501)', () => {
        it('stacks the two price labels 24px apart', () => {
            // "Hiring Price:" / "You Have:" ink at x1192, caps y598/622.
            expect(screenX(HIRE.label.x)).toBe(1191);
            expect(2 * LINE_HEIGHT).toBe(HIRE.labelPitch);
        });

        it('lands Hire Escort and Done on the reference pills', () => {
            // Faces x948..1045 and x1063..1160, y673..685.
            expect(faceLeft(HIRE.button.hire)).toBe(948);
            expect(faceLeft(HIRE.button.hire)
                + faceWidth(HIRE.button.hireWidth) - 1).toBe(1045);
            expect(faceLeft(HIRE.button.done)).toBe(1063);
            expect(faceTop(HIRE.button.y)).toBe(673);
        });
    });
});
