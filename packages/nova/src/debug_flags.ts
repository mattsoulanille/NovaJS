/**
 * Global debug switches, readable from anywhere in the client (display and
 * spaceport code; NEVER the simulation — nothing here may influence sim
 * state directly, only what the local player is allowed to ask for).
 *
 * Toggle at runtime from the console: `NovaBrowser.debugFlags.tradeOverride
 * = false` (browser.ts exposes this object).
 */

/**
 * Whether the trade override starts ON for this build: yes in every
 * development build (Matthew's ruling — it stays on for playtests), and in
 * a PRODUCTION build (`NODE_ENV=production` at bundle time, which
 * esbuild.config.js bakes into `process.env.NODE_ENV`) only when the page
 * was opened with a `?debug` query flag. A production peer otherwise gets
 * no shift+click that skips credits, mass, Max, hardpoints, Availability
 * and Require — the sim trusts the client's entity at lift-off, so the
 * override is a one-keystroke cheat in multiplayer.
 */
export function tradeOverrideEnabled(nodeEnv: string | undefined,
    debugInUrl: boolean): boolean {
    return nodeEnv !== 'production' || debugInUrl;
}

function nodeEnv(): string | undefined {
    try {
        // In the browser bundles esbuild substitutes the literal here; in
        // node (the dev server, the specs) it is the real environment.
        return process.env.NODE_ENV;
    } catch {
        return undefined;
    }
}

function debugInUrl(): boolean {
    try {
        return new URLSearchParams(window.location.search).has('debug');
    } catch {
        return false;
    }
}

export const DEBUG_FLAGS = {
    /**
     * Shift+click on a greyed Buy/Sell button in the outfitter goes through
     * anyway, bypassing the can't-buy/can't-sell rules — for re-triggering
     * OnPurchase set strings and other data-repair chores during playtests.
     * The status line says the override was used. ON for now (Matthew) in
     * development builds; see tradeOverrideEnabled for the production gate.
     */
    tradeOverride: tradeOverrideEnabled(nodeEnv(), debugInUrl()),
};
