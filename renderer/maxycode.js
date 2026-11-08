// MaxyCode : ce qu'ajoute MaxyStudio au code Scratch écrit en texte, traduit en blocs Scratch ordinaires avant la compilation.
//
// 1. « when app run » et « when app starts » : le drapeau vert.
// 2. Fonctions qui renvoient une valeur :
//
//      define carre (n)
//      return ((n) * (n))
//
//      when app run
//      say (carre (5))
//
//    « return » range le résultat dans une variable propre à la fonction, puis quitte le bloc (stop [this script v]).
//    Un appel dans une expression, comme (carre (5)), est exécuté juste avant la ligne ; son résultat est posé sur une pile
//    (la liste _pile), que la ligne lit, puis retire. La pile rend la récursion possible (une fonction qui s'appelle elle-même).
//    Une fonction qui renvoie une valeur est exécutée sans rafraîchir l'écran (define!) : elle ne doit pas contenir de wait.
//
// 3. Modules : « import [scripts/outils.sc] » ou « import [maths] » (bibliothèque standard : maths, texte, hasard).
//
// compileMaxyCode(source, { resolve }) renvoie { code, lines, origins, errors } : le code Scratch, le numéro de ligne d'origine de chaque ligne
// produite (pour afficher les erreurs du compilateur au bon endroit), et les erreurs propres à MaxyCode.

const HAT = /^(when |define!? )/;
const STACK = '_pile';
const ref = depth => depth === 0
  ? `(item (length of [${STACK} v]) of [${STACK} v])`
  : `(item ((length of [${STACK} v]) - (${depth})) of [${STACK} v])`;
const retVar = name => '_ret_' + name.trim().replace(/[^\p{L}\p{N}]+/gu, '_');

/** Nom et paramètres d'une ligne « define nom (a) (b) ». */
function signature(rest) {
  const i = rest.search(/[([<]/);
  const name = (i < 0 ? rest : rest.slice(0, i)).trim();
  return { name, params: i < 0 ? '' : rest.slice(i).trim() };
}

/** Position de la parenthèse fermante qui correspond à celle ouverte en `start` (les textes [ ... ] sont ignorés). */
function closeParen(s, start) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === '[') { const j = s.indexOf(']', i + 1); if (j < 0) return -1; i = j; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/**
 * Remplace, dans une expression, chaque appel à une fonction qui renvoie une valeur par un repère \u0001k\u0001,
 * et enregistre les appels dans `calls` (les appels intérieurs d'abord : c'est l'ordre d'exécution).
 */
function extractCalls(expr, names, calls) {
  let out = '';
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === '[') { const j = expr.indexOf(']', i + 1); if (j < 0) { out += expr.slice(i); break; } out += expr.slice(i, j + 1); i = j; continue; }
    if (c === '(') {
      const after = expr.slice(i + 1);
      // Un appel : (nom (args)…) si la fonction a des paramètres, (nom) si elle n'en a pas
      const hit = names.find(({ n, arity }) => after.startsWith(n) && (arity ? /^\s+[([<]/ : /^\s*\)/).test(after.slice(n.length)));
      const name = hit && hit.n;
      if (name) {
        const end = closeParen(expr, i);
        if (end > 0) {
          const args = extractCalls(expr.slice(i + 1 + name.length, end), names, calls).trim();
          calls.push({ name, args });
          out += `\u0001${calls.length - 1}\u0001`;
          i = end;
          continue;
        }
      }
    }
    out += c;
  }
  return out;
}

/** Remplace les repères par la lecture de la pile, sachant que `pushed` résultats y ont été posés pour cette ligne. */
const fill = (s, pushed) => s.replace(/\u0001(\d+)\u0001/g, (_, k) => ref(pushed - 1 - +k));

// ---------------------------------------------------------------- modules
// « import [scripts/outils.sc] » ajoute au script les fonctions (define) d'un autre script du projet ;
// « import [maths] » celles de la bibliothèque standard ci-dessous. Une fonction déjà définie dans le script est gardée.

/** Bibliothèque standard de MaxyCode : des fonctions prêtes à importer. */
export const STDLIB = {
  maths: `define max (a) (b)
if <(a) > (b)> then
    return (a)
end
return (b)

define min (a) (b)
if <(a) < (b)> then
    return (a)
end
return (b)

define borne (x) (bas) (haut)
if <(x) < (bas)> then
    return (bas)
end
if <(x) > (haut)> then
    return (haut)
end
return (x)

define distance (x1) (y1) (x2) (y2)
return ([sqrt v] of ((((x2) - (x1)) * ((x2) - (x1))) + (((y2) - (y1)) * ((y2) - (y1)))))

define interpoler (a) (b) (t)
return ((a) + (((b) - (a)) * (t)))

define signe (x)
if <(x) > (0)> then
    return (1)
end
if <(x) < (0)> then
    return (-1)
end
return (0)

define arrondir (x) (chiffres)
return ((round ((x) * ([10 ^ v] of (chiffres)))) / ([10 ^ v] of (chiffres)))

define pourcentage (part) (total)
return (((part) / (total)) * (100))`,
  texte: `define repeter (texte) (fois)
set [_txt v] to []
repeat (fois)
    set [_txt v] to (join (_txt) (texte))
end
return (_txt)

define inverser (texte)
set [_txt v] to []
set [_i v] to (length of (texte))
repeat (length of (texte))
    set [_txt v] to (join (_txt) (letter (_i) of (texte)))
    change [_i v] by (-1)
end
return (_txt)

define majuscule initiale (texte)
return (join (letter (1) of (texte)) [])`,
  hasard: `define pile ou face
return (pick random (0) to (1))

define chance (pourcent)
if <(pick random (1) to (100)) < ((pourcent) + (1))> then
    return (1)
end
return (0)`
};

/** Noms des modules importés par un code : import [nom] (un par ligne). */
export function findImports(text) {
  return [...String(text || '').matchAll(/^\s*import\s+\[([^\]]+)\]\s*$/gm)].map(m => m[1].trim());
}

/** Blocs « define » d'un code (chaque bloc va jusqu'à la ligne vide ou au chapeau suivant), avec leur ligne de départ. */
function defineBlocks(lines) {
  const blocks = [];
  let cur = null;
  lines.forEach((raw, i) => {
    const t = raw.trim();
    if (/^define!?\s/.test(t)) { cur = { name: signature(t.replace(/^define!?\s+/, '')).name, start: i, lines: [raw] }; blocks.push(cur); return; }
    if (!t || /^when /.test(t)) { cur = null; return; }
    if (cur) cur.lines.push(raw);
  });
  return blocks;
}

/**
 * Remplace les lignes « import » par un commentaire et ajoute à la fin les fonctions des modules.
 * Chaque ligne garde son origine : { line } dans le script, ou { line: ligne de l'import, from: 'module, ligne N' }.
 */
function expandImports(src, resolve, errors) {
  const out = src.map((raw, i) => ({ raw, line: i + 1, from: null }));
  const defined = new Set(defineBlocks(src).map(b => b.name));
  const seen = new Set();
  const visit = (name, importLine, chain) => {
    if (chain.includes(name)) { errors.push({ line: importLine, message: `Import en boucle : ${[...chain, name].join(' → ')}.` }); return; }
    if (seen.has(name)) return;
    seen.add(name);
    const text = STDLIB[name] != null ? STDLIB[name] : resolve ? resolve(name) : null;
    if (text == null) { errors.push({ line: importLine, message: `Module introuvable : « ${name} ». Indique un script du projet (scripts/outils.sc) ou un module de la bibliothèque : ${Object.keys(STDLIB).join(', ')}.` }); return; }
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
    for (const sub of findImports(text)) visit(sub, importLine, [...chain, name]);
    for (const b of defineBlocks(lines)) {
      if (defined.has(b.name)) continue;
      defined.add(b.name);
      out.push({ raw: '', line: importLine, from: null });
      b.lines.forEach((raw, k) => out.push({ raw, line: importLine, from: `${name}, ligne ${b.start + k + 1}` }));
    }
  };
  src.forEach((raw, i) => {
    const m = /^(\s*)import\s+\[([^\]]+)\]\s*$/.exec(raw);
    if (!m) return;
    out[i].raw = `${m[1]}// import [${m[2]}]`;
    visit(m[2].trim(), i + 1, []);
  });
  return out;
}

/**
 * Traduit du MaxyCode en code Scratch. `options.resolve(nom)` renvoie le texte d'un script du projet importé (ou null).
 * `options.debug` (chemin du script) : ajoute un point de contrôle « debug line » avant chaque instruction, pour le débogueur.
 * Renvoie { code, lines, origins, errors } : lines[i] = ligne d'origine de la ligne produite i, origins[i] = module d'où elle vient.
 */
export function compileMaxyCode(source, options = {}) {
  const errors = [];
  const base = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const src = expandImports(base, options.resolve, errors);
  // Première passe : les fonctions qui contiennent un « return », et leur nombre de paramètres
  const returning = new Map();
  let current = null;
  src.forEach(({ raw }) => {
    const t = raw.trim();
    if (!t) { current = null; return; }
    const d = /^define!?\s+(.+)$/.exec(t);
    if (d) { current = signature(d[1]); return; }
    if (/^when /.test(t)) { current = null; return; }
    if (current && /^return(\s|$)/.test(t)) returning.set(current.name, (current.params.match(/[([<][^)\]>]*[)\]>]/g) || []).length);
  });
  const names = [...returning.keys()].sort((a, b) => b.length - a.length).map(n => ({ n, arity: returning.get(n) }));

  const out = [], lines = [], origins = [];
  let fn = null; // fonction en cours (qui renvoie une valeur) ou null
  let n = 0;
  src.forEach(({ raw, line, from }) => {
    const emit = text => { out.push(text); lines.push(line); origins.push(from); };
    const err = message => errors.push({ line, message: from ? `[${from}] ${message}` : message });
    const indent = /^\s*/.exec(raw)[0];
    const t = raw.trim();
    if (!t) { fn = null; emit(raw); return; }
    if (/^when app (run|starts)$/i.test(t)) { emit(indent + 'when flag clicked'); fn = null; return; }
    const d = /^(define!?)\s+(.+)$/.exec(t);
    if (d) {
      const sig = signature(d[2]);
      fn = returning.has(sig.name) ? sig.name : null;
      // Une fonction qui renvoie une valeur s'exécute d'un coup (sinon un autre script pourrait toucher la pile entre-temps)
      emit(indent + (fn ? 'define! ' : d[1] + ' ') + d[2]);
      return;
    }
    if (HAT.test(t)) { fn = null; emit(raw); return; }
    if (t.startsWith('//') || /^(end|else)$/.test(t)) { emit(raw); return; }
    // Mode débogage : un point de contrôle avant chaque instruction du script (pas dans le code des modules)
    if (options.debug && !from && !/^import\s/.test(t)) emit(indent + `debug line [${options.debug}:${line}]`);

    const ret = /^return(?:\s+(.*))?$/.exec(t);
    if (ret && !fn) { err('« return » s\'utilise seulement dans un bloc « define ».'); emit(indent + '// ' + t); return; }

    const calls = [];
    const text = ret ? (ret[1] || '[]') : t;
    const body = names.length ? extractCalls(text, names, calls) : text;
    if (calls.length && /^(repeat until|wait until|forever)\b/.test(t)) {
      err('Une fonction qui renvoie une valeur ne peut pas être appelée dans « repeat until » ou « wait until » : range d\'abord son résultat dans une variable.');
      emit(raw); return;
    }
    // Appels : chacun est exécuté, puis son résultat est posé sur la pile
    calls.forEach((c, k) => {
      emit(indent + `${c.name}${c.args ? ' ' + fill(c.args, k) : ''}`);
      emit(indent + `add (${retVar(c.name)}) to [${STACK} v]`);
    });
    const m = calls.length;
    const pops = () => { for (let k = 0; k < m; k++) emit(indent + `delete (length of [${STACK} v]) of [${STACK} v]`); };
    if (ret) {
      const val = fill(body, m).trim() || '[]';
      if (val.startsWith('<')) {
        // Une condition renvoie 1 (vrai) ou 0 (faux)
        emit(indent + `set [${retVar(fn)} v] to (0)`);
        emit(indent + `if ${val} then`);
        emit(indent + `    set [${retVar(fn)} v] to (1)`);
        emit(indent + 'end');
      } else emit(indent + `set [${retVar(fn)} v] to ${/^[([]/.test(val) ? val : `[${val}]`}`);
      pops();
      emit(indent + 'stop [this script v]');
      return;
    }
    if (!m) { emit(raw); return; }
    const filled = fill(body, m);
    const ifHead = /^if\s+(.*)\s+then$/.exec(filled);
    const repHead = /^repeat\s+(.*)$/.exec(filled);
    if (ifHead) {
      // La condition est évaluée avant de retirer les résultats de la pile, puis le « if » d'origine lit son résultat
      const v = `_si${++n}`;
      emit(indent + `set [${v} v] to (0)`);
      emit(indent + `if ${ifHead[1]} then`);
      emit(indent + `    set [${v} v] to (1)`);
      emit(indent + 'end');
      pops();
      emit(indent + `if <(${v}) = (1)> then`);
    } else if (repHead) {
      const v = `_rep${++n}`;
      emit(indent + `set [${v} v] to ${repHead[1]}`);
      pops();
      emit(indent + `repeat (${v})`);
    } else {
      emit(indent + filled);
      pops();
    }
  });
  return { code: out.join('\n'), lines, origins, errors };
}

const at = (result, line) => Math.max(0, Math.min(result.lines.length - 1, (line | 0) - 1));
/** Ramène le numéro de ligne d'une erreur du compilateur au code d'origine. */
export function originalLine(result, line) {
  return result.lines[at(result, line)] || line;
}
/** Module d'où vient une ligne produite (« maths, ligne 3 »), ou null si elle vient du script lui-même. */
export function originOf(result, line) {
  return result.origins ? result.origins[at(result, line)] || null : null;
}
