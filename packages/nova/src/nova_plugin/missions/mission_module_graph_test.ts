import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

/**
 * The missions module graph is acyclic (issue #266): the Sxxx/Axxx/Fxxx
 * handlers are injected through MissionMachineryContext.missionOperators
 * and the mission_logic façade is retired, so the domain's modules load
 * in one orientation — the missions index's — with no import cycle left
 * anywhere among them.
 *
 * Checked over the BUILT files this spec runs from: that is the runtime
 * graph, the one evaluation order follows (type-only imports elide and
 * cannot affect it).
 */
describe('the missions module graph', () => {
    const builtDir = path.dirname(fileURLToPath(import.meta.url));

    /**
     * The in-domain relative imports of a built module ('./x.js' -> 'x'),
     * in every form a module can name another by — `from`, a side-effect
     * `import './x.js'`, and `import('./x.js')` — the same reading the
     * domain-graph spec makes, so no form can close a cycle unseen.
     */
    function relativeImports(file: string): string[] {
        const text = fs.readFileSync(file, 'utf8');
        const pattern =
            /(?:\bfrom\s*|^\s*import\s+|\bimport\s*\(\s*)["'](\.\/[^"']+\.js)["']/gm;
        return [...text.matchAll(pattern)]
            .map(match => match[1]!.slice(2, -3));
    }

    it('loads in one orientation: no import cycle among the modules', () => {
        const graph = new Map<string, string[]>();
        for (const name of fs.readdirSync(builtDir)) {
            if (!name.endsWith('.js') || name.endsWith('_test.js')) {
                continue;
            }
            graph.set(name.slice(0, -3),
                relativeImports(path.join(builtDir, name)));
        }
        const state = new Map<string, 'visiting' | 'done'>();
        const visit = (name: string, trail: string[]): void => {
            const seen = state.get(name);
            if (seen === 'done') {
                return;
            }
            expect(seen).withContext(
                `cycle: ${[...trail, name].join(' -> ')}`).not.toBe('visiting');
            if (seen === 'visiting') {
                return;
            }
            state.set(name, 'visiting');
            for (const next of graph.get(name) ?? []) {
                visit(next, [...trail, name]);
            }
            state.set(name, 'done');
        };
        for (const name of graph.keys()) {
            visit(name, []);
        }
    });

    it('has no mission_logic façade any more', () => {
        // builtDir is dist/src/nova_plugin/missions; the sources are four
        // levels up, under packages/nova/src. Anchored on the index so a
        // wrong path fails here instead of making the check vacuous.
        const sourceDir = path.resolve(
            builtDir, '../../../../src/nova_plugin/missions');
        expect(fs.existsSync(path.join(sourceDir, 'index.ts'))).toBeTrue();
        expect(fs.existsSync(path.join(builtDir, 'mission_logic.js')))
            .toBeFalse();
        expect(fs.existsSync(path.join(sourceDir, 'mission_logic.ts')))
            .toBeFalse();
    });
});
