import {
  BoxGeometry,
  CanvasTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
} from "three";
export class MiningOverlay extends Mesh {
  private stages: MeshBasicMaterial[] = [];
  constructor() {
    super(new BoxGeometry(1.007, 1.007, 1.007));
    for (let stage = 0; stage < 10; stage++) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 16;
      const c = canvas.getContext("2d")!;
      c.strokeStyle = "#1c201bdd";
      c.lineWidth = 1;
      for (let branch = 0; branch <= stage; branch++) {
        c.beginPath();
        c.moveTo(8, 8);
        let x = 8,
          y = 8;
        for (let i = 0; i < 3 + stage; i++) {
          x += ((branch * 7 + i * 11) % 3) - 1;
          y += ((branch * 13 + i * 7) % 3) - 1;
          c.lineTo(x + (branch % 2 ? i * 0.5 : -i * 0.5), y);
        }
        c.stroke();
      }
      const texture = new CanvasTexture(canvas);
      texture.magFilter = texture.minFilter = NearestFilter;
      this.stages.push(
        new MeshBasicMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
    }
    this.visible = false;
    this.material = this.stages[0];
  }
  update(x: number, y: number, z: number, progress: number) {
    this.position.set(x + 0.5, y + 0.5, z + 0.5);
    this.material = this.stages[Math.min(9, Math.floor(progress * 10))];
    this.visible = progress > 0;
  }
}
