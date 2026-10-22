import { describe, expect, it } from 'vitest';
import site from '../../data/site.json';
import { isOfficialHost } from './officialSite';

describe('isOfficialHost', () => {
  const cfg = { allowedHosts: site.allowedHosts, allowedHostSuffixes: site.allowedHostSuffixes };
  it('公式のアドレスと開発用のアドレスを通す', () => {
    expect(isOfficialHost('pokeswarm.org', cfg)).toBe(true);
    expect(isOfficialHost('WWW.pokeswarm.org', cfg)).toBe(true);
    expect(isOfficialHost('pokeswarm.pokeswarm-dev.workers.dev', cfg)).toBe(true);
    expect(isOfficialHost('abc123-pokeswarm.pokeswarm-dev.workers.dev', cfg)).toBe(true);
  });
  it('ほかのアドレス・似せたアドレスは通さない', () => {
    expect(isOfficialHost('pirate-games.example', cfg)).toBe(false);
    expect(isOfficialHost('pokeswarm.org.example.com', cfg)).toBe(false);
    expect(isOfficialHost('evilpokeswarm-dev.workers.dev', cfg)).toBe(false);
    expect(isOfficialHost('pokeswarm.pages.dev', cfg)).toBe(false);
  });
});
