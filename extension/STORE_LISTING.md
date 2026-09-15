# Floorly Schedule Import — Chrome Web Store submission

## Listing

- **Name:** Floorly Schedule Import
- **Visibility:** Unlisted
- **Category:** Productivity
- **Website:** https://floorly.vovanguyen.com
- **Privacy policy:** https://floorly.vovanguyen.com/privacy
- **Support:** https://floorly.vovanguyen.com/support
- **Publisher:** Chong Vyet Nguyen
- **Contact:** chongvyetnguyen@gmail.com

### Single purpose

Import the work schedule already visible in an authorized UKG/Kronos session into the user's Floorly organization.

### Short description

Imports the visible UKG/Kronos location schedule into Floorly after the user confirms the selected week and privacy notice.

### Detailed description

Floorly Schedule Import connects the Floorly scheduling dashboard to a user's existing, authenticated UKG/Kronos session. When the user clicks **Import from Kronos**, the extension reads employee names, job roles, dates, and shift times from the visible location schedule, verifies that the week matches Floorly, and uploads the validated schedule to the selected Floorly organization.

The extension does not bypass login, read passwords or cookies, monitor browsing activity, run remote code, or operate automatically. It only runs against configured Floorly and Kronos origins and uses a five-minute, organization-scoped import ticket.

Floorly is not affiliated with or endorsed by UKG, Kronos, or Levi Strauss & Co. Users must have authorization to access and import the schedule.

## Privacy dashboard declarations

Declare these handled data categories:

- Personally identifiable information: employee names and job roles.
- Website content: visible schedule dates and shift times.
- Authentication information: transient five-minute Floorly import ticket; never stored by the extension.

Certify that data is used only for the disclosed scheduling purpose, is not sold, is not used for advertising or credit decisions, and is transmitted over HTTPS.

## Reviewer instructions

Enter credentials only in the Chrome Web Store **Test instructions** field. Never commit them here.

1. Install the submitted extension.
2. Open https://floorly.vovanguyen.com and sign in with the supplied reviewer account.
3. Select the supplied review organization and known test week.
4. Open the supplied non-production Kronos URL and sign in with the supplied reviewer account.
5. Open **My Location Schedule** for the same week and wait for employee rows.
6. Return to Floorly and click **Import from Kronos**.
7. Read and accept the privacy disclosure.
8. Confirm that Floorly reports a completed import and displays the seeded synthetic shifts.

Include the known test week, expected employee count, expected shift count, and a short demonstration video in the private reviewer notes.

## Assets

- Store icon: `assets/icon128.png`
- Small promotional tile: `assets/store-promo-440x280.png`
- Screenshots: capture real Floorly screens at 1280×800 using synthetic reviewer data.

## Release gates

- Obtain written authorization for the production schedule integration.
- Run full automated suite and production build.
- Verify ZIP contains no localhost/HTTP origins, secrets, source maps, or unrelated files.
- Verify privacy and support URLs work while signed out.
- Configure daily `python manage.py purge_schedule_data` execution.
- Test database backup restoration and confirm backups expire within 30 days.
