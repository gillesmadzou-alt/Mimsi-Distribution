import { useState } from 'react';
import { X, BookOpen, ChevronDown, ChevronRight, Search } from 'lucide-react';

interface ManualSection {
  id: string;
  title: string;
  content: string[];
}

interface ManualGroup {
  label: string;
  sections: ManualSection[];
}

const MANUAL_VERSION = '1.0.0';
const MANUAL_DATE = '8 août 2026';

const MANUAL_GROUPS: ManualGroup[] = [
  {
    label: 'Demarrage',
    sections: [
      {
        id: 'connexion',
        title: 'Connexion',
        content: [
          'Saisissez votre adresse email et votre mot de passe sur la page de connexion.',
          'Si vous n\'avez pas de compte, contactez un administrateur (role 6) qui pourra vous creer un compte depuis la page Utilisateurs.',
          'La connexion fonctionne egalement hors ligne si vous vous etes deja connecte au moins une fois en ligne. Votre profil et votre mot de passe sont mis en cache securiseement.',
          'Au retour d\'une connexion hors ligne, votre profil est automatiquement revalide pour s\'assurer qu\'il est a jour.',
        ],
      },
      {
        id: 'modes',
        title: 'Modes en ligne et hors ligne',
        content: [
          'L\'application fonctionne en mode connecte (en ligne) et deconnecte (hors ligne).',
          'Quand vous etes hors ligne, un badge orange "Mode hors ligne" apparait en haut de l\'ecran.',
          'Toutes les donnees que vous saisissez hors ligne sont enregistrees localement et synchronisees automatiquement des que la connexion revient.',
          'Un indicateur de synchronisation (fleche circulaire) en haut a droite montre l\'etat de la synchronisation : en cours, termine, ou en attente.',
        ],
      },
      {
        id: 'mise-a-jour',
        title: 'Mettre a jour l\'application',
        content: [
          'Cliquez sur le bouton "Mettre a jour l\'app" en bas de la barre laterale pour verifier et installer les mises a jour.',
          'Si une mise a jour est disponible, elle sera appliquee et la page se rechargera automatiquement.',
          'Si l\'application est deja a jour, un message "App deja a jour" s\'affiche brievement.',
        ],
      },
    ],
  },
  {
    label: 'Pilotage',
    sections: [
      {
        id: 'dashboard',
        title: 'Tableau de bord',
        content: [
          'Le tableau de bord affiche une vue d\'ensemble des indicateurs cles : pots deposés, retours, creances, production.',
          'Les cartes de statistiques en haut montrent les chiffres du jour. Cliquez sur une carte pour acceder au detail.',
          'Les commerciaux voient un resume de leurs tournees du jour, leurs depots et leurs retours.',
        ],
      },
      {
        id: 'batches',
        title: 'Tournees du jour',
        content: [
          'Cette page liste les lots de livraison (tournees) du jour par commercial.',
          'Pour creer une tournee : cliquez sur "Nouvelle tournee", selectionnez un commercial, un type de tournee et les points de vente a desservir.',
          'Vous pouvez deposer des pots chez un point de vente en cliquant sur "Deposer des pots" sur une tournee. Saisissez les quantites par type de pot.',
          'Pour confirmer un depot en attente, cliquez sur le bouton de confirmation.',
          'Pour cloturer une tournee terminee, cliquez sur "Cloturer".',
          'Les codes a barres peuvent etre associes aux depots pour un suivi precis des contenants.',
        ],
      },
      {
        id: 'map',
        title: 'Carte interactive',
        content: [
          'La carte affiche tous les points de vente geolocalises. Cliquez sur un marqueur pour voir les details du point de vente.',
          'Vous pouvez filtrer par zone, statut (actif/inactif), ou type (nouveau/existant).',
          'La position GPS des commerciaux en tournee est egalement affichee en temps reel quand ils sont connectes.',
        ],
      },
      {
        id: 'returns',
        title: 'Retours et Invendus',
        content: [
          'Enregistrez les pots et madeleines ramenes par les commerciaux apres leurs tournees.',
          'Selectionnez le commercial, la date, puis saisissez les quantites retournees par type de pot, madeleines, couvercles et pots vides.',
          'Les retours sont automatiquement compares aux depots pour calculer les ecarts.',
        ],
      },
      {
        id: 'barcodes',
        title: 'Codes a barres',
        content: [
          'Etiquetez et suivez les pots par code a barres pour un suivi individuel precis.',
          'Scannez un code a barres avec la camera de votre appareil ou saisissez-le manuellement.',
          'Chaque pot etiquete est associe a un pétrisseur et peut etre suivi tout au long de la chaine de distribution.',
        ],
      },
    ],
  },
  {
    label: 'Reporting',
    sections: [
      {
        id: 'statistics',
        title: 'Statistiques',
        content: [
          'Consultez les graphiques et tendances des ventes, retours et ecarts sur differentes periodes.',
          'Filtrez par periode (jour, semaine, mois, annee) et par commercial si necessaire.',
        ],
      },
      {
        id: 'analytics',
        title: 'Analytique',
        content: [
          'Graphiques avances : ventes detaillees, tresorerie, creances par point de vente, production par pétrisseur.',
          'Utilisez les filtres en haut pour affiner l\'analyse par periode ou par categorie.',
        ],
      },
      {
        id: 'opportunistic',
        title: 'Ventes opportunes',
        content: [
          'Enregistrez les ventes opportunes et les commandes de pots pour mariages effectuees par les commerciaux.',
          'Cliquez sur "Nouvelle vente" pour saisir une vente opportune avec le client, la quantite et le montant.',
        ],
      },
      {
        id: 'journal',
        title: 'Journal de livraison',
        content: [
          'Historique detaille de tous les depots et retours, triable par date, commercial et point de vente.',
        ],
      },
      {
        id: 'reports',
        title: 'Rapports',
        content: [
          'Generez des rapports en PDF ou Excel selon votre role : ventes, retours, creances, production, conformite.',
          'Selectionnez le type de rapport et la periode, puis cliquez sur "Generer".',
        ],
      },
    ],
  },
  {
    label: 'Finance',
    sections: [
      {
        id: 'receivables',
        title: 'Creances',
        content: [
          'Suivez les montants dus par les points de vente et les paiements recus.',
          'Cliquez sur un point de vente pour voir son historique de creances et enregistrer un paiement.',
          'Les paiements de quota peuvent etre enregistres directement depuis la fiche du point de vente.',
        ],
      },
      {
        id: 'expenses',
        title: 'Depenses livraison',
        content: [
          'Enregistrez toutes les depenses de tournee : carburant, papiers, credits, reparations, et autres.',
          'Cliquez sur "Nouvelle depense", selectionnez le type, le montant et la tournee associee si besoin.',
          'Les commerciaux peuvent saisir leurs propres depenses de tournee.',
        ],
      },
      {
        id: 'compliance',
        title: 'Conformite',
        content: [
          'Enregistrez les controles qualite et les ecarts constates sur le terrain.',
          'Creez un controle, ajoutez des observations et des ecarts, puis validez ou demandez une correction.',
          'Les commentaires peuvent etre ajoutes pour preciser le contexte d\'un controle.',
        ],
      },
    ],
  },
  {
    label: 'Logistique',
    sections: [
      {
        id: 'consignments',
        title: 'Consignes',
        content: [
          'Suivez les contenants (pots) deposés chez les points de vente et recuperes.',
          'Le solde de consignes par point de vente est calcule automatiquement.',
        ],
      },
      {
        id: 'restock',
        title: 'Reapprovisionnement',
        content: [
          'Les commerciaux peuvent formuler des demandes de reapprovisionnement en pots, madeleines ou contenants.',
          'Les responsables valident ou refusent les demandes depuis cette page.',
        ],
      },
      {
        id: 'leave',
        title: 'Conges et Absences',
        content: [
          'Le personnel peut demander des conges (annuel, maladie, etc.) qui sont valides par les responsables.',
          'Cliquez sur "Nouvelle demande", selectionnez le type et les dates, puis soumettez.',
          'Les responsables peuvent approuver ou refuser les demandes en attente.',
        ],
      },
      {
        id: 'attendance',
        title: 'Liste de presence',
        content: [
          'Pointez les arrivees et departs du personnel. Saisissez l\'heure d\'arrivee et l\'heure de depart pour chaque personne.',
          'Une photo d\'arrivee et de depart peut etre ajoutee pour le pointage au kiosque.',
          'Le mode kiosque permet un pointage rapide sans connexion complete.',
        ],
      },
    ],
  },
  {
    label: 'Ressources',
    sections: [
      {
        id: 'drivers',
        title: 'Commerciaux',
        content: [
          'Fiches des commerciaux : nom, vehicule, zone, telephone, statut actif/inactif.',
          'Cliquez sur "Ajouter" pour creer un nouveau commercial. Les modifications du personnel sont soumises a approbation.',
        ],
      },
      {
        id: 'sales-points',
        title: 'Points de vente',
        content: [
          'Liste des commerces desservis avec coordonnees, zone, quota et statut.',
          'Cliquez sur un point de vente pour modifier ses informations, definir son quota ou sa position GPS.',
          'Les nouveaux points de vente sont marques comme "nouveau" et peuvent etre filtres.',
        ],
      },
      {
        id: 'stock',
        title: 'Stock',
        content: [
          'Inventaire des pots, madeleines, couvercles et contenants par type.',
          'Cliquez sur "Mouvement" pour enregistrer une entree ou sortie de stock avec le type, la quantite et le responsable.',
          'L\'historique des mouvements est consultable pour chaque type de pot.',
        ],
      },
      {
        id: 'production',
        title: 'pétrisseurs et Production',
        content: [
          'Enregistrez la production quotidienne de madeleines par pétrisseur : quantite produite, pots utilises, pate utilisee.',
          'Les petrisseurs livrent la pate aux pétrisseurs. Suivez les livraisons de pate et leur usage.',
          'Les ecarts de production (casse, brulures) sont enregistres pour le suivi qualite.',
        ],
      },
      {
        id: 'scheduling',
        title: 'Programmation',
        content: [
          'Planifiez les tournees et les equipes. Definissez les horaires de travail et les affectations.',
          'Les horaires de travail hebdomadaires peuvent etre definis pour chaque membre du personnel.',
        ],
      },
      {
        id: 'ingredients',
        title: 'Intrants et Cout pate',
        content: [
          'Gerez le stock des matieres premieres (farine, sucre, oeufs, etc.) et les fournisseurs.',
          'Le cout de la pate est calcule automatiquement a partir des ingredients et de leurs prix.',
          'Les lots de pate sont suivis du petrissage a la livraison chez les pétrisseurs.',
        ],
      },
    ],
  },
  {
    label: 'Gouvernance',
    sections: [
      {
        id: 'leaderboard',
        title: 'Classement',
        content: [
          'Classement compare des commerciaux selon leurs ventes, retours et regularite.',
          'Les performances sont calculees sur la periode selectionnee.',
        ],
      },
      {
        id: 'audit',
        title: 'Journal des actions',
        content: [
          'Trace de toutes les actions effectuees dans l\'application : qui a fait quoi et quand.',
          'Filtrez par type d\'action, utilisateur ou date pour retrouver une action specifique.',
        ],
      },
      {
        id: 'org-chart',
        title: 'Organigramme',
        content: [
          'Structure hierarchique du personnel : commerciaux, pétrisseurs, petrisseurs et responsables.',
        ],
      },
      {
        id: 'observations',
        title: 'Observations',
        content: [
          'Notes et remarques du terrain partagees par tout le personnel.',
          'Cliquez sur "Nouvelle observation" pour signaler un evenement ou une anomalie constatee sur le terrain.',
        ],
      },
    ],
  },
  {
    label: 'Administration',
    sections: [
      {
        id: 'users',
        title: 'Utilisateurs',
        content: [
          'Creez et geerez les comptes utilisateurs. Attribuez un role a chaque utilisateur pour definir ses acces.',
          'Les roles determinent les pages accessibles et les actions autorisees.',
          'Un utilisateur peut etre active ou desactive sans etre supprime.',
        ],
      },
      {
        id: 'approvals',
        title: 'Approbations personnel',
        content: [
          'Validez ou refusez les demandes de modification du personnel (ajout, modification, suppression de commerciaux, pétrisseurs, petrisseurs).',
          'Filtrez par statut (en attente, approuve, refuse) et par categorie (commercial, pétrisseur, petrisseur).',
        ],
      },
    ],
  },
  {
    label: 'Divers',
    sections: [
      {
        id: 'notifications',
        title: 'Notifications',
        content: [
          'La cloche en haut a droite affiche les notifications recentes : demandes d\'approbation, alertes de conformite, rappels.',
          'Le compteur sur la cloche indique le nombre de notifications non lues.',
        ],
      },
      {
        id: 'backup',
        title: 'Sauvegarde des donnees',
        content: [
          'Cliquez sur "Sauvegarder les donnees" en bas de la barre laterale pour sauvegarder toutes les donnees en ligne et preparer le cache local.',
          'Apres la sauvegarde, le mode hors-ligne utilise directement les donnees mises en cache - aucun fichier telecharge.',
        ],
      },
      {
        id: 'roles',
        title: 'Roles et permissions',
        content: [
          'Role 1 - Commercial : tournees, carte, ventes opportunes, depenses, journal, observations, organigramme.',
          'Role 2 - Agent de suivi : acces au retours, codes a barres, statistiques, stock, production, programmation, intrants, classement, conformite, reapprovisionnement, consignes.',
          'Role 3 - Responsable commercial : acces aux creances et a la conformite en plus des acces precedents.',
          'Role 4 - Directrice commerciale / Responsable : gestion des commerciaux, points de vente, conges, pointages, approbations, rapports, journal des actions.',
          'Role 6 - Administrateur : gestion complete des utilisateurs et de tous les parametres.',
        ],
      },
    ],
  },
];

interface UserManualModalProps {
  open: boolean;
  onClose: () => void;
}

export default function UserManualModal({ open, onClose }: UserManualModalProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set([MANUAL_GROUPS[0].sections[0].id]));
  const [search, setSearch] = useState('');

  if (!open) return null;

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filteredGroups = search.trim()
    ? MANUAL_GROUPS.map((group) => ({
        ...group,
        sections: group.sections.filter(
          (s) =>
            s.title.toLowerCase().includes(search.toLowerCase()) ||
            s.content.some((c) => c.toLowerCase().includes(search.toLowerCase()))
        ),
      })).filter((g) => g.sections.length > 0)
    : MANUAL_GROUPS;

  const allFilteredSections = filteredGroups.flatMap((g) => g.sections);
  const expandAll = () => setExpanded(new Set(allFilteredSections.map((s) => s.id)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col animate-[scaleIn_180ms_ease-out]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Manuel d'utilisation</h2>
              <p className="text-xs text-gray-500">Version {MANUAL_VERSION} - Mis a jour le {MANUAL_DATE}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher dans le manuel..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
            />
          </div>
          <button
            onClick={expandAll}
            className="px-3 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            Tout ouvrir
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {filteredGroups.length === 0 ? (
            <p className="text-center py-12 text-gray-400 text-sm">Aucun resultat pour "{search}"</p>
          ) : (
            <div className="space-y-6">
              {filteredGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.label}</h3>
                  <div className="space-y-1">
                    {group.sections.map((section) => {
                      const isOpen = expanded.has(section.id);
                      return (
                        <div key={section.id} className="border border-gray-100 rounded-lg overflow-hidden">
                          <button
                            onClick={() => toggle(section.id)}
                            className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                          >
                            {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
                            <span className="text-sm font-medium text-gray-800">{section.title}</span>
                          </button>
                          {isOpen && (
                            <div className="px-4 pb-3 pl-10">
                              <ul className="space-y-1.5">
                                {section.content.map((line, idx) => (
                                  <li key={idx} className="text-sm text-gray-600 leading-relaxed flex gap-2">
                                    <span className="text-amber-500 mt-0.5 shrink-0">•</span>
                                    <span>{line}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-xs text-gray-400">Suivi Distribution Madeleines - Manuel d'utilisation</p>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 transition-opacity"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
