import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPanel from './AdminPanel';

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 99 } }),
}));

const defaultBohTimes = [{ start: '14:00', end: '18:45' }, { start: '16:30', end: '21:15' }];
const defaultPriority = ['WOMENS', 'MENS', 'FITS', 'CASH', 'FITS', 'MENS', 'WOMENS', 'GREET', 'MENS', 'WOMENS', 'CASH', 'FITS'];
const organizations = [
  { id: 1, name: 'North Store', is_active: true, boh_shift_times: defaultBohTimes, zone_priority: defaultPriority },
  { id: 2, name: 'South Store', is_active: true, boh_shift_times: defaultBohTimes, zone_priority: defaultPriority },
];

const userByOrganization = {
  1: [{ id: 11, username: 'north-user', full_name: 'North User', is_active: true, organizations: [{ id: 1 }] }],
  2: [{ id: 22, username: 'south-user', full_name: 'South User', is_active: true, organizations: [{ id: 2 }] }],
};

const employeeByOrganization = {
  1: [
    { employee_id: 101, name: 'Alex Taylor', primary_job: 'Stylist' },
    { employee_id: 102, name: 'Bailey Jones', primary_job: 'CEL' },
  ],
  2: [{ employee_id: 201, name: 'Casey Smith', primary_job: 'Stylist' }],
};

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

const visibleTeamNames = () => Array.from(document.querySelectorAll('.admin-employee strong')).map(node => node.textContent);
const openSection = async name => {
  const heading = await screen.findByRole('heading', { name });
  const details = heading.closest('details');
  if (!details.open) fireEvent.click(heading.closest('summary'));
  return details;
};

describe('AdminPanel organization scope', () => {
  let fetchMock;
  let kpiBatch;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'test-token');
    employeeByOrganization[1] = [
      { employee_id: 101, name: 'Alex Taylor', primary_job: 'Stylist' },
      { employee_id: 102, name: 'Bailey Jones', primary_job: 'CEL' },
    ];
    employeeByOrganization[2] = [{ employee_id: 201, name: 'Casey Smith', primary_job: 'Stylist' }];
    kpiBatch = {
      id: 41, current_fiscal_year: 2026, prior_fiscal_year: 2025, status: 'complete',
      daily_records_imported: 728, period_records_imported: 24, warnings: ['Two future dates have no actual values.'],
      imported_at: '2026-09-14T12:00:00Z',
    };
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      const path = new URL(String(url), 'http://localhost').pathname;
      const query = new URL(String(url), 'http://localhost').searchParams;
      if (/\/api\/admin\/organizations\/\d+\/kpi-imports\/$/.test(path)) {
        return options.method === 'POST' ? response(kpiBatch) : response([kpiBatch]);
      }
      if (path === '/api/admin/organizations/' && options.method === 'POST') {
        return response({ id: 3, name: JSON.parse(options.body).name });
      }
      if (path === '/api/admin/organizations/') return response(organizations);
      if (/\/api\/admin\/organizations\/\d+\/$/.test(path) && options.method === 'PATCH') {
        const organizationId = Number(path.split('/').at(-2));
        const organization = organizations.find(item => item.id === organizationId);
        return response({ ...organization, ...JSON.parse(options.body) });
      }
      if (path === '/api/admin/users/' && options.method === 'POST') return response({ id: 30 });
      if (path === '/api/admin/users/') return response(userByOrganization[query.get('organization_id')] || []);
      if (path === '/api/schedule/staff/') {
        return response(employeeByOrganization[options.headers['X-Organization-ID']] || []);
      }
      if (/\/api\/schedule\/staff\/\d+\/$/.test(path) && options.method === 'DELETE') {
        const organizationId = options.headers['X-Organization-ID'];
        const employeeId = Number(path.split('/').at(-2));
        employeeByOrganization[organizationId] = (employeeByOrganization[organizationId] || [])
          .filter(employee => employee.employee_id !== employeeId);
        return response({}, 204);
      }
      return response({});
    });
  });

  afterEach(() => fetchMock.mockRestore());

  test('starts every admin card collapsed and lets sections open independently', async () => {
    render(<AdminPanel />);
    await screen.findByRole('heading', { name: 'Floor map rules' });
    const details = Array.from(document.querySelectorAll('.admin-collapsible-section'));
    expect(details).toHaveLength(5);
    details.forEach(section => expect(section).not.toHaveAttribute('open'));

    const kpi = await openSection('KPI workbook import');
    const floorRules = await openSection('Floor map rules');
    expect(kpi).toHaveAttribute('open');
    expect(floorRules).toHaveAttribute('open');

    fireEvent.click(within(kpi).getByRole('heading', { name: 'KPI workbook import' }).closest('summary'));
    expect(kpi).not.toHaveAttribute('open');
    expect(floorRules).toHaveAttribute('open');
  });

  test('supports keyboard toggling and preserves draft values while collapsed', async () => {
    render(<AdminPanel />);
    await screen.findByRole('option', { name: 'South Store' });
    const organization = await screen.findByRole('heading', { name: 'Organization management' });
    const summary = organization.closest('summary');
    summary.focus();
    await userEvent.keyboard('{Enter}');
    const nameInput = screen.getByLabelText('Selected organization name');
    fireEvent.change(nameInput, { target: { value: 'Draft Store Name' } });

    fireEvent.click(summary);
    await waitFor(() => expect(organization.closest('details')).not.toHaveAttribute('open'));
    fireEvent.click(summary);
    await waitFor(() => expect(screen.getByLabelText('Selected organization name')).toHaveValue('Draft Store Name'));
  });

  test('switching organization reloads only that organization’s staff and accounts', async () => {
    render(<AdminPanel />);
    const picker = await screen.findByLabelText('Organization');
    await screen.findByRole('option', { name: 'South Store' });
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Alex Taylor', 'Bailey Jones']));
    fireEvent.click(screen.getByText('Access Accounts'));
    expect(screen.getByText('North User')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users/?organization_id=1'), expect.any(Object));

    fireEvent.change(picker, { target: { value: '2' } });
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Casey Smith']));
    expect(screen.getByText('South User')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users/?organization_id=2'), expect.any(Object)));
    expect(visibleTeamNames()).not.toContain('Alex Taylor');
    expect(screen.queryByText('North User')).not.toBeInTheDocument();
  });

  test('creates an account for the selected organization only', async () => {
    render(<AdminPanel />);
    const picker = await screen.findByLabelText('Organization');
    await screen.findByRole('option', { name: 'South Store' });
    fireEvent.change(picker, { target: { value: '2' } });
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Casey Smith']));

    fireEvent.click(screen.getByText('Access Accounts'));
    await userEvent.type(screen.getByLabelText('Full name'), 'New South User');
    await userEvent.type(screen.getByLabelText('Username'), 'new-south-user');
    await userEvent.type(screen.getByLabelText('Temporary password'), 'Strong-Password-947!');
    fireEvent.click(screen.getByRole('checkbox', { name: /Give admin permission/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users/'), expect.objectContaining({ method: 'POST' })));
    const createCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).includes('/api/admin/users/') && options?.method === 'POST');
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      username: 'new-south-user', organization_ids: [2], is_admin: true,
    });
  });

  test('updates admin permission from the account edit dialog', async () => {
    render(<AdminPanel />);
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Alex Taylor', 'Bailey Jones']));
    fireEvent.click(screen.getByText('Access Accounts'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('checkbox', { name: /Give admin permission/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users/11/'), expect.objectContaining({ method: 'PATCH' })));
    const updateCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).includes('/api/admin/users/11/') && options?.method === 'PATCH');
    expect(JSON.parse(updateCall[1].body)).toMatchObject({ is_admin: true });
  });

  test('team search filters the currently selected organization', async () => {
    render(<AdminPanel />);
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Alex Taylor', 'Bailey Jones']));
    await openSection('Team');
    const search = screen.getByPlaceholderText('Search name, workbook, or job');
    await userEvent.type(search, 'Bailey');

    expect(visibleTeamNames()).toEqual(['Bailey Jones']);
  });

  test('edits exact BOH times and saves the organization floor map rules', async () => {
    render(<AdminPanel />);
    await openSection('Floor map rules');

    fireEvent.change(screen.getByLabelText('BOH start 1'), { target: { value: '13:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove BOH time 2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add time' }));
    fireEvent.change(screen.getByLabelText('BOH start 2'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('BOH end 2'), { target: { value: '19:30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save floor map rules' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/organizations/1/'), expect.objectContaining({ method: 'PATCH' })));
    const saveCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).includes('/api/admin/organizations/1/')
      && options?.method === 'PATCH'
      && JSON.parse(options.body).boh_shift_times);
    expect(JSON.parse(saveCall[1].body)).toEqual({
      boh_shift_times: [
        { start: '13:30', end: '18:45' },
        { start: '15:00', end: '19:30' },
      ],
      zone_priority: defaultPriority,
    });
    expect(await screen.findByText(/Generated zone maps now use the new settings/)).toBeInTheDocument();
  });

  test('supports keyboard reordering of duplicate-aware priority cards', async () => {
    render(<AdminPanel />);
    await openSection('Floor map rules');
    expect(screen.getAllByRole('button', { name: /Move .* priority/ })).toHaveLength(12);
    expect(screen.getAllByRole('button', { name: /Move CASH priority/ })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: /Move FITS priority/ })).toHaveLength(3);
    const firstHandle = await screen.findByRole('button', { name: 'Move WOMENS priority 1' });

    fireEvent.keyDown(firstHandle, { key: 'ArrowDown', code: 'ArrowDown', altKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Save floor map rules' }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([url, options]) =>
        String(url).includes('/api/admin/organizations/1/')
        && options?.method === 'PATCH'
        && JSON.parse(options.body).zone_priority?.[0] === 'MENS');
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(saveCall[1].body).zone_priority.slice(0, 3)).toEqual(['MENS', 'WOMENS', 'FITS']);
    });
  });

  test('adds and removes the selected zone slot before saving the draft', async () => {
    render(<AdminPanel />);
    await openSection('Floor map rules');
    const picker = screen.getByLabelText('Zone slot');

    fireEvent.change(picker, { target: { value: 'CASH' } });
    expect(screen.getByText('12 / 20 slots · CASH appears 2 times')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add slot' }));
    expect(screen.getByText('13 / 20 slots · CASH appears 3 times')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Move .* priority/ })).toHaveLength(13);

    fireEvent.change(picker, { target: { value: 'GREET' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove slot' }));
    expect(screen.getByText('12 / 20 slots · GREET appears 0 times')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save floor map rules' }));

    await waitFor(() => {
      const saveCall = fetchMock.mock.calls.find(([url, options]) =>
        String(url).includes('/api/admin/organizations/1/')
        && options?.method === 'PATCH'
        && JSON.parse(options.body).zone_priority?.length === 12
        && JSON.parse(options.body).zone_priority?.at(-1) === 'CASH');
      expect(saveCall).toBeTruthy();
      expect(JSON.parse(saveCall[1].body).zone_priority.filter(zone => zone === 'CASH')).toHaveLength(3);
      expect(JSON.parse(saveCall[1].body).zone_priority).not.toContain('GREET');
    });
  });

  test('enforces the one-to-twenty slot boundaries', async () => {
    render(<AdminPanel />);
    await openSection('Floor map rules');
    const picker = screen.getByLabelText('Zone slot');
    const remove = screen.getByRole('button', { name: 'Remove slot' });
    const add = screen.getByRole('button', { name: 'Add slot' });

    for (const [zone, removals] of [['WOMENS', 3], ['MENS', 3], ['FITS', 3], ['CASH', 2]]) {
      fireEvent.change(picker, { target: { value: zone } });
      for (let index = 0; index < removals; index += 1) fireEvent.click(remove);
    }
    expect(screen.getByText('1 / 20 slots · CASH appears 0 times')).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'GREET' } });
    expect(remove).toBeDisabled();

    for (let index = 0; index < 19; index += 1) fireEvent.click(add);
    expect(screen.getByText('20 / 20 slots · GREET appears 20 times')).toBeInTheDocument();
    expect(add).toBeDisabled();
  });

  test('requires confirmation before removing an employee and refreshes the roster', async () => {
    render(<AdminPanel />);
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Alex Taylor', 'Bailey Jones']));
    await openSection('Team');

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex Taylor' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('scheduled shifts and zone skills');
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/schedule/staff/101/'), expect.objectContaining({ method: 'DELETE' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('/api/schedule/staff/101/'), expect.objectContaining({ method: 'DELETE' }));

    fireEvent.click(screen.getByRole('button', { name: 'Remove Alex Taylor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove employee' }));
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Bailey Jones']));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/schedule/staff/101/'), expect.objectContaining({
      method: 'DELETE', headers: expect.objectContaining({ 'X-Organization-ID': '1' }),
    }));
    expect(await screen.findByText('Alex Taylor removed from this organization.')).toBeInTheDocument();
  });

  test('shows import metadata and uploads the selected organization’s two workbooks as multipart data', async () => {
    render(<AdminPanel />);
    await openSection('KPI workbook import');
    expect(await screen.findByText('Two future dates have no actual values.')).toBeInTheDocument();
    expect(screen.getByText('Current FY 2026')).toBeInTheDocument();
    expect(screen.getByText('728 daily rows')).toBeInTheDocument();

    const currentFile = new File(['current'], 'FY2026.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const priorFile = new File(['prior'], 'FY2025.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    fireEvent.change(screen.getByLabelText('Current fiscal year workbook'), { target: { files: [currentFile] } });
    fireEvent.change(screen.getByLabelText('Prior fiscal year workbook'), { target: { files: [priorFile] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload both workbooks' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/organizations/1/kpi-imports/'), expect.objectContaining({ method: 'POST' })));
    const [url, options] = fetchMock.mock.calls.find(([requestUrl, requestOptions]) =>
      String(requestUrl).includes('/kpi-imports/') && requestOptions?.method === 'POST');
    expect(url).toContain('/organizations/1/');
    expect(options.body.get('current_year_file')).toBe(currentFile);
    expect(options.body.get('prior_year_file')).toBe(priorFile);
    expect(options.headers).not.toHaveProperty('Content-Type');
    expect(await screen.findByText('KPI workbooks imported. Workbook goals now use the refreshed data.')).toBeInTheDocument();
  });
});
