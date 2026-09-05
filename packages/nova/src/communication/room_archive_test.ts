import 'jasmine';
import { MockCommunicator } from 'nova_ecs/plugins/mock_communicator';
import { RollbackRelay } from './rollback_relay.js';
import { RoomArchive } from './room_archive.js';

/**
 * The archive's periodic update ran as `void this.update()`: one
 * rejection — a record this world could not stage, a plug-in system
 * throwing on construction — was an unhandled rejection, which exits
 * the server process under Node's default --unhandled-rejections=throw.
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
