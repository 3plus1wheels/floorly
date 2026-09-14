import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminPanel from './AdminPanel';

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 99 } }),
}));

const organizations = [
  { id: 1, name: 'North Store', is_active: true },
  { id: 2, name: 'South Store', is_active: true },
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

describe('AdminPanel organization scope', () => {
  let fetchMock;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'test-token');
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options = {}) => {
      const path = new URL(String(url), 'http://localhost').pathname;
      const query = new URL(String(url), 'http://localhost').searchParams;
      if (path === '/api/admin/organizations/' && options.method === 'POST') {
        return response({ id: 3, name: JSON.parse(options.body).name });
      }
      if (path === '/api/admin/organizations/') return response(organizations);
      if (path === '/api/admin/users/' && options.method === 'POST') return response({ id: 30 });
      if (path === '/api/admin/users/') return response(userByOrganization[query.get('organization_id')] || []);
      if (path === '/api/schedule/staff/') {
        return response(employeeByOrganization[options.headers['X-Organization-ID']] || []);
      }
      return response({});
    });
  });

  afterEach(() => fetchMock.mockRestore());

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
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/admin/users/'), expect.objectContaining({ method: 'POST' })));
    const createCall = fetchMock.mock.calls.find(([url, options]) =>
      String(url).includes('/api/admin/users/') && options?.method === 'POST');
    expect(JSON.parse(createCall[1].body)).toMatchObject({
      username: 'new-south-user', organization_ids: [2],
    });
  });

  test('team search filters the currently selected organization', async () => {
    render(<AdminPanel />);
    await waitFor(() => expect(visibleTeamNames()).toEqual(['Alex Taylor', 'Bailey Jones']));
    const search = screen.getByPlaceholderText('Search name, workbook, or job');
    await userEvent.type(search, 'Bailey');

    expect(visibleTeamNames()).toEqual(['Bailey Jones']);
  });
});
