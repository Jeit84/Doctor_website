# SARIFUJJAMAN Physiotherapy & Rehabilitation Center

A full-stack Node.js + SQLite clinic website with:

- Patient registration/login
- Patient issue submission
- Date-wise ascending token generation
- Morning/evening appointment slots
- Downloadable/printable token ticket
- Real-time clock on the ticket
- Doctor login/dashboard
- Patient list sorted by date, token and booking time
- Appointment status updates
- CSV export ("single sheet" date-wise)
- Payment QR section using the supplied QR image
- Responsive mobile-first design
- Supplied doctor image in the hero/doctor section

## Run locally

1. Install Node.js 18+.
2. Open this folder in a terminal.
3. Run:

```bash
npm install
npm start
```

4. Open `http://localhost:3000`

## Demo doctor login

Username: `doctor`  
Password: `doctor123`

Change this before public deployment.

## Database

SQLite database is automatically created as `clinic.db` in the project root.

The `patients` and `appointments` tables persist names, phone numbers, issues, dates, tokens, appointment times, payment status and booking timestamps.

## Important production note

This is a working self-hosted application, not just a static mockup. For a public medical service, deploy it behind HTTPS and replace the demo doctor password with a strong secret. Add proper production authentication, backups, access control and privacy/security policies before using real patient information.
