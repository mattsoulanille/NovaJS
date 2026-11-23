import 'jasmine';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { SystemData } from 'novadatainterface/system_data';
import { getSyntheticGameData } from '../communication/simulation_test_fixture.js';
import { installHeadlessPixi } from './headless_pixi_fixture.js';
import {
    MINI_MAP_FRAME, MINI_MAP_PANE, MiniMap, miniMapPosition,
} from './mini_map.js';
import { SystemGraph } from './system_graph.js';

const { thessaly, kestrel, ossory, vael } = SYNTHETIC.systems;

describe('the `h` hyperspace minimap', () => {
    it('sits where mini_map.png has it at 1920x1080', () => {
        // The civilian status bar is 194 px wide (x 1726..1919); the
        // minimap's outline spans x 1230..1709, y 150..629.
        const { x, y } = miniMapPosition({ x: 1920 }, 194);
        expect(x).toBe(1230);
        expect(y).toBe(150);
        expect(x + MINI_MAP_FRAME - 1).toBe(1709);
        expect(MINI_MAP_PANE.x + 2).toBe(MINI_MAP_FRAME);
    });

    describe('with a map in it', () => {
        let systems: SystemData[];

        beforeAll(async () => {
            installHeadlessPixi();
            const gameData = await getSyntheticGameData();
            systems = await Promise.all([thessaly, kestrel, ossory, vael]
                .map(id => gameData.data.System.get(id)));
        });

        const graph = () => new SystemGraph(systems, thessaly,
            { size: MINI_MAP_PANE, miniMap: true });

        it('reports each pick with the graph it was made on', () => {
            const miniMap = new MiniMap();
            const shown = graph();
            miniMap.setGraph(shown);
            const picks: string[][] = [];
            miniMap.picked.subscribe(g => picks.push(g.getEffectiveRoute()));
            shown.clickSystem(kestrel);
            shown.clickSystem(ossory);
            expect(picks).toEqual([[kestrel], [ossory]]);
        });

        it('forgets a graph it no longer shows', () => {
            const miniMap = new MiniMap();
            const old = graph();
            miniMap.setGraph(old);
            miniMap.setGraph(graph());
            let picks = 0;
            miniMap.picked.subscribe(() => picks++);
            // (A destroyed graph is off screen and cannot be clicked; its
            // stream is what must not leak picks through.)
            old.routeChanged.next();
            expect(picks).toBe(0);
            expect(old.container.destroyed).toBeTrue();
        });

        it('starts hidden and keeps the map inside its outline', () => {
            const miniMap = new MiniMap();
            expect(miniMap.container.visible).toBeFalse();
            const shown = graph();
            miniMap.setGraph(shown);
            expect(shown.container.position.x).toBe(1);
            expect(shown.container.position.y).toBe(1);
        });
    });
});
