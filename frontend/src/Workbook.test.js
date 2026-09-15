import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Workbook from './Workbook';

let mockSelectedOrg = '41';
let mockFailSave = false;
let mockKpiState;

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

  afterEach(() => fetchMock.mockRestore());

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
});
