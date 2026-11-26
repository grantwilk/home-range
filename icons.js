// Shared line symbols for the atlas controls.
const shapes = {
  hazard:
    '<path d="M11 4a1.2 1.2 0 0 1 2 0l8 14a1.3 1.3 0 0 1-1.1 2H4.1A1.3 1.3 0 0 1 3 18Z"/><path d="M12 9v4m0 3v.2"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v1"/>',
  mountain:
    '<path d="M2 20 10 5l4 7 2-4 6 12H2Z"/><path d="m7.5 9.8 2.5 2 2.2-2.8"/>',
  droplet:
    '<path d="M12 2C10 5.5 5 10.5 5 15a7 7 0 0 0 14 0c0-4.5-5-9.5-7-13Z"/><path d="M8.5 15a3.5 3.5 0 0 0 3.5 3.5"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="2.8"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.3"/><path d="m16 16 5 5"/>',
  share:
    '<path d="M12 15V3m-4 4 4-4 4 4M5 12v7c0 1 .7 2 2 2h10c1.3 0 2-1 2-2v-7"/>',
  thermo:
    '<path d="M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0Z"/><path d="M12 9v8"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2"/>',
  rain: '<path d="M5 14a4 4 0 0 1-.2-8 6 6 0 0 1 11.5 1A3.5 3.5 0 0 1 18 14H5Zm1 3-1 3m6-3-1 3m6-3-1 3"/>',
  cloud:
    '<path d="M6 18a5 5 0 1 1 .2-10 6 6 0 0 1 11.5.7A4.7 4.7 0 1 1 17 18Z"/>',
  chevron: '<path d="m7 10 5 5 5-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5"/>',
  cross: '<path d="m6 6 12 12M18 6 6 18"/>',
  rotate: '<path d="M4 11a8 8 0 1 1 2 7M4 5v6h6"/>',
  location:
    '<circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
};
export const icon = (name, size = 18) =>
  '<svg aria-hidden="true" width="' +
  size +
  '" height="' +
  size +
  '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' +
  shapes[name] +
  "</svg>";
