import 'jasmine';
import { IdFactory } from './id_factory.js';

/**
 * Issue #32: two system worlds used to mint identical ids (`npc:7` in
 * both), so a uuid carried across a transition could alias an unrelated
 * ship in the destination. The system-id prefix makes that impossible.
 */
describe('IdFactory', () => {
    it('mints the same ids for the same instance: the allocation is a '
        + 'function of the system id and the draw count alone', () => {
            const a = new IdFactory('nova:130');
            const b = new IdFactory('nova:130');
            expect([a.next('npc'), a.next('npc'), a.next('projectile')])
                .toEqual([b.next('npc'), b.next('npc'), b.next('projectile')]);
        });

    it('never mints the same id in two different systems', () => {
        const origin = new IdFactory('nova:130');
        const destination = new IdFactory('nova:131');
        const carried = origin.next('npc');
        const minted = new Set<string>();
        for (let i = 0; i < 100; i++) {
            minted.add(destination.next('npc'));
        }
        expect(minted.has(carried)).toBeFalse();
        expect(carried).toBe('nova:130:npc:0');
        expect(destination.next('projectile')).toBe('nova:131:projectile:100');
    });

    it('keeps the bare form for a world that is not a system', () => {
        expect(new IdFactory().next('npc')).toBe('npc:0');
    });

    it('restores its counter from a snapshot, prefix intact', () => {
        const ids = new IdFactory('nova:130');
        ids.next();
        ids.next();
        const saved = ids.getState();
        ids.next();
        ids.setState(saved);
        expect(ids.next('beam')).toBe('nova:130:beam:2');
    });
});
