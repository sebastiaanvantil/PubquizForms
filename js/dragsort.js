// Two-bin sorter for round 4. Drag a name into a bin with Pointer Events (HTML5
// drag and drop does not work on touch), or tap a name and then tap a bin.
// No Firebase in here.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Deterministic shuffle, so a group keeps its own order after a reload. */
export function seededShuffle(list, seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const random = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const HOLD_MS = 220; // touch: hold this long before a drag starts
const SLOP_PX = 10; // touch: moving further than this before the hold is a scroll
const MOUSE_SLOP_PX = 6;
const EDGE_PX = 70;

/**
 * Build the sorter.
 *   names      names in display order
 *   bins       [{ id, label }, { id, label }]
 *   placement  initial { name: binId }
 *   onChange   called with the new { name: binId } after every move
 * Returns { element, getPlacement }.
 */
export function createSorter({ names, bins, placement = {}, onChange = () => {} }) {
  const state = {};
  for (const name of names) {
    if (bins.some((b) => b.id === placement[name])) state[name] = placement[name];
  }
  let selected = null;
  let drag = null; // { name, chip, pointerId, startX, startY, x, y, active, timer, ghost, over }
  let suppressClick = false;

  const root = el('div', 'sorter');
  const targets = el('div', 'sort-targets');
  const pool = el('div', 'sort-pool');
  const lists = el('div', 'sort-lists');
  root.append(targets, pool, lists);
  pool.dataset.bin = '';

  const binParts = bins.map((bin) => {
    const target = el('button', 'sort-target');
    target.type = 'button';
    target.dataset.bin = bin.id;
    const count = el('small');
    target.append(bin.label, count);
    target.addEventListener('click', () => placeSelected(bin.id));
    targets.append(target);

    const column = el('div');
    const list = el('div', 'sort-list');
    list.dataset.bin = bin.id;
    list.addEventListener('click', () => placeSelected(bin.id));
    column.append(el('h3', '', bin.label), list);
    lists.append(column);
    return { bin, target, count, list };
  });
  pool.addEventListener('click', () => placeSelected(null));

  const chips = new Map();
  for (const name of names) {
    const chip = el('button', 'chip', name);
    chip.type = 'button';
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      if (suppressClick) return;
      selected = selected === name ? null : name;
      layout();
    });
    chip.addEventListener('pointerdown', (event) => startPress(event, name, chip));
    chip.addEventListener('pointermove', movePress);
    chip.addEventListener('pointerup', endPress);
    chip.addEventListener('pointercancel', cancelPress);
    // Once a drag is active the page must not scroll under the finger.
    chip.addEventListener('touchmove', (event) => {
      if (drag?.active && event.cancelable) event.preventDefault();
    }, { passive: false });
    chip.addEventListener('contextmenu', (event) => event.preventDefault());
    chips.set(name, chip);
  }

  function move(name, binId) {
    if (binId) state[name] = binId;
    else delete state[name];
    selected = null;
    layout();
    onChange({ ...state });
  }

  function placeSelected(binId) {
    if (selected) move(selected, binId);
  }

  // ----- dragging -----

  function startPress(event, name, chip) {
    if (drag || (event.pointerType === 'mouse' && event.button !== 0)) return;
    drag = {
      name, chip, pointerId: event.pointerId, touch: event.pointerType !== 'mouse',
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
      active: false, timer: null, ghost: null, over: null,
    };
    // A finger has to rest on the name first, so scrolling never starts a drag.
    if (drag.touch) drag.timer = setTimeout(activate, HOLD_MS);
  }

  function activate() {
    if (!drag || drag.active) return;
    drag.active = true;
    selected = null;
    layout();
    try {
      drag.chip.setPointerCapture(drag.pointerId);
    } catch { /* pointer already gone */ }
    const box = drag.chip.getBoundingClientRect();
    drag.ghost = drag.chip.cloneNode(true);
    drag.ghost.classList.add('ghost');
    drag.ghost.style.width = `${box.width}px`;
    drag.offsetX = drag.x - box.left;
    drag.offsetY = drag.y - box.top;
    document.body.append(drag.ghost);
    drag.chip.classList.add('dragging');
    root.classList.add('is-dragging');
    navigator.vibrate?.(15);
    positionGhost();
    requestAnimationFrame(autoScroll);
  }

  function movePress(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
    if (!drag.active) {
      if (drag.touch && distance > SLOP_PX) cancelPress();
      else if (!drag.touch && distance > MOUSE_SLOP_PX) activate();
      return;
    }
    positionGhost();
  }

  function positionGhost() {
    drag.ghost.style.transform = `translate(${drag.x - drag.offsetX}px, ${drag.y - drag.offsetY}px)`;
    const under = document.elementFromPoint(drag.x, drag.y)?.closest('[data-bin]');
    const over = under && root.contains(under) ? under : null;
    if (over !== drag.over) {
      drag.over?.classList.remove('over');
      over?.classList.add('over');
      drag.over = over;
    }
  }

  function autoScroll() {
    if (!drag?.active) return;
    if (drag.y > window.innerHeight - EDGE_PX) window.scrollBy(0, 10);
    else if (drag.y < EDGE_PX) window.scrollBy(0, -10);
    positionGhost();
    requestAnimationFrame(autoScroll);
  }

  function endPress(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { active, over, name } = drag;
    cancelPress();
    if (!active) return; // a plain tap: the click handler selects the name
    suppressClick = true;
    setTimeout(() => {
      suppressClick = false;
    }, 0);
    if (over) {
      const binId = over.dataset.bin || null;
      if ((state[name] ?? null) !== binId) move(name, binId);
    }
  }

  function cancelPress() {
    if (!drag) return;
    clearTimeout(drag.timer);
    drag.ghost?.remove();
    drag.over?.classList.remove('over');
    drag.chip.classList.remove('dragging');
    root.classList.remove('is-dragging');
    drag = null;
  }

  function layout() {
    for (const [name, chip] of chips) {
      const part = binParts.find((p) => p.bin.id === state[name]);
      const home = part ? part.list : pool;
      if (chip.parentNode !== home) home.append(chip);
      chip.classList.toggle('selected', name === selected);
    }
    for (const part of binParts) {
      const n = part.list.children.length;
      part.count.textContent = selected ? 'tik om hier te plaatsen' : `${n} geplaatst`;
    }
    root.classList.toggle('has-selection', Boolean(selected));
  }

  layout();
  return { element: root, getPlacement: () => ({ ...state }) };
}