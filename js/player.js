// Player page: join with a group name, wait in the lobby, answer questions.
// Players never see scores or whether an answer was right; the security
// rules enforce that, this file only keeps the screen honest.

import { $, h, confirmDialog, closeConfirm } from './dom.js';
import { parseNumber } from './scoring.js';
import { groupNameKey } from './names.js';
import { createSorter, seededShuffle } from './dragsort.js';

const HEARTBEAT_MS = 10000;
const BLUR_DEBOUNCE_MS = 1000;
const AWAY_KEY = 'pq-away';
const SKIP_CONFIRM_KEY = 'pq-skip-confirm';
const CURRENCY = { EUR: '€', USD: '$' };

// ---------- state ----------

const S = {
  uid: null,
  game: undefined, // undefined = loading, null = no game yet
  group: undefined, // undefined = loading, null = not joined
  answers: {}, // itemId -> 'loading' | 'none' | 'sending' | 'sent' | 'rejected'
  offset: 0, // server clock minus local clock, in ms
  timeUp: false,
  joinBusy: false,
  joinName: '',
  joinError: '',
  fatal: '',
};

let backend = null;
let lastViewKey = null;

const now = () => Date.now() + S.offset;
const isAnswerPhase = (phase) => phase === 'question_open' || phase === 'question_closed';

// ---------- drafts (survive a reload during a question) ----------

function loadDraft(itemId) {
  try {
    return JSON.parse(sessionStorage.getItem(`pq-draft-${itemId}`));
  } catch {
    return null;
  }
}

function saveDraft(itemId, value) {
  try {
    sessionStorage.setItem(`pq-draft-${itemId}`, JSON.stringify(value));
  } catch { /* storage unavailable: the draft just does not survive a reload */ }
}

// ---------- rendering ----------

function status(icon, title, text, kind = '') {
  return h('div', { class: `status ${kind}` },
    h('div', { class: 'icon' }, icon),
    h('h1', {}, title),
    text && h('p', {}, text));
}

function viewKey() {
  const g = S.game;
  const itemId = g?.itemId;
  return JSON.stringify([
    S.fatal, g === undefined, S.group === undefined,
    g && [g.phase, itemId, g.itemType, g.roundNumber, g.roundTitle, g.registrationOpen, g.publicPayload],
    S.group && [S.group.name, S.group.disqualified],
    itemId && S.answers[itemId], S.timeUp, S.joinBusy, S.joinError,
  ]);
}

function render() {
  updateTopbar();
  const key = viewKey();
  if (key === lastViewKey) return;
  lastViewKey = key;
  closeConfirm();
  $('view').replaceChildren(...[buildView()].flat().filter(Boolean));
}

function updateTopbar() {
  const g = S.game;
  const joined = Boolean(S.group && g);
  $('topbar').hidden = !joined;
  if (!joined) return;
  $('who').textContent = S.group.name;
  const parts = [];
  if (g.roundNumber && g.phase !== 'lobby' && g.phase !== 'finished') parts.push(`Ronde ${g.roundNumber}`);
  if (g.itemLabel && (isAnswerPhase(g.phase) || g.phase === 'reveal')) parts.push(g.itemLabel);
  $('where').textContent = parts.join(' · ') || 'Pubquiz';
  updateTimer();
}

function updateTimer() {
  const g = S.game;
  const timer = $('timer');
  const running = Boolean(S.group && g && g.phase === 'question_open' && g.deadline);
  timer.hidden = !running;
  const timeUp = running && g.deadline - now() <= 0;
  if (running) {
    const seconds = Math.max(0, Math.ceil((g.deadline - now()) / 1000));
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    timer.classList.toggle('low', seconds <= 10);
  }
  if (timeUp !== S.timeUp) {
    S.timeUp = timeUp;
    render();
  }
}

function buildView() {
  if (S.fatal) return status('⚠️', 'Er ging iets mis', S.fatal, 'bad');
  const g = S.game;
  if (g === undefined || S.group === undefined) return status('🍺', 'Laden…');
  if (g === null) return status('🍺', 'De quiz is nog niet geopend', 'Dit scherm springt vanzelf verder.');
  if (!S.group) return g.registrationOpen ? joinView() : status('🚪', 'Aanmelden is gesloten', 'Vraag de quizmaster om hulp.');
  if (S.group.disqualified) return status('🚫', 'Jullie groepje doet niet meer mee', 'Vraag de quizmaster om uitleg.', 'bad');

  switch (g.phase) {
    case 'lobby':
      return status('🍻', `Welkom, ${S.group.name}!`, 'Jullie zijn aangemeld. De quiz begint zo.');
    case 'round_intro':
      return status('📣', `Ronde ${g.roundNumber}`, g.roundTitle);
    case 'question_open':
    case 'question_closed':
      return questionView(g);
    case 'reveal':
      return status('⏳', 'Even wachten', 'De volgende vraag komt eraan.');
    case 'round_scoreboard':
      return status('📊', `Einde van ronde ${g.roundNumber}`, 'Kijk naar het grote scherm.');
    case 'finished':
      return status('🎉', 'De quiz is afgelopen', 'Bedankt voor het meedoen!');
    default:
      return status('⏳', 'Even wachten');
  }
}

function joinView() {
  const input = h('input', {
    type: 'text', maxLength: 24, placeholder: 'Groepsnaam', autocomplete: 'off', autocapitalize: 'words',
    enterKeyHint: 'go', disabled: S.joinBusy, 'aria-label': 'Groepsnaam', value: S.joinName,
  });
  const error = h('p', { class: 'error', role: 'alert' }, S.joinError);
  const button = h('button', { class: 'btn primary', type: 'submit', disabled: S.joinBusy },
    S.joinBusy ? 'Bezig…' : 'Meedoen');
  const form = h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      const name = input.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2 || name.length > 24) {
        error.textContent = 'Kies een naam van 2 tot 24 tekens.';
        return;
      }
      if (groupNameKey(name).length < 2) {
        error.textContent = 'Gebruik minstens 2 letters of cijfers.';
        return;
      }
      join(name);
    },
  },
  h('div', { class: 'status' },
    h('div', { class: 'icon' }, '🍺'),
    h('h1', {}, 'Doe mee met de pubquiz'),
    h('p', {}, 'Eén telefoon per groepje. Kies een groepsnaam.')),
  h('div', { class: 'field' }, input),
  error,
  h('div', { class: 'actions' }, button));
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px;flex:1';
  return form;
}

async function join(name) {
  S.joinBusy = true;
  S.joinName = name;
  S.joinError = '';
  render();
  try {
    await backend.join(name);
  } catch (error) {
    S.joinError = error.userMessage ?? 'Aanmelden is niet gelukt. Probeer het opnieuw.';
  }
  S.joinBusy = false;
  render();
}

function questionView(g) {
  const open = g.phase === 'question_open' && !S.timeUp;
  if (g.itemType === 'bonus_manual') {
    return status('🎁', 'Bonusronde!', 'Kijk naar het grote scherm. Hier hoef je niets in te vullen.');
  }
  const state = S.answers[g.itemId];
  if (state === undefined || state === 'loading') return status('🍺', 'Laden…');
  if (state === 'sent') return status('✅', 'Antwoord ingediend', 'Jullie antwoord is binnen en staat vast.', 'ok');
  if (state === 'sending') return status('📨', 'Bezig met versturen…', 'Houd dit scherm open.');
  if (state === 'rejected') {
    return [
      status('⛔', 'Niet ontvangen', 'Het antwoord kwam niet op tijd binnen of de vraag was al gesloten.', 'bad'),
      open && h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => setAnswerState(g.itemId, 'none') }, 'Opnieuw proberen')),
    ];
  }
  if (!open) {
    return S.timeUp && g.phase === 'question_open'
      ? status('⏰', 'Tijd is op', 'Er is geen antwoord ingediend.', 'bad')
      : status('🔒', 'Vraag gesloten', 'Er is geen antwoord ingediend.');
  }
  return answerForm(g);
}

function answerForm(g) {
  const payload = g.publicPayload ?? {};
  const itemId = g.itemId;
  let value = loadDraft(itemId);
  const error = h('p', { class: 'error', role: 'alert' });
  const submit = h('button', { class: 'btn primary', type: 'button', onclick: () => submitAnswer(g, value) }, 'Indienen');

  const update = (next) => {
    value = next;
    saveDraft(itemId, next);
    submit.disabled = !isComplete(g.itemType, next);
    const typed = typeof next === 'string' && next.trim() !== '';
    error.textContent = isNumberType(g.itemType) && typed && parseNumber(next) == null ? 'Vul een getal in.' : '';
  };

  let prompt = 'Vul jullie antwoord in';
  let control;
  if (g.itemType === 'mc') {
    prompt = 'Kies jullie antwoord';
    const letters = 'ABCDEF'.slice(0, payload.options ?? 4).split('');
    const buttons = letters.map((letter) => h('button', {
      class: 'choice', type: 'button', 'aria-pressed': String(value === letter),
      onclick: () => {
        buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.textContent === letter)));
        update(letter);
      },
    }, letter));
    control = h('div', { class: 'choices' }, buttons);
  } else if (isNumberType(g.itemType)) {
    const symbol = CURRENCY[payload.currency];
    control = h('div', { class: 'field' },
      symbol && h('span', { class: 'affix' }, symbol),
      h('input', {
        type: 'text', inputmode: 'decimal', autocomplete: 'off', maxLength: 20, enterKeyHint: 'done',
        placeholder: payload.hint ?? (symbol ? 'Bedrag' : 'Getal'), value: typeof value === 'string' ? value : '',
        'aria-label': 'Antwoord', oninput: (event) => update(event.target.value),
      }),
      payload.unit && h('span', { class: 'affix' }, payload.unit));
  } else if (g.itemType === 'name') {
    prompt = 'Wie was het?';
    control = h('div', { class: 'field' }, h('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'words', autocorrect: 'off', maxLength: 40,
      enterKeyHint: 'done', placeholder: 'Naam', value: typeof value === 'string' ? value : '',
      'aria-label': 'Naam', oninput: (event) => update(event.target.value),
    }));
  } else if (g.itemType === 'sort_two_bins') {
    prompt = 'Zet elke naam in het goede vak';
    const names = seededShuffle(payload.names ?? [], `${S.uid}:${itemId}`);
    control = createSorter({
      names, bins: payload.bins ?? [], placement: value && typeof value === 'object' ? value : {}, onChange: update,
    }).element;
    if (!value || typeof value !== 'object') value = {};
  } else {
    return status('⏳', 'Even wachten');
  }

  submit.disabled = !isComplete(g.itemType, value);
  return [
    h('p', { class: 'prompt' }, prompt),
    g.itemType === 'sort_two_bins' && h('p', { class: 'hint' }, 'Houd een naam even vast en sleep hem naar een vak. Tikken kan ook: eerst de naam, dan het vak.'),
    control,
    error,
    h('div', { class: 'actions' }, submit),
  ];
}

const isNumberType = (type) => type === 'exact_number' || type === 'margin_number' || type === 'closest_rank';

function isComplete(type, value) {
  if (type === 'mc') return typeof value === 'string' && value !== '';
  if (isNumberType(type)) return typeof value === 'string' && parseNumber(value) != null;
  if (type === 'name') return typeof value === 'string' && value.trim() !== '';
  if (type === 'sort_two_bins') return value != null && typeof value === 'object';
  return false;
}

function describeAnswer(g, value) {
  const payload = g.publicPayload ?? {};
  if (g.itemType === 'sort_two_bins') {
    const total = (payload.names ?? []).length;
    const placed = Object.keys(value).length;
    return { text: `${placed} van de ${total} namen geplaatst`, warn: placed < total && 'Namen die niet geplaatst zijn, tellen als fout.' };
  }
  const text = String(value).trim();
  if (isNumberType(g.itemType)) {
    return { text: [CURRENCY[payload.currency], text, payload.unit].filter(Boolean).join(' ') };
  }
  return { text };
}

function skipConfirm() {
  try {
    return localStorage.getItem(SKIP_CONFIRM_KEY) === '1';
  } catch {
    return false;
  }
}

async function submitAnswer(g, value) {
  if (!isComplete(g.itemType, value)) return;
  const { text, warn } = describeAnswer(g, value);
  // The group can switch the confirmation off. A warning is always shown.
  if (warn || !skipConfirm()) {
    const dontAsk = h('input', { type: 'checkbox' });
    const ok = await confirmDialog({
      title: 'Weet je het zeker?',
      body: [
        h('p', {}, 'Jullie antwoord:'),
        h('p', { class: 'answer' }, text),
        warn && h('p', { class: 'warn' }, warn),
        h('p', {}, 'Indienen is definitief. Daarna kun je niets meer wijzigen.'),
        h('label', { class: 'check' }, dontAsk, 'Dit niet meer vragen'),
      ],
      okLabel: 'Ja, indienen',
    });
    if (!ok) return;
    if (dontAsk.checked) {
      try {
        localStorage.setItem(SKIP_CONFIRM_KEY, '1');
      } catch { /* storage unavailable: keep asking */ }
    }
  }
  const cleaned = typeof value === 'string' ? value.trim() : value;
  setAnswerState(g.itemId, 'sending');
  try {
    await backend.submitAnswer(g.itemId, cleaned);
    setAnswerState(g.itemId, 'sent');
  } catch {
    // Either it was too late, or it had already been submitted before.
    const exists = await backend.hasAnswer(g.itemId).catch(() => false);
    setAnswerState(g.itemId, exists ? 'sent' : 'rejected');
  }
}

function setAnswerState(itemId, state) {
  S.answers[itemId] = state;
  render();
}

/** Find out whether this group already answered the current item. */
function ensureAnswerState() {
  const g = S.game;
  if (!g || !S.group || !isAnswerPhase(g.phase) || !g.itemId || g.itemType === 'bonus_manual') return;
  if (S.answers[g.itemId] !== undefined) return;
  const itemId = g.itemId;
  S.answers[itemId] = 'loading';
  backend.hasAnswer(itemId)
    .then((exists) => setAnswerState(itemId, exists ? 'sent' : 'none'))
    .catch(() => setAnswerState(itemId, 'none'));
}

// ---------- tab-leave detection ----------
// Only reported while a question is open. Mobile browsers often freeze the
// page before the "leave" write gets out, so the return is always reported
// too, with how long the group was away.

const away = { since: null, kind: null, itemId: null };
let blurTimer = null;

function leave(kind, since = Date.now()) {
  const g = S.game;
  if (away.since || !S.group || !g || g.phase !== 'question_open') return;
  Object.assign(away, { since, kind, itemId: g.itemId });
  try {
    localStorage.setItem(AWAY_KEY, JSON.stringify(away));
  } catch { /* ignore */ }
  backend.sendEvent({ type: `leave_${kind}`, awayMs: null, itemId: g.itemId, phase: g.phase });
}

function comeBack(source) {
  if (!away.since) return;
  // An offline period only ends when the connection is back, and vice versa.
  if ((away.kind === 'offline') !== (source === 'net')) return;
  backend.sendEvent({
    type: `return_${away.kind}`, awayMs: Date.now() - away.since, itemId: away.itemId, phase: S.game?.phase ?? null,
  });
  Object.assign(away, { since: null, kind: null, itemId: null });
  try {
    localStorage.removeItem(AWAY_KEY);
  } catch { /* ignore */ }
}

/** The page was reloaded or killed while away: report it once we can. */
function reportInterruptedAbsence() {
  if (away.since || !S.group || !S.game) return;
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(AWAY_KEY));
    localStorage.removeItem(AWAY_KEY);
  } catch { /* ignore */ }
  if (!stored?.since) return;
  backend.sendEvent({
    type: `return_${stored.kind ?? 'hidden'}`, awayMs: Date.now() - stored.since,
    itemId: stored.itemId ?? null, phase: S.game.phase,
  });
}

function watchPresence() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') leave('hidden');
    else comeBack('view');
  });
  window.addEventListener('pagehide', () => leave('hidden'));
  window.addEventListener('pageshow', () => comeBack('view'));
  window.addEventListener('blur', () => {
    clearTimeout(blurTimer);
    const lostAt = Date.now();
    blurTimer = setTimeout(() => {
      if (!document.hasFocus()) leave('blur', lostAt);
    }, BLUR_DEBOUNCE_MS);
  });
  window.addEventListener('focus', () => {
    clearTimeout(blurTimer);
    comeBack('view');
  });
  const showConnection = () => {
    $('offline').hidden = navigator.onLine;
  };
  window.addEventListener('offline', () => {
    showConnection();
    leave('offline');
  });
  window.addEventListener('online', () => {
    showConnection();
    comeBack('net');
  });
  showConnection();

  setInterval(() => {
    if (S.group && document.visibilityState === 'visible') backend.heartbeat();
  }, HEARTBEAT_MS);
}

/** Called by the backend whenever game or group data changed. */
function onData() {
  ensureAnswerState();
  reportInterruptedAbsence();
  render();
}

// ---------- backends ----------

async function firebaseBackend() {
  const fb = await import('./firebase.js');
  if (!fb.isConfigured) throw new Error('Firebase is nog niet ingesteld.');
  const { auth, db } = fb.connect('player');
  const groupRef = () => fb.doc(db, 'groups', S.uid);
  const answerRef = (itemId) => fb.doc(db, 'answers', `${itemId}_${S.uid}`);

  // Clock offset: compare the server timestamp of our own heartbeat with the
  // local time around the write. The fastest round trip gives the best guess.
  let probe = null;
  let bestRoundTrip = Infinity;
  let lastSeenMs = 0;
  function measureOffset(data) {
    const seen = data?.lastSeen?.toMillis?.();
    if (!seen || seen === lastSeenMs) return;
    lastSeenMs = seen;
    if (!probe) return;
    const roundTrip = Date.now() - probe;
    bestRoundTrip *= 1.2;
    if (roundTrip <= bestRoundTrip) {
      bestRoundTrip = roundTrip;
      S.offset = seen - (probe + roundTrip / 2);
    }
    probe = null;
  }

  const api = {
    async join(name) {
      const nameKey = groupNameKey(name);
      const batch = fb.writeBatch(db);
      batch.set(groupRef(), {
        name, nameKey, createdAt: fb.serverTimestamp(), lastSeen: fb.serverTimestamp(), disqualified: false,
      });
      batch.set(fb.doc(db, 'groupNames', nameKey), { uid: S.uid });
      probe = Date.now();
      try {
        await batch.commit();
      } catch (error) {
        const taken = await fb.getDoc(fb.doc(db, 'groupNames', nameKey)).then((s) => s.exists()).catch(() => false);
        if (taken) error.userMessage = 'Deze naam is al bezet. Kies een andere.';
        else if (S.game && !S.game.registrationOpen) error.userMessage = 'Aanmelden is gesloten.';
        throw error;
      }
    },
    hasAnswer: (itemId) => fb.getDoc(answerRef(itemId)).then((snap) => snap.exists()),
    submitAnswer: (itemId, value) => fb.setDoc(answerRef(itemId), {
      groupId: S.uid, itemId, value, submittedAt: fb.serverTimestamp(),
    }),
    heartbeat() {
      probe = Date.now();
      fb.updateDoc(groupRef(), { lastSeen: fb.serverTimestamp() }).catch(() => {});
    },
    sendEvent(event) {
      fb.addDoc(fb.collection(db, 'events'), { groupId: S.uid, at: fb.serverTimestamp(), ...event }).catch(() => {});
    },
  };

  const fail = () => {
    S.fatal = 'Geen toegang tot de quiz. Herlaad de pagina of vraag de quizmaster om hulp.';
    render();
  };

  fb.onSnapshot(fb.doc(db, 'game', 'state'), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    S.game = data && { ...data, deadline: data.deadline?.toMillis?.() ?? null };
    onData();
  }, fail);

  let stopGroup = null;
  let greeted = false;
  fb.onAuthStateChanged(auth, (user) => {
    if (!user) {
      fb.signInAnonymously(auth).catch(fail);
      return;
    }
    S.uid = user.uid;
    stopGroup?.();
    stopGroup = fb.onSnapshot(groupRef(), { includeMetadataChanges: true }, (snap) => {
      // Wait for the server's verdict, so a refused join never flashes the lobby.
      if (snap.metadata.hasPendingWrites) return;
      measureOffset(snap.data());
      S.group = snap.exists() ? snap.data() : null;
      if (S.group && !greeted) {
        greeted = true;
        api.heartbeat();
      }
      onData();
    }, fail);
  });

  return api;
}

// Preview without Firebase: index.html?demo=mc (or number, usd, km, name,
// sort, bonus, closed, lobby, intro, reveal, scoreboard, finished, join).
function demoBackend(kind) {
  const base = {
    phase: 'question_open', roundNumber: 2, roundTitle: 'Voorbeeldronde', itemId: `demo-${kind}`,
    itemLabel: 'Vraag 3', itemType: 'mc', deadline: Date.now() + 45000, registrationOpen: true, publicPayload: {},
  };
  const variants = {
    mc: { publicPayload: { options: 4 } },
    number: { itemType: 'closest_rank', publicPayload: { currency: 'EUR' } },
    usd: { itemType: 'closest_rank', publicPayload: { currency: 'USD' }, deadline: null },
    km: { itemType: 'closest_rank', publicPayload: { unit: 'km' }, deadline: null },
    year: { itemType: 'exact_number', publicPayload: { hint: 'Jaartal' }, deadline: null },
    name: { itemType: 'name', itemLabel: 'Quote 7', deadline: Date.now() + 12000 },
    sort: {
      itemType: 'sort_two_bins', itemLabel: 'Sorteer de namen', deadline: null,
      publicPayload: {
        bins: [{ id: 'a', label: 'Kaas' }, { id: 'b', label: 'Bier' }],
        names: ['Gouda', 'Hertog Jan', 'Edammer', 'Grolsch', 'Leerdammer', 'Jupiler', 'Maaslander', 'Brand', 'Beemster', 'Bavaria'],
      },
    },
    bonus: { itemType: 'bonus_manual', itemLabel: 'Bonus', deadline: null },
    closed: { phase: 'question_closed', deadline: null },
    lobby: { phase: 'lobby' },
    intro: { phase: 'round_intro' },
    reveal: { phase: 'reveal' },
    scoreboard: { phase: 'round_scoreboard' },
    finished: { phase: 'finished' },
    join: {},
  };
  S.uid = 'demo';
  S.game = { ...base, ...(variants[kind] ?? variants.mc) };
  S.group = kind === 'join' ? null : { name: 'De Demogroep', disqualified: false };
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  setTimeout(onData);
  return {
    async join(name) {
      await wait(400);
      S.group = { name, disqualified: false };
      S.game = { ...S.game, phase: 'lobby' };
    },
    hasAnswer: async () => false,
    submitAnswer: () => wait(600),
    heartbeat() {},
    sendEvent(event) {
      console.log('[demo] event', event);
    },
  };
}

// ---------- start ----------

async function start() {
  const demo = new URLSearchParams(location.search).get('demo');
  try {
    backend = demo ? demoBackend(demo) : await firebaseBackend();
  } catch (error) {
    S.fatal = error.message || 'De quiz kon niet worden geladen.';
    render();
    return;
  }
  watchPresence();
  setInterval(updateTimer, 250);
  render();
}

start();
