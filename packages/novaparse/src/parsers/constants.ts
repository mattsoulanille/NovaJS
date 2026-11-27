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
 * The frame rate shïp Deionize (and oütf ModType 39's extra Deionize) is
 * counted in: Deionize 100 drains one point of ion charge a frame of
 * THIS rate. GUESS from the drain (reference "Ion charge against the
 * turn, in 5-point steps (E6), wave 42"): the 5-point and 20-point runs
 * agree only if Deionize 1 drains a little over 2 points in the 3.6 s
 * between hits, which 0.01 a 1/56 s frame (2.0) gives and the 1/30 s
 * frame NovaJS used (1.08) does not; the same 56 a second as the beam's
 * Count (BEAM_COUNT_RATE). Was FPS (30).
 */
export const DEIONIZE_FRAME_RATE = 56;

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
