import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Staff from './Staff';

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ selectedOrganizationId: '7' }),
}));

const staffRow = {
  employee_id: 12,
  name: 'Avery Stone',
  primary_job: 'Stylist',
  role_override: '',
  preferred_zone: '',
  mens: 2,
  womens: 3,
  cash: 1,
  fits: 2,
  greet: 0,
  boh: 2,
};

const response = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });

describe('Staff zone preference', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('access_token', 'token');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders all preference choices and saves an optimistic selection', async () => {
    let finishSave;
    const saveResponse = new Promise(resolve => { finishSave = resolve; });
    const fetchMock = jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response([staffRow]))
      .mockReturnValueOnce(saveResponse);
    render(<Staff />);

    const picker = await screen.findByLabelText('Avery Stone zone preference');
    expect(Array.from(picker.options).map(option => option.text)).toEqual([
      'Auto', 'MENS', 'WOMENS', 'CASH', 'FITS', 'GREET', 'BOH',
    ]);

    fireEvent.change(picker, { target: { value: 'boh' } });
    expect(picker).toHaveValue('boh');
    expect(picker).toBeDisabled();
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/api/schedule/staff/12/'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ preferred_zone: 'boh' }),
      }),
    );

    finishSave(response({ ...staffRow, preferred_zone: 'boh' }));
    await waitFor(() => expect(picker).not.toBeDisabled());
    expect(picker).toHaveValue('boh');
  });

  test('restores the prior preference when saving fails', async () => {
    jest.spyOn(global, 'fetch')
      .mockResolvedValueOnce(response([{ ...staffRow, preferred_zone: 'cash' }]))
      .mockResolvedValueOnce(response({}, false));
    render(<Staff />);

    const picker = await screen.findByLabelText('Avery Stone zone preference');
    expect(picker).toHaveValue('cash');
    fireEvent.change(picker, { target: { value: 'boh' } });

    await waitFor(() => expect(picker).toHaveValue('cash'));
    expect(picker).not.toBeDisabled();
  });
});
