// Guide du portail : tout ce qu'un nouvel Élu doit savoir, sans quitter son téléphone.
import { useT } from '../i18n.jsx';
import { Card, Rune } from './ui.jsx';

const SECTIONS = [
  {
    title: 'Parler aux habitants',
    lines: [
      'Dans le chat du jeu, approche-toi d’un habitant et écris-lui, ou commence ton message par son prénom : « Bjorn, tu as du travail ? ».',
      'Ils répondent au-dessus de leur tête. Ils ont une humeur, une mémoire, et une opinion sur toi qui change selon ce que tu fais.',
      'Depuis ce portail, tu peux leur parler même hors du jeu : ils savent alors que tu leur écris de loin, par une pierre runique.',
    ],
  },
  {
    title: 'Travailler pour la cité',
    lines: [
      'Demande du travail à un artisan : il te propose deux contrats du jour. Dis « j’accepte 1 » pour en prendre un.',
      'Pour les livraisons, dépose la marchandise dans le coffre posé devant lui, puis dis-lui que c’est fait : il prend ce qu’il faut et te paie.',
      'Les chasses et les explorations se valident toutes seules : tue les bêtes ou va dans la région demandée.',
      'Tes contrats en cours et leur avancement sont dans l’onglet « Mon héros ».',
    ],
  },
  {
    title: 'La renommée et les titres',
    lines: [
      'Chaque travail accompli, chaque exploit, chaque service rendu augmente ta renommée, et la renommée donne des titres.',
      'Les marchands font un meilleur prix à ceux que la cité connaît, et certains habitants ne confient leurs faveurs personnelles qu’à leurs amis.',
      'À 150 de renommée, Halla te remet les clés d’une maison dans les murs : tape !maison en jeu pour la voir sur ta carte.',
    ],
  },
  {
    title: 'La vie de la cité',
    lines: [
      'La nuit, des bêtes peuvent marcher sur Spokaheim : la garde se masse à la porte menacée, et ceux qui défendent la cité sont récompensés.',
      'Les jours de marché, une caravane remplit les étals et adoucit les prix. Les jours de fête, l’hydromel est offert.',
      'Des primes de chasse et des cartes au trésor sont annoncées par le crieur : le coffre est vraiment là où la carte le dit.',
      'Les grands chantiers (la cloche, le guet, la mine, la statue) se paient en matériaux déposés dans le coffre du chantier, à l’atelier des bâtisseurs. Tous ceux qui ont donné touchent leur part.',
    ],
  },
  {
    title: 'La Couronne',
    lines: [
      'Spokaheim est un empire : l’Empereur lève l’impôt, publie des décrets, adoube ses fidèles et nomme ses officiers. Tout cela se voit dans l’onglet « Couronne ».',
      'Une taxe pèse sur chaque récompense : elle remplit le trésor, qui paie les fêtes, les chantiers et la solde de la garde. Trop de taxe, et la cité gronde — les habitants le disent, et déposent des doléances.',
      'Tape !allegeance en jeu pour prêter serment, !couronne pour voir l’état du royaume, !doleances pour lire ce que le peuple demande.',
      'Un jour, l’Empereur peut te faire Chevalier, Jarl, ou te confier une charge : capitaine de la garde, intendant du trésor, héraut, juge. Ces charges donnent de vrais pouvoirs.',
    ],
  },
  {
    title: 'Commandes en jeu',
    lines: [
      '!aide — la liste complète. !journal — tes contrats. !saga — ton chapitre.',
      '!contrats, !accepter 1, !rendre — travailler pour un habitant proche.',
      '!prix, !acheter 2 <objet>, !vendre — commercer (les pièces se déposent dans le coffre du marchand).',
      '!cite, !chantier, !maison, !couronne, !allegeance, !rumeurs, !heure, !renommee, !qui — la cité et toi.',
      'Un chiffre seul (1, 2, 3…) répond au menu que l’habitant vient de proposer.',
      '!portail — un code pour ouvrir ce site. !amende — payer la garde si tu as fait une bêtise.',
    ],
  },
];

export default function Guide() {
  const t = useT();
  return (
    <>
      <p className="text-sm leading-relaxed text-ink-400">
        {t('Spokaheim est la capitale de l’Empereur Spoka. Ses habitants y vivent vraiment : ils travaillent, dorment, se souviennent de toi et racontent ce que tu fais. Voilà comment y prendre ta place.')}
      </p>
      <Rune />
      {SECTIONS.map((section) => (
        <Card key={section.title} title={t(section.title)}>
          <ul className="space-y-2 text-sm leading-relaxed text-ink-300">
            {section.lines.map((line, i) => (
              <li key={i}>{t(line)}</li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}
