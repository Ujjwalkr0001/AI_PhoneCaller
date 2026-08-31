// Minimal hand-authored stroke icons (no icon library dependency).
// All use currentColor so they inherit color from CSS.
const svg = (paths, viewBox = '0 0 24 24') =>
  `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const iconPhone = svg(
  '<path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1v3.4c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8Z"/>',
);

export const iconSparkle = svg(
  '<path d="M12 3.5c.3 2.4 1 4 2.1 5.1 1.1 1.1 2.7 1.8 5.1 2.1-2.4.3-4 1-5.1 2.1-1.1 1.1-1.8 2.7-2.1 5.1-.3-2.4-1-4-2.1-5.1-1.1-1.1-2.7-1.8-5.1-2.1 2.4-.3 4-1 5.1-2.1 1.1-1.1 1.8-2.7 2.1-5.1Z"/>',
);

export const iconPerson = svg(
  '<circle cx="12" cy="8" r="3.4"/><path d="M5 20c1.2-3.6 4-5.4 7-5.4s5.8 1.8 7 5.4"/>',
);

export const iconCheck = svg('<path d="M5 12.5 9.5 17 19 7.5"/>');

export const iconBack = svg('<path d="M15 5 8 12l7 7"/>');

export const iconMissed = svg(
  '<path d="M16.5 8 21 12.5M21 8l-4.5 4.5"/><path d="M4.8 4.8c1.4 2.8 3.8 5.2 6.6 6.6l1.4-1.4c.3-.3.7-.4 1-.2.8.3 1.7.5 2.6.6"/>',
);
