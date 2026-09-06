import 'jasmine';
import { World } from 'nova_ecs/world';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';

// The archive's periodic update builds the room's world lazily via
// makeSystem, whose genesis loads reject when game data stays
// unloadable (#60). The interval callback must catch that: an
// unhandled rejection kills the server process under Node's default
// --unhandled-rejections=throw, taking every room's relay with it.
describe('RoomArchive periodic update', () => {
    // Enough for a rejecting makeWorld: update never reaches the relay
    // before construction fails, and a fresh world at tick 0 has
    // nothing to step to.
    const relay = { tick: 0, inputLog: [], trimLog() { } } as unknown as RollbackRelay;
    let archive: RoomArchive | undefined;

    beforeEach(() => {
        jasmine.clock().install();
    });

    afterEach(() => {
        archive?.close();
        archive = undefined;
        jasmine.clock().uninstall();
    });

    /** Lets the rejection propagate through update()'s await chain. */
    async function settle() {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
        await new Promise(resolve => setImmediate(resolve));
    }

    it('logs a failed world build instead of leaking an unhandled rejection', async () => {
        const error = spyOn(console, 'error');
        archive = new RoomArchive(relay, () => Promise.reject(
            new Error('Failed to load düde nova:128 after 3 attempts')),
            { name: 'nova:128' });

        jasmine.clock().tick(1000);
        await settle();

        // Jasmine fails the running spec on an unhandled rejection,
        // so reaching this line at all is the guard; the log is the
        // observable trace. With no world yet, the archive is at tick 0.
        expect(error).toHaveBeenCalledWith(jasmine.stringMatching(
            /Archive nova:128 update failed at tick 0: .*düde nova:128/));
        expect(archive.archiveWorld).toBeUndefined();
    });

    it('retries construction on the next tick after a failed build', async () => {
        spyOn(console, 'error');
        let attempts = 0;
        archive = new RoomArchive(relay, async () => {
            attempts++;
            if (attempts === 1) {
                throw new Error('transient');
            }
            return new World('archive');
        });

        jasmine.clock().tick(1000);
        await settle();
        expect(attempts).toBe(1);
        expect(archive.archiveWorld).toBeUndefined();

        jasmine.clock().tick(1000);
        await settle();
        expect(attempts).toBe(2);
        expect(archive.archiveWorld).toBeDefined();
    });
});

/**
 * The archive's periodic update ran as `void this.update()`: one
 * rejection — a record this world could not stage, a plug-in system
 * throwing on construction — was an unhandled rejection, which exits
 * the server process under Node's default --unhandled-rejections=throw.
 * Against a real relay, and listening for the stray rejection itself.
 */
describe('RoomArchive', () => {
    it('a failing periodic update is reported, never an unhandled rejection',
        async () => {
            const server = new MockCommunicator('server');
            const relay = new RollbackRelay(server, { autoClock: false });
            const unhandled: unknown[] = [];
            const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
            process.on('unhandledRejection', onUnhandled);
            const errors = spyOn(console, 'error');
            // Real timers are not mocked: let the promise chain of a
            // failed update settle completely between intervals.
            const settle = () => new Promise(resolve => setImmediate(resolve));
            jasmine.clock().install();
            let attempts = 0;
            const archive = new RoomArchive(relay, async () => {
                attempts++;
                throw new Error('makeSystem exploded');
            }, { name: 'nova:130' });
            try {
                // Two intervals: the first failure must not stop the
                // second attempt either.
                jasmine.clock().tick(1001);
                await settle();
                jasmine.clock().tick(1001);
                await settle();
            } finally {
                archive.close();
                jasmine.clock().uninstall();
            }
            // Let any stray rejection surface before asserting.
            await new Promise(resolve => setTimeout(resolve, 5));
            process.off('unhandledRejection', onUnhandled);
            relay.close();
            expect(attempts).toBe(2);
            expect(unhandled).toEqual([]);
            expect(errors).toHaveBeenCalledTimes(2);
        });
});
