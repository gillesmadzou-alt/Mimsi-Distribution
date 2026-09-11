// Badging API — shows a small numeric badge on the app icon (installed PWA,
// taskbar/dock) for the count of unread notifications. Silently does nothing
// on browsers/platforms that don't support it (most desktop browsers, iOS
// Safari as of writing) — this is a progressive enhancement, never required.

export function updateAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  try {
    if (count > 0) {
      if ('setAppBadge' in navigator) {
        void (navigator as Navigator & { setAppBadge: (n?: number) => Promise<void> })
          .setAppBadge(count)
          .catch(() => {});
      }
    } else if ('clearAppBadge' in navigator) {
      void (navigator as Navigator & { clearAppBadge: () => Promise<void> })
        .clearAppBadge()
        .catch(() => {});
    }
  } catch {
    // Badging API not supported or blocked — ignore.
  }
}
