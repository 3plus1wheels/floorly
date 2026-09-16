import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { Download, LoaderCircle, Palette, Settings } from 'lucide-react';
import Workbook from './Workbook';
import Staff from './Staff';
import AdminPanel from './AdminPanel';
import API_BASE from './config';
import FloorlyLogo from './FloorlyLogo';
import { EXTENSION_STORE_URL, getCurrentEmployeeMapping, importFromKronos, setCurrentEmployeeMapping } from './kronosExtension';
import { applyTheme, isValidHex, normalizeTheme, THEME_HEX_FIELDS, THEME_PRESETS } from './theme';
import { PRIVACY_POLICY_VERSION } from './LegalPages';
import './App.css';

const PRESET_ORDER = ['classic', 'ocean', 'forest'];

function ThemeSettingsModal({
  open,
  selectedPreset,
  customTheme,
  saving,
  onClose,
  onSelectPreset,
  onCustomChange,
  onSave,
}) {
  const customValid = useMemo(
    () => THEME_HEX_FIELDS.every((field) => isValidHex(customTheme[field])),
    [customTheme]
  );

  if (!open) return null;

  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h3>Theme Settings</h3>
          <button className="settings-close-btn" onClick={onClose}>Close</button>
        </div>

        <p className="settings-help">Pick one of the most popular schemes, or enter custom hex colors.</p>

        <div className="theme-preset-grid">
          {PRESET_ORDER.map((key) => {
            const preset = THEME_PRESETS[key];
            const active = selectedPreset === key;
            return (
              <button
                key={key}
                className={`theme-preset-card${active ? ' active' : ''}`}
                onClick={() => onSelectPreset(key)}
              >
                <span className="theme-preset-name">{preset.label}</span>
                <span className="theme-swatch-row">
                  <span style={{ background: preset.colors.color_primary }} />
                  <span style={{ background: preset.colors.color_accent }} />
                  <span style={{ background: preset.colors.color_background }} />
                  <span style={{ background: preset.colors.color_text }} />
                </span>
              </button>
            );
          })}
        </div>

        <div className="theme-custom-panel">
          <div className="theme-custom-title">Custom (Hex)</div>
          <div className="theme-custom-grid">
            {THEME_HEX_FIELDS.map((field) => {
              const label = field.replace('color_', '').replace('_', ' ');
              const value = customTheme[field] || '';
              const valid = isValidHex(value);

              return (
                <label key={field} className="theme-hex-field">
                  <span>{label}</span>
                  <div className="theme-hex-input-wrap">
                    <span className="theme-hex-chip" style={{ background: valid ? value : '#ffffff' }} />
                    <input
                      value={value}
                      onChange={(e) => onCustomChange(field, e.target.value)}
                      className={valid ? '' : 'invalid'}
                      placeholder="#000000"
                    />
                  </div>
                </label>
              );
            })}
          </div>
          {!customValid && <p className="settings-error">All custom colors must be valid `#RRGGBB` values.</p>}
        </div>

        <div className="settings-actions-row">
          <button className="settings-save-btn" disabled={saving || !customValid} onClick={onSave}>
            {saving ? 'Saving...' : 'Save Theme'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EmployeeIdentityModal({ mapping, selectedEmployeeId, saving, onSelect, onCreate, onSave, onClose }) {
  if (!mapping) return null;
  return (
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div className="settings-modal employee-identity-modal" onClick={event => event.stopPropagation()}>
        <div className="settings-modal-header"><h3>Choose your employee identity</h3><button className="settings-close-btn" onClick={onClose}>Close</button></div>
        <p className="settings-help">Kronos labels your row “My Schedule.” Choose your employee once so imports from every account stay accurate. Only an administrator can change this later.</p>
        {mapping.candidates.length > 0 && <label className="employee-identity-field">
          <span>Existing employee</span>
          <select value={selectedEmployeeId} onChange={event => onSelect(event.target.value)}>
            <option value="">Select employee</option>
            {mapping.candidates.map(employee => <option key={employee.id} value={employee.id}>{employee.name}{employee.primary_job ? ` — ${employee.primary_job}` : ''}</option>)}
          </select>
        </label>}
        <div className="employee-identity-actions">
          {mapping.candidates.length > 0 && <button disabled={saving || !selectedEmployeeId} onClick={onSave}>{saving ? 'Saving...' : 'Link selected employee'}</button>}
          {mapping.can_create_from_profile && <button className="employee-create-btn" disabled={saving} onClick={onCreate}>{saving ? 'Saving...' : `Create as ${mapping.profile_full_name}`}</button>}
        </div>
      </div>
    </div>
  );
}

function ImportConsentModal({ open, checked, onCheck, onConfirm, onClose }) {
  if (!open) return null;
  return <div className="settings-modal-backdrop" role="presentation" onClick={onClose}>
    <div className="settings-modal consent-modal" role="dialog" aria-modal="true" aria-labelledby="import-consent-title" onClick={event => event.stopPropagation()}>
      <div className="settings-modal-header"><h3 id="import-consent-title">Before importing from Kronos</h3><button className="settings-close-btn" onClick={onClose}>Close</button></div>
      <p className="settings-help">Floorly will read only schedule content visible in your authorized Kronos session and send it to your selected Floorly organization.</p>
      <p className="settings-help">A successful import replaces all shifts in the selected Monday–Sunday week. Shifts outside that week stay unchanged.</p>
      <ul className="consent-list">
        <li>Collected content: employee names, displayed job roles, schedule dates, shift times, selected week, and organization ID.</li>
        <li>Not collected: Kronos usernames, passwords, passkeys, MFA codes, API keys, authentication cookies, or browsing history.</li>
        <li>Authorization: a five-minute, one-use Floorly ticket is processed in memory and is not stored by the extension.</li>
        <li>Purpose: build Floorly schedule, workbook, and floor-planning views.</li>
        <li>Retention: shifts for 12 months; employee records until organization deletion; backup copies up to 30 days.</li>
      </ul>
      <label className="consent-check"><input type="checkbox" checked={checked} onChange={event => onCheck(event.target.checked)} /><span>I understand and consent to this import under the <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a> (version {PRIVACY_POLICY_VERSION}).</span></label>
      <div className="settings-actions-row"><button className="settings-save-btn" disabled={!checked} onClick={onConfirm}>Continue to import</button></div>
    </div>
  </div>;
}

function Dashboard() {
  const [activeTab, setActiveTab] = useState('workbook');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState('classic');
  const [customTheme, setCustomTheme] = useState({ ...THEME_PRESETS.classic.colors });
  const [savingTheme, setSavingTheme] = useState(false);
  const [themeMessage, setThemeMessage] = useState('');
  const [kronosBusy, setKronosBusy] = useState(false);
  const [kronosState, setKronosState] = useState('idle');
  const [kronosMessage, setKronosMessage] = useState('');
  const [showExtensionLink, setShowExtensionLink] = useState(false);
  const [employeeMapping, setEmployeeMapping] = useState(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [savingEmployeeMapping, setSavingEmployeeMapping] = useState(false);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [workbookVersion, setWorkbookVersion] = useState(0);
  const [selectedWeekStart, setSelectedWeekStart] = useState('');
  const { user, logout, selectedOrganizationId, selectOrganization, refreshUser } = useAuth();

  useEffect(() => {
    const pref = normalizeTheme(user?.theme_preference);
    setSelectedPreset(pref.preset || 'classic');
    setCustomTheme({
      color_primary: pref.color_primary,
      color_accent: pref.color_accent,
      color_background: pref.color_background,
      color_surface: pref.color_surface,
      color_card: pref.color_card,
      color_text: pref.color_text,
      color_muted: pref.color_muted,
    });
    applyTheme(pref);
  }, [user]);

  const runKronosImport = async () => {
    setKronosBusy(true);
    try {
      await importFromKronos({
        organizationId: selectedOrganizationId,
        weekStart: selectedWeekStart,
        accessToken: localStorage.getItem('access_token'),
        consent: true,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        onState: setKronosState,
      });
      setWorkbookVersion(value => value + 1);
      setKronosState('complete');
      setKronosMessage(`Kronos schedule replaced for week ${selectedWeekStart}.`);
    } catch (error) {
      setKronosState(error.code === 'KRONOS_TAB_OPENED' ? 'opening' : 'failed');
      setShowExtensionLink(['EXTENSION_MISSING', 'EXTENSION_NOT_CONFIGURED'].includes(error.code));
      setKronosMessage(error.message || 'Kronos import failed.');
    } finally {
      setKronosBusy(false);
    }
  };

  const handleKronosImportWithConsent = async () => {
    setKronosBusy(true);
    setKronosState('checking');
    setKronosMessage('');
    setShowExtensionLink(false);
    try {
      const mapping = await getCurrentEmployeeMapping({
        organizationId: selectedOrganizationId,
        accessToken: localStorage.getItem('access_token'),
      });
      if (mapping.linked_employee) {
        await runKronosImport();
        return;
      }
      setEmployeeMapping(mapping);
      setSelectedEmployeeId('');
      setKronosState('idle');
    } catch (error) {
      setKronosState('failed');
      setKronosMessage(error.message || 'Could not verify employee identity.');
    } finally {
      setKronosBusy(false);
    }
  };

  const handleKronosImport = () => {
    const consentKey = `floorly-import-consent:${selectedOrganizationId}:${PRIVACY_POLICY_VERSION}`;
    if (selectedOrganizationId && localStorage.getItem(consentKey) !== 'accepted') {
      setConsentChecked(false);
      setConsentOpen(true);
      return;
    }
    handleKronosImportWithConsent();
  };

  const acceptImportConsent = () => {
    const consentKey = `floorly-import-consent:${selectedOrganizationId}:${PRIVACY_POLICY_VERSION}`;
    localStorage.setItem(consentKey, 'accepted');
    setConsentOpen(false);
    handleKronosImportWithConsent();
  };

  const saveEmployeeMapping = async createFromProfile => {
    setSavingEmployeeMapping(true);
    setKronosMessage('');
    try {
      await setCurrentEmployeeMapping({
        organizationId: selectedOrganizationId,
        accessToken: localStorage.getItem('access_token'),
        employeeId: selectedEmployeeId,
        createFromProfile,
      });
      setEmployeeMapping(null);
      await runKronosImport();
    } catch (error) {
      setKronosState('failed');
      setKronosMessage(error.message || 'Could not save employee identity.');
    } finally {
      setSavingEmployeeMapping(false);
    }
  };

  const switchOrganization = (id) => {
    selectOrganization(id);
    setSelectedWeekStart('');
    setWorkbookVersion(value => value + 1);
    setKronosState('idle');
    setKronosMessage('');
    setShowExtensionLink(false);
    setEmployeeMapping(null);
  };

  const applyPreset = (presetKey) => {
    const preset = THEME_PRESETS[presetKey];
    if (!preset) return;
    setSelectedPreset(presetKey);
    setCustomTheme({ ...preset.colors });
    applyTheme({ preset: presetKey, ...preset.colors });
  };

  const handleCustomChange = (field, value) => {
    const next = { ...customTheme, [field]: value };
    setSelectedPreset('custom');
    setCustomTheme(next);
    const canPreview = THEME_HEX_FIELDS.every((name) => isValidHex(next[name]));
    if (canPreview) {
      applyTheme({ preset: 'custom', ...next });
    }
  };

  const saveTheme = async () => {
    const token = localStorage.getItem('access_token');
    if (!token) return;

    const payload = {
      preset: selectedPreset,
      ...customTheme,
    };

    setSavingTheme(true);
    setThemeMessage('');

    try {
      const res = await fetch(`${API_BASE}/api/auth/theme/`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error('Failed to save theme.');
      }

      const saved = await res.json();
      applyTheme(saved);
      setThemeMessage('Theme saved to your account.');
      setTimeout(() => setThemeMessage(''), 2500);
      setSettingsOpen(false);
    } catch (err) {
      setThemeMessage(err.message || 'Unable to save theme.');
    } finally {
      setSavingTheme(false);
    }
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-top">
          <div className="header-brand">
            <FloorlyLogo size="md" color="var(--color-primary)" className="header-logo" />
            <p className="header-subtitle">Daily retail floor execution dashboard</p>
          </div>
          <div className="user-info">
            <select className="organization-switcher" value={selectedOrganizationId} onChange={event => switchOrganization(event.target.value)}>
              {(user?.organizations || []).map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
            <div className="kronos-controls">
              <button className="kronos-import-btn" onClick={handleKronosImport} disabled={activeTab !== 'workbook' || !selectedOrganizationId || !selectedWeekStart || kronosBusy}>
                {kronosBusy ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
                {kronosBusy ? (kronosState === 'checking' ? 'Checking extension...' : 'Scraping & uploading...') : 'Import from Kronos'}
              </button>
              {kronosState !== 'idle' && <span className={`kronos-status kronos-status-${kronosState}`}>{kronosState}</span>}
            </div>
            <button className="settings-btn" onClick={() => setSettingsOpen(true)}>
              <Settings size={14} />
              Settings
            </button>
            <span className="user-greeting">{user?.full_name || user?.username}</span>
            <button className="logout-btn" onClick={logout}>Logout</button>
          </div>
        </div>
        {themeMessage && (
          <div className="theme-message">
            <Palette size={14} />
            {themeMessage}
          </div>
        )}
        {kronosMessage && <div className="kronos-message">{kronosMessage}{showExtensionLink && EXTENSION_STORE_URL && <> <a href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">Install extension</a>.</>}</div>}

        <nav className="nav-tabs">
          <button
            className={`nav-tab${activeTab === 'workbook' ? ' active' : ''}`}
            onClick={() => setActiveTab('workbook')}
          >
            Workbook
          </button>
          <button
            className={`nav-tab${activeTab === 'staff' ? ' active' : ''}`}
            onClick={() => setActiveTab('staff')}
          >
            Staff
          </button>
          {user?.is_admin && <button className={`nav-tab${activeTab === 'admin' ? ' active' : ''}`} onClick={() => setActiveTab('admin')}>Admin</button>}
        </nav>
      </header>

      <main className="tab-content">
        {!selectedOrganizationId && activeTab !== 'admin' && <div className="state-card inline"><div><p className="state-title">No organization access</p><p className="state-copy">Ask an administrator to add you to an active organization.</p></div></div>}
        {selectedOrganizationId && activeTab === 'workbook' && <Workbook key={selectedOrganizationId} refreshVersion={workbookVersion} onWeekChange={setSelectedWeekStart} />}
        {selectedOrganizationId && activeTab === 'staff' && <Staff key={selectedOrganizationId} />}
        {activeTab === 'admin' && user?.is_admin && <AdminPanel onOrganizationsChanged={refreshUser} />}
      </main>

      <ThemeSettingsModal
        open={settingsOpen}
        selectedPreset={selectedPreset}
        customTheme={customTheme}
        saving={savingTheme}
        onClose={() => setSettingsOpen(false)}
        onSelectPreset={applyPreset}
        onCustomChange={handleCustomChange}
        onSave={saveTheme}
      />
      <EmployeeIdentityModal
        mapping={employeeMapping}
        selectedEmployeeId={selectedEmployeeId}
        saving={savingEmployeeMapping}
        onSelect={setSelectedEmployeeId}
        onSave={() => saveEmployeeMapping(false)}
        onCreate={() => saveEmployeeMapping(true)}
        onClose={() => setEmployeeMapping(null)}
      />
      <ImportConsentModal
        open={consentOpen}
        checked={consentChecked}
        onCheck={setConsentChecked}
        onConfirm={acceptImportConsent}
        onClose={() => setConsentOpen(false)}
      />
    </div>
  );
}

export default Dashboard;
