# ResQ Instructor Portal

Instructor sign-up portal for ResQ Education, served at **instructors.resqedu.com** on Netlify. Built the same way as the ambassador portal.

- People apply through the portal (instructor/evaluator or patient application; patients can later apply to become instructors), log in with an emailed 6-digit code, upload documents, and request class slots.
- A request holds the slot right away as **Pending** (even before the account is approved). When a slot is full, later requests go on a **Waitlist** and move up on their own when a spot opens.
- Pending and waitlisted requests can be released anytime. Dropping an **Approved** slot sends a drop request that an admin approves.
- Each slot can follow enrollment (1 per 3 students, etc.). Admins change enrollment once and preview/apply the new openings for the whole course.
- A Calendar tab shows every block with filled/needed per role.
- Instructors pick their own opening emails: new-course, added-openings and short-notice alerts, and a weekly / every-2-weeks / monthly digest. Every instructor email has a "Manage email settings" link that works without logging in. Digests go out from the same daily scheduled function as reminders.
- Admins approve accounts (with a checklist of missing application items), tick which roles each person is cleared for, approve or decline slot requests, build courses, blocks and slots, set flat pay per slot, mark slots paid, and turn each email type on or off.

## Files

| Path | What it is |
|---|---|
| `public/index.html` | The page everyone sees (built from `src/`; don't edit by hand) |
| `src/index.template.html`, `src/base.css` | Page source. Run `node scripts/build-page.mjs` after editing |
| `netlify/functions/api.mjs` | Backend: one Netlify Function at `/api/<action>` |
| `netlify/functions/reminders.mjs` | Scheduled function: daily session reminders |
| `lib/core.mjs` | Portal rules: login, holds, waitlist, approvals, pay, emails |
| `lib/google.mjs` | Google Sheets (data) and Google Drive (cert uploads) through a service account |
| `lib/brevo.mjs` | Email through Brevo |
| `lib/seed.mjs` | Sheet layout and the January/June 2027 Accelerated EMT schedule |
| `public/forms/` | Blank fillable ResQ direct deposit form offered on the Application tab (rebuild with `python3 scripts/make-dd-form.py`). The W-9 links to the IRS's current blank form. |
| `demo/index.html` | Self-contained clickable demo with sample data (not used by the live site) |

## Data

Everything lives in the **01 ResQ Instructor Portal** Google Sheet (ResQ Admin › 02 Instructors › ResQ Instructor Portal). Tabs: Instructors, Certs (all uploaded documents), Applications, Roles, Courses, Sessions (class blocks), Slots (Scale = staffing rule), Requests, Settings, Agreements (wording instructors agree to). You can edit the sheet directly; don't rename the column headers. Cert cards upload to the **Instructor Cert Cards** folder next to it, one subfolder per instructor. W-9s and direct deposit forms go to the **Instructor Pay Forms (restricted)** folder, which has limited access; the portal never links to them.

## Netlify environment variables

| Name | Required | What it is |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes | Same value as the ambassador portal's (the service account key JSON) |
| `BREVO_API_KEY` | yes | Brevo API key (same as the ambassador portal is fine) |
| `ADMIN_EMAILS` | recommended | Comma-separated emails that see the admin tabs. Default: admin@resqedu.com, ryan.kelly@resqedu.com, matt.shen@resqedu.com |
| `SHEET_ID` | optional | Defaults to the 01 ResQ Instructor Portal sheet |
| `CERT_FOLDER_ID` | optional | Defaults to the Instructor Cert Cards folder |
| `PRIVATE_FOLDER_ID` | optional | Defaults to the Instructor Pay Forms (restricted) folder |
| `SENDER_EMAIL` | optional | Verified Brevo sender (default marketing@resqedu.com) |
| `REPLY_TO` | optional | Reply-to on every email (default admin@resqedu.com) |
| `SITE_URL` | optional | Link used in emails (default https://instructors.resqedu.com) |
| `SESSION_SECRET` | optional | Any long random string. Changing it logs everyone out |

## Local preview and tests

```
npm install
npm test                     # backend tests
npm run preview              # http://localhost:8888 with test data; login codes print in the terminal
node scripts/build-page.mjs  # rebuild public/index.html and demo/index.html after editing src/
```

Preview logins: admin@resqedu.com (admin), or create a new instructor account on the login page.
