import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Check, Inbox, LoaderCircle, Printer, Settings2, X } from 'lucide-react';
import API_BASE from './config';
import { useAuth } from './AuthContext';
import { applyZoneColor, COLOR_OPTIONS, DEFAULT_ZONE_COLORS, normalizeZoneColors, ZONE_OPTIONS, zoneStyle } from './zoneColors';
import WorkbookAnnotations from './WorkbookAnnotations';
import WorkbookPromos from './WorkbookPromos';
import ZoneColorSwatches from './ZoneColorSwatches';
import './Workbook.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ─── Hourly segments configuration ───────────────────────────────────────────
// Each segment: label shown in header, start hour (24h), end hour (24h)
const DEFAULT_SEGMENTS = [
  { label: '10am - 11am', start: 10, end: 11 },
  { label: '11am - 12pm', start: 11, end: 12 },
  { label: '12pm - 1pm',  start: 12, end: 13 },
  { label: '1pm - 2pm',   start: 13, end: 14 },
  { label: '2pm - 3pm',   start: 14, end: 15 },
  { label: '3pm - 4pm',   start: 15, end: 16 },
  { label: '4pm - 5pm',   start: 16, end: 17 },
  { label: '5pm - 6pm',   start: 17, end: 18 },
  { label: '6pm - 7pm',   start: 18, end: 19 },
  { label: '7pm - 8pm',   start: 19, end: 20 },
  { label: '8pm - 9pm',   start: 20, end: 21 },
];

// Default contribution percentages (must total 100)
const DEFAULT_CONTRIBUTIONS = [3, 6, 8, 9, 12, 15, 12, 9, 9, 9, 8];

// Default KPI rows shown in Hourly Segments (user can remove or add custom ones)
const DEFAULT_KPI_ROWS = [
  { id: 'traffic',      label: 'TRAFFIC',                 key: 'traffic'      },
  { id: 'transactions', label: 'TRANSACTIONS',            key: 'transactions' },
  { id: 'conversion',   label: 'CONVERSION',              key: 'conversion',  computed: 'conversion' },
  { id: 'upt',          label: 'UPT',                     key: 'upt'          },
  { id: 'atv',          label: 'ATV',                     key: 'atv',         format: 'currency' },
  { id: 'other',        label: 'OTHER:',                  key: 'other',       optional: true },
  { id: 'actual',       label: 'HOURLY SALES ACTUAL',     key: 'actual',      format: 'currency', optional: true },
  { id: 'cel',          label: 'CEL SIGN-OFF (INITIALS)', key: 'cel',         optional: true },
];

const EMPTY_GOALS = {
  daySalesTarget: null, stretchTarget: null, lastYearSales: null,
  lastYearTraffic: null, trafficTrend: null, projectedTraffic: null,
  transactionGoal: null, conversionTarget: null, upt: null, atv: null,
  monthSalesPlan: null, monthToDateSales: null,
};

function defaultHourly() {
  return DEFAULT_SEGMENTS.map((_, i) => ({
    pct: DEFAULT_CONTRIBUTIONS[i] ?? 0,
    actual: null, traffic: null, transactions: null, upt: null, atv: null, other: null, cel: '',
  }));
}

function hourlyArray(hourlyByHour) {
  return DEFAULT_SEGMENTS.map((segment, i) => ({
    ...defaultHourly()[i],
    ...(hourlyByHour?.[String(segment.start)] || {}),
  }));
}

function mergeSessionCustomHourly(serverHourly, currentHourly) {
  return serverHourly.map((segment, index) => {
    const customValues = Object.fromEntries(
      Object.entries(currentHourly[index] || {}).filter(([key]) => key.startsWith('custom_'))
    );
    return { ...segment, ...customValues };
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseCurrency(val) {
  if (val === '' || val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

function formatCurrency(n) {
  if (n === null || n === undefined || n === '') return '';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatPct(n) {
  if (n === null || n === undefined || n === '') return '';
  return Number(n).toFixed(0) + '%';
}

// Editable cell that can switch between display and input mode
function EditCell({ value, onChange, format, className, style, placeholder, text = false, ariaLabel }) {
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState('');
  const inputRef = useRef(null);
  const committedRef = useRef(false);

  const startEdit = () => {
    setRaw(value !== null && value !== undefined && value !== '' ? String(value) : '');
    committedRef.current = false;
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (text) {
      onChange(raw.trim());
    } else {
      const num = parseFloat(String(raw).replace(/[$,%]/g, ''));
      onChange(isNaN(num) ? '' : num);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <td className={className} style={style}>
        <input
          ref={inputRef}
          className="wb-inline-input"
          aria-label={ariaLabel}
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { committedRef.current = true; setEditing(false); }
          }}
          placeholder={placeholder}
        />
      </td>
    );
  }

  const display = value !== '' && value !== null && value !== undefined
    ? (format ? format(value) : value)
    : <span className="wb-cell-empty">{placeholder || '—'}</span>;

  return (
    <td className={`${className || ''} wb-editable`} style={style} onClick={startEdit} title="Click to edit" aria-label={ariaLabel}>
      {display}
    </td>
  );
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatShortDate(date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function shiftTimeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function validShiftTimes(start, end) {
  const startMinutes = shiftTimeMinutes(start);
  const endMinutes = shiftTimeMinutes(end);
  return startMinutes !== null && endMinutes !== null
    && startMinutes % 15 === 0 && endMinutes % 15 === 0
    && endMinutes > startMinutes;
}

function loadZoneColors(organizationId) {
  if (!organizationId) return { ...DEFAULT_ZONE_COLORS };
  try {
    return normalizeZoneColors(JSON.parse(localStorage.getItem(`floorly-zone-colors:${organizationId}`)));
  } catch {
    return { ...DEFAULT_ZONE_COLORS };
  }
}

function ZoneCell({ zone, effective, overridden, selectionLabel, disabled, onChange, zoneColors }) {
  if (!zone) return <td className="wb-hour-cell" />;

  const s = zoneStyle(effective, zoneColors);

  return (
    <td
      className={`wb-hour-cell wb-hour-clickable${overridden ? ' wb-overridden' : ''}`}
      style={{ backgroundColor: s.bg, color: s.text }}
      role="gridcell"
      aria-label={effective}
    >
      <select
        className="wb-zone-select"
        aria-label={`Zone for ${selectionLabel}`}
        value={overridden ? effective : ''}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
        style={{ color: s.text }}
      >
        <option value="">{zone} (AUTO)</option>
        {ZONE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
      <span className="wb-zone-print-value">{effective}</span>
    </td>
  );
}

function NameCell({ row, editing, draft, saving, editDisabled, onEdit, onChange, onSave, onCancel }) {
  const normalized = draft.trim().replace(/\s+/g, ' ').toUpperCase();
  const changed = normalized !== row.name;
  const canSave = changed && normalized.length <= 64 && !saving;

  return (
    <td className="wb-name-cell">
      <span className="wb-name-print-value">{row.name}</span>
      {editing ? (
        <div className="wb-name-editor" onKeyDown={event => {
          if (event.key === 'Escape') onCancel();
          if (event.key === 'Enter' && canSave) { event.preventDefault(); onSave(); }
        }}>
          <input
            type="text"
            maxLength="64"
            aria-label={`Workbook name for ${row.full_name || row.name}`}
            value={draft}
            disabled={saving}
            autoFocus
            onChange={event => onChange(event.target.value)}
          />
          <div className="wb-name-editor-actions">
            <button type="button" aria-label={`Save workbook name for ${row.full_name || row.name}`} disabled={!canSave} onClick={onSave}>
              {saving ? <LoaderCircle className="wb-shift-spinner" /> : <Check />}
            </button>
            <button type="button" aria-label={`Cancel workbook name edit for ${row.full_name || row.name}`} disabled={saving} onClick={onCancel}><X /></button>
          </div>
        </div>
      ) : (
        <button type="button" className="wb-name-edit-button" aria-label={`Edit workbook name for ${row.full_name || row.name}`} disabled={editDisabled} onClick={onEdit}>
          {row.name}
        </button>
      )}
    </td>
  );
}

function ShiftCell({ row, editing, draft, saving, editDisabled, onEdit, onChange, onSave, onCancel }) {
  const changed = draft.start_time !== row.start_time || draft.end_time !== row.end_time;
  const canSave = changed && validShiftTimes(draft.start_time, draft.end_time) && !saving;

  return (
    <td className={`wb-shift-cell${editing ? ' editing' : ''}`}>
      <span className="wb-shift-print-value">{row.shift}</span>
      {editing ? (
        <div className="wb-shift-editor" onKeyDown={event => { if (event.key === 'Escape') onCancel(); }}>
          <input
            type="text"
            inputMode="numeric"
            placeholder="09:00"
            aria-label={`Start time for ${row.name}`}
            value={draft.start_time}
            disabled={saving}
            onChange={event => onChange({ ...draft, start_time: event.target.value })}
          />
          <span aria-hidden="true">–</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="17:00"
            aria-label={`End time for ${row.name}`}
            value={draft.end_time}
            disabled={saving}
            onChange={event => onChange({ ...draft, end_time: event.target.value })}
          />
          <div className="wb-shift-editor-actions">
            <button type="button" aria-label={`Save shift for ${row.name}`} title="Save shift" disabled={!canSave} onClick={onSave}>
              {saving ? <LoaderCircle className="wb-shift-spinner" /> : <Check />}
            </button>
            <button type="button" aria-label={`Cancel shift edit for ${row.name}`} title="Cancel" disabled={saving} onClick={onCancel}><X /></button>
          </div>
        </div>
      ) : (
        <button type="button" className="wb-shift-edit-button" aria-label={`Edit shift for ${row.name}`} disabled={editDisabled} onClick={onEdit}>
          {row.shift}
        </button>
      )}
    </td>
  );
}

// ─── Today's Goals panel ─────────────────────────────────────────────────────
function TodaysGoals({ goals, sources, date, comparisonDate, onCommit }) {
  const set = (key) => (val) => onCommit(key, val);

  const plan = parseCurrency(goals.monthSalesPlan);
  const mtd = parseCurrency(goals.monthToDateSales);
  const pctOfPlan = goals.percentToMonthSalesPlan != null
    ? `${Number(goals.percentToMonthSalesPlan).toFixed(1)}%`
    : plan !== null && plan !== 0 && mtd !== null ? `${((mtd / plan) * 100).toFixed(1)}%` : '—';
  const monthToGo = goals.monthToGo != null
    ? formatCurrency(goals.monthToGo)
    : plan !== null && mtd !== null ? formatCurrency(plan - mtd) : '—';

  // Compute projected traffic from last year + trend
  const computedProjected = (() => {
    const ly = parseCurrency(goals.lastYearTraffic);
    const trend = goals.trafficTrend !== '' && goals.trafficTrend !== null && goals.trafficTrend !== undefined
      ? parseFloat(goals.trafficTrend) : null;
    if (ly !== null && trend !== null) return Math.round(ly * (1 + trend / 100));
    return goals.projectedTraffic ?? null;
  })();

  const renderLabel = (key, label) => (
    <td
      className="wb-goals-label"
      title={sources?.[key] ? `Source: ${sources[key].replace(/_/g, ' ')}` : undefined}
    >
      <span>{label}</span>
    </td>
  );
  const dateLabel = date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }).replace(/\//g, '.') : '—';
  const comparisonLabel = comparisonDate ? new Date(`${comparisonDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;

  return (
    <div className="wb-goals-panel">
      <div className="wb-goals-header">TODAY'S GOALS{comparisonLabel && <span className="wb-goals-comparison">Compared with {comparisonLabel}</span>}</div>
      <table className="wb-goals-table">
        <tbody>
          <tr>
            <td className="wb-goals-label">DATE</td>
            <td className="wb-goals-value wb-goals-plain">{dateLabel}</td>
          </tr>
          <tr className="wb-goals-highlight">
            {renderLabel('daySalesTarget', 'DAY SALES TARGET')}
            <EditCell value={goals.daySalesTarget} onChange={set('daySalesTarget')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit day sales target" />
          </tr>
          <tr className="wb-goals-highlight">
            {renderLabel('stretchTarget', 'STRETCH TARGET')}
            <EditCell value={goals.stretchTarget} onChange={set('stretchTarget')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit stretch target" />
          </tr>
          <tr>
            {renderLabel('lastYearSales', 'LAST YEAR SALES')}
            <EditCell value={goals.lastYearSales} onChange={set('lastYearSales')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit last year sales" />
          </tr>
          <tr>
            {renderLabel('lastYearTraffic', 'LAST YEAR TRAFFIC')}
            <EditCell value={goals.lastYearTraffic} onChange={set('lastYearTraffic')} className="wb-goals-value" placeholder="—" ariaLabel="Edit last year traffic" />
          </tr>
          <tr>
            {renderLabel('trafficTrend', 'CURRENT TRAFFIC TREND (+/-)')}
            <EditCell value={goals.trafficTrend} onChange={set('trafficTrend')} format={v => v + '%'} className="wb-goals-value" placeholder="—" ariaLabel="Edit current traffic trend" />
          </tr>
          <tr className="wb-goals-computed">
            {renderLabel('projectedTraffic', 'PROJECTED TRAFFIC')}
            <td className="wb-goals-value">{computedProjected !== null ? computedProjected : '—'}</td>
          </tr>
          <tr className="wb-goals-highlight">
            {renderLabel('transactionGoal', 'TRANSACTION GOAL')}
            <EditCell value={goals.transactionGoal} onChange={set('transactionGoal')} className="wb-goals-value" placeholder="—" ariaLabel="Edit transaction goal" />
          </tr>
          <tr>
            {renderLabel('conversionTarget', 'CONVERSION TARGET')}
            <EditCell value={goals.conversionTarget} onChange={set('conversionTarget')} format={v => v + '%'} className="wb-goals-value" placeholder="—" ariaLabel="Edit conversion target" />
          </tr>
          <tr>
            {renderLabel('upt', 'UPT')}
            <EditCell value={goals.upt} onChange={set('upt')} className="wb-goals-value" placeholder="—" ariaLabel="Edit UPT" />
          </tr>
          <tr>
            {renderLabel('atv', 'ATV')}
            <EditCell value={goals.atv} onChange={set('atv')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit ATV" />
          </tr>

          {/* Month to date */}
          <tr>
            <td colSpan={2} className="wb-goals-section-header">MONTH TO DATE PERFORMANCE</td>
          </tr>
          <tr>
            {renderLabel('monthSalesPlan', 'MONTH SALES PLAN')}
            <EditCell value={goals.monthSalesPlan} onChange={set('monthSalesPlan')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit month sales plan" />
          </tr>
          <tr>
            {renderLabel('monthToDateSales', 'MONTH TO DATE SALES')}
            <EditCell value={goals.monthToDateSales} onChange={set('monthToDateSales')} format={formatCurrency} className="wb-goals-value" placeholder="—" ariaLabel="Edit month to date sales" />
          </tr>
          <tr>
            {renderLabel('percentToMonthSalesPlan', '% TO MONTH SALES PLAN')}
            <td className="wb-goals-value">{pctOfPlan}</td>
          </tr>
          <tr>
            {renderLabel('monthToGo', 'MONTH TO GO')}
            <td className="wb-goals-value">{monthToGo}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── Hourly Segments panel ────────────────────────────────────────────────────
function HourlySegments({ goals, hourly, setHourly, onHourlyCommit, segments, kpiRows, printFitMode, newView = false }) {
  const daySales   = parseCurrency(goals.daySalesTarget) || 0;
  const dayStretch = parseCurrency(goals.stretchTarget)  || 0;

  const contribs = segments.map((_, i) => hourly[i]?.pct ?? DEFAULT_CONTRIBUTIONS[i] ?? 0);
  const totalPct = contribs.reduce((a, b) => a + b, 0);

  const cumSalesTarget = [];
  const cumStretchTarget = [];
  let runSales = 0, runStretch = 0;
  contribs.forEach(pct => {
    runSales   += daySales   * (pct / 100);
    runStretch += dayStretch * (pct / 100);
    cumSalesTarget.push(runSales);
    cumStretchTarget.push(runStretch);
  });

  const cumActual = [];
  let runActual = 0;
  segments.forEach((_, i) => {
    const a = parseCurrency(hourly[i]?.actual);
    runActual += (a || 0);
    cumActual.push(a !== null ? runActual : null);
  });

  const setCell = (i, key, persist = true) => (val) => {
    if (persist) {
      onHourlyCommit(String(segments[i].start), key, val);
      return;
    }
    setHourly(previous => {
      const next = [...previous];
      next[i] = { ...next[i], [key]: val };
      return next;
    });
  };

  // Fixed header rows (always shown)
  const fixedRows = [
    {
      label: 'HOURLY SALES CONTRIBUTION %', highlight: true,
      cells: segments.map((_, i) => ({ value: contribs[i], format: formatPct, onChange: setCell(i, 'pct'), editable: true })),
      extra: totalPct !== 100 ? <span className="wb-hs-warning">{totalPct}%</span> : <span className="wb-hs-ok">100%</span>,
    },
    {
      label: 'CUMULATIVE SALES TARGET', highlight: true,
      cells: segments.map((_, i) => ({ value: cumSalesTarget[i] || '', format: v => formatCurrency(Math.round(v)), editable: false })),
    },
    {
      label: 'CUMULATIVE STRETCH TARGET',
      cells: segments.map((_, i) => ({ value: cumStretchTarget[i] || '', format: v => formatCurrency(Math.round(v)), editable: false })),
    },
    {
      label: 'CUMULATIVE SALES ACTUAL',
      cells: segments.map((_, i) => ({ value: cumActual[i], format: v => formatCurrency(Math.round(v)), editable: false, derived: true })),
    },
    { spacer: true },
  ];

  // Configurable KPI rows
  const kpiRowDefs = kpiRows.map(row => {
    if (row.computed === 'conversion') {
      return {
        label: row.label,
        optional: !!row.optional || String(row.id).startsWith('custom_'),
        cells: segments.map((_, i) => {
          const tr = parseFloat(hourly[i]?.traffic);
          const tx = parseFloat(hourly[i]?.transactions);
          const cv = (!isNaN(tr) && tr > 0 && !isNaN(tx)) ? formatPct((tx / tr) * 100) : '';
          return { value: cv, editable: false, derived: true };
        }),
      };
    }
    const fmt = row.format === 'currency' ? (v => formatCurrency(v)) : undefined;
    return {
      label: row.label,
      optional: !!row.optional || String(row.id).startsWith('custom_'),
      cells: segments.map((_, i) => ({
        value: hourly[i]?.[row.key] ?? '',
        onChange: setCell(i, row.key, !String(row.id).startsWith('custom_')),
        format: fmt,
        text: row.key === 'cel',
        editable: true,
      })),
    };
  });

  const allRows = [...fixedRows, ...kpiRowDefs];
  const visibleRows = printFitMode === 'hide-optional'
    ? allRows.filter(r => !r.optional)
    : allRows;
  const nonSpacerCount = visibleRows.filter(r => !r.spacer).length;
  const leadingHours = newView ? [8, 9] : [];
  const totalColumns = segments.length + leadingHours.length + 2;

  return (
    <div className="wb-hs-wrap">
      <table className="wb-hs-table">
        <colgroup>
          <col className="wb-hs-label-col" />
          {leadingHours.map(hour => <col key={`leading-${hour}`} className="wb-hs-leading-col" />)}
          {segments.map((seg, i) => <col key={i} />)}
          <col className="wb-hs-notes-col" />
        </colgroup>
        <thead>
          <tr>
            <th className="wb-hs-section-title" colSpan={totalColumns}>HOURLY SEGMENTS</th>
          </tr>
          <tr>
            <th className="wb-hs-row-label">HOURS OF OPERATIONS</th>
            {leadingHours.map(hour => <th key={hour} className="wb-hs-col-header">{hour}am - {hour + 1}am</th>)}
            {segments.map((seg, i) => (
              <th key={i} className="wb-hs-col-header">{seg.label}</th>
            ))}
            <th className="wb-hs-notes-header">NOTES &amp; OBSERVATIONS<br/><span className="wb-hs-notes-sub">Complete throughout the day</span></th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, ri) => {
            if (row.spacer) return <tr key={ri} className="wb-hs-spacer"><td colSpan={newView ? totalColumns - 1 : totalColumns} /></tr>;
            return (
              <tr key={ri} className={`${row.highlight ? 'wb-hs-highlight' : ''}${row.optional ? ' wb-hs-row-optional' : ''}`}>
                <td className="wb-hs-row-label">{row.label}{row.extra && <span style={{ marginLeft: 8 }}>{row.extra}</span>}</td>
                {leadingHours.map(hour => <td key={`leading-${hour}`} className="wb-hs-cell wb-hs-leading-cell" aria-hidden="true" />)}
                {row.cells.map((cell, ci) => {
                  if (cell.editable && cell.onChange) {
                    return (
                      <EditCell
                        key={ci}
                        value={cell.value}
                        onChange={cell.onChange}
                        format={cell.format}
                        text={cell.text}
                        ariaLabel={`Edit ${row.label} ${segments[ci].label}`}
                        className={`wb-hs-cell${cell.derived ? ' wb-hs-derived' : ''}`}
                      />
                    );
                  }
                  const display = cell.value !== '' && cell.value !== null && cell.value !== undefined
                    ? (cell.format ? cell.format(cell.value) : cell.value)
                    : '';
                  return (
                    <td key={ci} className={`wb-hs-cell${cell.derived ? ' wb-hs-derived' : ''}`}>{display}</td>
                  );
                })}
                {ri === 0 ? <td className="wb-hs-notes-cell" rowSpan={newView ? visibleRows.length : nonSpacerCount} aria-label="Notes and observations placeholder; not saved" /> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Workbook component ──────────────────────────────────────────────────
export default function Workbook({ onWeekChange, refreshVersion = 0 }) {
  const { selectedOrganizationId } = useAuth();
  const [workbookView, setWorkbookView] = useState(() => {
    try { return localStorage.getItem('floorly-workbook-view') === 'new' ? 'new' : 'old'; }
    catch { return 'old'; }
  });
  const [promoDirty, setPromoDirty] = useState(false);
  const [zoneColors, setZoneColors] = useState(() => loadZoneColors(selectedOrganizationId));
  const [editingZoneColors, setEditingZoneColors] = useState(false);
  const [colorZone, setColorZone] = useState(ZONE_OPTIONS[0]);
  const [colorValue, setColorValue] = useState(() => loadZoneColors(selectedOrganizationId)[ZONE_OPTIONS[0]]);
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [activeDay, setActiveDay] = useState('Mon');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [overrides, setOverrides] = useState({});
  const [zoneSaveStatus, setZoneSaveStatus] = useState('saved');
  const [zoneSaveError, setZoneSaveError] = useState('');
  const [editingShiftId, setEditingShiftId] = useState(null);
  const [shiftDraft, setShiftDraft] = useState({ start_time: '', end_time: '' });
  const [shiftSaveStatus, setShiftSaveStatus] = useState('saved');
  const [shiftSaveError, setShiftSaveError] = useState('');
  const [editingNameShiftId, setEditingNameShiftId] = useState(null);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaveStatus, setNameSaveStatus] = useState('saved');
  const [nameSaveError, setNameSaveError] = useState('');
  const [kpiState, setKpiState] = useState(null);
  const [saveStatus, setSaveStatus] = useState('saved');
  const [saveError, setSaveError] = useState('');
  const saveQueueRef = useRef(Promise.resolve());
  const loadRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const zoneSaveRequestRef = useRef(0);

  // KPI row configuration — shared across all days
  const [kpiRows, setKpiRows] = useState(DEFAULT_KPI_ROWS);
  const [editingKpis, setEditingKpis] = useState(false);
  const [newKpiLabel, setNewKpiLabel] = useState('');
  const [printFitMode, setPrintFitMode] = useState('balanced');

  const [goals, setGoals] = useState(EMPTY_GOALS);
  const [hourly, setHourly] = useState(defaultHourly);

  const segments = DEFAULT_SEGMENTS;

  useEffect(() => {
    if (!promoDirty) return undefined;
    const warnBeforeUnload = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [promoDirty]);

  useEffect(() => {
    const savedColors = loadZoneColors(selectedOrganizationId);
    setZoneColors(savedColors);
    setColorZone(ZONE_OPTIONS[0]);
    setColorValue(savedColors[ZONE_OPTIONS[0]]);
  }, [selectedOrganizationId]);

  const saveZoneColors = colors => {
    setZoneColors(colors);
    if (!selectedOrganizationId) return;
    try { localStorage.setItem(`floorly-zone-colors:${selectedOrganizationId}`, JSON.stringify(colors)); } catch { /* Keep the current page updated if storage is unavailable. */ }
  };

  const token = localStorage.getItem('access_token');
  const requestedDate = toYMD(addDays(weekStart, DAYS.indexOf(activeDay)));
  const scopeKey = `${selectedOrganizationId}:${requestedDate}`;
  const currentScopeRef = useRef(scopeKey);
  currentScopeRef.current = scopeKey;

  useEffect(() => {
    onWeekChange?.(toYMD(weekStart));
  }, [weekStart, onWeekChange]);

  const fetchWorkbook = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const requestedScope = `${selectedOrganizationId}:${toYMD(addDays(weekStart, DAYS.indexOf(activeDay)))}`;
    setLoading(true);
    setError(null);
    setOverrides({});
    setZoneSaveStatus('saved');
    setZoneSaveError('');
    setEditingShiftId(null);
    setShiftDraft({ start_time: '', end_time: '' });
    setShiftSaveStatus('saved');
    setShiftSaveError('');
    setEditingNameShiftId(null);
    setNameDraft('');
    setNameSaveStatus('saved');
    setNameSaveError('');
    setData(null);
    setKpiState(null);
    setGoals(EMPTY_GOALS);
    setHourly(current => mergeSessionCustomHourly(defaultHourly(), current));
    setSaveError('');
    setSaveStatus('saved');
    saveRequestRef.current += 1;
    zoneSaveRequestRef.current += 1;
    try {
      const res = await fetch(
        `${API_BASE}/api/schedule/workbook/?week_start=${toYMD(weekStart)}&day=${activeDay}`,
        { headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': selectedOrganizationId } }
      );
      if (!res.ok) throw new Error('Failed to fetch workbook');
      const payload = await res.json();
      if (requestId !== loadRequestRef.current || currentScopeRef.current !== requestedScope) return;
      setData(payload);
      const savedZones = {};
      payload.rows.forEach(row => {
        Object.entries(row.zone_overrides || {}).forEach(([hour, zone]) => {
          savedZones[`${row.shift_id}:${hour}`] = zone;
        });
      });
      setOverrides(savedZones);
      const kpi = payload.kpi || null;
      setKpiState(kpi);
      setGoals(kpi?.goals || EMPTY_GOALS);
      setHourly(current => mergeSessionCustomHourly(hourlyArray(kpi?.hourly), current));
    } catch (err) {
      if (requestId === loadRequestRef.current && currentScopeRef.current === requestedScope) setError(err.message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [weekStart, activeDay, token, selectedOrganizationId]);

  useEffect(() => { fetchWorkbook(); }, [fetchWorkbook, refreshVersion]);

  const startShiftEdit = row => {
    if (shiftSaveStatus === 'saving' || nameSaveStatus === 'saving') return;
    setEditingNameShiftId(null);
    setNameDraft('');
    setNameSaveStatus('saved');
    setNameSaveError('');
    setEditingShiftId(row.shift_id);
    setShiftDraft({ start_time: row.start_time || '', end_time: row.end_time || '' });
    setShiftSaveStatus('saved');
    setShiftSaveError('');
  };

  const cancelShiftEdit = () => {
    if (shiftSaveStatus === 'saving') return;
    setEditingShiftId(null);
    setShiftDraft({ start_time: '', end_time: '' });
    setShiftSaveStatus('saved');
    setShiftSaveError('');
  };

  const saveShiftEdit = async shiftId => {
    if (shiftSaveStatus === 'saving' || !validShiftTimes(shiftDraft.start_time, shiftDraft.end_time)) return;
    setShiftSaveStatus('saving');
    setShiftSaveError('');
    try {
      const response = await fetch(`${API_BASE}/api/schedule/shifts/${shiftId}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': selectedOrganizationId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(shiftDraft),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save shift times.');
      setEditingShiftId(null);
      await fetchWorkbook();
      setShiftSaveStatus('saved');
    } catch (err) {
      setShiftSaveStatus('error');
      setShiftSaveError(err.message || 'Could not save shift times.');
    }
  };

  const startNameEdit = row => {
    if (shiftSaveStatus === 'saving' || nameSaveStatus === 'saving') return;
    setEditingShiftId(null);
    setShiftDraft({ start_time: '', end_time: '' });
    setShiftSaveStatus('saved');
    setShiftSaveError('');
    setEditingNameShiftId(row.shift_id);
    setNameDraft(row.name_override || row.name || '');
    setNameSaveStatus('saved');
    setNameSaveError('');
  };

  const cancelNameEdit = () => {
    if (nameSaveStatus === 'saving') return;
    setEditingNameShiftId(null);
    setNameDraft('');
    setNameSaveStatus('saved');
    setNameSaveError('');
  };

  const saveNameEdit = async shiftId => {
    if (nameSaveStatus === 'saving' || nameDraft.length > 64) return;
    setNameSaveStatus('saving');
    setNameSaveError('');
    try {
      const response = await fetch(`${API_BASE}/api/schedule/shifts/${shiftId}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': selectedOrganizationId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ display_name: nameDraft }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save the workbook name.');
      setEditingNameShiftId(null);
      await fetchWorkbook();
      setNameSaveStatus('saved');
    } catch (err) {
      setNameSaveStatus('error');
      setNameSaveError(err.message || 'Could not save the workbook name.');
    }
  };

  const saveKpiPatch = useCallback((patch) => {
    const targetDate = kpiState?.date || requestedDate;
    const requestedScope = `${selectedOrganizationId}:${targetDate}`;
    const requestId = ++saveRequestRef.current;
    const run = async () => {
      const response = await fetch(`${API_BASE}/api/schedule/kpi-days/${targetDate}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': selectedOrganizationId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not save workbook changes.');
      if (requestId === saveRequestRef.current && currentScopeRef.current === requestedScope) {
        setKpiState(body);
        setGoals(body.goals || EMPTY_GOALS);
        setHourly(current => mergeSessionCustomHourly(hourlyArray(body.hourly), current));
        setSaveStatus('saved');
        setSaveError('');
      }
    };
    setSaveStatus('saving');
    setSaveError('');
    const task = saveQueueRef.current.catch(() => {}).then(run);
    saveQueueRef.current = task;
    task.catch((err) => {
      if (requestId === saveRequestRef.current && currentScopeRef.current === requestedScope) {
        setSaveStatus('error');
        setSaveError(err.message || 'Could not save workbook changes.');
      }
    });
  }, [kpiState?.date, requestedDate, selectedOrganizationId, token]);

  const commitGoal = useCallback((key, value) => {
    setGoals(current => ({
      ...current,
      [key]: value === '' ? (kpiState?.baseGoals?.[key] ?? null) : value,
    }));
    saveKpiPatch(value === ''
      ? { goal_resets: [key] }
      : { goal_updates: { [key]: value } });
  }, [kpiState, saveKpiPatch]);

  const resetAllKpis = useCallback(() => {
    const goalResets = kpiState?.overrides || [];
    if (!goalResets.length) return;
    setGoals(current => ({ ...current, ...kpiState.baseGoals }));
    saveKpiPatch({ goal_resets: goalResets });
  }, [kpiState, saveKpiPatch]);

  const commitHourly = useCallback((hour, key, value) => {
    const normalizedValue = value === '' ? null : value;
    setHourly(current => current.map((segment, i) => (
      String(DEFAULT_SEGMENTS[i].start) === hour ? { ...segment, [key]: value } : segment
    )));
    saveKpiPatch({ hourly_updates: { [hour]: { [key]: normalizedValue } } });
  }, [saveKpiPatch]);

  const saveZoneOperation = useCallback(async (operation, zone = null, cells = []) => {
    if (zoneSaveStatus === 'saving') return;
    if (operation !== 'reset_all' && cells.length === 0) return;
    const before = { ...overrides };
    if (operation === 'set') {
      setOverrides(current => {
        const next = { ...current };
        cells.forEach(cell => { next[`${cell.shift_id}:${cell.hour}`] = zone; });
        return next;
      });
    } else if (operation === 'clear') {
      setOverrides(current => {
        const next = { ...current };
        cells.forEach(cell => { delete next[`${cell.shift_id}:${cell.hour}`]; });
        return next;
      });
    } else {
      setOverrides({});
    }

    const requestId = ++zoneSaveRequestRef.current;
    const requestedScope = scopeKey;
    setZoneSaveStatus('saving');
    setZoneSaveError('');
    const body = operation === 'reset_all'
      ? { reset_all: true }
      : { [operation]: { cells, ...(operation === 'set' ? { zone } : {}) } };
    try {
      const response = await fetch(`${API_BASE}/api/schedule/workbook-zones/${requestedDate}/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': selectedOrganizationId,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Could not save zone assignments.');
      if (requestId !== zoneSaveRequestRef.current || currentScopeRef.current !== requestedScope) return;
      const canonical = {};
      (payload.overrides || []).forEach(item => {
        canonical[`${item.shift_id}:${item.hour}`] = item.zone;
      });
      setOverrides(canonical);
      setZoneSaveStatus('saved');
    } catch (err) {
      if (requestId !== zoneSaveRequestRef.current || currentScopeRef.current !== requestedScope) return;
      setOverrides(before);
      setZoneSaveStatus('error');
      setZoneSaveError(err.message || 'Could not save zone assignments.');
    }
  }, [overrides, requestedDate, scopeKey, selectedOrganizationId, token, zoneSaveStatus]);

  const weekDates = DAYS.map((_, i) => addDays(weekStart, i));
  const hasOverrides = Object.keys(overrides).length > 0;
  const optionalKpiCount = kpiRows.filter(r => r.optional || String(r.id).startsWith('custom_')).length;
  const colorOwner = ZONE_OPTIONS.find(zone => zone !== colorZone && zoneColors[zone] === colorValue);

  const handlePrint = () => window.print();
  const canLeavePromos = () => !promoDirty || window.confirm('Discard unsaved promo and notes changes?');
  const changeWeek = nextWeek => {
    const changed = toYMD(nextWeek) !== toYMD(weekStart);
    if (changed && !canLeavePromos()) return;
    if (changed) setPromoDirty(false);
    setWeekStart(nextWeek);
  };
  const selectWorkbookView = view => {
    const changed = view !== workbookView;
    if (changed && !canLeavePromos()) return;
    if (changed) setPromoDirty(false);
    setWorkbookView(view);
    try { localStorage.setItem('floorly-workbook-view', view); } catch { /* Keep the selected view for this session. */ }
  };

  const zoneSection = (
    <div className={`wb-zone-section${workbookView === 'new' ? ' wb-zone-new' : ''}`}>
      {loading && (
        <div className="state-card inline">
          <LoaderCircle className="state-icon" />
          <div>
            <p className="state-title">Loading workbook</p>
            <p className="state-copy">Building the Floorly map for {activeDay}.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="state-card inline error">
          <AlertTriangle className="state-icon" />
          <div>
            <p className="state-title">Workbook unavailable</p>
            <p className="state-copy">{error}</p>
          </div>
        </div>
      )}

      {data && !loading && (
        <div className="wb-table-wrap">
          <table className={`wb-table${workbookView === 'new' ? ' wb-zone-new-table' : ''}`} role="grid" aria-label="Floorly zone map">
            <thead>
              <tr>
                <th className={`wb-zone-header${workbookView === 'new' ? ' wb-zone-section-title' : ''}`} colSpan={2 + data.col_headers.length + (workbookView === 'new' ? 1 : 0)}>
                  {workbookView === 'new' ? 'ZONE CHART' : <>FLOORLY MAP — {data.day.toUpperCase()}&nbsp;&nbsp;<span className="wb-zone-date">{data.date}</span></>}
                </th>
              </tr>
              <tr>
                <th className="wb-col-name">Name</th>
                <th className="wb-col-shift">Shift</th>
                {data.col_headers.map(h => (
                  <th key={h} className="wb-col-hour">{h}</th>
                ))}
                {workbookView === 'new' && <th className="wb-zone-notes-header">Notes</th>}
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr>
                  <td colSpan={2 + data.col_headers.length + (workbookView === 'new' ? 1 : 0)} className="wb-no-data">
                    <div className="state-card inline">
                      <Inbox className="state-icon" />
                      <div>
                        <p className="state-title">No shifts for {data.day} {data.date}</p>
                        <p className="state-copy">Import the weekly schedule to generate this day’s Floorly map.</p>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                data.rows.map(row => (
                  <tr key={row.shift_id}>
                    <NameCell
                      row={row}
                      editing={editingNameShiftId === row.shift_id}
                      draft={editingNameShiftId === row.shift_id ? nameDraft : row.name}
                      saving={editingNameShiftId === row.shift_id && nameSaveStatus === 'saving'}
                      editDisabled={shiftSaveStatus === 'saving' || nameSaveStatus === 'saving'}
                      onEdit={() => startNameEdit(row)}
                      onChange={setNameDraft}
                      onSave={() => saveNameEdit(row.shift_id)}
                      onCancel={cancelNameEdit}
                    />
                    <ShiftCell
                      row={row}
                      editing={editingShiftId === row.shift_id}
                      draft={editingShiftId === row.shift_id ? shiftDraft : { start_time: row.start_time, end_time: row.end_time }}
                      saving={editingShiftId === row.shift_id && shiftSaveStatus === 'saving'}
                      editDisabled={shiftSaveStatus === 'saving' || nameSaveStatus === 'saving'}
                      onEdit={() => startShiftEdit(row)}
                      onChange={setShiftDraft}
                      onSave={() => saveShiftEdit(row.shift_id)}
                      onCancel={cancelShiftEdit}
                    />
                    {data.hours.map(h => {
                      const zone = row.zones[String(h)];
                      const col = data.hours.indexOf(h);
                      const cellKey = `${row.shift_id}:${h}`;
                      return (
                        <ZoneCell
                          key={h}
                          zone={zone}
                          effective={overrides[cellKey] || zone}
                          overridden={Boolean(overrides[cellKey])}
                          selectionLabel={`${row.name}, ${data.col_headers[col]}`}
                          disabled={zoneSaveStatus === 'saving'}
                          onChange={value => saveZoneOperation(
                            value ? 'set' : 'clear',
                            value || null,
                            [{ shift_id: row.shift_id, hour: h }],
                          )}
                          zoneColors={zoneColors}
                        />
                      );
                    })}
                    {workbookView === 'new' && <td className="wb-zone-notes-cell" aria-label={`Notes placeholder for ${row.name}; not saved`} />}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="state-card inline">
          <Inbox className="state-icon" />
          <div>
            <p className="state-title">No workbook data yet</p>
            <p className="state-copy">Import a schedule to generate your first Floorly map.</p>
          </div>
        </div>
      )}

      <div className="wb-legend" aria-label="Zone color legend">
        {ZONE_OPTIONS.map(zone => {
          const style = zoneStyle(zone, zoneColors);
          return <span key={zone} className="wb-legend-item" style={{ backgroundColor: style.bg, color: style.text }}>{zone}</span>;
        })}
      </div>
    </div>
  );

  return (
    <div className={`wb-root wb-print-${printFitMode}`}>
      {/* ── Week nav ── */}
      <div className="wb-topbar">
        <div className="wb-week-nav">
          <button onClick={() => changeWeek(addDays(weekStart, -7))}>‹</button>
          <span className="wb-week-label">
            {formatShortDate(weekStart)} – {formatShortDate(addDays(weekStart, 6))}
          </span>
          <button onClick={() => changeWeek(addDays(weekStart, 7))}>›</button>
          <button className="wb-today-btn" onClick={() => changeWeek(getMondayOfWeek(new Date()))}>Today</button>
        </div>
        <div className="wb-topbar-actions">
          <div className="wb-view-switch" role="group" aria-label="Workbook view">
            <button type="button" aria-pressed={workbookView === 'old'} className={workbookView === 'old' ? 'active' : ''} onClick={() => selectWorkbookView('old')}>Old</button>
            <button type="button" aria-pressed={workbookView === 'new'} className={workbookView === 'new' ? 'active' : ''} onClick={() => selectWorkbookView('new')}>New</button>
          </div>
          <button
            className="wb-reset-btn"
            onClick={resetAllKpis}
            disabled={!kpiState?.overrides?.length || saveStatus === 'saving'}
            title="Reset all manually edited goals to imported or calculated values"
          >
            Reset KPIs
          </button>
          {hasOverrides && (
            <button className="wb-reset-btn" onClick={() => saveZoneOperation('reset_all')} disabled={zoneSaveStatus === 'saving'}>
              Reset zones
            </button>
          )}
          <button
            className={`wb-customize-btn${editingKpis ? ' active' : ''}`}
            onClick={() => setEditingKpis(e => !e)}
            title="Customize KPI rows"
          >
            <Settings2 style={{ width: 14, height: 14, marginRight: 6, verticalAlign: 'text-bottom' }} />
            KPIs
          </button>
          <button
            className={`wb-customize-btn wb-colors-btn${editingZoneColors ? ' active' : ''}`}
            onClick={() => setEditingZoneColors(open => !open)}
            aria-expanded={editingZoneColors}
            title="Customize zone colours"
          >
            Zone colours
          </button>
          <select
            className="wb-print-mode-select"
            value={printFitMode}
            onChange={(e) => setPrintFitMode(e.target.value)}
            title="Control how print handles long KPI sections"
          >
            <option value="balanced">Print Fit: Balanced</option>
            <option value="compact">Print Fit: Compact Rows</option>
            <option value="extra-compact">Print Fit: Fit More</option>
            <option value="hide-optional">Print Fit: Hide Optional KPI Rows</option>
          </select>
          <button className="wb-print-btn" onClick={handlePrint} title="Print workbook">
            <Printer style={{ width: 14, height: 14, marginRight: 6, verticalAlign: 'text-bottom' }} />
            Print
          </button>
        </div>
      </div>
      {printFitMode === 'hide-optional' && optionalKpiCount > 0 && (
        <div className="wb-print-fit-note">Print mode will hide {optionalKpiCount} optional KPI row{optionalKpiCount > 1 ? 's' : ''} to keep one-page output.</div>
      )}
      <div className={`wb-kpi-status${saveStatus === 'error' ? ' error' : ''}`} aria-live="polite">
        <span>{kpiState?.import
          ? `FY${kpiState.import.fiscalYear} workbook imported ${new Date(kpiState.import.importedAt).toLocaleDateString()}`
          : 'No KPI workbook data for this date'}</span>
        <span className={`wb-kpi-save-state ${saveStatus}`}>
          {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'error' ? 'Save failed' : 'Saved'}
        </span>
        {saveError && <span className="wb-kpi-save-error">{saveError} Your latest edit is shown here but may not be shared.</span>}
      </div>
      {(hasOverrides || zoneSaveStatus !== 'saved') && (
        <div className={`wb-zone-save-status${zoneSaveStatus === 'error' ? ' error' : ''}`} aria-live="polite">
          <span>Zone assignments</span>
          <span>{zoneSaveStatus === 'saving' ? 'Saving…' : zoneSaveStatus === 'error' ? 'Save failed' : 'Saved'}</span>
          {zoneSaveError && <span>{zoneSaveError} Your previous saved assignments were restored.</span>}
        </div>
      )}
      {shiftSaveStatus === 'error' && (
        <div className="wb-shift-save-error" role="alert">
          <AlertTriangle /> <span>{shiftSaveError} Check the times and try again.</span>
        </div>
      )}
      {nameSaveStatus === 'error' && (
        <div className="wb-shift-save-error" role="alert">
          <AlertTriangle /> <span>{nameSaveError} Your default name was not changed.</span>
        </div>
      )}
      {/* ── KPI editor panel ── */}
      {editingKpis && (
        <div className="wb-kpi-editor">
          <div className="wb-kpi-editor-title">Customize KPI Rows <span className="wb-kpi-editor-sub">(changes apply to all days)</span></div>
          <div className="wb-kpi-list">
            {kpiRows.map((row, i) => (
              <div key={row.id} className="wb-kpi-item">
                <span className="wb-kpi-item-label">{row.label}</span>
                <button
                  className="wb-kpi-remove-btn"
                  onClick={() => setKpiRows(prev => prev.filter((_, j) => j !== i))}
                  title="Remove row"
                >✕</button>
              </div>
            ))}
          </div>
          <div className="wb-kpi-add">
            <input
              className="wb-kpi-add-input"
              value={newKpiLabel}
              onChange={e => setNewKpiLabel(e.target.value)}
              placeholder="New KPI label…"
              onKeyDown={e => {
                if (e.key === 'Enter' && newKpiLabel.trim()) {
                  const id = 'custom_' + Date.now();
                  setKpiRows(prev => [...prev, { id, label: newKpiLabel.trim().toUpperCase(), key: id }]);
                  setNewKpiLabel('');
                }
              }}
            />
            <button
              className="wb-kpi-add-btn"
              onClick={() => {
                if (!newKpiLabel.trim()) return;
                const id = 'custom_' + Date.now();
                setKpiRows(prev => [...prev, { id, label: newKpiLabel.trim().toUpperCase(), key: id }]);
                setNewKpiLabel('');
              }}
            >+ Add</button>
            <button
              className="wb-kpi-reset-btn"
              onClick={() => setKpiRows(DEFAULT_KPI_ROWS)}
              title="Restore all default rows"
            >Reset defaults</button>
          </div>
        </div>
      )}

      {editingZoneColors && (
        <div className="wb-zone-colors-panel">
          <div className="wb-zone-colors-title">Zone colours</div>
          <div className="wb-zone-colors-controls">
            <label>
              Zone
              <select aria-label="Zone to recolour" value={colorZone} onChange={event => {
                const zone = event.target.value;
                setColorZone(zone);
                setColorValue(zoneColors[zone]);
              }}>
                {ZONE_OPTIONS.map(zone => <option key={zone} value={zone}>{zone}</option>)}
              </select>
            </label>
            <ZoneColorSwatches value={colorValue} onChange={setColorValue} options={COLOR_OPTIONS} />
            <span className="wb-zone-color-preview" style={{ backgroundColor: colorValue }} aria-hidden="true" />
            <button className="wb-zone-color-apply" disabled={zoneColors[colorZone] === colorValue} onClick={() => saveZoneColors(applyZoneColor(zoneColors, colorZone, colorValue))}>Apply</button>
            <button className="wb-zone-color-reset" onClick={() => {
              const defaults = { ...DEFAULT_ZONE_COLORS };
              saveZoneColors(defaults);
              setColorValue(defaults[colorZone]);
            }}>Reset colours</button>
          </div>
          {colorOwner && <div className="wb-zone-colors-hint">{colorOwner} will take {colorZone}'s current colour, keeping every zone distinct.</div>}
        </div>
      )}

      {/* ── Day tabs ── */}
      <div className="wb-day-tabs">
        {DAYS.map((day, i) => (
          <button
            key={day}
            className={`wb-day-tab${activeDay === day ? ' active' : ''}`}
            onClick={() => {
              if (day !== activeDay && !canLeavePromos()) return;
              if (day !== activeDay) setPromoDirty(false);
              setActiveDay(day);
            }}
          >
            <span className="wb-day-abbr">{day}</span>
            <span className="wb-day-date">{formatShortDate(weekDates[i])}</span>
          </button>
        ))}
      </div>

      {workbookView === 'old' ? (
        <div className="wb-view-old">
          <HourlySegments
            goals={goals}
            hourly={hourly}
            setHourly={setHourly}
            onHourlyCommit={commitHourly}
            segments={segments}
            kpiRows={kpiRows}
            printFitMode={printFitMode}
          />
          <div className="wb-body-layout">
            <TodaysGoals
              goals={goals}
              sources={kpiState?.sources}
              date={kpiState?.date || data?.date}
              comparisonDate={kpiState?.comparisonDate}
              onCommit={commitGoal}
            />
            {zoneSection}
          </div>
        </div>
      ) : (
        <div className="wb-view-new">
          <div className="wb-new-layout">
            <div className="wb-new-left">
              <TodaysGoals
                goals={goals}
                sources={kpiState?.sources}
                date={kpiState?.date || data?.date}
                comparisonDate={kpiState?.comparisonDate}
                onCommit={commitGoal}
              />
              <WorkbookPromos
                date={requestedDate}
                organizationId={selectedOrganizationId}
                token={token}
                onDirtyChange={setPromoDirty}
              />
            </div>
            <WorkbookAnnotations rows={data?.rows || []} section="header" />
            <WorkbookAnnotations rows={data?.rows || []} section="body" />
            <div className="wb-new-right-stack">
              <HourlySegments
                goals={goals}
                hourly={hourly}
                setHourly={setHourly}
                onHourlyCommit={commitHourly}
                segments={segments}
                kpiRows={kpiRows}
                printFitMode={printFitMode}
                newView
              />
              {zoneSection}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
