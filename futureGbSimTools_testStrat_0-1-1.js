'use strict';

/**
 * futureGbSimTools_test
 * Version : 0-1-1
 *
 * Stratégie Gunbot custom de test pour le module futureGbSimTools.
 * Objectif : charger le module, appeler toutes ses propriétés et afficher
 * leurs valeurs dans la console.
 *
 * Aucune logique de trading. Aucun ordre n'est émis.
 *
 * Usage : assigner cette stratégie à une paire futures en mode Simulation.
 */

// ─────────────────────────────────────────────
// CHARGEMENT DU MODULE
// ─────────────────────────────────────────────

let simTools;

try {
    simTools = gb.method.require(gb.modulesPath + '/futureGbSimTools_0-3-0')(gb);
} catch (e) {
    console.error('[TEST] Impossible de charger futureGbSimTools : ' + e.message);
    return;
}

// ─────────────────────────────────────────────
// AFFICHAGE DES PROPRIÉTÉS
// ─────────────────────────────────────────────

console.log('');
console.log('========================================');
console.log('[TEST] futureGbSimTools — résultats');
console.log('Exchange : ' + gb.data.exchangeName);
console.log('Pair     : ' + gb.data.pairName);
console.log('Bid      : ' + gb.data.bid);
console.log('----------------------------------------');
console.log('[TEST] simUpnl                        = ' + simTools.simUpnl);
console.log('[TEST] simTotalPositionInitialMargin  = ' + simTools.simTotalPositionInitialMargin);
console.log('[TEST] simTotalOpenOrderInitialMargin = ' + simTools.simTotalOpenOrderInitialMargin);
console.log('[TEST] simQtyOpenPosition             = ' + simTools.simQtyOpenPosition);
console.log('[TEST] simAveragePriceOpenPosition    = ' + simTools.simAveragePriceOpenPosition);
console.log('[TEST] simCurrentQty                  = ' + simTools.simCurrentQty);
console.log('[TEST] simCurrentSide                 = ' + simTools.simCurrentSide);
console.log('========================================');
console.log('');

console.log('[TEST] futureGbSimTools_test terminé. Aucune action de trading n\'a été effectuée.');
