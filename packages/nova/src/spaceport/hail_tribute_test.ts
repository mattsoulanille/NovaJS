import 'jasmine';
import * as PIXI from 'pixi.js';
import { Subject } from 'rxjs';
import { DisplayAssetDataInterface } from '../client/gamedata/display_asset_data.js';
import { ControlEvent } from '../nova_plugin/core/index.js';
import {
    TributeLines, tributeHeading, tributePressAnswer,
} from '../display/hail_dialog_plugin.js';
import {
    COMM_DOMINATED_COLOR, COMM_HOSTILE_COLOR, HailCallbacks, HailContext,
    HailDialog, hailPress, identityRuns, TributePressAnswer,
} from './hail_dialog.js';
import { commButtonSlots } from './hail_layout.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';

/**
 * ============================================================================
 * THE STELLAR COMM'S DEMAND TRIBUTE / RELEASE ROW (#353)
 * ============================================================================
 *
 * Reference "Tribute (R18), wave 38 / 39" and "Hail dialog keys (K5), wave
 * 39": Greetings / Demand Tribute / Close Channel; the stellar's answer in
 * the well and "Status: Hostile" after a laugh or the fleet; "Status:
 * Dominated" (green) and Release in the same row once it gives in; Release
 * answers "You release the planet from its debt to you." and Demand
 * Tribute comes back. An Offer Bribe a dominated stellar still makes takes
 * the top row.
 */

const DISPLAY_ASSETS = {
    spriteFromPict: () => new PIXI.Sprite(),
    spriteFromPictAsync: async () => new PIXI.Sprite(),
    textureFromPict: () => PIXI.Texture.EMPTY,
    textureFromPictAsync: async () => PIXI.Texture.EMPTY,
} as unknown as DisplayAssetDataInterface;

const LINES: TributeLines = {
    planetUuid: 'planet nova:500', planetId: 'nova:500', isStation: false,
    hasFleet: true,
    stellarStrings: Array.from({ length: 50 }, (_, i) => `line ${i}`),
    identity: ['Kit Tribute Six', '[Kit World]'],
    hostileWord: 'Hostile', dominatedWord: 'Dominated',
};

describe('the stellar comm\'s tribute row', () => {
    it('reads Demand Tribute in the middle row, Release once dominated, '
        + 'with a bribe moving to the top then', () => {
            const demand = { kind: 'demand' as const };
            const release = { kind: 'release' as const };
            expect(commButtonSlots('planet', { tribute: demand }))
                .toEqual(['greetings', 'tribute', 'close']);
            expect(commButtonSlots('planet', { tribute: release }))
                .toEqual(['greetings', 'release', 'close']);
            // K5: a port offering a bribe has it in the middle row ...
            expect(commButtonSlots('planet', { tribute: demand, bribe: {} }))
                .toEqual(['greetings', 'bribe', 'close']);
            // ... wave 39: "Offer Bribe / Release / Close Channel".
            expect(commButtonSlots('planet', { tribute: release, bribe: {} }))
                .toEqual(['bribe', 'release', 'close']);
        });

    it('answers a demand from the pilot\'s rating, and every demand sends '
        + 'the record (a laugh costs one kill\'s record: R18, wave 40)', () => {
            const laugh = tributePressAnswer(LINES, 'demand', 12_799, 2);
            expect(laugh).toEqual({
                answer: 'line 7',
                heading: 'Kit Tribute Six\n[Kit World]\nStatus: Hostile',
                next: 'demand', record: 'demandTribute',
            });
            const fleet = tributePressAnswer(LINES, 'demand', 12_800, 1);
            expect(fleet).toEqual({
                answer: 'line 11',
                heading: 'Kit Tribute Six\n[Kit World]\nStatus: Hostile',
                next: 'demand', record: 'demandTribute',
            });
            const gives = tributePressAnswer({ ...LINES, hasFleet: false },
                'demand', 12_800, 0);
            expect(gives).toEqual({
                answer: 'line 25',
                heading: 'Kit Tribute Six\n[Kit World]\nStatus: Dominated',
                next: 'release', record: 'demandTribute',
            });
            const released = tributePressAnswer({ ...LINES, isStation: true },
                'release', 0, 0);
            expect(released).toEqual({
                answer: 'line 36',
                heading: 'Kit Tribute Six\n[Kit World]',
                next: 'demand', record: 'releaseTribute',
            });
        });

    it('keeps one Status line: Dominated, else the landing clearance\'s, '
        + 'else Hostile', () => {
            const refusing = { ...LINES, clearanceStatus: 'Status: Forbidden' };
            expect(tributeHeading(refusing, 'dominated'))
                .toBe('Kit Tribute Six\n[Kit World]\nStatus: Dominated');
            expect(tributeHeading(refusing, 'hostile'))
                .toBe('Kit Tribute Six\n[Kit World]\nStatus: Forbidden');
            expect(tributeHeading(LINES, undefined))
                .toBe('Kit Tribute Six\n[Kit World]');
        });

    it('paints "Dominated" green and every other status red', () => {
        expect(identityRuns('Status: Dominated')[0][1].color)
            .toBe(COMM_DOMINATED_COLOR);
        expect(identityRuns('Status: Hostile')[0][1].color)
            .toBe(COMM_HOSTILE_COLOR);
    });

    it('shows the answer and the new Status, the channel open, and swaps '
        + 'the row (hailPress)', () => {
            const context: HailContext = {
                variant: 'planet', heading: 'Kit Tribute Six', image: null,
                body: 'Channel open to Kit Tribute Six.',
                tribute: { kind: 'demand' },
            };
            const answer: TributePressAnswer = {
                answer: 'All right!', heading: 'Kit\nStatus: Dominated',
                next: 'release',
            };
            const next = hailPress({ phase: 'main', context },
                { kind: 'tribute', answer });
            expect(next).toEqual({ phase: 'main', context: {
                ...context, body: 'All right!',
                heading: 'Kit\nStatus: Dominated',
                tribute: { kind: 'release' },
            } });
            // No tribute row: nothing to press.
            const { tribute: _row, ...ship } = context;
            const state = { phase: 'main' as const, context: ship };
            expect(hailPress(state, { kind: 'tribute', answer })).toBe(state);
        });
});

describe('the dialog\'s Demand Tribute button', () => {
    beforeAll(() => installHeadlessPixi());

    async function settle() {
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    function drawnText(dialog: HailDialog): string[] {
        const out: string[] = [];
        const walk = (node: PIXI.DisplayObject) => {
            if (node instanceof PIXI.Text) {
                out.push(node.text);
            }
            if (node instanceof PIXI.Container) {
                node.children.forEach(walk);
            }
        };
        walk(dialog.container);
        return out.flatMap(text => text.split('\n'));
    }

    it('presses through pressTribute and its keyed button: Demand '
        + 'Tribute, then Release', async () => {
            const controls = new Subject<ControlEvent>();
            const callbacks = jasmine.createSpyObj<Required<HailCallbacks>>(
                'callbacks', ['requestAssistance', 'bribe', 'lowerPrice',
                    'messagePlayer', 'escortAction', 'tribute', 'playSound']);
            callbacks.tribute.and.callFake(kind => kind === 'demand'
                ? { answer: 'All right, all right already!',
                    heading: 'Kit\nStatus: Dominated', next: 'release' }
                : { answer: 'You release the planet from its debt to you.',
                    heading: 'Kit', next: 'demand' });
            const dialog = new HailDialog(DISPLAY_ASSETS, controls, callbacks);
            try {
                void dialog.show({
                    variant: 'planet', heading: 'Kit', image: null,
                    body: 'Channel open to Kit.', tribute: { kind: 'demand' },
                });
                await settle();
                expect(drawnText(dialog)).toContain('Demand Tribute');
                const keyed = dialog['keyedButtons'].tribute;
                expect(keyed).toBeDefined();
                expect(keyed!.activate()).toBeTrue();
                await settle();
                expect(callbacks.tribute).toHaveBeenCalledOnceWith('demand');
                expect(drawnText(dialog))
                    .toContain('All right, all right already!');
                expect(drawnText(dialog)).toContain('Release');
                expect(drawnText(dialog)).toContain('Dominated');
                dialog.pressTribute();
                await settle();
                expect(callbacks.tribute).toHaveBeenCalledWith('release');
                expect(drawnText(dialog)).toContain(
                    'You release the planet from its debt to you.');
                expect(drawnText(dialog)).toContain('Demand Tribute');
                // The channel stayed open throughout.
                expect(dialog.container.visible).toBeTrue();
            } finally {
                dialog.dismiss();
            }
        });
});
