import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import WorkbookPromos from './WorkbookPromos';

function response(data, ok = true) {
  return { ok, json: async () => data };
}

const shared = { date: '2026-09-23', rows: [], source: 'shared', has_override: false, shared_rows: [] };

test('adds and saves rows for today, then reports clean state to the parent', async () => {
  const onDirtyChange = jest.fn();
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(response(shared))
    .mockResolvedValueOnce(response({ ...shared, rows: ['Promo', 'Today note'], source: 'date', has_override: true }));
  render(<WorkbookPromos date="2026-09-23" organizationId="7" token="jwt" onDirtyChange={onDirtyChange} />);
  await screen.findByText('Add promo or note lines for this workbook.');
  fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Promo or note 1' }), { target: { value: 'Promo' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Promo or note 2' }), { target: { value: 'Today note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Remove row 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add row' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Promo or note 2' }), { target: { value: 'Promo' } });
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole('button', { name: 'Save for today' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ scope: 'date', rows: ['Today note', 'Promo'] });
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  expect(screen.getByText('Today only')).toBeInTheDocument();
  fetchMock.mockRestore();
});

test('saving shared rows preserves and clearly reports the current date override', async () => {
  const today = { date: '2026-09-23', rows: ['Today note'], source: 'date', has_override: true, shared_rows: ['Shared old'] };
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(response(today))
    .mockResolvedValueOnce(response({ ...today, shared_rows: ['New shared'], rows: ['Today note'] }));
  render(<WorkbookPromos date="2026-09-23" organizationId="7" token="jwt" />);
  const input = await screen.findByRole('textbox', { name: 'Promo or note 1' });
  fireEvent.change(input, { target: { value: 'New shared' } });
  expect(screen.getByRole('button', { name: 'Use shared list' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save for all days' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ scope: 'shared', rows: ['New shared'] });
  expect(await screen.findByText('Shared rows saved. This date still uses its today-only list.')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Promo or note 1' })).toHaveValue('Today note');
  fetchMock.mockRestore();
});

test('Use shared list clears the override and loads effective rows', async () => {
  const today = { date: '2026-09-23', rows: ['Today note'], source: 'date', has_override: true, shared_rows: ['Shared promo'] };
  const fetchMock = jest.spyOn(global, 'fetch')
    .mockResolvedValueOnce(response(today))
    .mockResolvedValueOnce(response({ ...today, rows: ['Shared promo'], source: 'shared', has_override: false }));
  render(<WorkbookPromos date="2026-09-23" organizationId="7" token="jwt" />);
  await screen.findByRole('textbox', { name: 'Promo or note 1' });
  fireEvent.click(screen.getByRole('button', { name: 'Use shared list' }));
  await waitFor(() => expect(fetchMock.mock.calls[1][1].method).toBe('DELETE'));
  expect(await screen.findByRole('textbox', { name: 'Promo or note 1' })).toHaveValue('Shared promo');
  fetchMock.mockRestore();
});
