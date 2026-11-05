import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  AmbientLight,
  DirectionalLight,
  Color,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PlayerModel } from "../models/PlayerModel";
import type { SkinVariant } from "./SkinFormat";
export class SkinPreview {
  private renderer = new WebGLRenderer({ antialias: false, alpha: true });
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.1, 100);
  private controls: OrbitControls;
  private model?: PlayerModel;
  private frame = 0;
  private last = 0;
  private observer: ResizeObserver;
  constructor(private host: HTMLElement) {
    host.append(this.renderer.domElement);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.scene.background = new Color("#10251d");
    this.scene.add(new AmbientLight(0xffffff, 2));
    const light = new DirectionalLight(0xfff1cc, 3);
    light.position.set(-3, 5, 4);
    this.scene.add(light);
    this.camera.position.set(2, 1.5, 4);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.minDistance = 2;
    this.controls.maxDistance = 7;
    this.controls.enablePan = false;
    this.controls.update();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.animate(0);
  }
  set(texture: Texture, variant: SkinVariant, layers: boolean) {
    this.model?.dispose();
    this.model = new PlayerModel(texture, variant, layers);
    this.scene.add(this.model);
  }
  private resize() {
    const width = this.host.clientWidth,
      height = this.host.clientHeight;
    this.renderer.setSize(Math.max(width, 1), Math.max(height, 1), false);
    this.camera.aspect = width / Math.max(height, 1);
    this.camera.updateProjectionMatrix();
  }
  private animate = (time: number) => {
    this.frame = requestAnimationFrame(this.animate);
    const dt = Math.min((time - this.last) / 1000 || 0.016, 0.05);
    this.last = time;
    this.model?.animate(dt, 0, 0, true, false, 0, 0);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.controls.dispose();
    this.model?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
