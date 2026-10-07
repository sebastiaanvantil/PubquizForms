// Beamer page: runs on the laptop next to the PowerPoint. Shows the join
// screen, a neutral waiting screen or the scoreboard, whichever the admin
// picked on his phone. Needs the admin login, because it reads the scores.

import { $, h } from './dom.js';
import * as fb from './firebase.js';
import { buildScoreboard } from './scoring.js';

// Where the phones should go. Locally the QR code still points at the real site.
const PAGES_URL = 'https://sebastiaanvantil.github.io/PubquizForms/';
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const PLAYER_URL = LOCAL ? PAGES_URL : new URL('./', location.href).href;

const DEBUG = LOCAL && new URLSearchParams(location.search).has('debug');
const { auth, db } = fb.connect('admin');

const B = {
  user: undefined,
  denied: false,
  loginError: '',
  game: undefined,
  groups: [],
  entries: [],
};

let lastKey = null;
let lastView = null;
let stopListening = [];

const millis = (value) => value?.toMillis?.() ?? null;

function status(icon, title, text, kind = '') {
  return h('div', { class: `status ${kind}` }, h('div', { class: 'icon' }, icon), h('h1', {}, title), text && h('p', {}, text));
}

function loginView() {
  const email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'E-mailadres', 'aria-label': 'E-mailadres' });
  const password = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Wachtwoord', 'aria-label': 'Wachtwoord' });
  return h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      B.loginError = '';
      fb.signInWithEmailAndPassword(auth, email.value.trim(), password.value).catch(() => {
        B.loginError = 'Inloggen mislukt. Controleer e-mailadres en wachtwoord.';
        render();
      });
    },
  },
  status('📽️', 'Beamer', 'Log in met het adminaccount.'),
  h('div', { class: 'field' }, email),
  h('div', { class: 'field' }, password),
  h('p', { class: 'error', role: 'alert' }, B.loginError),
  h('button', { class: 'btn primary', type: 'submit' }, 'Inloggen'));
}

function waitingView() {
  const g = B.game;
  const round = g.roundNumber && g.phase !== 'lobby' && g.phase !== 'finished';
  return h('div', { class: 'b-wait' },
    h('div', { class: 'icon' }, '🍻'),
    h('div', { class: 'b-title' }, 'De Grote Seb en Floor Pubquiz'),
    h('div', { class: 'b-sub' }, g.phase === 'finished' ? 'Bedankt voor het meedoen!' : round ? `Ronde ${g.roundNumber}: ${g.roundTitle}` : 'Huisweekend 2026'));
}

function joinView() {
  const qr = h('div', { class: 'b-qr' });
  if (window.QRCode) {
    new window.QRCode(qr, { text: PLAYER_URL, width: 640, height: 640, correctLevel: window.QRCode.CorrectLevel.M });
  }
  const groups = B.groups.filter((g) => !g.disqualified);
  const open = B.game.registrationOpen;
  return h('div', { class: 'b-join' },
    qr,
    h('div', {},
      h('h1', {}, 'Doe mee met de pubquiz'),
      h('div', { class: 'url' }, PLAYER_URL.replace(/^https?:\/\//, '').replace(/\/$/, '')),
      open
        ? h('div', { class: 'steps' }, 'Scan de code met één telefoon per groepje en kies een groepsnaam.')
        : h('div', { class: 'steps closed' }, 'Aanmelden is gesloten.'),
      h('div', { class: 'b-groups' }, groups.map((g) => h('span', {}, g.name)))));
}

function scoreboardView(animate) {
  const rows = buildScoreboard(B.groups, B.entries);
  if (!rows.length) return h('div', { class: 'b-wait' }, h('div', { class: 'b-title' }, 'Nog geen groepjes'));
  const top = Math.max(1, ...rows.map((r) => r.total));
  const g = B.game;
  const title = g.phase === 'finished' ? 'Eindstand' : g.roundNumber && g.phase !== 'lobby' ? `Stand na ronde ${g.roundNumber}` : 'Stand';
  const board = h('div', { class: `b-board ${animate ? 'animate' : ''}` }, rows.map((row, index) => {
    const node = h('div', { class: `b-row ${row.rank === 1 ? 'first' : ''}` },
      h('div', { class: 'bar' }),
      h('div', { class: 'rank' }, `${row.rank}.`),
      h('div', { class: 'name' }, row.name),
      h('div', { class: 'total' }, String(row.total)));
    node.style.setProperty('--share', `${Math.max(0, (row.total / top) * 100)}%`);
    node.style.setProperty('--order', String(rows.length - 1 - index));
    return node;
  }));
  board.style.setProperty('--rows', String(rows.length));
  return [h('div', { class: 'b-title' }, title), board];
}

function currentView() {
  if (B.user === undefined) return 'loading';
  if (!B.user) return 'login';
  if (B.denied) return 'denied';
  if (B.game === undefined) return 'loading';
  if (!B.game) return 'empty';
  return ['join', 'scoreboard'].includes(B.game.beamerView) ? B.game.beamerView : 'waiting';
}

function render() {
  const view = currentView();
  const g = B.game;
  const key = JSON.stringify([
    view, B.loginError, g && [g.phase, g.roundNumber, g.roundTitle, g.registrationOpen],
    B.groups.map((x) => [x.id, x.name, x.disqualified]), view === 'scoreboard' && B.entries.map((e) => [e.id, e.points]),
  ]);
  if (key === lastKey) return;
  lastKey = key;
  // Only play the build-up when the scoreboard comes on screen, not on every point.
  const entering = view !== lastView;
  lastView = view;

  const build = {
    loading: () => status('🍺', 'Laden…'),
    login: loginView,
    denied: () => [
      status('🚫', 'Geen toegang', 'Dit account is niet de admin.', 'bad'),
      h('button', { class: 'btn', type: 'button', style: 'width:auto;margin:0 auto', onclick: () => fb.signOut(auth) }, 'Uitloggen'),
    ],
    empty: () => status('📥', 'Nog geen quiz', 'Importeer de quiz eerst in het adminpaneel.'),
    waiting: waitingView,
    join: joinView,
    scoreboard: () => scoreboardView(entering),
  }[view];
  $('stage').replaceChildren(...[build()].flat().filter(Boolean));
}

function denied(error) {
  console.error(error);
  if (error.code === 'permission-denied') B.denied = true;
  render();
}

function startListening() {
  stopListening = [
    fb.onSnapshot(fb.doc(db, 'game', 'state'), (snap) => {
      B.game = snap.exists() ? snap.data() : null;
      render();
    }, denied),
    fb.onSnapshot(fb.collection(db, 'groups'), (snap) => {
      B.groups = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: millis(d.data().createdAt) }))
        .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
      render();
    }, denied),
    fb.onSnapshot(fb.collection(db, 'scoreEntries'), (snap) => {
      B.entries = snap.docs.map((d) => ({ id: d.id, ...d.data(), createdAt: millis(d.data().createdAt) ?? Date.now() }));
      render();
    }, denied),
  ];
}

$('fullscreen').addEventListener('click', () => document.documentElement.requestFullscreen?.());
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', Boolean(document.fullscreenElement));
});

if (DEBUG) {
  // Local preview with injected state; nothing is read from Firebase.
  B.user = { uid: 'debug' };
  window.__beamer = { B, render };
} else {
  fb.onAuthStateChanged(auth, (user) => {
    stopListening.forEach((stop) => stop());
    stopListening = [];
    Object.assign(B, { user, denied: false, game: undefined, groups: [], entries: [] });
    if (user) startListening();
    render();
  });
}

render();
