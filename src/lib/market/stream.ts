import { STREAM_URL, capital } from '@/lib/capital/client';

/**
 * The live tick feed.
 *
 * The REST snapshot at `/markets` is not a quote stream: it is whatever the
 * server last wrote down, and for some instruments that is minutes old while
 * the market still reads TRADEABLE. Measured on this account, gold and WTI came
 * back current while Brent was **32 minutes** behind and the two indices two to
 * three minutes behind, none of it visible from the response. That is the gap
 * between this board and the platform's own screen.
 *
 * So prices come from the socket, which is the same feed the platform draws,
 * and the snapshot is left to supply what does not tick: quoting precision,
 * market status and the day's change.
 */

export interface Tick {
  bid: number;
  ask: number;
  /** When the exchange stamped it, not when it arrived. */
  at: number;
}

/** Resubscribe rather than trust a socket that has said nothing for this long. */
const SILENCE_MS = 45_000;
/** Capital closes an idle socket; a ping well inside that keeps it open. */
const PING_INTERVAL_MS = 5 * 60_000;
const RECONNECT_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const ticks = new Map<string, Tick>();

let socket: WebSocket | null = null;
let epics: string[] = [];
let attempt = 0;
let lastMessageAt = 0;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let connecting = false;

interface QuoteMessage {
  destination?: string;
  status?: string;
  payload?: { epic?: string; bid?: number; ofr?: number; timestamp?: number };
}

const nextCorrelation = (() => {
  let n = 0;
  return () => String((n += 1));
})();

/** The freshest tick for an epic, or null when the socket has not sent one. */
export function latestTick(epic: string): Tick | null {
  return ticks.get(epic) ?? null;
}

/** True while the socket is open and has been talking. */
export function streamHealthy(): boolean {
  return socket?.readyState === WebSocket.OPEN && Date.now() - lastMessageAt < SILENCE_MS;
}

/**
 * Makes sure the socket is up and watching exactly these epics.
 *
 * Cheap to call on every poll: it does nothing at all unless the set of markets
 * changed or the connection is gone.
 */
export function watch(wanted: string[]): void {
  const changed = wanted.length !== epics.length || wanted.some((epic) => !epics.includes(epic));
  epics = [...wanted];

  if (!socket || socket.readyState > WebSocket.OPEN) {
    connect();
    return;
  }
  if (changed && socket.readyState === WebSocket.OPEN) subscribe();
}

function connect(): void {
  if (connecting || epics.length === 0) return;
  connecting = true;

  capital
    .tokens()
    .then((session) => {
      const next = new WebSocket(STREAM_URL);
      socket = next;

      next.onopen = () => {
        connecting = false;
        attempt = 0;
        lastMessageAt = Date.now();
        subscribe(session);
        pingTimer = setInterval(() => ping(), PING_INTERVAL_MS);
      };

      next.onmessage = (event) => {
        lastMessageAt = Date.now();
        let message: QuoteMessage;
        try {
          message = JSON.parse(String(event.data)) as QuoteMessage;
        } catch {
          return;
        }
        if (message.destination !== 'quote' || message.status !== 'OK') return;

        const { epic, bid, ofr, timestamp } = message.payload ?? {};
        if (!epic || typeof bid !== 'number' || typeof ofr !== 'number') return;
        ticks.set(epic, { bid, ask: ofr, at: timestamp ?? Date.now() });
      };

      next.onerror = () => next.close();
      next.onclose = () => {
        connecting = false;
        if (socket === next) socket = null;
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        scheduleReconnect();
      };
    })
    .catch(() => {
      connecting = false;
      scheduleReconnect();
    });
}

function scheduleReconnect(): void {
  if (reconnectTimer || epics.length === 0) return;
  const delay = RECONNECT_MS[Math.min(attempt, RECONNECT_MS.length - 1)];
  attempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function send(destination: string, payload?: unknown, session?: Awaited<ReturnType<typeof capital.tokens>>) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  const tokens = session ?? (await capital.tokens());
  socket.send(
    JSON.stringify({
      destination,
      correlationId: nextCorrelation(),
      cst: tokens.cst,
      securityToken: tokens.securityToken,
      ...(payload === undefined ? {} : { payload }),
    }),
  );
}

function subscribe(session?: Awaited<ReturnType<typeof capital.tokens>>): void {
  void send('marketData.subscribe', { epics }, session);
}

/**
 * Keeps the socket alive, and notices when it has gone quiet.
 *
 * A socket can stay open and stop delivering. Silence past the threshold is
 * treated as a dead connection and reconnected, because a stale price shown as
 * live is worse than a gap.
 */
function ping(): void {
  if (Date.now() - lastMessageAt > SILENCE_MS) {
    socket?.close();
    return;
  }
  void send('ping');
}
