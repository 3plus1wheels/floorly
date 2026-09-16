import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Building2, Check, ChevronDown, FileSpreadsheet, KeyRound, LoaderCircle, Pencil, Plus, Search, ShieldCheck, Trash2, Upload, Users, X } from 'lucide-react';
import API_BASE from './config';
import { useAuth } from './AuthContext';
import './AdminPanel.css';

const ZONES = [
  ['mens', 'Mens'], ['womens', 'Womens'], ['cash', 'Cash'],
  ['fits', 'Fits'], ['greet', 'Greet'], ['boh', 'BOH'],
];
const LEVELS = ['No experience', 'Training', 'Good', 'Expert'];
const ROLES = [
  { value: '', label: 'Automatic' },
  { value: 'associate', label: 'Associate' },
  { value: 'management', label: 'Management' },
  { value: 'non_active', label: 'Non-active' },
];
const emptyUser = { full_name: '', username: '', email: '', temporary_password: '' };
const orgId = value => value == null ? '' : String(value);

function ErrorMessage({ children }) {
  if (!children) return null;
  return <div className="admin-error" role="alert"><AlertTriangle size={17} />{children}</div>;
}

function latestImportFrom(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data?.latest || data?.latest_import || data?.batch || data?.imports?.[0] || data?.results?.[0] || data || null;
}

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function importWarnings(batch) {
  const warnings = batch?.warnings;
  if (!Array.isArray(warnings)) return [];
  return warnings.map(warning => typeof warning === 'string' ? warning : warning?.message || warning?.detail || JSON.stringify(warning));
}

export default function AdminPanel({ onOrganizationsChanged }) {
  const { user: currentUser } = useAuth();
  const token = localStorage.getItem('access_token');
  const [organizations, setOrganizations] = useState([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('admin_organization_id') || '');
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [newOrganization, setNewOrganization] = useState('');
  const [newUser, setNewUser] = useState(emptyUser);
  const [editEmployee, setEditEmployee] = useState(null);
  const [employeeToRemove, setEmployeeToRemove] = useState(null);
  const [editAccount, setEditAccount] = useState(null);
  const [resetAccount, setResetAccount] = useState(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [rename, setRename] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [currentKpiFile, setCurrentKpiFile] = useState(null);
  const [priorKpiFile, setPriorKpiFile] = useState(null);
  const [kpiImport, setKpiImport] = useState(null);
  const [kpiImportLoading, setKpiImportLoading] = useState(false);
  const [kpiImportError, setKpiImportError] = useState('');
  const [kpiUploading, setKpiUploading] = useState(false);
  const [kpiFileInputKey, setKpiFileInputKey] = useState(0);

  const request = useCallback(async (path, options = {}) => {
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...(!isFormData ? { 'Content-Type': 'application/json' } : {}), Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data && (data.detail || data.error || Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(' ') : value}`).join(' '));
      throw new Error(detail || `Request failed (${response.status})`);
    }
    return data;
  }, [token]);

  const selectedOrganization = organizations.find(org => orgId(org.id) === selectedId) || null;

  useEffect(() => {
    if (!selectedId) { setKpiImport(null); setKpiImportError(''); return undefined; }
    let active = true;
    setKpiImportLoading(true);
    setKpiImportError('');
    request(`/api/admin/organizations/${encodeURIComponent(selectedId)}/kpi-imports/`)
      .then(data => { if (active) setKpiImport(latestImportFrom(data)); })
      .catch(err => { if (active) setKpiImportError(err.message); })
      .finally(() => { if (active) setKpiImportLoading(false); });
    return () => { active = false; };
  }, [request, selectedId]);

  const loadOrganizations = useCallback(async (preferredId = '') => {
    const rows = await request('/api/admin/organizations/');
    setOrganizations(rows);
    const persistedId = preferredId || localStorage.getItem('admin_organization_id');
    const valid = rows.find(org => orgId(org.id) === orgId(persistedId)) || rows[0] || null;
    const nextId = valid ? orgId(valid.id) : '';
    setSelectedId(nextId);
    if (nextId) localStorage.setItem('admin_organization_id', nextId);
    else localStorage.removeItem('admin_organization_id');
    setRename(valid?.name || '');
    return { rows, selected: valid };
  }, [request]);

  const load = useCallback(async (preferredId = '') => {
    setBusy(true); setError('');
    try {
      const { selected } = await loadOrganizations(preferredId);
      if (!selected) { setUsers([]); setEmployees([]); return; }
      const [userRows, employeeRows] = await Promise.all([
        request(`/api/admin/users/?organization_id=${encodeURIComponent(selected.id)}`),
        selected.is_active
          ? request('/api/schedule/staff/', { headers: { 'X-Organization-ID': orgId(selected.id) } })
          : Promise.resolve([]),
      ]);
      setUsers(Array.isArray(userRows) ? userRows : []);
      setEmployees(Array.isArray(employeeRows) ? employeeRows : []);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }, [loadOrganizations, request]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (selectedId) localStorage.setItem('admin_organization_id', selectedId); }, [selectedId]);

  const selectOrganization = async event => {
    const id = event.target.value;
    setSelectedId(id);
    setCurrentKpiFile(null); setPriorKpiFile(null); setKpiFileInputKey(value => value + 1);
    localStorage.setItem('admin_organization_id', id);
    setSearch(''); setNotice(''); setError('');
    const org = organizations.find(item => orgId(item.id) === id);
    setRename(org?.name || '');
    if (org) await load(id);
  };

  const refreshSelected = async () => { await load(selectedId); };

  const uploadKpiWorkbooks = async event => {
    event.preventDefault();
    if (!selectedOrganization || !currentKpiFile || !priorKpiFile) return;
    setKpiUploading(true); setKpiImportError(''); setError(''); setNotice('');
    try {
      const body = new FormData();
      body.append('current_year_file', currentKpiFile);
      body.append('prior_year_file', priorKpiFile);
      const result = await request(`/api/admin/organizations/${encodeURIComponent(selectedOrganization.id)}/kpi-imports/`, { method: 'POST', body });
      setKpiImport(latestImportFrom(result));
      setCurrentKpiFile(null); setPriorKpiFile(null); setKpiFileInputKey(value => value + 1);
      await request(`/api/admin/organizations/${encodeURIComponent(selectedOrganization.id)}/kpi-imports/`)
        .then(data => setKpiImport(latestImportFrom(data)));
      setNotice('KPI workbooks imported. Workbook goals now use the refreshed data.');
    } catch (err) { setKpiImportError(err.message); }
    finally { setKpiUploading(false); }
  };

  const createOrganization = async event => {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      const created = await request('/api/admin/organizations/', { method: 'POST', body: JSON.stringify({ name: newOrganization.trim() }) });
      setNewOrganization('');
      await load(orgId(created?.id));
      await onOrganizationsChanged?.();
      setNotice(`${created?.name || 'Organization'} created and selected.`);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const saveOrganization = async event => {
    event.preventDefault();
    if (!selectedOrganization) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/api/admin/organizations/${selectedOrganization.id}/`, { method: 'PATCH', body: JSON.stringify({ name: rename.trim() }) });
      await load(selectedId); await onOrganizationsChanged?.(); setNotice('Organization name updated.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const toggleOrganizationStatus = async () => {
    if (!selectedOrganization) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/api/admin/organizations/${selectedOrganization.id}/`, { method: 'PATCH', body: JSON.stringify({ is_active: !selectedOrganization.is_active }) });
      await load(selectedId); await onOrganizationsChanged?.();
      setNotice(selectedOrganization.is_active ? 'Organization deactivated.' : 'Organization reactivated.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const createUser = async event => {
    event.preventDefault();
    if (!selectedOrganization) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request('/api/admin/users/', {
        method: 'POST', body: JSON.stringify({ ...newUser, organization_ids: [selectedOrganization.id] }),
      });
      setNewUser(emptyUser); await refreshSelected(); setNotice('Access account created for this organization.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const saveUser = async event => {
    event.preventDefault();
    if (!editAccount) return;
    setSaving(true); setError('');
    try {
      await request(`/api/admin/users/${editAccount.id}/`, { method: 'PATCH', body: JSON.stringify({
        full_name: editAccount.full_name.trim(), username: editAccount.username.trim(), email: editAccount.email.trim(),
      }) });
      setEditAccount(null); await refreshSelected(); setNotice('Account profile updated.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const updateUser = async (user, changes, success) => {
    setSaving(true); setError(''); setNotice('');
    try { await request(`/api/admin/users/${user.id}/`, { method: 'PATCH', body: JSON.stringify(changes) }); await refreshSelected(); setNotice(success); }
    catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const linkEmployee = async (user, employeeId) => {
    if (!selectedOrganization) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/api/admin/organizations/${selectedOrganization.id}/members/${user.id}/`, {
        method: 'PATCH', body: JSON.stringify({ employee_id: employeeId ? Number(employeeId) : null }),
      });
      await refreshSelected(); setNotice('Employee link updated.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const updateEmployee = async (employee, changes) => {
    if (!selectedOrganization) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const updated = await request(`/api/schedule/staff/${employee.employee_id}/`, {
        method: 'PATCH', headers: { 'X-Organization-ID': orgId(selectedOrganization.id) }, body: JSON.stringify(changes),
      });
      setEmployees(current => current.map(row => row.employee_id === employee.employee_id ? { ...row, ...updated } : row));
      setEditEmployee(null); setNotice(`${employee.name} updated.`);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const removeEmployee = async () => {
    if (!selectedOrganization || !employeeToRemove) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/api/schedule/staff/${employeeToRemove.employee_id}/`, {
        method: 'DELETE', headers: { 'X-Organization-ID': orgId(selectedOrganization.id) },
      });
      const removedName = employeeToRemove.name;
      setEmployeeToRemove(null);
      await refreshSelected();
      setNotice(`${removedName} removed from this organization.`);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const resetPassword = async event => {
    event.preventDefault();
    if (!resetAccount || !temporaryPassword) return;
    setSaving(true); setError('');
    try {
      await request(`/api/admin/users/${resetAccount.id}/reset-password/`, { method: 'POST', body: JSON.stringify({ temporary_password: temporaryPassword }) });
      setResetAccount(null); setTemporaryPassword(''); await refreshSelected(); setNotice('Temporary password set. The account holder will be asked to change it.');
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const linkedEmployeeIds = useMemo(() => new Set(users.flatMap(user =>
    (user.organizations || []).filter(org => orgId(org.id) === selectedId && org.employee_id).map(org => org.employee_id))), [users, selectedId]);
  const team = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter(employee => [employee.name, employee.workbook_name, employee.default_workbook_name, employee.primary_job, employee.employee_id]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [employees, search]);
  const accountRows = useMemo(() => users.filter(user => (user.organizations || []).some(org => orgId(org.id) === selectedId)), [users, selectedId]);
  const editedEmployeeAccount = useMemo(() => {
    if (!editEmployee) return null;
    return users.find(user => (user.organizations || []).some(
      org => orgId(org.id) === selectedId && org.employee_id === editEmployee.employee_id
    )) || null;
  }, [editEmployee, selectedId, users]);

  return <div className="admin-panel">
    <header className="admin-heading">
      <div><p className="admin-eyebrow">Workspace settings</p><h2>Admin Control Panel</h2><p>Manage the selected organization’s team and account access.</p></div>
      {busy && <LoaderCircle className="admin-spinner" aria-label="Loading" />}
    </header>

    <div className="admin-org-picker">
      <label htmlFor="admin-organization"><Building2 size={17} /> Organization</label>
      <select id="admin-organization" value={selectedId} onChange={selectOrganization} disabled={!organizations.length}>
        {!organizations.length && <option value="">No organizations available</option>}
        {organizations.map(org => <option key={org.id} value={orgId(org.id)}>{org.name}{org.is_active ? '' : ' · Inactive'}</option>)}
      </select>
      {selectedOrganization && <span className={`admin-status ${selectedOrganization.is_active ? 'active' : 'inactive'}`}><i />{selectedOrganization.is_active ? 'Active' : 'Inactive'}</span>}
    </div>

    <ErrorMessage>{error}</ErrorMessage>
    {notice && <div className="admin-notice" role="status"><Check size={16} />{notice}<button type="button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={15} /></button></div>}

    {!selectedOrganization ? <section className="admin-empty"><Building2 /><h3>No organization yet</h3><p>Create an organization below to begin managing a team.</p></section> : <>
      <section className="admin-section admin-kpi-import-section">
        <div className="admin-section-heading"><div><span className="admin-kicker">Workbook data</span><h3><FileSpreadsheet size={19} /> KPI workbook import</h3><p>Upload both fiscal-year workbooks for {selectedOrganization.name}.</p></div></div>
        <p className="admin-kpi-replacement-note">A valid import replaces this organization’s normalized KPI data for both years. Original workbook files are not retained; filenames and import audit metadata remain. Saved daily overrides stay in place.</p>
        <form className="admin-kpi-upload-form" onSubmit={uploadKpiWorkbooks}>
          <label>Current fiscal year workbook (.xlsx)<input key={`current-${kpiFileInputKey}`} aria-label="Current fiscal year workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => setCurrentKpiFile(event.target.files?.[0] || null)} /></label>
          <label>Prior fiscal year workbook (.xlsx)<input key={`prior-${kpiFileInputKey}`} aria-label="Prior fiscal year workbook" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={event => setPriorKpiFile(event.target.files?.[0] || null)} /></label>
          <button type="submit" className="admin-primary-button" disabled={kpiUploading || !currentKpiFile || !priorKpiFile}><Upload size={15} />{kpiUploading ? 'Uploading workbooks…' : 'Upload both workbooks'}</button>
        </form>
        {kpiUploading && <div className="admin-kpi-progress" role="status"><LoaderCircle className="admin-spinner" /> Uploading and validating both workbooks…<span /></div>}
        {kpiImportError && <div className="admin-kpi-import-error" role="alert"><AlertTriangle size={16} />{kpiImportError}</div>}
        <div className="admin-kpi-latest" aria-live="polite">
          <div className="admin-kpi-latest-heading"><strong>Latest import</strong>{kpiImportLoading && <LoaderCircle className="admin-spinner" aria-label="Loading latest import" />}</div>
          {!kpiImportLoading && !kpiImport && !kpiImportError && <p>No KPI workbooks have been imported for this organization.</p>}
          {kpiImport && <>
            <div className="admin-kpi-import-meta">
              <span className={`admin-kpi-status ${String(kpiImport.status || 'complete').toLowerCase()}`}>{String(kpiImport.status || 'Complete').replaceAll('_', ' ')}</span>
              {(kpiImport.current_fiscal_year || kpiImport.current_year || kpiImport.detected_current_fy) && <span>Current FY {kpiImport.current_fiscal_year || kpiImport.current_year || kpiImport.detected_current_fy}</span>}
              {(kpiImport.prior_fiscal_year || kpiImport.prior_year || kpiImport.detected_prior_fy) && <span>Prior FY {kpiImport.prior_fiscal_year || kpiImport.prior_year || kpiImport.detected_prior_fy}</span>}
              {(kpiImport.imported_at || kpiImport.created_at || kpiImport.uploaded_at || kpiImport.timestamp) && <span>{displayDate(kpiImport.imported_at || kpiImport.created_at || kpiImport.uploaded_at || kpiImport.timestamp)}</span>}
              {(kpiImport.current_filename || kpiImport.prior_filename) && <span>{kpiImport.current_filename || 'Current workbook'} + {kpiImport.prior_filename || 'prior workbook'}</span>}
              {kpiImport.imported_by && <span>Uploaded by {typeof kpiImport.imported_by === 'object' ? (kpiImport.imported_by.full_name || kpiImport.imported_by.username || kpiImport.imported_by.id) : kpiImport.imported_by}</span>}
              {(kpiImport.daily_records_imported ?? kpiImport.daily_records) != null && <span>{kpiImport.daily_records_imported ?? kpiImport.daily_records} daily rows</span>}
              {(kpiImport.period_records_imported ?? kpiImport.period_records) != null && <span>{kpiImport.period_records_imported ?? kpiImport.period_records} period rows</span>}
              {kpiImport.counts && Object.entries(kpiImport.counts).map(([label, count]) => <span key={label}>{count} {label.replaceAll('_', ' ')}</span>)}
            </div>
            {importWarnings(kpiImport).length > 0 && <div className="admin-kpi-warnings"><strong><AlertTriangle size={14} /> Import warnings</strong><ul>{importWarnings(kpiImport).map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul></div>}
          </>}
        </div>
      </section>
      <section className="admin-section admin-team-section">
        <div className="admin-section-heading"><div><span className="admin-kicker">People</span><h3><Users size={19} /> Team</h3><p>Roster records imported from the schedule workbook.</p></div><span className="admin-count">{team.length}<small> / {employees.length} staff</small></span></div>
        {!selectedOrganization.is_active ? <div className="admin-inline-state"><AlertTriangle size={18} /><div><strong>Team editing is paused</strong><span>Reactivate this organization to load and edit its staff roster.</span></div></div> : <>
          <label className="admin-search"><Search size={17} /><input type="search" placeholder="Search name, workbook, or job" value={search} onChange={event => setSearch(event.target.value)} /></label>
          {busy && !employees.length ? <div className="admin-loading"><LoaderCircle className="admin-spinner" /> Loading team…</div> : team.length ? <div className="admin-team-list">
            {team.map(employee => <article className="admin-employee" key={employee.employee_id}>
              <div className="admin-employee-person"><span className="admin-avatar">{(employee.name || '?').trim().slice(0, 1).toUpperCase()}</span><div><strong>{employee.name}</strong><span>{employee.workbook_name || employee.default_workbook_name || 'Workbook name not set'}</span><span className="admin-employee-job">{employee.primary_job || 'No job title'}</span></div></div>
              <div className="admin-skill-summary">{ZONES.map(([zone, label]) => <span key={zone} title={`${label}: ${LEVELS[employee[zone] ?? 0]}`} className={`skill-dot level-${employee[zone] ?? 0}`}><i />{label}</span>)}</div>
              <div className="admin-employee-meta"><span className={`admin-role-pill${employee.role_override === 'non_active' ? ' muted' : ''}`}>{employee.role_override ? ROLES.find(role => role.value === employee.role_override)?.label : 'Auto role'}</span>
                {linkedEmployeeIds.has(employee.employee_id) && <span className="admin-linked"><ShieldCheck size={14} /> Account linked</span>}
              </div>
              <div className="admin-employee-actions">
                <button type="button" className="admin-icon-button" aria-label={`Edit ${employee.name}`} onClick={() => setEditEmployee({ ...employee })}><Pencil size={16} /></button>
                <button type="button" className="admin-icon-button admin-remove-employee-button" aria-label={`Remove ${employee.name}`} onClick={() => setEmployeeToRemove(employee)}><Trash2 size={16} /></button>
              </div>
            </article>)}
          </div> : <div className="admin-inline-state"><Users size={18} /><div><strong>{search ? 'No matching staff' : 'No staff records yet'}</strong><span>{search ? 'Try a different name, workbook, or job.' : 'Import a schedule to populate this organization’s team.'}</span></div></div>}
        </>}
      </section>

      <details className="admin-section admin-access-section">
        <summary><div><span className="admin-kicker">Sign-in and permissions</span><h3><ShieldCheck size={19} /> Access Accounts</h3><p>Manage login accounts connected to {selectedOrganization.name}.</p></div><span className="admin-count">{accountRows.length}<small> accounts</small></span><ChevronDown className="admin-disclosure" size={19} /></summary>
        <div className="admin-access-content">
          <form className="admin-create-account" onSubmit={createUser}>
            <div className="admin-subheading"><div><h4>Create an access account</h4><p>New accounts are added to {selectedOrganization.name}.</p></div></div>
            <div className="admin-form-grid">
              <label>Full name<input required autoComplete="name" value={newUser.full_name} onChange={event => setNewUser({ ...newUser, full_name: event.target.value })} /></label>
              <label>Username<input required autoComplete="username" value={newUser.username} onChange={event => setNewUser({ ...newUser, username: event.target.value })} /></label>
              <label>Email <span className="admin-optional">Optional</span><input type="email" autoComplete="email" value={newUser.email} onChange={event => setNewUser({ ...newUser, email: event.target.value })} /></label>
              <label>Temporary password<input required type="password" autoComplete="new-password" value={newUser.temporary_password} onChange={event => setNewUser({ ...newUser, temporary_password: event.target.value })} /></label>
            </div>
            <button type="submit" className="admin-primary-button" disabled={saving}><Plus size={16} /> Create account</button>
          </form>
          <div className="admin-accounts-heading"><div><h4>Accounts for this organization</h4><p>Link each login to one roster record when appropriate.</p></div></div>
          {accountRows.length ? <div className="admin-account-list">{accountRows.map(user => {
            const membership = (user.organizations || []).find(org => orgId(org.id) === selectedId);
            const choices = employees.filter(employee => !linkedEmployeeIds.has(employee.employee_id) || employee.employee_id === membership?.employee_id);
            return <article className={`admin-account${user.is_active ? '' : ' inactive'}`} key={user.id}>
              <div className="admin-account-person"><span className="admin-avatar account">{(user.full_name || user.username || '?').slice(0, 1).toUpperCase()}</span><div><strong>{user.full_name}</strong><span>@{user.username}{user.is_admin ? ' · platform admin' : ''}{user.must_change_password ? ' · password change required' : ''}</span></div></div>
              <label className="admin-account-link"><span>Linked employee</span><select aria-label={`Linked employee for ${user.username}`} value={membership?.employee_id || ''} disabled={saving || !selectedOrganization.is_active} onChange={event => linkEmployee(user, event.target.value)}><option value="">No employee linked</option>{choices.map(employee => <option key={employee.employee_id} value={employee.employee_id}>{employee.name}{employee.primary_job ? ` · ${employee.primary_job}` : ''}</option>)}</select></label>
              <div className="admin-account-actions"><button type="button" onClick={() => setEditAccount({ id: user.id, full_name: user.full_name || '', username: user.username || '', email: user.email || '' })}><Pencil size={15} /> Edit</button><button type="button" onClick={() => { setResetAccount(user); setTemporaryPassword(''); }}><KeyRound size={15} /> Password</button><button type="button" disabled={saving || user.id === currentUser?.id} title={user.id === currentUser?.id ? 'You cannot deactivate your own account.' : ''} onClick={() => updateUser(user, { is_active: !user.is_active }, user.is_active ? 'Account deactivated.' : 'Account reactivated.')}>{user.is_active ? 'Deactivate' : 'Reactivate'}</button></div>
            </article>;
          })}</div> : <div className="admin-inline-state"><Users size={18} /><div><strong>No access accounts yet</strong><span>Create an account above to provide sign-in access.</span></div></div>}
        </div>
      </details>
    </>}

    <section className="admin-section admin-org-management">
      <div className="admin-section-heading"><div><span className="admin-kicker">Organization settings</span><h3><Building2 size={19} /> Organization management</h3><p>Rename, change status, or create an organization.</p></div></div>
      {selectedOrganization && <div className="admin-org-actions">
        <form onSubmit={saveOrganization}><label htmlFor="admin-org-name">Selected organization name</label><div className="admin-inline-form"><input id="admin-org-name" required value={rename} onChange={event => setRename(event.target.value)} /><button type="submit" disabled={saving || rename.trim() === selectedOrganization.name}><Check size={15} /> Save name</button></div></form>
        <div className="admin-status-control"><span>{selectedOrganization.is_active ? 'This organization is active.' : 'This organization is inactive.'}</span><button type="button" className={selectedOrganization.is_active ? 'admin-danger-button' : 'admin-primary-button'} disabled={saving} onClick={toggleOrganizationStatus}>{selectedOrganization.is_active ? 'Deactivate organization' : 'Reactivate organization'}</button></div>
      </div>}
      <form className="admin-new-org" onSubmit={createOrganization}><label htmlFor="admin-new-org">Create a separate organization</label><div className="admin-inline-form"><input id="admin-new-org" required placeholder="Organization name" value={newOrganization} onChange={event => setNewOrganization(event.target.value)} /><button className="admin-primary-button" type="submit" disabled={saving}><Plus size={16} /> Create organization</button></div></form>
    </section>

    {employeeToRemove && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) setEmployeeToRemove(null); }}><section className="admin-modal small" role="alertdialog" aria-modal="true" aria-labelledby="remove-employee-title" aria-describedby="remove-employee-description"><div className="admin-modal-heading"><div><span className="admin-kicker">Remove team member</span><h3 id="remove-employee-title">Remove {employeeToRemove.name}?</h3></div><button type="button" className="admin-icon-button" aria-label="Close" onClick={() => setEmployeeToRemove(null)} disabled={saving}><X size={18} /></button></div>
      <p className="admin-help" id="remove-employee-description">This permanently removes the employee, their scheduled shifts and zone skills from {selectedOrganization.name}. Any linked login will be unlinked.</p>
      <div className="admin-modal-actions"><button type="button" onClick={() => setEmployeeToRemove(null)} disabled={saving}>Cancel</button><button type="button" className="admin-danger-button" onClick={removeEmployee} disabled={saving}>{saving ? 'Removing…' : 'Remove employee'}</button></div>
    </section></div>}

    {editEmployee && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditEmployee(null); }}><section className="admin-modal" role="dialog" aria-modal="true" aria-labelledby="employee-dialog-title"><div className="admin-modal-heading"><div><span className="admin-kicker">Team profile</span><h3 id="employee-dialog-title">Edit {editEmployee.name}</h3></div><button type="button" className="admin-icon-button" aria-label="Close" onClick={() => setEditEmployee(null)}><X size={18} /></button></div>
      <form onSubmit={event => { event.preventDefault(); const changes = { workbook_name: editEmployee.workbook_name || '', role_override: editEmployee.role_override || '', ...Object.fromEntries(ZONES.map(([zone]) => [zone, Number(editEmployee[zone] ?? 0)])) }; updateEmployee(editEmployee, changes); }}>
        <div className="admin-linked-account-detail"><ShieldCheck size={16} /><div><span>Linked login account</span><strong>{editedEmployeeAccount ? `${editedEmployeeAccount.full_name} (@${editedEmployeeAccount.username})` : 'No account linked'}</strong><small>Change this link in Access Accounts.</small></div></div>
        <label className="admin-modal-field">Workbook name<input maxLength={64} value={editEmployee.workbook_name || ''} placeholder={editEmployee.default_workbook_name || ''} onChange={event => setEditEmployee({ ...editEmployee, workbook_name: event.target.value })} /><span className="admin-help">Default: {editEmployee.default_workbook_name || 'not available'}. Leave blank to use the default.</span></label>
        <label className="admin-modal-field">Role override<select value={editEmployee.role_override || ''} onChange={event => setEditEmployee({ ...editEmployee, role_override: event.target.value })}>{ROLES.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
        <fieldset className="admin-zone-fieldset"><legend>Zone skills</legend><div className="admin-zone-grid">{ZONES.map(([zone, label]) => <label key={zone}>{label}<select value={editEmployee[zone] ?? 0} onChange={event => setEditEmployee({ ...editEmployee, [zone]: Number(event.target.value) })}>{LEVELS.map((level, index) => <option key={level} value={index}>{level}</option>)}</select></label>)}</div></fieldset>
        <div className="admin-modal-actions"><button type="button" onClick={() => setEditEmployee(null)}>Cancel</button><button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save team member'}</button></div>
      </form></section></div>}

    {editAccount && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setEditAccount(null); }}><section className="admin-modal small" role="dialog" aria-modal="true" aria-labelledby="account-dialog-title"><div className="admin-modal-heading"><div><span className="admin-kicker">Access account</span><h3 id="account-dialog-title">Edit profile</h3></div><button type="button" className="admin-icon-button" aria-label="Close" onClick={() => setEditAccount(null)}><X size={18} /></button></div>
      <form onSubmit={saveUser} className="admin-modal-stack"><label>Full name<input required value={editAccount.full_name} onChange={event => setEditAccount({ ...editAccount, full_name: event.target.value })} /></label><label>Username<input required value={editAccount.username} onChange={event => setEditAccount({ ...editAccount, username: event.target.value })} /></label><label>Email<input type="email" value={editAccount.email} onChange={event => setEditAccount({ ...editAccount, email: event.target.value })} /></label><div className="admin-modal-actions"><button type="button" onClick={() => setEditAccount(null)}>Cancel</button><button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></div></form></section></div>}

    {resetAccount && <div className="admin-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setResetAccount(null); }}><section className="admin-modal small" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title"><div className="admin-modal-heading"><div><span className="admin-kicker">@{resetAccount.username}</span><h3 id="password-dialog-title">Set a temporary password</h3></div><button type="button" className="admin-icon-button" aria-label="Close" onClick={() => setResetAccount(null)}><X size={18} /></button></div><form onSubmit={resetPassword} className="admin-modal-stack"><label>Temporary password<input autoFocus required type="password" autoComplete="new-password" value={temporaryPassword} onChange={event => setTemporaryPassword(event.target.value)} /></label><p className="admin-help">The account holder will be prompted to choose a new password at their next sign-in.</p><div className="admin-modal-actions"><button type="button" onClick={() => setResetAccount(null)}>Cancel</button><button type="submit" className="admin-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Set password'}</button></div></form></section></div>}
  </div>;
}
