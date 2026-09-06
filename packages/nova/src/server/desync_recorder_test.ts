import 'jasmine';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { DesyncDump } from '../communication/rollback_protocol.js';
import { DesyncRecorder, fingerprintGameData } from './desync_recorder.js';

describe('DesyncRecorder', () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.mkdtemp(path.join(os.tmpdir(), 'desync-recorder-'));
    });

    afterEach(async () => {
        await fs.rm(root, { recursive: true, force: true });
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
                await recorder.flush();
                const [dir] = await fs.readdir(root);
                // The first falls back to its (valid) capture tick; the
                // second has no valid tick at all. Both stay inside.
                expect((await fs.readdir(path.join(root, dir!))).sort())
                    .toEqual([
                        'client____peer_tickinvalid.json',
                        'client_peer-a_tick210.json',
                    ]);
                await expectAsync(fs.access(path.join(root, '..', 'escaped.json')))
                    .toBeRejected();
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
