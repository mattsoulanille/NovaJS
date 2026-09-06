import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * Marks an NPC that has agreed to come to the player's aid after being hailed
 * (see hail_plugin.ts): it flies to the `client` ship and, once alongside,
 * repairs and refuels it. Serializer-registered shared sim state (rolls back /
 * crosses the wire) like the escort command component.
 *
 * This lives in a component-only module (no system imports) so both
 * hail_plugin.ts (the behavior) and npc_ai_plugin.ts (which yields its
 * decision brain to an assisting ship) can import it without an import cycle —
 * the same split disabled_component.ts uses for DisabledComponent.
 */
export const AssistingType = t.type({ client: t.string });
export type Assisting = t.TypeOf<typeof AssistingType>;
export const AssistingComponent =
    new Component<Assisting>('AssistingComponent');
