// Pure scoring functions. No Firebase, no DOM, so they can be tested on their own.

import { scoreName } from './names.js';

const EPSILON = 1e-9;
const roundTiny = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Parse a number typed on a phone. Accepts Dutch and English notation and
 * ignores currency signs, units and spaces:
 *   "1.299,99" "$1,299.99" "€ 250" "1299.99" "12,5" "12,-" "4 km"
 * A single separator followed by exactly three digits ("1.299", "1,299") is
 * read as a thousands separator, unless the number starts with 0 ("0.125").
 * Returns null when there is no usable number.
 */
export function parseNumber(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  let s = String(input ?? '').replace(/[^0-9.,-]/g, '');
  const negative = s.startsWith('-');
  s = s.replace(/-/g, '').replace(/[.,]+$/, '');
  if (!/[0-9]/.test(s)) return null;

  const dots = (s.match(/\./g) ?? []).length;
  const commas = (s.match(/,/g) ?? []).length;
  if (dots && commas) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    if ((decimal === '.' ? dots : commas) > 1) return null;
    s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
  } else if (dots + commas > 1) {
    s = s.replace(/[.,]/g, '');
  } else if (dots + commas === 1) {
    const [head, tail] = s.split(/[.,]/);
    const thousands = tail.length === 3 && /^[1-9][0-9]{0,2}$/.test(head);
    s = thousands ? head + tail : `${head}.${tail}`;
  }

  const value = Number(s);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function scoreMc(choice, correct) {
  const norm = (v) => String(v ?? '').trim().toUpperCase();
  return norm(choice) !== '' && norm(choice) === norm(correct) ? 1 : 0;
}

export function scoreExactNumber(value, correct) {
  return value != null && Math.abs(value - correct) < EPSILON ? 1 : 0;
}

/** The margin is inclusive: exactly `margin` off still scores. */
export function scoreMarginNumber(value, correct, margin) {
  return value != null && Math.abs(value - correct) <= margin + EPSILON ? 1 : 0;
}

/**
 * Closest-answer ranking.
 *
 * `answers` is [{ groupId, value }] where value is a number, or null when the
 * group has no valid answer. `activeCount` (n) is the number of active groups,
 * including those that did not answer. Ties share a rank (competition
 * ranking: 1, 1, 3, 4) and points are max(0, n - rank).
 *
 * Returns { [groupId]: { points, rank, distance } }.
 */
export function scoreClosestRank(answers, correct, activeCount) {
  const result = {};
  const valid = [];
  for (const { groupId, value } of answers) {
    if (value == null || !Number.isFinite(value)) {
      result[groupId] = { points: 0, rank: null, distance: null };
    } else {
      valid.push({ groupId, distance: roundTiny(Math.abs(value - correct)) });
    }
  }
  valid.sort((a, b) => a.distance - b.distance);
  valid.forEach((entry, i) => {
    const tied = i > 0 && entry.distance === valid[i - 1].distance;
    entry.rank = tied ? valid[i - 1].rank : i + 1;
    result[entry.groupId] = {
      points: Math.max(0, activeCount - entry.rank),
      rank: entry.rank,
      distance: entry.distance,
    };
  });
  return result;
}

/**
 * One point per name in the right bin. `placement` and `correct` both map
 * name -> binId; a name that was not placed counts as wrong.
 */
export function scoreSortTwoBins(placement, correct) {
  let points = 0;
  for (const [name, bin] of Object.entries(correct)) {
    if (placement && placement[name] === bin) points++;
  }
  return points;
}

/** Default bonus points by finishing position (0-based): 3, 2, 1, 0, 0, ... */
export function bonusPoints(position, defaults = [3, 2, 1]) {
  return defaults[position] ?? 0;
}

/**
 * Score one item for every active group.
 *
 * `item` is an entry from the quiz definition, `values` maps groupId -> the
 * submitted value (missing/null when the group did not submit in time):
 *   mc             'A'..'D'
 *   number types   the raw text that was typed
 *   name           the raw text that was typed
 *   sort_two_bins  { name: binId }
 * `context` is { groupIds, people }; groupIds are the active groups.
 *
 * Returns { [groupId]: { points, status, detail } } with status
 *   'correct' | 'wrong'   plain right/wrong types
 *   'scored'              types with partial points (rank, sort)
 *   'check'               needs a human look (unreadable number, doubtful name)
 *   'none'                no answer
 * bonus_manual items are not scored here.
 */
export function scoreItem(item, values, context) {
  const { groupIds, people = [] } = context;
  const result = {};
  const has = (id) => values[id] != null && values[id] !== '';
  const none = { points: 0, status: 'none', detail: null };

  if (item.type === 'closest_rank') {
    const parsed = groupIds.map((id) => ({ groupId: id, value: has(id) ? parseNumber(values[id]) : null }));
    const ranked = scoreClosestRank(parsed, item.correct, groupIds.length);
    for (const { groupId, value } of parsed) {
      if (!has(groupId)) result[groupId] = none;
      else if (value == null) result[groupId] = { points: 0, status: 'check', detail: null };
      else result[groupId] = { points: ranked[groupId].points, status: 'scored', detail: { value, ...ranked[groupId] } };
    }
    return result;
  }

  for (const id of groupIds) {
    if (!has(id)) {
      result[id] = none;
      continue;
    }
    const raw = values[id];
    switch (item.type) {
      case 'mc': {
        const points = scoreMc(raw, item.correct);
        result[id] = { points, status: points ? 'correct' : 'wrong', detail: null };
        break;
      }
      case 'exact_number':
      case 'margin_number': {
        const value = parseNumber(raw);
        if (value == null) {
          result[id] = { points: 0, status: 'check', detail: null };
          break;
        }
        const points = item.type === 'exact_number'
          ? scoreExactNumber(value, item.correct)
          : scoreMarginNumber(value, item.correct, item.margin ?? 0);
        result[id] = { points, status: points ? 'correct' : 'wrong', detail: { value } };
        break;
      }
      case 'sort_two_bins': {
        const points = scoreSortTwoBins(raw, item.correct);
        result[id] = { points, status: 'scored', detail: { max: Object.keys(item.correct).length } };
        break;
      }
      case 'name': {
        const { points, status, personId } = scoreName(raw, item.correct, people);
        result[id] = { points, status, detail: { personId } };
        break;
      }
      default:
        result[id] = none;
    }
  }
  return result;
}

/**
 * Totals per group from the score log.
 *
 * Entries are { groupId, itemId, points, source, createdAt }.
 *   'auto' | 'bonus' | 'override'  belong to one item: per group and item only
 *       one counts, an override beats the others and the newest wins. Deleting
 *       an override therefore restores the automatic score.
 *   'penalty' | 'manual'           always add up.
 *
 * Returns { [groupId]: total }.
 */
export function computeTotals(entries) {
  const totals = {};
  const slots = new Map();
  const add = (groupId, points) => {
    totals[groupId] = (totals[groupId] ?? 0) + points;
  };
  entries.forEach((entry, index) => {
    const points = Number(entry.points) || 0;
    if (entry.source === 'penalty' || entry.source === 'manual' || !entry.itemId) {
      add(entry.groupId, points);
      return;
    }
    const key = `${entry.groupId}\u0000${entry.itemId}`;
    const candidate = {
      groupId: entry.groupId,
      points,
      override: entry.source === 'override',
      at: entry.createdAt ?? 0,
      index,
    };
    const current = slots.get(key);
    const newer = !current
      || (candidate.override !== current.override
        ? candidate.override
        : candidate.at > current.at || (candidate.at === current.at && candidate.index > current.index));
    if (newer) slots.set(key, candidate);
    if (!(entry.groupId in totals)) totals[entry.groupId] = 0;
  });
  for (const slot of slots.values()) add(slot.groupId, slot.points);
  return totals;
}
