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
 * The same rule holds OUTSIDE nova_plugin: display, spaceport, client,
 * title, server, communication, the package's root files and every spec
 * among them reach a domain only through its index, so a domain's index
 * is its whole public surface and a module can move within its domain
 * without touching an importer. A site that must bypass the index says
 * why with a `// deep import: <reason>` comment on the line above the
 * statement (none today).
 *
 * Specs INSIDE nova_plugin are exempt: a spec may reach into any module
 * of any domain it exercises.
 */
describe('nova_plugin domain graph', () => {
    const builtRoot = path.dirname(fileURLToPath(import.meta.url));
    const sourceRoot = path.resolve(builtRoot, '../../../src/nova_plugin');
    const byName = new Map(DOMAINS.map(domain => [domain.name, domain]));

    interface Specifier {
        specifier: string;
        /** Carries a `// deep import: <reason>` comment on the line above. */
        exempt: boolean;
    }

    /**
     * Relative import specifiers of a module: static, side-effect and
     * dynamic. `exempt` reads the line above the statement the specifier
     * belongs to (comments survive into the built files).
     */
    function specifiersOf(file: string): Specifier[] {
        const text = fs.readFileSync(file, 'utf8');
        const out: Specifier[] = [];
        const pattern =
            /(?:\bfrom\s*|^\s*import\s+|\bimport\s*\(\s*)["'](\.\.?\/[^"']+)["']/gm;
        for (const match of text.matchAll(pattern)) {
            const statementStart = Math.max(
                text.lastIndexOf('\nimport', match.index!),
                text.lastIndexOf('\nexport', match.index!),
                text.lastIndexOf('import(', match.index!));
            const lineBreak = text.lastIndexOf('\n', statementStart);
            const lineAbove = text.slice(
                text.lastIndexOf('\n', lineBreak - 1) + 1, Math.max(lineBreak, 0));
            out.push({
                specifier: match[1]!,
                exempt: /\/\/\s*deep import:/.test(lineAbove),
            });
        }
        return out;
    }

    function specifiers(file: string): string[] {
        return specifiersOf(file).map(entry => entry.specifier);
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

    /** Every module of the package outside nova_plugin, specs included. */
    function outsideModules(pluginRoot: string, ext: string): string[] {
        const packageSrc = path.resolve(pluginRoot, '..');
        const out: string[] = [];
        const walk = (dir: string): void => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const file = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (file !== pluginRoot) {
                        walk(file);
                    }
                } else if (entry.name.endsWith(ext)
                    && !entry.name.endsWith(`.d${ext}`)
                    && !entry.name.endsWith(`_bundle${ext}`)) {
                    out.push(file);
                }
            }
        };
        walk(packageSrc);
        out.push(path.resolve(packageSrc, `../server${ext}`));
        return out;
    }

    it('is reached from outside nova_plugin only through the domain indexes',
        () => {
            let checked = 0;
            for (const [root, ext] of [[sourceRoot, '.ts'], [builtRoot, '.js']] as const) {
                for (const file of outsideModules(root, ext)) {
                    for (const { specifier, exempt } of specifiersOf(file)) {
                        const relative = path.relative(
                            root, path.resolve(path.dirname(file), specifier));
                        const parts = relative.split(path.sep);
                        if (relative.startsWith('..') || parts.length === 1 || exempt) {
                            continue; // not a domain module, or a declared exception
                        }
                        checked++;
                        expect(parts)
                            .withContext(`${path.relative(root, file)}: ${specifier}`)
                            .toEqual([parts[0]!, 'index.js']);
                    }
                }
            }
            expect(checked).toBeGreaterThan(100);
        });

    it('exports no two different things under one name across the domain indexes',
        async () => {
            // A name two indexes export from different modules would make
            // an importer of both domains ambiguous; the index that
            // re-exports under an alias resolves it (missions'
            // missionFreeCargoSpace, reputation's govtStellarRecord).
            // Checked over the built modules, by binding identity, so only
            // runtime values are covered; types are the compiler's.
            const owners = new Map<string, { domain: string; value: unknown }>();
            for (const domain of DOMAINS) {
                const module: Record<string, unknown> =
                    await import(`./${domain.name}/index.js`);
                for (const [name, value] of Object.entries(module)) {
                    const owner = owners.get(name);
                    if (owner === undefined) {
                        owners.set(name, { domain: domain.name, value });
                        continue;
                    }
                    expect(owner.value).withContext(
                        `${name} is exported by both ${owner.domain} and ${domain.name}`)
                        .toBe(value);
                }
            }
        });
});
