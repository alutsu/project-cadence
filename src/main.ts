import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.ts';
import { CombatScene } from './scenes/CombatScene.ts';
import { LAYOUT } from './ui/theme.ts';

// GDD §16: design at 1920x1080, scale down to 1280x720.
new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: LAYOUT.width,
  height: LAYOUT.height,
  backgroundColor: '#0b0d12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene, CombatScene],
});
