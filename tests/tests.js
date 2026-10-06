// Tests for js/scoring.js and js/names.js.
// Browser: open tests/index.html through a local web server.
// Node:    node tests/run.mjs
//
// The fixtures below are made up. Real quiz data never belongs in this repo.

import {
  parseNumber, scoreMc, scoreExactNumber, scoreMarginNumber, scoreClosestRank,
  scoreSortTwoBins, bonusPoints, scoreItem, computeTotals,
} from '../js/scoring.js';
import { normalizeName, levenshtein, matchName, scoreName } from '../js/names.js';

const results = [];
let currentSuite = '';

function suite(name, fn) {
  currentSuite = name;
  fn();
}

function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ suite: currentSuite, label, ok: a === e, actual: a, expected: e });
}

const PEOPLE = [
  { id: 'seb', name: 'Seb', aliases: ['seb', 'sebas', 'sebastiaan'] },
  { id: 'flo', name: 'Flo', aliases: ['flo'] },
  { id: 'floor', name: 'Floor', aliases: ['floor'] },
  { id: 'marieke', name: 'Marieke', aliases: ['marieke', 'riek'] },
  { id: 'karel', name: 'Karel', aliases: ['karel'] },
  { id: 'karen', name: 'Karen', aliases: ['karen'] },
];

suite('parseNumber', () => {
  eq(parseNumber('1299'), 1299, 'plain integer');
  eq(parseNumber('1299.99'), 1299.99, 'English decimal');
  eq(parseNumber('1299,99'), 1299.99, 'Dutch decimal');
  eq(parseNumber('1.299,99'), 1299.99, 'Dutch thousands + decimal');
  eq(parseNumber('$1,299.99'), 1299.99, 'English thousands + decimal with $');
  eq(parseNumber('€ 250'), 250, 'euro sign and space');
  eq(parseNumber('€250,-'), 250, 'Dutch ",-" price');
  eq(parseNumber(' 12,5 '), 12.5, 'one decimal, spaces');
  eq(parseNumber('1.299'), 1299, 'single dot + 3 digits = thousands');
  eq(parseNumber('1,299'), 1299, 'single comma + 3 digits = thousands');
  eq(parseNumber('0.125'), 0.125, 'leading zero stays decimal');
  eq(parseNumber('1.234.567'), 1234567, 'repeated thousands separator');
  eq(parseNumber('16,95'), 16.95, 'two decimals');
  eq(parseNumber('4 km'), 4, 'unit typed along');
  eq(parseNumber('2014'), 2014, 'year');
  eq(parseNumber(''), null, 'empty');
  eq(parseNumber('geen idee'), null, 'no digits');
  eq(parseNumber('€'), null, 'only a currency sign');
  eq(parseNumber(null), null, 'null');
  eq(parseNumber(42), 42, 'already a number');
});

suite('mc / exact / margin', () => {
  eq(scoreMc('B', 'B'), 1, 'mc correct');
  eq(scoreMc('b', 'B'), 1, 'mc case-insensitive');
  eq(scoreMc('A', 'B'), 0, 'mc wrong');
  eq(scoreMc('', 'B'), 0, 'mc empty');
  eq(scoreMc(null, 'B'), 0, 'mc missing');
  eq(scoreExactNumber(2000, 2000), 1, 'exact correct');
  eq(scoreExactNumber(2001, 2000), 0, 'exact one off');
  eq(scoreExactNumber(null, 2000), 0, 'exact missing');
  eq(scoreMarginNumber(100, 100, 50), 1, 'margin spot on');
  eq(scoreMarginNumber(150, 100, 50), 1, 'margin exactly 50 above is correct');
  eq(scoreMarginNumber(50, 100, 50), 1, 'margin exactly 50 below is correct');
  eq(scoreMarginNumber(150.01, 100, 50), 0, 'margin just above');
  eq(scoreMarginNumber(49.99, 100, 50), 0, 'margin just below');
  eq(scoreMarginNumber(null, 100, 50), 0, 'margin missing');
});

suite('closest_rank', () => {
  const pts = (answers, correct, n) => {
    const r = scoreClosestRank(answers, correct, n);
    return answers.map((a) => r[a.groupId].points);
  };
  const ranks = (answers, correct, n) => {
    const r = scoreClosestRank(answers, correct, n);
    return answers.map((a) => r[a.groupId].rank);
  };
  const tie = [
    { groupId: 'a', value: 100 }, { groupId: 'b', value: 100 },
    { groupId: 'c', value: 105 }, { groupId: 'd', value: 91 },
  ];
  eq(ranks(tie, 100, 4), [1, 1, 3, 4], 'distances 0,0,5,9 -> ranks 1,1,3,4');
  eq(pts(tie, 100, 4), [3, 3, 1, 0], 'distances 0,0,5,9 with n=4 -> 3,3,1,0');

  const mirrored = [{ groupId: 'a', value: 95 }, { groupId: 'b', value: 105 }, { groupId: 'c', value: 120 }];
  eq(pts(mirrored, 100, 3), [2, 2, 0], 'above and below at equal distance share a rank');

  const missing = [
    { groupId: 'a', value: 10 }, { groupId: 'b', value: null }, { groupId: 'c', value: 30 }, { groupId: 'd', value: null },
  ];
  eq(pts(missing, 12, 4), [3, 0, 2, 0], 'no answer = 0 points, n still counts every active group');
  eq(ranks(missing, 12, 4), [1, null, 2, null], 'no answer has no rank');

  eq(pts([{ groupId: 'a', value: 5 }], 5, 1), [0], 'single group gets n - 1 = 0');
  eq(pts([{ groupId: 'a', value: 12.99 }, { groupId: 'b', value: 13.01 }], 13, 2), [1, 1], 'float distances that should tie do tie');
  eq(pts([{ groupId: 'a', value: 1 }, { groupId: 'b', value: 2 }, { groupId: 'c', value: 3 }], 0, 6), [5, 4, 3], 'n larger than the number of answers');
  eq(scoreClosestRank([], 10, 3), {}, 'nobody answered');
});

suite('sort_two_bins / bonus', () => {
  const correct = { a: 'x', b: 'x', c: 'y', d: 'y' };
  eq(scoreSortTwoBins({ a: 'x', b: 'x', c: 'y', d: 'y' }, correct), 4, 'all correct');
  eq(scoreSortTwoBins({ a: 'y', b: 'x', c: 'y', d: 'x' }, correct), 2, 'two wrong');
  eq(scoreSortTwoBins({ a: 'x', c: 'y' }, correct), 2, 'unplaced names count as wrong');
  eq(scoreSortTwoBins({}, correct), 0, 'nothing placed');
  eq(scoreSortTwoBins(null, correct), 0, 'no placement at all');
  eq(scoreSortTwoBins({ a: 'x', zzz: 'x' }, correct), 1, 'unknown names are ignored');
  eq([0, 1, 2, 3, 4].map((i) => bonusPoints(i)), [3, 2, 1, 0, 0], 'bonus defaults 3,2,1,0,0');
  eq([0, 1].map((i) => bonusPoints(i, [5])), [5, 0], 'custom bonus defaults');
});

suite('normalizeName / levenshtein', () => {
  eq(normalizeName('  Séb '), 'seb', 'trim, lowercase, accents');
  eq(normalizeName('Flo!'), 'flo', 'punctuation removed');
  eq(normalizeName('fl0'), 'fl', 'digits removed');
  eq(normalizeName('Anne-Marie'), 'annemarie', 'hyphen removed');
  eq(normalizeName(null), '', 'null');
  eq(levenshtein('floor', 'flor'), 1, 'deletion');
  eq(levenshtein('flo', 'floor'), 2, 'two insertions');
  eq(levenshtein('karel', 'karen'), 1, 'substitution');
  eq(levenshtein('', 'abc'), 3, 'empty');
});

suite('matchName', () => {
  const m = (input) => {
    const r = matchName(input, PEOPLE);
    return [r.status, r.personId];
  };
  eq(m('flo'), ['exact', 'flo'], '"flo" is Flo');
  eq(m('Floor'), ['exact', 'floor'], '"Floor" is Floor');
  eq(m('FLO '), ['exact', 'flo'], 'case and spaces');
  eq(m('flor'), ['check', null], '"flor" is too short to correct');
  eq(matchName('flor', PEOPLE).candidates, ['flo', 'floor'], '"flor" could be Flo or Floor');
  eq(m('fl0'), ['check', null], '"fl0" is never matched automatically');
  eq(m('flooor'), ['fuzzy', 'floor'], 'typo of 6 letters resolves to Floor');
  eq(m('floot'), ['fuzzy', 'floor'], 'typo of 5 letters resolves to Floor, not Flo');
  eq(m('seb'), ['exact', 'seb'], 'Seb');
  eq(m('Sebas'), ['exact', 'seb'], 'Sebas is the same person as Seb');
  eq(m('sebass'), ['fuzzy', 'seb'], 'typo in an alias');
  eq(m('sebastian'), ['fuzzy', 'seb'], 'one letter off a long alias');
  eq(m('mareike'), ['check', null], 'transposition is distance 2 -> check');
  eq(m('mariek'), ['fuzzy', 'marieke'], 'one letter missing');
  eq(m('karem'), ['check', null], 'one typo away from two people -> check');
  eq(matchName('karem', PEOPLE).candidates, ['karel', 'karen'], 'both candidates reported');
  eq(m('karel'), ['exact', 'karel'], 'exact beats the neighbour');
  eq(m('sep'), ['check', null], 'short input one off -> check only');
  eq(m('xyzzy'), ['none', null], 'nothing close');
  eq(m(''), ['none', null], 'empty');
  eq(m('   '), ['none', null], 'only spaces');
});

suite('scoreName', () => {
  const s = (input, correct) => {
    const r = scoreName(input, correct, PEOPLE);
    return [r.points, r.status];
  };
  eq(s('flo', ['flo']), [1, 'correct'], 'Flo for Flo');
  eq(s('floor', ['flo']), [0, 'wrong'], 'Floor for Flo is wrong');
  eq(s('flo', ['floor']), [0, 'wrong'], 'Flo for Floor is wrong');
  eq(s('flooor', ['flo']), [0, 'wrong'], 'typo that resolves to Floor is wrong for Flo');
  eq(s('flooor', ['floor']), [1, 'correct'], 'typo that resolves to Floor is right for Floor');
  eq(s('flor', ['flo']), [0, 'check'], '"flor" scores nothing but is flagged');
  eq(s('flor', ['seb']), [0, 'wrong'], 'doubt between two wrong people is just wrong');
  eq(s('fl0', ['flo']), [0, 'check'], '"fl0" scores nothing but is flagged');
  eq(s('fl0', ['seb']), [0, 'wrong'], '"fl0" for somebody else is just wrong');
  eq(s('sebas', ['seb']), [1, 'correct'], 'Sebas counts for Seb');
  eq(s('seb', ['seb', 'flo']), [1, 'correct'], 'tie: first accepted person');
  eq(s('flo', ['seb', 'flo']), [1, 'correct'], 'tie: second accepted person');
  eq(s('floor', ['seb', 'flo']), [0, 'wrong'], 'tie: somebody else');
  eq(s('karem', ['karel']), [0, 'check'], 'ambiguous typo involving the right person');
  eq(s('', ['seb']), [0, 'wrong'], 'empty');
  eq(s('seb', []), [0, 'wrong'], 'no accepted people configured');
});

suite('scoreItem', () => {
  const ctx = { groupIds: ['g1', 'g2', 'g3'], people: PEOPLE };
  const pts = (r) => ctx.groupIds.map((id) => r[id].points);
  const st = (r) => ctx.groupIds.map((id) => r[id].status);

  let r = scoreItem({ type: 'mc', correct: 'C' }, { g1: 'C', g2: 'A' }, ctx);
  eq([pts(r), st(r)], [[1, 0, 0], ['correct', 'wrong', 'none']], 'mc');

  r = scoreItem({ type: 'exact_number', correct: 1999 }, { g1: '1999', g2: '1.999', g3: 'ergens toen' }, ctx);
  eq([pts(r), st(r)], [[1, 1, 0], ['correct', 'correct', 'check']], 'exact_number, unreadable input is flagged');

  r = scoreItem({ type: 'margin_number', correct: 100, margin: 50 }, { g1: '€ 150', g2: '150,01', g3: '' }, ctx);
  eq([pts(r), st(r)], [[1, 0, 0], ['correct', 'wrong', 'none']], 'margin_number');

  r = scoreItem({ type: 'closest_rank', correct: 20 }, { g1: '$19.99', g2: '25,00' }, ctx);
  eq([pts(r), st(r)], [[2, 1, 0], ['scored', 'scored', 'none']], 'closest_rank uses every active group for n');

  r = scoreItem({ type: 'closest_rank', correct: 20 }, { g1: '20', g2: 'veel', g3: '20' }, ctx);
  eq([pts(r), st(r)], [[2, 0, 2], ['scored', 'check', 'scored']], 'closest_rank with an unreadable answer');

  r = scoreItem({ type: 'sort_two_bins', correct: { a: 'x', b: 'y' } }, { g1: { a: 'x', b: 'y' }, g2: { a: 'y' } }, ctx);
  eq([pts(r), st(r)], [[2, 0, 0], ['scored', 'scored', 'none']], 'sort_two_bins');

  r = scoreItem({ type: 'name', correct: ['flo'] }, { g1: 'Flo', g2: 'Floor', g3: 'flor' }, ctx);
  eq([pts(r), st(r)], [[1, 0, 0], ['correct', 'wrong', 'check']], 'name');
});

suite('computeTotals', () => {
  eq(computeTotals([]), {}, 'empty log');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 1, source: 'auto', createdAt: 1 },
    { groupId: 'a', itemId: 'q2', points: 3, source: 'auto', createdAt: 2 },
    { groupId: 'b', itemId: 'q1', points: 0, source: 'auto', createdAt: 1 },
  ]), { a: 4, b: 0 }, 'sums auto points, groups with 0 are listed');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 0, source: 'auto', createdAt: 1 },
    { groupId: 'a', itemId: 'q1', points: 1, source: 'override', createdAt: 2 },
  ]), { a: 1 }, 'override replaces auto');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 1, source: 'override', createdAt: 2 },
    { groupId: 'a', itemId: 'q1', points: 0, source: 'auto', createdAt: 5 },
  ]), { a: 1 }, 'override still wins when auto is recalculated later');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 1, source: 'override', createdAt: 2 },
    { groupId: 'a', itemId: 'q1', points: 0, source: 'override', createdAt: 3 },
  ]), { a: 0 }, 'newest override wins');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 2, source: 'auto', createdAt: 1 },
    { groupId: 'a', itemId: 'q1', points: 1, source: 'auto', createdAt: 9 },
  ]), { a: 1 }, 'a recalculated auto score replaces the old one');
  eq(computeTotals([
    { groupId: 'a', itemId: 'bonus1', points: 3, source: 'bonus', createdAt: 1 },
    { groupId: 'a', itemId: 'bonus1', points: 2, source: 'bonus', createdAt: 2 },
    { groupId: 'a', itemId: 'q1', points: 1, source: 'auto', createdAt: 1 },
  ]), { a: 3 }, 'an edited bonus replaces the earlier value');
  eq(computeTotals([
    { groupId: 'a', itemId: 'q1', points: 1, source: 'auto', createdAt: 1 },
    { groupId: 'a', itemId: 'q1', points: -1, source: 'penalty', createdAt: 2 },
    { groupId: 'a', itemId: 'q1', points: -1, source: 'penalty', createdAt: 3 },
    { groupId: 'a', itemId: null, points: 5, source: 'manual', createdAt: 4 },
  ]), { a: 4 }, 'penalties and manual points always add up');
});

export function getResults() {
  return results;
}
