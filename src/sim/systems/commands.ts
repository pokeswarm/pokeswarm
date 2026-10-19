import type { InputCommand } from '../commands';
import { findPlayer, type World } from '../world';

export function applyCommands(world: World, commands: readonly InputCommand[]): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case 'move': {
        const p = findPlayer(world, cmd.playerId);
        if (!p) break;
        p.inputX = cmd.dx;
        p.inputY = cmd.dy;
        break;
      }
    }
  }
}
