import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * Links a launched fighter back to the bay weapon that launched it, so
 * docking can refund a round of ammo to the carrier's magazine and so
 * the outfitter can count still-deployed fighters against buy caps.
 *
 * A separate component rather than data folded into
 * ReturnWhenTargetRemovedComponent: that one is a registered marker
 * (markerType / `encode: () => null`) on the wire, and giving it a
 * payload would change its codec, so old and new peers would disagree
 * about the shape of an existing component. A NEW component is additive
 * — peers that don't know it ignore the extra key.
 *
 * Defined in `ship` (what a ship IS), not with the bays that launch it in
 * `escorts`, so the formation layer (`npc`, which `escorts` depends on) can
 * tell a fighter from a hired escort: they share one formation, hired
 * escorts in the front ranks (reference F1c). The bay plugin re-exports
 * it and still registers it with the serializer; the wire key is the
 * component's name, so its home module does not matter to the wire.
 */
export const BayFighter = t.intersection([t.type({
    /** Global id of the bay wëap this fighter launched from. */
    bayWeaponId: t.string,
}), t.partial({
    /**
     * Present (true) while the fighter is still shedding a launch kick
     * that was under its own top speed (bay_plugin's
     * BayLaunchBrakeSystem); dropped once its velocity matches its
     * carrier's, or the carrier is gone. Never set on a fighter kicked
     * out faster than it can fly, which coasts on.
     */
    launchBrake: t.literal(true),
})]);
export type BayFighter = t.TypeOf<typeof BayFighter>;
export const BayFighterComponent =
    new Component<BayFighter>('BayFighterComponent');
