import 'jasmine';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { DOMAINS } from './domains.js';

/**
 * The domain graph is the design (core/domain.ts): every `dependsOn`
 * must be exactly what the modules import, cross-domain imports go
 * through the other domain's index, no domain imports the composition
 * root, and the whole thing is acyclic. Checked over the SOURCES (the
 * complete graph, type-only imports included) and over the BUILT files
 * this spec runs from (the runtime graph, which must be a subset).
 *
 * Specs are exempt: a spec may reach into any module it exercises.
 */
describe('nova_plugin domain graph', () => {
    const builtRoot = path.dirname(fileURLToPath(import.meta.url));
    const sourceRoot = path.resolve(builtRoot, '../../../src/nova_plugin');
    const byName = new Map(DOMAINS.map(domain => [domain.name, domain]));

    /** Relative import specifiers of a module: static, side-effect and dynamic. */
    function specifiers(file: string): string[] {
        const text = fs.readFileSync(file, 'utf8');
        const out: string[] = [];
        const pattern =
            /(?:\bfrom\s*|^\s*import\s+|\bimport\s*\(\s*)["'](\.\.?\/[^"']+)["']/gm;
        for (const match of text.matchAll(pattern)) {
            out.push(match[1]!);
        }
        return out;
    }

    interface Edge { from: string; specifier: string; toDomain: string; deep: boolean; }

    /**
     * Every edge from a non-spec module of `domain` (under `root`, with
     * files ending in `ext`) into a DIFFERENT part of nova_plugin: the
     * target domain ('root' for the composition root) and whether the
     * import bypasses that domain's index.
     */
    function crossEdges(root: string, domain: string, ext: string): Edge[] {
        const dir = path.join(root, domain);
        const edges: Edge[] = [];
        for (const name of fs.readdirSync(dir)) {
            if (!name.endsWith(ext) || name.endsWith(`_test${ext}`)) {
                continue;
            }
            const file = path.join(dir, name);
            for (const specifier of specifiers(file)) {
                const target = path.resolve(dir, specifier);
                const relative = path.relative(root, target);
                if (relative.startsWith('..')) {
                    continue; // outside nova_plugin
                }
                const parts = relative.split(path.sep);
                const toDomain = parts.length === 1 ? 'root' : parts[0]!;
                if (toDomain === domain) {
                    continue;
                }
                edges.push({
                    from: `${domain}/${name}`, specifier, toDomain,
                    deep: parts.length !== 2 || parts[1] !== 'index.js',
                });
            }
        }
        return edges;
    }

    function domainDirectories(root: string): string[] {
        return fs.readdirSync(root, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name)
            .sort();
    }

    it('has one directory per declared domain, and no other', () => {
        const declared = DOMAINS.map(domain => domain.name).sort();
        expect(domainDirectories(sourceRoot)).toEqual(declared);
        expect(domainDirectories(builtRoot)).toEqual(declared);
        expect(new Set(declared).size).toBe(declared.length);
    });

    it('declares dependencies on real domains other than itself', () => {
        for (const domain of DOMAINS) {
            for (const dependency of domain.dependsOn) {
                expect(byName.has(dependency))
                    .withContext(`${domain.name} depends on unknown ${dependency}`)
                    .toBeTrue();
                expect(dependency).withContext(domain.name).not.toBe(domain.name);
            }
        }
    });

    it('is acyclic', () => {
        const state = new Map<string, 'visiting' | 'done'>();
        const visit = (name: string, trail: string[]): void => {
            if (state.get(name) === 'done') {
                return;
            }
            expect(state.get(name)).withContext(
                `cycle: ${[...trail, name].join(' -> ')}`).not.toBe('visiting');
            if (state.get(name) === 'visiting') {
                return;
            }
            state.set(name, 'visiting');
            for (const dependency of byName.get(name)?.dependsOn ?? []) {
                visit(dependency, [...trail, name]);
            }
            state.set(name, 'done');
        };
        for (const domain of DOMAINS) {
            visit(domain.name, []);
        }
    });

    for (const domain of DOMAINS) {
        describe(domain.name, () => {
            it('imports other domains only through their index, never the root',
                () => {
                    for (const edge of [...crossEdges(sourceRoot, domain.name, '.ts'),
                    ...crossEdges(builtRoot, domain.name, '.js')]) {
                        expect(edge.toDomain).withContext(
                            `${edge.from} imports the composition root: ${edge.specifier}`)
                            .not.toBe('root');
                        expect(edge.deep).withContext(
                            `${edge.from} reaches into ${edge.toDomain}: ${edge.specifier}`)
                            .toBeFalse();
                    }
                });

            it('declares exactly the domains its sources import', () => {
                const imported = new Set(
                    crossEdges(sourceRoot, domain.name, '.ts').map(edge => edge.toDomain));
                expect([...imported].sort()).toEqual([...domain.dependsOn].sort());
            });

            it('imports at runtime only what it declares', () => {
                for (const edge of crossEdges(builtRoot, domain.name, '.js')) {
                    expect(domain.dependsOn).withContext(
                        `${edge.from} imports ${edge.toDomain} at runtime`)
                        .toContain(edge.toDomain);
                }
            });
        });
    }

    it('the composition root imports domains only through their index', () => {
        for (const [root, ext] of [[sourceRoot, '.ts'], [builtRoot, '.js']] as const) {
            for (const name of fs.readdirSync(root)) {
                if (!name.endsWith(ext) || name.endsWith(`_test${ext}`)) {
                    continue;
                }
                for (const specifier of specifiers(path.join(root, name))) {
                    const relative = path.relative(root, path.resolve(root, specifier));
                    const parts = relative.split(path.sep);
                    if (relative.startsWith('..') || parts.length === 1) {
                        continue;
                    }
                    expect(parts).withContext(`${name}: ${specifier}`)
                        .toEqual([parts[0]!, 'index.js']);
                }
            }
        }
    });
});
