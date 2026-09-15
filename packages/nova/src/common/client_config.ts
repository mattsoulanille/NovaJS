import {
    isWireSendPolicy, WireSendPolicy,
} from '../communication/wire_send_policy.js';

/**
 * Server-decided configuration the browser client reads at startup.
 *
 * WHY THE PAGE, AND NOT THE BUNDLE OR THE SOCKET
 * ----------------------------------------------
 * The bundle's own `process.env.NODE_ENV` is fixed at build time
 * (esbuild.config.js), so a setting baked there could only follow the
 * server's mode by rebuilding — and a rebuild the server did not share
 * would leave the two ends disagreeing. A first socket message would
 * arrive AFTER the client's first sends (they are queued until the socket
 * opens, then flushed) and would change the wire schema for every peer.
 * The page is read before the bundle runs a line, is served by the same
 * process that will answer the socket, and needs no new wire shape: the
 * server injects one `<meta>` per setting into index.html
 * (server/setup_routes.ts) and the bundle reads it (browser.ts). So ONE
 * command — `npm run start:prod` — switches both ends.
 *
 * Pure and dependency-free, like version_handshake.ts: the server and the
 * bundle share it, and the specs exercise it without express or a DOM.
 */
export interface ClientConfig {
    /** What a sender does with a message the wire cannot carry. */
    readonly wireSendPolicy: WireSendPolicy;
}

/** `<meta name="...">` carrying the wire send policy. */
export const WIRE_SEND_POLICY_META = 'nova-wire-send-policy';

const HEAD_OPEN = /<head(\s[^>]*)?>/i;

function metaTag(name: string, content: string): string {
    return `<meta name="${name}" content="${content}">`;
}

/**
 * `html` with `config` injected as `<meta>` tags at the top of `<head>`
 * — before any script, so the bundle can read them synchronously.
 * Throws on a page with no `<head>`: a silently unconfigured client
 * would fall back to its bundle's policy and the mismatch would be
 * invisible.
 */
export function injectClientConfig(html: string, config: ClientConfig): string {
    const head = HEAD_OPEN.exec(html);
    if (!head) {
        throw new Error('injectClientConfig: the page has no <head> to carry the config');
    }
    const tags = metaTag(WIRE_SEND_POLICY_META, config.wireSendPolicy);
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n  ${tags}${html.slice(at)}`;
}

/** The subset of `Document` `readClientConfig` uses. */
export interface ConfigDocument {
    querySelector(selectors: string): { getAttribute(name: string): string | null } | null;
}

/**
 * The config the served page carries, or undefined when the page has
 * none (a page from a server that predates it, or a static host) — the
 * caller then falls back to its bundle's own defaults. A value the
 * bundle does not recognize is treated as absent, not as an error: a
 * newer server's setting must not take an older bundle down.
 */
export function readClientConfig(document: ConfigDocument | undefined): ClientConfig | undefined {
    const content = document?.querySelector(`meta[name="${WIRE_SEND_POLICY_META}"]`)
        ?.getAttribute('content');
    if (!isWireSendPolicy(content)) {
        return undefined;
    }
    return { wireSendPolicy: content };
}
