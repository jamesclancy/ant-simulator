export const REPLAY_EXTENSION = '.antreplay';

export function replayFileName(label: string): string {
  return `ant-simulator-${label.replace(/[^\w-]+/g, '-')}${REPLAY_EXTENSION}`;
}

/**
 * Hand a replay file to the user: the system share sheet when it can share files (phones),
 * else a download. Native (Capacitor) builds use the WebView's share/download behaviour; a
 * dedicated Share/Filesystem export is deferred (docs/REPLAYS.md).
 */
export async function exportReplay(bytes: Uint8Array, name: string): Promise<'shared' | 'saved'> {
  const file = new File([bytes as BlobPart], name, { type: 'application/octet-stream' });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: 'Ant Simulator replay' });
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'shared';
      // Fall through to a download.
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'saved';
}

/** Open the file picker and read the chosen replay. Resolves null if cancelled. */
export function pickReplayFile(): Promise<Uint8Array | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${REPLAY_EXTENSION},application/octet-stream`;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file
        .arrayBuffer()
        .then((buf) => resolve(new Uint8Array(buf)))
        .catch(() => resolve(null));
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
