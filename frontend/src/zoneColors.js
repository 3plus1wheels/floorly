export const ZONE_OPTIONS = ['WOMENS', 'MENS', 'FITS', 'CASH', 'GREET', 'FLEX', 'OFFICE', 'TASK', 'STYLIST', 'CEL', 'BOH'];

export const COLOR_OPTIONS = [
  { name: 'Pink', value: '#F3B6D2' },
  { name: 'Blue', value: '#BDD9F5' },
  { name: 'Purple', value: '#D7C6F4' },
  { name: 'Cool green', value: '#B9E5D8' },
  { name: 'Amber', value: '#F6DEA8' },
  { name: 'Cyan', value: '#BDEAF1' },
  { name: 'Slate', value: '#CBD5E1' },
  { name: 'Orange', value: '#F9CEB4' },
  { name: 'Lime', value: '#DDEDB5' },
  { name: 'Red', value: '#F5C3C1' },
  { name: 'Brown', value: '#DEC8B8' },
  { name: 'Navy', value: '#C2CAE8' },
  { name: 'Magenta', value: '#E8C4EB' },
  { name: 'Mint', value: '#C8E8D2' },
];

// Preserve each user's zone-to-colour choices when upgrading the original bold palette.
const LEGACY_COLORS = [
  '#D9468C', '#2563EB', '#7C3AED', '#0F9D92', '#C47F00', '#0284C7', '#475569',
  '#EA580C', '#65A30D', '#DC2626', '#795548', '#1E3A8A', '#A21CAF', '#2D7D5C',
];
const legacyToPastel = new Map(LEGACY_COLORS.map((color, index) => [color, COLOR_OPTIONS[index].value]));

export const DEFAULT_ZONE_COLORS = Object.freeze(Object.fromEntries(
  ZONE_OPTIONS.map((zone, index) => [zone, COLOR_OPTIONS[index].value])
));

const allowedColors = new Set(COLOR_OPTIONS.map(option => option.value));

export function normalizeZoneColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_ZONE_COLORS };
  const colors = Object.fromEntries(ZONE_OPTIONS.map(zone => [zone, legacyToPastel.get(value[zone]) || value[zone]]));
  if (ZONE_OPTIONS.some(zone => !allowedColors.has(colors[zone]))) return { ...DEFAULT_ZONE_COLORS };
  if (new Set(Object.values(colors)).size !== ZONE_OPTIONS.length) return { ...DEFAULT_ZONE_COLORS };
  return colors;
}

export function applyZoneColor(colors, zone, color) {
  if (!ZONE_OPTIONS.includes(zone) || !allowedColors.has(color)) return colors;
  if (colors[zone] === color) return colors;
  const previousColor = colors[zone];
  const otherZone = ZONE_OPTIONS.find(option => option !== zone && colors[option] === color);
  const next = { ...colors, [zone]: color };
  if (otherZone) next[otherZone] = previousColor;
  return next;
}

export function zoneStyle(zone, colors) {
  const bg = colors[zone] || '#475569';
  const rgb = [1, 3, 5].map(offset => parseInt(bg.slice(offset, offset + 2), 16) / 255);
  const luminance = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  return { bg, text: luminance > 0.179 ? '#111827' : '#fff' };
}
