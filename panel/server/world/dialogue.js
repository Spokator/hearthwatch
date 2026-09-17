// Dialogue : reconnaissance des intentions (mécanique fiable), prompts de rôle pour l'IA, répliques de secours.
import { affinityWords, FACTIONS, WORLD_BIBLE } from './lore.js';
import { mood, recall } from './mind.js';
import { ACTIVITY_WORDS } from './schedule.js';
import { fold, pick } from './util.js';

// ---------- Intentions ----------

const INSULTS = ['idiot', 'imbecile', 'cretin', 'abruti', 'connard', 'connasse', 'debile', 'nain puant', 'minable', 'ta gueule', 'ferme-la', 'stupide', 'moche', 'loser', 'nul', 'stupid', 'moron', 'shut up', 'ugly', 'dumb'];
const COMPLIMENTS = ['merci', 'bravo', 'magnifique', 'beau travail', 'genial', 'formidable', 'tu es fort', 'tu es belle', 'tu es beau', 'excellent', 'thank', 'great job', 'awesome', 'impressionnant', 'respect'];

export function intentsOf(text) {
  const t = fold(text);
  const number = (t.match(/\b(\d{1,2})\b/) || [])[1];
  const has = (re) => re.test(t);
  return {
    number: number ? Number(number) : null,
    accept: has(/\b(j'?accepte|j accepte|d'?accord|ok|je (le |la )?prends|marche conclu|ca marche|volontiers|accept|i'?ll take|deal)\b/),
    contracts: has(/\b(travail|boulot|contrat|quete|mission|besoin d'?aide|aider|job|work|quest|tache)\b/),
    turnIn: has(/\b(c'?est fait|j'?ai fini|termine|voici|voila|j'?ai (tue|rapporte|apporte|depose|ramene)|rendre|mission accomplie|done|finished|here you go)\b/),
    buy: has(/\b(acheter|j'?achete|je voudrais|je veux|vends[- ]moi|donne[- ]moi|buy|i want)\b/),
    sell: has(/\b(je (te )?vends|vendre|rachete|rachat|sell)\b/),
    prices: has(/\b(prix|tarif|que vends|qu'?as[- ]tu a vendre|combien|price|what do you sell|boutique|marchandise)\b/),
    gift: has(/\b(cadeau|pour toi|je t'?offre|gift|for you)\b/),
    rumor: has(/\b(rumeur|nouvelle|quoi de neuf|ragot|potin|news|rumou?r)\b/),
    farewell: has(/\b(au revoir|adieu|a plus|a bientot|bye|farewell|salut a toi)\b/),
    greet: has(/^(salut|bonjour|bonsoir|hello|hey|coucou|yo|hail|salutations)\b/),
    insult: INSULTS.some((w) => t.includes(w)),
    compliment: COMPLIMENTS.some((w) => t.includes(w)),
    whoAreYou: has(/\b(qui es[- ]tu|tu es qui|presente[- ]toi|ton nom|who are you)\b/),
  };
}

// L'habitant à qui s'adresse un message : nommé en tête (« Bjorn, … »), ou déjà en conversation, ou le plus proche.
export function addressee(text, player, npcs, conversations) {
  const t = fold(text);
  const near = npcs
    .filter((n) => n.position)
    .map((n) => ({ npc: n, d: Math.hypot(n.position.x - player.x, n.position.z - player.z) }))
    .sort((a, b) => a.d - b.d);
  for (const { npc, d } of near) {
    const first = fold(npc.name.split(' ')[0]);
    if (d < 30 && (t.startsWith(first) || t.includes(`@${first}`) || new RegExp(`\\b${first}\\b[,:!?]`).test(t))) return npc;
  }
  const current = conversations.get(player.account);
  if (current && Date.now() - current.t < 90000) {
    const hit = near.find((n) => n.npc.key === current.npc && n.d < 12);
    if (hit) return hit.npc;
  }
  if (near.length && near[0].d < 5.5) return near[0].npc;
  return null;
}

// ---------- Prompts ----------

// Le prompt système est découpé en deux : une partie commune à tous les habitants (règles et monde), identique
// d'un appel à l'autre, puis la fiche du personnage. Ollama réutilise le calcul du plus long préfixe commun : sur
// processeur, seule la fiche et le contexte du moment sont relus à chaque réplique.
export function sharedPrompt(lang = 'fr') {
  const fr = lang !== 'en';
  return [
    fr
      ? `Tu joues un habitant de Spokaheim dans un jeu de rôle viking. Tu n'es pas une IA : ne sors jamais du rôle, n'évoque jamais le monde moderne, les jeux vidéo ou l'IA.`
      : `You play an inhabitant of Spokaheim in a viking role-play. You are not an AI: never break character, never mention the modern world, video games or AI.`,
    fr
      ? `Règles : réponds en français, en 1 à 3 phrases courtes (moins de 45 mots), avec ton caractère et ton humeur du moment. Tu peux refuser, te fâcher, plaisanter, poser une question. N'invente ni récompense, ni prix, ni quête : les faits mécaniques te sont donnés. Réponds en JSON : {"say": "ta réplique", "emotion": "joie|tristesse|colere|peur|fierte|gratitude|surprise|degout|neutre", "affinity": entier de -5 à 5 (ce que tu penses de l'interlocuteur après ce message), "remember": "fait important appris sur l'interlocuteur, ou chaîne vide"}`
      : `Rules: answer in English, 1 to 3 short sentences (under 45 words), in character and in your current mood. You may refuse, get angry, joke, ask a question. Never invent rewards, prices or quests: mechanical facts are given to you. Answer in JSON: {"say": "your line", "emotion": "joy|sadness|anger|fear|pride|gratitude|surprise|disgust|neutral", "affinity": integer -5..5, "remember": "important fact learned about the speaker, or empty string"}`,
    `${fr ? 'Monde' : 'World'} : ${WORLD_BIBLE[fr ? 'fr' : 'en']}`,
  ].join('\n');
}

// Le secret n'est confié au modèle que pour un confident : un petit modèle qui le connaît finit toujours par le dire.
export function personaPrompt(npc, lang = 'fr', { intimate = false } = {}) {
  const fr = lang !== 'en';
  const relations = (npc.relations_def || []).map((r) => `${r.name} (${r.type} : ${r.note})`).join(' ; ');
  return [
    `${fr ? 'Ton personnage' : 'Your character'} : ${npc.name}, ${npc.title[fr ? 'fr' : 'en']}, ${npc.gender === 'f' ? (fr ? 'femme' : 'woman') : fr ? 'homme' : 'man'} dvergr, ${npc.age} ${fr ? 'ans' : 'years old'}. ${npc.story}`,
    `${fr ? 'Caractère' : 'Personality'} : ${traitWords(npc.traits, lang)}. ${fr ? 'Façon de parler' : 'Speech'} : ${npc.speech}.`,
    `${fr ? 'Ce que tu veux' : 'Wants'} : ${npc.wants}. ${fr ? 'Aimes' : 'Likes'} : ${npc.likes.join(', ')}. ${fr ? "N'aimes pas" : 'Dislikes'} : ${npc.dislikes.join(', ')}.`,
    relations ? `${fr ? 'Tes proches' : 'Your people'} : ${relations}.` : '',
    intimate ? `${fr ? 'Ton secret (tu peux y faire allusion, cet interlocuteur est un confident)' : 'Your secret (you may hint at it, this speaker is a confidant)'} : ${npc.secret}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function systemPrompt(npc, lang = 'fr', options = {}) {
  return `${sharedPrompt(lang)}\n\n${personaPrompt(npc, lang, options)}`;
}

function traitWords(t = {}, lang) {
  const fr = lang !== 'en';
  const words = [];
  if (t.o > 0.7) words.push(fr ? 'curieux, imaginatif' : 'curious, imaginative');
  if (t.o < 0.3) words.push(fr ? 'traditionnel' : 'traditional');
  if (t.c > 0.7) words.push(fr ? 'rigoureux' : 'rigorous');
  if (t.c < 0.3) words.push(fr ? 'désinvolte' : 'careless');
  if (t.e > 0.7) words.push(fr ? 'expansif, bavard' : 'outgoing, talkative');
  if (t.e < 0.3) words.push(fr ? 'réservé, peu bavard' : 'reserved, quiet');
  if (t.a > 0.7) words.push(fr ? 'bienveillant' : 'kind');
  if (t.a < 0.35) words.push(fr ? 'rugueux, peu conciliant' : 'blunt, disagreeable');
  if (t.n > 0.65) words.push(fr ? 'anxieux, susceptible' : 'anxious, touchy');
  if (t.n < 0.25) words.push(fr ? 'imperturbable' : 'unflappable');
  return words.join(', ') || (fr ? 'équilibré' : 'balanced');
}

// Contexte du moment : heure, activité, humeur, relation, souvenirs, faits mécaniques du tour, nouvelles.
export function contextPrompt({ npc, player, rel, clock, facts, news, offers, activeQuests, lang = 'fr', renownTitle, city = null }) {
  const fr = lang !== 'en';
  const m = mood(npc, lang);
  const memories = recall(npc, player.account, 4).map((x) => `- ${x.text}`).join('\n');
  const lines = [
    `${fr ? 'Maintenant' : 'Now'} : ${clock.label}, ${fr ? 'tu' : 'you are'} ${ACTIVITY_WORDS[npc.mind.activity]?.[fr ? 'fr' : 'en'] || ''}.`,
    `${fr ? 'Ton humeur' : 'Your mood'} : ${m.label}${m.cause ? ` (${m.cause})` : ''}. ${needsWords(npc, lang)}`,
    `${fr ? 'Interlocuteur' : 'Speaker'} : ${player.name}, ${renownTitle}. ${fr ? 'Tu es' : 'You are'} ${affinityWords(rel.affinity, lang)} ${fr ? 'envers lui' : 'towards them'} (${rel.talks} ${fr ? 'conversations' : 'talks'}).${rel.facts.length ? ` ${fr ? 'Tu sais de lui' : 'You know'} : ${rel.facts.join(' ; ')}.` : ''}${player.wanted ? (fr ? ' Il est recherché par la garde pour un crime !' : ' Wanted by the guard for a crime!') : ''}`,
    memories ? `${fr ? 'Tes souvenirs' : 'Memories'} :\n${memories}` : '',
    city ? `${fr ? 'La cité en ce moment' : 'The city right now'} : ${city}` : '',
    news?.length ? `${fr ? 'Nouvelles de la ville' : 'City news'} : ${news.join(' ; ')}` : '',
    offers?.length ? `${fr ? 'Travail que tu proposes' : 'Work you offer'} : ${offers.map((o, i) => `${i + 1}) ${o.title}`).join(' ; ')}` : '',
    activeQuests?.length ? `${fr ? 'Ses tâches pour toi' : 'Their tasks for you'} : ${activeQuests.join(' ; ')}` : '',
    facts?.length ? `${fr ? 'Ce qui vient de se passer (à évoquer)' : 'What just happened (mention it)'} : ${facts.join(' ; ')}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function needsWords(npc, lang) {
  const fr = lang !== 'en';
  const n = npc.mind.needs;
  const out = [];
  if (n.energy < 0.25) out.push(fr ? 'tu es épuisé' : 'you are exhausted');
  if (n.hunger < 0.25) out.push(fr ? 'tu as faim' : 'you are hungry');
  if (n.social < 0.2) out.push(fr ? 'tu te sens seul' : 'you feel lonely');
  return out.length ? `${out.join(', ')}.` : '';
}

// ---------- Répliques de secours (sans IA, ou en attendant) ----------

const THINKING = {
  fr: ['*réfléchit*', 'Hmm…', '*se gratte la barbe*', 'Voyons…', '*pose ses outils*', 'Attends un peu…'],
  en: ['*thinks*', 'Hmm…', '*scratches beard*', 'Let me see…', '*puts tools down*', 'Wait a moment…'],
};

export function thinkingLine(lang = 'fr') {
  return pick(THINKING[lang === 'en' ? 'en' : 'fr']);
}

const LINES = {
  fr: {
    greetHappy: ['Salut à toi, {player} ! Belle journée, pas vrai ?', 'Ah, {player} ! Content de te voir.', 'Bienvenue, voyageur ! Que puis-je pour toi ?'],
    greetNeutral: ['Salut, {player}.', 'Oui ?', 'Je t’écoute.', 'Qu’est-ce qui t’amène ?'],
    greetSad: ['*soupire* Bonjour…', 'Pas aujourd’hui le cœur à rire, {player}.', 'Mm. Bonjour.'],
    greetAngry: ['Quoi encore ?', 'Fais vite, je n’ai pas le temps.', 'Tu tombes mal.'],
    greetTired: ['*bâille* Je suis crevé…', 'On parlera quand j’aurai dormi.'],
    who: ['Je suis {name}, {title}. Tout Spokaheim me connaît.', '{name}, {title}. Et toi, qui es-tu ?'],
    insult: ['Répète ça et tu vas le regretter !', 'Surveille ta langue, étranger.', '*crache par terre* Va-t’en.'],
    compliment: ['Ha ! Ça fait plaisir à entendre.', 'Merci, {player}. Les dieux te le rendront.', '*rougit sous la barbe*'],
    farewell: ['Que les dieux te gardent, {player}.', 'À la prochaine.', 'Bonne route.'],
    noWork: ['Je n’ai rien pour toi aujourd’hui. Repasse demain.', 'Pas de travail pour l’instant.'],
    rumorNone: ['Rien de neuf sous le toit de Spokaheim.', 'Les rumeurs dorment aujourd’hui.'],
    default: ['Mm. Intéressant.', 'Si tu le dis.', 'Ha ! Voilà qui se discute à la brasserie.', 'Je ne suis pas sûr de te suivre, {player}.', 'Parle plus clairement, veux-tu ?'],
  },
  en: {
    greetHappy: ['Hail, {player}! Fine day, isn’t it?', 'Ah, {player}! Good to see you.', 'Welcome, traveller! What can I do for you?'],
    greetNeutral: ['Hail, {player}.', 'Yes?', 'I’m listening.', 'What brings you here?'],
    greetSad: ['*sighs* Hello…', 'Not much to smile about today, {player}.', 'Mm. Hello.'],
    greetAngry: ['What now?', 'Make it quick.', 'Bad timing.'],
    greetTired: ['*yawns* I’m exhausted…', 'Let’s talk when I’ve slept.'],
    who: ['I am {name}, {title}. All Spokaheim knows me.', '{name}, {title}. And who are you?'],
    insult: ['Say that again and you’ll regret it!', 'Watch your tongue, stranger.', '*spits* Get lost.'],
    compliment: ['Ha! Good to hear.', 'Thank you, {player}. The gods will repay you.', '*blushes under the beard*'],
    farewell: ['May the gods keep you, {player}.', 'Until next time.', 'Safe travels.'],
    noWork: ['Nothing for you today. Come back tomorrow.', 'No work right now.'],
    rumorNone: ['Nothing new under Spokaheim’s roofs.', 'The rumours sleep today.'],
    default: ['Mm. Interesting.', 'If you say so.', 'Ha! That’s one for the mead hall.', 'Not sure I follow, {player}.', 'Speak plainly, will you?'],
  },
};

export function fallbackLine(kind, { npc, player, lang = 'fr' }) {
  const table = LINES[lang === 'en' ? 'en' : 'fr'];
  const line = pick(table[kind] || table.default);
  return line
    .replaceAll('{player}', player?.name || '')
    .replaceAll('{name}', npc.name)
    .replaceAll('{title}', npc.title[lang === 'en' ? 'en' : 'fr']);
}

export function greetingKind(npc) {
  const m = mood(npc);
  if (m.key === 'anger' || m.key === 'disgust') return 'greetAngry';
  if (m.key === 'sadness' || m.key === 'fear') return 'greetSad';
  if (m.key === 'energy') return 'greetTired';
  if (m.key === 'joy' || m.key === 'pride' || m.key === 'gratitude') return 'greetHappy';
  return 'greetNeutral';
}

export const factionName = (key, lang = 'fr') => FACTIONS[key]?.[lang] || key;
