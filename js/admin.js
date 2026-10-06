// Admin panel: runs the whole game from a phone. Everything here is only
// possible for the admin account; the security rules enforce that.

import { $, h, confirmDialog } from './dom.js';
import * as fb from './firebase.js';
import { scoreItem, buildScoreboard, bonusPoints, parseNumber } from './scoring.js';
import { groupNameKey, matchName } from './names.js';

const QUIET_AFTER_MS = 25000;
const CURRENCY = { EUR: '€', USD: '$' };
const TYPE_LABEL = {
  mc: 'Meerkeuze', exact_number: 'Exact getal', margin_number: 'Getal met marge', closest_rank: 'Dichtst bij',
  sort_two_bins: 'Sorteren', name: 'Naam', bonus_manual: 'Bonus',
};
const PHASE_LABEL = {
  lobby: 'Lobby', round_intro: 'Ronde-intro', question_open: 'Vraag open', question_closed: 'Vraag gesloten',
  reveal: 'Antwoord', round_scoreboard: 'Scorebord', finished: 'Afgelopen',
};
const BEAMER_VIEWS = [['waiting', 'Wachten'], ['join', 'Aanmelden'], ['scoreboard', 'Scorebord']];

const DEBUG = location.hostname === 'localhost' && new URLSearchParams(location.search).has('debug');
const { auth, db } = fb.connect('admin');
const stateRef = fb.doc(db, 'game', 'state');
const quizRef = fb.doc(db, 'quiz', 'definition');
const col = (name) => fb.collection(db, name);
const entryRef = (id) => fb.doc(db, 'scoreEntries', id);

const A = {
  user: undefined, // undefined = unknown, null = logged out
  denied: false,
  loginError: '',
  quiz: undefined, // undefined = loading, null = not imported
  game: undefined,
  people: [],
  groups: [],
  entries: [],
  events: [],
  answers: [], // answers for the current item
  offset: 0,
  busy: false,
  sheet: null, // { name, arg }
  bonus: { itemId: null, order: [], points: {} },
};

let lastKey = null;
let sheetDirty = false;
let stopListening = [];
let stopAnswers = null;
let answersItemId = null;

// ---------- small helpers ----------

const serverNow = () => Date.now() + A.offset;
const activeGroups = () => A.groups.filter((g) => !g.disqualified);
const currentRound = () => A.quiz?.rounds?.[A.game?.roundIndex] ?? null;
const groupName = (id) => A.groups.find((g) => g.id === id)?.name ?? '(verwijderd groepje)';
const isQuiet = (g) => !g.isTest && serverNow() - (g.lastSeen ?? 0) > QUIET_AFTER_MS;
const penaltyAmount = () => Math.max(1, Number(localStorage.getItem('pq-penalty')) || 1);

function currentItem() {
  const item = currentRound()?.items?.[A.game?.itemIndex];
  return item && item.id === A.game.itemId ? item : null;
}

function findItem(itemId) {
  for (const round of A.quiz?.rounds ?? []) {
    const item = round.items.find((i) => i.id === itemId);
    if (item) return { round, item };
  }
  return null;
}

function itemTitle(itemId) {
  const found = findItem(itemId);
  return found ? `Ronde ${found.round.number} · ${found.item.label}` : '';
}

function fmtNumber(n, currency) {
  return Number(n).toLocaleString('nl-NL', { minimumFractionDigits: currency ? 2 : 0, maximumFractionDigits: 2 });
}

function fmtDuration(ms) {
  if (ms == null) return '?';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

function fmtTime(ms) {
  return ms ? new Date(ms).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}

function formatCorrect(item) {
  switch (item.type) {
    case 'mc':
      return item.correct || 'Nog niet ingevuld';
    case 'exact_number':
    case 'margin_number':
    case 'closest_rank': {
      if (item.correct == null) return 'Nog niet ingevuld';
      const parts = [CURRENCY[item.currency], fmtNumber(item.correct, item.currency), item.unit].filter(Boolean).join(' ');
      return item.type === 'margin_number' ? `${parts} (± ${fmtNumber(item.margin ?? 0)})` : parts;
    }
    case 'name': {
      const names = (item.correct ?? []).map((id) => A.people.find((p) => p.id === id)?.name ?? id);
      return names.length ? names.join(' / ') : 'Nog niet ingevuld';
    }
    case 'sort_two_bins':
      return `${Object.keys(item.correct ?? {}).length} namen, 1 punt per goed geplaatste naam`;
    default:
      return '';
  }
}

function formatAnswer(item, value) {
  if (value == null || value === '') return 'geen antwoord';
  if (item.type === 'sort_two_bins') return `${Object.keys(value).length} van ${item.names.length} geplaatst`;
  if (item.type === 'name') {
    const match = matchName(value, A.people);
    const person = match.personId && A.people.find((p) => p.id === match.personId)?.name;
    return person && person.toLowerCase() !== String(value).trim().toLowerCase() ? `${value} → ${person}` : String(value);
  }
  if (item.type !== 'mc') return [CURRENCY[item.currency], value, item.unit].filter(Boolean).join(' ');
  return String(value);
}

function payloadOf(item) {
  switch (item.type) {
    case 'mc':
      return { options: item.options ?? 4 };
    case 'sort_two_bins':
      return { names: item.names, bins: item.bins };
    case 'exact_number':
    case 'margin_number':
    case 'closest_rank':
      return { currency: item.currency ?? null, unit: item.unit ?? null, hint: item.hint ?? null };
    default:
      return {};
  }
}

function notify(text, bad = false) {
  const toast = h('div', { class: 'toast' }, h('div', { class: 'name' }, text));
  if (!bad) toast.style.borderColor = 'var(--accent)';
  $('toasts').append(toast);
  setTimeout(() => toast.remove(), bad ? 6000 : 2500);
}

/** Run an action with the buttons locked; report failures instead of hiding them. */
async function act(fn) {
  if (A.busy) return;
  A.busy = true;
  render();
  try {
    await fn();
  } catch (error) {
    console.error(error);
    notify(`Mislukt: ${error.code ?? error.message}`, true);
  }
  A.busy = false;
  render();
}

// ---------- game flow ----------

function cursor(roundIndex, itemIndex, phase, withItem) {
  const round = A.quiz.rounds[roundIndex];
  const item = withItem ? round.items[itemIndex] : null;
  return {
    phase, roundIndex, itemIndex,
    roundNumber: round.number, roundTitle: round.title,
    itemId: item?.id ?? null, itemLabel: item?.label ?? null, itemType: item?.type ?? null,
    publicPayload: item ? payloadOf(item) : {},
    deadline: null,
  };
}

function updateGame(patch) {
  return fb.updateDoc(stateRef, { ...patch, updatedAt: fb.serverTimestamp() });
}

const startRound = (roundIndex, itemIndex = 0) => updateGame(cursor(roundIndex, itemIndex, 'round_intro', false));

function openItem(roundIndex, itemIndex) {
  const patch = cursor(roundIndex, itemIndex, 'question_open', true);
  const item = A.quiz.rounds[roundIndex].items[itemIndex];
  if (item.timerSec) patch.deadline = fb.Timestamp.fromMillis(serverNow() + item.timerSec * 1000);
  A.bonus = { itemId: null, order: [], points: {} };
  autoClosedItem = null;
  return updateGame(patch);
}

async function closeQuestion() {
  const missing = activeGroups().filter((g) => !A.answers.some((a) => a.groupId === g.id));
  if (missing.length) {
    const ok = await confirmDialog({
      title: 'Vraag sluiten?',
      body: `${missing.length} groepje(s) hebben nog niet ingediend: ${missing.map((g) => g.name).join(', ')}. Zij krijgen 0 punten.`,
      okLabel: 'Ja, sluiten',
    });
    if (!ok) return;
  }
  await updateGame({ phase: 'question_closed' });
}

function extendTimer(seconds) {
  const base = Math.max(serverNow(), A.game.deadline ?? 0);
  return updateGame({ deadline: fb.Timestamp.fromMillis(base + seconds * 1000) });
}

/** Recalculate and store the automatic points for one item. */
async function rescore(item) {
  if (item.type === 'bonus_manual') return;
  const snap = await fb.getDocs(fb.query(col('answers'), fb.where('itemId', '==', item.id)));
  const values = {};
  snap.forEach((d) => {
    values[d.data().groupId] = d.data().value;
  });
  const groupIds = activeGroups().map((g) => g.id);
  const scored = scoreItem(item, values, { groupIds, people: A.people });
  const batch = fb.writeBatch(db);
  for (const groupId of groupIds) {
    batch.set(entryRef(`auto_${item.id}_${groupId}`), {
      groupId, itemId: item.id, points: scored[groupId].points, source: 'auto',
      note: scored[groupId].status, createdAt: fb.serverTimestamp(),
    });
  }
  await batch.commit();
}

async function reveal() {
  await rescore(currentItem());
  await updateGame({ phase: 'reveal' });
}

/** What comes after the current item: the next item, or the round scoreboard. */
function afterItem() {
  const round = currentRound();
  const next = round.items[A.game.itemIndex + 1];
  if (next) return { label: `Open ${next.label}`, run: () => openItem(A.game.roundIndex, A.game.itemIndex + 1) };
  return {
    label: `Scorebord ronde ${round.number}`,
    run: () => updateGame(cursor(A.game.roundIndex, A.game.itemIndex, 'round_scoreboard', false)),
  };
}

async function finishQuiz() {
  const ok = await confirmDialog({ title: 'Quiz afsluiten?', body: 'De telefoons tonen daarna dat de quiz is afgelopen.', okLabel: 'Ja, afsluiten' });
  if (ok) await updateGame({ phase: 'finished', itemId: null, deadline: null });
}

function primaryAction() {
  const g = A.game;
  const round = currentRound();
  if (!round) return null;
  switch (g.phase) {
    case 'lobby':
      return { label: `Start ronde ${A.quiz.rounds[0].number}`, run: () => startRound(0) };
    case 'round_intro': {
      const next = round.items[g.itemIndex] ?? round.items[0];
      return { label: `Open ${next.label}`, run: () => openItem(g.roundIndex, round.items.indexOf(next)) };
    }
    case 'question_open':
      return g.itemType === 'bonus_manual'
        ? { label: 'Punten opslaan', run: saveBonus }
        : { label: 'Sluit vraag', run: closeQuestion };
    case 'question_closed':
      return { label: 'Toon antwoord', run: reveal };
    case 'reveal':
      return afterItem();
    case 'round_scoreboard': {
      const next = A.quiz.rounds[g.roundIndex + 1];
      return next
        ? { label: `Start ronde ${next.number}`, run: () => startRound(g.roundIndex + 1) }
        : { label: 'Quiz afsluiten', run: finishQuiz };
    }
    default:
      return null;
  }
}

function secondaryActions() {
  const g = A.game;
  if (g.phase === 'question_open' && g.itemType === 'bonus_manual') {
    return [{ label: 'Bonus overslaan', run: skipBonus }];
  }
  if (g.phase === 'question_open') {
    return [
      { label: g.deadline ? '+30 s' : 'Start timer 30 s', run: () => extendTimer(30) },
      g.deadline && { label: 'Timer uit', run: () => updateGame({ deadline: null }) },
    ].filter(Boolean);
  }
  if (g.phase === 'reveal') return [{ label: 'Herbereken', run: () => rescore(currentItem()) }];
  if (g.phase === 'round_scoreboard' || g.phase === 'finished') {
    const on = g.beamerView === 'scoreboard';
    return [{
      label: on ? 'Scorebord van beamer halen' : 'Toon scorebord op beamer',
      run: () => updateGame({ beamerView: on ? 'waiting' : 'scoreboard' }),
    }];
  }
  return [];
}

// Close the question by itself once every active group has answered, and let
// the admin know. When the timer runs out the admin only gets a signal: he
// may still want to add time.
let autoClosedItem = null;
let timeUpItem = null;

function watchQuestion() {
  const g = A.game;
  if (DEBUG || !g || g.phase !== 'question_open' || g.itemType === 'bonus_manual' || A.busy) return;
  const groups = activeGroups();
  const allIn = groups.length > 0
    && groups.every((group) => A.answers.some((a) => a.groupId === group.id && a.itemId === g.itemId));
  if (allIn && autoClosedItem !== g.itemId) {
    autoClosedItem = g.itemId;
    navigator.vibrate?.([150, 80, 150]);
    notify('Iedereen heeft ingediend. Je kunt het antwoord tonen.');
    updateGame({ phase: 'question_closed' }).catch((error) => notify(`Sluiten mislukt: ${error.code ?? error.message}`, true));
    return;
  }
  if (g.deadline && serverNow() > g.deadline + 2000 && timeUpItem !== `${g.itemId}:${g.deadline}`) {
    timeUpItem = `${g.itemId}:${g.deadline}`;
    navigator.vibrate?.(400);
    notify('Tijd is op. Sluit de vraag of geef extra tijd.');
  }
}

// ---------- bonus ----------

function bonusState() {
  const item = currentItem();
  if (A.bonus.itemId !== item.id) {
    // Coming back to a bonus that was already filled in: start from what is stored.
    const points = {};
    for (const entry of A.entries) {
      if (entry.source === 'bonus' && entry.itemId === item.id) points[entry.groupId] = entry.points;
    }
    A.bonus = { itemId: item.id, order: Object.keys(points), points };
  }
  return A.bonus;
}

function bonusTap(groupId) {
  const bonus = bonusState();
  if (bonus.order.includes(groupId)) return;
  bonus.points[groupId] = bonusPoints(bonus.order.length, currentItem().defaultPoints);
  bonus.order.push(groupId);
  render();
}

async function saveBonus() {
  const bonus = bonusState();
  const item = currentItem();
  if (!bonus.order.length) return skipBonus();
  const batch = fb.writeBatch(db);
  for (const group of activeGroups()) {
    batch.set(entryRef(`bonus_${item.id}_${group.id}`), {
      groupId: group.id, itemId: item.id, points: bonus.points[group.id] ?? 0, source: 'bonus',
      note: item.label, createdAt: fb.serverTimestamp(),
    });
  }
  await batch.commit();
  await afterItem().run();
}

async function skipBonus() {
  const ok = await confirmDialog({ title: 'Bonus overslaan?', body: 'Er worden geen bonuspunten opgeslagen.', okLabel: 'Ja, overslaan' });
  if (ok) await afterItem().run();
}

// ---------- overrides, manual points, events ----------

function setOverride(item, groupId, points) {
  return fb.setDoc(entryRef(`override_${item.id}_${groupId}`), {
    groupId, itemId: item.id, points: Math.max(0, points), source: 'override', note: 'Handmatig', createdAt: fb.serverTimestamp(),
  });
}

function addEntry(groupId, points, source, note, itemId = null) {
  return fb.addDoc(col('scoreEntries'), { groupId, itemId, points, source, note, createdAt: fb.serverTimestamp() });
}

const unhandledEvents = () => A.events.filter((e) => !e.handled);

/** Settle every open report of this group for this question in one go. */
async function handleEvent(event, action) {
  const related = unhandledEvents().filter((e) => e.groupId === event.groupId && e.itemId === event.itemId);
  const batch = fb.writeBatch(db);
  for (const e of related) batch.update(fb.doc(db, 'events', e.id), { handled: action });
  await batch.commit();
  if (action === 'penalty') {
    const longest = Math.max(0, ...related.map((e) => e.awayMs ?? 0));
    await addEntry(event.groupId, -penaltyAmount(), 'penalty', `Pagina verlaten (${fmtDuration(longest)})`, event.itemId);
  }
}

function describeEvent(event) {
  const [kind, why] = String(event.type).split('_');
  const what = { hidden: 'pagina of app verlaten', blur: 'ander venster actief', offline: 'verbinding weg' }[why] ?? why;
  return kind === 'leave' ? `Weg: ${what}` : `Terug na ${fmtDuration(event.awayMs)} (${what})`;
}

function eventButtons(event) {
  return [
    h('button', { class: 'btn small danger', type: 'button', onclick: () => act(() => handleEvent(event, 'penalty')) }, `Strafpunt (−${penaltyAmount()})`),
    h('button', { class: 'btn small', type: 'button', onclick: () => act(() => handleEvent(event, 'ignored')) }, 'Negeren'),
  ];
}

function showEventToast(event) {
  const key = `${event.groupId}:${event.itemId}`;
  [...$('toasts').children].find((t) => t.dataset.key === key)?.remove();
  const toast = h('div', { class: 'toast' },
    h('div', { class: 'name' }, `⚠️ ${groupName(event.groupId)}`),
    h('div', { class: 'sub' }, `${describeEvent(event)} · ${itemTitle(event.itemId)} · ${fmtTime(event.at)}`),
    h('div', { class: 'buttons' }, eventButtons(event)));
  toast.dataset.key = key;
  toast.addEventListener('click', (e) => {
    if (e.target.closest('button')) toast.remove();
  });
  $('toasts').append(toast);
  navigator.vibrate?.([200, 100, 200]);
}

// ---------- groups ----------

async function renameGroup(group) {
  const name = (prompt('Nieuwe naam voor dit groepje:', group.name) ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name === group.name) return;
  const nameKey = groupNameKey(name);
  if (name.length < 2 || name.length > 24 || nameKey.length < 2) return notify('Kies een naam van 2 tot 24 tekens.', true);
  const batch = fb.writeBatch(db);
  if (nameKey !== group.nameKey) {
    const taken = await fb.getDoc(fb.doc(db, 'groupNames', nameKey));
    if (taken.exists()) return notify('Die naam is al bezet.', true);
    if (group.nameKey) batch.delete(fb.doc(db, 'groupNames', group.nameKey));
    batch.set(fb.doc(db, 'groupNames', nameKey), { uid: group.id });
  }
  batch.update(fb.doc(db, 'groups', group.id), { name, nameKey });
  await batch.commit();
}

async function deleteGroup(group) {
  const ok = await confirmDialog({
    title: `${group.name} verwijderen?`, body: 'Het groepje verdwijnt uit het spel en van het scorebord.', okLabel: 'Ja, verwijderen', danger: true,
  });
  if (!ok) return;
  const batch = fb.writeBatch(db);
  batch.delete(fb.doc(db, 'groups', group.id));
  if (group.nameKey) batch.delete(fb.doc(db, 'groupNames', group.nameKey));
  await batch.commit();
}

// ---------- import, test mode, reset ----------

async function importQuiz(file) {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data.rounds) || !Array.isArray(data.people)) throw new Error('Dit is geen geldig quiz-data.json');
  if (A.quiz) {
    const ok = await confirmDialog({
      title: 'Quiz overschrijven?', body: 'Timers en antwoorden die je in het adminpaneel hebt aangepast, gaan verloren.', okLabel: 'Ja, overschrijven', danger: true,
    });
    if (!ok) return;
  }
  const batch = fb.writeBatch(db);
  batch.set(quizRef, { rounds: data.rounds, importedAt: fb.serverTimestamp() });
  for (const person of A.people) batch.delete(fb.doc(db, 'people', person.id));
  for (const person of data.people) {
    batch.set(fb.doc(db, 'people', person.id), { name: person.name, aliases: person.aliases ?? [] });
  }
  if (!A.game) {
    batch.set(stateRef, {
      phase: 'lobby', roundIndex: 0, itemIndex: 0, roundNumber: null, roundTitle: null, itemId: null, itemLabel: null,
      itemType: null, publicPayload: {}, deadline: null, registrationOpen: true, beamerView: 'join', updatedAt: fb.serverTimestamp(),
    });
  }
  await batch.commit();
  const count = data.rounds.reduce((n, r) => n + r.items.length, 0);
  notify(`Geïmporteerd: ${data.rounds.length} rondes, ${count} items, ${data.people.length} personen`);
  A.sheet = null;
}

async function makeTestGroups(count = 4) {
  const batch = fb.writeBatch(db);
  const existing = A.groups.filter((g) => g.isTest).length;
  for (let i = 0; i < count; i++) {
    const id = `test_${Math.random().toString(36).slice(2, 10)}`;
    const name = `Testgroep ${existing + i + 1}`;
    const nameKey = groupNameKey(name);
    batch.set(fb.doc(db, 'groups', id), {
      name, nameKey, createdAt: fb.serverTimestamp(), lastSeen: fb.serverTimestamp(), disqualified: false, isTest: true,
    });
    batch.set(fb.doc(db, 'groupNames', nameKey), { uid: id });
  }
  await batch.commit();
}

function randomAnswer(item) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  switch (item.type) {
    case 'mc':
      return pick('ABCDEF'.slice(0, item.options ?? 4).split(''));
    case 'exact_number':
      return String(Math.random() < 0.4 ? item.correct : item.correct + pick([-3, -1, 1, 2]));
    case 'margin_number':
    case 'closest_rank': {
      const value = (item.correct ?? 10) * (0.5 + Math.random());
      return item.currency ? value.toFixed(2).replace('.', ',') : String(Math.round(value));
    }
    case 'name':
      return A.people.length ? pick(A.people).name : 'Iemand';
    case 'sort_two_bins':
      return Object.fromEntries(item.names.filter(() => Math.random() < 0.9).map((n) => [n, pick(item.bins).id]));
    default:
      return null;
  }
}

async function answerForTestGroups() {
  const item = currentItem();
  if (!item || A.game.phase !== 'question_open' || item.type === 'bonus_manual') {
    return notify('Open eerst een vraag.', true);
  }
  const waiting = A.groups.filter((g) => g.isTest && !g.disqualified && !A.answers.some((a) => a.groupId === g.id));
  if (!waiting.length) return notify('Geen testgroepjes die nog moeten antwoorden.', true);
  const batch = fb.writeBatch(db);
  for (const group of waiting) {
    batch.set(fb.doc(db, 'answers', `${item.id}_${group.id}`), {
      groupId: group.id, itemId: item.id, value: randomAnswer(item), submittedAt: fb.serverTimestamp(),
    });
  }
  await batch.commit();
  notify(`${waiting.length} testantwoorden ingediend`);
}

async function wipe(name, keep = () => false) {
  const snap = await fb.getDocs(col(name));
  let batch = fb.writeBatch(db);
  let n = 0;
  for (const d of snap.docs) {
    if (keep(d)) continue;
    batch.delete(d.ref);
    if (++n % 400 === 0) {
      await batch.commit();
      batch = fb.writeBatch(db);
    }
  }
  await batch.commit();
}

async function removeTestGroups() {
  const batch = fb.writeBatch(db);
  for (const group of A.groups.filter((g) => g.isTest)) {
    batch.delete(fb.doc(db, 'groups', group.id));
    if (group.nameKey) batch.delete(fb.doc(db, 'groupNames', group.nameKey));
  }
  await batch.commit();
}

async function resetGame() {
  const first = await confirmDialog({
    title: 'Hele spel resetten?', body: 'Alle groepjes, antwoorden, punten en meldingen worden gewist. De quiz zelf blijft staan.', okLabel: 'Verder', danger: true,
  });
  if (!first) return;
  const second = await confirmDialog({
    title: 'Echt zeker?', body: 'Dit kan niet ongedaan worden gemaakt.', okLabel: 'Ja, alles wissen', danger: true,
  });
  if (!second) return;
  for (const name of ['answers', 'scoreEntries', 'events', 'groups', 'groupNames']) await wipe(name);
  await updateGame({
    phase: 'lobby', roundIndex: 0, itemIndex: 0, roundNumber: null, roundTitle: null, itemId: null, itemLabel: null,
    itemType: null, publicPayload: {}, deadline: null, registrationOpen: true, beamerView: 'join',
  });
  A.sheet = null;
  notify('Het spel is gereset');
}

// ---------- main views ----------

function status(icon, title, text, kind = '') {
  return h('div', { class: `status ${kind}` }, h('div', { class: 'icon' }, icon), h('h1', {}, title), text && h('p', {}, text));
}

function card(title, big, note) {
  return h('div', { class: 'card' }, h('h2', {}, title), big != null && h('div', { class: 'big' }, big), note && h('div', { class: 'note' }, note));
}

function groupPills(group) {
  return [
    group.isTest && h('span', { class: 'pill' }, 'test'),
    group.disqualified && h('span', { class: 'pill bad' }, 'gediskwalificeerd'),
    !group.disqualified && isQuiet(group) && h('span', { class: 'pill warn' }, 'stil'),
  ];
}

function loginView() {
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'E-mailadres', 'aria-label': 'E-mailadres' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Wachtwoord', 'aria-label': 'Wachtwoord' });
  const form = h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      A.loginError = '';
      act(() => fb.signInWithEmailAndPassword(auth, email.value.trim(), password.value).catch(() => {
        A.loginError = 'Inloggen mislukt. Controleer e-mailadres en wachtwoord.';
      }));
    },
  },
  status('🔑', 'Admin', 'Log in om de quiz te besturen.'),
  h('div', { class: 'field' }, email),
  h('div', { class: 'field' }, password),
  h('p', { class: 'error', role: 'alert' }, A.loginError),
  h('button', { class: 'btn primary', type: 'submit', disabled: A.busy }, 'Inloggen'));
  form.style.cssText = 'display:flex;flex-direction:column;gap:12px';
  return form;
}

const startedAt = Date.now();

/** Loading screen that says what it is waiting for once it takes too long. */
function loading(waitingFor) {
  const slow = Date.now() - startedAt > 8000;
  return status('🍺', 'Laden…', slow
    ? `Wacht op: ${waitingFor}. Duurt dit lang? Open de pagina in Chrome, Edge of Safari (niet in de ingebouwde browser van VS Code) en controleer je verbinding.`
    : null);
}

function mainView() {
  if (A.user === undefined) return loading('aanmelding bij Firebase');
  if (!A.user) return loginView();
  if (A.denied) {
    return [
      status('🚫', 'Geen toegang', 'Dit account is niet de admin uit de security rules.', 'bad'),
      h('button', { class: 'btn', type: 'button', onclick: () => fb.signOut(auth) }, 'Uitloggen'),
    ];
  }
  if (A.quiz === undefined) return loading('de quiz uit Firestore');
  if (A.game === undefined) return loading('de spelstatus uit Firestore');
  if (!A.quiz || !A.game) {
    return [
      status('📥', 'Nog geen quiz', 'Importeer eerst private/quiz-data.json.'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => openSheet('import') }, 'Quiz importeren'),
    ];
  }
  const g = A.game;
  switch (g.phase) {
    case 'lobby':
      return lobbyView();
    case 'round_intro':
      return introView();
    case 'question_open':
    case 'question_closed':
      return g.itemType === 'bonus_manual' ? bonusView() : questionView();
    case 'reveal':
      return revealView();
    case 'round_scoreboard':
    case 'finished':
      return scoreboardView(g.phase === 'finished' ? 'Eindstand' : `Stand na ronde ${g.roundNumber}`);
    default:
      return status('❓', `Onbekende fase: ${g.phase}`);
  }
}

function lobbyView() {
  const groups = A.groups;
  return [
    h('div', { class: 'card' },
      h('h2', {}, 'Aangemelde groepjes'),
      h('div', { class: 'count' }, String(groups.length)),
      h('div', { class: 'note' }, A.game.registrationOpen ? 'Aanmelding is open' : 'Aanmelding is dicht')),
    h('div', { class: 'list' }, groups.map((group) => h('div', { class: 'item' },
      h('div', { class: 'name' }, group.name), h('div', { class: 'side' }, groupPills(group))))),
  ];
}

function introView() {
  const round = currentRound();
  return [
    card(`Ronde ${round.number}`, round.title, 'De telefoons tonen de titel van de ronde.'),
    h('div', { class: 'list' }, round.items.map((item, index) => h('div', { class: `item ${index === A.game.itemIndex ? 'flag' : ''}` },
      h('div', { class: 'name' }, item.label),
      h('div', { class: 'sub' }, TYPE_LABEL[item.type] + (item.timerSec ? ` · timer ${item.timerSec} s` : ''))))),
  ];
}

function itemCard(item) {
  return h('div', { class: 'card' },
    h('h2', {}, `${TYPE_LABEL[item.type]} · juiste antwoord`),
    h('div', { class: 'big' }, formatCorrect(item)),
    item.adminNote && h('div', { class: 'note' }, item.adminNote));
}

function questionView() {
  const item = currentItem();
  if (!item) return status('❓', 'Item niet gevonden', 'Spring via het menu naar een bestaand item.');
  const groups = activeGroups();
  const done = groups.filter((g) => A.answers.some((a) => a.groupId === g.id));
  const waiting = groups.filter((g) => !done.includes(g));
  const open = A.game.phase === 'question_open';
  return [
    itemCard(item),
    h('div', { class: 'card' },
      h('h2', {}, open ? 'Ingediend' : 'Vraag gesloten · ingediend'),
      h('div', { class: 'count' }, `${done.length}/${groups.length}`),
      open && !item.timerSec && !A.game.deadline && h('div', { class: 'note' }, 'Geen timer: sluit de vraag zelf.')),
    waiting.length > 0 && h('h2', { class: 'hint' }, open ? 'Nog niet ingediend' : 'Niet ingediend (0 punten)'),
    h('div', { class: 'list' }, waiting.map((group) => h('div', { class: 'item flag' },
      h('div', { class: 'name' }, group.name), h('div', { class: 'side' }, groupPills(group))))),
    done.length > 0 && h('h2', { class: 'hint' }, 'Binnen'),
    h('div', { class: 'list' }, done.map((group) => h('div', { class: 'item dim' }, h('div', { class: 'name' }, `✓ ${group.name}`)))),
  ];
}

function bonusView() {
  const item = currentItem();
  if (!item) return status('❓', 'Item niet gevonden');
  const bonus = bonusState();
  const groups = activeGroups();
  const ordered = [...bonus.order.map((id) => groups.find((g) => g.id === id)).filter(Boolean),
    ...groups.filter((g) => !bonus.order.includes(g.id))];
  const stepper = (group, delta) => h('button', {
    class: 'step', type: 'button', 'aria-label': delta > 0 ? 'Meer punten' : 'Minder punten',
    onclick: (event) => {
      event.stopPropagation();
      bonus.points[group.id] = (bonus.points[group.id] ?? 0) + delta;
      if (!bonus.order.includes(group.id)) bonus.order.push(group.id);
      render();
    },
  }, delta > 0 ? '+' : '−');
  return [
    h('div', { class: 'card' },
      h('h2', {}, 'Bonusronde'),
      h('div', { class: 'big' }, item.label),
      item.adminNote && h('div', { class: 'note' }, item.adminNote),
      h('div', { class: 'note' }, 'Tik de groepjes aan in volgorde van finish. Daarna kun je elke waarde nog aanpassen.')),
    h('div', { class: 'list' }, ordered.map((group) => {
      const position = bonus.order.indexOf(group.id);
      return h('div', { class: `item ${position >= 0 ? 'flag' : ''}`, onclick: () => bonusTap(group.id) },
        h('div', { class: 'name' }, position >= 0 ? `${position + 1}. ${group.name}` : group.name),
        h('div', { class: 'sub' }, position >= 0 ? 'geplaatst' : 'tik om te plaatsen'),
        h('div', { class: 'side' }, stepper(group, -1), h('div', { class: 'points' }, String(bonus.points[group.id] ?? 0)), stepper(group, 1)));
    })),
    bonus.order.length > 0 && h('button', {
      class: 'btn small', type: 'button', onclick: () => {
        A.bonus = { itemId: item.id, order: [], points: {} };
        render();
      },
    }, 'Volgorde wissen'),
  ];
}

function revealView() {
  const item = currentItem();
  if (!item) return status('❓', 'Item niet gevonden');
  const groups = activeGroups();
  const values = Object.fromEntries(A.answers.map((a) => [a.groupId, a.value]));
  const scored = scoreItem(item, values, { groupIds: groups.map((g) => g.id), people: A.people });
  const rows = groups.map((group) => {
    const auto = scored[group.id];
    const override = A.entries.find((e) => e.id === `override_${item.id}_${group.id}`);
    const points = override ? override.points : auto.points;
    const detail = auto.detail?.rank ? ` · plek ${auto.detail.rank}, ${fmtNumber(auto.detail.distance, item.currency)} ernaast` : '';
    const max = auto.detail?.max ? ` van ${auto.detail.max}` : '';
    return h('div', { class: `item ${auto.status === 'check' && !override ? 'flag' : ''}` },
      h('div', { class: 'name' }, group.name),
      h('div', { class: 'sub' },
        formatAnswer(item, values[group.id]) + detail + max, ' ',
        auto.status === 'check' && !override && h('span', { class: 'pill warn' }, 'controleren'),
        override && h('span', { class: 'pill warn' }, `handmatig (auto: ${auto.points})`)),
      h('div', { class: 'side' },
        h('button', { class: 'step', type: 'button', 'aria-label': 'Minder punten', onclick: () => act(() => setOverride(item, group.id, points - 1)) }, '−'),
        h('div', { class: 'points' }, String(points)),
        h('button', { class: 'step', type: 'button', 'aria-label': 'Meer punten', onclick: () => act(() => setOverride(item, group.id, points + 1)) }, '+'),
        override && h('button', { class: 'step', type: 'button', 'aria-label': 'Handmatige score weghalen', onclick: () => act(() => fb.deleteDoc(entryRef(override.id))) }, '↺')));
  });
  return [itemCard(item), h('div', { class: 'list' }, rows)];
}

function scoreRows() {
  return buildScoreboard(A.groups, A.entries).map((row) => h('div', { class: 'item' },
    h('div', { class: 'name' }, `${row.rank}. ${row.name}`), h('div', { class: 'side' }, h('div', { class: 'points' }, String(row.total)))));
}

function scoreboardView(title) {
  return [
    card(title, null, A.game.beamerView === 'scoreboard' ? 'Het scorebord staat op de beamer.' : 'Het scorebord staat niet op de beamer.'),
    h('div', { class: 'list' }, scoreRows()),
  ];
}

// ---------- sheets (menu and its screens) ----------

function openSheet(name, arg = null) {
  A.sheet = { name, arg };
  sheetDirty = true;
  render();
}

function closeSheet(to = null) {
  A.sheet = to ? { name: to, arg: null } : null;
  sheetDirty = true;
  render();
}

const menuButton = (label, onclick, extra = '') => h('button', { class: `btn ${extra}`, type: 'button', onclick }, label);

const SHEETS = {
  menu: {
    title: 'Menu', live: true,
    build() {
      const g = A.game;
      const open = unhandledEvents().length;
      return [
        menuButton('Scores', () => openSheet('scores')),
        menuButton('Handmatige punten', () => openSheet('manual')),
        menuButton(`Groepjes (${A.groups.length})`, () => openSheet('groups')),
        menuButton(`Meldingen${open ? ` (${open} open)` : ''}`, () => openSheet('events')),
        h('h2', {}, 'Aanmelding'),
        h('div', { class: 'segmented' },
          menuButton('Open', () => act(() => updateGame({ registrationOpen: true })), g?.registrationOpen ? 'on' : ''),
          menuButton('Dicht', () => act(() => updateGame({ registrationOpen: false })), g?.registrationOpen ? '' : 'on')),
        h('h2', {}, 'Beamer'),
        h('div', { class: 'segmented' }, BEAMER_VIEWS.map(([id, label]) => menuButton(label,
          () => act(() => updateGame({ beamerView: id })), g?.beamerView === id ? 'on' : ''))),
        h('h2', {}, 'Quiz'),
        menuButton('Spring naar item', () => openSheet('jump')),
        menuButton('Instellingen per item', () => openSheet('items')),
        menuButton('Personen en schrijfwijzen', () => openSheet('people')),
        menuButton('Quiz importeren', () => openSheet('import')),
        menuButton('Testmodus en reset', () => openSheet('test')),
        h('h2', {}, 'Account'),
        menuButton('Uitloggen', () => fb.signOut(auth)),
      ];
    },
  },

  scores: { title: 'Scores', live: true, back: 'menu', build: () => (A.groups.length ? scoreRows() : [h('p', { class: 'hint' }, 'Nog geen groepjes.')]) },

  manual: {
    title: 'Handmatige punten', back: 'menu',
    build() {
      let points = 1;
      const groups = activeGroups();
      const select = h('select', { 'aria-label': 'Groepje' }, groups.map((g) => h('option', { value: g.id }, g.name)));
      const note = h('input', { type: 'text', maxLength: 80, placeholder: 'Notitie (waarom?)', 'aria-label': 'Notitie' });
      const shown = h('div', { class: 'points' }, '+1');
      const step = (delta) => h('button', {
        class: 'step', type: 'button', onclick: () => {
          points += delta;
          if (points === 0) points += delta;
          shown.textContent = points > 0 ? `+${points}` : String(points);
        },
      }, delta > 0 ? '+' : '−');
      const log = A.entries.filter((e) => e.source === 'manual' || e.source === 'penalty').sort((a, b) => b.createdAt - a.createdAt);
      return [
        h('label', { class: 'stack' }, 'Groepje', h('div', { class: 'field dark' }, select)),
        h('label', { class: 'stack' }, 'Punten',
          h('div', { style: 'display:flex;align-items:center;gap:12px' }, step(-1), shown, step(1))),
        h('label', { class: 'stack' }, 'Notitie', h('div', { class: 'field' }, note)),
        menuButton('Toevoegen', () => act(async () => {
          if (!select.value) return;
          await addEntry(select.value, points, 'manual', note.value.trim());
          notify('Punten toegevoegd');
          sheetDirty = true;
        }), 'primary'),
        h('h2', {}, 'Eerdere correcties en strafpunten'),
        log.length === 0 && h('p', { class: 'hint' }, 'Nog geen.'),
        h('div', { class: 'list' }, log.map((entry) => h('div', { class: 'item' },
          h('div', { class: 'name' }, `${groupName(entry.groupId)}: ${entry.points > 0 ? '+' : ''}${entry.points}`),
          h('div', { class: 'sub' }, [entry.source === 'penalty' ? 'Strafpunt' : 'Handmatig', entry.note, itemTitle(entry.itemId)].filter(Boolean).join(' · ')),
          h('div', { class: 'side' }, h('button', {
            class: 'btn small', type: 'button', onclick: () => act(async () => {
              await fb.deleteDoc(entryRef(entry.id));
              sheetDirty = true;
            }),
          }, 'Terugdraaien'))))),
      ];
    },
  },

  groups: {
    title: 'Groepjes', live: true, back: 'menu',
    build() {
      if (!A.groups.length) return [h('p', { class: 'hint' }, 'Nog geen groepjes.')];
      return [h('div', { class: 'list' }, A.groups.map((group) => h('div', { class: 'item' },
        h('div', { class: 'name' }, group.name),
        h('div', { class: 'side' }, groupPills(group)),
        h('div', { class: 'buttons' },
          h('button', { class: 'btn small', type: 'button', onclick: () => act(() => renameGroup(group)) }, 'Hernoem'),
          h('button', {
            class: 'btn small', type: 'button',
            onclick: () => act(() => fb.updateDoc(fb.doc(db, 'groups', group.id), { disqualified: !group.disqualified })),
          }, group.disqualified ? 'Herstel' : 'Diskwalificeer'),
          h('button', { class: 'btn small danger', type: 'button', onclick: () => act(() => deleteGroup(group)) }, 'Verwijder')))))];
    },
  },

  events: {
    title: 'Meldingen', live: true, back: 'menu',
    build() {
      const amount = penaltyAmount();
      const setAmount = (delta) => {
        localStorage.setItem('pq-penalty', String(Math.max(1, amount + delta)));
        sheetDirty = true;
        render();
      };
      return [
        h('div', { class: 'card' },
          h('h2', {}, 'Strafpunten per melding'),
          h('div', { style: 'display:flex;align-items:center;gap:12px' },
            h('button', { class: 'step', type: 'button', onclick: () => setAmount(-1) }, '−'),
            h('div', { class: 'points' }, `−${amount}`),
            h('button', { class: 'step', type: 'button', onclick: () => setAmount(1) }, '+')),
          h('div', { class: 'note' }, 'Er gaat nooit automatisch iets af; jij beslist per melding.')),
        A.events.length === 0 && h('p', { class: 'hint' }, 'Nog geen meldingen.'),
        h('div', { class: 'list' }, A.events.map((event) => h('div', { class: `item ${event.handled ? 'dim' : 'flag'}` },
          h('div', { class: 'name' }, groupName(event.groupId)),
          h('div', { class: 'sub' }, `${describeEvent(event)} · ${itemTitle(event.itemId)} · ${fmtTime(event.at)}`),
          h('div', { class: 'side' }, event.handled && h('span', { class: `pill ${event.handled === 'penalty' ? 'bad' : ''}` },
            event.handled === 'penalty' ? 'strafpunt' : 'genegeerd')),
          !event.handled && h('div', { class: 'buttons' }, eventButtons(event))))),
      ];
    },
  },

  jump: {
    title: 'Spring naar item', back: 'menu',
    build() {
      const go = (label, run) => async () => {
        const ok = await confirmDialog({ title: `Springen naar ${label}?`, body: 'De telefoons gaan naar het wachtscherm van die ronde. Daarna open je het item zelf.', okLabel: 'Ja, springen' });
        if (ok) act(async () => {
          await run();
          closeSheet();
        });
      };
      return [
        menuButton('Terug naar de lobby', go('de lobby', () => updateGame({ phase: 'lobby', itemId: null, deadline: null }))),
        ...A.quiz.rounds.flatMap((round, ri) => [
          h('h2', {}, `Ronde ${round.number}: ${round.title}`),
          h('div', { class: 'list' }, round.items.map((item, ii) => h('button', {
            class: `item ${A.game.roundIndex === ri && A.game.itemIndex === ii ? 'flag' : ''}`, type: 'button',
            onclick: go(`${item.label} (ronde ${round.number})`, () => startRound(ri, ii)),
          }, h('div', { class: 'name' }, item.label), h('div', { class: 'sub' }, TYPE_LABEL[item.type])))),
        ]),
      ];
    },
  },

  items: {
    title: 'Instellingen per item', back: 'menu',
    build: () => A.quiz.rounds.flatMap((round, ri) => [
      h('h2', {}, `Ronde ${round.number}: ${round.title}`),
      h('div', { class: 'list' }, round.items.map((item, ii) => h('button', {
        class: 'item', type: 'button', onclick: () => openSheet('item', { ri, ii }),
      },
      h('div', { class: 'name' }, item.label),
      h('div', { class: 'sub' }, [TYPE_LABEL[item.type], formatCorrect(item), item.timerSec ? `timer ${item.timerSec} s` : 'geen timer'].filter(Boolean).join(' · '))))),
    ]),
  },

  item: {
    title: 'Item instellen', back: 'items',
    build() {
      const { ri, ii } = A.sheet.arg;
      const item = structuredClone(A.quiz.rounds[ri].items[ii]);
      const parts = [card(`Ronde ${A.quiz.rounds[ri].number} · ${item.label}`, TYPE_LABEL[item.type], item.adminNote)];
      const readers = [];
      const textField = (label, value, props = {}) => {
        const input = h('input', { type: 'text', value: value ?? '', 'aria-label': label, ...props });
        parts.push(h('label', { class: 'stack' }, label, h('div', { class: 'field' }, input)));
        return input;
      };
      const selectField = (label, options, value) => {
        const select = h('select', { 'aria-label': label }, options.map(([v, text]) => h('option', { value: v, selected: v === value }, text)));
        parts.push(h('label', { class: 'stack' }, label, h('div', { class: 'field dark' }, select)));
        return select;
      };

      if (item.type !== 'bonus_manual') {
        const seconds = textField('Timer in seconden (leeg = geen timer)', item.timerSec ?? '', { inputmode: 'numeric', placeholder: 'geen timer' });
        readers.push(() => {
          const n = parseInt(seconds.value, 10);
          item.timerSec = n > 0 ? n : null;
        });
      }
      if (item.type === 'mc') {
        const letters = 'ABCDEF'.slice(0, item.options ?? 4).split('');
        const select = selectField('Juiste antwoord', letters.map((l) => [l, l]), item.correct);
        readers.push(() => {
          item.correct = select.value;
        });
      }
      if (['exact_number', 'margin_number', 'closest_rank'].includes(item.type)) {
        const correct = textField('Juiste antwoord', item.correct != null ? String(item.correct).replace('.', ',') : '', { inputmode: 'decimal' });
        readers.push(() => {
          const value = parseNumber(correct.value);
          if (value == null) throw new Error('Vul een geldig getal in als juiste antwoord.');
          item.correct = value;
        });
        if (item.type === 'margin_number') {
          const margin = textField('Marge (inclusief)', String(item.margin ?? 0).replace('.', ','), { inputmode: 'decimal' });
          readers.push(() => {
            item.margin = parseNumber(margin.value) ?? 0;
          });
        }
        if (item.type !== 'exact_number') {
          const currency = selectField('Valuta', [['', 'Geen'], ['EUR', '€ euro'], ['USD', '$ dollar']], item.currency ?? '');
          readers.push(() => {
            if (currency.value) item.currency = currency.value;
            else delete item.currency;
          });
        }
      }
      if (item.type === 'name') {
        const chosen = new Set(item.correct ?? []);
        parts.push(h('h2', {}, 'Goede personen (meerdere bij gelijkspel)'),
          ...A.people.map((person) => h('label', { class: 'check' },
            h('input', {
              type: 'checkbox', checked: chosen.has(person.id),
              onchange: (event) => (event.target.checked ? chosen.add(person.id) : chosen.delete(person.id)),
            }), person.name)));
        readers.push(() => {
          item.correct = [...chosen];
        });
      }
      if (item.type === 'sort_two_bins') {
        parts.push(h('h2', {}, 'Juiste vak per naam'));
        for (const name of item.names) {
          const buttons = item.bins.map((bin) => h('button', {
            class: `btn small ${item.correct[name] === bin.id ? 'on' : ''}`, type: 'button',
            onclick: () => {
              item.correct[name] = bin.id;
              buttons.forEach((b, i) => b.classList.toggle('on', item.bins[i].id === bin.id));
            },
          }, bin.label));
          parts.push(h('label', { class: 'stack' }, name, h('div', { class: 'segmented' }, buttons)));
        }
      }
      parts.push(menuButton('Opslaan', () => act(async () => {
        readers.forEach((read) => read());
        const rounds = structuredClone(A.quiz.rounds);
        rounds[ri].items[ii] = item;
        await fb.updateDoc(quizRef, { rounds });
        // Points that were already handed out for this item follow the new key.
        if (A.entries.some((e) => e.source === 'auto' && e.itemId === item.id)) await rescore(item);
        notify('Opgeslagen');
        closeSheet('items');
      }), 'primary'));
      return parts;
    },
  },

  people: {
    title: 'Personen', back: 'menu',
    build() {
      const name = h('input', { type: 'text', maxLength: 30, placeholder: 'Nieuwe persoon', 'aria-label': 'Naam' });
      const refresh = () => {
        sheetDirty = true;
      };
      return [
        h('p', { class: 'hint' }, 'Schrijfwijzen zijn de namen die goed gerekend worden, gescheiden door komma\'s.'),
        h('div', { class: 'list' }, A.people.map((person) => h('div', { class: 'item' },
          h('div', { class: 'name' }, person.name),
          h('div', { class: 'sub' }, (person.aliases ?? []).join(', ')),
          h('div', { class: 'buttons' },
            h('button', {
              class: 'btn small', type: 'button', onclick: () => act(async () => {
                const typed = prompt(`Schrijfwijzen voor ${person.name} (komma's ertussen):`, (person.aliases ?? []).join(', '));
                if (typed == null) return;
                const aliases = [...new Set(typed.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean))];
                await fb.updateDoc(fb.doc(db, 'people', person.id), { aliases });
                refresh();
              }),
            }, 'Schrijfwijzen'),
            h('button', {
              class: 'btn small danger', type: 'button', onclick: () => act(async () => {
                const ok = await confirmDialog({ title: `${person.name} verwijderen?`, okLabel: 'Ja, verwijderen', danger: true });
                if (ok) await fb.deleteDoc(fb.doc(db, 'people', person.id));
                refresh();
              }),
            }, 'Verwijder'))))),
        h('h2', {}, 'Persoon toevoegen'),
        h('div', { class: 'field' }, name),
        menuButton('Toevoegen', () => act(async () => {
          const value = name.value.trim();
          const id = groupNameKey(value);
          if (!id) return notify('Vul een naam in.', true);
          if (A.people.some((p) => p.id === id)) return notify('Die persoon bestaat al.', true);
          await fb.setDoc(fb.doc(db, 'people', id), { name: value, aliases: [id] });
          refresh();
        }), 'primary'),
      ];
    },
  },

  import: {
    title: 'Quiz importeren', back: 'menu',
    build() {
      const file = h('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'quiz-data.json' });
      return [
        h('p', { class: 'hint' }, 'Kies het bestand private/quiz-data.json. Het wordt naar Firestore geschreven en is daarna alleen voor de admin leesbaar.'),
        h('div', { class: 'card' }, file),
        menuButton('Importeren', () => act(async () => {
          if (!file.files[0]) return notify('Kies eerst een bestand.', true);
          await importQuiz(file.files[0]);
        }), 'primary'),
      ];
    },
  },

  test: {
    title: 'Testmodus en reset', live: true, back: 'menu',
    build() {
      const tests = A.groups.filter((g) => g.isTest).length;
      return [
        h('p', { class: 'hint' }, `Er zijn nu ${tests} testgroepjes. Ze tellen mee als gewone groepjes tot je ze verwijdert.`),
        menuButton('Maak 4 testgroepjes', () => act(() => makeTestGroups(4))),
        menuButton('Laat testgroepjes antwoorden', () => act(answerForTestGroups)),
        menuButton('Verwijder testgroepjes', () => act(removeTestGroups)),
        h('h2', {}, 'Reset'),
        menuButton('Reset het hele spel', () => act(resetGame), 'danger'),
      ];
    },
  },
};

// ---------- render ----------

function renderKey() {
  return JSON.stringify([
    // JSON turns undefined into null, so "still loading" needs its own flags.
    A.user?.uid, A.user === undefined, A.quiz === undefined, A.game === undefined,
    A.denied, A.loginError, A.busy, A.quiz, A.people, A.game,
    (A.user === undefined || A.quiz === undefined || A.game === undefined) && Date.now() - startedAt > 8000,
    A.groups.map((g) => [g.id, g.name, g.disqualified, g.isTest, isQuiet(g)]),
    A.entries.map((e) => [e.id, e.points]), A.answers.map((a) => a.id),
    A.events.map((e) => [e.id, e.handled]), A.sheet, A.bonus,
  ]);
}

function render() {
  watchQuestion();
  updateTopbar();
  const key = renderKey();
  if (key === lastKey && !sheetDirty) return;
  lastKey = key;

  const ready = Boolean(A.user && !A.denied && A.quiz && A.game);
  $('view').replaceChildren(...[mainView()].flat(Infinity).filter(Boolean));

  const bar = $('bottombar');
  bar.hidden = !ready;
  if (ready) {
    const primary = primaryAction();
    const open = unhandledEvents().length;
    bar.replaceChildren(
      h('div', { class: 'secondary' }, secondaryActions().map((a) => h('button', {
        class: 'btn small', type: 'button', disabled: A.busy, onclick: () => act(a.run),
      }, a.label))),
      h('div', { class: 'main' },
        h('button', { class: 'btn menu', type: 'button', 'aria-label': 'Menu', onclick: () => openSheet('menu') },
          '☰', open > 0 && h('span', { class: 'badge' }, String(open))),
        primary && h('button', { class: 'btn primary', type: 'button', disabled: A.busy, onclick: () => act(primary.run) }, primary.label)));
  }

  const sheet = $('sheet');
  const def = A.sheet && SHEETS[A.sheet.name];
  sheet.hidden = !def || !A.user;
  // Screens with a form are only rebuilt on request, so typing is never wiped.
  if (def && (sheetDirty || def.live)) {
    const scroll = sheet.querySelector('.sheet-body')?.scrollTop ?? 0;
    sheet.replaceChildren(
      h('div', { class: 'sheet-head' },
        h('button', { class: 'btn small', type: 'button', onclick: () => closeSheet(def.back) }, def.back ? '‹ Terug' : '✕ Sluiten'),
        h('h1', {}, def.title)),
      h('div', { class: 'sheet-body' }, def.build()));
    if (!sheetDirty) sheet.querySelector('.sheet-body').scrollTop = scroll;
  }
  sheetDirty = false;
}

function updateTopbar() {
  const g = A.game;
  const ready = Boolean(A.user && !A.denied && A.quiz && g);
  $('topbar').hidden = !ready;
  if (!ready) return;
  $('who').textContent = PHASE_LABEL[g.phase] ?? g.phase;
  const parts = [];
  if (g.roundNumber && g.phase !== 'lobby') parts.push(`Ronde ${g.roundNumber}`);
  if (g.itemLabel) parts.push(g.itemLabel);
  $('where').textContent = parts.join(' · ') || 'Pubquiz';
  const timer = $('timer');
  const running = g.phase === 'question_open' && g.deadline;
  timer.hidden = !running;
  if (running) {
    const seconds = Math.max(0, Math.ceil((g.deadline - serverNow()) / 1000));
    timer.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    timer.classList.toggle('low', seconds <= 10);
  }
}

// ---------- data ----------

const millis = (value) => value?.toMillis?.() ?? null;

function watchAnswers() {
  const itemId = A.game?.itemId ?? null;
  if (itemId === answersItemId) return;
  answersItemId = itemId;
  stopAnswers?.();
  stopAnswers = null;
  A.answers = [];
  if (!itemId) return;
  stopAnswers = fb.onSnapshot(fb.query(col('answers'), fb.where('itemId', '==', itemId)), (snap) => {
    A.answers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  }, denied);
}

function denied(error) {
  console.error(error);
  if (error.code === 'permission-denied') A.denied = true;
  else notify(`Verbinding: ${error.code ?? error.message}`, true);
  render();
}

/** Estimate the server clock, so deadlines are set in server time. */
function measureClock() {
  const ref = fb.doc(db, 'quiz', 'ping');
  const sent = Date.now();
  const stop = fb.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
    const at = millis(snap.data()?.at);
    if (snap.metadata.hasPendingWrites || !at || at < sent - 60000) return;
    const roundTrip = Date.now() - sent;
    A.offset = at - (sent + roundTrip / 2);
    stop();
  }, () => {});
  fb.setDoc(ref, { at: fb.serverTimestamp() }).catch(() => {});
}

function startListening() {
  let eventsLoaded = false;
  stopListening = [
    fb.onSnapshot(quizRef, (snap) => {
      A.quiz = snap.exists() ? snap.data() : null;
      render();
    }, denied),
    fb.onSnapshot(stateRef, (snap) => {
      A.game = snap.exists() ? { ...snap.data(), deadline: millis(snap.data().deadline) } : null;
      watchAnswers();
      render();
    }, denied),
    fb.onSnapshot(col('people'), (snap) => {
      A.people = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name, 'nl'));
      render();
    }, denied),
    fb.onSnapshot(col('groups'), (snap) => {
      A.groups = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: millis(d.data().createdAt), lastSeen: millis(d.data().lastSeen) }))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      render();
    }, denied),
    fb.onSnapshot(col('scoreEntries'), (snap) => {
      A.entries = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: millis(d.data().createdAt) ?? Date.now() }));
      render();
    }, denied),
    fb.onSnapshot(fb.query(col('events'), fb.orderBy('at', 'desc'), fb.limit(200)), (snap) => {
      A.events = snap.docs.map((d) => ({ id: d.id, ...d.data(), at: millis(d.data().at) }));
      // Only shout about reports that come in live, not about the backlog.
      if (eventsLoaded) {
        for (const change of snap.docChanges()) {
          const data = change.doc.data();
          if (change.type === 'added' && !data.handled) showEventToast({ id: change.doc.id, ...data, at: millis(data.at) ?? Date.now() });
        }
      }
      eventsLoaded = true;
      render();
    }, denied),
  ];
  measureClock();
}

function stopAll() {
  stopListening.forEach((stop) => stop());
  stopListening = [];
  stopAnswers?.();
  stopAnswers = null;
  answersItemId = null;
  Object.assign(A, { denied: false, quiz: undefined, game: undefined, people: [], groups: [], entries: [], events: [], answers: [], sheet: null });
}

if (DEBUG) {
  // Local preview of the screens with injected state; nothing is read or written.
  A.user = { uid: 'debug' };
  window.__admin = { A, render: () => {
    sheetDirty = true;
    render();
  } };
} else {
  fb.onAuthStateChanged(auth, (user) => {
    stopAll();
    A.user = user;
    if (user) startListening();
    render();
  });
}

setInterval(render, 1000);
render();
