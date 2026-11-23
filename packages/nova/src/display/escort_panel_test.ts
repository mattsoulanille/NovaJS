import 'jasmine';
import type { ControlEvent } from '../nova_plugin/core/index.js';
import {
    EscortPanelController, ESCORT_PANEL_STRINGS, escortPanelRows,
} from './escort_panel.js';

const start = (action: string): ControlEvent =>
    ({ action: action as never, state: 'start' });
const release = (action: string): ControlEvent =>
    ({ action: action as never, state: false });

function controller(hasEscorts = true) {
    const messages: string[] = [];
    const panel = new EscortPanelController({
        hasEscorts: () => hasEscorts,
        message: text => messages.push(text),
    });
    return { panel, messages };
}

describe('EscortPanelController', () => {
    it('`e` toggles the panel and is not passed on', () => {
        const { panel } = controller();
        expect(panel.filter([start('escorts')])).toEqual([]);
        expect(panel.open).toBeTrue();
        expect(panel.filter([release('escorts')])).toEqual([]);
        expect(panel.open).toBeTrue();
        panel.filter([start('escorts')]);
        expect(panel.open).toBeFalse();
    });

    it('`e` auto-repeat does not flicker it', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        expect(panel.filter(
            [{ action: 'escorts', state: 'repeat' }])).toEqual([]);
        expect(panel.open).toBeTrue();
    });

    it('`e` with no escorts opens nothing and says so', () => {
        const { panel, messages } = controller(false);
        panel.filter([start('escorts')]);
        expect(panel.open).toBeFalse();
        expect(messages).toEqual([ESCORT_PANEL_STRINGS.noEscorts]);
    });

    it('opens on row 1 every time', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        expect(panel.selectedRow).toBe(0);
        panel.filter([start('selectStellar3')]);
        expect(panel.selectedRow).toBe(2);
        panel.filter([start('escorts')]);
        panel.filter([start('escorts')]);
        expect(panel.selectedRow).toBe(0);
    });

    it('1-5 select rows while it is open, instead of stellars', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        for (let row = 1; row <= 5; row++) {
            expect(panel.filter([start(`selectStellar${row}`)])).toEqual([]);
            expect(panel.selectedRow).toBe(row - 1);
        }
        // 6-9 still select stellars; releases pass (harmless).
        expect(panel.filter([start('selectStellar6')]))
            .toEqual([start('selectStellar6')]);
        expect(panel.filter([release('selectStellar2')]))
            .toEqual([release('selectStellar2')]);
        expect(panel.selectedRow).toBe(4);
    });

    it('1-5 select stellars as usual while it is closed', () => {
        const { panel } = controller();
        expect(panel.filter([start('selectStellar2')]))
            .toEqual([start('selectStellar2')]);
    });

    it('a click selects a row', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        panel.selectRow(3);
        expect(panel.selectedRow).toBe(3);
    });

    it('orders on row 1 go to every category (no selector)', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        for (const order of ['attack', 'defend', 'holdPosition',
            'formation', 'returnToBay']) {
            expect(panel.filter([start(order)])).toEqual([start(order)]);
        }
    });

    it('orders on rows 2-5 carry that row\'s category selector in the ' +
        'same batch, ahead of the order', () => {
            const { panel } = controller();
            panel.filter([start('escorts')]);
            const rows = [
                [1, 'escortSelectFighters'], [2, 'escortSelectMedium'],
                [3, 'escortSelectWarships'], [4, 'escortSelectFreighters'],
            ] as const;
            for (const [row, selector] of rows) {
                panel.selectRow(row);
                expect(panel.filter([start('holdPosition')]))
                    .toEqual([start(selector), start('holdPosition')]);
            }
            // Releases and repeats of the order key carry nothing extra.
            expect(panel.filter([release('holdPosition')]))
                .toEqual([release('holdPosition')]);
        });

    it('the order keys work with it closed, for every category', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        panel.selectRow(2);
        panel.filter([start('escorts')]);
        expect(panel.filter([start('holdPosition')]))
            .toEqual([start('holdPosition')]);
        expect(panel.filter([start('formation')]))
            .toEqual([start('formation')]);
    });

    it('Up/Down close it and still fly the ship; Left/Right only turn',
        () => {
            const { panel } = controller();
            panel.filter([start('escorts')]);
            expect(panel.filter([start('turnLeft')]))
                .toEqual([start('turnLeft')]);
            expect(panel.filter([start('turnRight')]))
                .toEqual([start('turnRight')]);
            expect(panel.open).toBeTrue();
            expect(panel.filter([start('accelerate')]))
                .toEqual([start('accelerate')]);
            expect(panel.open).toBeFalse();
            panel.filter([start('escorts')]);
            expect(panel.filter([start('reverse')]))
                .toEqual([start('reverse')]);
            expect(panel.open).toBeFalse();
        });

    it('Tab and Return neither open it nor touch it', () => {
        const { panel } = controller();
        expect(panel.filter([start('nextTarget')]))
            .toEqual([start('nextTarget')]);
        expect(panel.open).toBeFalse();
        panel.filter([start('escorts')]);
        panel.selectRow(2);
        panel.filter([start('nextTarget'), start('fullscreen')]);
        expect(panel.open).toBeTrue();
        expect(panel.selectedRow).toBe(2);
    });

    it('close() closes it', () => {
        const { panel } = controller();
        panel.filter([start('escorts')]);
        panel.close();
        expect(panel.open).toBeFalse();
    });
});

describe('escortPanelRows', () => {
    it('lists All Ships then the four categories, greying empty ones and ' +
        'showing each category\'s current order', () => {
            const rows = escortPanelRows([
                { category: 'fighter', command: 'holdPosition' },
                { category: 'fighter', command: 'holdPosition' },
                { category: 'medium', command: 'formation' },
                { category: 'medium', command: 'attack' },
                { category: 'medium', command: 'attack' },
            ], ESCORT_PANEL_STRINGS);
            expect(rows.map(r => r.label)).toEqual([
                '1) All Ships', '2) Fighters', '3) Medium Ships',
                '4) Warships', '5) Freighters',
            ]);
            expect(rows.map(r => r.enabled))
                .toEqual([true, true, true, false, false]);
            expect(rows.map(r => r.order)).toEqual(
                ['', 'Hold Position', 'Attack', 'Formation', 'Formation']);
        });

    it('greys All Ships too when there are none left', () => {
        const rows = escortPanelRows([], ESCORT_PANEL_STRINGS);
        expect(rows.every(r => !r.enabled)).toBeTrue();
    });

    it('names every order the original\'s way', () => {
        const orderOf = (command: 'formation' | 'attack' | 'defend'
            | 'holdPosition' | 'returnToBay') => escortPanelRows(
                [{ category: 'warship', command }], ESCORT_PANEL_STRINGS)[3]
                .order;
        expect(orderOf('formation')).toBe('Formation');
        expect(orderOf('attack')).toBe('Attack');
        expect(orderOf('defend')).toBe('Defend');
        expect(orderOf('holdPosition')).toBe('Hold Position');
        expect(orderOf('returnToBay')).toBe('Return to Hangar');
    });
});
