import { fireEvent, render, screen } from '@testing-library/react';
import ChangePassword from './ChangePassword';

const mockRefreshUser = jest.fn();
const mockLogout = jest.fn();

jest.mock('./AuthContext', () => ({
  useAuth: () => ({ refreshUser: mockRefreshUser, logout: mockLogout }),
}));

test('rejects mismatched new passwords before sending request', () => {
  const previousFetch = global.fetch;
  const fetchSpy = jest.fn();
  global.fetch = fetchSpy;
  render(<ChangePassword />);

  fireEvent.change(screen.getByLabelText('Temporary Password'), { target: { value: 'Temporary123!' } });
  fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Different123!' } });
  fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Mismatch123!' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

  expect(screen.getByRole('alert')).toHaveTextContent('New passwords do not match.');
  expect(fetchSpy).not.toHaveBeenCalled();
  global.fetch = previousFetch;
});
