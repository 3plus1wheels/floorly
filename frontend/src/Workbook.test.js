import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Workbook from './Workbook';

let mockSelectedOrg = '41';
let mockFailSave = false;
let mockKpiState;
const RealDate = Date;

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ selectedOrganizationId: mockSelectedOrg }),
}));

function makeKpi(date, target = 12918) {
  const baseGoals = {
    daySalesTarget: target,
    stretchTarget: null,
    lastYearSales: 9522,
    lastYearTraffic: 628,
    trafficTrend: null,
    projectedTraffic: null,
    transactionGoal: null,
    conversionTarget: 17.2,
    upt: 1.76,
    atv: 88.17,
    monthSalesPlan: 652449,
    monthToDateSales: 119829,
  };
  return {
    date,
    comparisonDate: '2025-09-15',
    goals: { ...baseGoals, percentToMonthSalesPlan: 18.4, monthToGo: 532620 },
    baseGoals,
    sources: {
      daySalesTarget: 'imported_current', lastYearSales: 'imported_prior',
      lastYearTraffic: 'imported_prior', conversionTarget: 'imported_prior',
      upt: 'imported_prior', atv: 'imported_prior',
      monthSalesPlan: 'imported_current', monthToDateSales: 'imported_current',
    },
    baseSources: {
      daySalesTarget: 'imported_current', lastYearSales: 'imported_prior',
      lastYearTraffic: 'imported_prior', conversionTarget: 'imported_prior',
      upt: 'imported_prior', atv: 'imported_prior',
      monthSalesPlan: 'imported_current', monthToDateSales: 'imported_current',
    },
    overrides: [],
    hourly: { 10: { pct: 3, cel: '' } },
    revision: 0,
    updatedAt: null,
    import: { id: 5, fiscalYear: 2026, importedAt: '2026-09-14T12:00:00Z', status: 'complete' },
  };
}

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('Workbook KPI persistence', () => {
  let fetchMock;

  beforeEach(() => {
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : ['2026-09-14T12:00:00'])); }
      static now() { return new RealDate('2026-09-14T12:00:00').getTime(); }
    };
    mockSelectedOrg = '41';
    mockFailSave = false;
    mockKpiState = makeKpi('2026-09-14');
    localStorage.clear();
    localStorage.setItem('access_token', 'workbook-token');
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        const day = parsed.searchParams.get('day');
        const date = day === 'Tue' ? '2026-09-15' : '2026-09-14';
        const target = options.headers['X-Organization-ID'] === '42' ? 8000 : 12918;
        mockKpiState = makeKpi(date, target);
        return response({
          date,
          day,
          hours: [],
          col_headers: [],
          rows: [],
          kpi: mockKpiState,
        });
      }
      if (parsed.pathname.startsWith('/api/schedule/kpi-days/')) {
        if (mockFailSave) return response({ error: 'Server rejected KPI edit.' }, 400);
        const patch = JSON.parse(options.body);
        const goals = { ...mockKpiState.goals };
        const sources = { ...mockKpiState.sources };
        const overrides = new Set(mockKpiState.overrides);
        Object.entries(patch.goal_updates || {}).forEach(([key, value]) => {
          goals[key] = value;
          overrides.add(key);
          sources[key] = 'manual';
        });
        (patch.goal_resets || []).forEach(key => {
          goals[key] = mockKpiState.baseGoals[key];
          overrides.delete(key);
          sources[key] = mockKpiState.baseSources[key] || 'missing';
        });
        const hourly = { ...mockKpiState.hourly };
        Object.entries(patch.hourly_updates || {}).forEach(([hour, values]) => {
          hourly[hour] = { ...hourly[hour], ...values };
        });
        mockKpiState = {
          ...mockKpiState,
          goals,
          sources,
          overrides: Array.from(overrides),
          hourly,
          revision: mockKpiState.revision + 1,
        };
        return response(mockKpiState);
      }
      return response({});
    });
  });

  afterEach(() => {
    fetchMock.mockRestore();
    global.Date = RealDate;
  });

  test('loads imported goals, comparison date, and month figures for the selected organization', async () => {
    render(<Workbook />);

    expect(await screen.findByText('FY2026 workbook imported', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('09.14.2026')).toBeInTheDocument();
    expect(screen.getAllByText('$12,918').length).toBeGreaterThan(0);
    expect(screen.getByText('$9,522')).toBeInTheDocument();
    expect(screen.getByText('$119,829')).toBeInTheDocument();
    expect(screen.getByText('17.2%')).toBeInTheDocument();
    expect(screen.getByText('18.4%')).toBeInTheDocument();
    expect(screen.getByText('$532,620')).toBeInTheDocument();
    expect(screen.getByText('Compared with Sep 15, 2025')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/schedule/workbook/'), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Organization-ID': '41' }),
    }));
  });

  test('persists goal commits and CEL initials as text with the organization header', async () => {
    render(<Workbook />);
    const target = await screen.findByLabelText('Edit day sales target');
    fireEvent.click(target);
    const targetInput = screen.getByRole('textbox', { name: 'Edit day sales target' });
    fireEvent.change(targetInput, { target: { value: '13000' } });
    fireEvent.blur(targetInput);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/schedule/kpi-days/2026-09-14/'),
      expect.objectContaining({ method: 'PATCH', headers: expect.objectContaining({ 'X-Organization-ID': '41' }) }),
    ));
    const goalPatch = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/kpi-days/') && JSON.parse(options.body).goal_updates);
    expect(JSON.parse(goalPatch[1].body)).toEqual({ goal_updates: { daySalesTarget: 13000 } });
    expect(await screen.findByLabelText('Edit day sales target')).toHaveTextContent('$13,000');
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument();
    expect(screen.queryByText('IMPORTED')).not.toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Reset KPIs' }));
    await waitFor(() => {
      const resetPatch = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/kpi-days/') && JSON.parse(options.body).goal_resets);
      expect(resetPatch).toBeTruthy();
      expect(JSON.parse(resetPatch[1].body)).toEqual({ goal_resets: ['daySalesTarget'] });
    });

    const cel = await screen.findByLabelText('Edit CEL SIGN-OFF (INITIALS) 10am - 11am');
    fireEvent.click(cel);
    const celInput = screen.getByRole('textbox', { name: 'Edit CEL SIGN-OFF (INITIALS) 10am - 11am' });
    fireEvent.change(celInput, { target: { value: 'AB' } });
    fireEvent.blur(celInput);

    await waitFor(() => {
      const celPatch = fetchMock.mock.calls.find(([url, options]) => String(url).includes('/kpi-days/') && JSON.parse(options.body).hourly_updates);
      expect(celPatch).toBeTruthy();
      expect(JSON.parse(celPatch[1].body)).toEqual({ hourly_updates: { 10: { cel: 'AB' } } });
    });
  });

  test('reloads on day and organization changes and shows save failures', async () => {
    const view = render(<Workbook />);
    await screen.findByText('09.14.2026');
    fireEvent.click(screen.getByRole('button', { name: /Tue/ }));
    expect(await screen.findByText('09.15.2026')).toBeInTheDocument();

    mockSelectedOrg = '42';
    view.rerender(<Workbook />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('day=Tue'), expect.objectContaining({
      headers: expect.objectContaining({ 'X-Organization-ID': '42' }),
    })));
    await waitFor(() => expect(screen.getAllByText('$8,000').length).toBeGreaterThan(0));

    mockFailSave = true;
    const target = screen.getByLabelText('Edit day sales target');
    fireEvent.click(target);
    const input = screen.getByRole('textbox', { name: 'Edit day sales target' });
    fireEvent.change(input, { target: { value: '9000' } });
    fireEvent.blur(input);
    expect(await screen.findByText(/Server rejected KPI edit\. Your latest edit is shown here but may not be shared\./)).toBeInTheDocument();
  });

  test('keeps custom KPI values in the current session without sending them to the server', async () => {
    render(<Workbook />);
    await screen.findByText('09.14.2026');
    fireEvent.click(screen.getByRole('button', { name: 'KPIs' }));
    const newKpi = screen.getByPlaceholderText('New KPI label…');
    fireEvent.change(newKpi, { target: { value: 'Custom score' } });
    fireEvent.keyDown(newKpi, { key: 'Enter', code: 'Enter' });

    const cell = screen.getByLabelText('Edit CUSTOM SCORE 10am - 11am');
    fireEvent.click(cell);
    const input = screen.getByRole('textbox', { name: 'Edit CUSTOM SCORE 10am - 11am' });
    fireEvent.change(input, { target: { value: '27' } });
    fireEvent.blur(input);

    expect(screen.getAllByText('27').length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.filter(([url, options]) => String(url).includes('/kpi-days/') && options.method === 'PATCH')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /Tue/ }));
    await screen.findByText('09.15.2026');
    expect(screen.getAllByText('27').length).toBeGreaterThan(0);
  });

  test('offers a fit-more print mode', async () => {
    const { container } = render(<Workbook />);
    await screen.findByText('09.14.2026');

    fireEvent.change(screen.getByTitle('Control how print handles long KPI sections'), {
      target: { value: 'extra-compact' },
    });

    expect(container.querySelector('.wb-root')).toHaveClass('wb-print-extra-compact');
    expect(screen.getByRole('option', { name: 'Print Fit: Fit More' })).toBeInTheDocument();
  });

  test('switches between Old and New while keeping shared KPI edits and remembering the choice', async () => {
    const view = render(<Workbook />);
    await screen.findByText('TODAY\'S GOALS');
    expect(screen.getByRole('button', { name: 'Old' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('HOURLY SEGMENTS')).toBeInTheDocument();
    expect(screen.queryByText('ZONE CHART')).not.toBeInTheDocument();

    const target = screen.getByLabelText('Edit day sales target');
    fireEvent.click(target);
    const input = screen.getByRole('textbox', { name: 'Edit day sales target' });
    fireEvent.change(input, { target: { value: '14000' } });
    fireEvent.blur(input);
    await screen.findAllByText('$14,000');

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('ZONE CHART')).toBeInTheDocument();
    expect(screen.getAllByText('$14,000').length).toBeGreaterThan(0);
    expect(screen.getByText('8am - 9am')).toBeInTheDocument();
    expect(screen.getByText('9am - 10am')).toBeInTheDocument();
    expect(screen.getByText('1st Break Taken')).toBeInTheDocument();
    expect(screen.getByLabelText('Non-editable schedule annotation cells')).toBeInTheDocument();
    expect(localStorage.getItem('floorly-workbook-view')).toBe('new');

    view.unmount();
    render(<Workbook />);
    await screen.findByText('ZONE CHART');
    expect(screen.getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Old' }));
    expect(screen.queryByText('ZONE CHART')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Edit day sales target')).toHaveTextContent('$12,918');
    expect(localStorage.getItem('floorly-workbook-view')).toBe('old');
  });

  test('warns before leaving a day with unsaved promo edits', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<Workbook />);
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Add row' }));
      fireEvent.change(screen.getByRole('textbox', { name: 'Promo or note 1' }), { target: { value: 'Weekend promo' } });
      await screen.findByText('Unsaved changes');

      fireEvent.click(screen.getByRole('button', { name: /Tue/ }));
      expect(confirm).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Mon/ })).toHaveClass('active');

      confirm.mockReturnValue(true);
      fireEvent.click(screen.getByRole('button', { name: /Tue/ }));
      await waitFor(() => expect(screen.getByRole('button', { name: /Tue/ })).toHaveClass('active'));
    } finally {
      confirm.mockRestore();
    }
  });

  test('saves a zone from its cell dropdown and restores automatic zoning', async () => {
    let savedOverrides = [];
    const zoneRequests = [];
    fetchMock.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9, 10, 11],
          col_headers: ['9am-10am', '10am-11am', '11am-12pm'],
          rows: [
            { shift_id: 101, name: 'ALEX', shift: '9-12', zones: { 9: 'WOMENS', 10: 'WOMENS', 11: 'WOMENS' }, zone_overrides: {} },
            { shift_id: 102, name: 'BLAIR', shift: '10-12', zones: { 10: 'MENS', 11: 'MENS' }, zone_overrides: {} },
          ],
          kpi: makeKpi('2026-09-14'),
        });
      }
      if (parsed.pathname === '/api/schedule/workbook-zones/2026-09-14/') {
        const patch = JSON.parse(options.body);
        zoneRequests.push(patch);
        if (patch.set) {
          savedOverrides = patch.set.cells.map(cell => ({ ...cell, zone: patch.set.zone }));
        } else if (patch.clear) {
          const cleared = new Set(patch.clear.cells.map(cell => `${cell.shift_id}:${cell.hour}`));
          savedOverrides = savedOverrides.filter(item => !cleared.has(`${item.shift_id}:${item.hour}`));
        }
        return response({ overrides: savedOverrides, updatedAt: '2026-09-14T12:00:00Z' });
      }
      return response({});
    });

    render(<Workbook />);
    const alexNine = await screen.findByRole('combobox', { name: 'Zone for ALEX, 9am-10am' });
    expect(alexNine).toHaveValue('');
    fireEvent.change(alexNine, { target: { value: 'CASH' } });
    await waitFor(() => expect(zoneRequests).toHaveLength(1));
    expect(zoneRequests[0]).toEqual({
      set: {
        zone: 'CASH',
        cells: [{ shift_id: 101, hour: 9 }],
      },
    });
    expect(screen.getAllByRole('gridcell', { name: 'CASH' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(screen.getByText('ZONE CHART')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell', { name: 'CASH' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Old' }));

    const alexNineAgain = screen.getByRole('combobox', { name: 'Zone for ALEX, 9am-10am' });
    await waitFor(() => expect(alexNineAgain).not.toBeDisabled());
    fireEvent.change(alexNineAgain, { target: { value: '' } });
    await waitFor(() => expect(zoneRequests).toHaveLength(2));
    expect(zoneRequests[1].clear.cells).toEqual([{ shift_id: 101, hour: 9 }]);
    await waitFor(() => expect(screen.queryAllByRole('gridcell', { name: 'CASH' })).toHaveLength(0));
  });

  test('provides an accessible dropdown for every active cell and none for blank cells', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9, 10], col_headers: ['9am-10am', '10am-11am'],
          rows: [{ shift_id: 201, name: 'ALEX', shift: '9-11', zones: { 9: 'WOMENS', 10: 'MENS' }, zone_overrides: {} }],
          kpi: makeKpi('2026-09-14'),
        });
      }
      return response({ overrides: [] });
    });

    render(<Workbook />);
    const first = await screen.findByRole('combobox', { name: 'Zone for ALEX, 9am-10am' });
    const second = screen.getByRole('combobox', { name: 'Zone for ALEX, 10am-11am' });
    expect(first).toHaveValue('');
    expect(second).toHaveValue('');
    expect(screen.getAllByRole('combobox', { name: /^Zone for/ })).toHaveLength(2);
    expect(within(first).getByRole('option', { name: 'WOMENS (AUTO)' })).toBeInTheDocument();
    expect(within(second).getByRole('option', { name: 'MENS (AUTO)' })).toBeInTheDocument();
  });

  test('restores saved zone state and keeps the selection when a zone save fails', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9], col_headers: ['9am-10am'],
          rows: [{ shift_id: 301, name: 'ALEX', shift: '9-10', zones: { 9: 'WOMENS' }, zone_overrides: {} }],
          kpi: makeKpi('2026-09-14'),
        });
      }
      if (parsed.pathname === '/api/schedule/workbook-zones/2026-09-14/') {
        return response({ error: 'Zone save rejected.' }, 400);
      }
      return response({});
    });

    render(<Workbook />);
    const dropdown = await screen.findByRole('combobox', { name: 'Zone for ALEX, 9am-10am' });
    fireEvent.change(dropdown, { target: { value: 'CASH' } });

    expect(await screen.findByText(/Zone save rejected\. Your previous saved assignments were restored\./)).toBeInTheDocument();
    expect(dropdown).toHaveValue('');
  });

  test('edits a shift inline, validates the range, saves it, and reloads the workbook', async () => {
    let shift = { start_time: '09:00', end_time: '12:00', shift: '9-12' };
    let workbookLoads = 0;
    fetchMock.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        workbookLoads += 1;
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9], col_headers: ['9am-10am'],
          rows: [{
            shift_id: 401, name: 'ALEX', ...shift,
            zones: { 9: 'WOMENS' }, zone_overrides: {},
          }],
          kpi: makeKpi('2026-09-14'),
        });
      }
      if (parsed.pathname === '/api/schedule/shifts/401/') {
        const body = JSON.parse(options.body);
        shift = { ...body, shift: '9:15-12' };
        return response({ id: 401, ...body });
      }
      return response({});
    });

    render(<Workbook />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit shift for ALEX' }));
    const start = screen.getByLabelText('Start time for ALEX');
    const end = screen.getByLabelText('End time for ALEX');
    expect(start).toHaveAttribute('type', 'text');
    expect(end).toHaveAttribute('type', 'text');

    fireEvent.change(end, { target: { value: '09:00' } });
    expect(screen.getByRole('button', { name: 'Save shift for ALEX' })).toBeDisabled();
    fireEvent.keyDown(end, { key: 'Escape' });
    expect(screen.queryByLabelText('Start time for ALEX')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit shift for ALEX' }));
    fireEvent.change(screen.getByLabelText('Start time for ALEX'), { target: { value: '09:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save shift for ALEX' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/schedule/shifts/401/'),
      expect.objectContaining({
        method: 'PATCH',
        headers: expect.objectContaining({ 'X-Organization-ID': '41', 'Content-Type': 'application/json' }),
        body: JSON.stringify({ start_time: '09:15', end_time: '12:00' }),
      }),
    ));
    await waitFor(() => expect(workbookLoads).toBe(2));
    expect(await screen.findByRole('button', { name: 'Edit shift for ALEX' })).toHaveTextContent('9:15-12');
  });

  test('keeps the shift draft open and reports a failed save', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9], col_headers: ['9am-10am'],
          rows: [{
            shift_id: 501, name: 'ALEX', shift: '9-12', start_time: '09:00', end_time: '12:00',
            zones: { 9: 'WOMENS' }, zone_overrides: {},
          }],
          kpi: makeKpi('2026-09-14'),
        });
      }
      if (parsed.pathname === '/api/schedule/shifts/501/') {
        return response({ error: 'That shift conflicts with another shift.' }, 409);
      }
      return response({});
    });

    render(<Workbook />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit shift for ALEX' }));
    fireEvent.change(screen.getByLabelText('End time for ALEX'), { target: { value: '12:15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save shift for ALEX' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That shift conflicts with another shift.');
    expect(screen.getByLabelText('Start time for ALEX')).toHaveValue('09:00');
    expect(screen.getByLabelText('End time for ALEX')).toHaveValue('12:15');
    expect(screen.getByRole('button', { name: 'Save shift for ALEX' })).toBeEnabled();
  });

  test('edits only the displayed workbook name for that shift row', async () => {
    let displayName = 'ALEX';
    let nameOverride = '';
    let workbookLoads = 0;
    fetchMock.mockImplementation(async (url, options = {}) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/schedule/workbook/') {
        workbookLoads += 1;
        return response({
          date: '2026-09-14', day: 'Mon', hours: [9], col_headers: ['9am-10am'],
          rows: [{
            shift_id: 601, name: displayName, name_override: nameOverride, full_name: 'Alex Taylor',
            shift: '9-12', start_time: '09:00', end_time: '12:00',
            zones: { 9: 'WOMENS' }, zone_overrides: {},
          }],
          kpi: makeKpi('2026-09-14'),
        });
      }
      if (parsed.pathname === '/api/schedule/shifts/601/') {
        const body = JSON.parse(options.body);
        nameOverride = body.display_name.toUpperCase();
        displayName = nameOverride || 'ALEX';
        return response({ id: 601, workbook_name_override: nameOverride });
      }
      return response({});
    });

    render(<Workbook />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit workbook name for Alex Taylor' }));
    const input = screen.getByLabelText('Workbook name for Alex Taylor');
    expect(input).toHaveValue('ALEX');
    fireEvent.change(input, { target: { value: 'Day Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save workbook name for Alex Taylor' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/schedule/shifts/601/'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ display_name: 'Day Alex' }),
        headers: expect.objectContaining({ 'X-Organization-ID': '41' }),
      }),
    ));
    await waitFor(() => expect(workbookLoads).toBe(2));
    expect(await screen.findByRole('button', { name: 'Edit workbook name for Alex Taylor' })).toHaveTextContent('DAY ALEX');
  });
});
