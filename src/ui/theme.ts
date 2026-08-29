/**
 * The whole visual budget in one file (GDD §15.1): flat colour, one mono
 * typeface, no art. If a view needs a value that is not here, the question is
 * whether the view needs the value — not whether to add a literal.
 */
export const COLORS = {
  background: 0x0b0d12,
  panel: 0x151a23,
  panelEdge: 0x2b3342,
  panelActive: 0x1e2534,
  ink: 0xe8e4d8,
  muted: 0x7d8794,
  /** The player's mark. Deliberately the loudest colour on screen (GDD §15.1). */
  player: 0xd9b45b,
  enemy: 0xb4574d,
  danger: 0xe0705f,
} as const;

export const INK = '#e8e4d8';
export const MUTED = '#7d8794';
export const PLAYER_INK = '#d9b45b';
export const ENEMY_INK = '#d99087';

export const FONT = 'ui-monospace, "DejaVu Sans Mono", Menlo, monospace';

export const TYPE = {
  slotTick: '26px',
  slotName: '18px',
  slotIntent: '16px',
  cardName: '20px',
  /** Weight, Recovery and damage share one size — GDD §15 makes that a rule. */
  cardStat: '34px',
  cardStatLabel: '14px',
  enemyName: '22px',
  enemyHp: '20px',
  hud: '24px',
  button: '26px',
} as const;

export const LAYOUT = {
  width: 1920,
  height: 1080,
  queue: { top: 110, slotWidth: 210, slotHeight: 116, gap: 12 },
  enemies: { centerY: 470, width: 230, height: 260, gap: 90 },
  /**
   * The hand fans on an arc (`lift`) rather than by rotation. Phaser 4.2.1
   * corrupts glyphs inside rotated containers under WebGL — half-cut digits on
   * exactly the Weight and damage numbers §15 says must be unmissable — while
   * the Canvas renderer draws them correctly. Legibility outranks the flourish
   * (P5), so `tiltDegrees` stays 0 until the WebGL path is understood.
   */
  hand: { baselineY: 850, cardWidth: 190, cardHeight: 250, gap: 30, tiltDegrees: 0, lift: 22 },
  hud: { margin: 48 },
} as const;
