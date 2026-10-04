const $ = selector => document.querySelector(selector);
let me = null;
let activePersonId = null;
let role = 'personnel';
let checkValues = { feltStress: 3, fatigue: 3, workload: 3, mood: 3, support: 3, sleepQuality: 3, recovery: 3, eventImpact: 1, physicalStrain: 3, shiftPattern: 'day' };
let toastTimer;

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({ error: 'The server returned an unreadable response.' }));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function say(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toast.classList.remove('show'), 3000); }
function showError(selector, message) { const el = $(selector); el.textContent = message; el.classList.add('show'); }
function clearError(selector) { const el = $(selector); el.textContent = ''; el.classList.remove('show'); }
function openModal(id) { $('#' + id).classList.add('show'); }
function closeModal(id) { $('#' + id).classList.remove('show'); }
function initials(name) { return name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
document.querySelectorAll('.overlay').forEach(overlay => overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(overlay.id); }));

function switchAuth(register) {
  $('#loginForm').classList.toggle('hidden', register); $('#registerForm').classList.toggle('hidden', !register);
  $('#loginTab').classList.toggle('active', !register); $('#registerTab').classList.toggle('active', register);
  $('#authTitle').textContent = register ? 'Create your private account' : 'Welcome back';
  $('#authSub').textContent = register ? 'Your check-ins remain yours to control.' : 'Sign in to your private wellbeing space.';
}
$('#loginTab').onclick = () => switchAuth(false);
$('#registerTab').onclick = () => switchAuth(true);
document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
  role = button.dataset.role;
  document.querySelectorAll('[data-role]').forEach(item => item.classList.toggle('chosen', item === button));
  $('#adminInviteField').classList.toggle('hidden', role !== 'admin');
}));

async function enter(data) {
  me = data.user;
  $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#userName').textContent = me.name; $('#avatar').textContent = initials(me.name);
  const greeting = $('#greeting');
  if (greeting) greeting.textContent = me.role === 'personnel'
    ? `Welcome back, ${me.name}. Take a moment for yourself.`
    : me.role === 'clinician' ? 'Welcome to your confidential care workspace.' : 'Welcome to the wellbeing overview.';
  $('#userRole').textContent = me.role === 'clinician' ? 'Clinician · consent-based' : me.role === 'admin' ? 'Administrator · anonymous trends' : 'Uniformed personnel · private';
  const clinician = me.role === 'clinician', admin = me.role === 'admin';
  $('#personArea').classList.toggle('hidden', clinician || admin); $('#doctorArea').classList.toggle('hidden', !clinician); $('#adminArea').classList.toggle('hidden', !admin);
  $('#personNav').classList.toggle('hidden', clinician || admin); $('#doctorNav').classList.toggle('hidden', !clinician); $('#adminNav').classList.toggle('hidden', !admin);
  if (clinician) await loadPeople(); else if (admin) await loadAdmin(); else { await loadHistory(); await loadConsents(); }
  if (data.demoConfig) say('Demo mode. Change local security settings before using personal data.');
}
$('#loginBtn').onclick = async () => {
  clearError('#loginError');
  try { await enter(await api('/api/login', { method: 'POST', body: JSON.stringify({ email: $('#loginEmail').value, password: $('#loginPassword').value }) })); }
  catch (error) { showError('#loginError', error.message); }
};
$('#registerBtn').onclick = async () => {
  clearError('#registerError');
  if (!$('#terms').checked) return showError('#registerError', 'Please read and accept the demonstration and privacy note.');
  try { await enter(await api('/api/register', { method: 'POST', body: JSON.stringify({ name: $('#regName').value, email: $('#regEmail').value, password: $('#regPassword').value, role, adminInviteCode: $('#adminInvite').value }) })); }
  catch (error) { showError('#registerError', error.message); }
};
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }).catch(() => {}); me = null; $('#app').classList.add('hidden'); $('#auth').classList.remove('hidden'); switchAuth(false); };

function makeCell(text) { const cell = document.createElement('td'); cell.textContent = text; return cell; }
async function loadHistory() {
  const { checkins } = await api('/api/checkins');
  const rows = $('#historyRows'); rows.replaceChildren(); $('#countMetric').textContent = checkins.length;
  const latest = checkins[0];
  if (latest) {
    $('#score').textContent = latest.result.score; $('#band').textContent = latest.result.band; $('#recommend').textContent = latest.result.next;
    $('#bandMetric').textContent = latest.result.band; $('#sleepMetric').textContent = latest.sleepHours + ' hrs';
    const raised = latest.result.parts.filter(part => part.value >= 60).map(part => part.label);
    if (raised.length) $('#recommend').textContent += ' Higher factors: ' + raised.join(', ') + '.';
  } else { $('#score').textContent = '—'; $('#band').textContent = 'No check-in yet'; $('#recommend').textContent = 'Complete a check-in to see a personal reflection.'; $('#bandMetric').textContent = 'Not available'; $('#sleepMetric').textContent = '—'; }
  if (!checkins.length) { rows.innerHTML = '<tr><td colspan="4" style="color:#9aa49c">No check-ins saved yet.</td></tr>'; return; }
  for (const checkin of checkins) {
    const row = document.createElement('tr'); row.append(makeCell(new Date(checkin.createdAt).toLocaleString()));
    const score = document.createElement('td'), pill = document.createElement('span');
    pill.className = 'scorepill ' + (checkin.result.score >= 60 ? 'high' : checkin.result.score >= 34 ? 'elevated' : '');
    pill.textContent = `${checkin.result.score} · ${checkin.result.band}`; score.append(pill); row.append(score);
    row.append(makeCell(checkin.sleepHours + ' h'), makeCell(checkin.note || '—')); rows.append(row);
  }
}
function resetCheckin() {
  checkValues = { feltStress: 3, fatigue: 3, workload: 3, mood: 3, support: 3, sleepQuality: 3, recovery: 3, eventImpact: 1, physicalStrain: 3, shiftPattern: 'day' };
  $('#shiftPattern').value = 'day'; $('#sleep').value = '7'; $('#note').value = ''; clearError('#checkError');
  document.querySelectorAll('.rating').forEach(group => group.querySelectorAll('button').forEach(button => button.classList.toggle('chosen', Number(button.dataset.v) === (group.dataset.key === 'eventImpact' ? 1 : 3))));
}
document.querySelectorAll('.rating button').forEach(button => button.addEventListener('click', () => {
  button.parentElement.querySelectorAll('button').forEach(item => item.classList.remove('chosen'));
  button.classList.add('chosen'); checkValues[button.parentElement.dataset.key] = Number(button.dataset.v);
}));
$('#saveCheck').onclick = async () => {
  clearError('#checkError');
  const ratings = Object.fromEntries([...document.querySelectorAll('.rating')].map(group => [group.dataset.key, Number(group.querySelector('button.chosen')?.dataset.v)]));
  const invalidRatings = Object.entries(ratings).filter(([, value]) => !Number.isInteger(value) || value < 1 || value > 5).map(([key]) => key);
  const sleepValue = $('#sleep').value.trim();
  const sleepHours = Number(sleepValue);
  const shiftPattern = $('#shiftPattern').value;
  const invalidFields = [...invalidRatings];
  if (!sleepValue || !Number.isFinite(sleepHours) || sleepHours < 0 || sleepHours > 16) invalidFields.push('sleep hours (0–16)');
  if (!['day', 'evening', 'night', 'rotating'].includes(shiftPattern)) invalidFields.push('shift pattern');
  if (invalidFields.length) return showError('#checkError', `Please review: ${invalidFields.join(', ')}.`);
  try {
    await api('/api/checkins', { method: 'POST', body: JSON.stringify({ ...ratings, shiftPattern, sleepHours, note: $('#note').value }) });
    closeModal('checkModal'); await loadHistory(); say('Saved to your private history.');
  } catch (error) { showError('#checkError', error.message); }
};

async function loadConsents() {
  const data = await api('/api/consents'); const box = $('#consentList'); box.replaceChildren();
  if (!data.consents.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No clinicians have access.'; box.append(p); return; }
  for (const consent of data.consents) {
    const row = document.createElement('div'); row.className = 'personrow';
    const details = document.createElement('div'), name = document.createElement('b'), small = document.createElement('small'), revoke = document.createElement('button');
    name.textContent = `${consent.clinicianName} · ${consent.clinicianEmail}`; small.textContent = `Active · ${consent.aiAllowed ? 'Mistral summaries allowed' : 'Mistral summaries off'}`;
    details.append(name, small); revoke.className = 'btn'; revoke.textContent = 'Revoke';
    revoke.onclick = async () => { try { await api('/api/consents/' + consent.id, { method: 'DELETE' }); await loadConsents(); say('Clinician access revoked.'); } catch (error) { say(error.message); } };
    row.append(details, revoke); box.append(row);
  }
}
$('#grantShare').onclick = async () => {
  clearError('#shareError');
  try {
    await api('/api/consents', { method: 'POST', body: JSON.stringify({ clinicianEmail: $('#clinicianEmail').value, aiAllowed: $('#allowAi').checked }) });
    closeModal('shareModal'); $('#clinicianEmail').value = ''; $('#allowAi').checked = false; await loadConsents(); say('Consent saved. You can revoke access at any time.');
  } catch (error) { showError('#shareError', error.message); }
};

async function loadPeople() {
  const { people } = await api('/api/doctor/people'); const box = $('#patientList'); box.replaceChildren();
  if (!people.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = 'No active shares. Members can grant access using your registered clinician email.'; box.append(p); return; }
  for (const person of people) {
    const row = document.createElement('div'); row.className = 'personrow'; const details = document.createElement('div');
    const name = document.createElement('b'), count = document.createElement('small'), view = document.createElement('button');
    name.textContent = person.name; count.textContent = person.count + ' shared check-ins'; view.className = 'btn'; view.textContent = 'View shared history';
    details.append(name, count); view.onclick = () => viewPerson(person.id); row.append(details, view); box.append(row);
  }
}
async function viewPerson(id) {
  try {
    const data = await api('/api/doctor/person/' + id); activePersonId = id;
    $('#doctorHistoryTitle').textContent = 'Shared history · ' + data.person.name;
    $('#doctorSummaryBtn').disabled = !data.aiSummaryAllowed;
    $('#doctorSummaryBtn').title = data.aiSummaryAllowed ? 'Member allowed de-identified Mistral summaries.' : 'Member has not allowed AI summaries.';
    $('#doctorSummary').classList.add('hidden'); clearError('#doctorSummaryError');
    const rows = $('#doctorRows'); rows.replaceChildren();
    if (!data.checkins.length) { const row = document.createElement('tr'), cell = makeCell('No check-ins shared yet.'); cell.colSpan = 5; row.append(cell); rows.append(row); return; }
    for (const checkin of data.checkins) {
      const row = document.createElement('tr');
      [new Date(checkin.createdAt).toLocaleString(), `${checkin.result.score} · ${checkin.result.band}`, `stress ${checkin.feltStress}/5 · fatigue ${checkin.fatigue}/5`, checkin.sleepHours + ' h', checkin.note || '—'].forEach(value => row.append(makeCell(value)));
      rows.append(row);
    }
  } catch (error) { say(error.message); }
}
$('#doctorSummaryBtn').onclick = async () => {
  if (!activePersonId) return; clearError('#doctorSummaryError'); $('#doctorSummaryBtn').disabled = true; $('#doctorSummaryBtn').textContent = 'Preparing summary…';
  try { const data = await api(`/api/doctor/person/${activePersonId}/ai-summary`, { method: 'POST' }); $('#doctorSummary').textContent = data.summary; $('#doctorSummary').classList.remove('hidden'); }
  catch (error) { showError('#doctorSummaryError', error.message); }
  finally { $('#doctorSummaryBtn').textContent = 'Generate de-identified AI summary'; $('#doctorSummaryBtn').disabled = false; }
};

async function loadAdmin() {
  try {
    const data = await api('/api/admin/overview'); $('#adminMessage').textContent = data.message || 'Anonymous aggregate across the last 30 days. No names or individual histories are available.';
    if (!data.available) { $('#adminStats').classList.add('hidden'); return; }
    $('#adminStats').classList.remove('hidden'); $('#aggCount').textContent = data.contributingMembers; $('#aggAverage').textContent = data.averageSignal + '/100';
    $('#aggElevated').textContent = (data.bands.elevated + data.bands.highStrain) + ' / ' + data.contributingMembers; $('#aggSteady').textContent = data.bands.steady + ' / ' + data.contributingMembers;
    const factors = $('#aggFactors'); factors.replaceChildren();
    for (const [label, value] of Object.entries(data.factors)) { const row = document.createElement('div'); row.className = 'signal'; const icon = document.createElement('div'); icon.className = 'sigicon'; icon.textContent = '·'; const text = document.createElement('div'); text.className = 'sigtext'; const b = document.createElement('b'); b.textContent = label; text.append(b); const score = document.createElement('span'); score.className = 'sigval'; score.textContent = value + '/100'; row.append(icon, text, score); factors.append(row); }
  } catch (error) { $('#adminMessage').textContent = error.message; }
}

$('#doctorSummaryBtn').setAttribute('aria-describedby', 'doctorSummaryError');
$('#aiBtn').onclick = async () => {
  clearError('#aiError'); $('#aiResult').classList.add('hidden');
  if (!$('#aiConsent').checked) return showError('#aiError', 'Give separate consent first. No factors are sent without it.');
  $('#aiBtn').disabled = true; $('#aiBtn').textContent = 'Preparing reflection…';
  try { const data = await api('/api/ai-advice', { method: 'POST', body: JSON.stringify({ aiConsent: true }) }); $('#aiResult').textContent = data.advice; $('#aiResult').classList.remove('hidden'); }
  catch (error) { showError('#aiError', error.message); }
  finally { $('#aiBtn').disabled = false; $('#aiBtn').textContent = 'Suggest supportive next steps'; }
};
$('#exportBtn').onclick = async () => { try { const data = await api('/api/export'); const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); link.download = 'sahaara-my-checkins.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); } catch (error) { say(error.message); } };
$('#resetBtn').onclick = () => openModal('resetModal');
$('#peerBtn').onclick = () => say('Consider contacting a trusted peer or your designated confidential support professional.');

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const view = button.dataset.view; document.querySelectorAll('.nav button').forEach(nav => nav.classList.toggle('active', nav.dataset.view === view));
  $('#crumb').textContent = view.toUpperCase();
  if (view === 'checkin') { resetCheckin(); openModal('checkModal'); }
  if (view === 'sharing') { openModal('shareModal'); loadConsents().catch(error => say(error.message)); }
  if (view === 'history') $('#historyRows').scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (view === 'admin') loadAdmin();
  if (view === 'support') say('Choose a support pathway that feels comfortable.');
  if (view === 'home') window.scrollTo({ top: 0, behavior: 'smooth' });
}));

(async () => { try { await enter(await api('/api/me')); } catch { /* signed-out state */ } })();
