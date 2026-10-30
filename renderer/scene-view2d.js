// Vue Scène 2D de l'éditeur : la scène Scratch (480 × 360) avec ses lutins, déplaçables à la souris.
export class SceneView2D {
  constructor(container, opts) {
    this.el = container;
    this.opts = opts;
    this.canvas = document.createElement('canvas');
    this.canvas.tabIndex = 0;
    container.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.scene = null;
    this.selected = null;
    this.images = new Map();
    this.showGrid = true;
    this.bind();
    new ResizeObserver(() => this.draw()).observe(container);
  }

  image(rel) {
    if (!rel) return null;
    if (!this.images.has(rel)) {
      const img = new Image();
      img.onload = () => this.draw();
      img.src = this.opts.resolveUrl(rel);
      this.images.set(rel, img);
    }
    const img = this.images.get(rel);
    return img.complete && img.naturalWidth ? img : null;
  }
  reloadImages() { this.images.clear(); this.draw(); }

  load(scene) { this.scene = scene; this.draw(); }
  updateObject() { this.draw(); }
  setTransform() { this.draw(); }
  addObject() { this.draw(); }
  removeObject(id) { if (this.selected === id) this.selected = null; this.draw(); }
  select(id) { this.selected = id; this.draw(); }
  setGrid(on) { this.showGrid = on; this.draw(); }
  setTool() {} setSpace() {} setSnapMode() {} setEnvironment() {}
  focus() {}

  // Échelle et origine : la scène garde ses proportions 4:3, centrée.
  layout() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    const k = Math.min((w - 40) / 480, (h - 40) / 360);
    return { w, h, k: Math.max(0.2, k), ox: w / 2, oy: h / 2 };
  }
  toStage(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const { k, ox, oy } = this.layout();
    return { x: (clientX - r.left - ox) / k, y: -(clientY - r.top - oy) / k };
  }
  spriteRect(o) {
    const img = this.image((o.costumes || [])[0]);
    const s = (+o.size || 100) / 100;
    const w = (img ? img.naturalWidth : 60) * s, h = (img ? img.naturalHeight : 60) * s;
    return { img, w, h };
  }
  hit(x, y) {
    const objs = (this.scene && this.scene.objects) || [];
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      const { w, h } = this.spriteRect(o);
      if (Math.abs(x - o.x) <= w / 2 && Math.abs(y - o.y) <= h / 2) return o;
    }
    return null;
  }

  draw() {
    const c = this.canvas, g = this.g;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const { w, h, k, ox, oy } = this.layout();
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#2b2c30'; g.fillRect(0, 0, w, h);
    g.save();
    g.translate(ox, oy); g.scale(k, k);
    g.fillStyle = '#ffffff'; g.fillRect(-240, -180, 480, 360);
    const stage = (this.scene && this.scene.stage) || {};
    const bg = this.image((stage.backdrops || [])[0]);
    if (bg) g.drawImage(bg, -240, -180, 480, 360);
    if (this.showGrid) {
      g.strokeStyle = 'rgba(0,0,0,.08)'; g.lineWidth = 1 / k;
      for (let x = -240; x <= 240; x += 40) { g.beginPath(); g.moveTo(x, -180); g.lineTo(x, 180); g.stroke(); }
      for (let y = -180; y <= 180; y += 40) { g.beginPath(); g.moveTo(-240, y); g.lineTo(240, y); g.stroke(); }
      g.strokeStyle = 'rgba(0,0,0,.18)';
      g.beginPath(); g.moveTo(0, -180); g.lineTo(0, 180); g.moveTo(-240, 0); g.lineTo(240, 0); g.stroke();
    }
    g.beginPath(); g.rect(-240, -180, 480, 360); g.clip();
    for (const o of (this.scene && this.scene.objects) || []) {
      const { img, w: sw, h: sh } = this.spriteRect(o);
      g.save();
      g.translate(o.x, -o.y);
      if (o.rotationStyle !== "don't rotate") {
        const a = ((+o.direction || 90) - 90) * Math.PI / 180;
        if (o.rotationStyle === 'left-right') { if ((+o.direction || 90) < 0) g.scale(-1, 1); }
        else g.rotate(a);
      }
      g.globalAlpha = o.visible === false ? 0.35 : 1;
      if (img) g.drawImage(img, -sw / 2, -sh / 2, sw, sh);
      else { g.fillStyle = '#855cd6'; g.beginPath(); g.arc(0, 0, 30 * (+o.size || 100) / 100, 0, Math.PI * 2); g.fill(); }
      g.restore();
    }
    g.restore();
    // Sélection
    const sel = this.selected && ((this.scene && this.scene.objects) || []).find(o => o.id === this.selected);
    if (sel) {
      const { w: sw, h: sh } = this.spriteRect(sel);
      g.strokeStyle = '#ffa733'; g.lineWidth = 2;
      g.strokeRect(ox + (sel.x - sw / 2) * k, oy - (sel.y + sh / 2) * k, sw * k, sh * k);
      g.fillStyle = '#ffa733';
      g.font = '600 11px Segoe UI, sans-serif';
      g.fillText(`${sel.name}  x ${Math.round(sel.x)}  y ${Math.round(sel.y)}`, ox + (sel.x - sw / 2) * k, oy - (sel.y + sh / 2) * k - 6);
    }
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = '11px Segoe UI, sans-serif';
    g.fillText('480 × 360', ox - 240 * k, oy + 180 * k + 14);
  }

  bind() {
    const c = this.canvas;
    let drag = null;
    c.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      c.focus();
      const p = this.toStage(e.clientX, e.clientY);
      const o = this.hit(p.x, p.y);
      this.opts.onSelect(o ? o.id : null);
      if (o) {
        drag = { o, dx: p.x - o.x, dy: p.y - o.y, moved: false };
        c.setPointerCapture(e.pointerId);
      }
    });
    c.addEventListener('pointermove', e => {
      if (!drag) { const p = this.toStage(e.clientX, e.clientY); c.style.cursor = this.hit(p.x, p.y) ? 'move' : 'default'; return; }
      const p = this.toStage(e.clientX, e.clientY);
      if (!drag.moved) { this.opts.onBeforeChange(); drag.moved = true; }
      let x = p.x - drag.dx, y = p.y - drag.dy;
      if (e.ctrlKey) { x = Math.round(x / 10) * 10; y = Math.round(y / 10) * 10; }
      drag.o.x = Math.round(x); drag.o.y = Math.round(y);
      this.draw();
      this.opts.onLiveTransform && this.opts.onLiveTransform(drag.o);
    });
    c.addEventListener('pointerup', () => { if (drag && drag.moved) this.opts.onChange(drag.o); drag = null; });
    c.addEventListener('keydown', e => {
      const o = this.selected && this.scene.objects.find(x => x.id === this.selected);
      if (!o) return;
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (!d) return;
      e.preventDefault();
      this.opts.onBeforeChange();
      o.x += d[0]; o.y += d[1];
      this.draw();
      this.opts.onChange(o);
    });
    c.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/sc-asset')) { e.preventDefault(); this.el.classList.add('drop'); } });
    c.addEventListener('dragleave', () => this.el.classList.remove('drop'));
    c.addEventListener('drop', e => {
      this.el.classList.remove('drop');
      const rel = e.dataTransfer.getData('text/sc-asset');
      if (!rel) return;
      e.preventDefault();
      const p = this.toStage(e.clientX, e.clientY);
      const o = this.hit(p.x, p.y);
      this.opts.onDropAsset(rel, [Math.round(p.x), Math.round(p.y), 0], o ? o.id : null);
    });
  }
}
