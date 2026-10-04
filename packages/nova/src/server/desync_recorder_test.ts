import 'jasmine';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DesyncDump } from '../communication/rollback_protocol.js';
import { DesyncRecorder, fingerprintGameData } from './desync_recorder.js';

/** Every non-directory entry (file or symlink) under `dir`. */
async function entriesUnder(dir: string): Promise<string[]> {
    return (await fs.readdir(dir, { recursive: true, withFileTypes: true }))
        .filter(entry => !entry.isDirectory())
        .map(entry => path.join(entry.parentPath, entry.name))
        .sort();
}

/** Whether nothing exists at `p`. A regular file standing where a
 * directory component should be gives ENOTDIR, not ENOENT; both mean
 * absent, and anything else is a real error. */
async function absent(p: string): Promise<boolean> {
    try {
        await fs.lstat(p);
        return false;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return true;
        }
        throw e;
    }
}

describe('DesyncRecorder', () => {
    /**
     * This spec's private temp directory; everything it creates lives
     * here and goes with it. The recorder's root sits four levels down,
     * so a write that escapes the root by `..` lands in the sandbox,
     * where the specs see it, and not in the shared system temp dir.
     * (Escape specs once probed `<tmpdir>/escaped.json` directly: on
     * Linux that is `/tmp`, shared by every run on the machine, so one
     * file leaked there by a pre-fix run turned the spec red for every
     * later run on that machine; macOS's per-user temp dir hid this.)
     */
    let sandbox: string;
    let root: string;

    beforeEach(async () => {
        sandbox = await fs.mkdtemp(path.join(os.tmpdir(), 'desync-recorder-'));
        root = path.join(sandbox, 'a', 'b', 'c', 'desyncs');
        await fs.mkdir(root, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(sandbox, { recursive: true, force: true });
    });

    const info = {
        tick: 180,
        hashes: [['a', 'h1'], ['b', 'h2']] as [string, string][],
        canonical: 'h1',
        convicted: ['b'],
        archiveOutvoted: false,
        peerProtocols: { a: 1, b: 0 },
    };
    const dump: DesyncDump = {
        tick: 210,
        desyncTick: 180,
        engine: 'test',
        checkpoints: [],
        rollbackLog: [],
    };

    it('writes an incident directory and files the client dump into it',
        async () => {
            const recorder = new DesyncRecorder(root);
            recorder.recordDesync('nova:130', info, {
                baselines: [{
                    tick: 60,
                    snapshot: { entities: [], singleton: [], resources: [] },
                }],
                log: [{ tick: 5, inputs: [] }],
            });
            recorder.recordClientDump('nova:130', 'peer-b', dump);
            await recorder.flush();

            const [incident] = await fs.readdir(root);
            expect(incident).toContain('nova_130_tick180');
            const files = (await fs.readdir(path.join(root, incident!))).sort();
            expect(files).toEqual(['baselines.json',
                'client_peer-b_tick180.json', 'desync.json', 'log.json']);

            const desync = JSON.parse(await fs.readFile(
                path.join(root, incident!, 'desync.json'), 'utf8'));
            expect(desync.roomId).toBe('nova:130');
            expect(desync.tick).toBe(180);
            expect(desync.convicted).toEqual(['b']);
            const written = JSON.parse(await fs.readFile(
                path.join(root, incident!, 'client_peer-b_tick180.json'),
                'utf8'));
            expect(written).toEqual(dump);
        });

    it('records an unsolicited dump in its own directory', async () => {
        const recorder = new DesyncRecorder(root);
        recorder.recordClientDump('nova:130', 'peer-a', dump);
        await recorder.flush();
        const [dir] = await fs.readdir(root);
        expect(dir).toContain('nova_130_dump');
        expect(await fs.readdir(path.join(root, dir!)))
            .toEqual(['client_peer-a_tick180.json']);
    });

    describe('peer-supplied dumps', () => {
        it('never writes outside the incident directory: a path-traversal '
            + 'desyncTick names an "invalid" tick file inside it', async () => {
                const recorder = new DesyncRecorder(root);
                recorder.recordClientDump('nova:130', 'peer-a', {
                    ...dump,
                    desyncTick: '/../../../../escaped' as unknown as number,
                });
                recorder.recordClientDump('nova:130', '../peer', {
                    ...dump,
                    desyncTick: 1.5,
                    tick: '../../x' as unknown as number,
                });
                // Absolute paths, in the peer id and both ticks.
                recorder.recordClientDump('nova:130', '/abs', {
                    ...dump,
                    desyncTick: path.join(sandbox, 'abs_escaped') as unknown as number,
                    tick: '/abs_escaped' as unknown as number,
                });
                // NUL bytes, which fs calls reject outright.
                recorder.recordClientDump('nova:130', 'nul\0peer', {
                    ...dump,
                    desyncTick: 'x\0/../../../nul' as unknown as number,
                });
                // A crafted room id names a directory of its own.
                recorder.recordClientDump('../../../room', 'peer-c', dump);
                await recorder.flush();

                // Nothing anywhere in the sandbox outside the root: an
                // escape of up to four levels would land in here.
                const inside = root + path.sep;
                expect((await entriesUnder(sandbox))
                    .filter(entry => !entry.startsWith(inside)))
                    .toEqual([]);
                const dirs = (await fs.readdir(root)).sort();
                expect(dirs.length).toBe(2);
                const roomDir = dirs.find(dir => dir.endsWith('nova_130_dump'));
                expect(dirs.find(dir => dir !== roomDir))
                    .toMatch(/_{9}room_dump$/);
                // The first falls back to its (valid) capture tick; the
                // second and third have no valid tick at all.
                expect((await fs.readdir(path.join(root, roomDir!))).sort())
                    .toEqual([
                        'client____peer_tickinvalid.json',
                        'client__abs_tickinvalid.json',
                        'client_nul_peer_tick210.json',
                        'client_peer-a_tick210.json',
                    ]);
            });

        it('never writes through a symlinked incident directory', async () => {
            const error = spyOn(console, 'error');
            const outside = path.join(sandbox, 'outside');
            await fs.mkdir(outside);
            const recorder = new DesyncRecorder(root);
            recorder.recordDesync('nova:130', info, { baselines: [], log: [] });
            await recorder.flush();
            // The incident directory is swapped for a link out of the
            // root: the recorder's own name for it still passes a
            // lexical check.
            const [incident] = await fs.readdir(root);
            await fs.rm(path.join(root, incident!), { recursive: true });
            await fs.symlink(outside, path.join(root, incident!));
            recorder.recordClientDump('nova:130', 'peer-b', dump);
            await recorder.flush();
            expect(await fs.readdir(outside)).toEqual([]);
            expect(error).toHaveBeenCalled();
        });

        it('never writes through a symlinked dump file', async () => {
            const error = spyOn(console, 'error');
            const target = path.join(sandbox, 'outside.json');
            const recorder = new DesyncRecorder(root);
            recorder.recordDesync('nova:130', info, { baselines: [], log: [] });
            await recorder.flush();
            const [incident] = await fs.readdir(root);
            await fs.symlink(target, path.join(root, incident!,
                'client_peer-b_tick180.json'));
            recorder.recordClientDump('nova:130', 'peer-b', dump);
            await recorder.flush();
            expect(await absent(target)).toBeTrue();
            expect(error).toHaveBeenCalled();
        });

        it('caps dumps per incident, bytes per dump, and bytes overall',
            async () => {
                const recorder = new DesyncRecorder(root, 50, 30_000,
                    /* maxDumpsPerIncident */ 2,
                    /* maxDumpBytes */ 200,
                    /* maxTotalDumpBytes */ 300);
                const warn = spyOn(console, 'warn');
                // Over the per-dump cap: dropped.
                recorder.recordClientDump('nova:130', 'peer-a', {
                    ...dump, desyncTick: 1, engine: 'x'.repeat(300),
                });
                // Two fit; the third is over the per-incident cap.
                for (const tick of [2, 3, 4]) {
                    recorder.recordClientDump('nova:130', 'peer-a',
                        { ...dump, desyncTick: tick });
                }
                // Another room: its own directory, but the two above
                // (77 bytes each) plus this one's 173 exceed the
                // 300-byte lifetime budget.
                recorder.recordClientDump('nova:131', 'peer-b',
                    { ...dump, desyncTick: 5, engine: 'y'.repeat(100) });
                await recorder.flush();
                const dirs = (await fs.readdir(root)).sort();
                expect(dirs.length).toBe(1);
                expect((await fs.readdir(path.join(root, dirs[0]!))).sort())
                    .toEqual([
                        'client_peer-a_tick2.json',
                        'client_peer-a_tick3.json',
                    ]);
                expect(warn).toHaveBeenCalledTimes(3);
            });
    });

    describe('root layouts', () => {
        it('records under a root whose parent is a symlink', async () => {
            // macOS's /tmp -> /private/tmp, or any symlinked data dir:
            // the containment check must compare resolved paths on
            // both sides, or every legitimate write is refused.
            const real = path.join(sandbox, 'real');
            await fs.mkdir(real);
            await fs.symlink(real, path.join(sandbox, 'link'));
            const recorder = new DesyncRecorder(
                path.join(sandbox, 'link', 'desyncs'));
            recorder.recordDesync('nova:130', info, { baselines: [], log: [] });
            recorder.recordClientDump('nova:130', 'peer-b', dump);
            await recorder.flush();
            const [incident] = await fs.readdir(path.join(real, 'desyncs'));
            expect((await fs.readdir(path.join(real, 'desyncs', incident!)))
                .sort()).toEqual(['baselines.json',
                    'client_peer-b_tick180.json', 'desync.json', 'log.json']);
        });

        it('reports, and writes nothing, when a root component is a file',
            async () => {
                const error = spyOn(console, 'error');
                const file = path.join(sandbox, 'file');
                await fs.writeFile(file, '');
                const recorder = new DesyncRecorder(path.join(file, 'desyncs'));
                recorder.recordDesync('nova:130', info,
                    { baselines: [], log: [] });
                recorder.recordClientDump('nova:131', 'peer-b', dump);
                await recorder.flush();
                expect(error).toHaveBeenCalledTimes(2);
                expect(await absent(path.join(file, 'desyncs'))).toBeTrue();
                expect(await entriesUnder(sandbox)).toEqual([file]);
            });
    });

    it('records the game data fingerprint with the verdict', async () => {
        const recorder = new DesyncRecorder(root);
        recorder.gameDataFingerprint =
            fingerprintGameData({ Ship: ['nova:128'] });
        recorder.recordDesync('nova:130', info, { baselines: [], log: [] });
        await recorder.flush();
        const [incident] = await fs.readdir(root);
        const desync = JSON.parse(await fs.readFile(
            path.join(root, incident!, 'desync.json'), 'utf8'));
        expect(desync.gameDataFingerprint)
            .toBe(fingerprintGameData({ Ship: ['nova:128'] }));
        // Stable across processes: a fixed input hashes identically.
        expect(desync.gameDataFingerprint).toMatch(/^[0-9a-f]{16}$/);
    });

    it('suppresses repeat incidents for a room within the cooldown', async () => {
        const recorder = new DesyncRecorder(root, 50, 60_000);
        recorder.recordDesync('nova:130', info, { baselines: [], log: [] });
        recorder.recordDesync('nova:130', { ...info, tick: 360 },
            { baselines: [], log: [] });
        await recorder.flush();
        expect((await fs.readdir(root)).length).toBe(1);
    });

    it('prunes the oldest incidents beyond the cap', async () => {
        const recorder = new DesyncRecorder(root, 2);
        for (let i = 0; i < 4; i++) {
            recorder.recordDesync(`room${i}`, { ...info, tick: i },
                { baselines: [], log: [] });
            // Distinct timestamps keep directory names unique and
            // lexicographic order meaningful.
            await recorder.flush();
            await new Promise(resolve => setTimeout(resolve, 2));
        }
        const dirs = (await fs.readdir(root)).sort();
        expect(dirs.length).toBe(2);
        expect(dirs[0]).toContain('room2');
        expect(dirs[1]).toContain('room3');
    });
});
