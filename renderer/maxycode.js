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
// compileMaxyCode(source) renvoie { code, lines, errors } : le code Scratch, le numéro de ligne d'origine de chaque ligne
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
      const name = names.find(n => after.startsWith(n) && /^(\s*[([<]|\s*\))/.test(after.slice(n.length)));
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

export function compileMaxyCode(source) {
  const src = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const errors = [];
  // Première passe : les fonctions qui contiennent un « return »
  const returning = new Set();
  let current = null;
  src.forEach(raw => {
    const t = raw.trim();
    if (!t) { current = null; return; }
    const d = /^define!?\s+(.+)$/.exec(t);
    if (d) { current = signature(d[1]).name; return; }
    if (/^when /.test(t)) { current = null; return; }
    if (current && /^return(\s|$)/.test(t)) returning.add(current);
  });
  const names = [...returning].sort((a, b) => b.length - a.length);

  const out = [], lines = [];
  const emit = (text, line) => { out.push(text); lines.push(line); };
  let fn = null; // fonction en cours (qui renvoie une valeur) ou null
  let n = 0;
  src.forEach((raw, idx) => {
    const line = idx + 1;
    const indent = /^\s*/.exec(raw)[0];
    let t = raw.trim();
    if (!t) { fn = null; emit(raw, line); return; }
    // 1. Chapeaux de démarrage
    if (/^when app (run|starts)$/i.test(t)) { emit(indent + 'when flag clicked', line); fn = null; return; }
    const d = /^(define!?)\s+(.+)$/.exec(t);
    if (d) {
      const sig = signature(d[2]);
      fn = returning.has(sig.name) ? sig.name : null;
      // Une fonction qui renvoie une valeur s'exécute d'un coup (sinon un autre script pourrait toucher la pile entre-temps)
      emit(indent + (fn ? 'define! ' : d[1] + ' ') + d[2], line);
      return;
    }
    if (HAT.test(t)) { fn = null; emit(raw, line); return; }
    if (t.startsWith('//') || /^(end|else)$/.test(t)) { emit(raw, line); return; }

    const ret = /^return(?:\s+(.*))?$/.exec(t);
    if (ret && !fn) { errors.push({ line, message: '« return » s\'utilise seulement dans un bloc « define ».' }); emit(indent + '// ' + t, line); return; }

    const calls = [];
    const body = names.length ? extractCalls(ret ? (ret[1] || '[]') : t, names, calls) : (ret ? (ret[1] || '[]') : t);
    const loopHead = /^(repeat until|wait until|forever)\b/.test(t);
    if (calls.length && loopHead) {
      errors.push({ line, message: 'Une fonction qui renvoie une valeur ne peut pas être appelée dans « repeat until » ou « wait until » : range d\'abord son résultat dans une variable.' });
      emit(raw, line); return;
    }
    // Appels : chacun est exécuté, puis son résultat est posé sur la pile
    calls.forEach((c, k) => {
      emit(indent + `${c.name}${c.args ? ' ' + fill(c.args, k) : ''}`, line);
      emit(indent + `add (${retVar(c.name)}) to [${STACK} v]`, line);
    });
    const m = calls.length;
    const pops = () => { for (let k = 0; k < m; k++) emit(indent + `delete (length of [${STACK} v]) of [${STACK} v]`, line); };
    if (ret) {
      const val = fill(body, m).trim() || '[]';
      emit(indent + `set [${retVar(fn)} v] to ${/^[([<]/.test(val) ? val : `[${val}]`}`, line);
      pops();
      emit(indent + 'stop [this script v]', line);
      return;
    }
    if (!m) { emit(raw, line); return; }
    const filled = fill(body, m);
    const ifHead = /^if\s+(.*)\s+then$/.exec(filled);
    const repHead = /^repeat\s+(.*)$/.exec(filled);
    if (ifHead) {
      // La condition est évaluée avant de retirer les résultats de la pile, puis le « if » d'origine lit son résultat
      const v = `_si${++n}`;
      emit(indent + `set [${v} v] to (0)`, line);
      emit(indent + `if ${ifHead[1]} then`, line);
      emit(indent + `    set [${v} v] to (1)`, line);
      emit(indent + 'end', line);
      pops();
      emit(indent + `if <(${v}) = (1)> then`, line);
    } else if (repHead) {
      const v = `_rep${++n}`;
      emit(indent + `set [${v} v] to ${repHead[1]}`, line);
      pops();
      emit(indent + `repeat (${v})`, line);
    } else {
      emit(indent + filled, line);
      pops();
    }
  });
  return { code: out.join('\n'), lines, errors };
}

/** Ramène le numéro de ligne d'une erreur du compilateur au code d'origine. */
export function originalLine(result, line) {
  return result.lines[Math.max(0, Math.min(result.lines.length - 1, (line | 0) - 1))] || line;
}
