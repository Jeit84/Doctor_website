const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "clinic.db"));

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS patients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  patient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  issue TEXT NOT NULL,
  appointment_date TEXT NOT NULL,
  slot TEXT NOT NULL,
  token_number INTEGER NOT NULL,
  token_code TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'Pending',
  payment_method TEXT NOT NULL DEFAULT 'Clinic',
  status TEXT NOT NULL DEFAULT 'Waiting',
  booked_at TEXT NOT NULL,
  FOREIGN KEY(patient_id) REFERENCES patients(id),
  UNIQUE(appointment_date, token_number)
);

CREATE INDEX IF NOT EXISTS idx_appointments_date_token
ON appointments(appointment_date, token_number);
`);

const doctorHash = bcrypt.hashSync(process.env.DOCTOR_PASSWORD || "doctor123", 10);

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || "CHANGE_THIS_SESSION_SECRET",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 8
  }
}));

app.use(express.static(path.join(__dirname, "public")));

function nowISO() {
  return new Date().toISOString();
}

function istDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function cleanPhone(phone) {
  return String(phone || "").replace(/\D/g, "").slice(-10);
}

function requirePatient(req, res, next) {
  if (!req.session.patientId) return res.status(401).json({ error: "Patient login required." });
  next();
}

function requireDoctor(req, res, next) {
  if (!req.session.doctor) return res.status(401).json({ error: "Doctor login required." });
  next();
}

// Doctor authentication
app.post("/api/doctor/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");

  if (username === "doctor" && bcrypt.compareSync(password, doctorHash)) {
    req.session.doctor = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: "Invalid doctor credentials." });
});

app.post("/api/doctor/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/doctor/me", (req, res) => {
  res.json({ loggedIn: !!req.session.doctor });
});

// Patient authentication
app.post("/api/patient/register", (req, res) => {
  const name = String(req.body.name || "").trim();
  const phone = cleanPhone(req.body.phone);
  const password = String(req.body.password || "");

  if (name.length < 2) return res.status(400).json({ error: "Enter a valid name." });
  if (phone.length !== 10) return res.status(400).json({ error: "Enter a valid 10-digit mobile number." });
  if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters." });

  const exists = db.prepare("SELECT id FROM patients WHERE phone = ?").get(phone);
  if (exists) return res.status(409).json({ error: "A patient account with this mobile number already exists." });

  const result = db.prepare(`
    INSERT INTO patients (name, phone, password_hash, created_at)
    VALUES (?, ?, ?, ?)
  `).run(name, phone, bcrypt.hashSync(password, 10), nowISO());

  req.session.patientId = Number(result.lastInsertRowid);
  req.session.patientName = name;
  res.json({ ok: true, patient: { name, phone } });
});

app.post("/api/patient/login", (req, res) => {
  const phone = cleanPhone(req.body.phone);
  const password = String(req.body.password || "");
  const patient = db.prepare("SELECT * FROM patients WHERE phone = ?").get(phone);

  if (!patient || !bcrypt.compareSync(password, patient.password_hash)) {
    return res.status(401).json({ error: "Invalid mobile number or password." });
  }

  req.session.patientId = patient.id;
  req.session.patientName = patient.name;
  res.json({ ok: true, patient: { name: patient.name, phone: patient.phone } });
});

app.post("/api/patient/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/patient/me", (req, res) => {
  if (!req.session.patientId) return res.json({ loggedIn: false });
  const patient = db.prepare("SELECT id, name, phone FROM patients WHERE id = ?").get(req.session.patientId);
  res.json({ loggedIn: !!patient, patient: patient || null });
});

// Appointment booking and token generation
app.post("/api/appointments", requirePatient, (req, res) => {
  const patient = db.prepare("SELECT id, name, phone FROM patients WHERE id = ?").get(req.session.patientId);
  if (!patient) return res.status(401).json({ error: "Patient account not found." });

  const issue = String(req.body.issue || "").trim();
  const date = String(req.body.date || "").trim();
  const slot = String(req.body.slot || "").trim();
  const paymentMethod = String(req.body.paymentMethod || "Clinic").trim();

  if (issue.length < 3) return res.status(400).json({ error: "Please describe your problem." });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Choose a valid appointment date." });
  if (!["8:00 AM - 12:00 PM", "4:00 PM - 8:00 PM"].includes(slot)) {
    return res.status(400).json({ error: "Choose a valid clinic timing." });
  }
  if (!["Clinic", "Online"].includes(paymentMethod)) return res.status(400).json({ error: "Choose a valid payment option." });
  if (date < istDateString()) return res.status(400).json({ error: "Past dates cannot be booked." });

  // One active appointment per patient per date.
  const duplicate = db.prepare(`
    SELECT id FROM appointments
    WHERE patient_id = ? AND appointment_date = ?
  `).get(patient.id, date);
  if (duplicate) return res.status(409).json({ error: "You already have a booking for this date." });

  // Create the booking inside a transaction, then read the exact saved row back
  // from SQLite. This prevents a mismatch between the inserted data and the
  // object returned to the ticket screen.
  let appointmentId;
  try {
    appointmentId = db.transaction(() => {
      const max = db.prepare(`
        SELECT COALESCE(MAX(token_number), 0) AS maxToken
        FROM appointments WHERE appointment_date = ?
      `).get(date);
      const tokenNumber = Number(max.maxToken) + 1;
      const tokenCode = `T-${String(tokenNumber).padStart(3, "0")}`;
      const bookedAt = nowISO();

      const result = db.prepare(`
        INSERT INTO appointments
        (patient_id, patient_name, phone, issue, appointment_date, slot,
         token_number, token_code, payment_status, payment_method, status, booked_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Waiting', ?)
      `).run(
        patient.id, patient.name, patient.phone, issue, date, slot,
        tokenNumber, tokenCode, paymentMethod === 'Online' ? 'Pending Verification' : 'Pay at Clinic', paymentMethod, bookedAt
      );

      return Number(result.lastInsertRowid);
    })();
  } catch (err) {
    console.error("Appointment insert failed:", err);
    return res.status(500).json({ error: "Could not create the appointment. Please try again." });
  }

  // Read the saved appointment back using explicit SQL aliases.
  const book = db.prepare(`
    SELECT id, patient_name AS patientName, phone, issue,
           appointment_date AS appointmentDate, slot,
           token_number AS tokenNumber, token_code AS tokenCode,
           payment_status AS paymentStatus, payment_method AS paymentMethod, status, booked_at AS bookedAt
    FROM appointments WHERE id = ?
  `).get(appointmentId);

  if (!book || !book.tokenCode || !book.bookedAt) {
    console.error("Booking created but ticket record was incomplete:", book);
    return res.status(500).json({ error: "Appointment was created but ticket data could not be prepared. Please refresh and check My Appointments." });
  }

  res.json({ ok: true, appointment: book });
});

app.get("/api/patient/appointments", requirePatient, (req, res) => {
  const rows = db.prepare(`
    SELECT id, patient_name AS patientName, phone, issue,
           appointment_date AS appointmentDate, slot,
           token_number AS tokenNumber, token_code AS tokenCode,
           payment_status AS paymentStatus, payment_method AS paymentMethod, status, booked_at AS bookedAt
    FROM appointments
    WHERE patient_id = ?
    ORDER BY appointment_date DESC, token_number DESC
  `).all(req.session.patientId);

  res.json({ appointments: rows });
});

// Doctor dashboard
app.get("/api/doctor/appointments", requireDoctor, (req, res) => {
  const date = String(req.query.date || "").trim();
  let rows;

  if (date) {
    rows = db.prepare(`
      SELECT id, patient_name AS patientName, phone, issue,
             appointment_date AS appointmentDate, slot,
             token_number AS tokenNumber, token_code AS tokenCode,
             payment_status AS paymentStatus, payment_method AS paymentMethod, status, booked_at AS bookedAt
      FROM appointments
      WHERE appointment_date = ?
      ORDER BY token_number ASC, booked_at ASC
    `).all(date);
  } else {
    rows = db.prepare(`
      SELECT id, patient_name AS patientName, phone, issue,
             appointment_date AS appointmentDate, slot,
             token_number AS tokenNumber, token_code AS tokenCode,
             payment_status AS paymentStatus, payment_method AS paymentMethod, status, booked_at AS bookedAt
      FROM appointments
      ORDER BY appointment_date DESC, token_number ASC, booked_at ASC
    `).all();
  }

  res.json({ appointments: rows, clinicDate: istDateString() });
});

app.patch("/api/doctor/appointments/:id", requireDoctor, (req, res) => {
  const id = Number(req.params.id);
  const status = String(req.body.status || "");
  const paymentStatus = String(req.body.paymentStatus || "");

  if (!["Waiting", "In Progress", "Completed", "Cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid appointment status." });
  }
  if (!["Pending", "Paid", "Pending Verification", "Pay at Clinic"].includes(paymentStatus)) {
    return res.status(400).json({ error: "Invalid payment status." });
  }

  db.prepare(`
    UPDATE appointments
    SET status = ?, payment_status = ?
    WHERE id = ?
  `).run(status, paymentStatus, id);

  res.json({ ok: true });
});

app.get("/api/doctor/export.csv", requireDoctor, (req, res) => {
  const date = String(req.query.date || "").trim();
  const rows = date
    ? db.prepare(`
        SELECT appointment_date, token_code, token_number, patient_name,
               phone, issue, slot, payment_status, payment_method, status, booked_at
        FROM appointments
        WHERE appointment_date = ?
        ORDER BY appointment_date ASC, token_number ASC, booked_at ASC
      `).all(date)
    : db.prepare(`
        SELECT appointment_date, token_code, token_number, patient_name,
               phone, issue, slot, payment_status, payment_method, status, booked_at
        FROM appointments
        ORDER BY appointment_date ASC, token_number ASC, booked_at ASC
      `).all();

  const headers = [
    "Date", "Token", "Token Number", "Patient Name", "Mobile",
    "Issue", "Clinic Timing", "Payment Status", "Payment Method", "Status", "Booked At"
  ];

  const escape = (v) => {
    const s = String(v ?? "");
    return `"${s.replace(/"/g, '""')}"`;
  };

  const csv = [
    headers.map(escape).join(","),
    ...rows.map(r => [
      r.appointment_date, r.token_code, r.token_number, r.patient_name,
      r.phone, r.issue, r.slot, r.payment_status, r.payment_method, r.status, r.booked_at
    ].map(escape).join(","))
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="patient-sheet${date ? "-" + date : ""}.csv"`
  );
  res.send("\ufeff" + csv);
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, serverTime: nowISO(), today: istDateString() });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`SARIFUJJAMAN Physiotherapy website running on http://localhost:${PORT}`);
});
