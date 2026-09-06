import * as t from 'io-ts';
import { Component } from 'nova_ecs/component';

/**
 * The government ("gövt") a ship belongs to, as a GovtData id (e.g.
 * "nova:128"). In EV Nova a ship's government comes from the düde/përs that
 * spawns it as an NPC; that spawning does not exist in the sim yet, so this
 * component is optional and absent by default. Player ships have no government
 * unless one is explicitly set.
 *
 * This carries only the id: the static GovtData (allies/enemies, InhJam, etc.)
 * is looked up from the game data by id and re-derived on snapshot restore, so
 * nothing heavy lives on the entity. The id string is JSON-safe, so the
 * component round-trips through the serializer with the default codec policy
 * (no custom snapshot policy needed).
 *
 * Consumers so far:
 *  - jamming_plugin.ts folds the government's InhJam1-4 into the ship's
 *    effective JammingComponent.
 *
 * Left for the future (NPC spawning / reputation work): setting this component
 * when NPCs spawn, and using allies/enemies/CrimeTol/penalties for reputation
 * and target selection.
 */
export const Govt = t.type({
    id: t.string,
});
export type Govt = t.TypeOf<typeof Govt>;

export const GovtComponent = new Component<Govt>('GovtComponent');
