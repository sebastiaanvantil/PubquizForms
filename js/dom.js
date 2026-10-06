// Small DOM helpers shared by the player, admin and beamer pages.

export const $ = (id) => document.getElementById(id);

/** Create an element: h('button', { class: 'btn', onclick: fn }, 'Label'). */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.flat(Infinity).filter((c) => c != null && c !== false));
  return node;
}

let dialog = null;
let cancelOpenDialog = () => {};

/** Close an open confirm dialog as if "back" was pressed. */
export function closeConfirm() {
  cancelOpenDialog();
}

/**
 * Ask for confirmation. `body` is a string or a list of nodes.
 * Resolves to true when confirmed.
 */
export function confirmDialog({ title, body = [], okLabel = 'Ja', cancelLabel = 'Terug', danger = false }) {
  cancelOpenDialog();
  if (!dialog) {
    dialog = h('dialog');
    document.body.append(dialog);
  }
  const content = typeof body === 'string' ? [h('p', {}, body)] : body.filter(Boolean);
  return new Promise((resolve) => {
    const finish = (result) => {
      cancelOpenDialog = () => {};
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      resolve(result);
    };
    dialog.replaceChildren(
      h('h2', {}, title),
      h('div', {}, content),
      h('div', { class: 'row' },
        h('button', { class: `btn primary${danger ? ' danger' : ''}`, type: 'button', onclick: () => finish(true) }, okLabel),
        h('button', { class: 'btn', type: 'button', onclick: () => finish(false) }, cancelLabel)),
    );
    dialog.oncancel = () => finish(false);
    cancelOpenDialog = () => finish(false);
    dialog.showModal();
  });
}
