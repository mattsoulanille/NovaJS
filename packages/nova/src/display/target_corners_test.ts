import 'jasmine';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import * as PIXI from 'pixi.js';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { Entity } from 'nova_ecs/entity';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { DisabledComponent, TargetComponent } from '../nova_plugin/ship/index.js';
import { GovtComponent } from '../nova_plugin/core/index.js';
import {
    FormationComponent, NpcComponent, ShootAllWeaponsComponent,
} from '../nova_plugin/npc/index.js';
import { EscortCommandComponent } from '../nova_plugin/player/index.js';
import { LegalRecordsComponent } from '../nova_plugin/reputation/index.js';
import {
    cornerAnchorOffset, cornersSweepSystem, FLY_IN_EXTRA_WIDTH, FLY_IN_MS,
    GLYPH_INSET, styleForTarget, TargetCorners,
} from './target_corners_plugin.js';

const PLAYER = 'player uuid';

/**
 * A system owned by govt nova:370, the K9 run's lawful govt: a criminal
 * record counts by the law of the system it is in (reference A14), so the
 * record-hostility specs below stand in this one.
 */
const OWN_370_SYSTEM = 'nova:2110';

/** A gameData stub exposing only the Govt / System getCached the rule
 * reads. */
function mockGameData(govts: { [id: string]: GovtData | undefined }) {
    return {
        data: {
            Govt: {
                getCached: (id: string) => govts[id],
            },
            System: {
                getCached: (id: string) => id === OWN_370_SYSTEM
                    ? { govt: 'nova:370' } : undefined,
            },
        },
    } as never;
}

function govt(over: Partial<GovtData>): GovtData {
    return { ...getDefaultGovtData(), ...over };
}

describe('styleForTarget (target corner selection)', () => {
    const pirates = govt({ id: 'nova:137' });
    pirates.flags.xenophobic = true;
    const civilians = govt({ id: 'nova:157' });
    const gameData = mockGameData({
        'nova:137': pirates,
        'nova:157': civilians,
    });
    const player = new Entity('player');

    /**
     * Runs the rule for `entities[uuid]` with the rest as the world, at
     * sim time `now` (the aggression tier's clock; irrelevant to the
     * political and NPC-posture tiers, so it defaults to 0).
     */
    function style(uuid: string, entities: { [uuid: string]: Entity },
        playerEntity = player, now = 0) {
        return styleForTarget(uuid, entities[uuid], PLAYER, playerEntity,
            gameData, u => entities[u], now, undefined);
    }

    it('shows neutral corners for a trader going about its business', () => {
        const trader = new Entity('trader')
            .addComponent(GovtComponent, { id: 'nova:157' })
            .addComponent(NpcComponent, { aiType: 1, mode: 'travel' });
        expect(style('trader', { trader })).toBe('neutral');
    });

    it('shows hostile corners for a pirate (xenophobic govt), even when ' +
        'it is busy attacking someone else', () => {
            const pirate = new Entity('pirate')
                .addComponent(GovtComponent, { id: 'nova:137' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'attack' })
                .addComponent(TargetComponent, { target: 'someone else' });
            expect(style('pirate', { pirate })).toBe('hostile');
        });

    it('shows hostile corners for a neutral-govt ship currently attacking ' +
        'the player (brave trader fighting back)', () => {
            const trader = new Entity('brave trader')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 2, mode: 'attack' })
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style('trader', { trader })).toBe('hostile');
        });

    it('keeps neutral corners for a ship merely fleeing the player', () => {
        const trader = new Entity('wimpy trader')
            .addComponent(GovtComponent, { id: 'nova:157' })
            .addComponent(NpcComponent, {
                aiType: 1, mode: 'flee', aggressor: PLAYER,
            })
            .addComponent(TargetComponent, { target: PLAYER });
        expect(style('trader', { trader })).toBe('neutral');
    });

    it('keeps neutral corners for an attacker whose target is not the ' +
        'player', () => {
            const warship = new Entity('warship')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'attack' })
                .addComponent(TargetComponent, { target: 'someone else' });
            expect(style('warship', { warship })).toBe('neutral');
        });

    it('shows hostile corners for a legacy dev enemy (ShootAllWeapons) ' +
        'targeting the player', () => {
            const enemy = new Entity('dev enemy')
                .addComponent(ShootAllWeaponsComponent, undefined)
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style('enemy', { enemy })).toBe('hostile');
        });

    it("shows hostile corners for another player's escort ordered onto us "
        + "('f' = command attack), before it has fired", () => {
            const escort = new Entity('their escort')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1 })
                .addComponent(EscortCommandComponent,
                    { command: 'attack', target: PLAYER })
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style('escort', { escort })).toBe('hostile');
        });

    it("shows hostile corners for another player's escort DEFENDING "
        + "against us", () => {
            const escort = new Entity('their escort')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1 })
                .addComponent(EscortCommandComponent,
                    { command: 'defend', target: PLAYER })
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style('escort', { escort })).toBe('hostile');
        });

    it("keeps neutral corners for another player's escort DEFENDING "
        + "against a THIRD party (review r15 C1)", () => {
            const escort = new Entity('their escort')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1 })
                .addComponent(EscortCommandComponent,
                    { command: 'defend', target: 'some-pirate' })
                .addComponent(TargetComponent, { target: 'some-pirate' });
            expect(style('escort', { escort })).toBe('neutral');
        });

    it("keeps neutral corners for another player's escort attacking "
        + "someone else, or merely in formation", () => {
            const busy = new Entity('their escort')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1 })
                .addComponent(EscortCommandComponent,
                    { command: 'attack', target: 'someone-else' })
                .addComponent(TargetComponent, { target: 'someone-else' });
            expect(style('busy', { busy })).toBe('neutral');
            const idle = new Entity('their escort')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 1 })
                .addComponent(EscortCommandComponent, { command: 'formation' })
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style('idle', { idle })).toBe('neutral');
        });

    it('shows friendly corners for a ship sharing the player government',
        () => {
            const playerWithGovt = new Entity('player')
                .addComponent(GovtComponent, { id: 'nova:157' });
            const wingman = new Entity('wingman')
                .addComponent(GovtComponent, { id: 'nova:157' })
                .addComponent(NpcComponent, { aiType: 3, mode: 'patrol' });
            expect(style('wingman', { wingman }, playerWithGovt))
                .toBe('friendly');
        });

    it('shows neutral corners while govt data is not yet cached', () => {
        const unknown = new Entity('unknown')
            .addComponent(GovtComponent, { id: 'nova:999' });
        expect(style('unknown', { unknown })).toBe('neutral');
    });

    it("shows friendly corners for the player's own hired escort, " +
        'whatever its government', () => {
            const escort = new Entity('escort')
                .addComponent(GovtComponent, { id: 'nova:137' }) // pirate!
                .addComponent(FormationComponent,
                    { leader: PLAYER, slot: 0 });
            expect(style('escort', { escort })).toBe('friendly');
        });

    it("shows friendly corners for an escort's own bay fighter " +
        '(transitive flock)', () => {
            const escort = new Entity('escort')
                .addComponent(FormationComponent,
                    { leader: PLAYER, slot: 0 });
            const fighter = new Entity('fighter')
                .addComponent(FormationComponent,
                    { leader: 'escort', slot: 0 });
            expect(style('fighter', { escort, fighter })).toBe('friendly');
        });

    it('shows the gray disabled corners regardless of politics', () => {
        // A pirate actively attacking the player... but disabled: gray.
        const pirate = new Entity('pirate')
            .addComponent(GovtComponent, { id: 'nova:137' })
            .addComponent(NpcComponent, { aiType: 3, mode: 'attack' })
            .addComponent(TargetComponent, { target: PLAYER })
            .addComponent(DisabledComponent, { repairAt: null });
        expect(style('pirate', { pirate })).toBe('disabled');
    });

    it('shows disabled corners even for own-flock ships', () => {
        const escort = new Entity('escort')
            .addComponent(FormationComponent, { leader: PLAYER, slot: 0 })
            .addComponent(DisabledComponent, { repairAt: null });
        expect(style('escort', { escort })).toBe('disabled');
    });

    it("an NPC fleet escort (someone else's flock) is not friendly", () => {
        const npcLeader = new Entity('npc leader')
            .addComponent(GovtComponent, { id: 'nova:137' })
            .addComponent(NpcComponent, { aiType: 3, mode: 'patrol' });
        const npcEscort = new Entity('npc escort')
            .addComponent(GovtComponent, { id: 'nova:137' })
            .addComponent(NpcComponent, { aiType: 3, mode: 'patrol' })
            .addComponent(FormationComponent,
                { leader: 'npc leader', slot: 0 });
        expect(style('npc escort',
            { 'npc leader': npcLeader, 'npc escort': npcEscort }))
            .toBe('hostile');
    });
});

/**
 * Reference K9 (docs/reference_experiments.md) and Matthew's ruling
 * (2026-11-23): "IFF bracket colors correspond to hostility regardless of
 * govt's stance." On the original, the AI 1 traders of a govt hostile to
 * the player — by gövt 0x0004 "always attacks player" or by the player's
 * criminal record — have YELLOW brackets until they attack, while the same
 * govt's warships, which do attack, are red. The brackets now read the NPC
 * brain's own on-sight predicate (on_sight.ts's attacksOnSight).
 */
describe('styleForTarget: hostility is the ship\'s, not its govt\'s (K9)',
    () => {
        const alwaysAttacks = govt({ id: 'nova:362' });
        alwaysAttacks.flags.alwaysAttacksPlayer = true;
        const owner = govt({ id: 'nova:370', crimeTol: 10 });
        const pirates = govt({ id: 'nova:137' });
        pirates.flags.xenophobic = true;
        const gameData = mockGameData({
            'nova:362': alwaysAttacks, 'nova:370': owner,
            'nova:137': pirates,
        });
        const plainPlayer = new Entity('player');
        // -500 with govt 370, as in the K9 run: "Criminal" at CrimeTol 10.
        const criminalPlayer = new Entity('player')
            .addComponent(LegalRecordsComponent,
                new Map([['nova:370', -500]]));

        function ship(govtId: string, aiType: number,
            mode: 'travel' | 'patrol' | 'attack' = 'travel') {
            return new Entity('ship')
                .addComponent(GovtComponent, { id: govtId })
                .addComponent(NpcComponent, { aiType, mode });
        }
        function style(target: Entity, playerEntity: Entity,
            extra: { [uuid: string]: Entity } = {}) {
            const entities: { [uuid: string]: Entity } =
                { target, ...extra };
            return styleForTarget('target', target, PLAYER, playerEntity,
                gameData, u => entities[u], 0, OWN_370_SYSTEM);
        }

        it('gövt 0x0004: an AI 1 trader is neutral, a warship hostile', () => {
            expect(style(ship('nova:362', 1), plainPlayer)).toBe('neutral');
            expect(style(ship('nova:362', 3, 'patrol'), plainPlayer))
                .toBe('hostile');
        });

        it('criminal record: an AI 1 trader is neutral, a warship hostile',
            () => {
                expect(style(ship('nova:370', 1), criminalPlayer))
                    .toBe('neutral');
                expect(style(ship('nova:370', 3, 'patrol'), criminalPlayer))
                    .toBe('hostile');
                // And with a clean record the warship is neutral again.
                expect(style(ship('nova:370', 3, 'patrol'), plainPlayer))
                    .toBe('neutral');
            });

        it('xenophobic: a pirate freighter is neutral, a pirate warship '
            + 'hostile', () => {
                expect(style(ship('nova:137', 2), plainPlayer)).toBe('neutral');
                expect(style(ship('nova:137', 3, 'patrol'), plainPlayer))
                    .toBe('hostile');
            });

        it('the same trader turns red the moment it attacks the player', () => {
            for (const aiType of [1, 2]) {
                const trader = ship('nova:362', aiType, 'attack')
                    .addComponent(TargetComponent, { target: PLAYER });
                expect(style(trader, plainPlayer))
                    .withContext(`AI ${aiType}`).toBe('hostile');
            }
            // Including a provoked brave trader of a govt with no quarrel
            // at all (untested on the original; the behavioural tier).
            const provoked = ship('nova:370', 2, 'attack')
                .addComponent(TargetComponent, { target: PLAYER });
            expect(style(provoked, plainPlayer)).toBe('hostile');
        });

        it('AI 4 interceptors are treated as warships (chosen; untested on '
            + 'the original)', () => {
                expect(style(ship('nova:362', 4, 'patrol'), plainPlayer))
                    .toBe('hostile');
                expect(style(ship('nova:370', 4, 'patrol'), criminalPlayer))
                    .toBe('hostile');
            });

        it('a brainless bay fighter takes its carrier\'s AI type', () => {
            const fighter = new Entity('fighter')
                .addComponent(GovtComponent, { id: 'nova:362' })
                .addComponent(FormationComponent,
                    { leader: 'carrier', slot: 0 });
            expect(style(fighter, plainPlayer,
                { carrier: ship('nova:362', 3, 'patrol') })).toBe('hostile');
            expect(style(fighter, plainPlayer,
                { carrier: ship('nova:362', 1) })).toBe('neutral');
            // No carrier brain anywhere up the chain: hunts nobody.
            expect(style(fighter, plainPlayer)).toBe('neutral');
        });
    });

/**
 * The corner sweep: landing pulls the player's entity OUT of the display
 * world, so the per-entity drawing systems stop running and used to leave
 * the reticle frozen over the target's last position (Matthew's playtest).
 */
describe('cornersSweepSystem', () => {
    function harness() {
        const world = new World('corner sweep test');
        const resource = new Resource<TargetCorners>('TestCornersResource');
        const corners = {
            visible: true, targetUuid: 'some target', drawnThisStep: false,
        } as unknown as TargetCorners;
        world.resources.set(resource, corners);
        // Stands in for the real per-entity drawing system: it only ever
        // runs while the player's entity is in the world.
        let drawing = true;
        const draw = new System({
            name: 'TestDrawCorners',
            args: [resource, SingletonComponent] as const,
            step(c) {
                if (drawing) {
                    c.visible = true;
                    c.drawnThisStep = true;
                }
            },
        });
        world.addSystem(draw);
        world.addSystem(cornersSweepSystem('TestSweep', resource, draw));
        return { world, corners, stopDrawing: () => { drawing = false; } };
    }

    it('leaves the corners alone while the player is drawing them', () => {
        const { world, corners } = harness();
        world.step();
        world.step();
        expect(corners.visible).toBeTrue();
    });

    it('takes the corners down on the first step nothing draws them '
        + '(the player landed)', () => {
            const { world, corners, stopDrawing } = harness();
            world.step();
            expect(corners.visible).toBeTrue();
            stopDrawing();
            world.step();
            expect(corners.visible).toBeFalse();
            expect(corners.targetUuid).toBeUndefined();
        });
});

/**
 * Where the brackets sit (wave 9, K10, docs/reference_experiments.md): the
 * box through the four glyphs' outermost lit pixels is square, side
 * 2 * floor(S / 2) + 30 with S = max(w, h) of the BASE frame, centred on
 * the target, for ships and stellars alike. Every row is a box the
 * original drew, to the pixel.
 */
describe('TargetCorners geometry (wave 9 brackets)', () => {
    const ORIGINAL: [string, number, number, number][] = [
        // [target, frame w, frame h, box side the original drew]
        ['Type 51 station', 15, 21, 50],
        ['Type 53 station', 17, 31, 60],
        ['Type 48 station', 35, 22, 64],
        ['Type 3', 40, 40, 70],
        ['Type 6', 72, 72, 102],
        ['Type 16', 80, 80, 110],
        ['Type 24', 88, 88, 118],
        ['Type 9', 96, 96, 126],
        ['Type 10', 112, 112, 142],
        ['Type 0 (Kit Port)', 150, 150, 180],
        ['Type 25', 250, 250, 280],
        ['Type 18', 304, 134, 334],
        ['Type 39 (station art)', 315, 200, 344],
        ['Type 5 (Jupiter)', 325, 325, 354],
        ['Shuttle', 24, 24, 54],
        ['Heavy Shuttle / Fed Viper', 32, 32, 62],
        ['Thunderhead', 48, 48, 78],
        ['Fed Patrol Boat', 56, 56, 86],
        ['Pegasus', 64, 64, 94],
        ['Fed Destroyer', 80, 80, 110],
        ['Kit Hulk Big', 96, 96, 126],
        ['IDA Frigate', 100, 100, 130],
        ['Aurora Cruiser', 120, 120, 150],
        ['Fed Carrier', 128, 128, 158],
        // Its glow layer is 180 px; the box comes from the 144 px base.
        ['Leviathan', 144, 144, 174],
        ['Aurora Carrier', 184, 184, 214],
    ];

    /** A TargetCorners whose cicns never load: only the geometry runs. */
    function corners() {
        return new TargetCorners({
            data: { TargetCorners: { get: () => new Promise(() => undefined) } },
        } as never);
    }

    /**
     * The box through the glyphs' outermost lit pixels, relative to the
     * target's centre: the pixel square at texture pixel
     * (GLYPH_INSET, GLYPH_INSET), the outer corner of every corner glyph,
     * carried through each sprite's own position and rotation.
     */
    function litBox(c: TargetCorners) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const sprite of c.container.children as PIXI.Sprite[]) {
            sprite.transform.updateLocalTransform();
            const m = sprite.transform.localTransform;
            for (const [tx, ty] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
                const p = m.apply(new PIXI.Point(
                    GLYPH_INSET + tx, GLYPH_INSET + ty));
                x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
                y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
            }
        }
        const round = (v: number) => Math.round(v * 1e6) / 1e6;
        return { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) };
    }

    for (const [name, w, h, side] of ORIGINAL) {
        it(`${name} (${w}x${h}) gets the original's ${side} x ${side} box`,
            () => {
                const c = corners();
                c.step(0, 'target', { x: w, y: h });
                c.step(10_000, 'target', { x: w, y: h });
                const box = litBox(c);
                expect(box.x1 - box.x0).toBe(side);
                expect(box.y1 - box.y0).toBe(side);
                // Centred on the target: the sprite of an even frame
                // covers [-S/2, S/2), the box 15 px more on each side.
                expect(box.x0).toBe(-Math.floor(Math.max(w, h) / 2) - 15);
                expect(box.y0).toBe(box.x0);
                expect(box.x1).toBe(-box.x0);
                expect(box.y1).toBe(-box.y0);
            });
    }

    it('flies in from FLY_IN_EXTRA_WIDTH wider, the same for every size, '
        + 'and closes linearly over FLY_IN_MS', () => {
            for (const size of [24, 112, 325]) {
                const s = { x: size, y: size };
                const rest = cornerAnchorOffset(s);
                expect(cornerAnchorOffset(s, 0) - rest)
                    .toBe(FLY_IN_EXTRA_WIDTH / 2);
                expect(cornerAnchorOffset(s, FLY_IN_MS / 2) - rest)
                    .toBeCloseTo(FLY_IN_EXTRA_WIDTH / 4, 9);
                expect(cornerAnchorOffset(s, FLY_IN_MS)).toBe(rest);
                expect(cornerAnchorOffset(s, FLY_IN_MS + 500)).toBe(rest);
            }
            // The original: 400-580 px wider at first sight, closed in
            // 100-130 ms.
            expect(FLY_IN_EXTRA_WIDTH).toBeGreaterThanOrEqual(400);
            expect(FLY_IN_EXTRA_WIDTH).toBeLessThanOrEqual(580);
            expect(FLY_IN_MS).toBeGreaterThanOrEqual(100);
            expect(FLY_IN_MS).toBeLessThanOrEqual(130);
        });

    it('restarts the fly-in when the target changes, not otherwise', () => {
        const c = corners();
        const s = { x: 48, y: 48 };
        c.step(1000, 'a', s);
        const wide = litBox(c).x1;
        c.step(1000 + FLY_IN_MS, 'a', s);
        expect(litBox(c).x1).toBe(24 + 15);
        expect(wide - litBox(c).x1).toBe(FLY_IN_EXTRA_WIDTH / 2);
        c.step(5000, 'b', s);
        expect(litBox(c).x1).toBe(wide);
    });

    it('every corner cicn has its outermost lit pixel at texture pixel '
        + '(GLYPH_INSET, GLYPH_INSET), inside its 1 px outline', () => {
            let dir = path.dirname(fileURLToPath(import.meta.url));
            while (!fs.existsSync(path.join(dir, 'objects', 'CicnImage'))) {
                const up = path.dirname(dir);
                if (up === dir) {
                    fail('objects/CicnImage not found above the spec');
                    return;
                }
                dir = up;
            }
            const cicns = path.join(dir, 'objects', 'CicnImage');
            for (const file of ['targetNeutral', 'targetHostile',
                'targetFriendly', 'targetDisabled', 'planetNeutral']) {
                const png = PNG.sync.read(fs.readFileSync(
                    path.join(cicns, `${file}.png`)));
                let minX = Infinity, minY = Infinity;
                for (let y = 0; y < png.height; y++) {
                    for (let x = 0; x < png.width; x++) {
                        const i = (y * png.width + x) * 4;
                        const d = png.data;
                        // Lit = the glyph's colour, not the dark outline
                        // (outline channel sums stay under 100, the glyphs'
                        // over 200).
                        if (d[i + 3] && d[i] + d[i + 1] + d[i + 2] > 150) {
                            minX = Math.min(minX, x);
                            minY = Math.min(minY, y);
                        }
                    }
                }
                expect([minX, minY]).withContext(file)
                    .toEqual([GLYPH_INSET, GLYPH_INSET]);
            }
        });
});
