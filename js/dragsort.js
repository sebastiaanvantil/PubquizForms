// Two-bin sorter for round 4. Tap a name, then tap a bin (or the pool to take
// it back). No Firebase in here.

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

  const root = el('div', 'sorter');
  const targets = el('div', 'sort-targets');
  const pool = el('div', 'sort-pool');
  const lists = el('div', 'sort-lists');
  root.append(targets, pool, lists);

  const binParts = bins.map((bin) => {
    const target = el('button', 'sort-target');
    target.type = 'button';
    const count = el('small');
    target.append(bin.label, count);
    target.addEventListener('click', () => place(bin.id));
    targets.append(target);

    const column = el('div');
    const list = el('div', 'sort-list');
    list.addEventListener('click', () => place(bin.id));
    column.append(el('h3', '', bin.label), list);
    lists.append(column);
    return { bin, target, count, list };
  });
  pool.addEventListener('click', () => place(null));

  const chips = new Map();
  for (const name of names) {
    const chip = el('button', 'chip', name);
    chip.type = 'button';
    chip.addEventListener('click', (event) => {
      event.stopPropagation();
      selected = selected === name ? null : name;
      layout();
    });
    chips.set(name, chip);
  }

  function place(binId) {
    if (!selected) return;
    if (binId) state[selected] = binId;
    else delete state[selected];
    selected = null;
    layout();
    onChange({ ...state });
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
