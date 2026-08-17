/**
 * WHO the status bar's target pane says you are looking at: the name on
 * its top line and the subtitle beneath it. Pure so the precedence is
 * testable without PIXI, and shared with the hail dialog's identity
 * block so the two can never disagree about a ship's name.
 *
 * Three sources of identity, most specific first:
 *
 *  - A PËRS. "A përs person's name and subtitle replace the ship class
 *    name and subtitle on the target display" (EVN Bible, përs section).
 *
 *  - A MISSION's SPECIAL SHIP. mïsn ShipNameID "tells Nova how to name
 *    the special ships" and ShipSubtitle "which subtitle, if any, to
 *    use for the special ships"; one name and one subtitle are drawn
 *    from those STR# lists when the mission is ACCEPTED (the Bible's
 *    <SN> note pins the timing) and every special ship of that mission
 *    wears them. This is what makes a bounty target read "Doomblade"
 *    instead of "Thunderhead", and it is the same string <SN> expands
 *    to in the briefing.
 *
 *  - Otherwise the SHIP CLASS's own name and subtitle.
 *
 * Përs outranks mission because a mission can REPLACE a përs hull with
 * its special ship (përs Flags 0x0040) — but the person is still the
 * person, and the original goes on titling them by name.
 *
 * The name/subtitle are kept separate: the original picks each list
 * independently, so a mission may name its ships without subtitling
 * them (the bounties) or subtitle them without naming them (mïsn
 * nova:685, "Assassinate Krane").
 */
export interface TargetIdentitySources {
    /** PersComponent's name, when the target is a person. */
    persName?: string;
    /** PersComponent's subtitle ('' when the person has none). */
    persSubtitle?: string;
    /** MissionShipComponent's name, when the target is a mission's
     * special ship and its mïsn set a ShipNameID. */
    missionName?: string;
    /** MissionShipComponent's subtitle (mïsn ShipSubtitle). */
    missionSubtitle?: string;
    /** The ship class's own name (ShipData.name). */
    shipClass: string;
    /** The ship class's own subtitle (ShipData.subtitle). */
    shipSubtitle?: string;
}

export interface TargetIdentity {
    name: string;
    subtitle: string;
    /**
     * The name is the SHIP'S OWN (a person's or a mission's), not its
     * class. The hail dialog needs the distinction the target pane does
     * not: it titles a named ship by that name and an anonymous one
     * "Class: <ship class>".
     */
    named: boolean;
}

export function targetIdentity(s: TargetIdentitySources): TargetIdentity {
    const given = s.persName || s.missionName;
    return {
        name: given || s.shipClass,
        subtitle: s.persSubtitle || s.missionSubtitle || s.shipSubtitle || '',
        named: Boolean(given),
    };
}
