import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { detectVisibleWeekStart, mondayForEdmonton, normalizeShift, parseGridSnapshots, parseHeaderDate, parseShiftTitle, validateWeek } from '../src/extractor.js';

test('normalizes 24-hour, ISO, and 12-hour times', () => {
  assert.equal(normalizeShift({ employee: 'Jane', job: 'Stylist', date: '2026-09-08', startTime: '2026-09-08T09:30:00', endTime: '5:00 PM' }).start_time, '09:30');
});

test('validates week while preserving duplicate shifts', () => {
  const shift = { employee: 'Thompson, Sierra', job: 'Management', date: '2026-09-13', startTime: '09:00', endTime: '12:00' };
  assert.equal(validateWeek([shift, shift], '2026-09-07').shifts.length, 2);
  assert.throws(() => validateWeek([{ ...shift, date: '2026-09-14' }], '2026-09-07'), /outside/);
});

test('validates existing normalized fixture', async () => {
  const raw = JSON.parse(await readFile(new URL('./fixtures/current-week.json', import.meta.url), 'utf8'));
  assert.equal(validateWeek(raw, '2026-09-07').shifts.length, 2);
});

test('parses titles and header dates', () => {
  assert.deepEqual(parseShiftTitle('11:00 AM - 3:45 PM [4:45]'), [{ start_time: '11:00', end_time: '15:45' }]);
  assert.equal(parseShiftTitle('9:00 AM - 12:00 PM / 1:00 PM - 5:00 PM').length, 2);
  assert.deepEqual(parseShiftTitle('9:00 - 17:30'), [{ start_time: '09:00', end_time: '17:30' }]);
  assert.equal(parseHeaderDate('Fri 01/01', '2020-12-28'), '2021-01-01');
  assert.equal(parseHeaderDate('Mon Sep 21', '2026-09-21'), '2026-09-21');
  assert.equal(parseHeaderDate('Tue 22 September 2026', '2026-09-21'), '2026-09-22');
});

test('detects visible week from dated Kronos headers', () => {
  const snapshots = [{ headers: [{ colId: 'wed', label: 'Wed 09/16' }] }];
  assert.equal(detectVisibleWeekStart(snapshots, '2026-09-14'), '2026-09-14');
  assert.equal(detectVisibleWeekStart([{ headers: [{ label: 'Mon Sep 21' }, { label: 'Tue 22 September' }] }], '2026-09-21'), '2026-09-21');
  assert.throws(() => detectVisibleWeekStart([{ headers: [{ label: 'Wednesday' }] }], '2026-09-14'), /Cannot verify/);
});

test('parses a shift across the September to October week boundary', () => {
  const snapshots = [{
    headers: ['Mon 09/28', 'Tue 09/29', 'Wed 09/30', 'Thu 10/01', 'Fri 10/02', 'Sat 10/03', 'Sun 10/04']
      .map((label, index) => ({ colId: `day-${index}`, label })),
    rows: [{ rowIndex: '0', employee_name: 'Test Employee', primary_job: 'Stylist', cells: [{ colId: 'day-3', titles: ['9:00 AM - 5:00 PM'] }] }],
  }];
  assert.equal(detectVisibleWeekStart(snapshots, '2026-09-28'), '2026-09-28');
  assert.equal(validateWeek(parseGridSnapshots(snapshots, '2026-09-28'), '2026-09-28').shifts[0].date, '2026-10-01');
});

test('skips zero-duration grid entries and keeps valid shifts', () => {
  const snapshots = [{ headers: [{ colId: 'mon', label: 'Mon 09/28' }], rows: [{
    rowIndex: '0', employee_name: 'Test Employee', primary_job: 'Stylist',
    cells: [{ colId: 'mon', titles: ['9:00 AM - 9:00 AM', '10:00 AM - 2:00 PM'] }],
  }] }];
  const shifts = parseGridSnapshots(snapshots, '2026-09-28');
  assert.equal(shifts.length, 1);
  assert.equal(shifts[0].start_time, '10:00');
  assert.equal(shifts[0].end_time, '14:00');
});

test('stitches virtual AG Grid fragments without omissions or duplicate snapshots', async () => {
  const snapshots = JSON.parse(await readFile(new URL('./fixtures/kronos-ag-grid-snapshots.json', import.meta.url), 'utf8'));
  const shifts = parseGridSnapshots(snapshots, '2026-09-07');
  assert.deepEqual(shifts.map(({ employee_name, date, start_time, end_time }) => ({ employee_name, date, start_time, end_time })), [
    { employee_name: 'Doe, Jane', date: '2026-09-07', start_time: '11:00', end_time: '15:45' },
    { employee_name: 'Doe, Jane', date: '2026-09-08', start_time: '09:00', end_time: '12:00' },
    { employee_name: 'Doe, Jane', date: '2026-09-08', start_time: '13:00', end_time: '17:00' },
    { employee_name: 'Boss, Alex', date: '2026-09-09', start_time: '08:30', end_time: '16:30' },
    { employee_name: 'Stock, Sam', date: '2026-09-07', start_time: '08:00', end_time: '12:45' },
  ]);
});

test('preserves two identical DOM shifts but deduplicates same occurrence across snapshots', () => {
  const fragment = {
    headers: [{ colId: 'sun', label: 'Sun 09/13' }],
    rows: [{ rowIndex: '4', employee_name: 'Thompson, Sierra', primary_job: 'Management', cells: [{
      colId: 'sun',
      titles: [
        { text: '9:00 AM - 12:00 PM', occurrence: 0 },
        { text: '9:00 AM - 12:00 PM', occurrence: 1 },
      ],
    }] }],
  };
  assert.equal(parseGridSnapshots([fragment, fragment], '2026-09-07').length, 2);
});

test('calculates Edmonton Monday across UTC boundary', () => {
  assert.equal(mondayForEdmonton(new Date('2026-09-08T01:00:00Z')), '2026-09-07');
});
