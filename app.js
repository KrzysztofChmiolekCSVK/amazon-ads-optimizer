/**
 * Amazon Ads Optimizer — Main Application
 */

(function () {
    'use strict';

    // ===== STATE =====
    let parsedDataMap = {
        searchTerms: [],
        targeting: [],
        placements: [],
        sqp: [],
        hourly: []
    };
    let analysisResults = null;
    let chartInstances = {};
    let autoCampaigns = new Set();
    let globalSearchQuery = '';

    // ===== DOM REFS =====
    const screens = {
        upload: document.getElementById('app-upload'),
        loading: document.getElementById('app-loading'),
        dashboard: document.getElementById('app-dashboard'),
    };
    const uploadZone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    const demoBtn = document.getElementById('demo-btn');
    const newReportBtn = document.getElementById('new-report-btn');
    const reanalyzeBtn = document.getElementById('reanalyze-btn');
    const countryFilter = document.getElementById('country-filter');
    const campaignFilter = document.getElementById('campaign-filter');
    const globalSearchInput = document.getElementById('global-search');
    const loadingStatus = document.getElementById('loading-status');
    let doneRowIds = new Set();
    try {
        const stored = localStorage.getItem('amazon_ads_optimizer_done_rows');
        if (stored) {
            const rawArr = JSON.parse(stored);
            // Normalize existing IDs to lowercase for reliability
            doneRowIds = new Set(rawArr.map(id => String(id).toLowerCase()));
        }
    } catch(e) { console.warn('Local storage init error', e); }

    function saveDoneRows() {
        try {
            localStorage.setItem('amazon_ads_optimizer_done_rows', JSON.stringify(Array.from(doneRowIds)));
        } catch(e) { console.warn('Local storage save error', e); }
    }

    // Country → Amazon domain mapping
    const COUNTRY_DOMAINS = {
        'Germany': 'amazon.de',
        'Italy': 'amazon.it',
        'Spain': 'amazon.es',
        'France': 'amazon.fr',
        'United Kingdom': 'amazon.co.uk',
        'Netherlands': 'amazon.nl',
        'Poland': 'amazon.pl',
        'Sweden': 'amazon.se',
        'Belgium': 'amazon.com.be',
    };

    // Country → Flag emoji mapping
    const COUNTRY_FLAGS = {
        'Germany': '🇩🇪',
        'Italy': '🇮🇹',
        'Spain': '🇪🇸',
        'France': '🇫🇷',
        'United Kingdom': '🇬🇧',
        'Netherlands': '🇳🇱',
        'Poland': '🇵🇱',
        'Sweden': '🇸🇪',
        'Belgium': '🇧🇪',
    };
    const themeToggleUpload = document.getElementById('theme-toggle-upload');
    const themeToggleDash = document.getElementById('theme-toggle-dash');

    // ===== THEME TOGGLE =====
    function initTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        setTheme(savedTheme);
    }

    function setTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        
        const toggles = [themeToggleUpload, themeToggleDash];
        toggles.forEach(btn => {
            if (btn) btn.innerHTML = theme === 'dark' ? '🌙' : '☀️';
        });
        
        // Update Chart.js colors based on theme
        if (analysisResults) {
            renderCharts();
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        setTheme(current === 'dark' ? 'light' : 'dark');
    }

    if (themeToggleUpload) themeToggleUpload.addEventListener('click', toggleTheme);
    if (themeToggleDash) themeToggleDash.addEventListener('click', toggleTheme);
    
    initTheme();

    // ===== NAVIGATION =====
    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.remove('active'));
        screens[name].classList.add('active');
    }

    // ===== FILE UPLOAD =====
    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('drag-over');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('drag-over');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        if (files.length) handleFiles(files);
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length) handleFiles(Array.from(fileInput.files));
    });

    // ===== HANDLE FILES =====
    function handleFiles(files) {
        showScreen('loading');
        loadingStatus.textContent = `Przetwarzanie ${files.length} pliku/ów...`;

        let expected = files.length;
        let processed = 0;

        function checkDone() {
            processed++;
            if (processed >= expected) {
                loadingStatus.textContent = 'Generowanie rekomendacji...';
                setTimeout(() => runAnalysis(), 300);
            }
        }

        for (const file of files) {
            handleSingleFile(file, checkDone);
        }
    }

    function handleSingleFile(file, onDone) {
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'csv' || ext === 'tsv' || ext === 'txt') {
            Papa.parse(file, {
                complete: (result) => {
                    processCSVData(result.data);
                    onDone();
                },
                error: (err) => {
                    alert('Błąd parsowania pliku: ' + err.message);
                    onDone();
                },
                skipEmptyLines: true,
            });
        } else if (ext === 'xlsx' || ext === 'xls') {
            const reader = new FileReader();
            reader.onload = function (e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    const rawRows = XLSX.utils.sheet_to_json(sheet, {
                        header: 1,
                        raw: true,
                        defval: '',
                    });
                    const filteredRows = rawRows.filter(row =>
                        row.some(cell => cell !== '' && cell !== null && cell !== undefined)
                    );
                    if (filteredRows.length > 1) {
                        processCSVData(filteredRows);
                    }
                } catch (err) {
                    alert('Błąd odczytu pliku Excel: ' + err.message);
                }
                onDone();
            };
            reader.onerror = function () {
                alert('Nie udało się odczytać pliku.');
                onDone();
            };
            reader.readAsArrayBuffer(file);
        } else {
            alert('Nieobsługiwany format: ' + file.name);
            onDone();
        }
    }

    // ===== PROCESS CSV DATA =====
    function processCSVData(rawRows) {
        let headerIdx = 0;
        for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
            const row = rawRows[i];
            const text = row.join('|').toLowerCase();
            if (text.includes('search term') || text.includes('search query') || text.includes('impressions') || text.includes('clicks') || text.includes('targeting') || text.includes('placement') || text.includes('start time') || text.includes('godzina')) {
                headerIdx = i;
                break;
            }
        }

        const headers = rawRows[headerIdx];
        const colMap = AnalysisEngine.normalizeColumns(headers);
        const dataRows = rawRows.slice(headerIdx + 1);
        const parsed = AnalysisEngine.parseRows(dataRows, colMap);
        
        // Ensure hourly detection is robust
        const isHourly = colMap.startTime !== undefined || headers.some(h => String(h).toLowerCase().includes('start time'));

        if (colMap.sqpVolume !== undefined) {
            parsedDataMap.sqp = parsedDataMap.sqp.concat(parsed);
        } else if (isHourly) {
            parsedDataMap.hourly = parsedDataMap.hourly.concat(parsed);
        } else if (colMap.searchTerm !== undefined) {
            parsedDataMap.searchTerms = parsedDataMap.searchTerms.concat(parsed);
        } else if (colMap.targeting !== undefined) {
            parsedDataMap.targeting = parsedDataMap.targeting.concat(parsed);
        } else if (colMap.placement !== undefined) {
            parsedDataMap.placements = parsedDataMap.placements.concat(parsed);
        }
    }

    // Note: processCSVData has been moved above

    // ===== DEMO DATA =====
    demoBtn.addEventListener('click', () => {
        showScreen('loading');
        loadingStatus.textContent = 'Generowanie danych demo...';

        setTimeout(() => {
            const demoRows = AnalysisEngine.generateDemoData();
            const headers = Object.keys(demoRows[0]);
            const colMap = AnalysisEngine.normalizeColumns(headers);

            const rawArrays = demoRows.map(r => headers.map(h => r[h]));
            parsedDataMap.searchTerms = AnalysisEngine.parseRows(rawArrays, colMap);
            parsedDataMap.targeting = [];
            parsedDataMap.placements = [];
            parsedDataMap.sqp = [];

            loadingStatus.textContent = 'Analizuję dane...';
            setTimeout(() => runAnalysis(), 400);
        }, 500);
    });

    // ===== NEW REPORT =====
    newReportBtn.addEventListener('click', () => {
        parsedDataMap = { searchTerms: [], targeting: [], placements: [], sqp: [], hourly: [] };
        analysisResults = null;
        fileInput.value = '';
        destroyCharts();
        resetFilters();
        showScreen('upload');
    });

    // ===== REANALYZE =====
    reanalyzeBtn.addEventListener('click', () => {
        if (parsedDataMap.searchTerms.length > 0) runAnalysis();
    });

    countryFilter.addEventListener('change', () => {
        if (parsedDataMap.searchTerms.length > 0) runAnalysis();
    });

    campaignFilter.addEventListener('change', () => {
        if (parsedDataMap.searchTerms.length > 0) runAnalysis();
    });

    function populateFilters(dataMap) {
        // --- Country Filter ---
        const allCountries = [
            ...dataMap.searchTerms.map(r => r.country),
            ...dataMap.targeting.map(r => r.country),
            ...dataMap.placements.map(r => r.country)
        ];
        const countries = [...new Set(allCountries.filter(c => c))];
        
        countryFilter.innerHTML = '<option value="all">🌍 Wszystkie kraje</option>';
        countries.sort().forEach(country => {
            const flag = COUNTRY_FLAGS[country] || '🏳️';
            const opt = document.createElement('option');
            opt.value = country;
            opt.textContent = `${flag} ${country}`;
            countryFilter.appendChild(opt);
        });
        countryFilter.closest('.setting-group').style.display = countries.length > 1 ? '' : 'none';

        // --- Campaign Filter ---
        const allCampaigns = [
            ...dataMap.searchTerms.map(r => r.campaign),
            ...dataMap.targeting.map(r => r.campaign),
            ...dataMap.placements.map(r => r.campaign),
            ...dataMap.hourly.map(r => r.campaign)
        ];
        const campaigns = [...new Set(allCampaigns.filter(c => c))];

        campaignFilter.innerHTML = `
            <option value="all">📢 Wszystkie kampanie</option>
            <option value="all_auto">🚜 Wszystkie kampanie AUTO</option>
            <option value="all_manual">🧠 Wszystkie kampanie MANUAL</option>
            <hr>
        `;
        campaigns.sort().forEach(campaign => {
            const opt = document.createElement('option');
            opt.value = campaign;
            opt.textContent = campaign;
            campaignFilter.appendChild(opt);
        });
        campaignFilter.closest('.setting-group').style.display = campaigns.length > 1 ? '' : 'none';
    }

    function resetFilters() {
        countryFilter.innerHTML = '<option value="all">🌍 Wszystkie kraje</option>';
        countryFilter.value = 'all';
        countryFilter.closest('.setting-group').style.display = 'none';

        campaignFilter.innerHTML = '<option value="all">📢 Wszystkie kampanie</option>';
        campaignFilter.value = 'all';
        campaignFilter.closest('.setting-group').style.display = 'none';
    }

    function getFilteredData() {
        const ctry = countryFilter.value;
        const cmp = campaignFilter.value;
        
        const filterFn = (r) => {
            if (ctry !== 'all' && r.country !== ctry) return false;
            
            const isAuto = autoCampaigns.has(r.campaign) || /auto|automatic|automatyczna|\baut\b/i.test(r.campaign);

            if (cmp === 'all_auto') {
                return isAuto;
            }
            if (cmp === 'all_manual') {
                return !isAuto;
            }
            if (cmp !== 'all' && r.campaign.toLowerCase() !== cmp.toLowerCase()) return false;
            
            return true;
        };

        return {
            searchTerms: parsedDataMap.searchTerms.filter(filterFn),
            targeting: parsedDataMap.targeting.filter(filterFn),
            placements: parsedDataMap.placements.filter(filterFn),
            sqp: parsedDataMap.sqp,
            hourly: parsedDataMap.hourly.filter(filterFn)
        };
    }

    // ===== RUN ANALYSIS =====
    function runAnalysis() {
        const settings = {
            targetAcos: parseFloat(document.getElementById('target-acos').value) || 20,
            minSpend: parseFloat(document.getElementById('min-spend').value) || 15,
            minClicks: parseInt(document.getElementById('min-clicks').value) || 10,
            minOrders: parseInt(document.getElementById('min-orders').value) || 2,
        };

        // Populate autoCampaigns Set based on targeting rows
        const autoTargets = ['close-match', 'loose-match', 'substitutes', 'complements'];
        autoCampaigns.clear();
        [...parsedDataMap.searchTerms, ...parsedDataMap.targeting].forEach(row => {
            if (autoTargets.includes(String(row.targeting).toLowerCase())) {
                autoCampaigns.add(row.campaign);
            }
        });

        // Populate filters on first run
        if (countryFilter.options.length <= 1) {
            populateFilters(parsedDataMap);
        }

        const filteredData = getFilteredData();
        
        // Pass the raw targeting array and SQP array so the analyzer can check them
        analysisResults = AnalysisEngine.analyze(filteredData.searchTerms, settings, filteredData.targeting, filteredData.sqp);
        
        // Add targeting and placement analysis
        const targetingResults = AnalysisEngine.analyzeTargeting(filteredData.targeting, settings);
        analysisResults.bids = targetingResults.manualTargets;
        analysisResults.autoTargets = targetingResults.autoTargets;
        
        analysisResults.placements = AnalysisEngine.analyzePlacements(filteredData.placements);
        analysisResults.hourly = AnalysisEngine.analyzeHourly(filteredData.hourly);
        
        renderDashboard();
        showScreen('dashboard');
    }

    // ===== RENDER DASHBOARD =====
    function renderDashboard() {
        const r = analysisResults;

        // KPIs
        setText('kpi-total-spend', formatCurrency(r.kpi.totalSpend));
        setText('kpi-total-sales', formatCurrency(r.kpi.totalSales));
        setText('kpi-avg-acos', r.kpi.avgAcos.toFixed(1) + '%');
        setText('kpi-total-terms', r.kpi.totalTerms.toLocaleString('pl-PL'));
        setText('kpi-wasted-spend', formatCurrency(r.kpi.wastedSpend));
        setText('kpi-roas', r.kpi.roas.toFixed(2) + 'x');

        // Render Deltas
        if (r.kpi.deltas) {
            const setDelta = (id, val, invertedGood = false) => {
                const el = document.getElementById(id);
                if (!el || val === undefined || isNaN(val)) return;
                if (Math.abs(val) < 0.05) { el.innerHTML = ''; return; }
                const isGood = invertedGood ? val < 0 : val > 0;
                const formatted = id.includes('acos') ? `${val > 0 ? '+' : ''}${val.toFixed(1)}%` : `${val > 0 ? '+' : ''}${formatCurrency(val)}`;
                el.innerHTML = ` <span style="font-size:0.75rem; color: ${isGood ? 'var(--accent-success)' : 'var(--accent-danger)'}">${formatted}</span>`;
            };
            setDelta('delta-total-spend', r.kpi.deltas.totalSpend);
            setDelta('delta-avg-acos', r.kpi.deltas.avgAcos, true);
            setDelta('delta-wasted-spend', r.kpi.deltas.wastedSpend, true);
        }

        // Tab counts
        setText('count-wasted', r.wastedSpend.length);
        setText('count-wasted-asins', r.wastedAsins.length);
        setText('count-wasted-words', r.wastedWords.length);
        setText('count-bids', r.bids ? r.bids.length : 0);
        setText('count-auto', r.autoTargets ? r.autoTargets.length : 0);
        setText('count-placements', r.placements ? r.placements.length : 0);
        setText('count-winners', r.winners.length);
        setText('count-skag', r.skag.length);
        setText('count-harvest', r.harvest.length);
        setText('count-harvest-asins', r.harvestAsins.length);
        setText('count-sqp', r.sqpBoost.length);
        setText('count-high-acos', r.highAcos.length);
        
        const hasHourlyData = (r.hourly && r.hourly.some(h => h.spend > 0));
        setText('count-dayparting', hasHourlyData ? '24' : '0');

        // Tables
        renderTable('table-wasted', r.wastedSpend, 'wasted');
        renderTable('table-wasted-asins', r.wastedAsins, 'wastedAsins');
        renderTable('table-wasted-words', r.wastedWords, 'wastedWords');
        renderTable('table-bids', r.bids || [], 'bids');
        renderTable('table-auto-targets', r.autoTargets || [], 'autoTargets');
        renderTable('table-placements', r.placements || [], 'placements');
        renderTable('table-winners', r.winners, 'winners');
        renderTable('table-skag', r.skag, 'skag');
        renderTable('table-harvest', r.harvest, 'harvest');
        renderTable('table-harvest-asins', r.harvestAsins, 'harvestAsins');
        renderTable('table-sqp', r.sqpBoost, 'sqp');
        renderTable('table-high-acos', r.highAcos, 'high-acos');

        // Charts
        renderCharts();

        // Show/hide relevant tabs based on filter
        const cmpVal = campaignFilter.value;
        const bidTab = document.querySelector('.tab[data-tab="bids"]');
        const autoTab = document.querySelector('.tab[data-tab="auto-targets"]');
        
        if (bidTab && autoTab) {
            if (cmpVal === 'all_auto') {
                bidTab.style.display = 'none';
                autoTab.style.display = '';
            } else if (cmpVal === 'all_manual') {
                bidTab.style.display = '';
                autoTab.style.display = 'none';
            } else {
                bidTab.style.display = '';
                autoTab.style.display = '';
            }
        }

        // If the current active tab is now hidden, click the first visible tab
        const activeTab = document.querySelector('.tab.active');
        if (activeTab && activeTab.style.display === 'none') {
            const firstVisible = document.querySelector('.tab:not([style*="display: none"])');
            if (firstVisible) firstVisible.click();
        }
    }

    // ===== RENDER TABLE =====
    const tableSortState = {}; // { tableType: { key: 'spend', dir: 'desc' } }

    const SORT_COLUMNS = [
        { key: 'searchTerm', label: 'Term / Placement / N-Gram', type: 'string' },
        { key: 'ngramContext', label: 'Kontekst (Przykłady)', type: 'string', specificTo: ['wastedWords'] },
        { key: 'campaign', label: 'Kampania', type: 'string' },
        { key: 'country', label: 'Kraj', type: 'string', conditional: true },
        { key: 'impressions', label: 'Impressions', type: 'number' },
        { key: 'clicks', label: 'Clicks', type: 'number' },
        { key: 'spend', label: 'Spend', type: 'number' },
        { key: 'cpc', label: 'CPC', type: 'number' },
        { key: 'sales', label: 'Sales', type: 'number' },
        { key: 'acos', label: 'ACoS', type: 'number' },
        { key: 'currentAcos', label: 'Aktualny ACoS', type: 'number', specificTo: ['bids', 'autoTargets'] },
        { key: 'cpc', label: 'Aktualny CPC', type: 'number', specificTo: ['bids', 'autoTargets'] },
        { key: 'suggestedBid', label: 'Sug. Bid', type: 'number', specificTo: ['bids', 'autoTargets'] },
        { key: 'changePct', label: 'Zmiana %', type: 'number', specificTo: ['bids', 'autoTargets'] },
        { key: 'orders', label: 'Orders', type: 'number' },
        { key: 'priority', label: 'Priorytet', type: 'priority' },
    ];

    const PRIORITY_ORDER = { 'Wysoki': 3, 'Średni': 2, 'Niski': 1 };

    const EXCHANGE_RATES = {
        'EUR': 1,
        'SEK': 0.088,
        'PLN': 0.233,
        'GBP': 1.17,
        'USD': 0.92,
    };

    function sortData(data, sortKey, sortDir) {
        const col = SORT_COLUMNS.find(c => c.key === sortKey);
        if (!col) return data;

        const isCurrency = ['spend', 'sales', 'cpc', 'suggestedBid'].includes(sortKey);

        return [...data].sort((a, b) => {
            let valA, valB;
            if (col.type === 'number') {
                valA = a[sortKey] || 0;
                valB = b[sortKey] || 0;
                
                // If sorting by a monetary column, normalize to EUR for fair comparison
                if (isCurrency) {
                    valA *= (EXCHANGE_RATES[a.currency] || 1);
                    valB *= (EXCHANGE_RATES[b.currency] || 1);
                }
            } else if (col.type === 'priority') {
                valA = PRIORITY_ORDER[a[sortKey]] || 0;
                valB = PRIORITY_ORDER[b[sortKey]] || 0;
            } else {
                valA = (a[sortKey] || '').toLowerCase();
                valB = (b[sortKey] || '').toLowerCase();
            }
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    function renderTable(containerId, data, type) {
        const container = document.getElementById(containerId);
        if (!data || data.length === 0) {
            container.innerHTML = `<div class="empty-state"><span>✅</span><p>Brak wyników w tej kategorii — dobra robota!</p></div>`;
            return;
        }

        const showCountry = countryFilter.value === 'all' && data.some(r => r.country);

        let filteredLocalData = data;
        if (globalSearchQuery) {
            const q = globalSearchQuery.toLowerCase();
            filteredLocalData = filteredLocalData.filter(r => 
                (r.searchTerm && r.searchTerm.toLowerCase().includes(q)) ||
                (r.campaign && r.campaign.toLowerCase().includes(q)) ||
                (r.ngramContext && r.ngramContext.toLowerCase().includes(q)) ||
                (r.adGroup && r.adGroup.toLowerCase().includes(q))
            );
        }

        // Apply sorting
        const sort = tableSortState[type];
        let sortedData = filteredLocalData;
        if (sort) {
            sortedData = sortData(filteredLocalData, sort.key, sort.dir);
        }

        // Build header
        let html = '<table><thead><tr>';
        html += '<th class="th-nosort">#</th>';

        SORT_COLUMNS.forEach(col => {
            if (col.conditional && !showCountry) return;
            if (col.specificTo && !col.specificTo.includes(type)) return;
            
            // hide some columns for bids to save space
            if ((type === 'bids' || type === 'autoTargets') && (col.key === 'impressions' || col.key === 'orders' || col.key === 'acos')) return;
            // hide impressions from wastedWords since it's N/A anyway
            if (type === 'wastedWords' && col.key === 'impressions') return;

            const isActive = sort && sort.key === col.key;
            const arrow = isActive ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
            const cls = isActive ? 'th-sort active' : 'th-sort';
            html += `<th class="${cls}" data-sort-key="${col.key}" data-table-type="${type}">${col.label}${arrow}</th>`;
        });

        html += '<th class="th-nosort" style="width: 40px; text-align: center;">✓</th>';
        html += '<th class="th-nosort">Akcja</th>';
        html += '</tr></thead><tbody>';

        sortedData.forEach((row, i) => {
            const priorityClass = row.priority === 'Wysoki' ? 'badge-danger' :
                                  row.priority === 'Średni' ? 'badge-warning' : 'badge-info';

            const cleanSearch = (row.searchTerm || '').trim();
            const cleanCamp = (row.campaign || '').trim();
            const cleanAdG = (row.adGroup || '').trim();
            const rowId = `${type}_${cleanCamp}_${cleanAdG}_${cleanSearch}`.toLowerCase();
            const isDone = doneRowIds.has(rowId);
            const doneClass = isDone ? 'row-done' : '';

            html += `<tr class="${doneClass}">`;
            html += `<td>${i + 1}</td>`;
            
            const btnCopyHTML = (text) => `<button class="btn-copy" data-copy-text="${escHTML(text)}" title="Kopiuj do schowka">📋</button>`;

            if (type === 'placements') {
                html += `<td class="cell-term"><strong>${escHTML(row.searchTerm)}</strong>${btnCopyHTML(row.searchTerm)}</td>`;
            } else if (type === 'wastedWords') {
                html += `<td class="cell-term"><strong class="text-red">${escHTML(row.searchTerm)}</strong>${btnCopyHTML(row.searchTerm)}</td>`;
                html += `<td class="cell-campaign" style="max-width:200px; white-space:normal; font-size: 0.8em; color: var(--text-muted);">${escHTML(row.ngramContext)}</td>`;
            } else {
                html += `<td class="cell-term" title="${escHTML(row.searchTerm)}">${formatSearchTerm(row.searchTerm, row.country)}${btnCopyHTML(row.searchTerm)}</td>`;
            }
            
            let campaignHTML = escHTML(row.campaign);
            if (type === 'wastedWords' && row.campaign.includes(', ')) {
                campaignHTML = row.campaign.split(', ').map(c => `<div style="margin-bottom: 4px;">&bull; ${escHTML(c)}${btnCopyHTML(c.replace(/\[.*?\]\s*/, ''))}</div>`).join('');
            } else {
                campaignHTML += btnCopyHTML(row.campaign.replace(/\[.*?\]\s*/, '')); // Strip country tags when copying
                
                // Add Ad Group display if available
                if (row.adGroup) {
                    campaignHTML += `<div style="font-size: 0.8em; color: var(--text-muted); margin-top: 4px;">↳ ${escHTML(row.adGroup)}${btnCopyHTML(row.adGroup)}</div>`;
                }
            }
            const fullTitle = row.adGroup ? `${row.campaign} - ${row.adGroup}` : row.campaign;
            html += `<td class="cell-campaign" title="${escHTML(fullTitle)}">${campaignHTML}</td>`;
            if (showCountry) {
                const flag = COUNTRY_FLAGS[row.country] || '';
                html += `<td class="cell-country">${flag} ${escHTML(row.country || '')}</td>`;
            }

            if (type !== 'bids' && type !== 'autoTargets' && type !== 'wastedWords') html += `<td>${row.impressions.toLocaleString('pl-PL')}</td>`;
            html += `<td>${row.clicks.toLocaleString('pl-PL')}</td>`;
            html += `<td>${formatCurrency(row.spend, row.currency, true)}</td>`;
            html += `<td>${formatCurrency(row.cpc, row.currency, true)}</td>`;
            html += `<td>${formatCurrency(row.sales, row.currency, true)}</td>`;
            
            if (type === 'bids' || type === 'autoTargets') {
                html += `<td>${row.currentAcos > 0 ? row.currentAcos.toFixed(1) + '%' : '—'}</td>`;
                html += `<td><strong>${formatCurrency(row.suggestedBid, row.currency, true)}</strong></td>`;
                const changeColor = row.changePct > 20 ? 'text-green' : row.changePct < -20 ? 'text-red' : '';
                const changeP = row.changePct > 0 ? '+' + row.changePct.toFixed(0) : row.changePct.toFixed(0);
                html += `<td class="${changeColor}">${changeP}%</td>`;
            } else {
                html += `<td>${row.acos > 0 && row.acos < 999 ? row.acos.toFixed(1) + '%' : (row.acos === 999 ? '>999%' : '—')}</td>`;
                html += `<td>${row.orders}</td>`;
            }
            html += `<td><span class="badge ${priorityClass}">${row.priority}</span></td>`;
            html += `<td style="text-align: center;"><button class="btn-done" data-row-id="${escHTML(rowId)}" style="margin: 0;">✓</button></td>`;
            html += `<td><span class="action-tag">⚡ ${escHTML(row.action)}</span></td>`;
            html += '</tr>';
        });

        html += '</tbody></table>';
        container.innerHTML = html;

        // Attach Done buttons logic
        container.querySelectorAll('.btn-done').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const rID = btn.dataset.rowId;
                const tr = btn.closest('tr');
                if (doneRowIds.has(rID)) {
                    doneRowIds.delete(rID);
                    tr.classList.remove('row-done');
                } else {
                    doneRowIds.add(rID);
                    tr.classList.add('row-done');
                }
                saveDoneRows();
            });
        });

        // Attach sort handlers
        container.querySelectorAll('.th-sort').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sortKey;
                const tableType = th.dataset.tableType;
                const current = tableSortState[tableType];

                if (current && current.key === key) {
                    // Toggle direction or reset
                    if (current.dir === 'desc') {
                        tableSortState[tableType] = { key, dir: 'asc' };
                    } else {
                        delete tableSortState[tableType]; // reset
                    }
                } else {
                    tableSortState[tableType] = { key, dir: 'desc' };
                }

                // Re-render this table
                const dataMap = {
                    'wasted': analysisResults?.wastedSpend,
                    'wastedAsins': analysisResults?.wastedAsins,
                    'wastedWords': analysisResults?.wastedWords,
                    'bids': analysisResults?.bids,
                    'autoTargets': analysisResults?.autoTargets,
                    'placements': analysisResults?.placements,
                    'winners': analysisResults?.winners,
                    'skag': analysisResults?.skag,
                    'harvest': analysisResults?.harvest,
                    'harvestAsins': analysisResults?.harvestAsins,
                    'sqp': analysisResults?.sqpBoost,
                    'high-acos': analysisResults?.highAcos,
                };
                renderTable(containerId, dataMap[tableType], tableType);
            });
        });
    }

    // ===== RENDER CHARTS =====
    function renderCharts() {
        destroyCharts();
        const cd = analysisResults.chartData;

        // Chart.js global defaults
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        Chart.defaults.color = isLight ? '#475569' : '#8b90a5';
        Chart.defaults.borderColor = isLight ? 'rgba(226,232,240,0.8)' : 'rgba(31,35,53,0.6)';
        Chart.defaults.font.family = "'Inter', sans-serif";
        const gridColor = isLight ? 'rgba(226,232,240,0.5)' : 'rgba(31,35,53,0.4)';

        // Spend vs Sales (Bar chart)
        const ctx1 = document.getElementById('chart-spend-vs-sales').getContext('2d');
        chartInstances.spendVsSales = new Chart(ctx1, {
            type: 'bar',
            data: {
                labels: cd.spendVsSales.labels,
                datasets: [
                    {
                        label: 'Spend',
                        data: cd.spendVsSales.spend,
                        backgroundColor: 'rgba(99,102,241,0.7)',
                        borderColor: 'rgba(99,102,241,1)',
                        borderWidth: 1,
                        borderRadius: 4,
                    },
                    {
                        label: 'Sales',
                        data: cd.spendVsSales.sales,
                        backgroundColor: 'rgba(16,185,129,0.7)',
                        borderColor: 'rgba(16,185,129,1)',
                        borderWidth: 1,
                        borderRadius: 4,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 2,
                plugins: {
                    legend: { position: 'top', labels: { usePointStyle: true, padding: 20 } },
                },
                scales: {
                    x: { ticks: { maxRotation: 45, font: { size: 10 } }, grid: { display: false } },
                    y: { beginAtZero: true, grid: { color: gridColor } }
                }
            }
        });

        // Spend Efficiency (Doughnut)
        const ctx2 = document.getElementById('chart-acos-distribution').getContext('2d');
        chartInstances.spendEfficiency = new Chart(ctx2, {
            type: 'doughnut',
            data: {
                labels: cd.spendEfficiency.labels,
                datasets: [{
                    data: cd.spendEfficiency.values,
                    backgroundColor: [
                        'rgba(16,185,129,0.8)', // Productive
                        'rgba(239,68,68,0.7)',  // Wasted
                    ],
                    borderWidth: 0,
                    spacing: 4,
                }]
            },
            options: {
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { usePointStyle: true, padding: 20, font: { size: 12 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const val = parseFloat(context.raw);
                                return ` Wydatki: ${val.toFixed(2)} €`;
                            }
                        }
                    }
                },
                cutout: '70%',
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: 1.5,
            }
        });

        // Day-parting Heatmap Chart (only if data exists)
        const hourlyData = analysisResults.hourly;
        const hasHourlyData = hourlyData && hourlyData.some(h => h.spend > 0);
        
        if (hasHourlyData) {
            const ctx3 = document.getElementById('chart-dayparting');
            if (ctx3) {
                const hourLabels = hourlyData.map(h => `${String(h.hour).padStart(2, '0')}:00`);
                const acosData = hourlyData.map(h => h.acos);
                const clicksData = hourlyData.map(h => h.clicks);
                
                chartInstances.dayparting = new Chart(ctx3.getContext('2d'), {
                    type: 'bar',
                    data: {
                        labels: hourLabels,
                        datasets: [
                            {
                                label: 'ACoS (%)',
                                data: acosData,
                                type: 'line',
                                borderColor: 'rgba(239,68,68,1)', // Red for ACoS
                                backgroundColor: 'rgba(239,68,68,0.2)',
                                fill: true,
                                tension: 0.3,
                                yAxisID: 'y'
                            },
                            {
                                label: 'Clicks',
                                data: clicksData,
                                type: 'bar',
                                backgroundColor: 'rgba(59,130,246,0.6)', // Blue for Volume
                                borderColor: 'rgba(59,130,246,1)',
                                borderWidth: 1,
                                borderRadius: 4,
                                yAxisID: 'y1'
                            }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'top', labels: { usePointStyle: true, padding: 10 } },
                            tooltip: {
                                callbacks: {
                                    afterLabel: function(ctx) {
                                        const h = hourlyData[ctx.dataIndex];
                                        return `Spend: €${h.spend.toFixed(2)} | Orders: ${h.orders}`;
                                    }
                                }
                            }
                        },
                        scales: {
                            x: { grid: { display: false } },
                            y: {
                                type: 'linear',
                                display: true,
                                position: 'left',
                                title: { display: true, text: 'ACoS (%)' },
                                grid: { color: gridColor },
                                suggestedMax: 100
                            },
                            y1: {
                                type: 'linear',
                                display: true,
                                position: 'right',
                                title: { display: true, text: 'Clicks' },
                                grid: { drawOnChartArea: false }
                            }
                        }
                    }
                });
            }
        }
    }

    function destroyCharts() {
        Object.values(chartInstances).forEach(c => c && c.destroy());
        chartInstances = {};
    }

    // ===== TABS =====
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            
            // Resize charts if opening 'charts' tab so they don't squish
            if (tab.dataset.tab === 'charts') {
                Object.values(chartInstances).forEach(c => { if(c) c.resize(); });
            }
        });
    });

    if (globalSearchInput) {
        globalSearchInput.addEventListener('input', (e) => {
            globalSearchQuery = e.target.value.trim();
            if (analysisResults) {
                renderDashboard();
            }
        });
    }

    // ===== GLOBAL COPY LISTENER =====
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-copy');
        if (!btn) return;
        
        const textToCopy = btn.dataset.copyText;
        if (!textToCopy) return;
        
        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = btn.innerHTML;
            btn.innerHTML = '✅';
            setTimeout(() => { btn.innerHTML = originalText; }, 1000);
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    });

    document.querySelectorAll('.btn-export').forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.dataset.export;
            const dataMap = {
                'wasted': analysisResults?.wastedSpend,
                'wastedAsins': analysisResults?.wastedAsins,
                'wastedWords': analysisResults?.wastedWords,
                'bids': analysisResults?.bids,
                'autoTargets': analysisResults?.autoTargets,
                'placements': analysisResults?.placements,
                'winners': analysisResults?.winners,
                'skag': analysisResults?.skag,
                'harvest': analysisResults?.harvest,
                'harvestAsins': analysisResults?.harvestAsins,
                'sqp': analysisResults?.sqpBoost,
                'high-acos': analysisResults?.highAcos,
            };
            const data = dataMap[type];
            if (!data || data.length === 0) return;

            const isWastedWords = type === 'wastedWords';
            const isSqp = type === 'sqp';
            
            let headers;
            if (isWastedWords) {
                headers = ['N-Gram (Złe Słowo)', 'Kontekst (Przykłady)', 'Kampanie', 'Clicks', 'Spend', 'Sales', 'ACoS', 'Orders', 'Priority', 'Action'];
            } else if (isSqp) {
                headers = ['Search Term', 'Campaign', 'Ad Group', 'SQP Volume', 'SQP Brand Share %', 'ACoS', 'Sales', 'Orders', 'Spend', 'Priority', 'Action'];
            } else {
                headers = ['Search Term', 'Campaign', 'Ad Group', 'Match Type', 'Impressions', 'Clicks', 'Spend', 'Sales', 'ACoS', 'Orders', 'Priority', 'Action'];
            }
            
            const rows = data.map(r => {
                const acosVal = r.acos === 999 ? '>999%' : r.acos.toFixed(1) + '%';
                if (isWastedWords) {
                    return [
                        r.searchTerm, r.ngramContext, r.campaign,
                        r.clicks, r.spend, r.sales, acosVal, r.orders, r.priority, r.action
                    ];
                } else if (isSqp) {
                    return [
                        r.searchTerm, r.campaign, r.adGroup, r.sqpVolume, r.sqpBrandShare + '%', 
                        acosVal, r.sales, r.orders, r.spend, r.priority, r.action
                    ];
                } else {
                    return [
                        r.searchTerm, r.campaign, r.adGroup, r.matchType,
                        r.impressions, r.clicks, r.spend, r.sales,
                        acosVal, r.orders, r.priority, r.action
                    ];
                }
            });

            let csv = headers.join(',') + '\n';
            rows.forEach(row => {
                csv += row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',') + '\n';
            });

            const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `amazon-ads-${type}-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });
    });

    // ===== HELPERS =====
    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function formatCurrency(val, currency, showExchange = false) {
        const base = new Intl.NumberFormat('pl-PL', {
            style: 'currency',
            currency: currency || 'EUR',
            minimumFractionDigits: 2,
        }).format(val);
        
        if (showExchange && currency && currency !== 'EUR' && EXCHANGE_RATES[currency]) {
            const eurVal = val * EXCHANGE_RATES[currency];
            const eurStr = new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'EUR' }).format(eurVal);
            return `${base} <span style="font-size: 0.75em; color: var(--text-muted); display: block; margin-top: 2px;">≈ ${eurStr}</span>`;
        }
        
        return base;
    }

    function escHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    /**
     * Detect ASINs and make them clickable links to Amazon.de
     * ASIN pattern: B0 + 8 alphanumeric characters (case-insensitive)
     */
    function isASIN(text) {
        return /^[Bb]0[A-Za-z0-9]{8}$/i.test(text.trim());
    }

    function extractASIN(text) {
        // Match standalone ASIN or ASIN inside asin="..." pattern
        const match = text.match(/\b([Bb]0[A-Za-z0-9]{8})\b/i);
        return match ? match[1].toUpperCase() : null;
    }

    function formatSearchTerm(term, country) {
        const escaped = escHTML(term);
        const domain = COUNTRY_DOMAINS[country] || 'amazon.de';
        const linkIcon = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 4px;"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

        const asin = extractASIN(term);
        if (asin) {
            // ASIN → product page
            const url = `https://www.${domain}/dp/${asin}`;
            return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="asin-link" title="Produkt na ${domain}">${escaped} ${linkIcon}</a>`;
        }

        // Regular search term → Amazon search results
        const searchQuery = encodeURIComponent(term.trim());
        const searchUrl = `https://www.${domain}/s?k=${searchQuery}`;
        return `<a href="${searchUrl}" target="_blank" rel="noopener noreferrer" class="search-link" title="Szukaj na ${domain}">${escaped} ${linkIcon}</a>`;
    }

})();
