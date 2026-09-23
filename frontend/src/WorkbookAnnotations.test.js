import React from 'react';
import { render, screen } from '@testing-library/react';
import WorkbookAnnotations from './WorkbookAnnotations';

describe('WorkbookAnnotations', () => {
  test('renders three non-editable vertical annotation headings', () => {
    const { container } = render(<WorkbookAnnotations section="header" />);

    expect(screen.getByText('Learning Lab: Behaviors & Observations')).toBeInTheDocument();
    expect(screen.getByText('1st Break Taken')).toBeInTheDocument();
    expect(screen.getByText('2nd Break Taken (If Applicable)')).toBeInTheDocument();
    expect(screen.queryByText(/^Other$/i)).not.toBeInTheDocument();
    expect(container.querySelectorAll('input, button, select, textarea')).toHaveLength(0);
  });

  test('reserves chart heading rows and mirrors each schedule row in three columns', () => {
    const rows = [{ shift_id: 12 }, { shift_id: 13 }, { shift_id: 14 }];
    const { container } = render(<WorkbookAnnotations section="body" rows={rows} />);
    const columns = container.querySelectorAll('.wb-annotation-column');

    expect(columns).toHaveLength(3);
    columns.forEach(column => {
      expect(column.querySelectorAll('.wb-annotation-spacer')).toHaveLength(2);
      expect(column.querySelectorAll('.wb-annotation-cell')).toHaveLength(rows.length);
      expect(column.querySelectorAll('input, button, select, textarea')).toHaveLength(0);
    });
  });

  test('renders one alignment row for an empty schedule', () => {
    const { container } = render(<WorkbookAnnotations section="body" rows={[]} />);
    expect(container.querySelectorAll('.wb-annotation-column')).toHaveLength(3);
    expect(container.querySelectorAll('.wb-annotation-cell')).toHaveLength(3);
  });
});
