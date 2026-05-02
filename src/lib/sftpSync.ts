/**
 * Cross-window mirror for the in-flight transfer queue.
 *
 * Each NewMob window — main app or detached SFTP window — runs its own
 * `transferStore`. When the user opens an SFTP browser in its own window,
 * we want them to see the same transfer rows from either side. The Rust
 * backend emits its events on the original webview (the one that issued
 * the `invoke`), so without this bridge a detached window would never
 * see uploads kicked off by the main window (and vice versa).
 *
 * Implementation notes:
 *   - We use `BroadcastChannel` so messages stay scoped to same-origin
 *     windows and don't have to round-trip through the disk.
 *   - We rebroadcast the *committed* store snapshot on a debounce so
 *     window-local optimistic patches don't flood the channel.
 *   - We tag each broadcast with a sender id and ignore our own echoes
 *     to keep the loop terminating.
 */
import { useTransferStore } from "../stores/transferStore";
import type { TransferItem } from "./sftp";

const CHANNEL = "newmob.sftp.sync";
const senderId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

type SyncMessage = {
  type: "items";
  from: string;
  items: TransferItem[];
};

let channel: BroadcastChannel | null = null;
let unsubscribeStore: (() => void) | null = null;
let lastBroadcast = "";
let suppressNextBroadcast = false;

function snapshot(items: TransferItem[]): string {
  // Stable key set so we don't broadcast for irrelevant referential
  // identity changes; the store still mutates objects in place.
  return items
    .map(
      (it) =>
        `${it.id}|${it.state}|${it.bytes}|${it.size}|${it.error ?? ""}|${it.finishedAt ?? 0}`,
    )
    .join(";");
}

export function attachSftpSync(): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  if (channel) return detachSftpSync;

  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch {
    return () => {};
  }

  channel.onmessage = (event: MessageEvent<SyncMessage>) => {
    const msg = event.data;
    if (!msg || msg.from === senderId) return;
    if (msg.type !== "items") return;
    suppressNextBroadcast = true;
    useTransferStore.setState({ items: msg.items });
  };

  unsubscribeStore = useTransferStore.subscribe((state) => {
    if (suppressNextBroadcast) {
      suppressNextBroadcast = false;
      lastBroadcast = snapshot(state.items);
      return;
    }
    const sig = snapshot(state.items);
    if (sig === lastBroadcast) return;
    lastBroadcast = sig;
    try {
      channel?.postMessage({
        type: "items",
        from: senderId,
        items: state.items,
      } satisfies SyncMessage);
    } catch {
      /* channel may have been closed during teardown */
    }
  });

  // Ask peers for their current state so a freshly-opened window catches up
  // without waiting for the next change to flow through.
  try {
    channel.postMessage({
      type: "items",
      from: senderId,
      items: useTransferStore.getState().items,
    } satisfies SyncMessage);
  } catch {
    /* noop */
  }

  return detachSftpSync;
}

export function detachSftpSync(): void {
  unsubscribeStore?.();
  unsubscribeStore = null;
  try {
    channel?.close();
  } catch {
    /* noop */
  }
  channel = null;
}
