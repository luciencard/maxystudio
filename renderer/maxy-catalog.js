// Listes communes au Dev Portal et aux pages de jeu : moteur, catégories, appareils, questionnaire d'âge.

/** Moteur accepté : MaxyStudio seulement. */
export const ENGINES = {
  maxystudio: {
    name: 'MaxyStudio', file: '.maxycode', accept: '.maxycode,.scratchcode',
    how: 'Dans MaxyStudio : Fichier, puis Exporter le projet. Tu obtiens un fichier .maxycode.'
  }
};

export const CATEGORIES = ['Action', 'Action-aventure', 'Aventure', 'Monde ouvert', 'Bac à sable', 'RPG', 'Combat', 'Tir', 'Course', 'Plateforme', 'Horreur', 'Stratégie', 'Puzzle', 'Réflexion', 'Simulation', 'Sport', 'Musique', 'Éducatif', 'Application', 'Autre'];

/** Formats des images : taille finale en pixels. */
export const DEVICES = {
  pc: { name: 'Ordinateur', w: 1280, h: 720, ratio: '16:9' },
  tablette: { name: 'Tablette', w: 1024, h: 768, ratio: '4:3' },
  telephone: { name: 'Téléphone', w: 720, h: 1280, ratio: '9:16' }
};

/**
 * Questionnaire d'âge, sur le modèle de ceux des magasins d'applications. Il donne l'âge conseillé : 3, 7, 12, 16 ou 18 ans.
 * Chaque réponse donne un âge minimum ; `refuse` : interdit sur MaxyGame quel que soit l'âge ; `tag` : mention affichée sur la page du jeu.
 */
export const AGE_QUESTIONS = [
  {
    id: 'violence', q: 'Y a-t-il de la violence dans ton jeu ?',
    a: [
      { t: 'Non, aucune', age: 3 },
      { t: 'Très légère et pas réaliste : on tire sur des robots, des monstres ou des objets, sans sang', age: 7, tag: 'Violence légère' },
      { t: 'Plus marquée : combats fréquents contre des créatures, ou personnages humains dessinés de façon pas réaliste', age: 12, tag: 'Violence' },
      { t: 'Réaliste : personnages humains blessés ou tués, avec un peu de sang', age: 16, tag: 'Violence réaliste' },
      { t: 'Très réaliste et intense : sang abondant, violence détaillée ou gratuite', age: 18, tag: 'Violence intense' }
    ]
  },
  {
    id: 'crime', q: 'Le joueur commet-il des délits (vols, voitures volées, fuites devant la police) ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Un peu, de façon comique ou pas réaliste', age: 12, tag: 'Petits délits' },
      { t: 'Oui, de façon réaliste', age: 16, tag: 'Délits' },
      { t: 'Oui, c\'est le cœur du jeu', age: 18, tag: 'Criminalité' }
    ]
  },
  {
    id: 'peur', q: 'Ton jeu peut-il faire peur ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Un peu : ambiance sombre, petits sursauts', age: 7, tag: 'Peut faire peur' },
      { t: 'Oui : monstres effrayants, sursauts répétés, ambiance d\'horreur', age: 12, tag: 'Horreur' },
      { t: 'Horreur intense, avec des scènes gore', age: 18, tag: 'Horreur intense' }
    ]
  },
  {
    id: 'langage', q: 'Quels mots utilise ton jeu ?',
    a: [
      { t: 'Que des mots polis', age: 3 },
      { t: 'Quelques moqueries légères (« nul », « idiot »)', age: 7, tag: 'Moqueries' },
      { t: 'Quelques gros mots', age: 12, tag: 'Gros mots' },
      { t: 'Beaucoup de grossièretés', age: 16, tag: 'Langage grossier' },
      { t: 'Des insultes haineuses contre un groupe de personnes', refuse: 'Les propos haineux ne sont pas acceptés, quel que soit l\'âge.' }
    ]
  },
  {
    id: 'substances', q: 'Voit-on de l\'alcool, du tabac ou de la drogue ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Oui, dans le décor ou l\'histoire', age: 16, tag: 'Alcool, tabac ou drogue' },
      { t: 'Oui, et le jeu en montre l\'usage de façon positive', age: 18, tag: 'Usage de drogue' }
    ]
  },
  {
    id: 'romance', q: 'Y a-t-il des scènes d\'amour ou de séduction ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Un peu : un bisou, des personnages amoureux', age: 7 },
      { t: 'Des allusions sexuelles, des tenues suggestives', age: 16, tag: 'Allusions sexuelles' },
      { t: 'De la nudité ou des scènes sexuelles', refuse: 'La nudité et les scènes sexuelles ne sont pas acceptées sur MaxyGame.' }
    ]
  },
  {
    id: 'hasard', q: 'Ton jeu imite-t-il des jeux d\'argent (casino, paris, machines à sous) ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Oui, avec de faux jetons seulement', age: 12, tag: 'Jeux de hasard simulés' },
      { t: 'Oui, et le casino est le cœur du jeu', age: 18, tag: 'Casino' },
      { t: 'Oui, avec de l\'argent réel', refuse: 'Les jeux d\'argent réels ne sont pas acceptés.' }
    ]
  },
  {
    id: 'perso', q: 'Ton jeu demande-t-il des informations personnelles (vrai nom, adresse, téléphone, photo) ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Oui', refuse: 'Un jeu ne doit pas demander d\'informations personnelles.' }
    ]
  },
  {
    id: 'echanges', q: 'Les joueurs peuvent-ils s\'écrire ou se parler dans ton jeu ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Oui', age: 3, tag: 'Les joueurs communiquent entre eux' }
    ]
  },
  {
    id: 'achats', q: 'Ton jeu affiche-t-il de la publicité ou des liens vers des achats ?',
    a: [
      { t: 'Non', age: 3 },
      { t: 'Oui', age: 3, tag: 'Publicités ou achats' }
    ]
  }
];

export const AGES = [3, 7, 12, 16, 18];

/** Calcule l'âge conseillé à partir des réponses ({ id: index }). */
export function computeAge(answers) {
  let age = 3;
  const tags = [], refused = [];
  for (const q of AGE_QUESTIONS) {
    const r = q.a[answers[q.id]];
    if (!r) return { complete: false, age, tags, refused };
    if (r.refuse) refused.push(r.refuse);
    if (r.age > age) age = r.age;
    if (r.tag) tags.push(r.tag);
  }
  return { complete: true, age, tags, refused };
}

export const AGE_TEXT = { 3: 'Pour tous', 7: 'Dès 7 ans', 12: 'Dès 12 ans', 16: 'Dès 16 ans', 18: 'Réservé aux adultes' };

/**
 * Repères pour s'y retrouver avec les classements connus (PEGI en Europe, ESRB en Amérique du Nord).
 * Ce sont des correspondances indicatives : le classement de MaxyGame n'est pas un classement officiel PEGI ou ESRB.
 */
export const RATING_EQUIV = {
  3: { pegi: 'PEGI 3', esrb: 'E (Everyone)' },
  7: { pegi: 'PEGI 7', esrb: 'E (Everyone)' },
  12: { pegi: 'PEGI 12', esrb: 'E10+ ou T (Teen)' },
  16: { pegi: 'PEGI 16', esrb: 'M (Mature 17+)' },
  18: { pegi: 'PEGI 18', esrb: 'M (Mature 17+)' }
};

/** Âge à partir duquel un jeu est caché aux visiteurs non connectés et aux joueurs trop jeunes. */
export const GATED_AGE = 16;

/** Liens vers d'autres pages du jeu. Les adresses sont vérifiées ici et par les règles Firestore (mêmes motifs). */
export const LINKS = {
  site: { name: 'Site officiel du jeu', hint: 'https://…', re: new RegExp('^https://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{4,290}$') },
  wiki: { name: 'Page wiki du jeu', hint: 'https://… (Fandom ou ton propre wiki)', re: new RegExp('^https://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{4,290}$') },
  don: { name: 'Faire un don', hint: 'PayPal.me, Ko-fi, Buy Me a Coffee, Patreon, Tipeee, Liberapay, GitHub Sponsors, Open Collective', re: new RegExp('^https://(www\\.)?(paypal\\.me|ko-fi\\.com|buymeacoffee\\.com|patreon\\.com|tipeee\\.com|liberapay\\.com|github\\.com/sponsors|opencollective\\.com)/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{1,200}$') },
  googleplay: { name: 'Google Play', hint: 'https://play.google.com/store/apps/details?id=…', re: new RegExp('^https://play\\.google\\.com/store/apps/details\\?id=[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{3,250}$') },
  appstore: { name: 'App Store', hint: 'https://apps.apple.com/…', re: new RegExp('^https://apps\\.apple\\.com/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{3,250}$') },
  steam: { name: 'Steam', hint: 'https://store.steampowered.com/app/…', re: new RegExp('^https://store\\.steampowered\\.com/app/[0-9]{1,10}[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{0,200}$') },
  itch: { name: 'itch.io', hint: 'https://ton-nom.itch.io/…', re: new RegExp('^https://[a-z0-9-]{1,63}\\.itch\\.io/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{0,200}$') },
  msstore: { name: 'Microsoft Store', hint: 'https://apps.microsoft.com/…', re: new RegExp('^https://apps\\.microsoft\\.com/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{3,250}$') },
  autre: { name: 'Autre boutique', hint: 'Epic Games, GOG, Nintendo, PlayStation ou Xbox', re: new RegExp('^https://(store\\.epicgames\\.com|www\\.gog\\.com|www\\.nintendo\\.com|store\\.playstation\\.com|www\\.xbox\\.com)/[A-Za-z0-9._~:/?#@!$&()*+,;=%-]{1,250}$') },
};
export const LANGUAGES = { fr: 'Français', en: 'English', es: 'Español', ar: 'العربية', pt: 'Português', de: 'Deutsch', it: 'Italiano', autre: 'Autre langue' };
export const PLAYERS = { solo: 'Solo', local: 'À plusieurs sur le même écran' };
export const PLAYTIME = { court: 'Moins de 5 minutes', moyen: '5 à 15 minutes', long: '15 minutes à 1 heure', tres: 'Plus d\'une heure' };
export const AI_USE = { non: 'Non', aide: 'Oui, pour m\'aider (idées, code, textes)', contenu: 'Oui, pour des images, des sons ou des musiques du jeu' };
/** Un texte de la fiche ne doit pas contenir d'adresse web : les liens vont dans la partie Liens. */
export const hasUrl = t => /https?:\/\/|www\./i.test(t || '');
/** Types de fichiers acceptés dans un projet MaxyStudio publié. */
export const ALLOWED_FILES = /\.(maxycode|scratchcode|scene|mc|sc|js|ts|prefab|anim|md|json|txt|ttf|otf|woff2?|png|jpe?g|gif|webp|svg|wav|mp3|ogg|m4a|glb|gltf|bin|obj|mtl|fbx|stl|ply|dae)$/i;
