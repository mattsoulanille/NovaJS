import 'jasmine';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginPrefixConflictError } from 'novaparse/id_space_handler';
import { SYNTHETIC_DATA_ROOT } from '../../communication/simulation_test_fixture.js';
import { loadServerNovaParse } from './load_nova_parse.js';

/**
 * Issue #310 (maintainer's ruling): two installed plug-ins that resolve to
 * one namespace prefix are a server-side error and the server refuses to
 * start, rather than logging and serving a data set in which one silently
 * overwrote the other. server.ts exits 1 on the rejection of the parse
 * worker's init, which is this function.
 */
describe('loadServerNovaParse (issue #310)', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nova-prefix-conflict-'));
        fs.mkdirSync(path.join(tmpDir, 'Nova Files'));
        fs.mkdirSync(path.join(tmpDir, 'Plug-ins'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('refuses to load when two plug-ins share a prefix, naming both',
        async () => {
            // Contents do not matter: the check is on the names, and runs
            // before any resource is read.
            fs.writeFileSync(path.join(tmpDir, 'Plug-ins', 'Foo.rez'), '');
            fs.writeFileSync(path.join(tmpDir, 'Plug-ins', 'Foo.ndat'), '');
            await expectAsync(loadServerNovaParse(tmpDir))
                .toBeRejectedWithError(PluginPrefixConflictError,
                    /"Foo\.ndat" and "Foo\.rez"/);
        });

    it('loads plug-ins whose names differ only past the first dot',
        async () => {
            fs.writeFileSync(path.join(tmpDir, 'Plug-ins', 'X 1.0.ndat'), '');
            fs.writeFileSync(path.join(tmpDir, 'Plug-ins', 'X 1.1.ndat'), '');
            // Empty files: they are reported and skipped, which is fine.
            spyOn(console, 'warn');
            spyOn(console, 'error');
            const novaParse = await loadServerNovaParse(tmpDir);
            // Let the parse finish before the directory goes away.
            expect(await novaParse.idSpace).not.toBeInstanceOf(Error);
        });

    it('loads a conflict-free data set', async () => {
        const novaParse = await loadServerNovaParse(SYNTHETIC_DATA_ROOT);
        expect((await novaParse.ids).Ship.length).toBeGreaterThan(0);
    });
});
