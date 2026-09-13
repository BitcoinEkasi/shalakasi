// public/admin.js
let adminKey = sessionStorage.getItem('shalakasi_admin_key');
let curriculumCache = null;
let currentDetailStudentId = null;

function adminHeaders() {
  return { 'x-admin-key': adminKey, 'Content-Type': 'application/json' };
}

// ---------- GATE ----------
document.getElementById('gate-submit').addEventListener('click', doGateCheck);
document.getElementById('gate-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') doGateCheck(); });

async function doGateCheck() {
  const key = document.getElementById('gate-key').value.trim();
  const errEl = document.getElementById('gate-error');
  errEl.textContent = '';
  if (!key) { errEl.textContent = 'Enter the admin key.'; return; }

  adminKey = key;
  const res = await fetch('/api/admin/students', { headers: adminHeaders() });
  if (!res.ok) {
    errEl.textContent = 'Incorrect admin key.';
    adminKey = null;
    return;
  }
  sessionStorage.setItem('shalakasi_admin_key', key);
  enterAdmin();
}

document.getElementById('gate-logout').addEventListener('click', () => {
  sessionStorage.removeItem('shalakasi_admin_key');
  adminKey = null;
  document.getElementById('admin-app').classList.remove('active');
  document.getElementById('gate-screen').style.display = 'flex';
  document.getElementById('gate-key').value = '';
});

function enterAdmin() {
  document.getElementById('gate-screen').style.display = 'none';
  document.getElementById('admin-app').classList.add('active');
  loadStudents();
}

// ---------- PAGE TABS (Students / Register) ----------
document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.admin-page').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('page-' + tab.dataset.page).classList.add('active');
    if (tab.dataset.page === 'register') loadRegister();
    if (tab.dataset.page === 'impact') loadImpact();
  });
});

// ---------- ADD STUDENT ----------
document.getElementById('add-student-btn').addEventListener('click', async () => {
  const full_name = document.getElementById('new-fullname').value.trim();
  const username = document.getElementById('new-username').value.trim();
  const password = document.getElementById('new-password').value.trim();
  const cohort = document.getElementById('new-cohort').value.trim();
  const statusEl = document.getElementById('add-status');
  statusEl.className = 'add-status';
  statusEl.textContent = '';

  if (!full_name || !username || !password) {
    statusEl.className = 'add-status err';
    statusEl.textContent = 'Full name, username, and password are required.';
    return;
  }

  const res = await fetch('/api/admin/students', {
    method: 'POST', headers: adminHeaders(),
    body: JSON.stringify({ full_name, username, password, cohort }),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.className = 'add-status err';
    statusEl.textContent = data.error || 'Could not create student.';
    return;
  }

  statusEl.className = 'add-status ok';
  statusEl.textContent = `Created login for ${data.full_name} (${data.username}).`;
  document.getElementById('new-fullname').value = '';
  document.getElementById('new-username').value = '';
  document.getElementById('new-password').value = '';
  document.getElementById('new-cohort').value = '';
  loadStudents();
});

// ---------- STUDENT LIST ----------
async function loadStudents() {
  const res = await fetch('/api/admin/students', { headers: adminHeaders() });
  const students = await res.json();
  const tbody = document.getElementById('student-rows');

  if (!students.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-note">No students yet — add one above.</td></tr>`;
    return;
  }

  tbody.innerHTML = students.map((s) => `
    <tr class="row-clickable" data-id="${s.id}" data-name="${escapeHtml(s.full_name)}" data-username="${escapeHtml(s.username)}">
      <td>${escapeHtml(s.full_name)}</td>
      <td><span class="pill">${escapeHtml(s.username)}</span></td>
      <td>${escapeHtml(s.cohort || '—')}</td>
      <td><span class="pill ${s.active ? 'active' : ''}">${s.active ? 'active' : 'inactive'}</span></td>
      <td>${new Date(s.created_at).toLocaleDateString()}</td>
    </tr>`).join('');

  document.querySelectorAll('.row-clickable').forEach((row) => {
    row.addEventListener('click', () => openDetail(row.dataset.id, row.dataset.name, row.dataset.username));
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// ---------- REGISTER ----------
const dateInput = document.getElementById('register-date');
dateInput.valueAsDate = new Date();
dateInput.addEventListener('change', () => loadRegister());
document.getElementById('register-today-btn').addEventListener('click', () => {
  dateInput.valueAsDate = new Date();
  loadRegister();
});

async function loadRegister() {
  const date = dateInput.value;
  const tbody = document.getElementById('register-rows');
  tbody.innerHTML = `<tr><td colspan="5" class="empty-note">Loading…</td></tr>`;

  const res = await fetch(`/api/admin/attendance?date=${date}`, { headers: adminHeaders() });
  const data = await res.json();

  if (!data.present || !data.present.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-note">Nobody logged in on ${date}.</td></tr>`;
  } else {
    tbody.innerHTML = data.present.map((r) => `
      <tr>
        <td>${escapeHtml(r.students?.full_name || '—')}</td>
        <td><span class="pill">${escapeHtml(r.students?.username || '—')}</span></td>
        <td>${new Date(r.first_login_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${new Date(r.last_login_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
        <td>${r.login_count}</td>
      </tr>`).join('');
  }

  const summaryRes = await fetch('/api/admin/attendance/summary', { headers: adminHeaders() });
  const summary = await summaryRes.json();
  const summaryBody = document.getElementById('summary-rows');
  summaryBody.innerHTML = summary.length
    ? summary.map((s) => `
        <tr>
          <td>${escapeHtml(s.full_name || '—')}</td>
          <td><span class="pill">${escapeHtml(s.username || '—')}</span></td>
          <td>${s.days_present}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" class="empty-note">No attendance recorded yet.</td></tr>`;
}

// ---------- IMPACT ----------
async function loadImpact() {
  const res = await fetch('/api/admin/impact', { headers: adminHeaders() });
  const data = await res.json();

  const cards = document.querySelectorAll('#impact-cards .stat-card .stat-value');
  cards[0].textContent = data.total_students;
  cards[1].textContent = data.avg_completion_percent + '%';
  cards[2].textContent = data.total_checkpoint_attempts.toLocaleString();
  cards[3].textContent = data.total_chat_messages.toLocaleString();

  const funnelEl = document.getElementById('funnel-chart');
  funnelEl.innerHTML = data.chapter_funnel.map((ch) => `
    <div class="funnel-row">
      <div class="funnel-label">Ch ${ch.number} · ${escapeHtml(ch.title)}</div>
      <div class="funnel-bar-track">
        <div class="funnel-bar-fill" style="width:${ch.avg_percent}%"></div>
      </div>
      <div class="funnel-percent">${ch.avg_percent}%</div>
    </div>`).join('');

  const toughestBody = document.getElementById('toughest-rows');
  toughestBody.innerHTML = data.toughest_sections.length
    ? data.toughest_sections.map((t) => `
        <tr>
          <td><span class="pill">${escapeHtml(t.section_number)}</span> ${escapeHtml(t.section_title)}</td>
          <td>${escapeHtml(t.question)}</td>
          <td><span class="pill ${t.correct_rate < 50 ? '' : 'active'}">${t.correct_rate}%</span></td>
          <td>${t.attempts}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" class="empty-note">Not enough checkpoint attempts yet to identify patterns.</td></tr>`;
}

// ---------- DETAIL PANEL ----------
document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('overlay').addEventListener('click', closeDetail);
document.querySelectorAll('.detail-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.detail-tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.detail-section').forEach((s) => s.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('section-' + tab.dataset.tab).classList.add('active');
  });
});

document.getElementById('detail-reset-password').addEventListener('click', async () => {
  const newPassword = prompt('New password for this student (min 8 characters):');
  if (!newPassword) return;
  if (newPassword.length < 8) { alert('Password must be at least 8 characters.'); return; }

  const res = await fetch(`/api/admin/students/${currentDetailStudentId}/password`, {
    method: 'PATCH', headers: adminHeaders(),
    body: JSON.stringify({ password: newPassword }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Could not reset password.'); return; }
  alert('Password updated.');
});

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('active');
  document.getElementById('overlay').classList.remove('active');
}

async function openDetail(studentId, fullName, username) {
  currentDetailStudentId = studentId;
  document.getElementById('detail-name').textContent = fullName;
  document.getElementById('detail-meta').textContent = `@${username}`;
  document.getElementById('detail-panel').classList.add('active');
  document.getElementById('overlay').classList.add('active');

  document.getElementById('section-mastery').innerHTML = `<p class="empty-note">Loading…</p>`;
  document.getElementById('section-decisions').innerHTML = `<p class="empty-note">Loading…</p>`;
  document.getElementById('section-chat').innerHTML = `<p class="empty-note">Loading…</p>`;
  document.getElementById('section-enrolment').innerHTML = `<p class="empty-note">Loading…</p>`;

  if (!curriculumCache) {
    const cRes = await fetch('/api/admin/curriculum', { headers: adminHeaders() });
    curriculumCache = await cRes.json();
  }

  const [progressRes, decisionsRes, chatRes, enrolmentRes] = await Promise.all([
    fetch(`/api/admin/students/${studentId}/progress`, { headers: adminHeaders() }),
    fetch(`/api/admin/students/${studentId}/decisions`, { headers: adminHeaders() }),
    fetch(`/api/admin/students/${studentId}/chat`, { headers: adminHeaders() }),
    fetch(`/api/admin/students/${studentId}/enrolment`, { headers: adminHeaders() }),
  ]);
  const progress = await progressRes.json();
  const decisions = await decisionsRes.json();
  const chat = await chatRes.json();
  const enrolment = await enrolmentRes.json();

  renderMastery(progress);
  renderDecisions(decisions);
  renderChat(chat);
  renderEnrolment(enrolment);
}

function renderMastery(progress) {
  const bySection = Object.fromEntries(progress.map((p) => [p.section_id, p]));
  const el = document.getElementById('section-mastery');

  el.innerHTML = curriculumCache.chapters.map((ch) => `
    <div class="chapter-card">
      <div class="chapter-card-head">
        <h4>Ch ${ch.number} · ${escapeHtml(ch.title)}</h4>
        <span>${ch.sections.filter((s) => bySection[s.id]?.status === 'mastered').length}/${ch.sections.length}</span>
      </div>
      <div class="chip-row">
        ${ch.sections.map((s) => {
          const status = bySection[s.id]?.status || 'locked';
          return `<div class="chip ${status}" title="${s.number} ${escapeHtml(s.title)} — ${status}">${s.number.split('.').pop()}</div>`;
        }).join('')}
      </div>
    </div>`).join('');
}

function renderDecisions(decisions) {
  const el = document.getElementById('section-decisions');
  if (!decisions.length) {
    el.innerHTML = `<p class="empty-note">No adaptive routing decisions yet — this student hasn't completed a checkpoint.</p>`;
    return;
  }
  el.innerHTML = decisions.map((d) => `
    <div class="decision-item">
      <span class="dtype ${d.decision_type}">${d.decision_type}</span>
      <div class="reasoning">${escapeHtml(d.reasoning)}</div>
      <div class="from-to">${d.from ? `${d.from.number} ${d.from.title}` : '—'} → ${d.to ? `${d.to.number} ${d.to.title}` : '—'} · ${new Date(d.created_at).toLocaleString()}</div>
    </div>`).join('');
}

function renderChat(chat) {
  const el = document.getElementById('section-chat');
  if (!chat.length) {
    el.innerHTML = `<p class="empty-note">No chat messages yet.</p>`;
    return;
  }
  el.innerHTML = chat.map((c) => `
    <div class="chat-item ${c.role}">
      <div class="who">${c.role}${c.sections ? `<span class="section-tag">${c.sections.number} ${escapeHtml(c.sections.title)}</span>` : ''}</div>
      <div class="body">${escapeHtml(c.message)}</div>
    </div>`).join('');
}

// Sets up drawing on a signature canvas — mouse and touch both work,
// since this may be used on a touchscreen workstation or tablet during
// in-person enrolment. Loads an existing saved signature image if one
// was already captured for this student.
function setupSignaturePad(canvasId, clearBtnId, existingImage) {
  const canvas = document.getElementById(canvasId);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1D2128';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#F2F0EB';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (existingImage) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = existingImage;
  }

  let drawing = false;
  let last = null;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return {
      x: (point.clientX - rect.left) * (canvas.width / rect.width),
      y: (point.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function start(e) {
    e.preventDefault();
    drawing = true;
    last = pos(e);
  }
  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  }
  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  document.getElementById(clearBtnId).addEventListener('click', () => {
    ctx.fillStyle = '#1D2128';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  });
}

// A freshly-cleared canvas is just the solid background fill — compare
// against a blank reference to know whether to save null instead of
// submitting an "empty" signature image.
function isCanvasBlank(canvas) {
  const ctx = canvas.getContext('2d');
  const blank = document.createElement('canvas');
  blank.width = canvas.width; blank.height = canvas.height;
  const blankCtx = blank.getContext('2d');
  blankCtx.fillStyle = '#1D2128';
  blankCtx.fillRect(0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data.toString()
    === blankCtx.getImageData(0, 0, canvas.width, canvas.height).data.toString();
}

function renderEnrolment(existing) {
  const el = document.getElementById('section-enrolment');
  const v = existing || {};

  el.innerHTML = `
    <div class="enrolment-doc">
      <h3>Bitcoin Ekasi Enrolment Agreement</h3>
      <p class="enrolment-doc-sub">Liability Waiver, Assumption of Risk, Indemnity, Media Release and Personal Information Consent — Bitcoin Diploma &amp; Postgraduate Programme</p>

      <h4>Part A — Release of Liability, Waiver of Claims, Assumption of Risk and Indemnity</h4>
      <p>I acknowledge that BITCOIN EKASI (136-987 NPO), its trustees, coordinators, employees, agents and representatives are not responsible for any injury, illness, death, loss or damage of any nature whatsoever sustained arising from participation in the Bitcoin Diploma Programme, the Postgraduate Programme, and all related activities, except to the extent that such loss or damage is caused by gross negligence, recklessness, or wilful misconduct.</p>
      <p>Risks include: travel to/from the centre, transport, use of classroom facilities/computers/devices, digital asset risks (sending, receiving, or holding Bitcoin and Lightning transactions, price volatility, irreversible transactions, and the participant's own responsibility for wallet and key security), and general activity risks such as falls or minor injury.</p>
      <p>I voluntarily accept and assume all such risks. I waive any claims against BITCOIN EKASI arising from participation, release BITCOIN EKASI from liability (except where caused by gross negligence, recklessness, or wilful misconduct), and indemnify BITCOIN EKASI against claims from third parties arising from the participant's participation.</p>
      <p>The programme is offered subject to available funding, sponsorship, equipment, and venue conditions, and may be postponed, altered, or discontinued at BITCOIN EKASI's discretion. Enrolment is not guaranteed. BITCOIN EKASI may expel a participant for breach of its code of conduct or this agreement, or for persistent unexplained absence (for minors, school education is encouraged first). Any sats, rewards, or incentives earned (including attendance-linked Lightning payouts) are provided at BITCOIN EKASI's sole discretion, create no entitlement to future rewards, and may be forfeited if the participant withdraws or is expelled.</p>

      <h4>Part B — Condition of Participation, Media Release and Personal Information (POPIA)</h4>
      <p><b>Acceptance of Part B is a condition of enrolment</b> — as a free, voluntary, non-compulsory programme, BITCOIN EKASI requires consent to photograph, film, or record participants for promotional, social media, fundraising, and educational purposes. This is not separable from participation. Withdrawing this consent later means withdrawing from the programme (does not affect material already published).</p>
      <p>Under POPIA section 35(1)(a), consent is given for BITCOIN EKASI to collect and process personal information including names/contact details, emergency/safety information, photographs/video, identity documentation (where required), and Lightning wallet/address details (for attendance-linked reward payouts), for programme administration, safety, communication, reward payouts, and media use. Information will only be accessed by authorised persons and won't be sold or shared for unrelated commercial purposes, though it may be disclosed where required by law or in an emergency.</p>
      <p>The signer has the right to request access to, correction of, or deletion of personal information held, subject to BITCOIN EKASI's right to retain records where required by law or to establish/exercise/defend a legal claim. Governed by the laws of the Republic of South Africa. Responsible party: BITCOIN EKASI (136-987 NPO), hermann@bitcoinekasi.com.</p>
    </div>

    <div class="enrolment-form">
      <h4>Signer details</h4>
      <p class="page-sub" style="margin-bottom:14px;">Signing as the participant (18+) or as parent/legal guardian of a minor participant.</p>
      <div class="add-grid" style="grid-template-columns:1fr 1fr;">
        <div class="field"><label>Full name (signer)</label><input type="text" id="enr-signer-name" value="${escapeHtml(v.signer_full_name)}"></div>
        <div class="field"><label>ID number (signer)</label><input type="text" id="enr-signer-id" value="${escapeHtml(v.signer_id_number)}"></div>
        <div class="field"><label>Contact number (signer)</label><input type="text" id="enr-signer-contact" value="${escapeHtml(v.signer_contact_number)}"></div>
        <div class="field"><label>Participant's full name (if different)</label><input type="text" id="enr-participant-name" value="${escapeHtml(v.participant_full_name)}"></div>
        <div class="field"><label>Participant's date of birth (if minor)</label><input type="date" id="enr-participant-dob" value="${v.participant_dob || ''}"></div>
      </div>

      <div class="enrolment-sign-block">
        <label class="enrolment-checkbox"><input type="checkbox" id="enr-part-a-accepted" ${v.part_a_accepted ? 'checked' : ''}> I have read, understood, and accept the terms of <b>Part A</b> (liability waiver, indemnity, assumption of risk).</label>
        <div class="field"><label>Printed name — Part A</label><input type="text" id="enr-sig-a" value="${escapeHtml(v.part_a_signature)}"></div>
        <label class="sig-pad-label">Signature — Part A</label>
        <div class="sig-pad-wrap">
          <canvas class="sig-pad" id="enr-canvas-a" width="460" height="140"></canvas>
          <button type="button" class="sig-clear-btn" id="enr-clear-a">Clear</button>
        </div>
        <div class="field" style="margin-top:10px;"><label>Date — Part A</label><input type="date" id="enr-date-a" value="${v.part_a_date || ''}"></div>
      </div>

      <div class="enrolment-sign-block">
        <label class="enrolment-checkbox"><input type="checkbox" id="enr-part-b-accepted" ${v.part_b_accepted ? 'checked' : ''}> I have read, understood, and accept the terms of <b>Part B</b> (media release and POPIA personal information consent) as a condition of enrolment.</label>
        <div class="field"><label>Printed name — Part B</label><input type="text" id="enr-sig-b" value="${escapeHtml(v.part_b_signature)}"></div>
        <label class="sig-pad-label">Signature — Part B</label>
        <div class="sig-pad-wrap">
          <canvas class="sig-pad" id="enr-canvas-b" width="460" height="140"></canvas>
          <button type="button" class="sig-clear-btn" id="enr-clear-b">Clear</button>
        </div>
        <div class="field" style="margin-top:10px;"><label>Date — Part B</label><input type="date" id="enr-date-b" value="${v.part_b_date || ''}"></div>
      </div>

      <button class="add-btn" id="enr-save-btn" style="margin-top:16px;">Save enrolment agreement</button>
      <div class="add-status" id="enr-status"></div>
      ${v.updated_at ? `<p class="enrolment-saved-note">Last saved: ${new Date(v.updated_at).toLocaleString()}</p>` : ''}
    </div>
  `;

  setupSignaturePad('enr-canvas-a', 'enr-clear-a', v.part_a_signature_image);
  setupSignaturePad('enr-canvas-b', 'enr-clear-b', v.part_b_signature_image);

  document.getElementById('enr-save-btn').addEventListener('click', saveEnrolment);
}

async function saveEnrolment() {
  const statusEl = document.getElementById('enr-status');
  statusEl.className = 'add-status';
  statusEl.textContent = '';

  const canvasA = document.getElementById('enr-canvas-a');
  const canvasB = document.getElementById('enr-canvas-b');

  const payload = {
    signer_full_name: document.getElementById('enr-signer-name').value.trim(),
    signer_id_number: document.getElementById('enr-signer-id').value.trim(),
    signer_contact_number: document.getElementById('enr-signer-contact').value.trim(),
    participant_full_name: document.getElementById('enr-participant-name').value.trim(),
    participant_dob: document.getElementById('enr-participant-dob').value,
    part_a_accepted: document.getElementById('enr-part-a-accepted').checked,
    part_a_signature: document.getElementById('enr-sig-a').value.trim(),
    part_a_signature_image: isCanvasBlank(canvasA) ? null : canvasA.toDataURL('image/png'),
    part_a_date: document.getElementById('enr-date-a').value,
    part_b_accepted: document.getElementById('enr-part-b-accepted').checked,
    part_b_signature: document.getElementById('enr-sig-b').value.trim(),
    part_b_signature_image: isCanvasBlank(canvasB) ? null : canvasB.toDataURL('image/png'),
    part_b_date: document.getElementById('enr-date-b').value,
  };

  if (!payload.signer_full_name || !payload.signer_id_number || !payload.signer_contact_number) {
    statusEl.className = 'add-status err';
    statusEl.textContent = 'Signer full name, ID number, and contact number are required.';
    return;
  }

  const res = await fetch(`/api/admin/students/${currentDetailStudentId}/enrolment`, {
    method: 'POST', headers: adminHeaders(), body: JSON.stringify(payload),
  });
  const data = await res.json();

  if (!res.ok) {
    statusEl.className = 'add-status err';
    statusEl.textContent = data.error || 'Could not save enrolment agreement.';
    return;
  }

  statusEl.className = 'add-status ok';
  statusEl.textContent = 'Enrolment agreement saved.';
  renderEnrolment(data);
}

// ---------- BOOT ----------
if (adminKey) {
  fetch('/api/admin/students', { headers: adminHeaders() }).then((res) => {
    if (res.ok) enterAdmin();
    else sessionStorage.removeItem('shalakasi_admin_key');
  });
}
