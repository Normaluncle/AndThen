import { describe, expect, it } from 'vitest';
import { coverCaptionAcceptable } from '../../src/modules/sources/cover-caption.js';

const body = '2015年我从公司辞职，把积蓄投入独立开发，想看看这条路能不能走通。';

describe('cover captions', () => {
  it('accepts a year plus a concrete line grounded in the original body', () => {
    expect(coverCaptionAcceptable(body, '我辞职投入独立开发', 2015)).toBe(true);
  });
  it('rejects abstract filler, invented outcomes and years that are not in the text', () => {
    expect(coverCaptionAcceptable(body, '决定考研这件事，对我来说并不轻松', 2015)).toBe(false);
    expect(coverCaptionAcceptable(body, '后来赚了100万', 2015)).toBe(false);
    expect(coverCaptionAcceptable(body, '我辞职投入独立开发', 1999)).toBe(false);
  });
});
