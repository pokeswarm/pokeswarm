import { describe, expect, it } from 'vitest';
import { musicScores } from '../data';
import { noteFrequency, parseScore } from './music';

describe('8bit の曲（楽譜）', () => {
  it('音符を周波数にする（A4 = 440Hz）', () => {
    expect(noteFrequency('A4')).toBeCloseTo(440);
    expect(noteFrequency('C4')).toBeCloseTo(261.63, 1);
    expect(noteFrequency('F#5')).toBeCloseTo(739.99, 1);
    expect(noteFrequency('Bb3')).toBeCloseTo(233.08, 1);
  });

  it('"-" で伸ばし、"." で休む。パターンを順につなぐ', () => {
    const { notes, length } = parseScore({
      bpm: 60,
      stepsPerBeat: 1,
      channels: { a: { wave: 'square', duty: 0.5, volume: 1 }, d: { wave: 'noise', duty: 0.5, volume: 1 } },
      patterns: { P: { a: 'C4 - . E4', d: 'k . s .' } },
      order: ['P', 'P'],
    });
    expect(length).toBe(8);
    const a = notes.filter((n) => n.channel === 'a');
    expect(a.map((n) => [n.time, n.duration])).toEqual([[0, 2], [3, 1], [4, 2], [7, 1]]);
    expect(notes.filter((n) => n.channel === 'd').map((n) => n.drum)).toEqual(['k', 's', 'k', 's']);
  });

  it('どの曲も、パターンの中のパートの長さがそろっていて、音符が読める', () => {
    for (const [name, score] of Object.entries(musicScores)) {
      for (const [p, parts] of Object.entries(score.patterns)) {
        const lengths = new Set(Object.values(parts).map((t) => t.trim().split(/\s+/).length));
        expect(lengths.size, `${name} ${p}`).toBe(1);
      }
      expect(() => parseScore(score), name).not.toThrow();
    }
  });
});
