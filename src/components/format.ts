/** Formatting helpers shared by the dashboard components. */

export const price = (value: number | null | undefined, decimals: number): string =>
  value === null || value === undefined ? '—' : value.toFixed(decimals);

export const time = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const dateTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString([], {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const regimeLabel = (regime: string): string =>
  regime.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
