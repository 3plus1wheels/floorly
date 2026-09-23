import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Save, Trash2, Undo2 } from 'lucide-react';
import API_BASE from './config';
import './WorkbookPromos.css';

const MAX_ROWS = 32;

function promoEndpoint(date) {
  return `${API_BASE}/api/schedule/workbook-promos/${date}/`;
}

function sameRows(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function WorkbookPromos({ date, organizationId, token, onDirtyChange }) {
  const [rows, setRows] = useState([]);
  const [savedRows, setSavedRows] = useState([]);
  const [hasOverride, setHasOverride] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const scopeRef = useRef('');
  scopeRef.current = `${date || ''}:${organizationId || ''}:${token || ''}`;
  const dirty = useMemo(() => !sameRows(rows, savedRows), [rows, savedRows]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!date || !organizationId || !token) {
      setRows([]);
      setSavedRows([]);
      setHasOverride(false);
      setLoading(false);
      setError('Select an organization to load promo and notes rows.');
      return;
    }
    setLoading(true);
    setSaving(false);
    setError('');
    setNotice('');
    setRows([]);
    setSavedRows([]);
    setHasOverride(false);
    try {
      const response = await fetch(promoEndpoint(date), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': String(organizationId),
        },
      });
      if (!response.ok) throw new Error('Could not load promo and notes rows.');
      const payload = await response.json();
      if (requestId.current !== id) return;
      const nextRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(nextRows);
      setSavedRows(nextRows);
      setHasOverride(Boolean(payload.has_override));
    } catch (loadError) {
      if (requestId.current === id) setError(loadError.message || 'Could not load promo and notes rows.');
    } finally {
      if (requestId.current === id) setLoading(false);
    }
  }, [date, organizationId, token]);

  useEffect(() => {
    load();
    return () => { requestId.current += 1; };
  }, [load]);

  const save = async scope => {
    if (saving || loading) return;
    const requestScope = scopeRef.current;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(promoEndpoint(date), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': String(organizationId),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ scope, rows }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save promo and notes rows.');
      if (scopeRef.current !== requestScope) return;
      const effectiveRows = Array.isArray(payload.rows) ? payload.rows : rows;
      setRows(effectiveRows);
      setSavedRows(effectiveRows);
      setHasOverride(Boolean(payload.has_override));
      if (scope === 'shared' && payload.has_override) {
        setNotice('Shared rows saved. This date still uses its today-only list.');
      } else {
        setNotice(scope === 'shared' ? 'Shared rows saved for all days.' : 'Rows saved for today.');
      }
    } catch (saveError) {
      if (scopeRef.current === requestScope) setError(saveError.message || 'Could not save promo and notes rows.');
    } finally {
      if (scopeRef.current === requestScope) setSaving(false);
    }
  };

  const useShared = async () => {
    if (saving || loading || !hasOverride) return;
    const requestScope = scopeRef.current;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(promoEndpoint(date), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Organization-ID': String(organizationId),
        },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not use the shared list.');
      if (scopeRef.current !== requestScope) return;
      const effectiveRows = Array.isArray(payload.rows) ? payload.rows : [];
      setRows(effectiveRows);
      setSavedRows(effectiveRows);
      setHasOverride(false);
      setNotice('This date now uses the shared list.');
    } catch (resetError) {
      if (scopeRef.current === requestScope) setError(resetError.message || 'Could not use the shared list.');
    } finally {
      if (scopeRef.current === requestScope) setSaving(false);
    }
  };

  const updateRow = (index, value) => setRows(current => current.map((row, i) => i === index ? value : row));
  const addRow = () => setRows(current => current.length >= MAX_ROWS ? current : [...current, '']);
  const removeRow = index => setRows(current => current.filter((_, i) => i !== index));

  return (
    <section className="wb-promos" aria-label="Promos and notes">
      <div className="wb-promos__header">
        <h3>PROMOS &amp; NOTES</h3>
        <span className="wb-promos__scope">
          {hasOverride ? 'Today only' : 'Shared across days'}
        </span>
      </div>
      <div className="wb-promos__body">
        {loading ? <div className="wb-promos__message">Loading rows…</div> : (
          <>
            <div className="wb-promos__rows">
              {rows.map((row, index) => (
                <div className="wb-promos__row" key={`${index}`}>
                  <input
                    aria-label={`Promo or note ${index + 1}`}
                    maxLength={240}
                    value={row}
                    onChange={event => updateRow(index, event.target.value)}
                    placeholder="Type a promo or note"
                    disabled={saving}
                  />
                  <span className="wb-promos__print-value" aria-hidden="true">{row}</span>
                  <button type="button" onClick={() => removeRow(index)} aria-label={`Remove row ${index + 1}`} disabled={saving}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              {rows.length === 0 && <div className="wb-promos__empty">Add promo or note lines for this workbook.</div>}
            </div>
            <div className="wb-promos__actions">
              <button type="button" onClick={addRow} disabled={saving || rows.length >= MAX_ROWS}>
                <Plus size={14} /> Add row
              </button>
              <button type="button" onClick={() => save('date')} disabled={saving || !dirty}>
                <Save size={14} /> Save for today
              </button>
              <button type="button" onClick={() => save('shared')} disabled={saving || !dirty}>
                <Save size={14} /> Save for all days
              </button>
              {dirty && (
                <button type="button" onClick={() => setRows(savedRows)} disabled={saving}>
                  Discard edits
                </button>
              )}
              {hasOverride && (
                <button type="button" onClick={useShared} disabled={saving || dirty}>
                  <Undo2 size={14} /> Use shared list
                </button>
              )}
            </div>
            {dirty && <div className="wb-promos__dirty" role="status">Unsaved changes</div>}
            {notice && <div className="wb-promos__notice" role="status">{notice}</div>}
            {error && <div className="wb-promos__error" role="alert">{error} <button type="button" onClick={load}>Retry</button></div>}
            {saving && <div className="wb-promos__message" role="status">Saving…</div>}
          </>
        )}
      </div>
    </section>
  );
}
