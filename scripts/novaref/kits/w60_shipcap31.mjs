/**
 * Ship-cap variant (beamcap, wave 60): install AFTER w60_shipcap (its name
 * sorts later, so it wins): mïsn 1023 places its 31 Kit Sub Targets and
 * starts NO other mission (OnAccept without S1083 S1052), so the system
 * holds the player + 31 NPCs before the bay launches. w60_sc_b launched 55
 * fighters into an otherwise empty system and then refused: is that the
 * system's ship cap (then 55 - 31 = 24 launch here) or a per-carrier /
 * formation limit (then 55 again)?
 */
import shipcap from "./w60_shipcap.mjs";

const m1023 = shipcap.resources.find((r) => r.type === "mïsn" && r.id === 1023);
export default {
    name: "w60-shipcap31",
    resources: [{ ...m1023, name: "Kit SC 31 targets only", set: { ...m1023.set, onAccept: "!b9064" } }],
};
