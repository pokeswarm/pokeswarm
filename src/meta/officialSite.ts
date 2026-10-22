import type { z } from 'zod';
import type { siteConfigSchema } from '../data/schema';

/** 公式のアドレスか（data/site.json の allowedHosts と同じか、allowedHostSuffixes のどれかで終わる） */
export function isOfficialHost(hostname: string, site: Pick<z.infer<typeof siteConfigSchema>, 'allowedHosts' | 'allowedHostSuffixes'>): boolean {
  const host = hostname.toLowerCase();
  return site.allowedHosts.includes(host) || site.allowedHostSuffixes.some((s) => host === s || host.endsWith(`.${s}`));
}
