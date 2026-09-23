import React from 'react';
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
export default function WorkbookAnnotations({ rows = [], section }) {
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
    <div className="wb-annotations-body" role="group" aria-label="Non-editable schedule annotation cells">
      {ANNOTATION_LABELS.map(label => (
        <div className="wb-annotation-column" key={label} aria-label={label}>
          <div className="wb-annotation-spacer wb-annotation-title-spacer" aria-hidden="true" />
          <div className="wb-annotation-spacer wb-annotation-header-spacer" aria-hidden="true" />
          {bodyRows.map((row, index) => (
            <div
              className={`wb-annotation-cell${row ? '' : ' wb-annotation-empty-row'}`}
              key={row?.shift_id ?? `empty-${index}`}
              aria-hidden="true"
            />
          ))}
        </div>
      ))}
    </div>
  );
}
