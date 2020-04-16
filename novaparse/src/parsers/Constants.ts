// Used for converting from 'frames per' to 'times per second'
export const FPS = 30;

// 30 / 100 degrees per second -> Radians per second
export const TurnRateConversionFactor = (100 / FPS) * (2 * Math.PI / 360);
