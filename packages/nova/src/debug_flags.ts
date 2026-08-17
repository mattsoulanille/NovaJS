/**
 * Global debug switches, readable from anywhere in the client (display and
 * spaceport code; NEVER the simulation — nothing here may influence sim
 * state directly, only what the local player is allowed to ask for).
 *
 * Toggle at runtime from the console: `NovaBrowser.debugFlags.tradeOverride
 * = false` (browser.ts exposes this object).
 */
export const DEBUG_FLAGS = {
    /**
     * Shift+click on a greyed Buy/Sell button in the outfitter goes through
     * anyway, bypassing the can't-buy/can't-sell rules — for re-triggering
     * OnPurchase set strings and other data-repair chores during playtests.
     * The status line says the override was used. ON for now (Matthew).
     */
    tradeOverride: true,
};
