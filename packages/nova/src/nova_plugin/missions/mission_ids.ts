import {
    DiscoveryAccess, discoveryNCBOperators, DiscoveryNCBOperators,
} from '../player/index.js';

/**
 * Which resource a bare NUMBER written inside a mïsn / crön / oütf resource
 * names: the plug-in-prefix scoping rule (setStringPrefix), the read-side
 * match (sameNumberedResource) and the write-side resolution
 * (resolveNumberedResource and its exists-requiring twin), plus the two
 * NCB operator wirings built on them (ownsOutfit for `Oxxx`,
 * systemDiscoveryOperators for `Exxx` / `Xxxx`). Split out of
 * mission_logic.ts; see that file for the mission machinery itself.
 */

/** The numeric resource id of a global id like "nova:130", or null. */
export function numericId(globalId: string | null): number | null {
    if (!globalId) {
        return null;
    }
    const n = parseInt(globalId.split(':').pop() ?? '', 10);
    return Number.isNaN(n) ? null : n;
}

/** The prefix of a global id like "nova:130" ("nova"). */
export function idPrefix(globalId: string): string {
    const colon = globalId.lastIndexOf(':');
    return colon === -1 ? 'nova' : globalId.slice(0, colon);
}

/**
 * THE ONE RULE for which namespace a bare resource NUMBER written inside a
 * resource's own data — set strings, availability expressions, AvailStel /
 * CompGovt-style numeric fields — is scoped to: the plug-in that WROTE the
 * resource (BaseData.writerPrefix), which is NOT the prefix of its id
 * whenever the plug-in overrides a stock resource, because the override
 * keeps the stock id. Every site that resolves such a number keys it on
 * this prefix and resolves it stock-first through
 * {@link resolveNumberedResource} (or its exists-requiring twin
 * {@link resolveExistingNumberedResource}).
 *
 * Falls back to the id's own prefix for hand-made data that never set a
 * writer — getDefaultBaseData()'s "default" placeholder included, which is
 * what every test fixture that spreads the defaults carries.
 */
export function setStringPrefix(
    resource: { id: string, writerPrefix?: string }): string {
    const writer = resource.writerPrefix;
    return writer && writer !== 'default' ? writer : idPrefix(resource.id);
}

/**
 * Whether the player owns at least one of the outfit a resource written by
 * plug-in `prefix` means by the bare number `id` — the `Oxxx` operator's
 * question, shared by a mïsn's AvailBits (testBits) and a crön's EnableOn
 * (cron_logic.ts). Resolved through {@link sameNumberedResource}: stock's
 * outfit n, or the writer's own — never a third plug-in's n.
 */
export function ownsOutfit(owned: ReadonlyMap<string, number> | undefined,
    id: number, prefix: string): boolean {
    if (!owned) {
        return false;
    }
    for (const [globalId, count] of owned) {
        if (count > 0 && sameNumberedResource(globalId, id, prefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Whether the resource with global id `globalId` is the one a mission
 * from `missionPrefix` means by the bare number `n`. Under the id-space
 * rules a plug-in's number resolves to the STOCK resource (`nova:n`) when
 * stock has one — including plug-in overrides of it — and to the plug-in's
 * OWN (`<prefix>:n`) otherwise; two plug-ins that each add a new resource
 * n get separate ids. So the number must match AND the prefix must be
 * either nova or the mission's own — never a third plug-in's. Comparing
 * numbers alone made ARPIA's "any stellar of govt 196" (arpia:196) match
 * Planet Rico's Gravit Station (govt "Planet Rico:196").
 */
export function sameNumberedResource(globalId: string | null | undefined,
    n: number, missionPrefix: string): boolean {
    if (!globalId) {
        return false;
    }
    if (numericId(globalId) !== n) {
        return false;
    }
    const prefix = idPrefix(globalId);
    return prefix === 'nova' || prefix === missionPrefix;
}

/**
 * The WRITE-side twin of {@link sameNumberedResource}: which single global
 * id a resource from `prefix` means by the bare number `n`. Same id-space
 * rule, applied in the one direction a set string needs it — `Gxxx` has to
 * name exactly one outfit to grant.
 *
 * `existingId` reports whether a global id exists in the relevant id space
 * (the outfits, for Gxxx/Dxxx). Stock wins when it has an `n`, including a
 * plug-in's override of a stock resource, which keeps its "nova:" id;
 * otherwise the resource means its own plug-in's `n`. Extra Outfits' crön
 * 500 `G135 G135 G135` is the stock IR Missile (nova:135), while its crön
 * 504 `G464 G464 G464` is the plug-in's own Siege Mine — the same number
 * range, told apart only by what stock happens to define.
 *
 * With no id space to consult the plug-in's own is assumed, which is the
 * behaviour every call site had before this existed.
 */
export function resolveNumberedResource(n: number, prefix: string,
    existingId?: (globalId: string) => boolean): string {
    if (existingId?.(`nova:${n}`)) {
        return `nova:${n}`;
    }
    return `${prefix}:${n}`;
}

/**
 * {@link resolveNumberedResource} for references that must name a resource
 * that actually EXISTS: undefined when neither stock nor `prefix`'s own
 * data defines `n`.
 *
 * The `Exxx` / `Xxxx` system operators need this because their id space is
 * sparse where the outfit one is dense. `Gxxx` naming a missing outfit
 * grants a count of an id nothing can look up, which the shops simply skip;
 * `Xxxx` naming a missing sÿst would write a phantom system id into the
 * pilot's PERSISTED discovery record, where it would sit forever. Same
 * stock-first rule, one extra question.
 *
 * Without an id space to consult the plug-in's own is assumed, exactly as
 * its twin does — a caller that cannot answer "does this exist" gets the
 * pre-existing behaviour rather than silently dropping every reference.
 */
export function resolveExistingNumberedResource(n: number, prefix: string,
    existingId?: (globalId: string) => boolean): string | undefined {
    if (!existingId) {
        return `${prefix}:${n}`;
    }
    if (existingId(`nova:${n}`)) {
        return `nova:${n}`;
    }
    return existingId(`${prefix}:${n}`) ? `${prefix}:${n}` : undefined;
}

/**
 * The `Exxx` / `Xxxx` operators for an expression written by plug-in
 * `prefix`, or undefined when the caller has no discovery record to offer
 * (the operators then fall back to their unimplemented defaults: `Exxx`
 * false, `Xxxx` ignored with a warning).
 *
 * Rebuilt per resource, like every other numeric-id wiring here, because
 * the sÿst number in `X130` means whatever the plug-in that WROTE that
 * expression means by 130.
 */
export function systemDiscoveryOperators(
    discovery: DiscoveryAccess | undefined, prefix: string,
    systemExists?: (globalId: string) => boolean):
    DiscoveryNCBOperators | undefined {
    if (!discovery) {
        return undefined;
    }
    return discoveryNCBOperators(discovery, id =>
        resolveExistingNumberedResource(id, prefix, systemExists));
}
