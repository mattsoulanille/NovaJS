import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';
import { map } from 'nova_ecs/datatypes/map';

/**
 * Marks an NPC that has agreed to come to the player's aid after being hailed
 * (see hail_plugin.ts): it flies to the `client` ship and, once alongside,
 * repairs and refuels it. Serializer-registered shared sim state (rolls back /
 * crosses the wire) like the escort command component.
 *
 * `fuel`, when present, makes the errand a FUEL DELIVERY of that many units
 * and nothing else: a neutral ship that SOLD the player fuel (reference H1
 * wave 16: about one jump, no repair). Without it the errand is the free
 * help's full repair and refuel. Optional, so an errand without it encodes
 * exactly as before.
 *
 * This lives in a component-only module (no system imports) so both
 * hail_plugin.ts (the behavior) and npc_ai_plugin.ts (which yields its
 * decision brain to an assisting ship) can import it without an import cycle —
 * the same split disabled_component.ts uses for DisabledComponent.
 */
export const AssistingType = t.intersection([
    t.type({ client: t.string }),
    t.partial({ fuel: t.number }),
]);
export type Assisting = t.TypeOf<typeof AssistingType>;
export const AssistingComponent =
    new Component<Assisting>('AssistingComponent');

/**
 * Where each player stands with THIS ship's price for fuel: player ship
 * uuid -> { asks, countered } (reputation/hail.ts's FuelHaggleState).
 * `asks` is how many of the ship's offers he has already answered (each
 * adds 1,000 to the next one); `countered` is set while the ship's 3/4
 * counter to a Lower Price is on the table (reference H1 wave 17: a second
 * Lower Price then withdraws it, Accept Price pays it).
 *
 * Lives on the NPC, so it goes when the ship goes, and is keyed by player so
 * two pilots haggling with one trader do not share a price. Written only by
 * the deterministic input path (hail_plugin's applyHail, on the tick every
 * peer applies the lowerPrice / requestAssistance record), delta-synced so
 * the comm dialog quotes the price the simulation will charge.
 */
export const FuelHaggleEntryType = t.type({
    asks: t.number,
    countered: t.boolean,
});
export const FuelHaggleType = map(t.string, FuelHaggleEntryType);
export type FuelHaggle = t.TypeOf<typeof FuelHaggleType>;
export const FuelHaggleComponent =
    new Component<FuelHaggle>('FuelHaggle');

/**
 * Where each player stands with THIS ship's Beg For Mercy price on the
 * channel he last haggled over it on: player ship uuid -> { channel, asks,
 * countered } (reputation/hail.ts's MercyHaggleState, reference "R7 a
 * provoked freighter's Lower Price, wave 32"). `channel` names the comm
 * dialog's opening the haggle belongs to (the hail record's `channel`);
 * a record from any other channel starts afresh (hail.ts's
 * mercyHaggleOn). `asks` is how many of that channel's asks the ship has
 * withdrawn (each adds 1,000 to the next plea), `countered` is set while
 * its 3/4 counter is on the table.
 *
 * Lives on the NPC and is keyed by player, like FuelHaggle. Written only by
 * the deterministic input path (hail_plugin's applyHail, on the tick every
 * peer applies the plea's lowerPrice / bribe record). The dialog keeps its
 * own copy of the open channel's haggle and never reads this one; it is
 * serializer-registered so a rollback across a haggle converges.
 */
export const MercyHaggleEntryType = t.type({
    channel: t.number,
    asks: t.number,
    countered: t.boolean,
});
export const MercyHaggleType = map(t.string, MercyHaggleEntryType);
export type MercyHaggle = t.TypeOf<typeof MercyHaggleType>;
export const MercyHaggleComponent =
    new Component<MercyHaggle>('MercyHaggle');
