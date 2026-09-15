import 'jasmine';
import {
    ConfigDocument, injectClientConfig, readClientConfig, WIRE_SEND_POLICY_META,
} from './client_config.js';

const PAGE = `<!DOCTYPE HTML>
<html>
<head>
  <title>Nova</title>
  <meta name="viewport" content="width=device-width">
</head>
<body>
  <script type="application/javascript" src="browser_bundle.js"></script>
</body>
</html>
`;

/** The one query the reader makes, answered from the injected page. */
function documentOf(html: string): ConfigDocument {
    return {
        querySelector(selectors: string) {
            const name = /meta\[name="([^"]+)"\]/.exec(selectors)?.[1];
            const content = name === undefined ? undefined
                : new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)?.[1];
            return content === undefined ? null
                : { getAttribute: (attribute: string) => attribute === 'content' ? content : null };
        },
    };
}

/**
 * How the server's runtime mode reaches the bundle: injected into the
 * page it serves, read before the socket opens. The specs here are the
 * pure halves; setup_routes_test.ts proves the served page carries it.
 */
describe('client config', () => {
    it('injects the wire send policy as a <meta> at the top of <head>', () => {
        const html = injectClientConfig(PAGE, { wireSendPolicy: 'recover' });
        const meta = `<meta name="${WIRE_SEND_POLICY_META}" content="recover">`;
        expect(html).toContain(meta);
        // Before anything else in <head>, and before the bundle's script.
        expect(html.indexOf(meta)).toBeGreaterThan(html.indexOf('<head>'));
        expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<title>'));
        expect(html.indexOf(meta)).toBeLessThan(html.indexOf('<script'));
        // The rest of the page is untouched.
        expect(html.replace(`\n  ${meta}`, '')).toBe(PAGE);
    });

    it('refuses a page with no <head> rather than serving it unconfigured', () => {
        expect(() => injectClientConfig('<html><body></body></html>', { wireSendPolicy: 'strict' }))
            .toThrowError(/no <head>/);
    });

    it('reads back what was injected', () => {
        for (const wireSendPolicy of ['strict', 'recover'] as const) {
            const html = injectClientConfig(PAGE, { wireSendPolicy });
            expect(readClientConfig(documentOf(html))).toEqual({ wireSendPolicy });
        }
    });

    it('is undefined on a page that carries no config', () => {
        expect(readClientConfig(documentOf(PAGE))).toBeUndefined();
        expect(readClientConfig(undefined)).toBeUndefined();
    });

    it('treats a policy this bundle does not know as absent', () => {
        const html = PAGE.replace('<head>',
            `<head>\n  <meta name="${WIRE_SEND_POLICY_META}" content="lenient">`);
        expect(readClientConfig(documentOf(html))).toBeUndefined();
    });
});
