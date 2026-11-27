// Used for converting from 'frames per' to 'times per second'
export const FPS = 30;

/**
 * The rate a BEAM's wëap Count (and its Decay tail) runs at, units per
 * second: not the 30 fps game frame every other Count uses. MEASURED
 * (reference "Beam Count's unit (E10, the hub's question), wave 41"):
 * Count 10 / 30 / 60 beams showed for 5 / 16 / 32 recorded 30 fps frames,
 * proportional with no offset, about Count / 56 s: one unit per frame of
 * the original's own drawing (F12 read about 56 fps on that machine).
 * GUESS: a fixed 56 a second (the Count-10 beam read nearer 60).
 */
export const BEAM_COUNT_RATE = 56;

/**
 * The rate an NPC's TURRETED beam runs its Count (and Decay tail) at,
 * units per second: the 30 fps game frame, not BEAM_COUNT_RATE. MEASURED
 * (reference "The beam Count clock (the hub's item 2, E10), wave 52"):
 * an NPC's Count-30 turret beam showed 30 recorded frames every shot
 * (seven shots, Impact 0; the NPC tractor 29-31 in waves 50-51), while
 * an NPC's FIXED beam (16-18) and the player's TURRET beam (17) ran
 * Count / 56 like the player's fixed beam. GUESS for the cause: the
 * original re-aims an NPC turret beam once per 1/30 s AI tick and ages it
 * there. Which beams take it is decided per shot by the firer and the
 * mount (nova beam_plugin.ts beamCountRateFor).
 */
export const NPC_TURRET_BEAM_COUNT_RATE = FPS;

/**
 * The frame rate shïp Deionize (and oütf ModType 39's extra Deionize) is
 * counted in: Deionize 100 drains one point of ion charge a frame of
 * THIS rate, so Deionize D drains D / 100 x DEIONIZE_FRAME_RATE points a
 * second.
 *
 * MEASURED (reference "The ion charge read directly (E6, the hub's item
 * 2), wave 50", finding 1): one 30-point hit on a Deionize-1 hull cut
 * its turn for 102.9 and 103.0 s (two runs), then gave it back whole:
 * 30 / 103 = 0.2913 points a second, 0.01 a frame of that machine's
 * 29.13 Hz tick. So 0.01 x Deionize a GAME frame, and the game frame is
 * the nominal 30 fps every other per-frame field converts at (FPS, the
 * #316 ruling; the reference machine's 2.8 % under 30 Hz is the same
 * offset the speeds carry): Deionize 1 = 1 / 100 x 30 = 0.30 a second,
 * and the 30-point hit lasts 100 s of game time (103 s on that machine).
 * Was 56 (a GUESS from wave 42, which had missed the take-off's hits
 * before its analysis window; its recount puts the drain here too).
 */
export const DEIONIZE_FRAME_RATE = FPS;

// shïp Speed and Accel, measured on the original EV Nova 1.1.1 (#316;
// docs/reference_experiments.md, "U1"): they do NOT share the wëap Speed
// encoding (pixels/frame * 100, WEAP_SPEED_FACTOR in weapon_parse.ts).
//
// - Speed: 1.5 * Speed / 100 pixels per game frame. A Speed-300 ship tops
//   out at 4.5 px/frame.
// - Accel: Accel / 5000 pixels per frame per frame.
//
// Both are converted to the px/s and px/s^2 the MovementSystem integrates
// at the NOMINAL 30 frames per second (Matthew's ruling on #316; the
// reference machine actually ran ~3% under 30 Hz). So Speed 300 -> 135
// px/s and Accel 300 -> 54 px/s^2: a ship whose Speed equals its Accel
// reaches top speed in 135 / 54 = 2.5 s, not 1 s.
//
// These two factors are the single source of truth for shïp and oütf
// speed/acceleration. Code that shows the raw shïp numbers again (the
// shipyard's ship info, the player info dialog) divides by them.
export const ShipSpeedConversionFactor = 1.5 * FPS / 100;

export const ShipAccelerationConversionFactor = FPS * FPS / 5000;

// 10 is 30° per second.
export const ShipTurnRateConversionFactor = (30 / 10) * (2 * Math.PI / 360);
//(100 / 30) * (2 * Math.PI / 360);

// 100 is 30° per second
export const OutfitTurnRateConversionFactor = ShipTurnRateConversionFactor / 10;
