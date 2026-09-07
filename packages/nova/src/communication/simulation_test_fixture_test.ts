import 'jasmine';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import * as fixture from './simulation_test_fixture.js';

/**
 * The fixture module locates packages/nova from its own file, not from
 * process.cwd(): a spec run from the repo root, or a scratch script
 * that imports the fixture from anywhere, must still find the synthetic
 * set, objects/ and settings/. Under jasmine.json the cwd IS the
 * package root, which would hide a cwd dependence; so re-evaluate the
 * module with the cwd moved elsewhere (a query string makes the ESM
 * loader treat it as a fresh module) and load through that copy.
 */
describe('simulation_test_fixture package root', () => {
    it('resolves the synthetic set from any cwd', async () => {
        const originalCwd = process.cwd();
        process.chdir(os.tmpdir());
        try {
            const elsewhere = await import(new URL(
                './simulation_test_fixture.js?cwd=elsewhere',
                import.meta.url).href) as typeof fixture;
            expect(path.isAbsolute(elsewhere.SYNTHETIC_DATA_ROOT)).toBeTrue();
            // The root comes from the module's own location, not the
            // cwd: identical to the normally-imported fixture's, and not
            // what a cwd-relative resolution would have produced. (Not
            // `startsWith(os.tmpdir())`: a checkout under the temp dir —
            // the turnstone review lanes — legitimately lives there.)
            expect(elsewhere.SYNTHETIC_DATA_ROOT).toBe(fixture.SYNTHETIC_DATA_ROOT);
            expect(elsewhere.SYNTHETIC_DATA_ROOT).not.toBe(
                path.join(os.tmpdir(), 'test_fixtures', 'synthetic'));
            expect(fs.statSync(path.join(elsewhere.SYNTHETIC_DATA_ROOT,
                'Nova Files')).isDirectory()).toBeTrue();
            // And the whole aggregator works through it: the parser over
            // the .ndat, objects/ for the filesystem data, settings/.
            const gameData = elsewhere.makeSyntheticGameData();
            const port = await gameData.data.Planet.get(SYNTHETIC.planets.port);
            expect(port.name).toBe('Port Amberline');
            const settings = await gameData.getSettings!('settings.json');
            expect(settings).toEqual(jasmine.any(Object));
        } finally {
            process.chdir(originalCwd);
        }
    });

    it('agrees with the cwd contract jasmine.json sets', () => {
        expect(fixture.SYNTHETIC_DATA_ROOT).toBe(
            path.join(process.cwd(), 'test_fixtures', 'synthetic'));
    });
});
