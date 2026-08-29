import Phaser from 'phaser';

const TITLE_TEXT = 'CADENCE — M0 · S0';
const TITLE_STYLE = {
  fontFamily: 'monospace',
  fontSize: '48px',
  color: '#e8e4d8',
} as const;

/**
 * The only scene S0 ships. It proves the toolchain boots and renders, and nothing
 * more — game rules never live in a Scene (CLAUDE.md §6).
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, TITLE_TEXT, TITLE_STYLE).setOrigin(0.5, 0.5);
  }
}
