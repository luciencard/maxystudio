// Réseau des jeux MaxyStudio : salons en temps réel (discussion, multijoueur).
// Utilisé par les scripts JavaScript (Maxy.net) et par les blocs MaxyCode (extension Interface).
//
//   const salon = await Maxy.net.join('general');
//   salon.on('message', m => this.log(m.name + ' : ' + m.data));
//   salon.send('Salut !');            // gardé dans l'historique (100 derniers messages)
//   salon.live({ x: this.x });        // instantané, non gardé (positions d'un jeu multijoueur)
//
// Le jeu ne voit jamais le compte du joueur : la page qui lance le jeu lui donne un ticket valable
// seulement pour les salons de ce jeu (window.__maxyNetTicket).

const DEFAULT_SERVER = 'https://maxygame-mcp.scratchcode.workers.dev';
const ROOM_RE = /^[A-Za-z0-9_\-àâäéèêëïîôöùûüçÀÂÄÉÈÊËÏÎÔÖÙÛÜÇ ]{1,48}$/;
const BLOCK_KEY = 'maxy.net.bloques';

let ticketP = null, ticketExp = 0;
const rooms = new Map();
let blocked = new Set();
try { blocked = new Set(JSON.parse(localStorage.getItem(BLOCK_KEY) || '[]')); } catch { /* stockage indisponible */ }

function netError(message, code) { const e = new Error(message); e.code = code; return e; }

async function ticket(force = false) {
  if (!force && ticketP && Date.now() < ticketExp) return ticketP;
  const get = window.__maxyNetTicket;
  if (typeof get !== 'function') throw netError('Le jeu en ligne n\'est pas disponible ici. Il marche dans MaxyStudio et sur MaxyGame.', 'unavailable');
  ticketP = Promise.resolve(get()).then(t => {
    if (!t || !t.ticket) throw netError((t && t.error) || 'Connexion au jeu en ligne impossible.', t && t.code);
    ticketExp = Date.now() + Math.max(60, (t.expiresIn || 3600) - 300) * 1000;
    return { ...t, server: t.server || DEFAULT_SERVER };
  });
  ticketP.catch(() => { ticketP = null; });
  return ticketP;
}

class Room {
  constructor(name) {
    this.name = name;
    this.me = null;
    this.members = [];
    this.history = [];
    this.connected = false;
    this.left = false;
    this.handlers = {};
    this.retry = 0;
    this.ready = this.open();
  }
  /** Écouter un évènement : message, live, join, leave, deleted, error, connect, disconnect. */
  on(event, fn) { (this.handlers[event] = this.handlers[event] || []).push(fn); return this; }
  off(event, fn) { this.handlers[event] = (this.handlers[event] || []).filter(f => f !== fn); return this; }
  emit(event, value) {
    for (const fn of this.handlers[event] || []) { try { fn(value); } catch (e) { console.error(e); } }
    if (Room.hook) Room.hook(this, event, value);
  }
  async open() {
    const t = await ticket(this.retry > 0);
    this.me = t.me || this.me;
    const url = `${t.server.replace(/^http/, 'ws')}/net/room?ticket=${encodeURIComponent(t.ticket)}&room=${encodeURIComponent(this.name)}`;
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let hello = false;
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'hello') {
          hello = true; this.connected = true; this.retry = 0;
          this.me = m.me; this.members = m.members || [];
          this.history = (m.history || []).filter(x => !blocked.has(x.uid)).map(x => this.wrap(x));
          this.emit('connect', this);
          resolve(this);
        } else if (m.t === 'msg') {
          if (blocked.has(m.msg.uid)) return;
          const msg = this.wrap(m.msg);
          this.history.push(msg);
          if (this.history.length > 100) this.history.shift();
          this.emit('message', msg);
        } else if (m.t === 'live') {
          if (!blocked.has(m.msg.uid)) this.emit('live', this.wrap(m.msg));
        } else if (m.t === 'join') {
          if (!this.members.some(u => u.uid === m.user.uid)) this.members.push(m.user);
          this.emit('join', m.user);
        } else if (m.t === 'leave') {
          this.members = this.members.filter(u => u.uid !== m.user.uid);
          this.emit('leave', m.user);
        } else if (m.t === 'deleted') {
          this.history = this.history.filter(x => x.id !== m.id);
          this.emit('deleted', m.id);
        } else if (m.t === 'error') {
          this.emit('error', m.text);
        }
      };
      ws.onclose = () => {
        const was = this.connected;
        this.connected = false;
        if (!hello) { reject(netError('Connexion au salon impossible. Vérifie ta connexion Internet.', 'offline')); }
        if (was) this.emit('disconnect', this);
        if (!this.left && hello) {
          // Reconnexion automatique (1 s, 2 s, 4 s... 30 s au plus)
          const delay = Math.min(30000, 1000 * 2 ** this.retry++);
          setTimeout(() => { if (!this.left) this.ready = this.open().catch(() => {}); }, delay);
        }
      };
    });
  }
  wrap(m) { return { id: m.id, uid: m.uid, name: m.name, time: m.time, data: m.data, mine: !!(this.me && m.uid === this.me.uid) }; }
  raw(obj) {
    if (!this.ws || this.ws.readyState !== 1) throw netError(`Pas connecté au salon « ${this.name} ».`, 'offline');
    this.ws.send(JSON.stringify(obj));
  }
  /** Message gardé dans l'historique du salon (discussion). */
  send(data) { this.raw({ t: 'send', data }); }
  /** Message instantané, non gardé (positions, actions d'un jeu multijoueur). */
  live(data) { this.raw({ t: 'live', data }); }
  /** Signale un message à la modération de MaxyGame. */
  report(id, reason = '') { this.raw({ t: 'report', id, reason: String(reason).slice(0, 300) }); }
  /** Supprime un de ses propres messages. */
  remove(id) { this.raw({ t: 'delete', id }); }
  leave() {
    this.left = true; this.connected = false;
    try { this.ws && this.ws.close(1000); } catch { /* déjà fermé */ }
    rooms.delete(this.name);
  }
}

export const net = {
  /** Entre dans un salon (le crée s'il n'existe pas). Le même nom donne le même salon pour tous les joueurs du jeu. */
  async join(name) {
    name = String(name || '').trim();
    if (!ROOM_RE.test(name)) throw netError('Nom de salon invalide : 48 caractères au plus (lettres, chiffres, espaces, - et _).', 'room');
    let r = rooms.get(name);
    if (!r) { r = new Room(name); rooms.set(name, r); r.ready.catch(() => rooms.delete(name)); }
    await r.ready;
    return r;
  },
  /** Salon déjà rejoint (ou null). */
  room(name) { return rooms.get(String(name || '').trim()) || null; },
  leave(name) { const r = rooms.get(String(name || '').trim()); if (r) r.leave(); },
  /** Le joueur connecté : { uid, name }. */
  async me() { const t = await ticket(); return t.me; },
  /** Bloquer un joueur : ses messages ne s'affichent plus (sur cet appareil). */
  block(uid) { blocked.add(String(uid)); save(); for (const r of rooms.values()) r.history = r.history.filter(m => m.uid !== uid); },
  unblock(uid) { blocked.delete(String(uid)); save(); },
  blocked: () => [...blocked],
  /** Code au hasard pour un salon privé (à partager avec ses amis). */
  code(length = 8) { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint8Array(length))].map(x => c[x % c.length]).join(''); },
  closeAll() { for (const r of [...rooms.values()]) r.leave(); },
  set hook(fn) { Room.hook = fn; }
};
function save() { try { localStorage.setItem(BLOCK_KEY, JSON.stringify([...blocked])); } catch { /* stockage indisponible */ } }
window.__maxyNet = net;
