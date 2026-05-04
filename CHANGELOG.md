# Changelog

All notable changes to **futureGbSimTools** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).  
Version numbers follow the project convention `MAJOR-MINOR-PATCH` :
- **MAJOR** : version majeure (rupture de compatibilité)
- **MINOR** : ajout de fonctionnalité ou refactoring d'envergure
- **PATCH** : correctifs

---

## [Unreleased]

## [0-4-1] - 2026-05-04

### Fixed
- **Correction du chemin d'accès à `LEVERAGE`** : le chemin `gb.data.pairLedger.LEVERAGE` était
  incorrect. La propriété est accessible via `gb.data.pairLedger.whatstrat.LEVERAGE`. L'accès
  sécurisé chaîné a été mis à jour en conséquence, ainsi que tous les messages de log associés.

## [0-4-0] - 2026-05-04

### Changed
- **Refactoring de `getLeverage`** : `gb.data.leverage` s'est avéré non fiable en mode simulation.
  La source de levier est désormais `gb.data.pairLedger.LEVERAGE`, qui reflète la valeur effective
  consolidée par Gunbot (override ou stratégie) sans nécessiter de résolution manuelle.
  Ce changement constitue un refactoring d'envergure de la source de vérité du levier, justifiant
  une montée de version MINOR. Les messages de log internes ont été mis à jour en conséquence.



### Fixed
- **Suppression de `'use strict'`** : la directive était incompatible avec l'environnement
  d'exécution Gunbot (`eval` via `gb.method.require`). Elle provoquait une sortie silencieuse
  du module sans propagation d'exception au `catch` de la stratégie appelante, se manifestant
  par un "Reach end of user code" sans aucun log.

## Modification du nom de fichier du module
- **Suppression de la version dans le nom de fichier** : Permet d'éviter de mettre à jour les appels "require" dans les stratégies appelant le module lors des changements de version.

## [0-3-0] - 2026-05-04

### Changed
- **Refactoring de `getLeverage` : source unique `gb.data.leverage`**.  
  Le levier est désormais lu exclusivement depuis `gb.data.leverage`, propriété native fournie
  directement par l'échange, garantissant que le module et la stratégie custom utilisent
  toujours la même valeur.  
  L'ancienne lecture via `gb.data.whatstrat.LEVERAGE` est supprimée.

### Fixed
- **Comportement sur levier invalide : `null` au lieu de `1`**.  
  Si `gb.data.leverage` est absent, nul, ou invalide (NaN, 0, négatif), `getLeverage` retourne
  désormais `null` avec un message de log explicite identifiant `gb.data.leverage` comme cause
  de l'erreur.  
  Les fonctions `simTotalPositionInitialMargin` et `simTotalOpenOrderInitialMargin` propagent ce
  `null` et retournent elles-mêmes `null` (au lieu de calculer une valeur incorrecte avec un
  levier silencieusement substitué).

---

## [0-2-0] - 2026-05-01

### Added
- **Propriété `simCurrentQty`** : valeur absolue de la quantité nette de la position future ouverte
  (`Math.abs(netQty)`), toujours >= 0. Miroir de `gb.data.currentQty`, indisponible en mode
  simulation. Implémentée comme wrapper léger sur `reconstructPosition`.

- **Propriété `simCurrentSide`** : type de la position future ouverte. Retourne `"long"` si
  `netQty > 0`, `"short"` si `netQty < 0`, `"none"` si `netQty === 0`. Miroir de
  `gb.data.currentSide`, indisponible en mode simulation. Implémentée comme wrapper léger sur
  `reconstructPosition`.  
  Note : contrairement aux autres propriétés du module, `simCurrentSide` retourne une `string`
  (et non un `number`) afin de mapper exactement la valeur native `gb.data.currentSide`.
  En cas d'erreur, `null` est retourné (cohérent avec les autres propriétés).

---

## [0-1-1] - 2026-05-01

### Fixed
- **Sens de parcours de `gb.data.orders` corrigé** : le tableau est trié du plus récent au plus
  ancien (desc), comme confirmé par analyse du fichier state. L'itération dans `reconstructPosition`
  se fait désormais à rebours (`i = length-1` → `0`) afin de traiter les ordres dans l'ordre
  chronologique correct pour l'algorithme FIFO. La version 0-1-0 parcourait le tableau dans le
  mauvais sens, produisant des résultats incorrects.

### Changed
- **Suppression de `resolveLeverage`** : fonction remplacée par `getLeverage`, plus simple et
  directe. Le levier est lu depuis `gb.data.whatstrat.LEVERAGE`, propriété toujours présente dans
  le Ledger Gunbot (objet `whatstrat`). Le cas `LEVERAGE = 0` est toujours traité comme `1`.
  La recherche dans `gb.data.config.pairs[exchange][pair].override.LEVERAGE` et
  `gb.data.config.strategies[strat].LEVERAGE` est supprimée (redondante avec `whatstrat`).

- **Normalisation de `qty` centralisée dans `reconstructPosition`** : le test
  `Math.abs(qty) < 1e-10 → 0` est désormais effectué une seule fois, en fin de
  `reconstructPosition`, avant le retour du résultat. Les fonctions exportées
  (`simUpnl`, `simTotalPositionInitialMargin`, `simQtyOpenPosition`) ne répètent plus ce test.

---

## [0-1-0] - 2026-04-30

### Added
- Première version alpha du module `futureGbSimTools`.
- Fonction `simQtyOpenPosition` : quantité nette de la position future ouverte (positive = long,
  négative = short, 0 = pas de position), reconstituée par algorithme FIFO sur `gb.data.orders`.
- Fonction `simAveragePriceOpenPosition` : prix moyen pondéré des lots de la position future
  ouverte, calculé sur les lots résiduels après reconstruction FIFO.
- Fonction `simUpnl` : PnL non réalisé de la position ouverte, calculé avec `gb.data.bid` comme
  prix de marché courant.
- Fonction `simTotalPositionInitialMargin` : marge initiale totale consommée par la position
  ouverte (`avgPrice × |qty| / leverage`).
- Fonction `simTotalOpenOrderInitialMargin` : marge initiale totale bloquée par les ordres ouverts
  non exécutés (`Σ rate × amount / leverage`).
- Résolution du levier effectif avec priorité : `override.LEVERAGE` > `strategies[strat].LEVERAGE`
  > `1` (valeur `0` traitée comme `1`).
- Logs console conditionnels activables/désactivables via la constante `VERBOSE`.
- Retour `null` sur toutes les valeurs en cas d'erreur ou de propriété `gb` manquante.
- Export sous forme d'objet plat CommonJS (`module.exports = function(gb) { ... }`).

[0-3-1]: https://github.com/votre-repo/futureGbSimTools/releases/tag/0-3-1
[0-3-0]: https://github.com/votre-repo/futureGbSimTools/releases/tag/0-3-0
[0-2-0]: https://github.com/votre-repo/futureGbSimTools/releases/tag/0-2-0
[0-1-1]: https://github.com/votre-repo/futureGbSimTools/releases/tag/0-1-1
[0-1-0]: https://github.com/votre-repo/futureGbSimTools/releases/tag/0-1-0
