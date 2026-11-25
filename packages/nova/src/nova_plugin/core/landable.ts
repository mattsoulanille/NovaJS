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
 *  - the star map's BLUE system dots — see starmap.ts drawSystem — with
 *    ONE exception, the working hypergate (below; {@link
 *    systemIsInhabited}).
 *
 *    A WORKING HYPERGATE IS A PORT. Every stock one (HG-V01 nova:1400 to
 *    HG-Koria nova:1418) is Flags 0x0011, landable station with 0x0020
 *    clear, and the original's Kania readout lists HG-Kania among the
 *    ports, so the readout question is measured — and the wave-23 map of
 *    VNP-001 reads "Ports: HG-V01" (docs/reference_experiments.md, "Map dot
 *    colours, wave 23"). But a gate does NOT make its system inhabited:
 *    that same map draws VNP-001, VNP-002 and Vellos grey (#c6c6c6) and
 *    reads "Uninhabited System". So this predicate keeps the gate (the
 *    Ports line, mission destinations, the hail gate) and
 *    systemIsInhabited drops it.
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
 * Whether a stellar makes its SYSTEM inhabited on the star map: a {@link
 * isPort port} that is not a transit point (a hypergate or wormhole,
 * PlanetData.gate).
 *
 * MEASURED for hypergates (docs/reference_experiments.md, "Map dot colours,
 * wave 23"): VNP-001 and VNP-002, whose only stellar is a working gate, and
 * Vellos, whose other stellar is uninhabited, draw the uninhabited grey and
 * read "Uninhabited System", while their Ports line still names the gate.
 * GUESS for wormholes: every stock one sets 0x0020 and is no port anyway,
 * so only a plug-in's inhabited wormhole reaches this test; it is treated
 * as the gate it transits like.
 */
export function isSettledPort(planet: {
    flags: LandableFlags & { uninhabited: boolean },
    gate?: { kind: string } | null,
}): boolean {
    return isPort(planet.flags) && !planet.gate;
}

/**
 * Whether a SYSTEM counts as inhabited: does it contain at least one port
 * that is not a gate ({@link isSettledPort})?
 *
 * This is the star map's blue-vs-grey rule (starmap.ts drawSystem) and its
 * "Uninhabited System" caption (starmap_properties.ts), and what a ModVal -1
 * map outfit calls inhabited (discovery.ts mapOutfitSystems; no stock map
 * uses -1). Stellars that fail to resolve are skipped rather than treated as
 * ports.
 *
 * In the stock data the gate rule turns eight sÿst grey — the two NCB
 * copies each of VNP-001 (nova:427 / 621), VNP-002 (425 / 619), Korell
 * (414 / 611) and Vellos (424 / 618) — whose only ports are HG-V01, HG-V02,
 * HG-V0b and HG-V0a.
 */
export function systemIsInhabited(planetIds: readonly string[],
    getPlanet: (id: string) => {
        flags: LandableFlags & { uninhabited: boolean },
        gate?: { kind: string } | null,
    } | undefined): boolean {
    return planetIds.some(id => {
        const planet = getPlanet(id);
        return planet !== undefined && isSettledPort(planet);
    });
}

/**
 * Whether an inhabited system ({@link systemIsInhabited}) REFUSES THE PLAYER
 * everywhere: it has at least one settled port and every one of them would
 * deny the player landing (`refuses`, the caller's landing-clearance
 * verdict — stellar_clearance.ts through stellarClearanceWith). The star
 * map draws such a system ORANGE at a clean record and RED at a negative
 * one (starmap_draw.ts systemDotColor).
 *
 * MEASURED (docs/reference_experiments.md, "Map dot colours", waves 23 and
 * 24): Kit Map Wanted, whose only port (MinStatus 0) refused a pilot at
 * record -500 ("Docking request denied."), is #ff0000 as a neighbour and
 * as the current system, while systems at "Criminal" whose ports still let
 * the player land stayed blue; Kit Map Picky (MinStatus 100) is #ff6300 at
 * record 0.
 *
 * MEASURED, the MIXED system (wave 24, Kit Map Mixed: one port MinStatus 0,
 * one -32767): blue at -500 and at -5, so one open port keeps the system
 * blue — "coloured = you can land nowhere here". Gates never vote (they are
 * not settled ports), so a gate's MinStatus 32767 does not colour a system.
 * Stellars that fail to resolve are skipped.
 */
export function systemRefusesLanding(planetIds: readonly string[],
    getPlanet: (id: string) => {
        flags: LandableFlags & { uninhabited: boolean },
        gate?: { kind: string } | null,
    } | undefined,
    refuses: (planetId: string) => boolean): boolean {
    let settled = 0;
    for (const id of planetIds) {
        const planet = getPlanet(id);
        if (planet === undefined || !isSettledPort(planet)) {
            continue;
        }
        settled++;
        if (!refuses(id)) {
            return false;
        }
    }
    return settled > 0;
}

/**
 * Whether a system holds at least one INHABITED stellar ({@link
 * isInhabited}: spöb Flags 0x0020 clear), landable or not.
 *
 * This is the star map's Show Borders rule, which is NOT the blue-dot rule
 * above: measured on the original (docs/reference_experiments.md, "M5
 * leftover: which systems radiate borders"), an explored system whose only
 * stellar is inhabited but unlandable (Flags 0x0002: no 0x0001, no 0x0020)
 * draws a light grey dot — no port — yet radiates its government's
 * territory; a system with no stellar radiates nothing. The dot asks "is
 * there a port?", the border asks "is anybody there?". In the stock data
 * this separates the four Wraith systems (sÿst 510/521/582/593).
 *
 * Stellars that fail to resolve are skipped, as in {@link
 * systemIsInhabited}.
 */
export function systemHasInhabitedStellar(planetIds: readonly string[],
    getPlanet: (id: string) => { flags: { uninhabited: boolean } }
        | undefined): boolean {
    return planetIds.some(id => {
        const planet = getPlanet(id);
        return planet !== undefined && isInhabited(planet.flags);
    });
}
