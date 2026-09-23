export const ZONE_OPTIONS = ['WOMENS', 'MENS', 'FITS', 'CASH', 'GREET', 'FLEX', 'OFFICE', 'TASK', 'STYLIST', 'CEL', 'BOH'];

export const COLOR_OPTIONS = [
  { name: 'Pink', value: '#D9468C' },
  { name: 'Blue', value: '#2563EB' },
  { name: 'Purple', value: '#7C3AED' },
  { name: 'Cool green', value: '#0F9D92' },
  { name: 'Amber', value: '#C47F00' },
  { name: 'Cyan', value: '#0284C7' },
  { name: 'Slate', value: '#475569' },
  { name: 'Orange', value: '#EA580C' },
  { name: 'Lime', value: '#65A30D' },
  { name: 'Red', value: '#DC2626' },
  { name: 'Brown', value: '#795548' },
  { name: 'Navy', value: '#1E3A8A' },
  { name: 'Magenta', value: '#A21CAF' },
  { name: 'Mint', value: '#2D7D5C' },
];

export const DEFAULT_ZONE_COLORS = Object.freeze(Object.fromEntries(
  ZONE_OPTIONS.map((zone, index) => [zone, COLOR_OPTIONS[index].value])
));

const allowedColors = new Set(COLOR_OPTIONS.map(option => option.value));

export function normalizeZoneColors(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_ZONE_COLORS };
  const colors = Object.fromEntries(ZONE_OPTIONS.map(zone => [zone, value[zone]]));
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
