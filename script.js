// ---- Config -------------------------------------------------------------
const MODEL = 'gemini-2.5-flash';   // change if you want a different Gemini model
const $ = s => document.querySelector(s);
const state = { name: '', age: '', gender: '', symptoms: '', city: '', marks: [] };

// ---- Screen switching ---------------------------------------------------
function show(id) {
  ['s-welcome','s-details','s-symptoms','s-body','s-city','s-loading','s-report']
    .forEach(s => { document.getElementById(s).hidden = s !== id; });
  document.body.classList.toggle('light', id === 's-report');
  window.scrollTo(0, 0);
}

// ---- Body diagram (shared by the marker step and the report) ------------
const NS = 'http://www.w3.org/2000/svg';
const PARTS = [  // [part, tag, attributes]; -r / -l = the patient's right / left
  ['head',  'circle', { cx: 100, cy: 38, r: 22 }],
  ['torso', 'rect', { x: 72, y: 68, width: 56, height: 80, rx: 8 }],
  ['leg-r', 'rect', { x: 74, y: 152, width: 22, height: 120, rx: 6 }],
  ['leg-l', 'rect', { x: 104, y: 152, width: 22, height: 120, rx: 6 }],
  ['arm-r', 'rect', { x: 56, y: 76, width: 12, height: 62, rx: 6, transform: 'rotate(25 62 78)' }],
  ['arm-l', 'rect', { x: 132, y: 76, width: 12, height: 62, rx: 6, transform: 'rotate(-25 138 78)' }]
];
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
  return e;
}
function dotEl(x, y, i) {
  const c = svgEl('circle', { cx: x, cy: y, r: 7 });
  if (i !== undefined) c.dataset.i = i;
  return c;
}
function buildBody(svg) {   // draws the body and returns the <g> that holds the dots
  svg.replaceChildren();
  PARTS.forEach(([part, tag, a]) => { const e = svgEl(tag, { ...a, class: 'part' }); e.dataset.part = part; svg.appendChild(e); });
  [['Right', 4, 'start'], ['Left', 196, 'end']].forEach(([t, x, anchor]) => {
    const e = svgEl('text', { x, y: 14, 'text-anchor': anchor }); e.textContent = t; svg.appendChild(e);
  });
  const g = svgEl('g', { class: 'dots' }); svg.appendChild(g);
  return g;
}
function labelFor(part, y) {  // turn a click position into a readable body area
  const side = part.endsWith('-r') ? 'right ' : part.endsWith('-l') ? 'left ' : '';
  if (part === 'head') return 'head';
  if (part === 'torso') return y < 105 ? 'chest' : y < 128 ? 'upper abdomen' : 'lower abdomen';
  if (part.startsWith('arm')) return side + (y < 100 ? 'upper arm' : 'forearm/hand');
  return side + (y < 200 ? 'thigh' : y < 228 ? 'knee' : 'lower leg/foot');
}

const reportDots = buildBody($('#body'));
const pick = $('#pick'), pickDots = buildBody(pick);
const MAX_MARKS = 8;

function drawMarks() {
  pickDots.replaceChildren();
  state.marks.forEach((m, i) => pickDots.appendChild(dotEl(m.x, m.y, i)));
  const chips = $('#chips'); chips.replaceChildren();
  state.marks.forEach((m, i) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = m.label + ' \u2715';
    b.setAttribute('aria-label', 'Remove marker: ' + m.label);
    b.onclick = () => { state.marks.splice(i, 1); drawMarks(); };
    chips.appendChild(b);
  });
}
pick.addEventListener('click', e => {
  if (e.target.dataset.i !== undefined) { state.marks.splice(+e.target.dataset.i, 1); drawMarks(); return; }
  const part = e.target.dataset.part;
  if (!part || state.marks.length >= MAX_MARKS) return;
  const pt = pick.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(pick.getScreenCTM().inverse());
  state.marks.push({ x: Math.round(p.x), y: Math.round(p.y), label: labelFor(part, p.y) });
  drawMarks();
});
function toCity() { show('s-city'); $('#city').focus(); }
$('#b-next').onclick = toCity;
$('#b-skip').onclick = () => { state.marks = []; drawMarks(); toCity(); };

// ---- Wizard steps -------------------------------------------------------
$('#key').value = localStorage.getItem('medimitra_key') || '';
$('#start').onclick = () => {
  const k = $('#key').value.trim();
  if (!k) { $('#e-welcome').textContent = 'Enter your Gemini API key to continue.'; return; }
  localStorage.setItem('medimitra_key', k);
  show('s-details');
};
function saveDetails(skip) {
  state.name = skip ? '' : $('#name').value.trim();
  state.age = skip ? '' : $('#age').value.trim();
  state.gender = skip ? '' : $('#gender').value;
  show('s-symptoms'); $('#symptoms').focus();
}
$('#d-next').onclick = () => saveDetails(false);
$('#skip').onclick = () => saveDetails(true);

function submitSymptoms() {
  const v = $('#symptoms').value.trim();
  if (!v) return;
  state.symptoms = v; show('s-body');
}
$('#sym-go').onclick = submitSymptoms;
$('#symptoms').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitSymptoms(); } };

function submitCity() {
  const v = $('#city').value.trim();
  if (!v) return;
  state.city = v; analyze();
}
$('#city-go').onclick = submitCity;
$('#city').onkeydown = e => { if (e.key === 'Enter') submitCity(); };

// Voice input (hidden if the browser doesn't support it)
function mic(btn, input) {
  const R = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!R) { btn.hidden = true; return; }
  btn.onclick = () => {
    const r = new R(); r.lang = 'en-IN';
    r.onresult = e => { input.value += (input.value ? ' ' : '') + e.results[0][0].transcript; };
    r.start();
  };
}
mic($('#mic1'), $('#symptoms')); mic($('#mic2'), $('#city'));

// ---- AI call ------------------------------------------------------------
function buildPrompt() {
  const who = [state.name || 'unknown name', state.age ? state.age + ' years old' : 'age unknown', state.gender || 'gender unknown'].join(', ');
  return `You are a careful health-information assistant. You never diagnose.
Patient: ${who}.
Symptoms: "${state.symptoms}"
${state.marks.length ? "The patient marked these spots on a body diagram (patient's own left/right): " + [...new Set(state.marks.map(m => m.label))].join(', ') + '. Take the exact locations into account.\n' : ''}City: "${state.city}"

Use Google Search to find 2-4 real hospitals in or near that city, preferring ones with emergency departments.
Reply with ONLY a JSON object (no markdown fences) with these keys:
"urgency": "emergency" | "urgent" | "routine"
"note": 1-2 sentences on how typical this symptom combination is for this age and gender, and why evaluation matters
"regions": array of affected body areas, from ["head","chest","abdomen","left_arm","right_arm","legs"] (use [] if the patient marked locations)
"causes": 3-5 short strings, most concerning first
"roadmap": 3-5 short strings (checks or tests a clinician may do)
"wellness": 1-2 sentences of safe self-care; if urgency is "emergency", start with "Seek immediate care."
"hospitals": array of {"name": string, "area": string}`;
}

async function callGemini() {
  const key = localStorage.getItem('medimitra_key');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt() }] }],
        tools: [{ google_search: {} }]
      })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Request failed');
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('The AI reply was not in the expected format. Try again.');
  return JSON.parse(text.slice(a, b + 1));
}

async function analyze() {
  show('s-loading');
  const phases = ['Reading your symptoms...', `Searching for healthcare facilities in ${state.city}...`, 'Preparing your report...'];
  let i = 0; $('#phase').textContent = phases[0];
  const t = setInterval(() => { i = Math.min(i + 1, phases.length - 1); $('#phase').textContent = phases[i]; }, 5000);
  try {
    render(await callGemini());
    show('s-report');
  } catch (e) {
    $('#e-city').textContent = 'Something went wrong: ' + e.message;
    show('s-city');
  } finally { clearInterval(t); }
}

// ---- Report rendering (textContent only, so AI text can't inject HTML) ---
const REGIONS = { head: [100, 38], chest: [100, 92], abdomen: [100, 135], left_arm: [148, 105], right_arm: [52, 105], legs: [100, 225] };
const STATUS = { emergency: 'Status: Seek care now', urgent: 'Status: See a doctor soon', routine: 'Status: Routine follow-up' };

function fill(sel, items, make) {
  const ul = $(sel); ul.replaceChildren();
  (items || []).forEach(x => ul.appendChild(make(x)));
}
const li = txt => { const e = document.createElement('li'); e.textContent = txt; return e; };

function render(d) {
  const urgency = STATUS[d.urgency] ? d.urgency : 'urgent';
  $('#r-name').textContent = state.name || 'there';
  $('#r-who').textContent = [state.age, state.gender].filter(Boolean).join(' / ');
  const pill = $('#r-status'); pill.textContent = STATUS[urgency]; pill.className = 'pill ' + urgency;
  $('#r-alert').hidden = urgency !== 'emergency';
  $('#r-sym').textContent = '"' + state.symptoms + '"';
  $('#r-note').textContent = d.note ? 'Note: ' + d.note : '';
  $('#r-well').textContent = d.wellness || '';
  fill('#r-causes', d.causes, li);
  fill('#r-road', d.roadmap, li);

  reportDots.replaceChildren();
  const spots = state.marks.length ? state.marks.map(m => [m.x, m.y]) : (d.regions || []).filter(r => REGIONS[r]).map(r => REGIONS[r]);
  spots.forEach(([x, y]) => reportDots.appendChild(dotEl(x, y)));
  $('#r-marks').textContent = state.marks.length ? 'Marked: ' + [...new Set(state.marks.map(m => m.label))].join(', ') : '';

  const box = $('#r-hosp'); box.replaceChildren();
  (d.hospitals || []).forEach(h => {
    const card = document.createElement('div'); card.className = 'hosp';
    const n = document.createElement('b'); n.textContent = h.name;
    const s = document.createElement('span'); s.textContent = h.area || '';
    const a = document.createElement('a'); a.textContent = 'Get Directions'; a.target = '_blank'; a.rel = 'noopener';
    a.href = 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(`${h.name} ${h.area || ''} ${state.city}`);
    card.append(n, s, a); box.appendChild(card);
  });
}

$('#again').onclick = () => {
  ['symptoms', 'city'].forEach(id => { $('#' + id).value = ''; });
  state.marks = []; drawMarks();
  $('#e-city').textContent = ''; show('s-details');
};

show('s-welcome');
