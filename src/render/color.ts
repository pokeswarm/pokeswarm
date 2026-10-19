/** "#rrggbb" を Phaser が受け取る数値に変える */
export function hexColor(hex: string): number {
  return parseInt(hex.slice(1), 16);
}
