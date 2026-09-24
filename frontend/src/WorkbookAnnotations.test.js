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

  test('copies the rendered chart row boundaries instead of assuming fixed heights', () => {
    const bounds = (top, bottom) => ({ top, bottom, height: bottom - top });
    const measure = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      if (this.classList.contains('wb-annotations-body')) return bounds(100, 340);
      if (this.classList.contains('wb-table-wrap')) return bounds(100, 340);
      if (this.dataset.measure === 'title') return bounds(101, 143);
      if (this.dataset.measure === 'header') return bounds(143, 180);
      if (this.dataset.measure === 'first') return bounds(180, 225);
      if (this.dataset.measure === 'second') return bounds(225, 340);
      return bounds(0, 0);
    });
    const tableRef = React.createRef();
    try {
      const { container } = render(<>
        <div className="wb-table-wrap">
          <table ref={tableRef}>
            <thead><tr data-measure="title"><th>Zone Chart</th></tr><tr data-measure="header"><th>Name</th></tr></thead>
            <tbody><tr data-measure="first"><td>Alex</td></tr><tr data-measure="second"><td>Blair</td></tr></tbody>
          </table>
        </div>
        <WorkbookAnnotations section="body" rows={[{ shift_id: 1 }, { shift_id: 2 }]} tableRef={tableRef} />
      </>);
      const column = container.querySelector('.wb-annotation-column');
      expect(column.querySelector('.wb-annotation-title-spacer')).toHaveStyle({ height: '43px' });
      expect(column.querySelector('.wb-annotation-header-spacer')).toHaveStyle({ height: '37px' });
      expect(column.querySelectorAll('.wb-annotation-cell')[0]).toHaveStyle({ height: '45px' });
      expect(column.querySelectorAll('.wb-annotation-cell')[1]).toHaveStyle({ height: '115px' });
    } finally {
      measure.mockRestore();
    }
  });
});
