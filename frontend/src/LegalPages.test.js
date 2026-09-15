import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPolicy, SupportPage } from './LegalPages';

test('privacy page identifies operator, data handling, retention, and deletion contact', () => {
  render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
  expect(screen.getAllByText(/Chong Vyet Nguyen/).length).toBeGreaterThan(0);
  expect(screen.getByText(/employee names, job roles, schedule dates/i)).toBeInTheDocument();
  expect(screen.getByText(/deleted after 12 months/i)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /chongvyetnguyen@gmail.com/i }).length).toBeGreaterThan(0);
});

test('support page warns users not to send sensitive credentials', () => {
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
  expect(screen.getByText(/Do not send passwords/i)).toBeInTheDocument();
});
