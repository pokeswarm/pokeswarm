import { describe, expect, it } from 'vitest';
import { RunCrumbs } from './runProbe';

describe('落ちる直前の出来事の記録（07 の348章）', () => {
  it('古いものから捨て、同じ名前が続いたら数だけ増やす', () => {
    const c = new RunCrumbs(3);
    c.add(5, 'levelUp');
    c.add(61, '<hz');
    c.add(62, '<hz');
    c.add(125, 'sectionAdvanced');
    c.add(130, 'bossAppeared');
    expect(c.lines()).toEqual(['1:01 <hz ×2', '2:05 sectionAdvanced', '2:10 bossAppeared']);
  });
});
