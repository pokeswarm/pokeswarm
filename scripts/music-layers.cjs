/**
 * 8bit の曲（data/audio/music/*.json）に、副旋律（counter）と和音（chords）を足し、ベースを 1 オクターブ上げる（07 の341・342章）。
 * 和音は分散和音（harmony）の半小節ごとの音から読む。副旋律は和音の音から選び、主旋律より下を動く:
 * 半小節の頭で鳴らし、主旋律が伸ばしている・休んでいる拍では次の和音の音へ動く。
 * すでに counter のある曲（手で書いた hoenn-route など）は触らない。
 * 使い方: node scripts/music-layers.cjs [曲の名前 ...]（省くと全曲）
 */
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data', 'audio', 'music');
const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const BAR = 16;
const HALF = 8;
/** 副旋律の音域（MIDI。G3〜D5） */
const LOW = 55;
const HIGH = 74;
/** これより遅い曲は、和音を半小節ずつ伸ばす（速い曲は 6・4・6 ステップで押す） */
const SLOW_BPM = 110;

const isNote = (t) => /^[A-G][#b]?-?\d$/.test(t);
const midi = (t) => {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(t);
  return (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
};
const name = (n, flat) => (flat ? NAMES_FLAT : NAMES_SHARP)[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1);
const tokens = (text) => text.trim().split(/\s+/);

/** 各ステップで鳴っている音（伸ばしを含む）と、音の始まりかどうか */
function sounding(toks) {
  const out = [];
  let cur = null;
  for (const t of toks) {
    if (t === '.') cur = null;
    else if (t !== '-') cur = isNote(t) ? midi(t) : null;
    out.push({ pitch: cur, onset: t !== '-' && t !== '.' });
  }
  return out;
}

/** 根音（ベースの音）と、分かっている音から 3 和音を組む（A3 から上の近い並べ方） */
function triad(known, bassTok) {
  if (!bassTok) return known;
  const root = midi(bassTok) % 12;
  const pcs = new Set(known.map((n) => n % 12));
  const third = pcs.has((root + 3) % 12) ? 3 : 4;
  const fifth = pcs.has((root + 6) % 12) && !pcs.has((root + 7) % 12) ? 6 : 7;
  return [root, root + third, root + fifth].map((pc) => 57 + ((((pc % 12) - 57) % 12) + 12) % 12).sort((x, y) => x - y);
}

function layer(score) {
  const flat = JSON.stringify(score.patterns).match(/[A-G]b\d/g)?.length > (JSON.stringify(score.patterns).match(/[A-G]#\d/g)?.length ?? 0);
  const slow = score.bpm < SLOW_BPM;
  const lowestBass = Math.min(...Object.values(score.patterns).flatMap((q) => tokens(q.bass).filter(isNote).map(midi)));
  let prevCounter = 64;
  let prevLead = 76;
  let dir = -1;
  for (const p of Object.values(score.patterns)) {
    const lead = sounding(tokens(p.lead));
    const harm = tokens(p.harmony);
    const len = harm.length;
    // 半小節ごとの和音（分散和音の音。低い順）。半小節で 3 音そろわなければ小節全体から読む。
    // それでも足りなければ（1 音を伸ばす曲）、ベースの最初の音を根音にして 3 和音を組む
    const bassToks = tokens(p.bass);
    const notesIn = (from, to) => [...new Set(harm.slice(from, to).filter(isNote).map(midi))].sort((x, y) => x - y);
    const pcCount = (set) => new Set(set.map((n) => n % 12)).size;
    const halves = [];
    for (let i = 0; i < len; i += HALF) {
      const bar = i - (i % BAR);
      let set = notesIn(i, i + HALF);
      if (pcCount(set) < 3) set = notesIn(bar, bar + BAR);
      if (pcCount(set) < 3) set = triad(set, bassToks.slice(i, i + HALF).find(isNote) ?? bassToks.slice(bar, bar + BAR).find(isNote));
      halves.push(set.length ? set : halves[halves.length - 1] ?? [60, 64, 67]);
    }

    // 和音
    const chords = new Array(len).fill('-');
    const put = (at, set) => (chords[at] = set.map((n) => name(n, flat)).join('+'));
    for (let bar = 0; bar < len; bar += BAR) {
      const a = halves[bar / HALF];
      const b = halves[bar / HALF + 1] ?? a;
      const same = a.join() === b.join();
      if (slow) {
        put(bar, a);
        put(bar + HALF, b);
      } else if (same) {
        put(bar, a);
        put(bar + 6, a);
        put(bar + 10, a);
      } else {
        put(bar, a);
        put(bar + 6, a);
        put(bar + 8, b);
        put(bar + 10, b);
      }
    }

    // 副旋律
    const counter = new Array(len).fill('-');
    let lastLead = 76;
    for (let beat = 0; beat < len; beat += 4) {
      const head = beat % HALF === 0;
      let leadMoves = false;
      for (let s = beat; s < beat + 4; s++) if (lead[s].onset && lead[s].pitch !== null) leadMoves = true;
      if (!head && leadMoves) continue;
      for (let s = beat; s < beat + 4; s++) if (lead[s].pitch !== null) { lastLead = lead[s].pitch; break; }
      const leadNow = lead[beat].pitch ?? lastLead;
      const ceiling = Math.min(HIGH, leadNow - 3);
      const pcs = new Set(halves[Math.floor(beat / HALF)].map((n) => n % 12));
      const all = [];
      for (let n = LOW; n <= ceiling; n++) if (pcs.has(n % 12)) all.push(n);
      if (!all.length) for (let n = LOW - 12; n <= ceiling; n++) if (pcs.has(n % 12)) all.push(n);
      if (!all.length) continue;
      // 半小節の頭では主旋律と同じ音名を避ける（重なって聞こえる）。動く拍では許す（跳ばないように）
      const noDouble = all.filter((n) => n % 12 !== leadNow % 12);
      const cands = head && noDouble.length ? noDouble : all;
      if (head) {
        // 主旋律と反対の向きへ（主旋律が上がれば下がる）
        if (leadNow > prevLead) dir = -1;
        else if (leadNow < prevLead) dir = 1;
        prevLead = leadNow;
      }
      // 前と違う和音の音のうち、向きに沿っていちばん近いもの（端なら向きを変える）
      let pool = cands.filter((n) => (dir > 0 ? n > prevCounter : n < prevCounter));
      if (!pool.length) {
        dir = -dir;
        pool = cands.filter((n) => (dir > 0 ? n > prevCounter : n < prevCounter));
      }
      if (!pool.length) {
        if (!head) continue;
        pool = cands;
      }
      const pick = pool.reduce((x, y) => (Math.abs(y - prevCounter) < Math.abs(x - prevCounter) ? y : x));
      counter[beat] = name(pick, flat);
      prevCounter = pick;
    }

    // ベースを 1 オクターブ上げる（もう 3 より上にある曲はそのまま）
    const bass = tokens(p.bass);
    const bassUp = lowestBass < 48 ? bass.map((t) => (isNote(t) ? name(midi(t) + 12, /b/.test(t)) : t)) : bass;

    const out = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'lead') {
        out.lead = v;
        out.counter = counter.join(' ');
        out.chords = chords.join(' ');
      } else if (k === 'bass') out.bass = bassUp.join(' ');
      else out[k] = v;
    }
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, out);
  }
  const ch = score.channels;
  score.channels = {
    lead: ch.lead,
    counter: { wave: 'square', duty: 0.25, volume: 0.09 },
    chords: { wave: 'square', duty: 0.25, volume: 0.035 },
    ...Object.fromEntries(Object.entries(ch).filter(([k]) => k !== 'lead')),
  };
}

const only = process.argv.slice(2);
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  const id = file.replace(/\.json$/, '');
  if (only.length && !only.includes(id)) continue;
  const p = path.join(DIR, file);
  const score = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (score.channels.counter) {
    console.log(`${id}: もう副旋律があるので飛ばす`);
    continue;
  }
  layer(score);
  fs.writeFileSync(p, JSON.stringify(score, null, 2) + '\n');
  console.log(`${id}: 副旋律・和音を足した`);
}
