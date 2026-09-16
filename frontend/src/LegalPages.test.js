import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PrivacyPolicy, SupportPage } from './LegalPages';

test('privacy page identifies operator, collection boundaries, retention, and deletion contact', () => {
  render(<MemoryRouter><PrivacyPolicy /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Privacy Policy' })).toBeInTheDocument();
  expect(screen.getAllByText(/Chong Vyet Nguyen/).length).toBeGreaterThan(0);
  expect(screen.getByText(/does not read, collect, transmit, or store UKG\/Kronos usernames/i)).toBeInTheDocument();
  expect(screen.getByText(/remains in memory only long enough/i)).toBeInTheDocument();
  expect(screen.getByText(/does not download or execute remote code/i)).toBeInTheDocument();
  expect(screen.getByText(/deleted after 12 months/i)).toBeInTheDocument();
  expect(screen.getByText(/Limited Use requirements/i)).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /chongvyetnguyen@gmail.com/i }).length).toBeGreaterThan(0);
});

test('support page warns users not to send sensitive credentials', () => {
  render(<MemoryRouter><SupportPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Support' })).toBeInTheDocument();
  expect(screen.getByText(/Do not send passwords/i)).toBeInTheDocument();
});
