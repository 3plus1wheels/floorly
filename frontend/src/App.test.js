import { render, screen } from '@testing-library/react';
import App from './App';

jest.mock('./AuthContext', () => ({
  AuthProvider: ({ children }) => children,
  useAuth: () => ({ user: null, loading: false }),
}));

jest.mock('./LandingPage', () => () => <main>Zonechart landing page</main>);

test('renders the public landing route', () => {
  render(<App />);
  expect(screen.getByText('Zonechart landing page')).toBeInTheDocument();
});
