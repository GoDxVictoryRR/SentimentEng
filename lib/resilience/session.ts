// lib/resilience/session.ts

declare const puter: any;

const SESSION_HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes (tokens typically last 5-10min)
let lastHeartbeatAt = 0;

/**
 * Called before any puter.kv or puter.ai operation.
 * Proactively refreshes the session token before it expires
 * rather than reactively handling 401s mid-operation.
 */
export async function ensureSession(): Promise<void> {
    if (Date.now() - lastHeartbeatAt < SESSION_HEARTBEAT_INTERVAL_MS) return;

    try {
        // Lightweight KV ping — reads a key that is always present
        // This forces Puter to validate + refresh the session token
        await puter.kv.get('session:heartbeat');
        await puter.kv.set('session:heartbeat', String(Date.now()));
        lastHeartbeatAt = Date.now();
    } catch (err: any) {
        if (err?.status === 401 || err?.code === 'AUTH_EXPIRED') {
            // Token is expired — attempt silent re-auth via Puter SDK
            try {
                await puter.auth.signIn();  // re-opens auth if possible in worker context
                lastHeartbeatAt = Date.now();
                console.warn('[Session] Token refreshed via re-auth');
            } catch {
                // Cannot re-auth in worker context (no browser UI available)
                // Throw a typed error so the pipeline can handle gracefully
                throw new SessionExpiredError('Puter session expired and could not be refreshed in worker context');
            }
        }
    }
}

export class SessionExpiredError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SessionExpiredError';
    }
}
