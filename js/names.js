// Pure name-matching helpers for the "who said it" rounds. No Firebase, no DOM.
//
// A person looks like { id, name, aliases: [..] }. Aliases are compared after
// normalisation, so "Sébas " and "sebas" are the same thing.

const FUZZY_MIN_LENGTH = 5;

/** trim, lowercase, strip accents, keep letters only. */
export function normalizeName(input) {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * Key used to keep group names unique: "De Bierbuiken!" and "de bierbuiken"
 * are the same name. Lowercase letters and digits only.
 */
export function groupNameKey(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function aliasesOf(person) {
  const all = [person.name, ...(person.aliases ?? [])].map(normalizeName).filter(Boolean);
  return [...new Set(all)];
}

/**
 * Find which person an input refers to.
 *
 * Returns { status, personId, candidates, normalized } where status is:
 *   'exact'  input equals an alias of exactly one person
 *   'fuzzy'  one typo away (input of 5+ letters) from exactly one person
 *   'check'  no match, but close enough that a human should look at it;
 *            `candidates` lists the people it could have meant
 *   'none'   nothing close
 * personId is only set for 'exact' and 'fuzzy'.
 */
export function matchName(input, people) {
  const normalized = normalizeName(input);
  const result = (status, personId, candidates) => ({ status, personId, candidates, normalized });
  if (!normalized) return result('none', null, []);

  const distances = people.map((p) => ({
    id: p.id,
    dist: Math.min(...aliasesOf(p).map((a) => levenshtein(normalized, a))),
  }));
  const idsAt = (d) => distances.filter((x) => x.dist === d).map((x) => x.id);

  const exact = idsAt(0);
  if (exact.length === 1) return result('exact', exact[0], exact);
  // Two people sharing an alias is a data error; never pick one silently.
  if (exact.length > 1) return result('check', null, exact);

  const oneOff = idsAt(1);
  if (normalized.length >= FUZZY_MIN_LENGTH) {
    if (oneOff.length === 1) return result('fuzzy', oneOff[0], oneOff);
    if (oneOff.length > 1) return result('check', null, oneOff);
    const twoOff = idsAt(2);
    if (twoOff.length) return result('check', null, twoOff);
    return result('none', null, []);
  }

  // Too short to trust a typo correction, but worth a look.
  if (oneOff.length) return result('check', null, oneOff);
  return result('none', null, []);
}

/**
 * Score a name answer against the accepted people for an item.
 *
 * Returns { points, status, personId } with status 'correct' | 'wrong' | 'check'.
 * An answer that matches somebody else (exactly or within tolerance) is plain
 * wrong. 'check' is only raised when the doubt involves an accepted person.
 */
export function scoreName(input, correctIds, people) {
  const accepted = new Set(correctIds ?? []);
  const match = matchName(input, people);
  if (match.personId) {
    const ok = accepted.has(match.personId);
    return { points: ok ? 1 : 0, status: ok ? 'correct' : 'wrong', personId: match.personId };
  }
  const doubtful = match.status === 'check' && match.candidates.some((id) => accepted.has(id));
  return { points: 0, status: doubtful ? 'check' : 'wrong', personId: null };
}
