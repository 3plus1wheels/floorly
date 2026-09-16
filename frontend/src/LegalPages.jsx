import React from 'react';
import { Link } from 'react-router-dom';
import FloorlyLogo from './FloorlyLogo';
import './LegalPages.css';

export const PRIVACY_POLICY_VERSION = '2026-09-15';

function LegalShell({ title, eyebrow, children }) {
  return <div className="legal-page">
    <header className="legal-header"><Link to="/"><FloorlyLogo size="md" color="var(--color-primary)" /></Link><Link className="legal-back" to="/">Back to Floorly</Link></header>
    <main className="legal-content"><p className="legal-eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</main>
    <footer className="legal-footer"><span>Floorly · Chong Vyet Nguyen</span><span><Link to="/privacy">Privacy</Link> · <Link to="/support">Support</Link></span></footer>
  </div>;
}

export function PrivacyPolicy() {
  return <LegalShell title="Privacy Policy" eyebrow={`Version ${PRIVACY_POLICY_VERSION} · Effective September 15, 2026`}>
    <p className="legal-lead">Floorly helps authorized retail teams plan daily floor execution. This policy explains what data Floorly handles, why, and how to request deletion.</p>
    <section><h2>Operator and contact</h2><p>Floorly is operated by <strong>Chong Vyet Nguyen</strong>, an independent developer. Privacy and deletion requests: <a href="mailto:chongvyetnguyen@gmail.com">chongvyetnguyen@gmail.com</a>.</p></section>
    <section><h2>Data we handle</h2><ul><li>Account details and organization membership needed to provide Floorly.</li><li>When you choose Import from Kronos: employee names, job roles, schedule dates, shift start and end times, and organization identifier.</li><li>A short-lived, one-use authorization ticket used for one import. Tickets expire after five minutes and are not stored in raw form.</li><li>When an administrator imports KPI workbooks: normalized business metrics, source filenames, file sizes, and integrity hashes. Original workbook files are not retained.</li></ul></section>
    <section><h2>How collection works</h2><p>Import happens only after an authenticated Floorly user clicks the import control and confirms the disclosure. The browser extension reads schedule information already visible in the user’s authorized Kronos session. Floorly does not bypass login or collect unrelated browsing activity.</p></section>
    <section><h2>Use and sharing</h2><p>We use schedule data to display workbooks, staff views, and floor-planning features for the selected organization. We do not sell data or use it for advertising. Data may be processed by hosting, database, backup, and monitoring providers acting for Floorly; those providers may not use it for their own advertising.</p></section>
    <section><h2>Retention and deletion</h2><p>Shift records are deleted after 12 months. Employee directory, profile, KPI records, and KPI import metadata remain while an organization uses Floorly, unless an administrator deletes them or requests deletion. Security records identifying used import tickets expire after one day. Encrypted backups expire within 30 days. Contact us for deletion or privacy requests; we verify authority before acting.</p></section>
    <section><h2>Security and Chrome Limited Use</h2><p>Floorly uses HTTPS, scoped organization access, short-lived import tickets, and access controls. No security measure is perfect, but we limit collection to what import requires. Floorly’s use of data obtained through Chrome APIs complies with the Chrome Web Store User Data Policy, including Limited Use requirements.</p></section>
    <section><h2>Changes</h2><p>We may update this policy as Floorly changes. Material changes are shown in the product, and import consent is requested again when policy version changes.</p></section>
  </LegalShell>;
}

export function SupportPage() {
  return <LegalShell title="Support" eyebrow="Floorly help desk">
    <p className="legal-lead">Need help importing a schedule or managing your organization? Email <a href="mailto:chongvyetnguyen@gmail.com">chongvyetnguyen@gmail.com</a>.</p>
    <section><h2>Kronos import checklist</h2><ol><li>Sign into Floorly and select your organization.</li><li>Install and enable the Floorly Schedule Import extension.</li><li>Sign into your authorized Kronos account and open My Location Schedule.</li><li>Select the matching week in Floorly, then click Import from Kronos.</li></ol></section>
    <section><h2>Include in support request</h2><p>Send your Floorly username, organization name, approximate time, and error message. Do not send passwords, employee schedule exports, or Kronos screenshots containing personal information.</p></section>
    <section><h2>Privacy requests</h2><p>For access, correction, or deletion requests, email <a href="mailto:chongvyetnguyen@gmail.com">chongvyetnguyen@gmail.com</a>. We respond after confirming request authority.</p></section>
  </LegalShell>;
}
