import * as t from 'io-ts';
import { Component } from "nova_ecs/component";

// The jump sequence's STATE, split out of jump_plugin.ts so a module that
// jump_plugin itself imports (transitively) can still ask "is this ship
// mid-jump?" without an import cycle: planet_plugin ignores the land key
// while a jump runs (reference "Jump phases and fuel (U8), wave 38",
// finding 4), and jump_plugin -> ship_controller_plugin -> planet_plugin
// already. jump_plugin re-exports everything here, so its importers are
// unchanged.

/**
 * The hyperspace jump sequence state machine. Shared, deterministic
 * simulation state: every peer advances every jumping ship's sequence
 * identically. Registered with the serializer, so it crosses to the
 * destination system with the ship (stage 'arriving') and is included
 * in rollback snapshots via the default codec policy.
 */
export const JumpStateType = t.intersection([t.type({
    stage: t.union([
        t.literal('stopping'),
        t.literal('aligning'),
        t.literal('spinup'),
        t.literal('accelerating'),
        t.literal('arriving'),
    ]),
    /** Travel heading (radians): the map-space direction from the
     * origin system to the destination system. */
    direction: t.number,
    /**
     * Destination system uuid. REQUIRED, and it must stay required: this
     * codec is registered with the serializer, so it crosses the wire to
     * other peers and feeds the shared desync hash. Peers may run
     * different builds, and a serializer-registered shape may therefore
     * only ever change ADDITIVELY — an older peer must still decode a
     * newer peer's state. Moving a required field into t.partial is not
     * additive in the direction that matters: the older peer's decoder
     * still demands it and REJECTS the state outright.
     *
     * A vanishing jump (see `vanish`) has no destination world, so it
     * carries the sentinel {@link VANISH_DESTINATION} — the empty string,
     * which is not a legal system uuid — rather than omitting the field.
     */
    to: t.string,
}), t.partial({
    /**
     * TERMINAL SELECTOR: set (always to `true`) on a ship that leaves the
     * game world entirely rather than travelling anywhere — an NPC
     * departing or fleeing the system (see beginDepartureJump). There is
     * no destination room to carry it to, so departure simply deletes it:
     * no InitiateJumpEvent, no FinishJumpEvent, no arrival kinematics.
     * Such a jump's `to` is {@link VANISH_DESTINATION}.
     *
     * ADDITIVE, which is the whole point of spelling the terminal as a
     * flag rather than as "the destination is missing". An OLD peer that
     * predates this field decodes a new vanishing jump fine (it ignores
     * the unknown key), simulates the identical stopping/aligning/spinup/
     * accelerating stages off the fields it does know, and at burn end
     * takes its ordinary depart path: it emits InitiateJumpEvent with the
     * sentinel `to` and its own JumpFromSystem deletes the ship from the
     * world. Both peers therefore end the burn with the ship gone from
     * this system — mixed versions CONVERGE instead of desyncing. (The
     * stray FinishJumpEvent the old peer emits is targeted at the NPC,
     * and only the local player's own ship is ever followed out of a
     * system, so nothing acts on it.)
     *
     * Read through an EXPLICIT check for this flag, never through the
     * falsiness of `to`: the sentinel is falsy on purpose (so a guard that
     * was already asking "is there a destination to load?" still answers
     * no), but the flag is what decides the terminal.
     */
    vanish: t.literal(true),
    /**
     * Set on a ship that is following ANOTHER ship's jump out of the
     * system — the uuid of the ship it is following (in practice a player
     * ship; its escorts are the only followers there are). Three things
     * hang off it, and they are what make a follower's sequence differ
     * from the leader's:
     *
     *  - TERMINAL. A follower does not depart through
     *    JumpFromSystem/FinishJumpEvent (that is the local player's own
     *    system transition, and the client follows it). It emits the same
     *    InitiateJumpEvent, but JumpFromSystem skips it and the owning
     *    module's own listener sweeps it instead — see
     *    EscortDepartJumpSystem (player_escort_plugin). Reusing the one
     *    event is what makes "an escort's carry reaches the client before
     *    the player's FinishJumpEvent" a plain `before: [JumpFromSystem]`
     *    toposort edge rather than an argument about queue order.
     *  - FREE. No fuel is deducted (see the departure case): a follower
     *    must always be able to keep up with the ship it follows.
     *  - CANCELLED WITH THE LEADER. A follower's sequence is only ever
     *    valid while the ship it follows is itself mid-jump, so the stage
     *    machine drops it the moment that stops being true — which is how
     *    "if the parent ship is disabled mid-jump, escorts should not
     *    jump" falls out of the general disabled-cancels-jump rule with no
     *    extra plumbing (see JumpSequenceSystem's leader check).
     */
    follows: t.string,
    /** Logical time (TimeResource ms) when the current timed stage
     * (spinup, accelerating) began. Cleared at departure: logical time
     * differs between systems. */
    stageStart: t.number,
    /**
     * How many further jumps to auto-continue along the route without the
     * player re-pressing the jump key ("multi-jump" outfits, ModType 32). Set
     * when the player first initiates a jump to min(multiJump, route length),
     * decremented on each auto-continued jump, and carried across systems with
     * the entity. Absent/0 means the ship stops after this jump. */
    autoJumpsLeft: t.number,
})]);
export type JumpState = t.TypeOf<typeof JumpStateType>;
export const JumpComponent = new Component<JumpState>('JumpSequence');
