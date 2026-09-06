import { Resource } from 'nova_ecs/resource';

/**
 * Deterministic entity id allocation for entities spawned by the
 * simulation (projectiles, beams, blasts, bay ships). Replaces random
 * v4 uuids so identical runs produce identical ids. The counter is
 * simulation state: include it in rollback snapshots.
 *
 * `instance` is a prefix on every id this factory mints. A SYSTEM WORLD
 * passes its system id (make_system.ts), so `npc:7` in one system is
 * `nova:130:npc:7` and can never be confused with `nova:131:npc:7`: an
 * entity carried from one world to the next (the player, its escorts) can
 * hold uuids that name things in the world it left, and with a bare
 * per-world counter those uuids named whatever the destination happened
 * to mint under the same number (issue #32). The prefix is a function of
 * the system id alone, so every peer and the server's archive mint the
 * same ids from the same genesis — no determinism cost. A world built
 * for something other than a system (the spaceport's ship-build world)
 * keeps the bare form.
 */
export class IdFactory {
    private count = 0;

    constructor(private readonly instance: string = '') { }

    next(kind = 'entity'): string {
        const instance = this.instance ? `${this.instance}:` : '';
        return `${instance}${kind}:${this.count++}`;
    }

    getState(): number {
        return this.count;
    }

    setState(count: number) {
        this.count = count;
    }
}

export const IdFactoryResource = new Resource<IdFactory>('IdFactory');
