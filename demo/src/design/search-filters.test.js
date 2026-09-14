import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('./SearchFilters.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../home.css', import.meta.url), 'utf8');

test('the more-filters toggle is rendered after the sort select, not before it', () => {
  const toggle = source.indexOf('d-filter-expand');
  const sortSelect = source.indexOf('aria-label="结果排序"');
  assert.ok(toggle > 0, 'the expand toggle must exist');
  assert.ok(sortSelect > 0, 'the sort select must exist');
  assert.ok(
    toggle > sortSelect,
    'the toggle must come after the sort select, otherwise it takes the left edge of the filter row',
  );
});

test('the toggle is pushed to the far right of the filter row', () => {
  assert.match(css, /\.d-filter-expand\{[^}]*margin-left:auto/);
});
