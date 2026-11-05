'use strict';
// app.js — all screens and logic. Plain JavaScript, no frameworks.
// How it works:
//   * State lives in the object S, and is saved to IndexedDB via DB (db.js).
//   * Each screen is a function in VIEWS that returns an HTML string; render() draws the current one.
//   * Buttons have data-act="name" -> handled by ACT.name. Inputs have data-ch="name" -> CH.name (on change).
const APP_VERSION = '1.0.0';

// ---------- small helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const uid = newId; // from seed.js
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const num = v => { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; };
const fmtKg = n => (n == null || isNaN(n)) ? '—' : String(Math.round(Number(n) * 100) / 100);
const fmtDate = iso => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateY = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtTime = iso => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const mmss = sec => { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
const daysAgo = iso => Math.floor((Date.now() - new Date(iso)) / 864e5);
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
const TYPE = { warmup: { short: 'WU', label: 'Warm-up' }, working: { short: 'WK', label: 'Working' }, backoff: { short: 'BO', label: 'Back-off' } };

// ---------- state ----------
const DEFAULT_SETTINGS = { restSec: 120, autoRest: true, vibrate: true, wakeLock: true, lastBackup: null };
const S = { programs: [], activeId: null, maxes: {}, settings: { ...DEFAULT_SETTINGS }, sessions: [], draft: null };

const save = {
  programs: () => DB.set('programs', S.programs),
  active: () => DB.set('activeId', S.activeId),
  maxes: () => DB.set('maxes', S.maxes),
  settings: () => DB.set('settings', S.settings),
  draft: () => S.draft ? DB.set('draft', S.draft) : DB.del('draft'),
};
let draftTimer = null;
const saveDraftSoon = () => { clearTimeout(draftTimer); draftTimer = setTimeout(save.draft, 300); };

async function load() {
  S.programs = await DB.get('programs');
  if (!S.programs || !S.programs.length) {
    const p = seedProgram();
    S.programs = [p]; S.activeId = p.id; S.maxes = seedMaxes();
    await save.programs(); await save.active(); await save.maxes();
  }
  S.activeId = (await DB.get('activeId')) || S.programs[0].id;
  S.maxes = (await DB.get('maxes')) || {};
  S.settings = { ...DEFAULT_SETTINGS, ...((await DB.get('settings')) || {}) };
  S.draft = (await DB.get('draft')) || null;
  S.sessions = ((await DB.allSessions()) || []).sort((a, b) => b.date.localeCompare(a.date));
}

const activeProgram = () => S.programs.find(p => p.id === S.activeId) || S.programs[0];
const findDay = id => activeProgram()?.days.find(d => d.id === id);
const findEx = (dayId, exId) => findDay(dayId)?.exercises.find(e => e.id === exId);
const maxOf = key => (key && S.maxes[key]?.kg) || null;

// ---------- calculations ----------
const Calc = {
  // Estimated 1RM, Epley formula: weight × (1 + reps/30)
  e1rm(kg, reps) { if (!kg || !reps) return null; return reps <= 1 ? kg : kg * (1 + reps / 30); },
  // Reps needed at `kg` for the Epley estimate to reach `max`
  repsToMatch(max, kg) { if (!max || !kg) return null; if (kg >= max) return 1; return Math.max(1, Math.ceil(30 * (max / kg - 1) - 1e-9)); },
  round(kg, inc) { inc = inc || 2.5; return Math.round(kg / inc) * inc; },
  // Programmed weight for a set (fixed kg, or % of max rounded to the exercise's increment)
  targetKg(ex, set) {
    const L = set.load || {};
    if (L.mode === 'pct') { const m = maxOf(ex.maxKey); return (m && L.value != null) ? Calc.round(m * L.value / 100, ex.inc) : null; }
    return L.value ?? null;
  },
};

function targetText(t) {
  let w;
  if (t.pct != null) w = `${fmtKg(t.pct)}%${t.kg != null ? ' · ' + fmtKg(t.kg) + ' kg' : ' (set max)'}`;
  else w = t.kg != null ? fmtKg(t.kg) + ' kg' : 'your pick';
  let r = String(t.reps ?? '?');
  if (t.repsMax) r += '–' + t.repsMax;
  if (t.amrap) r += '+';
  let out = `${w} × ${r}`;
  if (t.amrap) out += ' <span class="pill amrap">AMRAP</span>';
  if (t.rir != null) out += ` <span class="pill">${fmtKg(t.rir)} RIR</span>`;
  return out;
}

// Most recent logged entry for an exercise (matched by id, falling back to name)
function lastEntryFor(ex) {
  const nm = ex.name.trim().toLowerCase();
  for (const s of S.sessions) {
    const e = s.entries.find(x => x.exId === ex.id) || s.entries.find(x => x.name.trim().toLowerCase() === nm);
    if (e) return { ...e, _date: s.date };
  }
  return null;
}

function bestE1rm(key, withinDays = 56) {
  let best = null;
  for (const s of S.sessions) {
    if (daysAgo(s.date) > withinDays) continue;
    for (const e of s.entries) {
      if (e.maxKey !== key) continue;
      for (const st of e.sets) {
        if (st.type === 'warmup' || !st.kg || !st.reps || st.reps > 10) continue;
        const v = Calc.e1rm(st.kg, st.reps);
        if (!best || v > best.kg) best = { kg: Math.round(v * 2) / 2, set: st, date: s.date };
      }
    }
  }
  return best;
}

const sessionVolume = s => s.entries.reduce((a, e) => a + e.sets.reduce((b, st) => b + (st.type !== 'warmup' && st.kg && st.reps ? st.kg * st.reps : 0), 0), 0);

function nextDayId(p) {
  const last = S.sessions.find(s => s.programId === p.id);
  if (!last) return p.days[0]?.id;
  const i = p.days.findIndex(d => d.id === last.dayId);
  return p.days[(i + 1) % p.days.length]?.id;
}

function allMaxKeys() {
  const keys = new Set(Object.keys(S.maxes));
  S.programs.forEach(p => p.days.forEach(d => d.exercises.forEach(e => e.maxKey && keys.add(e.maxKey))));
  return [...keys];
}

// ---------- navigation (uses browser history so Android's back gesture works) ----------
let view = { name: 'home' };
function go(name, params = {}, replace = false) {
  view = { name, ...params };
  history[replace ? 'replaceState' : 'pushState'](view, '');
  render(); window.scrollTo(0, 0);
}
window.addEventListener('popstate', e => { view = e.state || { name: 'home' }; render(); });

const NAV_GROUP = { home: 'home', workout: 'home', history: 'history', session: 'history', progress: 'history', exProgress: 'history',
  maxes: 'maxes', program: 'program', editDay: 'program', editEx: 'program', data: 'data' };

function render() {
  const fn = VIEWS[view.name] || VIEWS.home;
  $('#app').innerHTML = fn();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', NAV_GROUP[view.name] === b.dataset.v));
  if (view.name === 'data') fillPersistStatus();
  updateWakeLock();
  Timer.tick();
}
function rerender() { const y = window.scrollY; render(); window.scrollTo(0, y); }

function toast(msg, ms = 2500) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}

const tool = (act, id, label, extra = '', disabled = false) =>
  `<button class="btn icon sm ${extra}" data-act="${act}" data-id="${esc(id)}" ${disabled ? 'disabled' : ''}>${label}</button>`;

// ================= VIEWS =================
const VIEWS = {
  // ---------- Train (home) ----------
  home() {
    const p = activeProgram();
    let h = '';
    if (S.draft) {
      h += `<button class="card resume" data-act="go" data-v="workout">
        <div class="eyebrow">Workout in progress</div>
        <div class="h2">${esc(S.draft.dayName)}</div>
        <div class="muted small">Started ${fmtTime(S.draft.startedAt)} · tap to resume</div></button>`;
    }
    const lb = S.settings.lastBackup;
    if (S.sessions.length && (!lb || daysAgo(lb) >= 14)) {
      h += `<button class="banner" data-act="go" data-v="data">💾 Back up your data — last backup: ${lb ? daysAgo(lb) + ' days ago' : 'never'}</button>`;
    }
    if (S.programs.length > 1) {
      h += `<select class="prog-select" data-ch="activeProgram">${S.programs.map(x =>
        `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
    } else h += `<div class="eyebrow">Program</div>`;
    h += `<h1>${esc(p.name)}</h1>`;
    const next = nextDayId(p);
    h += p.days.map(d => {
      const last = S.sessions.find(s => s.dayId === d.id);
      return `<div class="card day ${d.id === next ? 'next' : ''}">
        <div class="row"><div class="h2">${esc(d.name)}</div>${d.id === next ? '<span class="pill accent">Next</span>' : ''}</div>
        <div class="muted">${esc(d.target || '')}</div>
        <div class="muted small">${d.exercises.length} exercises · ${last ? 'Last done ' + fmtDate(last.date) : 'Not done yet'}</div>
        <button class="btn ${d.id === next ? 'primary' : ''} block" data-act="start" data-id="${d.id}">Start workout</button>
      </div>`;
    }).join('') || `<p class="muted">No days yet. Add some in the Program tab.</p>`;
    return h;
  },

  // ---------- Active workout ----------
  workout() {
    const d = S.draft;
    if (!d) return `<p class="muted">No workout in progress.</p><button class="btn" data-act="nav" data-v="home">Back to Train</button>`;
    let h = `<div class="wk-head">
      <div><div class="eyebrow">${esc(d.programName)}</div><h1>${esc(d.dayName)}</h1>
      <div class="muted small">Started ${fmtTime(d.startedAt)} · <span id="elapsed">0:00</span></div></div>
      <button class="btn icon" data-act="timerStart" title="Start rest timer">⏱</button></div>`;
    h += d.entries.map((e, ei) => entryCard(e, ei)).join('');
    h += `<label class="field"><span>Session notes</span><textarea data-in="notes" rows="3" placeholder="How did it feel?">${esc(d.notes)}</textarea></label>
      <div class="row gap"><button class="btn danger" data-act="discard">Discard</button>
      <button class="btn primary grow" data-act="finish">Finish &amp; save</button></div>`;
    return h;
  },

  // ---------- History ----------
  history() {
    let h = `<h1>History</h1><button class="btn block" data-act="go" data-v="progress">📈 Progress by exercise</button>`;
    if (!S.sessions.length) return h + `<p class="muted">No workouts logged yet.</p>`;
    h += S.sessions.map(s => {
      const sets = s.entries.reduce((a, e) => a + e.sets.length, 0);
      const dur = s.endedAt ? Math.round((new Date(s.endedAt) - new Date(s.date)) / 60000) : null;
      return `<button class="card list-btn" data-act="go" data-v="session" data-id="${s.id}">
        <div class="row"><div class="h3">${esc(s.dayName)}</div><div class="muted small">${fmtDate(s.date)}</div></div>
        <div class="muted small">${s.entries.length} exercises · ${sets} sets · ${fmtKg(Math.round(sessionVolume(s)))} kg volume${dur ? ' · ' + dur + ' min' : ''}</div></button>`;
    }).join('');
    return h;
  },

  session() {
    const s = S.sessions.find(x => x.id === view.id);
    if (!s) return `<p class="muted">Workout not found.</p>`;
    let h = `<button class="link" data-act="back">‹ Back</button>
      <div class="eyebrow">${fmtDateY(s.date)} · ${fmtTime(s.date)}</div><h1>${esc(s.dayName)}</h1>`;
    h += s.entries.map(e => {
      const best = e.sets.filter(x => x.type !== 'warmup').reduce((b, x) => Math.max(b, Calc.e1rm(x.kg, x.reps) || 0), 0);
      return `<div class="card"><div class="h3">${e.superset ? `<span class="pill ss">${esc(e.superset)}</span> ` : ''}${esc(e.name)}</div>
        <div class="chips">${e.sets.map(x => `<span class="chip t-${x.type}">${TYPE[x.type]?.short || ''} ${fmtKg(x.kg)}×${x.reps ?? '—'}</span>`).join('')}</div>
        ${e.maxKey && best ? `<div class="muted small">Best e1RM: ${fmtKg(Math.round(best * 2) / 2)} kg</div>` : ''}</div>`;
    }).join('');
    if (s.notes) h += `<div class="card"><div class="eyebrow">Notes</div>${esc(s.notes)}</div>`;
    h += `<button class="btn danger block" data-act="delSession" data-id="${s.id}">Delete this workout</button>`;
    return h;
  },

  progress() {
    const map = new Map();
    for (const s of S.sessions) for (const e of s.entries) {
      const k = e.name.trim().toLowerCase();
      if (!map.has(k)) map.set(k, { name: e.name, count: 0, last: s.date });
      map.get(k).count++;
    }
    let h = `<button class="link" data-act="back">‹ Back</button><h1>Progress</h1>`;
    if (!map.size) return h + `<p class="muted">Log a workout to see progress.</p>`;
    h += [...map.values()].map(x => `<button class="card list-btn" data-act="go" data-v="exProgress" data-name="${esc(x.name)}">
      <div class="h3">${esc(x.name)}</div><div class="muted small">${x.count} session${x.count > 1 ? 's' : ''} · last ${fmtDate(x.last)}</div></button>`).join('');
    return h;
  },

  exProgress() {
    const nm = (view.name2 || '').trim().toLowerCase();
    const rows = [];
    for (const s of S.sessions) {
      const e = s.entries.find(x => x.name.trim().toLowerCase() === nm);
      if (!e) continue;
      const work = e.sets.filter(x => x.type !== 'warmup');
      let top = null, best = 0, vol = 0;
      for (const x of work) {
        const v = Calc.e1rm(x.kg, x.reps) || 0;
        if (v > best) { best = v; top = x; }
        vol += (x.kg || 0) * (x.reps || 0);
      }
      rows.push({ date: s.date, top, best, vol });
    }
    // mark PRs (best e1RM so far, oldest → newest)
    let run = 0;
    [...rows].reverse().forEach(r => { r.pr = r.best > run && r.best > 0; if (r.best > run) run = r.best; });
    let h = `<button class="link" data-act="back">‹ Back</button><h1>${esc(view.name2)}</h1>
      <p class="muted small">Top set = the working set with the highest estimated 1RM. ★ = new best.</p>
      <table class="tbl"><thead><tr><th>Date</th><th>Top set</th><th>e1RM</th><th>Volume</th></tr></thead><tbody>`;
    h += rows.map(r => `<tr><td>${fmtDate(r.date)}</td><td>${r.top ? fmtKg(r.top.kg) + '×' + r.top.reps : '—'}</td>
      <td>${r.best ? fmtKg(Math.round(r.best * 2) / 2) + (r.pr ? ' ★' : '') : '—'}</td><td>${fmtKg(Math.round(r.vol))}</td></tr>`).join('');
    return h + `</tbody></table>`;
  },

  // ---------- Maxes ----------
  maxes() {
    let h = `<h1>Maxes</h1><p class="muted">Your 1RM for each main lift. Used for % loading and the AMRAP "reps to match" target.</p>`;
    h += allMaxKeys().map(k => {
      const m = S.maxes[k] || {};
      const est = bestE1rm(k);
      return `<div class="card">
        <div class="row"><div class="h3">${esc(k)}</div>${tool('delMax', k, '✕', 'danger')}</div>
        <div class="row gap left"><input class="big-in" inputmode="decimal" data-ch="max" data-k="${esc(k)}" value="${m.kg ?? ''}" placeholder="—"><span>kg</span></div>
        <div class="muted small">${m.updated ? 'Updated ' + fmtDateY(m.updated) : 'Not set yet'}</div>
        ${est ? `<div class="est">Best estimate from your logs (last 8 weeks): <b>${fmtKg(est.kg)} kg</b>
          <span class="muted">(${fmtKg(est.set.kg)}×${est.set.reps}, ${fmtDate(est.date)})</span>
          <button class="btn sm" data-act="useEst" data-k="${esc(k)}" data-kg="${est.kg}">Use</button></div>` : ''}
      </div>`;
    }).join('');
    h += `<div class="card"><div class="h3">Add a lift</div><div class="row gap">
      <input id="newMaxKey" placeholder="e.g. Front Squat"><button class="btn" data-act="addMax">Add</button></div></div>
      <p class="muted small">Estimates use the Epley formula: weight × (1 + reps ÷ 30), sets of 10 reps or fewer. Fully automatic max tracking is planned for v2.</p>`;
    return h;
  },

  // ---------- Program editor ----------
  program() {
    const p = activeProgram();
    let h = `<h1>Program</h1>`;
    if (S.programs.length > 1) h += `<label class="field"><span>Active program</span><select data-ch="activeProgram">${S.programs.map(x =>
      `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>`;
    h += `<label class="field"><span>Program name</span><input data-ch="progName" value="${esc(p.name)}"></label>
      <div class="row gap wrap left"><button class="btn sm" data-act="newProgram">+ New program</button>
      <button class="btn sm" data-act="dupProgram">Duplicate</button>
      <button class="btn sm danger" data-act="delProgram" ${S.programs.length < 2 ? 'disabled' : ''}>Delete</button></div>
      <h2 class="section">Days</h2>`;
    h += p.days.map((d, i) => `<div class="card list-item">
      <button class="li-main" data-act="go" data-v="editDay" data-day="${d.id}">
        <div class="h3">${esc(d.name)}</div><div class="muted small">${d.exercises.length} exercises</div></button>
      <div class="li-tools">${tool('moveDayUp', d.id, '↑', '', i === 0)}${tool('moveDayDown', d.id, '↓', '', i === p.days.length - 1)}${tool('delDay', d.id, '✕', 'danger')}</div>
    </div>`).join('');
    h += `<button class="btn block" data-act="addDay">+ Add day</button>
      <p class="muted small">Changes apply to workouts you start from now on. Past logs are never changed.</p>`;
    return h;
  },

  editDay() {
    const d = findDay(view.dayId);
    if (!d) return `<p class="muted">Day not found.</p>`;
    let h = `<button class="link" data-act="back">‹ Program</button>
      <label class="field"><span>Day name</span><input data-ch="dayField" data-f="name" value="${esc(d.name)}"></label>
      <label class="field"><span>Target / focus</span><input data-ch="dayField" data-f="target" value="${esc(d.target || '')}"></label>
      <h2 class="section">Exercises</h2>`;
    h += d.exercises.map((e, i) => {
      const cnt = {}; e.sets.forEach(s => cnt[s.type] = (cnt[s.type] || 0) + 1);
      const sum = Object.entries(cnt).map(([t, n]) => `${n} ${TYPE[t].short}`).join(' · ');
      return `<div class="card list-item">
        <button class="li-main" data-act="go" data-v="editEx" data-day="${d.id}" data-ex="${e.id}">
          <div class="h3">${e.superset ? `<span class="pill ss">${esc(e.superset)}</span> ` : ''}${esc(e.name)}</div>
          <div class="muted small">${sum}${e.maxKey ? ' · ' + esc(e.maxKey) + ' max' : ''}${e.optional ? ' · optional' : ''}</div></button>
        <div class="li-tools">${tool('moveExUp', e.id, '↑', '', i === 0)}${tool('moveExDown', e.id, '↓', '', i === d.exercises.length - 1)}${tool('dupEx', e.id, '⧉')}${tool('delEx', e.id, '✕', 'danger')}</div>
      </div>`;
    }).join('');
    return h + `<button class="btn block" data-act="addEx">+ Add exercise</button>`;
  },

  editEx() {
    const ex = findEx(view.dayId, view.exId);
    if (!ex) return `<p class="muted">Exercise not found.</p>`;
    const max = maxOf(ex.maxKey);
    let h = `<button class="link" data-act="back">‹ Day</button>
      <label class="field"><span>Exercise name</span><input data-ch="exField" data-f="name" value="${esc(ex.name)}"></label>
      <label class="field"><span>Notes / cues</span><textarea data-ch="exField" data-f="notes" rows="2">${esc(ex.notes)}</textarea></label>
      <div class="grid2">
        <label class="field"><span>Linked max (for %)</span><input list="maxkeys" data-ch="exField" data-f="maxKey" data-rr="1" value="${esc(ex.maxKey)}" placeholder="none"></label>
        <label class="field"><span>Round to (kg)</span><select data-ch="exField" data-f="inc">${[1.25, 2.5, 5].map(v => `<option ${ex.inc == v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Superset group</span><input data-ch="exField" data-f="superset" value="${esc(ex.superset)}" placeholder="e.g. A"></label>
        <div class="field checks"><label><input type="checkbox" data-ch="exField" data-f="perSide" ${ex.perSide ? 'checked' : ''}> Per leg/arm</label>
          <label><input type="checkbox" data-ch="exField" data-f="optional" ${ex.optional ? 'checked' : ''}> Optional</label></div>
      </div>
      <datalist id="maxkeys">${allMaxKeys().map(k => `<option value="${esc(k)}">`).join('')}</datalist>
      ${ex.maxKey ? `<p class="muted small">${esc(ex.maxKey)} max: ${max ? fmtKg(max) + ' kg' : 'not set — <button class="link inline" data-act="nav" data-v="maxes">set it</button>'}</p>` : ''}
      <h2 class="section">Sets</h2>
      <p class="muted small">Leave weight empty to choose it on the day (last session's weight is pre-filled). Leave "to" empty for a fixed rep count.</p>`;
    h += ex.sets.map((s, si) => setEditor(ex, s, si)).join('');
    h += `<div class="row gap wrap left">
      <button class="btn sm" data-act="addSetDef" data-t="warmup">+ Warm-up</button>
      <button class="btn sm" data-act="addSetDef" data-t="working">+ Working</button>
      <button class="btn sm" data-act="addSetDef" data-t="backoff">+ Back-off</button></div>`;
    if (max && ex.sets.some(s => s.load.mode === 'kg' && s.load.value)) {
      h += `<button class="btn block" data-act="toPct">Convert kg sets to % of ${esc(ex.maxKey)} max (${fmtKg(max)} kg)</button>`;
    }
    return h;
  },

  // ---------- Data & settings ----------
  data() {
    const st = S.settings;
    return `<h1>Data & settings</h1>
      <div class="card"><div class="h3">Backup</div>
        <p class="muted small">Your data lives only on this phone. Export a backup regularly (e.g. to Google Drive). Last backup: ${st.lastBackup ? fmtDateY(st.lastBackup) : 'never'}.</p>
        <div class="col gap">
          <button class="btn primary" data-act="shareJson">Share backup file…</button>
          <button class="btn" data-act="exportJson">Download backup (.json)</button>
          <button class="btn" data-act="exportCsv">Download logged sets (.csv)</button>
          <button class="btn" data-act="importClick">Restore from backup…</button>
        </div>
        <p class="muted small" id="persist">Checking storage…</p></div>
      <div class="card"><div class="h3">Workout settings</div>
        <label class="field"><span>Rest timer (seconds)</span><input inputmode="numeric" data-ch="setting" data-f="restSec" value="${st.restSec}"></label>
        <div class="field checks">
          <label><input type="checkbox" data-ch="setting" data-f="autoRest" ${st.autoRest ? 'checked' : ''}> Start rest timer when I tick a set</label>
          <label><input type="checkbox" data-ch="setting" data-f="vibrate" ${st.vibrate ? 'checked' : ''}> Vibrate when rest is over</label>
          <label><input type="checkbox" data-ch="setting" data-f="wakeLock" ${st.wakeLock ? 'checked' : ''}> Keep screen on during workouts</label>
        </div></div>
      <div class="card"><div class="h3">Programs</div>
        <button class="btn block" data-act="addSample">Add the sample 3-day program again</button></div>
      <p class="muted small center">Gym Tracker v${APP_VERSION}</p>`;
  },
};

// ---------- workout pieces ----------
function entryCard(e, ei) {
  const max = maxOf(e.maxKey);
  const done = e.sets.filter(s => s.done).length;
  const head = `<div class="row"><div class="h3">${e.superset ? `<span class="pill ss">${esc(e.superset)}</span> ` : ''}${esc(e.name)}
      ${e.perSide ? '<span class="pill">per side</span>' : ''}${e.optional ? '<span class="pill">optional</span>' : ''}</div>
      <div class="muted small nowrap">${done}/${e.sets.length}</div></div>`;
  if (e.skipped) return `<div class="card ex skipped">${head}<div class="row"><span class="muted small">Skipped</span>
      <button class="btn sm" data-act="skip" data-e="${ei}">Undo</button></div></div>`;
  const meta = [];
  if (e.maxKey) meta.push(`${esc(e.maxKey)} 1RM: ${max ? fmtKg(max) + ' kg' : '<button class="link inline" data-act="nav" data-v="maxes">not set</button>'}`);
  meta.push(e.prevDate ? `Last time: ${fmtDate(e.prevDate)}` : 'First time logging');
  const counters = {};
  const rows = e.sets.map((s, si) => {
    counters[s.type] = (counters[s.type] || 0) + 1;
    const prev = s.prevKg != null || s.prevReps != null ? `Last: ${fmtKg(s.prevKg)}×${s.prevReps ?? '—'}` : '';
    return `<div class="set t-${s.type} ${s.done ? 'done' : ''}" data-e="${ei}" data-s="${si}">
      <div class="set-top"><span class="tag">${TYPE[s.type]?.short || ''}${counters[s.type]}</span>
        <span class="set-target">${targetText(s.target)}</span><span class="set-prev">${prev}</span></div>
      <div class="set-inputs">
        <label class="inp"><input inputmode="decimal" data-in="kg" value="${s.kg ?? ''}" placeholder="kg"><span>kg</span></label>
        <span class="x">×</span>
        <label class="inp"><input inputmode="numeric" data-in="reps" value="${s.reps ?? ''}" placeholder="${s.target.reps ?? ''}"><span>reps</span></label>
        <button class="tick" data-act="tick" aria-label="Done">${s.done ? '✓' : ''}</button>
      </div>
      <div class="set-hint">${hintHtml(e, s)}</div></div>`;
  }).join('');
  return `<div class="card ex">${head}
    ${e.notes ? `<div class="cue">${esc(e.notes)}</div>` : ''}
    <div class="muted small">${meta.join(' · ')}</div>
    ${rows}
    <div class="row gap left ex-foot"><button class="btn sm" data-act="addSet" data-e="${ei}">+ Set</button>
      <button class="btn sm" data-act="removeSet" data-e="${ei}">− Set</button>
      <button class="btn sm ghost" data-act="skip" data-e="${ei}">Skip exercise</button></div></div>`;
}

// AMRAP / top-set helper: reps needed to "match" the current 1RM, plus live estimated 1RM
function hintHtml(e, s) {
  if (!e.maxKey || s.type === 'warmup') return '';
  const max = maxOf(e.maxKey);
  const parts = [];
  if (max && s.kg && (s.target.amrap || s.target.rir != null)) {
    parts.push(`🎯 Match 1RM (${fmtKg(max)}): <b>${Calc.repsToMatch(max, s.kg)} reps</b> @ ${fmtKg(s.kg)} kg`);
  }
  if (s.kg && s.reps) {
    const v = Calc.e1rm(s.kg, s.reps);
    parts.push(`e1RM ${fmtKg(Math.round(v * 2) / 2)} kg${max && v >= max ? ' 🔥' : ''}`);
  }
  return parts.join(' · ');
}

function buildEntry(ex) {
  const prev = lastEntryFor(ex);
  return {
    exId: ex.id, name: ex.name, notes: ex.notes, maxKey: ex.maxKey || '', inc: ex.inc, superset: ex.superset || '',
    perSide: !!ex.perSide, optional: !!ex.optional, skipped: false, prevDate: prev?._date || null,
    sets: ex.sets.map((st, i) => {
      const t = Calc.targetKg(ex, st);
      const pv = prev?.sets.find(x => x.i === i) || null;
      return {
        type: st.type,
        target: { kg: t, pct: st.load.mode === 'pct' ? st.load.value : null, reps: st.reps, repsMax: st.repsMax, amrap: !!st.amrap, rir: st.rir },
        kg: t ?? pv?.kg ?? null, reps: null, done: false,
        prevKg: pv?.kg ?? null, prevReps: pv?.reps ?? null,
      };
    }),
  };
}

// ---------- rest timer ----------
const Timer = {
  end: 0, total: 0, fired: false,
  start(sec = S.settings.restSec) { this.total = sec; this.end = Date.now() + sec * 1000; this.fired = false; this.tick(); },
  add(d) { if (!this.end) return; this.end += d * 1000; this.total = Math.max(1, this.total + d); this.fired = false; this.tick(); },
  stop() { this.end = 0; this.tick(); },
  tick() {
    const el = $('#elapsed');
    if (el && S.draft) el.textContent = mmss((Date.now() - new Date(S.draft.startedAt)) / 1000);
    const bar = $('#timerbar');
    if (!this.end) { bar.hidden = true; return; }
    const left = (this.end - Date.now()) / 1000;
    if (left <= 0 && !this.fired) { this.fired = true; if (S.settings.vibrate && navigator.vibrate) navigator.vibrate([300, 150, 300]); }
    if (left < -15) { this.end = 0; bar.hidden = true; return; }
    bar.hidden = false;
    bar.classList.toggle('over', left <= 0);
    bar.querySelector('.t-time').textContent = left > 0 ? mmss(left) : 'Go!';
    bar.querySelector('.t-fill').style.width = Math.max(0, Math.min(100, (left / this.total) * 100)) + '%';
  },
};
setInterval(() => Timer.tick(), 500);

// ---------- keep screen awake during workouts ----------
let wakeLock = null;
async function updateWakeLock() {
  const want = S.settings.wakeLock && view.name === 'workout' && S.draft && document.visibilityState === 'visible';
  try {
    if (want && !wakeLock && 'wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!want && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (_) { /* not supported or denied — fine */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && S.draft) { clearTimeout(draftTimer); save.draft(); }
  updateWakeLock();
});

// ---------- backup / export ----------
function backupObj() {
  return { app: 'gym-tracker', schema: 1, version: APP_VERSION, exportedAt: new Date().toISOString(),
    programs: S.programs, activeId: S.activeId, maxes: S.maxes, settings: S.settings, sessions: S.sessions };
}
const stamp = () => new Date().toISOString().slice(0, 10);
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function markBackedUp() { S.settings.lastBackup = new Date().toISOString(); await save.settings(); }
function toCsv() {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const lines = [['date', 'program', 'day', 'exercise', 'set_no', 'type', 'target_kg', 'target_reps', 'kg', 'reps', 'e1rm'].join(',')];
  [...S.sessions].reverse().forEach(s => s.entries.forEach(e => e.sets.forEach((x, n) => {
    const t = x.target || {};
    const e1 = x.type !== 'warmup' ? Calc.e1rm(x.kg, x.reps) : null;
    lines.push([s.date.slice(0, 10), s.programName, s.dayName, e.name, n + 1, x.type, t.kg ?? '',
      (t.reps ?? '') + (t.repsMax ? '-' + t.repsMax : '') + (t.amrap ? '+' : ''), x.kg ?? '', x.reps ?? '', e1 ? e1.toFixed(1) : ''].map(q).join(','));
  })));
  return lines.join('\n');
}
async function importBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { return alert('That file is not a valid backup.'); }
  if (d.app !== 'gym-tracker' || !Array.isArray(d.programs) || !Array.isArray(d.sessions)) return alert('That file is not a Gym Tracker backup.');
  if (!confirm(`Replace ALL data on this phone with this backup?\n\nExported: ${d.exportedAt ? fmtDateY(d.exportedAt) : 'unknown'}\n${d.programs.length} program(s), ${d.sessions.length} workout(s)`)) return;
  S.programs = d.programs; S.activeId = d.activeId || d.programs[0]?.id; S.maxes = d.maxes || {};
  S.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
  await save.programs(); await save.active(); await save.maxes(); await save.settings();
  await DB.clearSessions();
  for (const s of d.sessions) await DB.putSession(s);
  S.sessions = [...d.sessions].sort((a, b) => b.date.localeCompare(a.date));
  toast('Backup restored');
  go('home', {}, true);
}
async function fillPersistStatus() {
  const el = $('#persist'); if (!el || !navigator.storage?.persisted) { if (el) el.textContent = ''; return; }
  const ok = await navigator.storage.persisted();
  el.innerHTML = ok ? '✅ Storage is marked persistent (the browser won\'t clear it automatically).'
    : '⚠️ Storage not yet persistent. Installing the app to your home screen usually fixes this.';
}

// ================= ACTIONS (buttons) =================
const curSet = el => { const r = el.closest('.set'); return { e: S.draft.entries[+r.dataset.e], s: S.draft.entries[+r.dataset.e].sets[+r.dataset.s] }; };
const curEx = () => findEx(view.dayId, view.exId);

const ACT = {
  nav: el => go(el.dataset.v),
  go: el => go(el.dataset.v, { id: el.dataset.id, dayId: el.dataset.day, exId: el.dataset.ex, name2: el.dataset.name }),
  back: () => history.back(),

  // workout
  start(el) {
    if (S.draft && !confirm('A workout is already in progress. Discard it and start this one?')) return;
    const p = activeProgram(), day = findDay(el.dataset.id);
    S.draft = { id: uid(), programId: p.id, programName: p.name, dayId: day.id, dayName: day.name,
      startedAt: new Date().toISOString(), notes: '', entries: day.exercises.map(buildEntry) };
    save.draft(); go('workout');
  },
  tick(el) {
    const { s } = curSet(el);
    s.done = !s.done;
    if (s.done) {
      if (s.reps == null) s.reps = s.target.reps;
      if (S.settings.autoRest) Timer.start();
    }
    save.draft(); rerender();
  },
  addSet(el) {
    const e = S.draft.entries[+el.dataset.e], last = e.sets[e.sets.length - 1];
    const n = last ? { ...clone(last), done: false, reps: null, prevKg: null, prevReps: null }
      : { type: 'working', target: { kg: null, pct: null, reps: 10, repsMax: null, amrap: false, rir: null }, kg: null, reps: null, done: false };
    e.sets.push(n); save.draft(); rerender();
  },
  removeSet(el) {
    const e = S.draft.entries[+el.dataset.e];
    if (!e.sets.length) return;
    if (e.sets[e.sets.length - 1].done && !confirm('The last set is already ticked. Remove it?')) return;
    e.sets.pop(); save.draft(); rerender();
  },
  skip(el) { const e = S.draft.entries[+el.dataset.e]; e.skipped = !e.skipped; save.draft(); rerender(); },
  timerStart: () => Timer.start(),
  timerAdd: el => Timer.add(+el.dataset.d),
  timerStop: () => Timer.stop(),
  async discard() {
    if (!confirm('Discard this workout? Nothing will be saved.')) return;
    S.draft = null; await save.draft(); Timer.stop(); go('home', {}, true);
  },
  async finish() {
    const d = S.draft;
    const entries = d.entries.filter(e => !e.skipped).map(e => ({
      exId: e.exId, name: e.name, maxKey: e.maxKey, superset: e.superset, perSide: e.perSide,
      sets: e.sets.map((x, i) => ({ i, type: x.type, target: x.target, kg: x.kg, reps: x.reps, done: x.done }))
        .filter(x => x.done).map(({ done, ...rest }) => rest),
    })).filter(e => e.sets.length);
    if (!entries.length) { alert('No sets ticked yet — tick ✓ on the sets you completed.'); return; }
    const untick = d.entries.filter(e => !e.skipped).reduce((a, e) => a + e.sets.filter(x => !x.done).length, 0);
    if (untick && !confirm(`${untick} set(s) not ticked will not be saved. Finish anyway?`)) return;
    const session = { id: d.id, date: d.startedAt, endedAt: new Date().toISOString(), programId: d.programId,
      programName: d.programName, dayId: d.dayId, dayName: d.dayName, notes: d.notes, entries };
    await DB.putSession(session);
    S.sessions.unshift(session); S.sessions.sort((a, b) => b.date.localeCompare(a.date));
    S.draft = null; await save.draft(); Timer.stop();
    toast('Workout saved 💪');
    go('session', { id: session.id }, true);
  },
  async delSession(el) {
    if (!confirm('Delete this workout from history?')) return;
    await DB.delSession(el.dataset.id);
    S.sessions = S.sessions.filter(s => s.id !== el.dataset.id);
    history.back();
  },

  // maxes
  useEst(el) { S.maxes[el.dataset.k] = { kg: num(el.dataset.kg), updated: new Date().toISOString() }; save.maxes(); rerender(); toast('Max updated'); },
  addMax() {
    const k = $('#newMaxKey').value.trim(); if (!k) return;
    if (!S.maxes[k]) S.maxes[k] = { kg: null }; save.maxes(); rerender();
  },
  delMax(el) {
    const k = el.dataset.id;
    if (!confirm(`Remove the "${k}" max? (It reappears empty if an exercise still links to it.)`)) return;
    delete S.maxes[k]; save.maxes(); rerender();
  },

  // program editor
  newProgram() {
    const p = { id: uid(), name: 'New program', days: [{ id: uid(), name: 'Day 1', target: '', exercises: [] }] };
    S.programs.push(p); S.activeId = p.id; save.programs(); save.active(); rerender();
  },
  dupProgram() {
    const p = clone(activeProgram()); p.id = uid(); p.name += ' (copy)';
    p.days.forEach(d => { d.id = uid(); d.exercises.forEach(e => e.id = uid()); });
    S.programs.push(p); S.activeId = p.id; save.programs(); save.active(); rerender();
  },
  delProgram() {
    const p = activeProgram();
    if (S.programs.length < 2 || !confirm(`Delete program "${p.name}"? Logged workouts are kept.`)) return;
    S.programs = S.programs.filter(x => x.id !== p.id); S.activeId = S.programs[0].id;
    save.programs(); save.active(); rerender();
  },
  addDay() {
    const p = activeProgram(); const d = { id: uid(), name: `Day ${p.days.length + 1}`, target: '', exercises: [] };
    p.days.push(d); save.programs(); go('editDay', { dayId: d.id });
  },
  moveDayUp: el => { const a = activeProgram().days; move(a, a.findIndex(d => d.id === el.dataset.id), -1); save.programs(); rerender(); },
  moveDayDown: el => { const a = activeProgram().days; move(a, a.findIndex(d => d.id === el.dataset.id), 1); save.programs(); rerender(); },
  delDay(el) {
    const p = activeProgram(), d = p.days.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete "${d.name}" and its exercises?`)) return;
    p.days = p.days.filter(x => x.id !== d.id); save.programs(); rerender();
  },
  addEx() {
    const d = findDay(view.dayId);
    const s = () => ({ type: 'working', load: { mode: 'kg', value: null }, reps: 8, repsMax: 10, amrap: false, rir: null });
    const e = { id: uid(), name: 'New exercise', notes: '', maxKey: '', inc: 1.25, superset: '', perSide: false, optional: false, sets: [s(), s(), s()] };
    d.exercises.push(e); save.programs(); go('editEx', { dayId: d.id, exId: e.id });
  },
  moveExUp: el => { const a = findDay(view.dayId).exercises; move(a, a.findIndex(e => e.id === el.dataset.id), -1); save.programs(); rerender(); },
  moveExDown: el => { const a = findDay(view.dayId).exercises; move(a, a.findIndex(e => e.id === el.dataset.id), 1); save.programs(); rerender(); },
  dupEx(el) {
    const a = findDay(view.dayId).exercises, i = a.findIndex(e => e.id === el.dataset.id);
    const c = clone(a[i]); c.id = uid(); c.name += ' (copy)'; a.splice(i + 1, 0, c); save.programs(); rerender();
  },
  delEx(el) {
    const d = findDay(view.dayId), e = d.exercises.find(x => x.id === el.dataset.id);
    if (!confirm(`Delete "${e.name}"?`)) return;
    d.exercises = d.exercises.filter(x => x.id !== e.id); save.programs(); rerender();
  },
  addSetDef(el) {
    const ex = curEx(), t = el.dataset.t;
    const like = [...ex.sets].reverse().find(s => s.type === t);
    const n = like ? clone(like) : { type: t, load: { mode: 'kg', value: null }, reps: t === 'warmup' ? 5 : 8, repsMax: null, amrap: false, rir: null };
    // keep sets grouped: insert after the last set of the same type (or in natural order)
    const order = ['warmup', 'working', 'backoff'];
    let idx = ex.sets.length;
    for (let i = ex.sets.length - 1; i >= 0; i--) { if (order.indexOf(ex.sets[i].type) <= order.indexOf(t)) { idx = i + 1; break; } if (i === 0) idx = 0; }
    ex.sets.splice(idx, 0, n); save.programs(); rerender();
  },
  dupSetDef(el) { const ex = curEx(), i = +el.closest('.set-ed').dataset.si; ex.sets.splice(i + 1, 0, clone(ex.sets[i])); save.programs(); rerender(); },
  delSetDef(el) { const ex = curEx(), i = +el.closest('.set-ed').dataset.si; ex.sets.splice(i, 1); save.programs(); rerender(); },
  toPct() {
    const ex = curEx(), max = maxOf(ex.maxKey);
    if (!confirm(`Convert fixed kg sets to % of your ${ex.maxKey} max (${fmtKg(max)} kg)? Future weights will then follow your max.`)) return;
    ex.sets.forEach(s => { if (s.load.mode === 'kg' && s.load.value) s.load = { mode: 'pct', value: Math.round(s.load.value / max * 1000) / 10 }; });
    save.programs(); rerender(); toast('Converted to %');
  },

  // data
  exportJson: async () => { download(`gym-backup-${stamp()}.json`, JSON.stringify(backupObj(), null, 1), 'application/json'); await markBackedUp(); rerender(); },
  async shareJson() {
    const name = `gym-backup-${stamp()}.json`;
    const file = new File([JSON.stringify(backupObj(), null, 1)], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'Gym Tracker backup' }); await markBackedUp(); rerender(); }
      catch (e) { if (e.name !== 'AbortError') toast('Sharing failed — try Download instead'); }
    } else { ACT.exportJson(); }
  },
  exportCsv: () => download(`gym-sets-${stamp()}.csv`, toCsv(), 'text/csv'),
  importClick: () => $('#importInput').click(),
  addSample() {
    const p = seedProgram(); S.programs.push(p); S.activeId = p.id;
    for (const [k, v] of Object.entries(seedMaxes())) if (!S.maxes[k]) S.maxes[k] = v;
    save.programs(); save.active(); save.maxes(); toast('Sample program added'); go('program');
  },
};

// ================= CHANGE handlers (inputs, on blur/commit) =================
const CH = {
  activeProgram: (el, v) => { S.activeId = v; save.active(); },
  progName: (el, v) => { activeProgram().name = v.trim() || 'Program'; save.programs(); },
  dayField: (el, v) => { findDay(view.dayId)[el.dataset.f] = v; save.programs(); },
  exField(el, v) {
    const ex = curEx(), f = el.dataset.f;
    ex[f] = f === 'inc' ? num(v) : typeof v === 'string' ? v.trim() : v;
    if (f === 'maxKey' && ex.maxKey && !S.maxes[ex.maxKey]) { S.maxes[ex.maxKey] = { kg: null }; save.maxes(); }
    save.programs();
  },
  setField(el, v) {
    const ex = curEx(), s = ex.sets[+el.closest('.set-ed').dataset.si], f = el.dataset.f;
    if (f === 'type') s.type = v;
    else if (f === 'mode') s.load.mode = v;
    else if (f === 'value') s.load.value = num(v);
    else if (f === 'amrap') s.amrap = v;
    else s[f] = num(v); // reps, repsMax, rir
    save.programs();
  },
  max(el, v) { S.maxes[el.dataset.k] = { kg: num(v), updated: new Date().toISOString() }; save.maxes(); },
  setting(el, v) { const f = el.dataset.f; S.settings[f] = f === 'restSec' ? (num(v) || 120) : v; save.settings(); },
};

function setEditor(ex, s, si) {
  const t = Calc.targetKg(ex, s);
  const opt = (val, label, cur) => `<option value="${val}" ${val === cur ? 'selected' : ''}>${label}</option>`;
  return `<div class="set-ed t-${s.type}" data-si="${si}">
    <div class="se-row"><span class="se-n">${si + 1}</span>
      <select data-ch="setField" data-f="type">${Object.entries(TYPE).map(([k, v]) => opt(k, v.label, s.type)).join('')}</select>
      <input class="sm-in" inputmode="decimal" data-ch="setField" data-f="value" value="${s.load.value ?? ''}" placeholder="—">
      <select data-ch="setField" data-f="mode">${opt('kg', 'kg', s.load.mode)}${opt('pct', '% max', s.load.mode)}</select>
      ${s.load.mode === 'pct' ? `<span class="muted small">= ${t != null ? fmtKg(t) + ' kg' : '?'}</span>` : ''}
    </div>
    <div class="se-row">
      <label>Reps <input class="xs-in" inputmode="numeric" data-ch="setField" data-f="reps" value="${s.reps ?? ''}"></label>
      <label>to <input class="xs-in" inputmode="numeric" data-ch="setField" data-f="repsMax" value="${s.repsMax ?? ''}" placeholder="–"></label>
      <label>RIR <input class="xs-in" inputmode="decimal" data-ch="setField" data-f="rir" value="${s.rir ?? ''}" placeholder="–"></label>
      <label class="chk"><input type="checkbox" data-ch="setField" data-f="amrap" ${s.amrap ? 'checked' : ''}> AMRAP</label>
      <span class="grow"></span>
      <button class="btn icon sm" data-act="dupSetDef" title="Duplicate">⧉</button>
      <button class="btn icon sm danger" data-act="delSetDef" title="Delete">✕</button>
    </div></div>`;
}

// ================= event wiring =================
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACT[el.dataset.act];
  if (fn) { ev.preventDefault(); fn(el); }
});

// Live typing in the workout screen (no re-render, so the keyboard stays open)
document.addEventListener('input', ev => {
  const el = ev.target, k = el.dataset.in;
  if (!k || !S.draft) return;
  if (k === 'notes') { S.draft.notes = el.value; saveDraftSoon(); return; }
  const { e, s } = curSet(el);
  s[k] = num(el.value);
  saveDraftSoon();
  const hint = el.closest('.set').querySelector('.set-hint');
  if (hint) hint.innerHTML = hintHtml(e, s);
});

document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.id === 'importInput') { if (el.files[0]) importBackup(el.files[0]); el.value = ''; return; }
  const fn = CH[el.dataset.ch];
  if (!fn) return;
  fn(el, el.type === 'checkbox' ? el.checked : el.value);
  // Re-draw only for selects/checkboxes (re-drawing after text edits would steal focus from the next field)
  if (el.tagName === 'SELECT' || el.type === 'checkbox' || el.dataset.rr) rerender();
});

// ================= start-up =================
(async function init() {
  await load();
  history.replaceState(view, '');
  render();
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) toast('App updated — it will refresh next time you open it', 4000);
    });
  }
})();
