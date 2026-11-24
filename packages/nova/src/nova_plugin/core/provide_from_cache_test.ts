import 'jasmine';
import { Component } from 'nova_ecs/component';
import { Entity } from 'nova_ecs/entity';
import { World } from 'nova_ecs/world';
import { SYNTHETIC } from 'novaparse/synthetic/universe';
import { getSyntheticGameData } from '../../communication/simulation_test_fixture.js';
import { wireSendPolicyFor } from '../../communication/wire_send_policy.js';
import { makeSystem } from '../make_system.js';
import {
    CacheMissError, CacheMissPolicyResource, defaultCacheMissPolicy,
    ProvideFromCache,
} from './provide_from_cache.js';

/**
 * #345 (ruling of 2026-11-23, option c): a ProvideFromCache miss in a
 * simulation world throws in development and retries in production, the
 * same NODE_ENV switch as the wire's send policy (#272).
 */
describe('ProvideFromCache on a cache miss (#345)', () => {
    const Source = new Component<{ id: string }>('CacheMissSource');
    const Provided = new Component<string>('CacheMissProvided');

    function makeWorld(cache: Map<string, string>) {
        const world = new World('cache miss world');
        world.addSystem(ProvideFromCache({
            name: 'CacheMissTestProvider',
            provided: Provided,
            args: [Source] as const,
            factory: source => cache.get(source.id),
        }));
        world.entities.set('thing', new Entity()
            .addComponent(Source, { id: 'cold' }));
        return world;
    }

    it('throws in a strict world, naming the provider, component and entity', () => {
        const cache = new Map<string, string>();
        const world = makeWorld(cache);
        world.resources.set(CacheMissPolicyResource, 'strict');
        expect(() => world.step()).toThrowMatching(error =>
            error instanceof CacheMissError
            && /CacheMissTestProvider/.test(error.message)
            && /CacheMissProvided/.test(error.message)
            && /thing/.test(error.message));
    });

    it('retries next step in a recovering world, and without the resource', () => {
        for (const policy of ['recover', undefined] as const) {
            const cache = new Map<string, string>();
            const world = makeWorld(cache);
            if (policy) {
                world.resources.set(CacheMissPolicyResource, policy);
            }
            world.step();
            const thing = world.entities.get('thing')!;
            expect(thing.components.has(Provided)).toBeFalse();
            cache.set('cold', 'warm');
            world.step();
            expect(thing.components.get(Provided)).toBe('warm');
        }
    });

    it('never fires on a hit, strict or not', () => {
        const world = makeWorld(new Map([['cold', 'warm']]));
        world.resources.set(CacheMissPolicyResource, 'strict');
        world.step();
        expect(world.entities.get('thing')!.components.get(Provided))
            .toBe('warm');
    });

    it('follows NODE_ENV like the wire send policy: only production recovers', () => {
        expect(wireSendPolicyFor('production')).toBe('recover');
        const saved = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = 'production';
            expect(defaultCacheMissPolicy()).toBe('recover');
            process.env.NODE_ENV = 'development';
            expect(defaultCacheMissPolicy()).toBe('strict');
            delete process.env.NODE_ENV;
            expect(defaultCacheMissPolicy()).toBe('strict');
        } finally {
            if (saved === undefined) {
                delete process.env.NODE_ENV;
            } else {
                process.env.NODE_ENV = saved;
            }
        }
    });

    it('is set on every simulation world makeSystem builds (strict under the spec runner)', async () => {
        const world = await makeSystem(SYNTHETIC.systems.thessaly,
            await getSyntheticGameData(), 'node', { npcs: false });
        expect(world.resources.get(CacheMissPolicyResource))
            .toBe(defaultCacheMissPolicy());
        expect(defaultCacheMissPolicy()).toBe('strict');
    });
});
