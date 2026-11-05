import { inventoryUI } from "../ui/InventoryUI";
import { blocksBrowserShortcut, isTextEditing } from "../player/BrowserInput";
import {
  inventoryAction,
  type InventoryAction,
} from "../inventory/InventoryTransactions";
import { inventoryContext } from "../inventory/InventoryContext";
import {
  CommandRegistry,
  type CommandContext,
} from "../commands/CommandRegistry";
import { ChatUI } from "../ui/ChatUI";
import { configureGameMode, survivalLike } from "../player/GameModes";
import type { GameruleName } from "../world/Gamerules";
import { FireSystem } from "../world/FireSystem";
import * as THREE from "three";
import { block, blocks, INITIAL_HOTBAR } from "../blocks/BlockRegistry";
import { raycast, type VoxelHit } from "../blocks/BlockInteraction";
import { World } from "../world/World";
import { GENERATOR_VERSION } from "../world/WorldGenerator";
import { PlayerPhysics, playerEyeHeight } from "../player/PlayerPhysics";
import { PlayerController } from "../player/PlayerController";
import { createAtlas, blockIcon } from "../rendering/TextureAtlas";
import { meshChunk, disposeChunk } from "../rendering/ChunkMesher";
import { WorldStorage, type WorldSave } from "../storage/WorldStorage";
import {
  SkinManager,
  skinTexture,
  type SkinRecord,
} from "../player/skins/SkinManager";
import { PlayerModel } from "../player/models/PlayerModel";
import { CameraController } from "../player/CameraController";
import { characterMenu } from "../ui/CharacterMenu";
import { Survival, tools, extras, type GameMode } from "../inventory/Survival";
import { DropSystem } from "../inventory/DropSystem";
import { GameAudio } from "./Audio";
import { survivalHUD } from "../ui/SurvivalHUD";
import { migrateSave, DEFAULT_RULES } from "../storage/SaveMigration";
import { BlockEntities } from "../world/BlockEntities";
import { MiningOverlay } from "../rendering/MiningOverlay";
import { foods, enchantments } from "../inventory/ItemRegistry";
import { MobSystem, mobDefinitions, type Mob } from "../entities/MobSystem";
import { MobRenderer } from "../entities/MobRenderer";
import { Projectiles } from "../entities/Projectiles";
import { ExperienceOrbs } from "../entities/ExperienceOrbs";
import {
  BlockInteractionSystem,
  placementPosition,
} from "../world/BlockInteractionSystem";
import { VoxelLighting } from "../world/VoxelLighting";
import { WeatherSystem } from "../environment/WeatherSystem";
import { ChestAnimator } from "../rendering/ChestAnimator";
import { itemIcon } from "../rendering/ItemIcons";
import { NetworkClient } from "../networking/NetworkClient";
import { chunkChecksum } from "../networking/ChunkChecksum";
import { MultiplayerSession } from "../networking/MultiplayerSession";
import { RemotePlayerManager } from "../networking/RemotePlayerManager";
import type {
  ServerMessage,
  SelfSnapshot,
} from "../networking/NetworkProtocol";

type Screen =
  | "menu"
  | "create"
  | "worlds"
  | "pause"
  | "inventory"
  | "settings"
  | "character"
  | "playing"
  | "multiplayer"
  | "connection";
export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(75, 1, 0.05, 500);
  private atlas = createAtlas();
  private materials: THREE.Material[];
  private meshes = new Map<string, THREE.Group>();
  private storage = new WorldStorage();
  private commands = new CommandRegistry();
  private chat?: ChatUI;
  private locking = false;
  private unlocking: Promise<void> = Promise.resolve();
  private lockRequest = 0;
  private pointerPauseAt = -Infinity;
  private fire?: FireSystem;
  private multiplayer?: MultiplayerSession;
  private remotePlayers = new RemotePlayerManager(this.scene);
  private netDead = false;
  private networkTickMs = 0;
  private netActionClock = 0;
  private world = new World("wildbrick");
  private player = new PlayerPhysics(this.world);
  private input = new PlayerController();
  private saveData: WorldSave | null = null;
  private screen: Screen = "menu";
  private previous: Screen = "menu";
  private selected = 0;
  private hotbar = [...INITIAL_HOTBAR];
  private hit: VoxelHit | null = null;
  private outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.006, 1.006, 1.006)),
    new THREE.LineBasicMaterial({ color: 0x202d25 }),
  );
  private panel: HTMLElement;
  private hud: HTMLElement;
  private toastElement: HTMLElement;
  private debug: HTMLElement;
  private showDebug = false;
  private distance = 4;
  private last = 0;
  private elapsed = 0;
  private autosave = 0;
  private fps = 60;
  private mining = 0;
  private day = 0;
  private saving: Promise<void> | null = null;
  private sun = new THREE.DirectionalLight(0xfff2d3, 2);
  private ambient = new THREE.AmbientLight(0xc5d9ef, 1.7);
  private clouds = new THREE.Group();
  private arm = new THREE.Group();
  private skins = new SkinManager();
  private avatar?: PlayerModel;
  private skinMap?: THREE.Texture;
  private cameraControl = new CameraController();
  private closeCharacter?: () => void;
  private clearBindingCapture?: () => void;
  private bodyYaw = 0;
  private survival = new Survival();
  private blockEntities = new BlockEntities();
  private station: { key: string; kind: "table" | "chest" | "furnace" } | null =
    null;
  private refreshContainer?: () => void;
  private disposeInventory?: () => void;
  private cracks = new MiningOverlay();
  private eating = 0;
  private eatingId = 0;
  private xpOrbs = new ExperienceOrbs(this.scene);
  private mobRenderer = new MobRenderer(this.scene);
  private projectiles = new Projectiles(this.scene);
  private attackCooldown = 0;
  private interactions = new BlockInteractionSystem(
    this.world,
    this.blockEntities,
  );
  private lighting = new VoxelLighting(this.world);
  private weather = new WeatherSystem(this.scene);
  private chestAnimator = new ChestAnimator(this.scene);
  private torchLights = Array.from(
    { length: 6 },
    () => new THREE.PointLight(0xffcb85, 8, 12, 2),
  );
  private simulationDistance = 3;
  private maxMobs = 24;
  private particlesEnabled = true;
  private mobs = new MobSystem({
    damage: (n, m, dir) => {
      if (survivalLike(this.mode) && this.survival.damage(n)) {
        this.player.knockback.set(dir[0] * 5, 0, dir[1] * 5);
        this.player.velocity.y = 3;
        this.audio.play("hurt");
      }
    },
    shoot: (m) => {
      const target = this.player.position
          .clone()
          .add(new THREE.Vector3(0, 1.2, 0)),
        from = new THREE.Vector3(m.x, m.y + 1.4, m.z),
        dir = target.sub(from).normalize();
      this.projectiles.shoot(m.id, from, dir, 14);
    },
    explode: (m) => this.explode(m),
    drop: (id, n, p) => this.drops.spawn(id, n, p),
    xp: (n, p) => this.xpOrbs.spawn(n, p),
    light: (x, y, z) =>
      this.lighting.level(x, y, z, Math.sin(this.day / 180 + 1) < 0),
    sound: (kind) => this.audio.play(kind),
  });
  private drops = new DropSystem(this.scene);
  private audio = new GameAudio();
  private held: number | null = null;
  private mineProgress = 0;
  private mineTarget = "";
  private actionCooldown = 0;
  private quality = "classic";
  private vitalClock = 0;
  private sunDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({
      color: 0xffedb0,
      fog: false,
      depthWrite: false,
    }),
  );
  private moonDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 5),
    new THREE.MeshBasicMaterial({
      color: 0xd0e4ed,
      fog: false,
      depthWrite: false,
    }),
  );
  private get mode(): GameMode {
    return this.saveData?.mode ?? "creative";
  }
  private syncRules() {
    const rules = this.saveData?.rules;
    if (!rules) return;
    this.survival.naturalRegeneration = rules.naturalRegeneration;
    this.mobs.doMobSpawning = rules.doMobSpawning;
    this.mobs.doMobLoot = rules.doMobLoot;
    this.mobs.targetable = survivalLike(this.mode);
    this.mobs.allowNaturalHostiles = survivalLike(this.mode);
  }
  private commandContext(): CommandContext {
    if (!this.saveData) throw new Error("Open eerst een wereld.");
    return {
      playerName: this.saveData.playerName ?? "Player",
      position: this.player.position,
      yaw: this.input.yaw,
      inventory: this.survival,
      world: this.world,
      mobs: this.mobs,
      rules: this.saveData.rules!,
      hasPermission: () => true,
      setMode: (mode) => {
        this.saveData!.mode = mode;
        configureGameMode(mode, this.player, this.survival);
        this.input.clear();
        this.held = null;
        this.eating = 0;
        this.mineProgress = 0;
        this.root.classList.remove("damaged");
        this.root.querySelector(".mode")!.textContent = mode.toUpperCase();
        this.root.querySelector("#vitals")!.innerHTML = survivalLike(mode)
          ? survivalHUD(this.survival)
          : "";
        this.syncRules();
      },
      setRule: (name: GameruleName, value) => {
        (this.saveData!.rules as unknown as Record<string, boolean | number>)[
          name
        ] = value;
        this.syncRules();
      },
    };
  }
  private async sendChat(text: string) {
    if (!this.saveData) return;
    if (this.multiplayer) {
      if (!this.multiplayer.network.send({ type: "chat", text }))
        this.chat?.add("Niet verbonden; bericht niet verstuurd.", "error");
      return;
    }
    if (!text.startsWith("/")) {
      this.chat?.add(
        "<" + (this.saveData.playerName ?? "Player") + "> " + text,
        "local",
      );
      return;
    }
    const result = this.commands.execute(text, this.commandContext());
    this.chat?.add(result.message, result.ok ? "system" : "error");
    if (result.changed) {
      this.updateHotbar();
      try {
        await this.save();
      } catch {
        this.chat?.add(
          "Wijziging uitgevoerd, maar opslaan mislukt. Probeer opnieuw via het pauzemenu.",
          "error",
        );
      }
    }
  }
  private itemName(id: number) {
    if (!id) return "Leeg slot";
    return extras[id] ?? block(id).name;
  }
  private particles: THREE.Points | null = null;
  private particleLife = 0;
  private icons: string[];
  private blockNameTimer = 0;
  constructor(private root: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x91c9df);
    root.append(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x91c9df);
    this.scene.fog = new THREE.Fog(0x91c9df, 32, 85);
    this.sun.position.set(45, 100, 30);
    this.scene.add(this.sun, this.ambient, this.outline, this.clouds);
    this.scene.add(...this.torchLights);
    this.world.lighting = this.lighting;
    this.scene.add(this.cracks);
    this.scene.add(this.sunDisc, this.moonDisc, this.sun.target);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, {
      left: -28,
      right: 28,
      top: 28,
      bottom: -28,
      near: 1,
      far: 150,
    });
    this.sun.shadow.bias = -0.001;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.outline.visible = false;
    this.materials = [
      new THREE.MeshLambertMaterial({
        map: this.atlas.texture,
        vertexColors: true,
        alphaTest: 0.4,
      }),
      new THREE.MeshLambertMaterial({
        map: this.atlas.texture,
        vertexColors: true,
        transparent: true,
        opacity: 0.76,
        alphaTest: 0.05,
        depthWrite: false,
      }),
      new THREE.MeshLambertMaterial({
        map: this.atlas.texture,
        vertexColors: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      }),
    ];
    this.camera.add(this.arm);
    this.scene.add(this.camera);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xf4f4e8,
      transparent: true,
      opacity: 0.85,
    });
    const cloudGeo = new THREE.BoxGeometry(17, 1.5, 8);
    for (let i = 0; i < 20; i++) {
      const c = new THREE.Mesh(cloudGeo, cloudMat);
      c.position.set(
        (i % 5) * 40 - 80,
        67 + Math.floor(i / 5) * 2,
        Math.floor(i / 5) * 45 - 70,
      );
      this.clouds.add(c);
    }
    this.icons = blocks.map((b) => blockIcon(this.atlas.canvas, b.id));
    for (const material of this.materials) {
      material.onBeforeCompile = (shader) => {
        shader.vertexShader =
          "attribute float voxelLight; varying float vVoxelLight;\n" +
          shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          "#include <color_vertex>",
          "#include <color_vertex>\nvVoxelLight = voxelLight;",
        );
        shader.fragmentShader =
          "varying float vVoxelLight;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          "#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vVoxelLight * 0.8;",
        );
      };
      material.customProgramCacheKey = () => "whitebrick-voxel-light-1";
    }
    for (const id of Object.keys(extras).map(Number))
      this.icons[id] = itemIcon(id);
    root.insertAdjacentHTML(
      "beforeend",
      `<div class="vignette"></div><div id="hud" hidden><div class="world-tag"><span class="live-dot"></span> WHITEBRICK <span class="mode">CREATIVE</span></div><div class="crosshair">+</div><div id="block-name"></div><div id="hotbar"></div><div class="hints"><kbd>E</kbd> Blokken <span>·</span> <kbd>2× Spatie</kbd> Vliegen <span>·</span> <kbd>T</kbd> Chat <span>·</span> <kbd>Esc</kbd> Menu</div></div><div id="panel"></div><div id="toast" role="status"></div><pre id="debug" hidden></pre>`,
    );
    this.panel = root.querySelector("#panel")!;
    this.hud = root.querySelector("#hud")!;
    this.toastElement = root.querySelector("#toast")!;
    this.debug = root.querySelector("#debug")!;
    this.chat = new ChatUI(
      root,
      (text) => this.sendChat(text),
      (text) =>
        this.saveData
          ? this.commands.autocomplete(text, this.commandContext())
          : [],
      () => {
        if (this.screen === "playing" && document.visibilityState === "visible")
          this.lock();
      },
    );
    this.hud.insertAdjacentHTML(
      "beforeend",
      '<div id="vitals"></div><div id="mining-progress" hidden><div></div></div><div id="camera-label"></div>',
    );
    try {
      const settings = JSON.parse(
        localStorage.getItem("wildbrick-settings") ?? "{}",
      );
      this.distance = Math.max(2, Math.min(8, Number(settings.distance) || 4));
      this.camera.fov = Math.max(50, Math.min(110, Number(settings.fov) || 75));
      this.input.sensitivity = Math.max(
        0.0005,
        Math.min(0.006, Number(settings.sensitivity) || 0.002),
      );
      if (settings.bindings && typeof settings.bindings === "object") {
        const values = Object.values(settings.bindings);
        if (
          values.every((v) => typeof v === "string") &&
          new Set(values).size === values.length
        )
          this.input.bindings = {
            ...this.input.bindings,
            ...settings.bindings,
          };
      }
      this.audio.volume = Math.max(
        0,
        Math.min(1, Number(settings.volume ?? 0.35)),
      );
      this.quality = settings.quality === "low" ? "low" : "classic";
      this.simulationDistance = Math.max(
        1,
        Math.min(6, Number(settings.simulationDistance) || 3),
      );
      this.maxMobs = Math.max(0, Math.min(64, Number(settings.maxMobs ?? 24)));
      this.particlesEnabled = settings.particles !== false;
      this.audio.effects = Math.max(
        0,
        Math.min(1, Number(settings.effects ?? 0.8)),
      );
      this.audio.music = Math.max(
        0,
        Math.min(1, Number(settings.music ?? 0.12)),
      );
    } catch {
      /* Defaults remain usable if local storage is blocked. */
    }
    this.renderer.setPixelRatio(
      this.quality === "low" ? 1 : Math.min(devicePixelRatio, 1.5),
    );
    this.bind();
    this.resize();
    this.menu();
    this.updateHotbar();
    void this.skins
      .restore()
      .then((canvas) => this.applySkin(this.skins.record, canvas))
      .catch(() => this.toast("Skin laden mislukt."));
    requestAnimationFrame(this.frame);
  }
  private toast(message: string) {
    this.toastElement.textContent = message;
    this.toastElement.classList.add("visible");
    window.setTimeout(
      () => this.toastElement.classList.remove("visible"),
      4500,
    );
  }
  private button(id: string, fn: () => void) {
    this.panel.querySelector(id)?.addEventListener("click", fn);
  }
  private show(screen: Screen, html: string) {
    if (this.screen === "inventory" && screen !== "inventory") {
      try {
        this.sendInventoryAction({ kind: "close" });
      } catch (e) {
        this.toast(
          e instanceof Error
            ? e.message
            : "Items konden niet worden teruggelegd.",
        );
      }
    }
    this.disposeInventory?.();
    this.disposeInventory = undefined;

    if (screen !== "playing") this.chat?.close(false);
    this.root.classList.remove("damaged");
    if (
      this.screen === "inventory" &&
      screen !== "inventory" &&
      this.station?.kind === "chest"
    )
      this.audio.play("chest");
    this.refreshContainer = undefined;
    this.cracks.visible = false;
    this.clearBindingCapture?.();
    this.clearBindingCapture = undefined;
    this.closeCharacter?.();
    this.closeCharacter = undefined;
    this.screen = screen;
    this.panel.innerHTML = html;
    this.panel.hidden = screen === "playing";
    this.hud.hidden =
      !["playing", "pause", "inventory", "settings"].includes(screen) ||
      !this.saveData;
    this.input.clear();
    this.mining = 0;
    this.held = null;
    this.mineProgress = 0;
    const progress = this.root.querySelector<HTMLElement>("#mining-progress");
    if (progress) progress.hidden = true;
    this.arm.visible = screen === "playing";
    if (screen !== "playing") {
      this.lockRequest++;
      this.locking = false;
      if (document.pointerLockElement) {
        this.unlocking = new Promise((resolve) => {
          const unlocked = () => {
            if (!document.pointerLockElement) {
              document.removeEventListener("pointerlockchange", unlocked);
              resolve();
            }
          };
          document.addEventListener("pointerlockchange", unlocked);
          document.exitPointerLock();
        });
      }
    }
    this.panel.querySelector<HTMLElement>("button,input")?.focus();
  }
  private shell(eyebrow: string, title: string, body: string, wide = false) {
    return `<section class="card ${wide ? "wide" : ""}"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${body}</section>`;
  }
  private menu() {
    if (this.multiplayer) {
      this.multiplayer.close();
      this.multiplayer = undefined;
      this.remotePlayers.clear();
      this.saveData = null;
    }
    this.show(
      "menu",
      `<div class="menu-layout"><section class="intro"><div class="eyebrow"><span class="square"></span> EEN WERELD OM TE MAKEN</div><h1 class="logo">WHITE<br><span>BRICK</span><i>✦</i></h1><p>Voorbij de horizon.<br>Helemaal van jou.</p><div class="edition">SANDBOX EDITION <span>CREATIVE + SURVIVAL</span></div></section><section class="menu-card"><div class="eyebrow">JOUW VOLGENDE AVONTUUR</div><h2>Begin met een blok.</h2><p>Een verse wereld. Eindeloze mogelijkheden.</p><button id="new" class="primary"><span>Nieuwe wereld</span><span>↗</span></button><button id="load">Mijn werelden <span>→</span></button><button id="settings">Instellingen <span>⚙</span></button><div class="menu-note"><span class="live-dot"></span> Singleplayer · Lokaal opgeslagen</div></section></div><footer><span>WHITEBRICK <b>v0.6</b></span><span>Originele wereld. Originele textures. Jouw ideeën.</span><span>DESKTOP / WEBGL</span></footer>`,
    );
    this.button("#new", () => this.createMenu());
    this.button("#load", () => void this.worldMenu());
    this.panel.querySelector("#new span")!.textContent = "Singleplayer";
    const multi = document.createElement("button");
    multi.id = "multiplayer";
    multi.textContent = "Multiplayer · LAN";
    multi.onclick = () => void this.multiplayerMenu();
    this.panel.querySelector("#load")!.after(multi);
    const character = document.createElement("button");
    character.id = "character";
    character.innerHTML = "Character <span>Skins →</span>";
    character.onclick = () => this.character();
    this.panel.querySelector("#settings")!.before(character);
    this.button("#settings", () => {
      this.previous = "menu";
      this.settings();
    });
  }
  private character(returnToGame = false) {
    this.show("character", "");
    this.closeCharacter = characterMenu(
      this.panel,
      this.skins,
      (record, canvas) => this.applySkin(record, canvas),
      () => (returnToGame ? this.pause() : this.menu()),
      (message) => this.toast(message),
    );
  }
  private async multiplayerMenu() {
    this.show(
      "multiplayer",
      this.shell(
        "MULTIPLAYER",
        "WhiteBrick LAN",
        `<label>SPELERSNAAM<input id="lan-name" maxlength="20" autocomplete="off"></label><p id="lan-status" role="status">Server zoeken…</p><div id="lan-card"></div><button id="lan-join" class="primary" disabled>Join server</button><button id="lan-reset">Nieuwe LAN-identiteit</button><button id="back" class="subtle">Terug</button>`,
      ),
    );
    const name = this.panel.querySelector<HTMLInputElement>("#lan-name")!;
    name.value = localStorage.getItem("whitebrick-player-name") ?? "Player";
    this.button("#back", () => this.menu());
    try {
      const started = performance.now(),
        status = await NetworkClient.status();
      if (this.screen !== "multiplayer") return;
      const card = this.panel.querySelector("#lan-card")!;
      card.textContent = `${status.serverName} · ${status.online ? "Online" : "Offline"} · Players ${status.playerCount}/${status.maxPlayers} · ${Math.round(performance.now() - started)} ms · World ${status.worldName}`;
      this.panel.querySelector("#lan-status")!.textContent =
        "Gedeelde wereld op de hostcomputer. Singleplayerwerelden blijven persoonlijk.";
      const join = this.panel.querySelector<HTMLButtonElement>("#lan-join")!;
      join.disabled = !status.online || status.playerCount >= status.maxPlayers;
      this.button("#lan-reset", () => {
        let identities: Record<string, string> = {};
        try {
          identities = JSON.parse(
            localStorage.getItem("whitebrick-lan-identities") ?? "{}",
          );
        } catch {}
        delete identities[status.serverId];
        localStorage.setItem(
          "whitebrick-lan-identities",
          JSON.stringify(identities),
        );
        this.toast(
          "LAN-identiteit verwijderd. Je volgende join begint als nieuwe speler; oude servervoortgang blijft bewaard onder het oude ID.",
        );
      });
      join.onclick = () => {
        const display = name.value.trim();
        if (!/^[A-Za-z0-9_ -]{1,20}$/.test(display)) {
          this.toast("Gebruik 1–20 letters, cijfers, spaties, - of _.");
          return;
        }
        localStorage.setItem("whitebrick-player-name", display);
        join.disabled = true;
        const session = new MultiplayerSession(
          display,
          (message) => {
            if (this.multiplayer === session) this.networkMessage(message);
          },
          (message, retry) => {
            if (this.multiplayer === session)
              this.connectionLost(message, retry);
          },
        );
        this.multiplayer = session;
        this.netDead = false;
        this.show(
          "connection",
          this.shell(
            "MULTIPLAYER",
            "Verbinden…",
            '<p>Speler aanmelden en gedeelde wereld laden.</p><button id="back">Annuleren</button>',
          ),
        );
        this.button("#back", () => this.menu());
        void session.network
          .connect()
          .catch((error) =>
            this.connectionLost(
              error instanceof Error ? error.message : "Verbinding mislukt.",
              false,
            ),
          );
      };
    } catch (error) {
      if (this.screen === "multiplayer")
        this.panel.querySelector("#lan-status")!.textContent =
          error instanceof Error ? error.message : "Server onbereikbaar.";
    }
  }
  private connectionLost(message: string, retry: boolean) {
    this.input.clear();
    this.held = null;
    this.show(
      "connection",
      this.shell(
        "MULTIPLAYER",
        retry ? "Connection Lost" : "Verbinding verbroken",
        '<p id="connection-message" role="status"></p><button id="back" class="primary">Hoofdmenu</button>',
      ),
    );
    this.panel.querySelector("#connection-message")!.textContent = message;
    this.button("#back", () => this.menu());
  }
  private applyNetworkSelf(self: SelfSnapshot) {
    if (!this.saveData || !this.multiplayer) return;
    const oldHealth = this.survival.health,
      modeChanged = this.mode !== self.mode;
    const inventoryChanged =
      JSON.stringify([
        this.survival.items,
        this.survival.durability,
        this.hotbar,
        this.mode,
      ]) !==
      JSON.stringify([
        self.survival.items,
        self.durability,
        self.hotbar,
        self.mode,
      ]);
    this.saveData.mode = self.mode;
    this.saveData.playerName = self.name;
    this.saveData.playerId = self.id;
    Object.assign(this.survival, self.survival);
    this.survival.items = { ...self.survival.items };
    this.survival.durability = { ...self.durability };
    this.hotbar = [...self.hotbar];
    this.mining = Math.max(this.mining, self.action);
    if (modeChanged) {
      configureGameMode(self.mode, this.player, this.survival);
      this.root.querySelector(".mode")!.textContent = self.mode.toUpperCase();
      this.input.clear();
      this.held = null;
    }
    this.multiplayer.reconcile(self, this.input, this.player);
    if (self.survival.health < oldHealth) this.audio.play("hurt");
    if (inventoryChanged) this.updateHotbar();
    this.root.querySelector("#vitals")!.innerHTML = survivalLike(self.mode)
      ? survivalHUD(this.survival)
      : self.mode === "spectator"
        ? "SPECTATOR FLIGHT"
        : "";
    if (self.dead && !this.netDead) {
      this.netDead = true;
      this.show(
        "pause",
        this.shell(
          "MULTIPLAYER",
          "You Died",
          '<button id="respawn" class="primary">Respawn</button><button id="back">Hoofdmenu</button>',
        ),
      );
      this.button("#respawn", () => this.multiplayer?.action("respawn"));
      this.button("#back", () => this.menu());
    } else if (!self.dead && this.netDead) {
      this.netDead = false;
      this.show("playing", "");
      this.lock();
    }
  }
  private networkMessage(message: ServerMessage) {
    const session = this.multiplayer;
    if (!session) return;
    if (message.type === "welcome") {
      this.remotePlayers.clear();
      this.netDead = false;
      this.start(
        {
          ...message.world,
          id: "remote:" + message.serverId,
          mode: message.self.mode,
          position: message.self.position,
          rotation: [message.self.yaw, message.self.pitch],
          hotbar: message.self.hotbar,
          survival: message.self.survival,
          durability: message.self.durability,
          flying: message.self.flying,
          playerId: message.self.id,
          playerName: message.self.name,
        },
        true,
      );
      this.applyNetworkSelf(message.self);
      session.network.send({
        type: "skin",
        png: this.skins.record.png,
        model: this.skins.record.model,
        layers: this.skins.record.layers,
      });
    } else if (message.type === "snapshot") {
      if (!this.saveData) return;
      this.saveData.rules = message.rules;
      this.day = message.day;
      this.weather.state = { ...message.weather };
      this.networkTickMs = message.tickMs;
      this.applyNetworkSelf(message.self);
      this.remotePlayers.update(message.players);
      this.mobs.restore(message.mobs);
      this.drops.restore(message.drops);
      this.drops.update(this.world, this.player.position, 0, (_id, n) => n);
      this.xpOrbs.restore(message.xpOrbs);
      this.xpOrbs.render();
      this.projectiles.arrows.splice(
        0,
        this.projectiles.arrows.length,
        ...message.arrows,
      );
      this.projectiles.render();
      if (message.containers) this.blockEntities.restore(message.containers);
    } else if (message.type === "chunk") {
      const [cx, cz] = message.key.split(",").map(Number);
      for (const [key, c] of this.world.changes)
        if (Math.floor(c.x / 16) === cx && Math.floor(c.z / 16) === cz)
          this.world.changes.delete(key);
      for (const key of Object.keys(this.world.states)) {
        const [x, , z] = key.split(",").map(Number);
        if (Math.floor(x / 16) === cx && Math.floor(z / 16) === cz)
          delete this.world.states[key];
      }
      this.world.restore(
        message.changes.map(([x, y, z, id]) => ({
          x: x + cx * 16,
          y,
          z: z + cz * 16,
          id,
        })),
      );
      Object.assign(this.world.states, message.states);
      this.world.chunks.delete(message.key);
      if (message.blocks)
        this.world.chunks.set(message.key, Uint8Array.from(message.blocks));
      this.lighting.invalidate(cx, cz);
      if (chunkChecksum(this.world.ensure(cx, cz)) !== message.checksum)
        session.network.send({ type: "resync", key: message.key });
      for (const [x, z] of [
        [cx, cz],
        [cx - 1, cz],
        [cx + 1, cz],
        [cx, cz - 1],
        [cx, cz + 1],
      ])
        this.world.dirty.add(`${x},${z}`);
      session.revisions.set(message.key, message.revision);
    } else if (message.type === "block") {
      const revision = session.revisions.get(message.key);
      if (revision !== undefined && message.revision <= revision) return;
      if (revision === undefined || message.revision !== revision + 1) {
        session.network.send({ type: "resync", key: message.key });
        return;
      }
      const c = message.change;
      this.world.set(c.x, c.y, c.z, c.id);
      const key = `${c.x},${c.y},${c.z}`;
      if (message.state) this.world.states[key] = message.state;
      else delete this.world.states[key];
      session.revisions.set(message.key, message.revision);
      this.mineProgress = 0;
      this.audio.play(c.id ? "place" : "break");
    } else if (message.type === "open") {
      this.blockEntities.restore(message.containers);
      this.station = { key: message.key, kind: message.kind };
      this.inventory();
    } else if (message.type === "chat")
      this.chat?.add(message.text, message.kind);
    else if (message.type === "error") {
      if (!message.fatal) {
        this.chat?.add(message.message, "error");
        this.toast(message.message);
      }
    } else if (message.type === "ack" && !message.ok && message.message) {
      this.toast(message.message);
      this.chat?.add(message.message, "error");
    }
  }
  private applySkin(record: SkinRecord, canvas: HTMLCanvasElement) {
    this.multiplayer?.network.send({
      type: "skin",
      png: record.png,
      model: record.model,
      layers: record.layers,
    });
    this.arm.children.forEach((child) =>
      child.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose();
      }),
    );
    this.arm.clear();
    this.avatar?.dispose();
    this.skinMap?.dispose();
    this.skinMap = skinTexture(canvas);
    this.avatar = new PlayerModel(this.skinMap, record.model, record.layers);
    this.scene.add(this.avatar);
    this.arm.add(this.avatar.createFirstPersonArm());
  }
  private createMenu() {
    this.show(
      "create",
      this.shell(
        "SINGLEPLAYER",
        "Een nieuw begin.",
        `<p>Geef je wereld een naam. Dezelfde seed geeft hetzelfde landschap.</p><form id="create-form"><label>WERELDNAAM<input name="name" maxlength="48" value="Mijn wereld" required autocomplete="off"></label><label>SEED <span>OPTIONEEL</span><input name="seed" maxlength="100" placeholder="Laat de wereld je verrassen" autocomplete="off"></label><div class="mode-box"><strong>Creative</strong><span>Vrij bouwen · Onbeperkte blokken · Vliegen</span></div><button class="primary" type="submit">Maak mijn wereld <span>↗</span></button></form><button id="back" class="subtle">← Terug</button>`,
      ),
    );
    this.button("#back", () => this.menu());
    this.panel
      .querySelector(".mode-box")!
      .insertAdjacentHTML(
        "beforebegin",
        '<label>SPEELMODUS<select name="gamemode"><option value="creative">Creative · vrij bouwen</option><option value="survival">Survival · verzamelen & overleven</option></select></label><label>WERELDHOOGTE<select name="height"><option value="80">80 blokken · klassiek</option><option value="64">64 blokken · compact</option><option value="128">128 blokken · ruim</option></select></label>',
      );
    this.panel.querySelector<HTMLSelectElement>("[name=gamemode]")!.onchange = (
      e,
    ) => {
      this.panel.querySelector(".mode-box")!.textContent =
        (e.target as HTMLSelectElement).value === "survival"
          ? "Survival · Health, hunger, drops, tools en crafting"
          : "Creative · Vrij bouwen, onbeperkte blokken en vliegen";
    };
    this.panel
      .querySelector(".mode-box")!
      .insertAdjacentHTML(
        "beforebegin",
        '<details><summary>Wereldregels</summary><label>MOEILIJKHEID<select name="difficulty"><option value="peaceful">Peaceful</option><option value="easy">Easy</option><option value="normal" selected>Normal</option><option value="hard">Hard</option></select></label><label class="check"><input type="checkbox" name="keepInventory"> Inventory behouden bij overlijden</label><label>DAGDUUR (MINUTEN)<input type="number" name="dayLength" min="2" max="120" value="20"></label></details>',
      );
    this.panel.querySelector("form")!.addEventListener("submit", (e) => {
      e.preventDefault();
      const form = new FormData(e.target as HTMLFormElement);
      const seed =
        String(form.get("seed")).trim() || crypto.randomUUID().slice(0, 12);
      const gen = new World(seed).generator;
      this.start({
        id: crypto.randomUUID(),
        name: String(form.get("name")).trim() || "Mijn wereld",
        seed,
        version: GENERATOR_VERSION,
        updated: Date.now(),
        position: [8.5, gen.height(8, 8) + 3, 8.5],
        rotation: [0, 0],
        hotbar: [...INITIAL_HOTBAR],
        changes: [],
        flying: false,
        mode: form.get("gamemode") === "survival" ? "survival" : "creative",
        height: Number(form.get("height")) || 80,
        playerId: crypto.randomUUID(),
        schemaVersion: 5,
        rules: {
          ...DEFAULT_RULES,
          keepInventory: form.get("keepInventory") === "on",
          difficulty: String(form.get("difficulty")) as "normal",
          dayLength: Math.max(120, Number(form.get("dayLength")) * 60),
        },
      });
    });
  }
  private async worldMenu() {
    this.show(
      "worlds",
      this.shell(
        "SINGLEPLAYER",
        "Mijn werelden.",
        `<div id="world-list"><p>Werelden laden…</p></div><button id="back" class="subtle">← Terug</button>`,
        true,
      ),
    );
    this.button("#back", () => this.menu());
    try {
      const worlds = await this.storage.list();
      if (this.screen !== "worlds") return;
      const list = this.panel.querySelector("#world-list")!;
      list.replaceChildren();
      if (!worlds.length)
        list.innerHTML = "<p>Nog geen werelden. Begin je eerste avontuur.</p>";
      for (const save of worlds) {
        const row = document.createElement("div");
        row.className = "world-row";
        const title = document.createElement("button");
        title.className = "world-open";
        title.textContent = save.name;
        const meta = document.createElement("small");
        const modeName = save.mode ?? "creative";
        meta.textContent = `${modeName[0].toUpperCase() + modeName.slice(1)} · ${new Date(save.updated).toLocaleString("nl-NL")} · seed: ${save.seed}`;
        title.append(meta);
        title.onclick = () => {
          if (![1, 2, GENERATOR_VERSION].includes(save.version)) {
            this.toast("Deze wereld gebruikt een andere generatorversie.");
            return;
          }
          this.start(save);
        };
        const del = document.createElement("button");
        del.className = "delete";
        del.textContent = "Verwijder";
        del.onclick = () => {
          if (confirm(`Wereld “${save.name}” definitief verwijderen?`))
            void this.storage
              .delete(save.id)
              .then(() => this.worldMenu())
              .catch(() => this.toast("Verwijderen mislukt."));
        };
        const exportButton = document.createElement("button");
        exportButton.textContent = "Exporteer";
        const backupButton = document.createElement("button");
        backupButton.textContent = "Back-up";
        const download = async (backup: boolean) => {
          try {
            const json = await this.storage.export(save.id, backup);
            const url = URL.createObjectURL(
              new Blob([json], { type: "application/json" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download =
              "WhiteBrick-" + save.id + (backup ? "-backup" : "") + ".json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            this.toast(e instanceof Error ? e.message : "Export mislukt.");
          }
        };
        exportButton.onclick = () => void download(false);
        backupButton.onclick = () => void download(true);
        row.append(title, exportButton, backupButton, del);
        list.append(row);
      }
    } catch {
      this.toast(
        "Lokale opslag is niet beschikbaar. Controleer je browserinstellingen.",
      );
    }
  }
  private start(save: WorldSave, network = false) {
    if (!network && this.multiplayer) {
      this.multiplayer.close();
      this.multiplayer = undefined;
      this.remotePlayers.clear();
    }
    this.station = null;
    this.chat?.clear();
    this.fire?.dispose();
    save = migrateSave(save);
    for (const group of this.meshes.values()) disposeChunk(group);
    this.meshes.clear();
    this.world.dispose();
    this.world = new World(save.seed, save.height ?? 80, save.version);
    this.world.restore(save.changes);
    this.fire = new FireSystem(this.world, save.fireState);
    this.world.states = save.blockStates ?? {};
    Object.values(this.world.states).forEach((state) => (state.open = false));
    this.blockEntities.restore(save.blockEntities);
    this.interactions = new BlockInteractionSystem(
      this.world,
      this.blockEntities,
    );
    this.lighting = new VoxelLighting(this.world);
    this.world.lighting = this.lighting;
    this.weather.restore(save.weather);
    this.player = new PlayerPhysics(this.world);
    this.player.position.fromArray(save.position);
    this.player.flying = save.flying;
    this.input.yaw = save.rotation[0];
    this.bodyYaw = this.input.yaw + Math.PI;
    this.input.pitch = save.rotation[1];
    this.hotbar =
      save.hotbar.length === 9
        ? save.hotbar.map((id) => (blocks[id] || extras[id] ? id : 1))
        : [...INITIAL_HOTBAR];
    this.saveData = save;
    this.day = save.day ?? 0;
    this.cameraControl.mode = save.cameraMode ?? 0;
    this.survival = new Survival(save.survival, save.durability);
    if (!save.survival?.slotInventory)
      this.survival.initializeHotbar(save.hotbar, this.mode === "creative");
    this.survival.difficulty = save.rules!.difficulty;
    this.drops.restore(save.drops ?? []);
    this.mobs.restore(save.mobs);
    this.xpOrbs.restore(save.xpOrbs);
    this.projectiles.clear();
    this.mobRenderer.clear();
    configureGameMode(this.mode, this.player, this.survival);
    this.syncRules();
    this.chat?.add("T: chat · /: commands · /help: hulp");
    this.audio.unlock();
    this.root.querySelector(".mode")!.textContent = this.mode.toUpperCase();
    if (survivalLike(this.mode) && !save.survival)
      this.hotbar = [2, 7, 9, 4, 100, 103, 19, 105, 104];
    let tries = 0;
    while (this.player.collides(this.player.position) && tries++ < 90)
      this.player.position.y += 1;
    if (tries >= 90 && this.player.collides(this.player.position))
      this.respawn();
    this.updateHotbar();
    this.show("playing", "");
    this.lock();
    void this.save().catch(() => {});
  }
  private lock() {
    this.locking = true;
    const request = ++this.lockRequest;
    void this.unlocking.then(() => {
      if (
        request !== this.lockRequest ||
        this.screen !== "playing" ||
        this.chat?.isOpen
      )
        return;
      try {
        const result = this.renderer.domElement.requestPointerLock();
        if (result)
          void result.catch((error: unknown) => {
            if (request !== this.lockRequest) return;
            this.locking = false;
            this.toast(
              error instanceof Error
                ? error.message
                : "Klik op Verder spelen om de muis vast te zetten.",
            );
            this.pause();
          });
      } catch {
        this.locking = false;
        this.pause();
      }
    });
  }
  private pause() {
    if (!this.saveData || this.chat?.isOpen) return;
    this.show(
      "pause",
      this.shell(
        "EVEN OP ADEM KOMEN",
        "Wereld gepauzeerd.",
        `<p>Je volgende idee loopt niet weg.</p><button id="resume" class="primary">Verder spelen <span>→</span></button><button id="save">Wereld opslaan</button><button id="settings">Instellingen</button><button id="home" class="subtle">Opslaan & hoofdmenu</button>`,
      ),
    );
    if (this.multiplayer) {
      this.panel.querySelector("h1")!.textContent =
        "De LAN-wereld loopt verder.";
      this.panel.querySelector("#home")!.textContent =
        "Verbinding verbreken & hoofdmenu";
      const character = document.createElement("button");
      character.id = "change-skin";
      character.textContent = "Character / Skins";
      character.onclick = () => this.character(true);
      this.panel.querySelector("#settings")!.before(character);
    }
    this.button("#resume", () => {
      this.show("playing", "");
      this.lock();
    });
    this.button("#save", () => void this.save(true).catch(() => {}));
    this.button("#settings", () => {
      this.previous = "pause";
      this.settings();
    });
    this.button("#home", () => {
      void this.save()
        .then(() => {
          this.saveData = null;
          this.menu();
        })
        .catch(() =>
          this.toast(
            "Opslaan mislukt. Je wereld blijft open; probeer opnieuw.",
          ),
        );
    });
  }
  private sendInventoryAction(action: InventoryAction) {
    if (this.multiplayer) {
      this.multiplayer.network.send({
        type: "inventory",
        tx: crypto.randomUUID(),
        action,
      });
      return;
    }
    const context = inventoryContext(
      this.survival,
      this.mode === "creative",
      this.station,
      this.blockEntities,
      (stack) =>
        this.drops.spawn(
          stack.id,
          stack.count,
          this.player.position
            .clone()
            .add(new THREE.Vector3(0, 0.8, 0))
            .toArray(),
          0,
          undefined,
          stack,
        ),
    );
    const furnace =
      this.station?.kind === "furnace"
        ? this.blockEntities.furnace(this.station.key)
        : null;
    context.onOutput = (index) => {
      if (furnace && index === 2) {
        this.survival.addXP(furnace.xp);
        furnace.xp = 0;
      }
    };
    inventoryAction(this.survival, action, context);
    if (furnace && context.container)
      [furnace.input, furnace.fuel, furnace.output] = context.container;
    this.updateHotbar();
    this.audio.play("pickup");
  }
  private inventory() {
    this.show("inventory", "");
    const ui = inventoryUI(this.panel, this.survival, {
      creative: this.mode === "creative",
      size: this.station?.kind === "table" ? 3 : 2,
      icons: this.icons,
      name: (id) => this.itemName(id),
      container:
        this.station && this.station.kind !== "table"
          ? () => {
              if (this.station!.kind === "furnace") {
                const f = this.blockEntities.furnace(this.station!.key);
                return {
                  slots: [f.input, f.fuel, f.output],
                  kind: "furnace",
                  progress: f.progress,
                  burn: f.burn,
                };
              }
              return {
                slots: this.blockEntities.chest(this.station!.key),
                kind: "chest",
              };
            }
          : undefined,
      send: (action) => this.sendInventoryAction(action),
      close: () => {
        this.show("playing", "");
        this.lock();
      },
    });
    this.refreshContainer = ui.refresh;
    this.disposeInventory = ui.dispose;
    const selected = this.hotbar[this.selected];
    if (selected === 131 || tools[selected]) {
      const section = document.createElement("div");
      section.className = "inventory-equipment";
      if (selected === 131) {
        const equip = document.createElement("button");
        equip.textContent = "Borstplaat aan/uit";
        equip.onclick = () => {
          if (this.multiplayer) this.multiplayer.action("equip");
          else if (this.survival.count(131))
            this.survival.equipment = this.survival.equipment ? 0 : 131;
        };
        section.append(equip);
      }
      for (const [key, def] of Object.entries(enchantments)) {
        const button = document.createElement("button");
        button.textContent = def.name + " · " + def.cost + " levels";
        button.onclick = () => {
          if (this.multiplayer)
            this.multiplayer.action("enchant", selected, key);
          else
            this.toast(
              this.survival.enchant(selected, key as keyof typeof enchantments)
                ? "Enchantment toegepast."
                : "Niet geschikt of onvoldoende levels.",
            );
        };
        section.append(button);
      }
      this.panel.querySelector("#back")!.before(section);
    }
  }
  private settings() {
    this.show(
      "settings",
      this.shell(
        "MAAK HET VAN JOU",
        "Instellingen.",
        `<label>RENDERAFSTAND <output id="distance-value">${this.distance} chunks</output><input id="distance" type="range" min="2" max="8" step="1" value="${this.distance}"></label><label>GEZICHTSVELD <output id="fov-value">${this.camera.fov}°</output><input id="fov" type="range" min="50" max="110" value="${this.camera.fov}"></label><label>MUISGEVOELIGHEID <input id="sensitivity" type="range" min="0.5" max="6" step="0.1" value="${this.input.sensitivity * 1000}"></label><button id="fullscreen">Volledig scherm ↗</button><details><summary>Besturing</summary><p>WASD bewegen · Muis kijken · Spatie springen · 2× Spatie vliegen · Shift sluipen / dalen · Ctrl sprinten · Links breken · Rechts plaatsen · 1–9 / scroll hotbar · E inventory · F3 debug · R veilige spawn · Esc pauze</p></details><button id="back" class="primary">Klaar <span>✓</span></button>`,
      ),
    );
    this.panel.querySelector("#fullscreen")!.insertAdjacentHTML(
      "beforebegin",
      `<label>GRAFISCHE KWALITEIT<select id="graphics"><option value="classic">Classic · schaduwen</option><option value="low">Snel · lagere resolutie</option></select></label><label>GELUIDSVOLUME<input type="range" id="volume" min="0" max="1" step=".05" value="${this.audio.volume}"></label><details><summary>Toetsen aanpassen</summary><div class="keybindings">${Object.entries(
        this.input.bindings,
      )
        .map(
          ([action, code]) =>
            `<button data-binding="${action}" type="button">${({ KeyW: "Vooruit", KeyA: "Links", KeyS: "Achteruit", KeyD: "Rechts", Space: "Springen / stijgen", ShiftLeft: "Sluipen / dalen", ControlLeft: "Sprinten", KeyE: "Inventory", F5: "Camera", KeyF: "Eten" } as Record<string, string>)[action] ?? action}<kbd>${code}</kbd></button>`,
        )
        .join("")}</div></details>`,
    );
    this.panel.querySelector<HTMLSelectElement>("#graphics")!.value =
      this.quality;
    this.panel
      .querySelector("#fullscreen")!
      .insertAdjacentHTML(
        "beforebegin",
        `<label>SIMULATIEAFSTAND<input id="simulation-distance" type="range" min="1" max="6" value="${this.simulationDistance}"></label><label>MAXIMAAL MOBS<input id="max-mobs" type="range" min="0" max="64" value="${this.maxMobs}"></label><label class="check"><input id="particles" type="checkbox" ${this.particlesEnabled ? "checked" : ""}> Particles</label><label>EFFECTEN<input id="effects" type="range" min="0" max="1" step=".05" value="${this.audio.effects}"></label><label>MUZIEK<input id="music" type="range" min="0" max="1" step=".05" value="${this.audio.music}"></label><label>DAGDUUR IN MINUTEN<input id="day-length" type="number" min="2" max="120" value="${(this.saveData?.rules?.dayLength ?? 1200) / 60}"></label><label>WEER<select id="weather"><option value="clear">Helder</option><option value="rain">Regen / sneeuw in koude biomes</option><option value="thunder">Onweer</option></select></label>`,
      );
    this.panel.querySelector<HTMLSelectElement>("#weather")!.value =
      this.weather.state.kind;
    if (this.multiplayer)
      for (const id of [
        "weather",
        "day-length",
        "simulation-distance",
        "max-mobs",
      ])
        this.panel.querySelector<HTMLInputElement>("#" + id)!.disabled = true;
    const persist = () => {
      this.distance = Number(
        this.panel.querySelector<HTMLInputElement>("#distance")!.value,
      );
      this.camera.fov = Number(
        this.panel.querySelector<HTMLInputElement>("#fov")!.value,
      );
      this.input.sensitivity =
        Number(
          this.panel.querySelector<HTMLInputElement>("#sensitivity")!.value,
        ) / 1000;
      this.camera.updateProjectionMatrix();
      this.audio.volume = Number(
        this.panel.querySelector<HTMLInputElement>("#volume")!.value,
      );
      this.quality =
        this.panel.querySelector<HTMLSelectElement>("#graphics")!.value;
      this.simulationDistance = Number(
        this.panel.querySelector<HTMLInputElement>("#simulation-distance")!
          .value,
      );
      this.maxMobs = Number(
        this.panel.querySelector<HTMLInputElement>("#max-mobs")!.value,
      );
      this.particlesEnabled =
        this.panel.querySelector<HTMLInputElement>("#particles")!.checked;
      this.audio.effects = Number(
        this.panel.querySelector<HTMLInputElement>("#effects")!.value,
      );
      this.audio.music = Number(
        this.panel.querySelector<HTMLInputElement>("#music")!.value,
      );
      if (this.saveData && !this.multiplayer)
        this.saveData.rules = {
          ...DEFAULT_RULES,
          ...this.saveData.rules,
          dayLength: Math.max(
            120,
            Math.min(
              7200,
              Number(
                this.panel.querySelector<HTMLInputElement>("#day-length")!
                  .value,
              ) * 60,
            ),
          ),
        };
      this.renderer.shadowMap.enabled = this.quality === "classic";
      this.renderer.setPixelRatio(
        this.quality === "low" ? 1 : Math.min(devicePixelRatio, 1.5),
      );
      this.panel.querySelector("#distance-value")!.textContent =
        `${this.distance} chunks`;
      this.panel.querySelector("#fov-value")!.textContent =
        `${this.camera.fov}°`;
      try {
        localStorage.setItem(
          "wildbrick-settings",
          JSON.stringify({
            distance: this.distance,
            fov: this.camera.fov,
            sensitivity: this.input.sensitivity,
            volume: this.audio.volume,
            quality: this.quality,
            bindings: this.input.bindings,
            simulationDistance: this.simulationDistance,
            maxMobs: this.maxMobs,
            particles: this.particlesEnabled,
            effects: this.audio.effects,
            music: this.audio.music,
          }),
        );
      } catch {
        this.toast("Instellingen konden niet worden opgeslagen.");
      }
    };
    this.panel
      .querySelectorAll("input")
      .forEach((el) => el.addEventListener("input", persist));
    this.panel.querySelector("#graphics")!.addEventListener("change", persist);
    this.panel.querySelector("#weather")!.addEventListener("change", () => {
      if (this.multiplayer) return;
      this.weather.state.kind = this.panel.querySelector<HTMLSelectElement>(
        "#weather",
      )!.value as "clear";
      this.weather.state.remaining = 240;
    });
    this.panel.querySelectorAll<HTMLButtonElement>("[data-binding]").forEach(
      (button) =>
        (button.onclick = () => {
          const action = button.dataset.binding!;
          button.querySelector("kbd")!.textContent = "Druk een toets…";
          const capture = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.code !== "Escape" && !["F3", "KeyR"].includes(e.code)) {
              const other = Object.keys(this.input.bindings).find(
                (a) => this.input.bindings[a] === e.code,
              );
              const old = this.input.bindings[action];
              if (other) this.input.bindings[other] = old;
              this.input.bindings[action] = e.code;
              persist();
            }
            window.removeEventListener("keydown", capture, true);
            this.settings();
          };
          window.addEventListener("keydown", capture, true);
          this.clearBindingCapture = () =>
            window.removeEventListener("keydown", capture, true);
        }),
    );
    this.button("#fullscreen", () => {
      void (
        document.fullscreenElement
          ? document.exitFullscreen()
          : this.root.requestFullscreen()
      ).catch(() => this.toast("Volledig scherm niet beschikbaar."));
    });
    this.button("#back", () =>
      this.previous === "pause" ? this.pause() : this.menu(),
    );
  }
  private updateHotbar() {
    this.survival.selectedSlot = this.selected;
    this.hotbar = this.survival.hotbarItems();
    this.multiplayer?.network.send({
      type: "select",
      slot: this.selected,
      item: this.hotbar[this.selected],
    });
    const bar = this.root.querySelector("#hotbar")!;
    bar.innerHTML = this.hotbar
      .map(
        (id, i) =>
          `<button class="slot ${i === this.selected ? "selected" : ""}" data-slot="${i}" title="${this.itemName(id)}"><span>${i + 1}</span><img src="${this.icons[id]}" alt="${this.itemName(id)}" style="${id ? "" : "visibility:hidden"}"><small>${this.mode === "creative" ? "∞" : (this.survival.getInventory().state.slots[i]?.count ?? 0)}</small>${tools[id] && this.survival.count(id) ? `<progress class="tool-durability" max="${tools[id].durability}" value="${this.survival.getInventory().state.slots[i]?.durability ?? tools[id].durability}"></progress>` : ""}</button>`,
      )
      .join("");
    bar.querySelectorAll<HTMLElement>("[data-slot]").forEach((el) => {
      el.onclick = () => {
        this.selected = Number(el.dataset.slot);
        this.updateHotbar();
      };
    });
    this.root.querySelector("#block-name")!.textContent = this.itemName(
      this.hotbar[this.selected],
    );
    const label = this.root.querySelector<HTMLElement>("#block-name")!;
    label.style.opacity = "1";
    clearTimeout(this.blockNameTimer);
    this.blockNameTimer = window.setTimeout(
      () => (label.style.opacity = "0"),
      2500,
    );
  }
  private async save(notify = false) {
    if (this.multiplayer) {
      if (notify)
        this.toast("De gedeelde wereld wordt op de hostcomputer opgeslagen.");
      return;
    }
    if (!this.saveData) return;
    if (this.saving) await this.saving;
    const snapshot: WorldSave = {
      ...this.saveData,
      rules: { ...(this.saveData.rules ?? DEFAULT_RULES) },
      position: this.player.position.toArray(),
      rotation: [this.input.yaw, this.input.pitch],
      hotbar: [...this.hotbar],
      changes: [...this.world.changes.values()],
      updated: Date.now(),
      flying: this.player.flying,
      mode: this.mode,
      survival: this.survival.serialize(),
      durability: { ...this.survival.durability },
      drops: this.drops.serialize(),
      height: this.world.height,
      day: this.day,
      cameraMode: this.cameraControl.mode,
      schemaVersion: 5,
      fireState: { ...this.fire?.ages },
      blockEntities: this.blockEntities.serialize(),
      blockStates: structuredClone(this.world.states),
      mobs: this.mobs.serialize(),
      xpOrbs: this.xpOrbs.serialize(),
      weather: this.weather.serialize(),
    };
    this.saving = this.storage.save(snapshot);
    try {
      await this.saving;
      // Keep the live object: commands may have changed its mode/rules while an older save was pending.
      if (this.saveData?.id === snapshot.id)
        this.saveData.updated = snapshot.updated;
      if (notify) this.toast("Wereld opgeslagen.");
    } catch (e) {
      this.toast("Opslaan mislukt. Controleer beschikbare browseropslag.");
      throw e;
    } finally {
      this.saving = null;
    }
  }
  private respawn() {
    const point = this.saveData?.spawnpoint ?? [8.5, -1, 8.5];
    this.player.position.set(
      point[0],
      point[1] >= 0
        ? point[1]
        : this.world.generator.height(point[0], point[2]) + 3,
      point[2],
    );
    this.player.velocity.set(0, 0, 0);
  }
  private die() {
    if (!this.saveData?.rules?.keepInventory) {
      for (const stack of this.survival.allStacks())
        this.drops.spawn(
          stack.id,
          stack.count,
          this.player.position
            .clone()
            .add(
              new THREE.Vector3(Math.random() - 0.5, 0.8, Math.random() - 0.5),
            )
            .toArray(),
          0,
          undefined,
          {
            durability: stack.durability,
            enchantments: stack.enchantments,
          },
        );
      this.survival.clearInventory();
      this.survival.durability = {};
      this.survival.enchantments = {};
      this.survival.equipment = 0;
      this.survival.xp = 0;
    }
    this.updateHotbar();
    this.audio.play("hurt");
    this.show(
      "pause",
      this.shell(
        "SURVIVAL",
        "You Died",
        `<p>${this.saveData?.rules?.keepInventory ? "Je inventory blijft behouden." : "Je spullen liggen op je laatste positie. Je kunt ze binnen vijf minuten ophalen."}</p><button id="respawn" class="primary">Respawn</button><button id="death-home">Opslaan & hoofdmenu</button>`,
      ),
    );
    this.button("#respawn", () => {
      const kept = this.survival;
      this.survival = new Survival();
      this.survival.difficulty = this.saveData?.rules?.difficulty ?? "normal";
      if (this.saveData?.rules?.keepInventory) {
        this.survival = new Survival(
          {
            ...kept.serialize(),
            health: 20,
            hunger: 20,
            saturation: 5,
            air: 10,
          },
          kept.durability,
        );
        this.survival.durability = kept.durability;
        this.survival.xp = kept.xp;
        this.survival.equipment = kept.equipment;
        this.survival.enchantments = kept.enchantments;
      }
      this.updateHotbar();
      this.respawn();
      this.show("playing", "");
      this.lock();
    });
    this.button(
      "#death-home",
      () =>
        void this.save()
          .then(() => {
            this.saveData = null;
            this.menu();
          })
          .catch(() => {}),
    );
  }
  private interact(place: boolean) {
    if (this.multiplayer) {
      this.multiplayer.action(place ? "use" : "mine");
      return;
    }
    if (this.mode === "spectator") return;
    if (this.mode === "adventure" && !place) return;
    this.hit = raycast(
      this.world,
      this.player.position
        .clone()
        .add(new THREE.Vector3(0, playerEyeHeight(this.player.sneaking), 0)),
      new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(this.input.pitch, this.input.yaw, 0, "YXZ"),
      ),
    );
    if (!this.hit) return;
    const h = this.hit;
    const target = this.world.get(h.x, h.y, h.z),
      selected = this.hotbar[this.selected];
    if (place && !this.player.sneaking) {
      if (this.interactions.toggle(h.x, h.y, h.z)) {
        this.audio.play("door");
        return;
      }
      if (target === 63) {
        if (this.saveData) {
          this.saveData.spawnpoint = [h.x + 0.5, h.y + 1, h.z + 0.5];
          if (Math.sin(this.day / 180 + 1) < 0)
            this.day =
              (Math.floor((this.day / 180 + 1) / (Math.PI * 2)) + 1) *
              Math.PI *
              360;
          this.toast("Spawnpoint ingesteld. Je wordt hier wakker.");
        }
        return;
      }
    }
    if (
      place &&
      this.mode !== "adventure" &&
      tools[selected]?.kind === "hoe" &&
      (this.mode === "creative" || this.survival.count(selected) > 0)
    ) {
      if (this.interactions.till(h.x, h.y, h.z)) {
        if (survivalLike(this.mode)) this.survival.useTool(selected);
        this.audio.play("place");
        return;
      }
    }
    if (place && selected === 117 && this.mode !== "adventure") {
      const { x, y, z } = placementPosition(this.world, h);
      if (
        (this.mode === "creative" || this.survival.count(117) > 0) &&
        this.interactions.plant(x, y, z)
      ) {
        if (survivalLike(this.mode)) this.survival.consume(117);
        this.updateHotbar();
      }
      return;
    }
    if (target === 62) this.interactions.prepareChest(h.x, h.y, h.z);
    if (
      place &&
      [19, 20, 62].includes(this.world.get(h.x, h.y, h.z)) &&
      !this.player.sneaking
    ) {
      this.station = {
        key: `${h.x},${h.y},${h.z}`,
        kind:
          this.world.get(h.x, h.y, h.z) === 19
            ? "table"
            : this.world.get(h.x, h.y, h.z) === 20
              ? "furnace"
              : "chest",
      };
      this.audio.play(
        this.station.kind === "chest"
          ? "chest"
          : this.station.kind === "furnace"
            ? "furnace"
            : "craft",
      );
      this.inventory();
      return;
    }
    if (this.mode === "adventure") return;
    if (place) {
      const { x, y, z } = placementPosition(this.world, h);
      const id = this.hotbar[this.selected];
      if (!blocks[id] || (id === 16 && survivalLike(this.mode))) return;
      if (survivalLike(this.mode) && this.survival.count(id) < 1) return;
      if (block(id).solid && this.player.intersects(x, y, z)) return;
      if (
        this.interactions.place(
          id,
          x,
          y,
          z,
          Math.round(this.input.yaw / (Math.PI / 2)),
          h.normal,
          (bx, by, bz) => this.player.intersects(bx, by, bz),
        )
      ) {
        this.mining = 1;
        this.audio.play("place");
        if (survivalLike(this.mode)) {
          this.survival.consume(id);
          this.updateHotbar();
        }
      }
    } else if (
      this.mode === "creative" ||
      this.world.get(h.x, h.y, h.z) !== 16
    ) {
      const id = this.world.get(h.x, h.y, h.z);
      if (this.world.set(h.x, h.y, h.z, 0)) {
        this.interactions.removeDoor(h.x, h.y, h.z, id);
        if (id === 52 && this.saveData?.rules?.doTileDrops) {
          this.drops.spawn(117, 2, [h.x + 0.5, h.y + 0.5, h.z + 0.5]);
          this.xpOrbs.spawn(1, [h.x + 0.5, h.y + 0.7, h.z + 0.5]);
        }
        this.blockEntities.break(
          `${h.x},${h.y},${h.z}`,
          (item, n, meta) =>
            this.saveData?.rules?.doTileDrops &&
            this.drops.spawn(
              item,
              n,
              [h.x + 0.5, h.y + 0.5, h.z + 0.5],
              0,
              undefined,
              meta,
            ),
        );
        this.mining = 1;
        this.spawnParticles(h, id);
        this.audio.play("break");
        if (survivalLike(this.mode)) {
          const tool = this.hotbar[this.selected],
            drop = this.survival.dropFor(id, tool);
          if (this.saveData?.rules?.doTileDrops)
            this.drops.spawn(drop, 1, [h.x + 0.5, h.y + 0.5, h.z + 0.5]);
          if (
            this.saveData?.rules?.doTileDrops &&
            id === 8 &&
            Math.random() < 0.3
          )
            this.drops.spawn(105, 1, [h.x + 0.5, h.y + 0.6, h.z + 0.5]);
          this.survival.useTool(tool);
          this.survival.exhaust(0.2);
          if (this.saveData?.rules?.doTileDrops && [12, 15].includes(id))
            this.xpOrbs.spawn(id === 15 ? 5 : 1, [
              h.x + 0.5,
              h.y + 0.5,
              h.z + 0.5,
            ]);
          this.updateHotbar();
        }
      }
    }
  }
  private targetMob() {
    if (this.mode === "spectator") return null;
    const origin = this.player.position
        .clone()
        .add(new THREE.Vector3(0, 1.5, 0)),
      direction = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(this.input.pitch, this.input.yaw, 0, "YXZ"),
      );
    let nearest: Mob | null = null,
      distance = 3.5;
    for (const m of this.mobs.mobs) {
      if (m.state === "Dead") continue;
      const offset = new THREE.Vector3(m.x, m.y + 0.9, m.z).sub(origin),
        along = offset.dot(direction);
      if (
        along > 0 &&
        along < distance &&
        offset.addScaledVector(direction, -along).length() < 0.8 &&
        this.mobs.lineOfSight(
          this.world,
          { x: origin.x, y: origin.y - 1, z: origin.z },
          m,
        )
      ) {
        nearest = m;
        distance = along;
      }
    }
    return nearest;
  }
  private attack(mob: Mob) {
    if (this.multiplayer) {
      if (this.attackCooldown <= 0) {
        this.multiplayer.action("attack");
        this.attackCooldown =
          tools[this.hotbar[this.selected]]?.cooldown ?? 0.5;
        this.mining = 1;
      }
      return;
    }
    if (this.attackCooldown > 0 || this.mode === "spectator") return;
    const id = this.hotbar[this.selected];
    this.attackCooldown = tools[id]?.cooldown ?? 0.5;
    const direction = new THREE.Vector3(
      mob.x - this.player.position.x,
      0,
      mob.z - this.player.position.z,
    ).normalize();
    const damage =
      this.mode === "creative"
        ? 20
        : this.survival.attackDamage(
            id,
            !this.player.grounded && this.player.velocity.y < 0,
          );
    if (this.mobs.hurt(mob, damage, [direction.x, direction.z])) {
      this.mining = 1;
      if (survivalLike(this.mode)) this.survival.useTool(id);
      this.survival.exhaust(0.4);
      this.audio.play("hurt");
      this.root.querySelector(".crosshair")!.classList.add("hit");
      setTimeout(
        () => this.root.querySelector(".crosshair")!.classList.remove("hit"),
        150,
      );
      this.updateHotbar();
    }
  }
  private explode(mob: Mob) {
    const p = this.player.position,
      distance = Math.hypot(p.x - mob.x, p.y - mob.y, p.z - mob.z);
    if (
      survivalLike(this.mode) &&
      distance < 5 &&
      this.mobs.lineOfSight(this.world, mob, p)
    )
      this.survival.damage(Math.max(1, 12 - distance * 2));
    if (!this.saveData?.rules?.mobGriefing) {
      this.audio.play("hurt");
      return;
    }
    for (let y = -2; y <= 2; y++)
      for (let z = -3; z <= 3; z++)
        for (let x = -3; x <= 3; x++)
          if (x * x + y * y + z * z < 9) {
            const wx = Math.floor(mob.x) + x,
              wy = Math.floor(mob.y) + y,
              wz = Math.floor(mob.z) + z,
              id = this.world.get(wx, wy, wz);
            if (![0, 16, 24, 11].includes(id)) {
              this.world.set(wx, wy, wz, 0);
              this.blockEntities.break(
                `${wx},${wy},${wz}`,
                (i, n, meta) =>
                  this.saveData?.rules?.doTileDrops &&
                  this.drops.spawn(
                    i,
                    n,
                    [wx + 0.5, wy + 0.5, wz + 0.5],
                    0,
                    undefined,
                    meta,
                  ),
              );
            }
          }
    this.audio.play("hurt");
  }
  private spawnParticles(h: VoxelHit, id: number) {
    if (!this.particlesEnabled) return;
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
    }
    const coords: number[] = [];
    for (let i = 0; i < 18; i++)
      coords.push(
        h.x + Math.random(),
        h.y + Math.random(),
        h.z + Math.random(),
      );
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
    this.particles = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: block(id).color, size: 0.09 }),
    );
    this.scene.add(this.particles);
    this.particleLife = 0.5;
  }
  private bind() {
    window.addEventListener(
      "keydown",
      (e) => {
        if (blocksBrowserShortcut(e, isTextEditing(e.target)))
          e.preventDefault();
      },
      true,
    );
    this.root.addEventListener("dragstart", (e) => e.preventDefault());
    window.addEventListener("resize", () => this.resize());
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("pointerlockerror", () => {
      this.locking = false;
      if (this.screen === "playing" && !this.chat?.isOpen) {
        this.toast(
          "De browser heeft muisvergrendeling geweigerd. Klik op Verder spelen.",
        );
        this.pause();
      }
    });
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.renderer.domElement)
        this.locking = false;
      if (
        document.pointerLockElement !== this.renderer.domElement &&
        this.screen === "playing" &&
        !this.chat?.isOpen &&
        !this.chat?.relocking &&
        !this.locking
      ) {
        this.pointerPauseAt = performance.now();
        this.pause();
      }
    });
    document.addEventListener("mousemove", (e) => {
      if (this.screen === "playing" && document.pointerLockElement)
        this.input.look(e.movementX, e.movementY);
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        e.preventDefault();
        if (e.repeat) return;
        if (
          this.screen === "pause" &&
          performance.now() - this.pointerPauseAt < 200
        )
          return;
      }
      if (this.chat?.isOpen) return;
      if (
        this.screen === "playing" &&
        (e.code === "KeyT" || e.key === "/") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (e.repeat) return;
        this.input.clear();
        this.held = null;
        this.mineProgress = 0;
        this.mining = 0;
        this.eating = 0;
        this.cracks.visible = false;
        this.root.querySelector<HTMLElement>("#mining-progress")!.hidden = true;
        this.chat?.open(e.key === "/" ? "/" : "");
        return;
      }
      const code = this.input.resolve(e.code);
      if (
        ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName) &&
        e.code !== "Escape"
      )
        return;
      if (this.screen === "playing") {
        if (
          [
            "Space",
            "Tab",
            "F3",
            "F5",
            "ControlLeft",
            "ControlRight",
            "KeyE",
          ].includes(code)
        )
          e.preventDefault();
        if (e.repeat) return;
        if (code === "Escape") {
          this.pause();
          return;
        }
        if (code === "KeyE" && this.mode === "spectator") return;
        if (code === "KeyE") {
          this.station = null;
          this.inventory();
          return;
        }
        if (code === "F3") {
          this.showDebug = !this.showDebug;
          this.debug.hidden = !this.showDebug;
          return;
        }
        if (code === "F5") {
          this.cameraControl.cycle();
          return;
        }
        if (code === "KeyF" && this.multiplayer && survivalLike(this.mode)) {
          this.multiplayer.action("eat");
          return;
        }
        if (code === "KeyF" && survivalLike(this.mode)) {
          if (this.eating <= 0 && this.survival.hunger < 20) {
            this.eatingId = foods[this.hotbar[this.selected]]
              ? this.hotbar[this.selected]
              : 105;
            if (this.survival.count(this.eatingId)) this.eating = 1.3;
          }
          return;
        }
        if (code === "KeyR" && this.multiplayer) return;
        if (code === "KeyR" && this.mode === "creative") {
          this.respawn();
          return;
        }
        if (/^Digit[1-9]$/.test(code)) {
          this.selected = Number(code.slice(5)) - 1;
          this.updateHotbar();
        }
        if (code === "Space" && this.player.grounded && !this.player.flying)
          this.audio.play("jump");
        this.input.keyDown(
          code,
          this.player,
          performance.now(),
          this.mode === "creative",
        );
      } else if (
        this.screen === "inventory" &&
        (code === "KeyE" || code === "Escape")
      ) {
        e.preventDefault();
        this.show("playing", "");
        this.lock();
      } else if (code === "Escape") {
        if (this.screen === "pause")
          this.panel.querySelector<HTMLButtonElement>("#resume")?.click();
        else if (this.screen === "settings" && this.previous === "pause")
          this.pause();
        else if (this.screen === "character" && this.multiplayer) this.pause();
        else if (this.screen === "multiplayer" || this.screen === "connection")
          this.menu();
        else if (
          ["settings", "character", "create", "worlds"].includes(this.screen)
        )
          this.menu();
      }
    });
    window.addEventListener("keyup", (e) =>
      this.input.keys.delete(this.input.resolve(e.code)),
    );
    window.addEventListener("blur", () => {
      this.input.clear();
      if (this.screen === "playing") this.pause();
    });
    this.renderer.domElement.addEventListener("mousedown", (e) => {
      if (
        this.screen !== "playing" ||
        this.chat?.isOpen ||
        this.mode === "spectator"
      )
        return;
      if (!document.pointerLockElement) {
        this.lock();
        return;
      }
      if (e.button !== 0 && e.button !== 2) {
        e.preventDefault();
        return;
      }
      this.held = e.button;
      if (this.multiplayer) {
        this.multiplayer.action(
          e.button === 2 ? "use" : this.targetMob() ? "attack" : "mine",
        );
        this.netActionClock = 0.17;
        return;
      }
      if (e.button === 0) {
        const mob = this.targetMob();
        if (mob) {
          this.attack(mob);
          return;
        }
      }
      if (e.button === 2 && this.hotbar[this.selected] === 116) {
        if (
          this.attackCooldown <= 0 &&
          (this.mode === "creative" ||
            (this.survival.count(116) > 0 && this.survival.consume(115)))
        ) {
          const from = this.player.position
              .clone()
              .add(new THREE.Vector3(0, 1.5, 0)),
            dir = new THREE.Vector3(0, 0, -1).applyEuler(
              new THREE.Euler(this.input.pitch, this.input.yaw, 0, "YXZ"),
            );
          this.projectiles.shoot("player", from, dir);
          if (survivalLike(this.mode)) this.survival.useTool(116);
          this.audio.play("bow");
          this.attackCooldown = 0.7;
          this.updateHotbar();
        }
        return;
      }
      this.actionCooldown = 0.2;
      this.mineProgress = 0;
      if (this.mode === "creative" || e.button === 2)
        this.interact(e.button === 2);
    });
    window.addEventListener("mouseup", () => {
      this.multiplayer?.action("stop");
      this.held = null;
      this.mineProgress = 0;
    });
    window.addEventListener(
      "wheel",
      (e) => {
        if (this.screen !== "playing" || this.chat?.isOpen) return;
        e.preventDefault();
        this.selected = (this.selected + (e.deltaY > 0 ? 1 : 8)) % 9;
        this.updateHotbar();
      },
      { passive: false },
    );
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        if (this.saveData) void this.save().catch(() => {});
        if (this.screen === "playing") this.pause();
      }
    });
    window.addEventListener("pagehide", () => {
      if (this.saveData) void this.save().catch(() => {});
    });
  }
  private resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  private stream() {
    const playing = !!this.saveData;
    const pos = playing ? this.player.position : new THREE.Vector3(8, 40, 8);
    const cx = Math.floor(pos.x / 16),
      cz = Math.floor(pos.z / 16),
      r = playing
        ? Math.min(
            this.distance,
            this.multiplayer?.viewDistance ?? this.distance,
          )
        : 3;
    const needed: { cx: number; cz: number; d: number }[] = [];
    for (let z = -r; z <= r; z++)
      for (let x = -r; x <= r; x++) {
        if (x * x + z * z > (r + 0.5) ** 2) continue;
        const key = this.world.key(cx + x, cz + z);
        if (!this.meshes.has(key) || this.world.dirty.has(key))
          needed.push({ cx: cx + x, cz: cz + z, d: x * x + z * z });
      }
    needed.sort((a, b) => a.d - b.d);
    const next = needed[0];
    if (next) {
      if (typeof Worker !== "undefined" && !this.world.workerFailed) {
        const coords = [
          [next.cx, next.cz],
          [next.cx - 1, next.cz],
          [next.cx + 1, next.cz],
          [next.cx, next.cz - 1],
          [next.cx, next.cz + 1],
        ];
        let ready = true;
        for (const [x, z] of coords)
          if (!this.world.chunks.has(this.world.key(x, z))) {
            this.world.prefetch(x, z);
            ready = false;
          }
        if (!ready) return;
      }
      const key = this.world.key(next.cx, next.cz);
      const old = this.meshes.get(key);
      if (old) disposeChunk(old);
      const mesh = meshChunk(this.world, next.cx, next.cz, this.materials);
      this.meshes.set(key, mesh);
      this.scene.add(mesh);
      this.world.dirty.delete(key);
    }
    for (const [key, mesh] of this.meshes) {
      const [x, z] = key.split(",").map(Number);
      if (Math.abs(x - cx) > r + 1 || Math.abs(z - cz) > r + 1) {
        disposeChunk(mesh);
        this.meshes.delete(key);
      }
    }
    for (const key of this.world.chunks.keys()) {
      const [x, z] = key.split(",").map(Number);
      if (Math.abs(x - cx) > r + 2 || Math.abs(z - cz) > r + 2) {
        this.world.chunks.delete(key);
        this.world.dirty.delete(key);
      }
    }
    const fog = this.scene.fog as THREE.Fog;
    fog.near = r * 16 * 0.55;
    fog.far = r * 16;
    this.clouds.position.set(
      Math.floor(pos.x / 200) * 200 + ((this.elapsed * 0.25) % 30),
      0,
      Math.floor(pos.z / 180) * 180,
    );
  }
  private frame = (time: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min((time - this.last) / 1000 || 0.016, 0.05);
    this.last = time;
    this.elapsed += dt;
    this.fps = this.fps * 0.95 + (1 / dt) * 0.05;
    this.chat?.tick(!!this.saveData && this.screen === "playing");
    this.remotePlayers.render(dt);
    if (this.multiplayer) {
      if (
        this.screen !== "playing" ||
        !document.pointerLockElement ||
        this.chat?.isOpen ||
        this.netDead
      )
        this.input.clear();
      this.multiplayer.update(dt, this.input, this.player);
      this.refreshContainer?.();
    }
    if (
      !this.multiplayer &&
      this.saveData &&
      ["playing", "inventory"].includes(this.screen)
    ) {
      this.blockEntities.tick(
        dt,
        this.world,
        this.player.position,
        this.simulationDistance * 16,
        this.saveData.rules?.randomTickSpeed ?? 3,
      );
      this.fire?.tick(
        dt,
        this.saveData.rules?.doFireTick ?? true,
        this.player.position,
        this.simulationDistance * 16,
      );
      this.refreshContainer?.();
      if (
        Object.entries(this.blockEntities.data.furnaces).some(([key, f]) => {
          const [x, , z] = key.split(",").map(Number);
          return (
            f.burn > 0 &&
            Math.hypot(x - this.player.position.x, z - this.player.position.z) <
              8
          );
        })
      )
        this.audio.play("furnace");
    }
    if (this.screen === "playing" && document.pointerLockElement) {
      this.player.swimming =
        this.world.get(
          this.player.position.x,
          this.player.position.y + 0.7,
          this.player.position.z,
        ) === 11;
      this.player.climbing =
        this.world.get(
          this.player.position.x,
          this.player.position.y + 0.5,
          this.player.position.z,
        ) === 64;
      this.input.canSprint =
        !survivalLike(this.mode) || this.survival.hunger > 6;
      const wasGrounded = this.player.grounded;
      if (!this.multiplayer) this.input.update(this.player, dt);
      if (!wasGrounded && this.player.grounded) this.audio.play("land");
      if (this.player.swimming) this.audio.play("water");
      if (
        !this.multiplayer &&
        this.player.position.y < -10 &&
        this.mode !== "spectator"
      )
        this.respawn();
      this.cameraControl.update(
        this.camera,
        this.world,
        this.multiplayer?.renderPosition ?? this.player.position,
        this.input.yaw,
        this.input.pitch,
        this.player.sneaking,
        this.player.noclip,
      );
      const eye = this.player.position
        .clone()
        .add(new THREE.Vector3(0, playerEyeHeight(this.player.sneaking), 0));
      const aim = new THREE.Vector3(0, 0, -1).applyEuler(
        new THREE.Euler(this.input.pitch, this.input.yaw, 0, "YXZ"),
      );
      this.hit =
        this.mode === "spectator" ? null : raycast(this.world, eye, aim);
      this.outline.visible = !!this.hit;
      if (this.hit)
        this.outline.position.set(
          this.hit.x + 0.5,
          this.hit.y + 0.5,
          this.hit.z + 0.5,
        );
      this.actionCooldown = Math.max(0, this.actionCooldown - dt);
      this.attackCooldown = Math.max(0, this.attackCooldown - dt);
      if (!this.multiplayer) {
        this.syncRules();
        this.mobs.maxMobs = this.maxMobs;
        this.mobs.simulationDistance = this.simulationDistance * 16;
        this.mobs.update(
          this.world,
          dt,
          this.player.position,
          Math.sin(this.day / 180 + 1) < 0,
          this.saveData?.rules?.difficulty === "peaceful",
        );
        this.projectiles.update(
          dt,
          this.world,
          this.player.position,
          this.mobs.mobs,
          (n) => {
            if (survivalLike(this.mode)) this.survival.damage(n);
          },
          (m, n, dir) => this.mobs.hurt(m, n, dir),
          () => this.mode !== "spectator" && this.survival.add(115) === 0,
        );
        if (this.mode !== "spectator")
          this.xpOrbs.update(dt, this.player.position, (n) => {
            this.survival.addXP(n);
            this.audio.play("pickup");
          });
      }
      this.cracks.visible = false;
      if (!this.multiplayer && this.eating > 0) {
        this.eating -= dt;
        this.mining = (Math.sin(this.elapsed * 16) + 1) / 2;
        if (this.eating <= 0 && this.survival.eat(this.eatingId)) {
          this.audio.play("eat");
          this.updateHotbar();
        }
      }
      const progress =
        this.root.querySelector<HTMLElement>("#mining-progress")!;
      progress.hidden = true;
      const mineKey =
        this.held === 0 && this.hit
          ? `${this.hit.x},${this.hit.y},${this.hit.z}:${this.world.get(this.hit.x, this.hit.y, this.hit.z)}:${this.selected}`
          : "";
      if (mineKey !== this.mineTarget) {
        this.mineTarget = mineKey;
        this.mineProgress = 0;
      }
      if (this.multiplayer) {
        this.netActionClock -= dt;
        if (this.held !== null && this.netActionClock <= 0) {
          this.multiplayer.action(
            this.held === 2 ? "use" : this.targetMob() ? "attack" : "mine",
          );
          this.netActionClock = 0.17;
          this.mining = 1;
        }
        if (this.held === 0 && this.hit && this.mode === "survival") {
          this.mineProgress = Math.min(
            0.98,
            this.mineProgress +
              dt /
                this.survival.miningTime(
                  this.world.get(this.hit.x, this.hit.y, this.hit.z),
                  this.hotbar[this.selected],
                ),
          );
          this.cracks.update(
            this.hit.x,
            this.hit.y,
            this.hit.z,
            this.mineProgress,
          );
        }
      } else {
        const attacked = this.held === 0 ? this.targetMob() : null;
        if (attacked) this.attack(attacked);
        if (
          this.held === 0 &&
          this.hit &&
          !attacked &&
          (this.mode === "survival" || this.mode === "creative")
        ) {
          if (this.mode === "creative") {
            if (this.actionCooldown === 0) {
              this.interact(false);
              this.actionCooldown = 0.17;
            }
          } else {
            const id = this.world.get(this.hit.x, this.hit.y, this.hit.z);
            if (id !== 16) {
              this.mineProgress +=
                dt / this.survival.miningTime(id, this.hotbar[this.selected]);
              progress.hidden = false;
              (progress.firstElementChild as HTMLElement).style.width =
                `${Math.min(1, this.mineProgress) * 100}%`;
              this.mining = (this.elapsed * 3) % 1;
              this.cracks.update(
                this.hit.x,
                this.hit.y,
                this.hit.z,
                this.mineProgress,
              );
              if (this.mineProgress >= 1) {
                this.interact(false);
                this.mineProgress = 0;
              }
            }
          }
        } else if (this.held === 2 && this.actionCooldown === 0) {
          this.interact(true);
          this.actionCooldown = 0.2;
        }
      }
      if (
        this.player.grounded &&
        Math.hypot(this.player.velocity.x, this.player.velocity.z) > 1
      )
        this.audio.play("step");
      if (!this.multiplayer && survivalLike(this.mode)) {
        const beforeHealth = this.survival.health;
        this.drops.update(
          this.world,
          this.player.position,
          dt,
          (id, count, drop) => {
            const remaining = this.survival.addStack({ ...drop, id, count });
            if (remaining < count) {
              this.updateHotbar();
              this.audio.play("pickup");
            }
            return remaining;
          },
        );
        this.survival.tick(
          dt,
          this.player.position.y,
          this.player.grounded,
          this.player.swimming,
          Math.hypot(this.player.velocity.x, this.player.velocity.z) > 1,
          this.input.keys.has("ControlLeft"),
          {
            submerged:
              this.world.get(
                this.player.position.x,
                this.player.position.y + 1.5,
                this.player.position.z,
              ) === 11,
            lava:
              this.world.get(
                this.player.position.x,
                this.player.position.y + 0.2,
                this.player.position.z,
              ) === 23,
            fire:
              this.world.get(
                this.player.position.x,
                this.player.position.y + 0.2,
                this.player.position.z,
              ) === 66,
          },
        );
        if (this.survival.health < beforeHealth) this.audio.play("hurt");
        this.root.classList.toggle("damaged", this.survival.hurt > 0);
        if (this.survival.health <= 0) this.die();
      }
      this.vitalClock += dt;
      if (this.vitalClock > 0.2) {
        this.vitalClock = 0;
        this.root.querySelector("#vitals")!.innerHTML = survivalLike(this.mode)
          ? survivalHUD(this.survival)
          : this.player.flying
            ? this.mode === "spectator"
              ? "SPECTATOR FLIGHT"
              : "CREATIVE FLIGHT"
            : "";
        this.root.querySelector("#camera-label")!.textContent = [
          "First person",
          "Third person · achter",
          "Third person · voor",
        ][this.cameraControl.mode];
      }
      this.autosave += dt;
      if (this.autosave > 10) {
        this.autosave = 0;
        void this.save().catch(() => {});
      }
      if (!this.multiplayer && this.saveData?.rules?.doDaylightCycle)
        this.day +=
          dt * ((Math.PI * 360) / (this.saveData?.rules?.dayLength ?? 1200));
    } else {
      this.outline.visible = false;
      if (!this.saveData) {
        this.camera.position.set(
          8 + Math.sin(this.elapsed * 0.025) * 32,
          48,
          8 + Math.cos(this.elapsed * 0.025) * 32,
        );
        this.camera.lookAt(8, 31, 8);
      }
    }
    this.mining = Math.max(0, this.mining - dt * 5);
    this.arm.visible =
      this.screen === "playing" &&
      this.cameraControl.mode === 0 &&
      this.mode !== "spectator";
    if (this.avatar) {
      this.avatar.visible =
        !!this.saveData &&
        this.cameraControl.mode !== 0 &&
        this.mode !== "spectator";
      this.avatar.position.copy(
        this.multiplayer?.renderPosition ?? this.player.position,
      );
      const facing = this.input.yaw + Math.PI;
      const turn = Math.atan2(
        Math.sin(facing - this.bodyYaw),
        Math.cos(facing - this.bodyYaw),
      );
      this.bodyYaw += turn * (1 - Math.exp(-dt * 9));
      this.avatar.rotation.y = this.bodyYaw;
      this.avatar.head.rotation.y = THREE.MathUtils.clamp(turn, -1, 1);
      this.avatar.animate(
        dt,
        Math.hypot(this.player.velocity.x, this.player.velocity.z),
        this.player.velocity.y,
        this.player.grounded || this.player.flying,
        this.player.sneaking,
        this.mining,
        this.input.pitch,
      );
    }
    this.arm.rotation.x = -Math.sin(this.mining * Math.PI) * 0.8;
    this.arm.rotation.z =
      Math.sin(this.elapsed * 7) *
      Math.min(0.025, this.player.velocity.length() * 0.005);
    this.stream();
    this.chestAnimator.update(
      this.world,
      this.screen === "inventory" && this.station?.kind === "chest"
        ? this.station.key
        : null,
      dt,
    );
    this.audio.tick(dt, this.screen === "playing");
    this.lighting.trim();
    this.weather.particles = this.particlesEnabled;
    this.weather.update(
      dt,
      this.world,
      this.saveData ? this.player.position : this.camera.position,
      !!this.saveData && this.screen !== "pause",
      (kind) => this.audio.play(kind),
      !this.multiplayer && (this.saveData?.rules?.doWeatherCycle ?? true),
    );
    const sources = [...this.lighting.sources.values()]
      .flat()
      .filter(
        (p) =>
          Math.hypot(
            p[0] - this.player.position.x,
            p[1] - this.player.position.y,
            p[2] - this.player.position.z,
          ) < 14,
      )
      .sort(
        (a, b) =>
          Math.hypot(
            a[0] - this.player.position.x,
            a[2] - this.player.position.z,
          ) -
          Math.hypot(
            b[0] - this.player.position.x,
            b[2] - this.player.position.z,
          ),
      );
    this.torchLights.forEach((light, i) => {
      light.visible =
        !!this.saveData && i < (this.quality === "low" ? 2 : 6) && !!sources[i];
      if (sources[i]) light.position.fromArray(sources[i]);
    });
    this.mobRenderer.update(this.saveData ? this.mobs.mobs : [], this.elapsed);
    const angle = this.day / 180 + 1;
    const daylight = 0.08 + 0.92 * Math.max(0, Math.sin(angle));
    this.sun.intensity = daylight * 2;
    if (this.weather.state.kind !== "clear") this.sun.intensity *= 0.55;
    this.ambient.intensity = 0.15 + daylight;
    const center = this.saveData ? this.player.position : this.camera.position;
    this.sunDisc.position
      .copy(center)
      .add(new THREE.Vector3(Math.cos(angle) * 85, Math.sin(angle) * 85, -30));
    this.moonDisc.position
      .copy(center)
      .add(new THREE.Vector3(-Math.cos(angle) * 85, -Math.sin(angle) * 85, 30));
    this.sunDisc.lookAt(this.camera.position);
    this.moonDisc.lookAt(this.camera.position);
    this.sunDisc.visible = Math.sin(angle) > -0.1;
    this.moonDisc.visible = Math.sin(angle) < 0.1;
    this.sun.position
      .copy(center)
      .add(
        new THREE.Vector3(
          Math.cos(angle) * 35,
          Math.max(15, Math.abs(Math.sin(angle)) * 65),
          25,
        ),
      );
    this.sun.target.position.copy(center);
    this.renderer.shadowMap.enabled = this.quality === "classic";
    const sky = new THREE.Color(0x91c9df).multiplyScalar(
      0.25 + daylight * 0.75,
    );
    if (this.weather.state.kind !== "clear") sky.multiplyScalar(0.68);
    if (this.weather.flash > 0)
      sky.lerp(new THREE.Color("#e2e8ed"), this.weather.flash);
    (this.scene.background as THREE.Color).copy(sky);
    (this.scene.fog as THREE.Fog).color.copy(sky);
    if (this.particles) {
      this.particleLife -= dt;
      const attr = this.particles.geometry.getAttribute("position");
      for (let i = 0; i < attr.count; i++)
        attr.setY(i, attr.getY(i) - dt * 0.9);
      attr.needsUpdate = true;
      if (this.particleLife <= 0) {
        this.scene.remove(this.particles);
        this.particles.geometry.dispose();
        (this.particles.material as THREE.Material).dispose();
        this.particles = null;
      }
    }
    this.renderer.render(this.scene, this.camera);
    if (this.showDebug) {
      const p = this.player.position;
      this.debug.textContent = `WHITEBRICK 0.6 / ${this.multiplayer ? "LAN · " + Math.round(this.multiplayer.network.ping) + " ms · server " + this.networkTickMs.toFixed(1) + " ms · players " + this.remotePlayers.count : "Singleplayer"}\n${Math.round(this.fps)} FPS · ${this.renderer.info.render.calls} draw calls\nXYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}\nLook ${this.input.yaw.toFixed(4)} / ${this.input.pitch.toFixed(4)}\nChunks ${this.meshes.size} · cache ${this.world.chunks.size}\nBiome ${this.world.generator.biome(p.x, p.z)}\nSeed ${this.world.seed}\n${this.player.flying ? "Vliegen" : this.player.grounded ? "Op de grond" : "In de lucht"}`;
    }
  };
}
