'use strict';

/**
 * futureGbSimTools
 * Version : 0-1-0
 *
 * Module Gunbot fournissant des outils et propriétés pour stratégies futures
 * compatibles avec le mode Simulation Gunbot.
 *
 * En mode simulation, plusieurs propriétés natives Gunbot futures renvoient
 * des valeurs nulles ou incorrectes. Ce module les reconstitue à partir des
 * collections gb.data.orders et gb.data.openOrders, qui sont fiables en
 * simulation.
 *
 * Usage depuis une stratégie Gunbot :
 *   const simTools = gb.method.require(gb.modulesPath + '/futureGbSimTools')(gb);
 *   const upnl = simTools.simUpnl;
 *
 * @param {object} gb - L'objet Gunbot global passé en paramètre.
 * @returns {object} Objet plat exposant les propriétés calculées.
 */

// ─────────────────────────────────────────────
// CONSTANTE UTILISATEUR
// Mettre à false pour désactiver les logs console.
// ─────────────────────────────────────────────
const VERBOSE = true;

// ─────────────────────────────────────────────
// HELPERS INTERNES
// ─────────────────────────────────────────────

/**
 * Log conditionnel.
 * @param {string} msg
 */
function log(msg) {
    if (VERBOSE) {
        console.log('[futureGbSimTools] ' + msg);
    }
}

/**
 * Résout le levier effectif pour la paire courante.
 * Priorité : override.LEVERAGE > strategies[strat].LEVERAGE > 1
 * LEVERAGE = 0 est traité comme 1 (pas de levier / spot-like).
 *
 * @param {object} gb
 * @returns {number} Levier effectif (>= 1)
 */
function resolveLeverage(gb) {
    try {
        const exchangeName = gb.data.exchangeName;
        const pairName     = gb.data.pairName;
        const config       = gb.data.config;

        // Récupération de la config de la paire
        const pairConfig = config.pairs
            && config.pairs[exchangeName]
            && config.pairs[exchangeName][pairName];

        if (!pairConfig) {
            log('resolveLeverage : config paire introuvable, levier = 1');
            return 1;
        }

        // 1) Override a priorité absolue
        const overrideLev = pairConfig.override && pairConfig.override.LEVERAGE;
        if (overrideLev !== undefined && overrideLev !== null) {
            const lev = parseFloat(overrideLev);
            if (!isNaN(lev) && lev > 0) {
                log('resolveLeverage : override LEVERAGE = ' + lev);
                return lev;
            }
        }

        // 2) Propriété de la stratégie assignée
        const stratName = pairConfig.strategy;
        const stratConfig = stratName
            && config.strategies
            && config.strategies[stratName];

        if (stratConfig) {
            const stratLev = stratConfig.LEVERAGE;
            if (stratLev !== undefined && stratLev !== null) {
                const lev = parseFloat(stratLev);
                if (!isNaN(lev) && lev > 0) {
                    log('resolveLeverage : strategy LEVERAGE = ' + lev);
                    return lev;
                }
            }
        }

        log('resolveLeverage : LEVERAGE non défini ou = 0, levier = 1');
        return 1;

    } catch (e) {
        log('resolveLeverage : exception = ' + e.message + ', levier = 1');
        return 1;
    }
}

/**
 * Reconstitue la position nette ouverte à partir de l'historique des ordres.
 *
 * Algorithme FIFO sur gb.data.orders (triés du plus ancien au plus récent) :
 * - "buy"  → ajoute un lot { amount, rate } à la file
 * - "sell" → consomme les lots FIFO proportionnellement
 *
 * Les lots restants en fin de parcours représentent la position ouverte.
 *
 * @param {object} gb
 * @returns {{ qty: number, avgPrice: number, lots: Array }} ou null en cas d'erreur
 *   qty      : quantité nette signée (+ long, - short, 0 = pas de position)
 *   avgPrice : prix moyen pondéré des lots restants (0 si pas de position)
 *   lots     : tableau des lots ouverts { amount, rate }
 */
function reconstructPosition(gb) {
    try {
        const orders = gb.data.orders;

        if (!Array.isArray(orders)) {
            log('reconstructPosition : gb.data.orders non disponible');
            return null;
        }

        // File FIFO des lots ouverts : chaque entrée = { amount, rate }
        const lots = [];
        // Quantité nette signée courante
        let netQty = 0;

        // On parcourt les ordres du plus ancien au plus récent.
        // gb.data.orders est trié "old to new" (le plus récent en dernier),
        // conformément à la convention documentée pour candlesClose etc.
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];

            const type   = (order.type || '').toLowerCase();
            const amount = parseFloat(order.amount);
            const rate   = parseFloat(order.rate);

            if (isNaN(amount) || isNaN(rate) || amount <= 0) {
                log('reconstructPosition : ordre ignoré (données invalides) id=' + order.id);
                continue;
            }

            if (type === 'buy') {
                // Ouverture long (ou fermeture short partielle/totale)
                lots.push({ amount: amount, rate: rate });
                netQty += amount;
                log('reconstructPosition : BUY ' + amount + ' @ ' + rate + ' | netQty=' + netQty.toFixed(8));

            } else if (type === 'sell') {
                // Fermeture long (ou ouverture short)
                let remaining = amount;
                netQty -= amount;

                // Consommation FIFO des lots
                while (remaining > 0 && lots.length > 0) {
                    const lot = lots[0];
                    if (lot.amount <= remaining + 1e-12) {
                        // Ce lot est entièrement consommé
                        remaining -= lot.amount;
                        lots.shift();
                    } else {
                        // Consommation partielle du lot
                        lot.amount -= remaining;
                        remaining = 0;
                    }
                }

                // Si remaining > 0 après avoir vidé tous les lots,
                // c'est un sell qui ouvre une position short.
                // On l'enregistre comme un lot négatif virtuel.
                if (remaining > 1e-12) {
                    lots.push({ amount: -remaining, rate: rate });
                    log('reconstructPosition : SELL dépassant les longs, short résiduel = ' + remaining.toFixed(8));
                }

                log('reconstructPosition : SELL ' + amount + ' @ ' + rate + ' | netQty=' + netQty.toFixed(8));

            } else {
                log('reconstructPosition : type ordre inconnu "' + type + '", ignoré');
            }
        }

        // Calcul du prix moyen pondéré des lots restants
        let sumWeighted = 0;
        let sumAmount   = 0;
        for (let j = 0; j < lots.length; j++) {
            const absAmt = Math.abs(lots[j].amount);
            sumWeighted += lots[j].rate * absAmt;
            sumAmount   += absAmt;
        }

        const avgPrice = sumAmount > 1e-12 ? sumWeighted / sumAmount : 0;

        log('reconstructPosition : résultat → netQty=' + netQty.toFixed(8)
            + ' | avgPrice=' + avgPrice.toFixed(8)
            + ' | lots ouverts=' + lots.length);

        return {
            qty:      netQty,
            avgPrice: avgPrice,
            lots:     lots
        };

    } catch (e) {
        log('reconstructPosition : exception = ' + e.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// FONCTIONS EXPORTÉES
// ─────────────────────────────────────────────

/**
 * simQtyOpenPosition
 * Quantité nette de la position future ouverte pour la paire courante.
 * Positive si long, négative si short, 0 si pas de position.
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simQtyOpenPosition(gb) {
    try {
        log('--- simQtyOpenPosition ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        // Arrondi à une précision raisonnable pour éviter les résidus flottants
        const qty = Math.abs(pos.qty) < 1e-10 ? 0 : pos.qty;
        log('simQtyOpenPosition = ' + qty);
        return qty;

    } catch (e) {
        log('simQtyOpenPosition : exception = ' + e.message);
        return null;
    }
}

/**
 * simAveragePriceOpenPosition
 * Prix moyen pondéré des lots de la position future ouverte.
 * 0 si pas de position ouverte.
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simAveragePriceOpenPosition(gb) {
    try {
        log('--- simAveragePriceOpenPosition ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        log('simAveragePriceOpenPosition = ' + pos.avgPrice);
        return pos.avgPrice;

    } catch (e) {
        log('simAveragePriceOpenPosition : exception = ' + e.message);
        return null;
    }
}

/**
 * simUpnl
 * PnL non réalisé de la position future ouverte pour la paire courante.
 * Calculé avec gb.data.bid comme prix de marché courant.
 * Retourne 0 si pas de position ouverte.
 *
 * Formule :
 *   Long  : uPnL = (bid - avgPrice) * qty
 *   Short : uPnL = (avgPrice - bid) * abs(qty)
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simUpnl(gb) {
    try {
        log('--- simUpnl ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        const qty = Math.abs(pos.qty) < 1e-10 ? 0 : pos.qty;

        if (qty === 0) {
            log('simUpnl : pas de position ouverte, uPnL = 0');
            return 0;
        }

        const bid = parseFloat(gb.data.bid);
        if (isNaN(bid) || bid <= 0) {
            log('simUpnl : gb.data.bid invalide');
            return null;
        }

        let upnl;
        if (qty > 0) {
            // Position LONG
            upnl = (bid - pos.avgPrice) * qty;
        } else {
            // Position SHORT
            upnl = (pos.avgPrice - bid) * Math.abs(qty);
        }

        log('simUpnl = ' + upnl + ' (bid=' + bid + ', avgPrice=' + pos.avgPrice + ', qty=' + qty + ')');
        return upnl;

    } catch (e) {
        log('simUpnl : exception = ' + e.message);
        return null;
    }
}

/**
 * simTotalPositionInitialMargin
 * Marge initiale totale consommée par la position ouverte pour la paire courante.
 * = (avgPrice * abs(qty)) / leverage
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simTotalPositionInitialMargin(gb) {
    try {
        log('--- simTotalPositionInitialMargin ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        const qty = Math.abs(pos.qty) < 1e-10 ? 0 : pos.qty;

        if (qty === 0) {
            log('simTotalPositionInitialMargin : pas de position, marge = 0');
            return 0;
        }

        const leverage = resolveLeverage(gb);
        const margin   = (pos.avgPrice * Math.abs(qty)) / leverage;

        log('simTotalPositionInitialMargin = ' + margin
            + ' (avgPrice=' + pos.avgPrice
            + ', qty=' + qty
            + ', leverage=' + leverage + ')');
        return margin;

    } catch (e) {
        log('simTotalPositionInitialMargin : exception = ' + e.message);
        return null;
    }
}

/**
 * simTotalOpenOrderInitialMargin
 * Marge initiale totale bloquée par les ordres futurs ouverts non exécutés.
 * = Σ (ordre.rate * ordre.amount) / leverage
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simTotalOpenOrderInitialMargin(gb) {
    try {
        log('--- simTotalOpenOrderInitialMargin ---');

        const openOrders = gb.data.openOrders;
        if (!Array.isArray(openOrders)) {
            log('simTotalOpenOrderInitialMargin : gb.data.openOrders non disponible');
            return null;
        }

        if (openOrders.length === 0) {
            log('simTotalOpenOrderInitialMargin : aucun ordre ouvert, marge = 0');
            return 0;
        }

        const leverage = resolveLeverage(gb);
        let totalMargin = 0;

        for (let i = 0; i < openOrders.length; i++) {
            const order  = openOrders[i];
            const rate   = parseFloat(order.rate);
            const amount = parseFloat(order.amount);

            if (isNaN(rate) || isNaN(amount) || rate <= 0 || amount <= 0) {
                log('simTotalOpenOrderInitialMargin : ordre ignoré (données invalides) id=' + order.id);
                continue;
            }

            const orderMargin = (rate * amount) / leverage;
            totalMargin += orderMargin;
            log('simTotalOpenOrderInitialMargin : ordre id=' + order.id
                + ' | rate=' + rate + ' | amount=' + amount
                + ' | margin=' + orderMargin);
        }

        log('simTotalOpenOrderInitialMargin = ' + totalMargin + ' (leverage=' + leverage + ')');
        return totalMargin;

    } catch (e) {
        log('simTotalOpenOrderInitialMargin : exception = ' + e.message);
        return null;
    }
}

// ─────────────────────────────────────────────
// EXPORT DU MODULE
// ─────────────────────────────────────────────

/**
 * Point d'entrée du module.
 * Appelé avec l'objet gb en paramètre depuis la stratégie :
 *   const simTools = gb.method.require(gb.modulesPath + '/futureGbSimTools')(gb);
 */
module.exports = function (gb) {

    log('=== futureGbSimTools v0-1-0 initialisé ===');
    log('Exchange : ' + (gb && gb.data && gb.data.exchangeName ? gb.data.exchangeName : '?'));
    log('Pair     : ' + (gb && gb.data && gb.data.pairName     ? gb.data.pairName     : '?'));

    if (!gb || !gb.data) {
        console.error('[futureGbSimTools] ERREUR CRITIQUE : objet gb manquant ou invalide.');
        return {
            simUpnl:                        null,
            simTotalPositionInitialMargin:  null,
            simTotalOpenOrderInitialMargin: null,
            simQtyOpenPosition:             null,
            simAveragePriceOpenPosition:    null
        };
    }

    return {
        simUpnl:                        simUpnl(gb),
        simTotalPositionInitialMargin:  simTotalPositionInitialMargin(gb),
        simTotalOpenOrderInitialMargin: simTotalOpenOrderInitialMargin(gb),
        simQtyOpenPosition:             simQtyOpenPosition(gb),
        simAveragePriceOpenPosition:    simAveragePriceOpenPosition(gb)
    };
};
