import 'jasmine';
import { getDefaultGovtData, GovtData } from 'novadatainterface/govt_data';
import { Entity } from 'nova_ecs/entity';
import { Resource } from 'nova_ecs/resource';
import { System } from 'nova_ecs/system';
import { SingletonComponent, World } from 'nova_ecs/world';
import { DisabledComponent } from '../nova_plugin/ship/disabled_component.js';
import { GovtComponent } from '../nova_plugin/core/govt_component.js';
import { FormationComponent, NpcComponent } from '../nova_plugin/npc/npc_ai_plugin.js';
import { ShootAllWeaponsComponent } from '../nova_plugin/npc/npc_plugin.js';
import { EscortCommandComponent } from '../nova_plugin/player/escort_command.js';
import { TargetComponent } from '../nova_plugin/ship/target_component.js';
import {
    cornersSweepSystem, styleForTarget, TargetCorners,
} from './target_corners_plugin.js';

const PLAYER = 'player uuid';

/** A gameData stub exposing only the Govt.getCached the rule reads. */
function mockGameData(govts: { [id: string]: GovtData | undefined }) {
    return {
        data: {
            Govt: {
                getCached: (id: string) => govts[id],
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
            gameData, u => entities[u], now);
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
            .addComponent(GovtComponent, { id: 'nova:137' });
        const npcEscort = new Entity('npc escort')
            .addComponent(GovtComponent, { id: 'nova:137' })
            .addComponent(FormationComponent,
                { leader: 'npc leader', slot: 0 });
        expect(style('npc escort',
            { 'npc leader': npcLeader, 'npc escort': npcEscort }))
            .toBe('hostile');
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
