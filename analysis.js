/**
 * Amazon Ads Optimizer — Analysis Engine
 * Analyzes Search Terms Report data and generates actionable recommendations
 */

const AnalysisEngine = {
    /**
     * Normalize column names from various Amazon report formats
     */
    normalizeColumns(headers) {
        const map = {};
        const patterns = {
            startDate: /start\s*date|startdatum|anfangsdatum/i,
            endDate: /end\s*date|enddatum/i,
            startTime: /start\s*time|godzina\s*rozpoczęcia/i,
            portfolio: /portfolio\s*name|portfolio/i,
            currency: /currency|währung/i,
            campaign: /campaign\s*name|kampania|campaign|kampagnenname/i,
            adGroup: /ad\s*group(\s*name)?|grupa\s*reklam|anzeigengruppe/i,
            country: /country|land/i,
            targeting: /targeting|keyword|kierowanie|słowo\s*kluczowe|ausrichtung/i,
            matchType: /match\s*type|typ\s*dopasowania|übereinstimmungstyp/i,
            searchTerm: /search\s*query|customer\s*search\s*term|search\s*term|wyszukiwane\s*wyrażenie|wyszukiwane|suchbegriff/i,
            placement: /placement|miejsce|platzierung/i,
            impressions: /impressions|wyświetlenia|impressionen/i,
            clicks: /clicks|kliknięcia|klicks/i,
            ctr: /click.*rate|ctr|współczynnik\s*kliknięć|klickrate/i,
            cpc: /cost\s*per\s*click|cpc|koszt\s*kliknięcia|kosten\s*pro\s*klick/i,
            acos: /acos|total\s*advertising\s*cost\s*of\s*sales|acos\s*%/i,
            roas: /roas|return\s*on\s*ad\s*spend/i,
            orders: /orders|7\s*day\s*total\s*orders|zamówienia|bestellungen/i,
            units: /units|7\s*day\s*total\s*units|sztuki|jednostki|einheiten/i,
            convRate: /conversion\s*rate|współczynnik\s*konwersji|konversionsrate/i,
            spend: /spend|cost(?!\s*(per|pro))|wydatki|koszt(?!\s*kliknięcia)|ausgaben/i,
            sales: /sales|7\s*day\s*total\s*sales|sprzedaż|umsatz/i,
            sqpVolume: /search\s*query\s*volume/i,
            sqpBrandShare: /impressions:\s*brand\s*share\s*%/i,
            sqpClickShare: /clicks:\s*brand\s*share\s*%/i,
            sqpPurchaseShare: /purchases:\s*brand\s*share\s*%/i,
        };

        headers.forEach((header, idx) => {
            const h = String(header).trim();
            for (const [key, regex] of Object.entries(patterns)) {
                if (regex.test(h) && !(key in map)) {
                    map[key] = idx;
                    break;
                }
            }
        });

        return map;
    },

    /**
     * Parse a numeric value from various formats
     */
    parseNum(val) {
        if (val === undefined || val === null || val === '' || val === '-') return 0;
        // If it's already a number, return it directly
        if (typeof val === 'number') return isNaN(val) ? 0 : val;
        // Remove currency symbols, % signs, spaces, and handle commas
        let cleaned = String(val).replace(/[€$£¥%\s]/g, '').replace(',', '.');
        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    },

    /**
     * Detect if a column contains decimal ratios (0-1) or percentages (0-100)
     * Amazon.de exports CTR, ACoS, ConvRate as decimals (e.g. 0.5 = 50%)
     */
    detectPercentageFormat(values) {
        // Sample up to 50 non-zero values
        const samples = values.filter(v => v > 0 && v !== null && v !== undefined).slice(0, 50);
        if (samples.length === 0) return 'percentage'; // default

        // If most values are <= 1, it's likely a decimal ratio
        const belowOne = samples.filter(v => v <= 1).length;
        return (belowOne / samples.length) > 0.7 ? 'decimal' : 'percentage';
    },

    /**
     * Parse rows into structured data
     */
    parseRows(rows, colMap) {
        const data = [];

        // First pass: collect raw ACoS/CTR/ConvRate values to detect format
        const rawAcos = [];
        const rawCtr = [];
        const rawConvRate = [];

        for (const row of rows) {
            if (!row || row.length < 3) continue;
            if (colMap.acos !== undefined) {
                const v = this.parseNum(row[colMap.acos]);
                if (v > 0) rawAcos.push(v);
            }
            if (colMap.ctr !== undefined) {
                const v = this.parseNum(row[colMap.ctr]);
                if (v > 0) rawCtr.push(v);
            }
            if (colMap.convRate !== undefined) {
                const v = this.parseNum(row[colMap.convRate]);
                if (v > 0) rawConvRate.push(v);
            }
        }

        const acosFormat = this.detectPercentageFormat(rawAcos);
        const ctrFormat = this.detectPercentageFormat(rawCtr);
        const convRateFormat = this.detectPercentageFormat(rawConvRate);

        // Second pass: parse all rows
        for (const row of rows) {
            // Skip empty rows or rows that look like headers/summaries
            if (!row || row.length < 3) continue;

            const searchTerm = colMap.searchTerm !== undefined ? String(row[colMap.searchTerm] || '').trim() : '';
            const targeting = colMap.targeting !== undefined ? String(row[colMap.targeting] || '').trim() : '';
            const placement = colMap.placement !== undefined ? String(row[colMap.placement] || '').trim() : '';
            const startTime = colMap.startTime !== undefined ? String(row[colMap.startTime] || '').trim() : '';

            // Require at least one specific identifier for the row to be valid
            if (!searchTerm && !targeting && !placement && !startTime) continue;
            if (searchTerm === 'Total' || searchTerm === 'Razem' || searchTerm === 'Gesamt') continue;

            const entry = {
                country: colMap.country !== undefined ? String(row[colMap.country] || '').trim() : '',
                currency: colMap.currency !== undefined ? String(row[colMap.currency] || '').trim() : 'EUR',
                campaign: colMap.campaign !== undefined ? String(row[colMap.campaign] || '').trim() : '',
                adGroup: colMap.adGroup !== undefined ? String(row[colMap.adGroup] || '').trim() : '',
                targeting: targeting,
                matchType: colMap.matchType !== undefined ? String(row[colMap.matchType] || '').trim() : '',
                searchTerm: searchTerm,
                placement: placement,
                startTime: colMap.startTime !== undefined ? String(row[colMap.startTime] || '').trim() : '',
                startDate: colMap.startDate !== undefined ? String(row[colMap.startDate] || '').trim() : '',
                impressions: this.parseNum(colMap.impressions !== undefined ? row[colMap.impressions] : 0),
                clicks: this.parseNum(colMap.clicks !== undefined ? row[colMap.clicks] : 0),
                cpc: this.parseNum(colMap.cpc !== undefined ? row[colMap.cpc] : 0),
                spend: this.parseNum(colMap.spend !== undefined ? row[colMap.spend] : 0),
                sales: this.parseNum(colMap.sales !== undefined ? row[colMap.sales] : 0),
                orders: this.parseNum(colMap.orders !== undefined ? row[colMap.orders] : 0),
                units: this.parseNum(colMap.units !== undefined ? row[colMap.units] : 0),
                sqpVolume: colMap.sqpVolume !== undefined ? this.parseNum(row[colMap.sqpVolume]) : 0,
                sqpBrandShare: colMap.sqpBrandShare !== undefined ? this.parseNum(row[colMap.sqpBrandShare]) : 0,
                sqpClickShare: colMap.sqpClickShare !== undefined ? this.parseNum(row[colMap.sqpClickShare]) : 0,
                sqpPurchaseShare: colMap.sqpPurchaseShare !== undefined ? this.parseNum(row[colMap.sqpPurchaseShare]) : 0,
            };

            // Parse CTR with format detection
            if (colMap.ctr !== undefined) {
                let ctrVal = this.parseNum(row[colMap.ctr]);
                if (ctrFormat === 'decimal' && ctrVal > 0) ctrVal *= 100;
                entry.ctr = ctrVal;
            } else {
                entry.ctr = entry.impressions > 0 ? (entry.clicks / entry.impressions) * 100 : 0;
            }

            // Calculate ACoS — prefer calculated value over raw (more reliable)
            if (colMap.acos !== undefined) {
                let acosVal = this.parseNum(row[colMap.acos]);
                if (acosFormat === 'decimal' && acosVal > 0) acosVal *= 100;
                entry.acos = acosVal;
            }
            // Always recalculate from spend/sales if possible (more reliable)
            if (entry.sales > 0) {
                entry.acos = (entry.spend / entry.sales) * 100;
            } else {
                entry.acos = entry.spend > 0 ? 999 : 0;
            }

            // Calculate ROAS
            entry.roas = entry.spend > 0 ? entry.sales / entry.spend : 0;

            // Conversion rate with format detection
            if (colMap.convRate !== undefined) {
                let convVal = this.parseNum(row[colMap.convRate]);
                if (convRateFormat === 'decimal' && convVal > 0) convVal *= 100;
                entry.convRate = convVal;
            } else {
                entry.convRate = entry.clicks > 0 ? (entry.orders / entry.clicks) * 100 : 0;
            }

            data.push(entry);
        }
        return data;
    },

    /**
     * Run full analysis on parsed data
     */
    analyze(data, settings = {}, targetingData = [], sqpData = []) {
        const targetAcos = settings.targetAcos || 30;
        const minClicks = settings.minClicks || 10;
        const minSpend = settings.minSpend || 15;
        const minOrders = settings.minOrders || 2;

        const results = {
            kpi: this.calculateKPIs(data),
            wastedSpend: [],
            wastedAsins: [],
            wastedWords: this.analyzeNGrams(data, settings),
            skag: [],
            winners: [],
            harvest: [],
            harvestAsins: [],
            sqpBoost: [],
            highAcos: [],
            chartData: {},
        };

        // Pre-compute existing Exact targets to prevent overlapping/cannibalizing harvesting
        const existingExactTargets = new Set();
        if (targetingData && targetingData.length > 0) {
            targetingData.forEach(t => {
                if (t.matchType && /exact/i.test(t.matchType) && t.targeting) {
                    existingExactTargets.add(String(t.targeting).toLowerCase().trim());
                }
            });
        }

        // Pre-compute SQP mapping for quick lookups
        const sqpMap = {};
        if (sqpData && sqpData.length > 0) {
            sqpData.forEach(row => {
                const q = String(row.searchTerm).toLowerCase().trim();
                if (q && row.sqpBrandShare < 20 && row.sqpVolume >= 100) { // Consider opportunities
                    sqpMap[q] = row;
                }
            });
        }

        for (const row of data) {
            const term = row.searchTerm || '';
            const lowerTerm = term.toLowerCase().trim();
            const isAsin = /^b0[a-z0-9]{8}$/i.test(term.trim()) || /^[0-9]{9}[x0-9]$/i.test(term.trim());

            // 1. Wasted Spend: spend >= threshold OR clicks >= threshold, no sales
            if ((row.spend >= minSpend || row.clicks >= minClicks) && row.sales === 0 && row.orders === 0 && row.spend > 0) {
                const priority = row.spend > minSpend * 2 || row.clicks > minClicks * 2 ? 'Wysoki' : row.spend > minSpend * 1.5 || row.clicks > minClicks * 1.5 ? 'Średni' : 'Niski';
                if (isAsin) {
                    results.wastedAsins.push({
                        ...row,
                        action: '🎯 Dodaj jako Negative Targeting (Negative Exact) w zakładce "Product Targeting"',
                        priority: priority,
                    });
                } else {
                    results.wastedSpend.push({
                        ...row,
                        action: 'Dodaj jako Negative Phrase',
                        priority: priority,
                    });
                }
            }

            // 2. Winning Terms & SKAG (Golden Pearls) & SQP Boost
            if (row.orders >= minOrders && row.acos <= targetAcos && row.acos > 0) {
                // SQP Cross-Reference
                if (sqpMap[lowerTerm]) {
                    const sqpDataRow = sqpMap[lowerTerm];
                    results.sqpBoost.push({
                        ...row,
                        sqpVolume: sqpDataRow.sqpVolume,
                        sqpBrandShare: sqpDataRow.sqpBrandShare,
                        action: `🔥 SKALUJ MAX: Masz super ACoS (${row.acos.toFixed(1)}%), a udział w organicznym rynku to tylko ${sqpDataRow.sqpBrandShare}% przy wolumenie bazowym ${sqpDataRow.sqpVolume.toLocaleString('pl-PL')}! Przenieś budżet i przejmij kontrolę.`,
                        priority: 'Super Wysoki',
                    });
                }
                
                const superWinner = row.orders >= 4 && row.acos < targetAcos * 0.7;
                if (superWinner) {
                    results.skag.push({
                        ...row,
                        action: '🔥 SKC: Wydziel term do nowej "Single Keyword Campaign", dodaj Top of Search multiplier, by zarządzać placementem osobno i skroić rynek!',
                        priority: 'Wysoki',
                    });
                } else {
                    results.winners.push({
                        ...row,
                        action: 'Toleruj lub Przenieś do Exact Match z wyższym bidem',
                        priority: row.acos < targetAcos * 0.5 ? 'Wysoki' : 'Średni',
                    });
                }
            }

            // 3. Harvest: auto/broad/phrase/competitor campaign terms with conversions
            const isHarvestSource = /auto|automatic|automatyczna|\baut\b|broad|szeroki|\bbrd\b|phrase|\bphr\b|konkurencja|\bkon\b|\bcat\b|category/i.test(row.campaign + ' ' + (row.adGroup || '') + ' ' + (row.matchType || ''));
            // Harvest only if it has orders and ACoS is not extremely high (max 1.5x target)
            if (isHarvestSource && row.orders >= 1 && row.sales > 0 && row.acos <= targetAcos * 1.5) {
                const priority = row.orders >= 3 ? 'Wysoki' : 'Średni';
                const alreadyExists = existingExactTargets.has(lowerTerm) || 
                                      (isAsin && existingExactTargets.has(`asin="${lowerTerm.toUpperCase()}"`));

                if (isAsin) {
                    results.harvestAsins.push({
                        ...row,
                        action: alreadyExists ? '⚠️ UWAGA: Ten ASIN już istnieje na Twoim koncie w innej kampanii! Po prostu znajdź go i podnieś mu bid.' : '🎯 Wyciągnij ASIN do oddzielnej kampanii typu "Product Targeting" (Celowanie w produkty)',
                        priority: alreadyExists ? 'Niski' : priority,
                    });
                } else {
                    results.harvest.push({
                        ...row,
                        action: alreadyExists ? '⚠️ UWAGA: To słowo już istnieje na koncie jako Exact w innej kampanii! Po prostu znajdź je i podnieś mu bid.' : 'Dodaj do Manual Exact',
                        priority: alreadyExists ? 'Niski' : priority,
                    });
                }
            }

            // 4. High ACoS: has sales but ACoS above target
            if (row.sales > 0 && row.acos > targetAcos) {
                results.highAcos.push({
                    ...row,
                    action: row.acos > targetAcos * 2 ? 'Pauzuj lub Negative' : 'Obniż Bid',
                    priority: row.acos > targetAcos * 2 ? 'Wysoki' : 'Średni',
                });
            }
        }

        // Sort all lists by spend descending
        // Sort all lists
        results.wastedSpend.sort((a, b) => b.spend - a.spend);
        results.wastedAsins.sort((a, b) => b.spend - a.spend);
        results.skag.sort((a, b) => b.orders - a.orders || a.acos - b.acos);
        results.winners.sort((a, b) => a.acos - b.acos);
        results.harvest.sort((a, b) => b.orders - a.orders);
        results.harvestAsins.sort((a, b) => b.orders - a.orders);
        results.highAcos.sort((a, b) => b.spend - a.spend);

        // Calculate chart data based on search term reports
        results.chartData = this.buildChartData(data, targetAcos);

        return results;
    },

    /**
     * N-Gram Analysis: Finds bad performing single words across all search terms
     */
    analyzeNGrams(data, settings) {
        const minSpend = settings.minSpend || 15;
        const wordsMap = {};

        for (const row of data) {
            if (!row.searchTerm || row.searchTerm.length < 2) continue;

            const term = row.searchTerm.toLowerCase().trim();
            // Try to ignore exact Match Type if it's already negative, but we don't know it here.
            // Skip ASIN targets
            if (term.length === 10 && term.startsWith('b0')) continue;

            // Split by standard delimiters
            const words = term.split(/[\s\-\+\(\)\[\]\{\}\.,\/;:]+/);
            const uniqueWords = new Set();
            for (const w of words) {
                if (w.length > 2 && isNaN(Number(w))) {
                    uniqueWords.add(w);
                }
            }

            for (const word of uniqueWords) {
                if (!wordsMap[word]) {
                    wordsMap[word] = {
                        word: word,
                        spend: 0,
                        clicks: 0,
                        sales: 0,
                        orders: 0,
                        campaigns: new Set(),
                        countries: new Set(),
                        examples: [],
                    };
                }
                wordsMap[word].spend += row.spend;
                wordsMap[word].clicks += row.clicks;
                wordsMap[word].sales += row.sales;
                wordsMap[word].orders += row.orders;
                if (row.campaign) {
                    const countryPrefix = row.country ? `[${row.country}] ` : '';
                    wordsMap[word].campaigns.add(`${countryPrefix}${row.campaign}`);
                }
                if (row.country) wordsMap[word].countries.add(row.country);

                if (wordsMap[word].examples.length < 3 && !wordsMap[word].examples.includes(term)) {
                    wordsMap[word].examples.push(term);
                }
            }
        }

        const wastedWords = [];
        for (const key in wordsMap) {
            const w = wordsMap[key];
            if (w.sales === 0 && w.spend >= minSpend) {
                wastedWords.push({
                    searchTerm: w.word,
                    isNGram: true, // Flag to differentiate from normal terms
                    ngramContext: w.examples.join(', '),
                    campaign: Array.from(w.campaigns).join(', '),
                    country: Array.from(w.countries).join(', '),
                    impressions: '-',
                    clicks: w.clicks,
                    spend: w.spend,
                    sales: w.sales,
                    orders: w.orders,
                    acos: 999, // default indicator for no sales
                    cpc: w.clicks > 0 ? w.spend / w.clicks : 0,
                    action: 'Zablokuj jako Negative Phrase',
                    priority: w.spend > minSpend * 2 ? 'Wysoki' : 'Średni',
                });
            }
        }

        wastedWords.sort((a, b) => b.spend - a.spend);
        return wastedWords;
    },

    /**
     * Analyze Targeting Report for Bid Recommendations
     */
    analyzeTargeting(data, settings = {}) {
        const targetAcos = settings.targetAcos || 30;
        const manualTargets = [];
        const autoTargets = [];

        for (const row of data) {
            // Check if it is an Auto Campaign Target
            const tgtLower = String(row.targeting).toLowerCase();
            const isAutoTgt = tgtLower === 'close-match' || tgtLower === 'loose-match' || tgtLower === 'substitutes' || tgtLower === 'complements';

            // Give recommendations if we have at least 5 clicks
            if (row.clicks >= 5 && row.spend > 0) {
                const spc = row.sales > 0 ? row.sales / row.clicks : 0;
                const currentAcos = row.sales > 0 ? (row.spend / row.sales) * 100 : 999;

                let suggestedBid = 0;
                if (row.sales > 0) {
                    suggestedBid = (targetAcos / 100) * spc;
                } else {
                    suggestedBid = row.cpc * 0.2; // Recommend dropping bid if no sales
                }

                let changePct = 0;
                if (row.cpc > 0) {
                    changePct = ((suggestedBid - row.cpc) / row.cpc) * 100;
                }

                let action = 'Zostaw';
                let priority = 'Niski';

                if (changePct > 20) {
                    action = 'Podnieś Bid';
                    priority = changePct > 50 ? 'Wysoki' : 'Średni';
                } else if (changePct < -20) {
                    action = 'Obniż Bid';
                    priority = changePct < -50 ? 'Wysoki' : 'Średni';
                }

                if (isAutoTgt) {
                    if (action === 'Obniż Bid') {
                        action = `Obniż bid dla dopasowania ${row.targeting} (Przepala budżet, ACoS ${currentAcos >= 999 ? '>100' : Math.round(currentAcos)}%)`;
                    } else if (action === 'Podnieś Bid') {
                        action = `Podnieś bid dla dopasowania ${row.targeting} (Świetne wyniki, ACoS ${currentAcos >= 999 ? '>100' : Math.round(currentAcos)}%)`;
                    } else {
                        action = `Dopasowanie ${row.targeting} performuje ok`;
                    }

                    autoTargets.push({
                        ...row,
                        searchTerm: row.targeting,
                        currentAcos: currentAcos,
                        suggestedBid: suggestedBid,
                        changePct: changePct,
                        action: action,
                        priority: priority
                    });
                } else {
                    manualTargets.push({
                        ...row,
                        searchTerm: row.targeting,
                        currentAcos: currentAcos,
                        suggestedBid: suggestedBid,
                        changePct: changePct,
                        action: action,
                        priority: priority
                    });
                }
            }
        }

        manualTargets.sort((a, b) => b.spend - a.spend);
        autoTargets.sort((a, b) => b.spend - a.spend);
        return { manualTargets, autoTargets };
    },

    /**
     * Analyze Placement Report for Bid Adjustments
     */
    analyzePlacements(data) {
        const campaigns = {};

        for (const row of data) {
            const campKey = `${row.campaign} (${row.country || 'N/A'})`;
            if (!campaigns[campKey]) {
                campaigns[campKey] = {
                    campaign: row.campaign,
                    country: row.country,
                    placements: {}
                };
            }

            const p = row.placement;
            if (!p) continue;

            const type = /top of search/i.test(p) ? 'TOS' : /product pages/i.test(p) ? 'PP' : /rest of search/i.test(p) ? 'ROS' : 'OTHER';

            if (!campaigns[campKey].placements[type]) {
                campaigns[campKey].placements[type] = { name: p, spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };
            }
            campaigns[campKey].placements[type].spend += row.spend;
            campaigns[campKey].placements[type].sales += row.sales;
            campaigns[campKey].placements[type].clicks += row.clicks;
            campaigns[campKey].placements[type].impressions += row.impressions;
            campaigns[campKey].placements[type].orders += row.orders;
        }

        const recommendations = [];

        const calcDynamicCut = (wastedSpend, totalSnd, isAuto, targetPlacements) => {
            let cutPct = Math.round((wastedSpend / totalSnd) * 100);
            if (cutPct > 75) cutPct = 75;
            if (cutPct < 15) cutPct = 15;
            const adjPct = Math.round(((1 / (1 - (cutPct / 100))) - 1) * 100);

            if (isAuto) {
                return `Obniż domyślną stawkę (Default Bid) dla tej kampanii Auto o -${cutPct}%, a w Bid Adjustments dla ${targetPlacements} ustaw +${adjPct}% by obciąć straty`;
            } else {
                return `Manualna: Obniż bazowe bidy słów o -${cutPct}% i ustaw Bid Adjustments na ${targetPlacements} na +${adjPct}% (⚠️ UWAGA: Jeśli wolisz nie psuć bidów, wyciągnij dobre słowa do Single Keyword Campaign)`;
            }
        };

        const calcDynamicBoost = (plcAcos, avgAcos, isAuto, targetPlacement) => {
            let boost = Math.round(((avgAcos / plcAcos) - 1) * 100);
            if (boost > 100) boost = 100;
            if (boost < 10) boost = 10;

            if (isAuto) {
                return `Podnieś Bid Adjustment na ${targetPlacement} o +${boost}% (maksymalizacja taniego ruchu z kampanii Auto)`;
            } else {
                return `Podnieś Bid Adjustment na ${targetPlacement} o +${boost}% (lub wydziel najlepsze słowo do SKC z wysokim Placement modyfikatorem)`;
            }
        };

        for (const [campKey, cData] of Object.entries(campaigns)) {
            const p = cData.placements;
            let totalSpend = 0; let totalSales = 0;

            Object.values(p).forEach(plc => { totalSpend += plc.spend; totalSales += plc.sales; });
            if (totalSpend < 5) continue;

            const tos = p['TOS'] || { name: 'Top of Search', spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };
            const pp = p['PP'] || { name: 'Product Pages', spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };
            const ros = p['ROS'] || { name: 'Rest of Search', spend: 0, sales: 0, clicks: 0, impressions: 0, orders: 0 };

            const tosAcos = tos.sales > 0 ? (tos.spend / tos.sales) * 100 : 999;
            const ppAcos = pp.sales > 0 ? (pp.spend / pp.sales) * 100 : 999;
            const rosAcos = ros.sales > 0 ? (ros.spend / ros.sales) * 100 : 999;
            const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 999;
            const isAuto = /auto|automatic|automatyczna/i.test(cData.campaign);

            // 1. Wasted Spend na Product Pages
            if (pp.spend > 15 && pp.sales === 0) {
                // If TOS or ROS are doing well, we want to cut PP but preserve TOS/ROS
                if (tos.sales > 0 || ros.sales > 0) {
                    recommendations.push({
                        campaign: cData.campaign, country: cData.country,
                        searchTerm: 'Product Pages (Wasted)', spend: pp.spend, sales: pp.sales, clicks: pp.clicks, impressions: pp.impressions, acos: 999, orders: pp.orders,
                        priority: pp.spend > 30 ? 'Wysoki' : 'Średni',
                        action: `Tnij to miejsce: ${calcDynamicCut(pp.spend, totalSpend, isAuto, 'Top of Search oraz Rest of Search')}`
                    });
                }
            }

            // 2. Wasted Spend na Top of Search
            if (tos.spend > 15 && tos.sales === 0) {
                if (pp.sales > 0 || ros.sales > 0) {
                    recommendations.push({
                        campaign: cData.campaign, country: cData.country,
                        searchTerm: 'Top of Search (Wasted)', spend: tos.spend, sales: tos.sales, clicks: tos.clicks, impressions: tos.impressions, acos: 999, orders: tos.orders,
                        priority: tos.spend > 30 ? 'Wysoki' : 'Średni',
                        action: `Tnij to miejsce: ${calcDynamicCut(tos.spend, totalSpend, isAuto, 'Product Pages oraz Rest of Search')}`
                    });
                } else {
                    recommendations.push({
                        campaign: cData.campaign, country: cData.country,
                        searchTerm: 'Top of Search (Wasted)', spend: tos.spend, sales: tos.sales, clicks: tos.clicks, impressions: tos.impressions, acos: 999, orders: tos.orders,
                        priority: tos.spend > 30 ? 'Wysoki' : 'Średni',
                        action: 'Zmniejsz Bid Adjustment na Top of Search do 0% (oraz pauzuj nietrafione słowa/targety)'
                    });
                }
            }

            // 3. Wasted Spend na Rest of Search
            if (ros.spend > 15 && ros.sales === 0) {
                if (tos.sales > 0 || pp.sales > 0) {
                    recommendations.push({
                        campaign: cData.campaign, country: cData.country,
                        searchTerm: 'Rest of Search (Wasted)', spend: ros.spend, sales: ros.sales, clicks: ros.clicks, impressions: ros.impressions, acos: 999, orders: ros.orders,
                        priority: ros.spend > 30 ? 'Wysoki' : 'Średni',
                        action: `Tnij to miejsce: ${calcDynamicCut(ros.spend, totalSpend, isAuto, 'Top of Search oraz Product Pages')}`
                    });
                }
            }

            // 4. Excellent Top of Search
            if (tos.sales > 0 && tosAcos < avgAcos * 0.8 && tosAcos < 40) {
                recommendations.push({
                    campaign: cData.campaign, country: cData.country,
                    searchTerm: 'Top of Search (Winner)', spend: tos.spend, sales: tos.sales, clicks: tos.clicks, impressions: tos.impressions, acos: tosAcos, orders: tos.orders,
                    priority: tosAcos < avgAcos * 0.5 ? 'Wysoki' : 'Średni',
                    action: calcDynamicBoost(tosAcos, avgAcos, isAuto, 'Top of Search')
                });
            }

            // 5. Excellent Product Pages
            if (pp.sales > 0 && ppAcos < avgAcos * 0.8 && ppAcos < 40) {
                recommendations.push({
                    campaign: cData.campaign, country: cData.country,
                    searchTerm: 'Product Pages (Winner)', spend: pp.spend, sales: pp.sales, clicks: pp.clicks, impressions: pp.impressions, acos: ppAcos, orders: pp.orders,
                    priority: ppAcos < avgAcos * 0.5 ? 'Wysoki' : 'Średni',
                    action: calcDynamicBoost(ppAcos, avgAcos, isAuto, 'Product Pages')
                });
            }

            // 6. Excellent Rest of Search
            if (ros.sales > 0 && rosAcos < avgAcos * 0.8 && rosAcos < 40) {
                recommendations.push({
                    campaign: cData.campaign, country: cData.country,
                    searchTerm: 'Rest of Search (Winner)', spend: ros.spend, sales: ros.sales, clicks: ros.clicks, impressions: ros.impressions, acos: rosAcos, orders: ros.orders,
                    priority: rosAcos < avgAcos * 0.5 ? 'Wysoki' : 'Średni',
                    action: calcDynamicBoost(rosAcos, avgAcos, isAuto, 'Rest of Search')
                });
            }
        }

        recommendations.sort((a, b) => b.spend - a.spend);
        return recommendations;
    },

    /**
     * Calculate KPIs
     */
    calculateKPIs(data) {
        const totalSpend = data.reduce((s, r) => s + r.spend, 0);
        const totalSales = data.reduce((s, r) => s + r.sales, 0);
        const totalOrders = data.reduce((s, r) => s + r.orders, 0);
        const totalClicks = data.reduce((s, r) => s + r.clicks, 0);
        const totalImpressions = data.reduce((s, r) => s + r.impressions, 0);

        const avgAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
        const roas = totalSpend > 0 ? totalSales / totalSpend : 0;

        // Wasted spend (search terms with clicks but no sales)
        const wastedSpend = data
            .filter(r => r.clicks > 0 && r.sales === 0)
            .reduce((s, r) => s + r.spend, 0);

        const kpis = {
            totalSpend,
            totalSales,
            totalOrders,
            totalClicks,
            totalImpressions,
            avgAcos,
            roas,
            wastedSpend,
            totalTerms: data.length,
            deltas: {}
        };
        
        // Load historical KPIs to compute delta
        try {
            const historical = localStorage.getItem('amazon_ads_optimizer_last_kpis');
            if (historical) {
                const last = JSON.parse(historical);
                kpis.deltas = {
                    totalSpend: kpis.totalSpend - (last.totalSpend || 0),
                    avgAcos: kpis.avgAcos - (last.avgAcos || 0),
                    wastedSpend: kpis.wastedSpend - (last.wastedSpend || 0)
                };
            }
            // Save current KPIs as historical for the NEXT time
            localStorage.setItem('amazon_ads_optimizer_last_kpis', JSON.stringify({
                totalSpend: kpis.totalSpend,
                avgAcos: kpis.avgAcos,
                wastedSpend: kpis.wastedSpend
            }));
        } catch(e) { console.warn('Local storage error', e); }

        return kpis;
    },

    /**
     * Build chart data
     */
    buildChartData(data, targetAcos) {
        // Top 10 terms by spend
        const top10 = [...data]
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 10);

        const spendVsSales = {
            labels: top10.map(r => r.searchTerm.length > 25 ? r.searchTerm.slice(0, 25) + '…' : r.searchTerm),
            spend: top10.map(r => r.spend.toFixed(2)),
            sales: top10.map(r => r.sales.toFixed(2)),
        };

        // Spend Efficiency (Spend on rows with orders vs spend on rows without orders)
        let productiveSpend = 0;
        let wastedSpendTotal = 0;
        for (const row of data) {
            if (row.orders > 0) {
                productiveSpend += row.spend;
            } else {
                wastedSpendTotal += row.spend;
            }
        }

        const spendEfficiency = {
            labels: ['Wydatki z konwersją', 'Wydatki bez konwersji (Wasted)'],
            values: [productiveSpend.toFixed(2), wastedSpendTotal.toFixed(2)],
        };

        return { spendVsSales, spendEfficiency };
    },

    /**
     * Generate demo data for testing
     */
    generateDemoData() {
        const campaigns = [
            'SP - Auto - Główny Produkt',
            'SP - Manual Exact - Brand',
            'SP - Manual Broad - Generic',
            'SP - Auto - Nowy Produkt',
            'SP - Manual Phrase - Competitor'
        ];
        const adGroups = [
            'AdGroup - Główny',
            'AdGroup - Brand Terms',
            'AdGroup - Generic',
            'AdGroup - Discovery',
            'AdGroup - Competitor'
        ];
        const matchTypes = ['BROAD', 'EXACT', 'PHRASE', 'TARGETING_EXPRESSION', 'TARGETING_EXPRESSION_PREDEFINED'];
        const searchTerms = [
            'kubek termiczny', 'kubek na kawę', 'thermos kubek', 'kubek podróżny',
            'bidon termiczny', 'kubek do kawy stalowy', 'termos 500ml', 'kubek ze stali',
            'butelka termiczna', 'kubek izolowany', 'yeti kubek', 'stanley cup',
            'kubek z pokrywką', 'kubek do herbaty', 'kubek ceramiczny',
            'prezent dla taty', 'kubek na prezent', 'kubek grawerowany',
            'mug stainless steel', 'travel mug', 'coffee tumbler', 'insulated cup',
            'kubek 350ml', 'kubek bambusowy', 'ekologiczny kubek',
            'kubek z uchwytem', 'kubek sportowy', 'bidon 750ml',
            'termos obiadowy', 'lunch box termiczny', 'komplet kubków',
            'garnek żeliwny', 'patelnia', 'deska do krojenia', 'szklanka',
            'laptop stand', 'kabel usb', 'ładowarka', 'słuchawki bluetooth'
        ];

        const rows = [];
        for (let i = 0; i < searchTerms.length; i++) {
            const campIdx = i % campaigns.length;
            const isRelevant = i < 28; // First 28 terms are relevant to the product
            const impressions = Math.floor(Math.random() * (isRelevant ? 5000 : 2000) + 100);
            const ctr = isRelevant ? (Math.random() * 3 + 0.5) : (Math.random() * 1.5 + 0.1);
            const clicks = Math.floor(impressions * ctr / 100);
            const cpc = +(Math.random() * 1.5 + 0.2).toFixed(2);
            const spend = +(clicks * cpc).toFixed(2);

            let orders, sales;
            if (!isRelevant) {
                // Irrelevant terms: no sales
                orders = 0;
                sales = 0;
            } else if (i < 8) {
                // Top performers
                orders = Math.floor(Math.random() * 15 + 3);
                sales = +(orders * (Math.random() * 20 + 15)).toFixed(2);
            } else if (i < 18) {
                // Average performers
                orders = Math.floor(Math.random() * 4 + 1);
                sales = +(orders * (Math.random() * 18 + 12)).toFixed(2);
            } else {
                // Low/no converters
                orders = Math.random() > 0.5 ? 1 : 0;
                sales = orders > 0 ? +(orders * (Math.random() * 20 + 10)).toFixed(2) : 0;
            }

            const acos = sales > 0 ? +((spend / sales) * 100).toFixed(1) : 0;

            rows.push({
                'Campaign Name': campaigns[campIdx],
                'Ad Group Name': adGroups[campIdx],
                'Targeting': searchTerms[Math.min(i, searchTerms.length - 1)],
                'Match Type': matchTypes[campIdx % matchTypes.length],
                'Customer Search Term': searchTerms[i],
                'Impressions': impressions,
                'Clicks': clicks,
                'Click-Thru Rate (CTR)': (ctr).toFixed(2) + '%',
                'Cost Per Click (CPC)': cpc,
                'Spend': spend,
                '7 Day Total Sales': sales,
                'Total Advertising Cost of Sales (ACoS)': acos + '%',
                '7 Day Total Orders': orders,
                '7 Day Total Units': orders,
                '7 Day Conversion Rate': clicks > 0 ? ((orders / clicks) * 100).toFixed(2) + '%' : '0%',
            });
        }

        return rows;
    },

    /**
     * Analyze Day-Parting (Hourly Performance)
     */
    analyzeHourly(hourlyData) {
        // Map 0-23 hours
        const hoursMap = {};
        for (let i = 0; i < 24; i++) {
            hoursMap[i] = { hour: i, spend: 0, sales: 0, clicks: 0, orders: 0, impressions: 0 };
        }

        hourlyData.forEach(row => {
            if (!row.startTime) return;
            // startTime is usually "HH:MM" e.g. "08:00" or just "8"
            const hourParts = row.startTime.toString().split(':');
            let hour = parseInt(hourParts[0], 10);
            if (isNaN(hour) || hour < 0 || hour > 23) return;

            hoursMap[hour].spend += row.spend || 0;
            hoursMap[hour].sales += row.sales || 0;
            hoursMap[hour].clicks += row.clicks || 0;
            hoursMap[hour].orders += row.orders || 0;
            hoursMap[hour].impressions += row.impressions || 0;
        });

        // Calculate aggregate ACoS / CVR
        const results = Object.values(hoursMap).map(h => {
            h.acos = h.sales > 0 ? (h.spend / h.sales) * 100 : (h.spend > 0 ? 100 : 0);
            h.cvr = h.clicks > 0 ? (h.orders / h.clicks) * 100 : 0;
            return h;
        });

        return results;
    }
};
