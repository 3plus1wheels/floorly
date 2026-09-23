import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import Workbook from './Workbook';

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ selectedOrganizationId: '41' }),
}));

test('zone colour panel swaps occupied colours and restores them after reload', async () => {
  localStorage.clear();
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ date: '2026-09-21', day: 'Mon', hours: [], col_headers: [], rows: [], kpi: null }),
  });

  try {
    const view = render(<Workbook />);
    await screen.findByText('No shifts for Mon 2026-09-21');
    fireEvent.click(screen.getByRole('button', { name: 'Zone colours' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    const legend = within(screen.getByLabelText('Zone color legend'));
    expect(legend.getByText('WOMENS')).toHaveStyle({ backgroundColor: '#2563EB' });
    expect(legend.getByText('MENS')).toHaveStyle({ backgroundColor: '#D9468C' });
    await waitFor(() => expect(JSON.parse(localStorage.getItem('floorly-zone-colors:41')).WOMENS).toBe('#2563EB'));

    view.unmount();
    render(<Workbook />);
    await screen.findByText('No shifts for Mon 2026-09-21');
    expect(within(screen.getByLabelText('Zone color legend')).getByText('WOMENS')).toHaveStyle({ backgroundColor: '#2563EB' });
  } finally {
    fetchMock.mockRestore();
  }
});
