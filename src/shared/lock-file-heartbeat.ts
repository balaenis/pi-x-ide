// ABOUTME: Owns the serialized lock-file heartbeat scheduler used by TypeScript IDE producers.
// ABOUTME: Exposes refreshNow() and stop() with a repeating timer, error containment, and terminal drain.

export const LOCK_FILE_HEARTBEAT_INTERVAL_MS = 15 * 60 * 1000;

export interface LockFileHeartbeatOptions {
  intervalMs?: number;
  onError?: (error: unknown) => void | Promise<void>;
}

export interface LockFileHeartbeatHandle {
  refreshNow(): Promise<void>;
  stop(): Promise<void>;
}

export function startLockFileHeartbeat(
  refresh: () => void | Promise<void>,
  options: LockFileHeartbeatOptions = {},
): LockFileHeartbeatHandle {
  const intervalMs = options.intervalMs ?? LOCK_FILE_HEARTBEAT_INTERVAL_MS;
  let terminal = false;
  let terminalPromise: Promise<void> | undefined;
  let pendingCount = 0;
  let queueTail: Promise<void> = Promise.resolve();

  const contain = async (work: () => void | Promise<void>): Promise<void> => {
    try {
      await work();
    } catch {
      // Nested containment keeps later accepted work running.
    }
  };

  const runRefresh = async (): Promise<void> => {
    try {
      await refresh();
    } catch (error) {
      await contain(() => options.onError?.(error));
    }
  };

  const accept = (): Promise<void> => {
    pendingCount += 1;
    const request = queueTail.then(async () => {
      try {
        await runRefresh();
      } finally {
        pendingCount -= 1;
      }
    });
    queueTail = request;
    return request;
  };

  const timer = setInterval(() => {
    if (terminal || pendingCount > 0) return;
    void accept();
  }, intervalMs);
  timer.unref();

  const handle: LockFileHeartbeatHandle = {
    refreshNow() {
      if (terminalPromise) return terminalPromise;
      return accept();
    },
    stop() {
      if (!terminalPromise) {
        terminal = true;
        clearInterval(timer);
        terminalPromise = queueTail;
      }
      return terminalPromise;
    },
  };
  return handle;
}
