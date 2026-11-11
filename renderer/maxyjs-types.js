// Types des scripts JavaScript de MaxyStudio : autocomplétion dans l'éditeur intégré et dans VS Code
// (fichier types/maxy.d.ts + jsconfig.json écrits dans le projet).

export const MAXY_DTS = `// Types de l'API JavaScript de MaxyStudio (autocomplétion). Ne pas modifier : MaxyStudio réécrit ce fichier.
declare namespace Maxy {
  /** Objet 2D (lutin). */
  interface Sprite2D {
    readonly name: string;
    x: number; y: number;
    /** Direction en degrés (90 = vers la droite). */
    direction: number;
    /** Taille en %. */
    size: number;
    visible: boolean;
    /** Nom du costume (ou numéro à partir de 1 pour le changer). */
    costume: string | number;
    /** Fantôme de 0 à 100. */
    ghost: number;
    goTo(x: number, y: number): void;
    move(steps: number): void;
    turn(degrees: number): void;
    pointTowards(x: number, y: number): void;
    say(text: any, seconds?: number): void;
    /** 'edge', 'mouse', 'anything' ou le nom d'un objet. */
    touching(what?: string): boolean;
    distanceTo(name: string): number;
  }
  /** Objet 3D. */
  interface Object3D {
    readonly name: string;
    /** L'objet three.js (accès avancé). */
    readonly object3D: any;
    /** Position (THREE.Vector3, modifiable directement). */
    readonly position: { x: number; y: number; z: number; set(x: number, y: number, z: number): any };
    /** Rotation en radians (THREE.Euler). */
    readonly rotation: { x: number; y: number; z: number };
    readonly scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): any };
    x: number; y: number; z: number;
    visible: boolean;
    /** Vitesse de la physique, ou null si la physique est désactivée. */
    readonly velocity: { x: number; y: number; z: number } | null;
    readonly onGround: boolean;
    /** Déplace en tenant compte des collisions. */
    move(dx: number, dy?: number, dz?: number): void;
    moveForward(distance: number): void;
    /** Tourne de x, y, z degrés. */
    rotate(x?: number, y?: number, z?: number): void;
    lookAt(nameOrX: string | number, y?: number, z?: number): void;
    physics(on?: boolean): void;
    jump(force?: number): void;
    setColor(color: string): void;
    /** Animation d'un modèle 3D (glb, fbx…). */
    playAnimation(name: string, once?: boolean): void;
    touching(name?: string): boolean;
    distanceTo(name: string): number;
    destroy(): void;
  }
  interface UiElement { text: string; value: number; show(): void; hide(): void; }

  /** Classe de base d'un script : this donne accès à l'objet (this.x, this.move()…). */
  class Script implements Partial<Sprite2D>, Partial<Object3D> {
    readonly name: string;
    readonly object: Sprite2D & Object3D;
    /** Appelé une fois au lancement du jeu. */
    start?(): void | Promise<void>;
    /** Appelé à chaque image ; dt = secondes depuis l'image précédente. */
    update?(dt: number): void;
    /** Clic sur cet objet. */
    onClick?(): void;
    /** Message envoyé par Maxy.send() ou par MaxyCode (broadcast). */
    onMessage?(message: string, data?: any): void;
    /** Joue un clip d'animation (assets/animations/Nom.anim). */
    playClip(clip: string, once?: boolean): Promise<void> | void;
    stopClip(): void;
    log(...values: any[]): void;
    x: number; y: number; z: number; direction: number; size: number; visible: boolean; costume: string | number; ghost: number;
    readonly position: Object3D['position']; readonly rotation: Object3D['rotation']; readonly scale: Object3D['scale'];
    readonly velocity: Object3D['velocity']; readonly onGround: boolean;
    goTo(x: number, y: number): void; move(a: number, b?: number, c?: number): void; turn(degrees: number): void;
    pointTowards(x: number, y: number): void; say(text: any, seconds?: number): void; touching(what?: string): boolean;
    distanceTo(name: string): number; moveForward(distance: number): void; rotate(x?: number, y?: number, z?: number): void;
    lookAt(nameOrX: string | number, y?: number, z?: number): void; physics(on?: boolean): void; jump(force?: number): void;
    setColor(color: string): void; playAnimation(name: string, once?: boolean): void; destroy(): void;
  }
  /** Variables de la Scène, partagées avec MaxyCode : Maxy.vars.score += 1 */
  const vars: Record<string, any>;
  /** Secondes depuis l'image précédente. */
  const dt: number;
  /** Secondes depuis le lancement. */
  const time: number;
  const frame: number;
  /** Nom de la scène en cours. */
  const scene: string;
  const is3D: boolean;
  /** three.js (projets 3D). */
  const THREE: any;
  /** Touche enfoncée : 'Space', 'ArrowUp', 'KeyW' ou 'w'… */
  function key(name: string): boolean;
  /** Touche appuyée pendant cette image seulement. */
  function keyPressed(name: string): boolean;
  /** -1 à 1 : flèches, ZQSD, WASD, manette. */
  function axis(name: 'horizontal' | 'vertical'): number;
  const mouse: { x: number; y: number; down: boolean };
  /** Un autre objet de la scène, par son nom. */
  function find(name: string): (Sprite2D & Object3D) | null;
  /** Envoie un message aux scripts MaxyCode (when I receive) et JavaScript (onMessage). */
  function send(message: string, data?: any): void;
  /** Élément de l'onglet Interface, par son nom. */
  function ui(name: string): UiElement;
  function goToScene(name: string): void;
  /** Nombre au hasard (entier si a et b sont entiers). */
  function random(a?: number, b?: number): number;
  /** Attendre (dans une méthode async). */
  function wait(seconds: number): Promise<void>;
  function log(...values: any[]): void;
  function warn(...values: any[]): void;
  function error(...values: any[]): void;
}
`;

export const JSCONFIG = JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ES2022', checkJs: false, lib: ['ES2022', 'DOM'] }, include: ['scripts/**/*.js', 'types/maxy.d.ts'] }, null, 2) + '\n';

export function jsTemplate(type, name) {
  const cls = String(name || 'Script').replace(/[^A-Za-z0-9_]/g, '') || 'Script';
  if (type === '3d') return `// Script JavaScript de « ${name} » (MaxyStudio). Aide : Aide > Guide MaxyCode et JavaScript.
export default class ${/^[A-Za-z_]/.test(cls) ? cls : 'S' + cls} extends Maxy.Script {
  start() {
    this.speed = 5;
  }

  update(dt) {
    // Flèches ou ZQSD : avancer et tourner
    this.rotate(0, -Maxy.axis('horizontal') * 120 * dt, 0);
    this.moveForward(Maxy.axis('vertical') * this.speed * dt);
    if (Maxy.keyPressed('Space')) this.jump(6);
  }

  onClick() {
    this.log('Cliqué !');
  }
}
`;
  return `// Script JavaScript de « ${name} » (MaxyStudio). Aide : Aide > Guide MaxyCode et JavaScript.
export default class ${/^[A-Za-z_]/.test(cls) ? cls : 'S' + cls} extends Maxy.Script {
  start() {
    this.speed = 240; // pixels par seconde
  }

  update(dt) {
    this.x += Maxy.axis('horizontal') * this.speed * dt;
    this.y += Maxy.axis('vertical') * this.speed * dt;
  }

  onClick() {
    this.say('Bonjour !', 1.5);
  }
}
`;
}
