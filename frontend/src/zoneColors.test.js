import { applyZoneColor, COLOR_OPTIONS, DEFAULT_ZONE_COLORS, normalizeZoneColors, ZONE_OPTIONS, zoneStyle } from './zoneColors';

test('default zones have distinct colours and the requested colour families', () => {
  expect(new Set(Object.values(DEFAULT_ZONE_COLORS)).size).toBe(ZONE_OPTIONS.length);
  expect(COLOR_OPTIONS.find(option => option.value === DEFAULT_ZONE_COLORS.WOMENS).name).toBe('Pink');
  expect(COLOR_OPTIONS.find(option => option.value === DEFAULT_ZONE_COLORS.MENS).name).toBe('Blue');
  expect(COLOR_OPTIONS.find(option => option.value === DEFAULT_ZONE_COLORS.FITS).name).toBe('Purple');
  expect(COLOR_OPTIONS.find(option => option.value === DEFAULT_ZONE_COLORS.CASH).name).toBe('Cool green');
});

test('applying an occupied colour swaps assignments and preserves uniqueness', () => {
  const colors = applyZoneColor(DEFAULT_ZONE_COLORS, 'WOMENS', DEFAULT_ZONE_COLORS.MENS);
  expect(colors.WOMENS).toBe(DEFAULT_ZONE_COLORS.MENS);
  expect(colors.MENS).toBe(DEFAULT_ZONE_COLORS.WOMENS);
  expect(new Set(Object.values(colors)).size).toBe(ZONE_OPTIONS.length);
});

test('invalid saved colours fall back to defaults', () => {
  expect(normalizeZoneColors({ WOMENS: '#000000' })).toEqual(DEFAULT_ZONE_COLORS);
  expect(normalizeZoneColors({ ...DEFAULT_ZONE_COLORS, MENS: DEFAULT_ZONE_COLORS.WOMENS })).toEqual(DEFAULT_ZONE_COLORS);
});

test('saved bold colours migrate to the matching pastel palette without losing swaps', () => {
  const saved = { ...DEFAULT_ZONE_COLORS, WOMENS: '#2563EB', MENS: '#D9468C' };
  const normalized = normalizeZoneColors(saved);
  expect(normalized.WOMENS).toBe(DEFAULT_ZONE_COLORS.MENS);
  expect(normalized.MENS).toBe(DEFAULT_ZONE_COLORS.WOMENS);
  expect(new Set(Object.values(normalized)).size).toBe(ZONE_OPTIONS.length);
});

test('text colour remains readable for light and dark zones', () => {
  expect(zoneStyle('STYLIST', DEFAULT_ZONE_COLORS).text).toBe('#111827');
  expect(zoneStyle('MENS', DEFAULT_ZONE_COLORS).text).toBe('#111827');
  expect(zoneStyle('MENS', { MENS: '#1E3A8A' }).text).toBe('#fff');
});
