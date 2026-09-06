/**
 * Whether a stellar can be landed on / docked at, from its static spöb
 * data. ONE predicate, quoted by every consumer, so the player's land
 * gate (planet_plugin's AttemptLandingSystem), the NPC AI's choice of
 * destinations (npc_ai_plugin's landingDestinations), and the mission
 * generator's stellar candidates (mission_logic) can never disagree
 * about which stellars are ports.
 *
 * The rules, both from the spöb Flags field (EVN Bible, spöb section):
 *
 *  - 0x0001 "Can land/dock here" must be set. This is the flag that makes
 *    Jupiter (nova:159) and the other 41 stock scenery worlds unlandable,
 *    and it is also how the 16 DESTROYED hypergates of the collapsed
 *    network (HG-Aldebaran nova:130, HG-Vega nova:131, HG-Kon, HG-Murasaki,
 *    HG-Bloodstone, HG-Centauri, HG-Enlightenment, HG-Codehaven,
 *    HG-Rautherion, HG-Porto Rillia, HG-Outbound, HG-Mjolnir,
 *    HG-Nil'kemorya, HG-Ver'ashan, HG-Kel'ariy, HG-Tre'pirana) are marked
 *    dead: each has the bit clear and zero HyperLink destinations, while
 *    every working gate (HG-V01 and friends) has it set. "Destroyed" is
 *    not a runtime state in the data — it is this bit.
 *
 *  - 0x0080 "Can only land here if stellar is destroyed first" makes a
 *    stellar a port ONLY after it has been blown up. Stellar destruction
 *    is not modeled (nothing damages a spöb, and the NCB Yxxx destroy-
 *    stellar operation has no hook), so such a stellar is never landable
 *    today. No stock spöb sets it; it is honored so a plug-in that does
 *    cannot accidentally open a port that should be shut.
 *
 * NCB-gated landing denial (the mïsn/spöb bit tests behind the original's
 * "Landing request denied.") is a separate, unbuilt seam: this predicate
 * is the static one only.
 */
export interface LandableFlags {
    /** spöb Flags 0x0001. */
    canLand: boolean;
    /** spöb Flags 0x0080. */
    landOnlyIfDestroyed: boolean;
}

export function landable(stellar: { flags: LandableFlags }): boolean {
    return stellar.flags.canLand && !stellar.flags.landOnlyIfDestroyed;
}

/**
 * Whether a stellar is INHABITED: spöb Flags 0x0020 CLEAR (EVN Bible, spöb
 * Flags: "0x00000020  Stellar is uninhabited (no traffic control or
 * refuelling)"). One predicate so every "is anybody down there?" consumer
 * quotes the same bit:
 *
 *  - traffic control answering a hail (hail_dialog_plugin),
 *  - MinStatus landing clearance, which the Bible says "is ignored if the
 *    stellar is uninhabited" (stellar_clearance),
 *  - mïsn AvailStel -1, "any inhabited stellar" (mission_logic).
 *
 * NOT among the consumers: the spaceport's Mission BBS. No spöb flag governs
 * it — the Flags word has bits for the commodity exchange, outfitter,
 * shipyard and bar and none for the mission computer — so its button is
 * unconditional on every landable stellar, uninhabited ones included, and
 * govt-range AvailStel selectors (unlike -1, "any inhabited stellar") put
 * real missions on those boards. A stocked BBS therefore says nothing about
 * habitation; see starmap.ts systemDotColor for the case that made this
 * worth writing down.
 *
 * Takes the FLAGS-shaped object rather than the stellar so both a raw
 * PlanetFlags and mission_logic's flattened StellarInfo satisfy it.
 */
export function isInhabited(flags: { uninhabited: boolean }): boolean {
    return !flags.uninhabited;
}

/**
 * Whether a stellar is a PORT: landable AND inhabited. This — not mere
 * landability, and not mere habitation — is what the original game means by
 * a place with a spaceport, and it is the predicate behind:
 *
 *  - the star map's "Ports:" readout. Measured on the original
 *    (ui_screenshots/original_macos_screenshots/map/borders_off.png): over
 *    Sol, whose spöbs are Earth (land+inhab), Mars (land+inhab), Jupiter
 *    (0x0001 clear), Europa (land+inhab) and a Wormhole (landable but
 *    0x0020 set), the readout is exactly "Earth, Mars, Europa". Jupiter is
 *    excluded by landability and the Wormhole by habitation, so BOTH bits
 *    are in the rule. (Kania's readout, "Port Kane, HG-Kania", pins that a
 *    MinStatus 32767 "player can never land" hypergate still counts: only
 *    the two static flags matter.)
 *  - the star map's BLUE system dots — see starmap.ts drawSystem.
 *  - mïsn TravelStel/ReturnStel -2, "random inhabited stellar"
 *    (mission_logic), which must never pick somewhere unlandable.
 *
 * `landOnlyIfDestroyed` is optional because mission_logic's StellarInfo
 * flattens `canLand` to the resolved {@link landable} verdict, which has
 * already accounted for it.
 */
export function isPort(flags: {
    canLand: boolean,
    uninhabited: boolean,
    landOnlyIfDestroyed?: boolean,
}): boolean {
    return flags.canLand && !flags.landOnlyIfDestroyed && isInhabited(flags);
}

/**
 * Whether a SYSTEM counts as inhabited: does it contain at least one port?
 *
 * This is the star map's blue-vs-grey rule (starmap.ts drawSystem). Stellars
 * that fail to resolve are skipped rather than treated as ports.
 */
export function systemIsInhabited(planetIds: readonly string[],
    getPlanet: (id: string) => { flags: LandableFlags & { uninhabited: boolean } }
        | undefined): boolean {
    return planetIds.some(id => {
        const planet = getPlanet(id);
        return planet !== undefined && isPort(planet.flags);
    });
}
