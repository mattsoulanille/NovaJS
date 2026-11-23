// Used for converting from 'frames per' to 'times per second'
export const FPS = 30;

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
