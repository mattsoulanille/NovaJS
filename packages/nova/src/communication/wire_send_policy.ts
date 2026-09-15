/**
 * What a sender does with an outgoing message its wire cannot carry.
 *
 * The live wire is schema'd Avro (wire_codec.ts), derived from the io-ts
 * codecs of the messages the rooms are DESIGNED to send. A message the
 * schema rejects is therefore a bug in the sender — a shape nobody typed
 * — never a network condition. The ruling on #272: in development that
 * bug is a HARD ERROR (`strict`: the send throws, so it fails the spec or
 * lands on the console with a stack), and only a production server
 * recovers (`recover`: drop the message with a warning and keep the
 * socket, as every build did before the ruling).
 *
 * The mode is `NODE_ENV`, the project's one dev/production switch
 * (esbuild bakes it into the browser bundles; node reads the real
 * environment): `production` recovers, anything else — including the
 * spec runner and `node dist/server.js` — is strict. The client does NOT
 * consult its own bundle's `NODE_ENV` for this, though: the server
 * announces its policy in the page it serves (common/client_config.ts),
 * so `npm run start:prod` switches BOTH ends without a rebuild.
 */
export type WireSendPolicy = 'strict' | 'recover';

export const WIRE_SEND_POLICIES: readonly WireSendPolicy[] = ['strict', 'recover'];

export function isWireSendPolicy(value: unknown): value is WireSendPolicy {
    return (WIRE_SEND_POLICIES as readonly unknown[]).includes(value);
}

/** The policy `NODE_ENV=<nodeEnv>` selects. */
export function wireSendPolicyFor(nodeEnv: string | undefined): WireSendPolicy {
    return nodeEnv === 'production' ? 'recover' : 'strict';
}

/** The policy of this process (or bundle): `wireSendPolicyFor(NODE_ENV)`. */
export function defaultWireSendPolicy(): WireSendPolicy {
    let nodeEnv: string | undefined;
    try {
        // esbuild substitutes the literal in the browser bundles; node
        // reads the environment. A host with no `process` is strict.
        nodeEnv = process.env.NODE_ENV;
    } catch {
        nodeEnv = undefined;
    }
    return wireSendPolicyFor(nodeEnv);
}

/** Thrown (under `strict`) for a message the wire cannot carry. */
export class UncarriableMessageError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UncarriableMessageError';
    }
}

/**
 * The one place a sender reports a message its wire cannot carry.
 * `description` says which message and why (the codec's error).
 * `strict` throws it (the message is not sent either way); `recover`
 * hands it to `warn` and returns.
 */
export function reportUncarriable(policy: WireSendPolicy,
    warn: (m: string) => void, description: string): void {
    if (policy === 'recover') {
        warn(description);
        return;
    }
    throw new UncarriableMessageError(`${description} (a bug in the sender: `
        + `the wire schema is derived from what the rooms are designed to `
        + `send. This is a hard error in development; NODE_ENV=production `
        + `— \`npm run start:prod\` — drops the message with a warning instead)`);
}
