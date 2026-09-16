import React from 'react';
import { Link } from 'react-router-dom';
import FloorlyLogo from './FloorlyLogo';
import './LegalPages.css';

export const PRIVACY_POLICY_VERSION = '2026-09-16';

function LegalShell({ title, eyebrow, children }) {
  return <div className="legal-page">
    <header className="legal-header"><Link to="/"><FloorlyLogo size="md" color="var(--color-primary)" /></Link><Link className="legal-back" to="/">Back to Floorly</Link></header>
    <main className="legal-content"><p className="legal-eyebrow">{eyebrow}</p><h1>{title}</h1>{children}</main>
    <footer className="legal-footer"><span>Floorly · Chong Vyet Nguyen</span><span><Link to="/privacy">Privacy</Link> · <Link to="/support">Support</Link></span></footer>
  </div>;
}

export function PrivacyPolicy() {
  return <LegalShell title="Privacy Policy" eyebrow={`Version ${PRIVACY_POLICY_VERSION} · Effective September 16, 2026`}>
    <p className="legal-lead">This policy covers the Floorly website and the Floorly Schedule Import Chrome extension. It explains exactly what information they handle, what they do not collect, and how imported content is protected.</p>

    <section>
      <h2>Operator and contact</h2>
      <p>Floorly is operated by <strong>Chong Vyet Nguyen</strong>, an independent developer. Send privacy, access, correction, or deletion requests to <a href="mailto:chongvyetnguyen@gmail.com">chongvyetnguyen@gmail.com</a>.</p>
    </section>

    <section>
      <h2>Extension’s single purpose</h2>
      <p>The extension’s only purpose is to copy schedule content already visible to an authorized user on the configured UKG/Kronos schedule page into that user’s selected Floorly organization for workforce planning. It does not run automatically or operate on unrelated websites.</p>
    </section>

    <section>
      <h2>Schedule content collected during an import</h2>
      <p>Only after the user starts and confirms an import, the extension reads and transmits the following visible schedule content:</p>
      <ul>
        <li>Employee names and displayed job or role information.</li>
        <li>Schedule dates, shift start times, and shift end times.</li>
        <li>The selected Floorly organization, selected week, import time, and the minimum structural information needed to match schedule rows.</li>
      </ul>
      <p>This content is used only to create employee and shift records, show schedules, and provide Floorly’s workbook and floor-planning features for the selected organization.</p>
    </section>

    <section>
      <h2>Credentials and authentication information we do not collect</h2>
      <p><strong>The extension does not read, collect, transmit, or store UKG/Kronos usernames, passwords, passkeys, security answers, MFA codes, API keys, authentication cookies, session cookies, or other Kronos authentication information.</strong> Users sign in to Kronos directly through Kronos and their organization’s normal SSO or MFA process. Floorly does not bypass or reproduce that login.</p>
      <p>The extension also does not collect general browsing history, page content outside the configured Floorly and Kronos domains, keystrokes, payment information, health information, personal communications, or advertising identifiers.</p>
    </section>

    <section>
      <h2>How Floorly authorization works</h2>
      <p>The Floorly website uses ordinary account authentication. Floorly passwords are stored only as one-way password hashes, never as readable passwords. Floorly access and refresh tokens may be kept in the user’s browser to maintain the Floorly session; the extension cannot read or store those tokens.</p>
      <p>For each confirmed import, Floorly issues the extension a separate authorization ticket. That ticket is scoped to the user and organization, expires after five minutes, works only once, remains in memory only long enough to submit the import, and is not saved by the extension. Floorly does not retain the raw ticket. It retains only the ticket’s unique identifier for up to one day to prevent replay.</p>
    </section>

    <section>
      <h2>Other information handled by the Floorly website</h2>
      <ul>
        <li>Floorly account details, profile name, role, and organization membership needed to provide account access.</li>
        <li>Consent version and acceptance time, used to prove that an import was authorized under the current disclosure.</li>
        <li>Normalized business metrics from administrator-uploaded KPI workbooks, plus source filenames, file sizes, and integrity hashes. Original workbook files are not retained after processing.</li>
        <li>Support emails and any information a user voluntarily includes in a support request.</li>
        <li>Limited server records such as request time, requested route, response status, and IP address when produced by hosting infrastructure for security and reliability.</li>
      </ul>
    </section>

    <section>
      <h2>When collection happens</h2>
      <p>Schedule collection is not continuous or automatic. It happens only when an authenticated Floorly user selects an organization and week, clicks the import control, reviews the disclosure, and actively consents. The extension then reads the schedule already displayed in that user’s authorized Kronos tab. If the selected weeks do not match, no schedule is uploaded.</p>
    </section>

    <section>
      <h2>Use, disclosure, and sale</h2>
      <p>Floorly uses imported content only to provide, maintain, secure, and improve the schedule-import and workforce-planning features described above. Floorly does not sell user data, rent it, use it for advertising, use it for credit decisions, or create profiles for unrelated purposes.</p>
      <p>Information may be processed by service providers that operate Floorly’s infrastructure, including Neon for database infrastructure and backup processing, the provider hosting the Floorly application, and Google when a user sends support email through Gmail. These providers process information only to deliver their services. Information may also be disclosed when required by law or when reasonably necessary to investigate fraud, abuse, or a security incident.</p>
      <p>Humans do not read imported schedule content except when the user gives specific consent for support, access is necessary to investigate a security incident, or access is required by law.</p>
    </section>

    <section>
      <h2>Retention</h2>
      <ul>
        <li><strong>Imported shifts:</strong> deleted after 12 months.</li>
        <li><strong>Raw one-use import tickets:</strong> not stored by the extension or Floorly.</li>
        <li><strong>Used-ticket identifiers:</strong> deleted after one day.</li>
        <li><strong>Original KPI workbook files:</strong> not retained after processing.</li>
        <li><strong>Employee directory, profile, organization, consent, KPI records, and KPI import metadata:</strong> retained while the organization uses Floorly or until deleted by an authorized administrator or through a verified deletion request.</li>
        <li><strong>Backup copies:</strong> may remain for up to 30 days before routine expiration.</li>
        <li><strong>Support correspondence:</strong> retained only as long as needed to resolve the request and maintain necessary support records.</li>
      </ul>
    </section>

    <section>
      <h2>Security controls</h2>
      <p>Schedule content is transmitted to Floorly over HTTPS. The extension is limited to the exact configured Floorly and Kronos hosts, contains all executable code in its install package, and does not download or execute remote code. Floorly rechecks user and organization membership on import, limits import size, uses five-minute one-use tickets, and separates each organization’s records. These controls are designed to prevent unauthorized collection, replay, and cross-organization access.</p>
    </section>

    <section>
      <h2>Chrome Web Store Limited Use</h2>
      <p>Floorly’s use of information received through the extension complies with the Chrome Web Store User Data Policy, including its Limited Use requirements. Extension data is used only to provide or improve the extension’s disclosed schedule-import purpose, is not transferred for advertising or data brokerage, and is not used for unrelated purposes.</p>
    </section>

    <section>
      <h2>Access, correction, and deletion</h2>
      <p>An organization administrator can correct or remove records available through Floorly’s administrative features. Users may also email <a href="mailto:chongvyetnguyen@gmail.com">chongvyetnguyen@gmail.com</a> to request access, correction, or deletion. We verify the requester’s identity and authority for the affected organization before acting.</p>
    </section>

    <section>
      <h2>Policy changes</h2>
      <p>This policy may change when Floorly’s features or data practices change. Material changes are displayed in the product. When the import disclosure changes, Floorly updates the policy version and asks users to consent again before another import.</p>
    </section>
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
