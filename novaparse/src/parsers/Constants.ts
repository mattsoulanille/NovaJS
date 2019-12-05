
const FPS = 30;

const TurnRateConversionFactor = (100 / FPS) * (2 * Math.PI / 360); // 30 / 100 degrees per second -> Radians per second

export { FPS, TurnRateConversionFactor }
