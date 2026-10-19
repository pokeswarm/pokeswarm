import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** src/sim は Phaser（と描画・DOM 側のモジュール）に依存してはならない */
function listTs(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return listTs(path);
    return name.endsWith('.ts') ? [path] : [];
  });
}

describe('src/sim の依存', () => {
  it('phaser・render・scenes を import していない', () => {
    const offenders = listTs(__dirname).filter((file) => {
      const src = readFileSync(file, 'utf8');
      return /from\s+['"](phaser|.*\/(render|scenes)\/.*)['"]/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
