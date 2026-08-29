import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene.ts';

// GDD §16: design at 1920x1080, scale down to 1280x720.
const DESIGN_WIDTH = 1920;
const DESIGN_HEIGHT = 1080;

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: DESIGN_WIDTH,
  height: DESIGN_HEIGHT,
  backgroundColor: '#0b0d12',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [BootScene],
});
