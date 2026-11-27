let monotonicCounter = 0;

/**
 * Generates collision-resistant IDs even across rapid synchronous mutations
 * (module insertions, duplicate operations, version snapshots).
 */
export function generateUniqueId(prefix = 'id'): string {
  monotonicCounter = (monotonicCounter + 1) % 1_000_000;
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    const shortUuid = String(cryptoObj.randomUUID()).replace(/-/g, '').slice(0, 12);
    return `${prefix}-${shortUuid}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${monotonicCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}
