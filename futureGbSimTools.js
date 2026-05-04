/**
 * futureGbSimTools
 * Version : 0-4-1
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
 * Lit le levier effectif depuis gb.data.pairLedger.whatstrat.LEVERAGE.
 * Cette propriété est lue dans le Ledger Gunbot de la paire, où Gunbot
 * consolide automatiquement la valeur effective issue de la config (override
 * ou stratégie), ce qui rend inutile toute résolution manuelle.
 * gb.data.leverage n'est pas utilisé car il s'est avéré non fiable en simulation.
 *
 * Retourne null si la propriété est absente, nulle ou invalide,
 * avec un message de log explicite sur la cause de l'erreur.
 *
 * @param {object} gb
 * @returns {number|null} Levier effectif (> 0), ou null en cas d'erreur.
 */
function getLeverage(gb) {
    try {
        const rawLev = gb.data.pairLedger && gb.data.pairLedger.whatstrat && gb.data.pairLedger.whatstrat.LEVERAGE;
        const lev = parseFloat(rawLev);
        if (!isNaN(lev) && lev > 0) {
            log('getLeverage : gb.data.pairLedger.whatstrat.LEVERAGE = ' + lev);
            return lev;
        }
        // Valeur présente mais inexploitable (NaN, 0, négative)
        log('getLeverage : ERREUR – gb.data.pairLedger.whatstrat.LEVERAGE est absent, nul ou invalide'
            + ' (valeur brute : ' + rawLev + ').'
            + ' Impossible de calculer les marges.');
        return null;
    } catch (e) {
        log('getLeverage : ERREUR – exception lors de la lecture de gb.data.pairLedger.whatstrat.LEVERAGE : '
            + e.message + '. Impossible de calculer les marges.');
        return null;
    }
}

/**
 * Reconstitue la position nette ouverte à partir de l'historique des ordres.
 *
 * IMPORTANT : gb.data.orders est trié du plus récent au plus ancien (desc).
 * On parcourt donc le tableau à rebours pour traiter les ordres
 * chronologiquement (du plus ancien au plus récent), ce qui est requis
 * pour que l'algorithme FIFO soit correct.
 *
 * Algorithme FIFO :
 *   - "buy"  → ajoute un lot { amount, rate } à la file
 *   - "sell" → consomme les lots FIFO proportionnellement
 *
 * Les lots restants représentent la position ouverte.
 * La quantité nette est normalisée à 0 si |qty| < 1e-10 (résidu flottant).
 *
 * @param {object} gb
 * @returns {{ qty: number, avgPrice: number, lots: Array }} ou null en cas d'erreur
 *   qty      : quantité nette signée (+ long, - short, 0 = pas de position)
 *              déjà normalisée à 0 si résidu flottant insignifiant
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

        // gb.data.orders est trié new → old (desc).
        // On itère à rebours pour traiter les ordres old → new (asc),
        // ce qui est la condition nécessaire à l'algorithme FIFO.
        for (let i = orders.length - 1; i >= 0; i--) {
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

                // Consommation FIFO des lots longs existants
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

                // Si remaining > 0 après épuisement des lots longs,
                // le sell ouvre (ou étend) une position short.
                if (remaining > 1e-12) {
                    lots.push({ amount: -remaining, rate: rate });
                    log('reconstructPosition : SELL dépassant les longs, short résiduel = ' + remaining.toFixed(8));
                }

                log('reconstructPosition : SELL ' + amount + ' @ ' + rate + ' | netQty=' + netQty.toFixed(8));

            } else {
                log('reconstructPosition : type ordre inconnu "' + type + '", ignoré');
            }
        }

        // Normalisation : résidu flottant insignifiant traité comme position nulle
        if (Math.abs(netQty) < 1e-10) {
            netQty = 0;
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
 * La normalisation de qty (< 1e-10 → 0) est effectuée dans reconstructPosition.
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simQtyOpenPosition(gb) {
    try {
        log('--- simQtyOpenPosition ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        log('simQtyOpenPosition = ' + pos.qty);
        return pos.qty;

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

        // pos.qty est déjà normalisé (résidu < 1e-10 → 0)
        if (pos.qty === 0) {
            log('simUpnl : pas de position ouverte, uPnL = 0');
            return 0;
        }

        const bid = parseFloat(gb.data.bid);
        if (isNaN(bid) || bid <= 0) {
            log('simUpnl : gb.data.bid invalide');
            return null;
        }

        let upnl;
        if (pos.qty > 0) {
            // Position LONG
            upnl = (bid - pos.avgPrice) * pos.qty;
        } else {
            // Position SHORT
            upnl = (pos.avgPrice - bid) * Math.abs(pos.qty);
        }

        log('simUpnl = ' + upnl + ' (bid=' + bid + ', avgPrice=' + pos.avgPrice + ', qty=' + pos.qty + ')');
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
 * Retourne null si gb.data.leverage est absent ou invalide.
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simTotalPositionInitialMargin(gb) {
    try {
        log('--- simTotalPositionInitialMargin ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        // pos.qty est déjà normalisé (résidu < 1e-10 → 0)
        if (pos.qty === 0) {
            log('simTotalPositionInitialMargin : pas de position, marge = 0');
            return 0;
        }

        const leverage = getLeverage(gb);
        if (leverage === null) {
            log('simTotalPositionInitialMargin : levier indisponible → retour null');
            return null;
        }

        const margin = (pos.avgPrice * Math.abs(pos.qty)) / leverage;

        log('simTotalPositionInitialMargin = ' + margin
            + ' (avgPrice=' + pos.avgPrice
            + ', qty=' + pos.qty
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
 * Retourne null si gb.data.leverage est absent ou invalide.
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

        const leverage = getLeverage(gb);
        if (leverage === null) {
            log('simTotalOpenOrderInitialMargin : levier indisponible → retour null');
            return null;
        }

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

/**
 * simCurrentQty
 * Valeur absolue de la quantité nette de la position future ouverte.
 * Alias de Math.abs(simQtyOpenPosition), toujours >= 0.
 * 0 si pas de position ouverte.
 * Miroir de gb.data.currentQty, indisponible en mode simulation.
 *
 * @param {object} gb
 * @returns {number|null}
 */
function simCurrentQty(gb) {
    try {
        log('--- simCurrentQty ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        const qty = Math.abs(pos.qty);
        log('simCurrentQty = ' + qty);
        return qty;

    } catch (e) {
        log('simCurrentQty : exception = ' + e.message);
        return null;
    }
}

/**
 * simCurrentSide
 * Type de la position future ouverte pour la paire courante.
 * Miroir de gb.data.currentSide, indisponible en mode simulation.
 *
 * Valeurs retournées :
 *   "long"  si netQty > 0
 *   "short" si netQty < 0
 *   "none"  si netQty === 0 (pas de position ouverte)
 *
 * Note : contrairement aux autres propriétés du module, simCurrentSide retourne
 * une chaîne de caractères (string) et non un nombre, afin de mapper
 * exactement la valeur native gb.data.currentSide.
 * En cas d'erreur, null est retourné (cohérent avec les autres propriétés).
 *
 * @param {object} gb
 * @returns {string|null}
 */
function simCurrentSide(gb) {
    try {
        log('--- simCurrentSide ---');
        const pos = reconstructPosition(gb);
        if (pos === null) return null;

        let side;
        if (pos.qty > 0) {
            side = 'long';
        } else if (pos.qty < 0) {
            side = 'short';
        } else {
            side = 'none';
        }

        log('simCurrentSide = ' + side + ' (netQty=' + pos.qty + ')');
        return side;

    } catch (e) {
        log('simCurrentSide : exception = ' + e.message);
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

    log('=== futureGbSimTools v0-4-1 initialisé ===');
    log('Exchange : ' + (gb && gb.data && gb.data.exchangeName ? gb.data.exchangeName : '?'));
    log('Pair     : ' + (gb && gb.data && gb.data.pairName     ? gb.data.pairName     : '?'));
    log('Leverage : ' + (gb && gb.data && gb.data.pairLedger && gb.data.pairLedger.whatstrat && gb.data.pairLedger.whatstrat.LEVERAGE ? gb.data.pairLedger.whatstrat.LEVERAGE : '?'));

    if (!gb || !gb.data) {
        console.error('[futureGbSimTools] ERREUR CRITIQUE : objet gb manquant ou invalide.');
        return {
            simUpnl:                        null,
            simTotalPositionInitialMargin:  null,
            simTotalOpenOrderInitialMargin: null,
            simQtyOpenPosition:             null,
            simAveragePriceOpenPosition:    null,
            simCurrentQty:                  null,
            simCurrentSide:                 null
        };
    }

    return {
        simUpnl:                        simUpnl(gb),
        simTotalPositionInitialMargin:  simTotalPositionInitialMargin(gb),
        simTotalOpenOrderInitialMargin: simTotalOpenOrderInitialMargin(gb),
        simQtyOpenPosition:             simQtyOpenPosition(gb),
        simAveragePriceOpenPosition:    simAveragePriceOpenPosition(gb),
        simCurrentQty:                  simCurrentQty(gb),
        simCurrentSide:                 simCurrentSide(gb)
    };
};
