import { describe, expect, it } from 'vitest';
import { buildSimRules, playableLoadout } from '../data/simRules';
import { Simulation } from './simulation';
import { counterPick } from './systems/stage';

const SHINIES = ['shiny-charizard', 'shiny-venusaur', 'shiny-blastoise'];

/** そのポケモンたちで遊んでいるときに選ばれる色違いの御三家 */
function pick(...pokemon: string[]): string {
  const rules = buildSimRules();
  const sim = new Simulation({ tickRate: 30, seed: 1, rules });
  pokemon.forEach((key, i) => sim.addPlayer({ id: i + 1, x: 0, y: 0, radius: 12, moveSpeed: 0, types: playableLoadout(rules, key).types }));
  return counterPick(sim.world, SHINIES);
}

/** 色違いの御三家は、そのランのポケモンに一番不利な相手（作者の決定 2026年10月24日） */
describe('相性で選ぶ伝説', () => {
  it('ヒトカゲにはカメックス、フシギダネにはリザードン、ゼニガメにはフシギバナ', () => {
    expect(pick('charmander')).toBe('shiny-blastoise');
    expect(pick('bulbasaur')).toBe('shiny-charizard');
    expect(pick('squirtle')).toBe('shiny-venusaur');
  });

  it('ほかのポケモンでも選ばれる（ピカチュウにはでんきが効きにくいフシギバナ）', () => {
    expect(pick('pikachu')).toBe('shiny-venusaur');
  });
});
