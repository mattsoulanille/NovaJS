import 'jasmine';
import { ActiveSystemSlot, claimActiveSystem } from './active_system_claim.js';
import { SessionTransitions } from './session_transitions.js';

/**
 * A transition that rejects after naming the destination but before any
 * world exists must not leave the name standing with no world behind it
 * (review of PR #145, finding 6).
 */
describe('claimActiveSystem', () => {
    let sessions: SessionTransitions;
    let activeSystemId: string | undefined;
    let worldPublished: boolean;
    let joined: string[];
    let left: string[];
    let slot: ActiveSystemSlot;
    const rooms = {
        join: (id: string) => {
            joined.push(id);
            return { id };
        },
        leave: (id: string) => {
            left.push(id);
        },
    };

    beforeEach(() => {
        sessions = new SessionTransitions();
        sessions.begin();
        activeSystemId = undefined;
        worldPublished = false;
        joined = [];
        left = [];
        slot = {
            get: () => activeSystemId,
            set: id => { activeSystemId = id; },
            published: () => worldPublished,
        };
    });

    it('names the system and joins its room', async () => {
        await sessions.run(async scope => {
            const room = claimActiveSystem(scope, 'nova:130', rooms, slot);
            expect(room).toEqual({ id: 'nova:130' });
            expect(activeSystemId).toBe('nova:130');
            expect(joined).toEqual(['nova:130']);
        });
        expect(activeSystemId).toBe('nova:130');
        expect(left).toEqual([]);
    });

    it('a rejection before the world exists releases the claim: the room '
        + 'is left and the name cleared', async () => {
        await expectAsync(sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:130', rooms, slot);
            throw new Error('makeSystem rejected');
        })).toBeRejectedWithError('makeSystem rejected');
        expect(activeSystemId).toBeUndefined();
        expect(left).toEqual(['nova:130']);
    });

    it('the session ending mid-transition releases the claim too',
        async () => {
        let resolveBuild!: () => void;
        const build = new Promise<void>(resolve => { resolveBuild = resolve; });
        const transition = sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:130', rooms, slot);
            await scope.race(build);
        });
        const settled = sessions.end();
        await expectAsync(transition).toBeRejected();
        await settled;
        expect(activeSystemId).toBeUndefined();
        expect(left).toEqual(['nova:130']);
        resolveBuild();
    });

    it('a late failure never undoes a NEWER transition\'s claim',
        async () => {
        let failFirst!: (e: Error) => void;
        const firstWait = new Promise<void>((_, reject) => {
            failFirst = reject;
        });
        const first = sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:130', rooms, slot);
            await firstWait;
        });
        // A second transition takes over: the same system, world published.
        await sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:130', rooms, slot);
            worldPublished = true;
        });
        failFirst(new Error('late'));
        await expectAsync(first).toBeRejectedWithError('late');
        expect(activeSystemId).toBe('nova:130');
        expect(left).toEqual([]);
    });

    it('a late failure never undoes a claim on ANOTHER system', async () => {
        let failFirst!: (e: Error) => void;
        const firstWait = new Promise<void>((_, reject) => {
            failFirst = reject;
        });
        const first = sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:130', rooms, slot);
            await firstWait;
        });
        await sessions.run(async scope => {
            claimActiveSystem(scope, 'nova:131', rooms, slot);
        });
        failFirst(new Error('late'));
        await expectAsync(first).toBeRejectedWithError('late');
        expect(activeSystemId).toBe('nova:131');
        expect(left).toEqual([]);
    });
});
