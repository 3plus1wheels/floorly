import React, { useLayoutEffect, useRef, useState } from 'react';
import './WorkbookAnnotations.css';

const ANNOTATION_LABELS = [
  'Learning Lab: Behaviors & Observations',
  '1st Break Taken',
  '2nd Break Taken (If Applicable)',
];

/**
 * The New workbook view's non-editable annotation rail.
 *
 * `header` belongs beside Hourly Segments; `body` belongs beside the Zone
 * Chart. The body reserves two leading rows for the Zone Chart title and
 * column headings, then mirrors its employee rows one-for-one.
 */
export default function WorkbookAnnotations({ rows = [], section, tableRef }) {
  const bodyRef = useRef(null);
  const [measuredHeights, setMeasuredHeights] = useState(null);

  useLayoutEffect(() => {
    if (section !== 'body' || !tableRef?.current || !bodyRef.current) return undefined;
    const table = tableRef.current;
    const wrapper = table.closest('.wb-table-wrap');
    const titleRow = table.tHead?.rows[0];
    const headerRow = table.tHead?.rows[1];
    const chartRows = Array.from(table.tBodies[0]?.rows || []);
    if (!wrapper || !titleRow || !headerRow || !chartRows.length) return undefined;

    const measure = () => {
      const railTop = bodyRef.current?.getBoundingClientRect().top;
      const titleTop = titleRow.getBoundingClientRect().top;
      const headerTop = headerRow.getBoundingClientRect().top;
      const rowTops = chartRows.map(row => row.getBoundingClientRect().top);
      const chartBottom = wrapper.getBoundingClientRect().bottom;
      if (![railTop, titleTop, headerTop, rowTops[0], chartBottom].every(Number.isFinite)
        || chartBottom <= rowTops[0]) return;
      const round = value => Math.max(0, Math.round(value * 100) / 100);
      const heights = [
        round(headerTop - railTop),
        round(rowTops[0] - headerTop),
        ...rowTops.map((top, index) => round((rowTops[index + 1] ?? chartBottom) - top)),
      ];
      setMeasuredHeights(current => current?.length === heights.length && current.every((height, i) => height === heights[i])
        ? current : heights);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    [wrapper, titleRow, headerRow, ...chartRows].forEach(node => observer?.observe(node));
    window.addEventListener('resize', measure);
    window.addEventListener('beforeprint', measure);
    window.addEventListener('afterprint', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('beforeprint', measure);
      window.removeEventListener('afterprint', measure);
    };
  }, [rows, section, tableRef]);

  if (section === 'header') {
    return (
      <div className="wb-annotations-header" role="group" aria-label="Schedule annotations">
        {ANNOTATION_LABELS.map(label => (
          <div className="wb-annotation-title" key={label} title={label}>
            <span>{label}</span>
          </div>
        ))}
      </div>
    );
  }

  if (section !== 'body') return null;

  const bodyRows = rows.length > 0 ? rows : [null];

  return (
    <div ref={bodyRef} className="wb-annotations-body" role="group" aria-label="Non-editable schedule annotation cells">
      {ANNOTATION_LABELS.map(label => (
        <div className="wb-annotation-column" key={label} aria-label={label}>
          <div className="wb-annotation-spacer wb-annotation-title-spacer" style={measuredHeights ? { height: measuredHeights[0] } : undefined} aria-hidden="true" />
          <div className="wb-annotation-spacer wb-annotation-header-spacer" style={measuredHeights ? { height: measuredHeights[1] } : undefined} aria-hidden="true" />
          {bodyRows.map((row, index) => (
            <div
              className={`wb-annotation-cell${row ? '' : ' wb-annotation-empty-row'}`}
              key={row?.shift_id ?? `empty-${index}`}
              style={measuredHeights?.[index + 2] !== undefined ? { height: measuredHeights[index + 2] } : undefined}
              aria-hidden="true"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
