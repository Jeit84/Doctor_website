const $ = (id) => document.getElementById(id);

function showToast(message, ok=true){
  const t=$("toast"); t.textContent=message; t.classList.add("show");
  t.style.background=ok ? "#102d4d" : "#a72e2e";
  setTimeout(()=>t.classList.remove("show"),3000);
}
function openModal(id){$(id).classList.add("show")}
function closeModal(id){$(id).classList.remove("show")}
function openLogin(mode="patient"){openModal("authModal");switchAuth(mode)}
function switchAuth(mode){
  $("patientTab").classList.toggle("active",mode==="patient");
  $("doctorTab").classList.toggle("active",mode==="doctor");
  $("patientAuth").classList.toggle("hidden",mode!=="patient");
  $("doctorAuth").classList.toggle("hidden",mode!=="doctor");
}
function patientAuthMode(mode){
  $("patientLoginForm").classList.toggle("hidden",mode!=="login");
  $("patientRegisterForm").classList.toggle("hidden",mode!=="register");
  $("pLoginBtn").classList.toggle("active",mode==="login");
  $("pRegisterBtn").classList.toggle("active",mode==="register");
}
async function api(url, options={}){
  const res=await fetch(url,{headers:{"Content-Type":"application/json",...(options.headers||{})},...options});
  let data={}; try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||"Something went wrong");
  return data;
}
async function patientLogin(e){
  e.preventDefault();
  try{
    const data=await api("/api/patient/login",{method:"POST",body:JSON.stringify({
      phone:$("loginPhone").value,password:$("loginPassword").value
    })});
    closeModal("authModal"); openPatientPortal(data.patient); showToast("Patient login successful.");
  }catch(err){showToast(err.message,false)}
}
async function patientRegister(e){
  e.preventDefault();
  try{
    const data=await api("/api/patient/register",{method:"POST",body:JSON.stringify({
      name:$("regName").value,phone:$("regPhone").value,password:$("regPassword").value
    })});
    closeModal("authModal"); openPatientPortal(data.patient); showToast("Account created successfully.");
  }catch(err){showToast(err.message,false)}
}
function openPatientPortal(patient){
  $("patientWelcome").textContent=`Hello, ${patient.name}`;
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
  $("appointmentDate").min=today;
  if(!$("appointmentDate").value) $("appointmentDate").value=today;
  openModal("patientModal"); loadPatientAppointments();
}
async function patientLogout(){
  await api("/api/patient/logout",{method:"POST"}); closeModal("patientModal"); showToast("Logged out.");
}
async function bookAppointment(e){
  e.preventDefault();
  try{
    const paymentMethod=(document.querySelector('input[name="paymentMethod"]:checked')||{}).value||"Clinic";
    const data=await api("/api/appointments",{method:"POST",body:JSON.stringify({
      date:$("appointmentDate").value,slot:$("appointmentSlot").value,issue:$("issue").value,paymentMethod
    })});
    // The current server returns { ok: true, appointment: {...} }.
    // The fallback also handles an older/cached direct appointment response.
    const appointment=data && (data.appointment || data);
    if(!appointment || !appointment.tokenCode){
      throw new Error("Booking was not returned correctly by the server. Please restart the server and refresh the page.");
    }
    $("issue").value="";
    await loadPatientAppointments();
    showTicket(appointment);
    showToast(`Token ${appointment.tokenCode} generated.`);
  }catch(err){showToast(err.message,false)}
}
function toggleBookingPayment(){
  const online=(document.querySelector('input[name="paymentMethod"]:checked')||{}).value === "Online";
  $("bookingQrWrap").classList.toggle("hidden",!online);
  $("clinicPayNote").classList.toggle("hidden",online);
}

async function loadPatientAppointments(){
  try{
    const data=await api("/api/patient/appointments");
    const box=$("patientAppointments");
    if(!data.appointments.length){box.innerHTML="<p class='privacy-note'>No tokens yet. Book your first visit.</p>";return}
    box.innerHTML=data.appointments.map(a=>`
      <div class="appointment-card">
        <div class="token">${a.tokenCode}</div>
        <div class="meta">
          <b>${escapeHtml(a.appointmentDate)}</b> · ${escapeHtml(a.slot)}<br>
          Issue: ${escapeHtml(a.issue)}<br>
          Payment: ${a.paymentMethod === "Online" ? "Online QR" : "Book at Clinic"} · ${escapeHtml(a.paymentStatus)} · Status: ${escapeHtml(a.status)}
        </div>
        <button class="btn small" onclick='showTicket(${JSON.stringify(a)})'>View / Download Ticket</button>
      </div>`).join("");
  }catch(err){/* not logged in */}
}
function showTicket(a){
  // Defensive normalization: older/cached API responses may use snake_case.
  if(!a || typeof a !== "object"){
    showToast("Ticket data is missing. Please generate the token again.",false);
    return;
  }
  a={...a,
    tokenCode:a.tokenCode ?? a.token_code ?? "",
    patientName:a.patientName ?? a.patient_name ?? "",
    phone:a.phone ?? "",
    issue:a.issue ?? "",
    appointmentDate:a.appointmentDate ?? a.appointment_date ?? "",
    slot:a.slot ?? "",
    paymentStatus:a.paymentStatus ?? a.payment_status ?? "Pending",
    paymentMethod:a.paymentMethod ?? a.payment_method ?? "Clinic",
    bookedAt:a.bookedAt ?? a.booked_at ?? new Date().toISOString()
  };
  const booked = new Date(a.bookedAt);
  if(Number.isNaN(booked.getTime())){
    a.bookedAt=new Date().toISOString();
  }
  $("ticketContent").innerHTML=`
    <div class="ticket" id="ticketPrintable">
      <div class="ticket-brand">
        <h2>SARIFUJJAMAN</h2>
        <p>Physiotherapy & Rehabilitation Center</p>
        <small>Sonapur Road, Kariali Bazar, Bhaluka Road, West Bengal, India</small>
      </div>
      <div class="ticket-token">
        <span>YOUR TOKEN NUMBER</span>
        <strong>${escapeHtml(a.tokenCode)}</strong>
        <span>FOLLOW THE QUEUE IN ASCENDING ORDER</span>
      </div>
      <div class="ticket-row"><span>Patient</span><b>${escapeHtml(a.patientName)}</b></div>
      <div class="ticket-row"><span>Mobile</span><b>${escapeHtml(a.phone)}</b></div>
      <div class="ticket-row"><span>Appointment Date</span><b>${escapeHtml(a.appointmentDate)}</b></div>
      <div class="ticket-row"><span>Clinic Timing</span><b>${escapeHtml(a.slot)}</b></div>
      <div class="ticket-row"><span>Issue</span><b>${escapeHtml(a.issue)}</b></div>
      <div class="ticket-row"><span>Consultation Fee</span><b>₹250</b></div>
      <div class="ticket-row"><span>Payment Option</span><b>${a.paymentMethod === "Online" ? "Online QR Payment" : "Book at Clinic"}</b></div>
      <div class="ticket-row"><span>Payment Status</span><b>${escapeHtml(a.paymentStatus)}</b></div>
      <div class="ticket-row"><span>Ticket Generated</span><b>${formatDateTime(booked)}</b></div>
      <div class="ticket-row"><span>Live Time</span><b id="ticketLiveTime">--</b></div>
      <p class="privacy-note">Please arrive according to your clinic timing and keep this ticket ready. Token order is date-wise and ascending.</p>
    </div>
    <div class="ticket-actions">
      <button class="btn btn-primary" onclick="printTicket()">🖨 Print / Save PDF</button>
      <button class="btn btn-green" onclick="downloadTicket()">⬇ Download Ticket</button>
      <button class="btn small" onclick="closeModal('ticketModal')">Close</button>
    </div>`;
  openModal("ticketModal"); updateTicketClock();
}
function updateTicketClock(){
  const el=$("ticketLiveTime"); if(!el)return;
  el.textContent=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"medium"}).format(new Date());
  setTimeout(updateTicketClock,1000);
}
function printTicket(){
  const content=$("ticketPrintable").outerHTML;
  const w=window.open("","_blank","width=650,height=800");
  w.document.write(`<html><head><title>SARIFUJJAMAN Token Ticket</title><style>
  body{font-family:Arial,sans-serif;padding:30px;color:#10335e}.ticket{border:2px dashed #9db1c1;border-radius:20px;padding:24px;max-width:500px;margin:auto}
  .ticket-brand{text-align:center;border-bottom:1px solid #ddd;padding-bottom:15px}.ticket-brand h2{margin:0;color:#073d80}.ticket-brand p{color:#0b8f4d;font-weight:bold}
  .ticket-token{text-align:center;background:#f0f8ff;padding:20px;border-radius:15px;margin:18px 0}.ticket-token strong{display:block;font-size:58px;color:#073d80}
  .ticket-row{display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:10px}.privacy-note{font-size:12px;color:#667}
  </style></head><body>${content}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
function downloadTicket(){
  const content=`<!doctype html><html><head><meta charset="utf-8"><title>SARIFUJJAMAN Token</title></head><body>${$("ticketPrintable").outerHTML}</body></html>`;
  const blob=new Blob([content],{type:"text/html"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`${$("ticketPrintable").querySelector(".ticket-token strong").textContent.trim()}-ticket.html`;a.click();
  URL.revokeObjectURL(a.href);
}
async function doctorLogin(e){
  e.preventDefault();
  try{
    await api("/api/doctor/login",{method:"POST",body:JSON.stringify({
      username:$("doctorUsername").value,password:$("doctorPassword").value
    })});
    closeModal("authModal");openModal("doctorModal");loadDoctorAppointments();showToast("Doctor login successful.");
  }catch(err){showToast(err.message,false)}
}
async function doctorLogout(){
  await api("/api/doctor/logout",{method:"POST"});closeModal("doctorModal");showToast("Doctor logged out.");
}
async function loadDoctorAppointments(){
  try{
    const date=$("doctorDate").value;
    const data=await api("/api/doctor/appointments"+(date?`?date=${encodeURIComponent(date)}`:""));
    renderDoctorTable(data.appointments);
  }catch(err){showToast(err.message,false)}
}
function renderDoctorTable(rows){
  const body=$("doctorTableBody");
  const total=rows.length, waiting=rows.filter(r=>r.status==="Waiting").length, paid=rows.filter(r=>r.paymentStatus==="Paid").length, completed=rows.filter(r=>r.status==="Completed").length;
  $("doctorStats").innerHTML=`
    <div class="stat"><b>${total}</b><span>Patients in view</span></div>
    <div class="stat"><b>${waiting}</b><span>Waiting</span></div>
    <div class="stat"><b>${paid}</b><span>Paid</span></div>
    <div class="stat"><b>${completed}</b><span>Completed</span></div>`;
  if(!rows.length){body.innerHTML=`<tr><td colspan="9">No patients found for this selection.</td></tr>`;return}
  body.innerHTML=rows.map(r=>`
    <tr>
      <td>${escapeHtml(r.appointmentDate)}</td>
      <td><b>${escapeHtml(r.tokenCode)}</b></td>
      <td><b>${escapeHtml(r.patientName)}</b></td>
      <td>${escapeHtml(r.phone)}</td>
      <td>${escapeHtml(r.issue)}</td>
      <td>${escapeHtml(r.slot)}</td>
      <td>${formatDateTime(new Date(r.bookedAt))}</td>
      <td>
        <select class="select-mini" onchange="updateAppointment(${r.id},null,this.value)">
          ${["Pending","Paid"].map(x=>`<option ${x===r.paymentStatus?"selected":""}>${x}</option>`).join("")}
        </select>
      </td>
      <td>
        <select class="select-mini" onchange="updateAppointment(${r.id},this.value,null)">
          ${["Waiting","In Progress","Completed","Cancelled"].map(x=>`<option ${x===r.status?"selected":""}>${x}</option>`).join("")}
        </select>
      </td>
    </tr>`).join("");
}
async function updateAppointment(id,status,paymentStatus){
  // Preserve the other value by refreshing the current row after a small lookup.
  const all=await api("/api/doctor/appointments");
  const row=all.appointments.find(x=>x.id===id);
  if(!row)return;
  await api(`/api/doctor/appointments/${id}`,{method:"PATCH",body:JSON.stringify({
    status:status||row.status,paymentStatus:paymentStatus||row.paymentStatus
  })});
  loadDoctorAppointments();
}
function downloadCSV(){
  const date=$("doctorDate").value;
  window.location.href="/api/doctor/export.csv"+(date?`?date=${encodeURIComponent(date)}`:"");
}
function updateClock(){
  $("liveClock").textContent=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",timeStyle:"medium"}).format(new Date());
}
function formatDateTime(d){
  return new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}).format(d);
}
function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
}

setInterval(updateClock,1000); updateClock();

window.addEventListener("click",(e)=>{
  if(e.target.classList.contains("modal")) e.target.classList.remove("show");
});

(async function restoreSessions(){
  try{
    const p=await api("/api/patient/me");
    if(p.loggedIn) console.log("Patient session restored");
  }catch{}
})();
