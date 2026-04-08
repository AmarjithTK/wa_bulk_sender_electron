const { ipcRenderer } = require('electron');
const { Client, MessageMedia, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');
const xlsx = require('xlsx');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const path = require('path');
const os = require('os');

const STORAGE_CONFIG_FILE_NAME = 'storage_config.json';
const STORE_FILE_NAME = 'campaign_store.json';
const AUTH_DIR_NAME = 'whatsapp-session-auth';
const MANAGED_STORAGE_DIR_NAME = 'wa_sender_data';

let puppeteerExecutablePath = null;
try {
    const puppeteer = require('puppeteer');
    if (puppeteer && typeof puppeteer.executablePath === 'function') {
        puppeteerExecutablePath = puppeteer.executablePath();
    }
} catch (error) {
    puppeteerExecutablePath = null;
}

const state = {
    appDataPath: null,
    storageConfigPath: null,
    storageRootPath: null,
    authDataPath: null,
    storePath: null,
    store: {
        version: 1,
        sessions: [],
        campaigns: [],
        lastDraft: null,
        activeCampaignId: null,
        settings: {
            showBrowserOnConnect: false
        }
    },
    clients: new Map(),
    qrImages: new Map(),
    selectedFilePath: null,
    selectedMediaPath: null,
    excelRows: [],
    excelColumns: [],
    contacts: [],
    isLoopRunning: false,
    loopStopRequested: false,
    reconnectTimers: new Map(),
    reconnectAttempts: new Map(),
    sessionInitPromises: new Map(),
    pendingRenameSessionId: null
};

function byId(id) {
    return document.getElementById(id);
}

function isMdSelect(el) {
    return !!el && String(el.tagName || '').toLowerCase().includes('md-outlined-select');
}

function setSelectItems(selectEl, items, emptyLabel = 'No items') {
    if (!selectEl) return;

    if (isMdSelect(selectEl)) {
        selectEl.innerHTML = '';

        if (!items || items.length === 0) {
            const empty = document.createElement('md-select-option');
            empty.value = '';
            empty.setAttribute('disabled', '');
            empty.innerHTML = `<div slot="headline">${emptyLabel}</div>`;
            selectEl.appendChild(empty);
            selectEl.value = '';
            return;
        }

        items.forEach(item => {
            const opt = document.createElement('md-select-option');
            opt.value = item.value;
            opt.innerHTML = `<div slot="headline">${item.label}</div>`;
            selectEl.appendChild(opt);
        });

        selectEl.value = items[0].value;
        return;
    }

    selectEl.innerHTML = '';
    if (!items || items.length === 0) {
        const empty = document.createElement('option');
        empty.value = '';
        empty.textContent = emptyLabel;
        selectEl.appendChild(empty);
        return;
    }

    items.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        selectEl.appendChild(option);
    });
}

function showSnackbar(message, duration = 3200) {
    const snackbar = byId('snackbar');
    snackbar.textContent = message;
    snackbar.style.display = 'block';
    setTimeout(() => {
        snackbar.style.display = 'none';
    }, duration);
}

function uniqueId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true, mode: 0o755 });
    }
}

function getManagedStorageRoot(baseFolder) {
    return path.join(baseFolder, MANAGED_STORAGE_DIR_NAME);
}

function configureStoragePaths(storageRootPath) {
    state.storageRootPath = storageRootPath;
    state.authDataPath = path.join(storageRootPath, AUTH_DIR_NAME);
    state.storePath = path.join(storageRootPath, STORE_FILE_NAME);
    ensureDirectoryExists(state.storageRootPath);
    ensureDirectoryExists(state.authDataPath);
}

function loadStorageConfig() {
    try {
        if (!state.storageConfigPath || !fs.existsSync(state.storageConfigPath)) {
            return {};
        }
        const parsed = JSON.parse(fs.readFileSync(state.storageConfigPath, 'utf-8'));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Failed to load storage config', error);
        return {};
    }
}

function saveStorageConfig(config) {
    try {
        fs.writeFileSync(state.storageConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to save storage config', error);
    }
}

function copyDirIfExists(sourceDir, targetDir) {
    if (!fs.existsSync(sourceDir)) return;
    ensureDirectoryExists(path.dirname(targetDir));
    fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
}

function copyFileIfExists(sourceFile, targetFile) {
    if (!fs.existsSync(sourceFile)) return;
    ensureDirectoryExists(path.dirname(targetFile));
    fs.copyFileSync(sourceFile, targetFile);
}

function migrateLegacyDataIfNeeded(targetStorageRoot) {
    if (!targetStorageRoot || targetStorageRoot === state.appDataPath) return;

    const legacyStorePath = path.join(state.appDataPath, STORE_FILE_NAME);
    const legacyAuthPath = path.join(state.appDataPath, AUTH_DIR_NAME);
    const targetStorePath = path.join(targetStorageRoot, STORE_FILE_NAME);
    const targetAuthPath = path.join(targetStorageRoot, AUTH_DIR_NAME);
    const hasLegacyData = fs.existsSync(legacyStorePath) || fs.existsSync(legacyAuthPath);
    const hasTargetData = fs.existsSync(targetStorePath) || fs.existsSync(targetAuthPath);

    if (!hasLegacyData || hasTargetData) return;

    copyFileIfExists(legacyStorePath, targetStorePath);
    copyDirIfExists(legacyAuthPath, targetAuthPath);
}

function cloneCurrentDataToStorage(targetStorageRoot) {
    if (!targetStorageRoot) return;
    ensureDirectoryExists(targetStorageRoot);
    copyFileIfExists(state.storePath, path.join(targetStorageRoot, STORE_FILE_NAME));
    copyDirIfExists(state.authDataPath, path.join(targetStorageRoot, AUTH_DIR_NAME));
}

function renderStoragePanel() {
    const label = byId('storagePathLabel');
    if (!label) return;
    label.textContent = state.storageRootPath || 'Not configured yet';
}

async function chooseStorageFolderFlow() {
    const selectedBase = await ipcRenderer.invoke('select-folder', {
        title: 'Choose folder to save configs and sessions',
        defaultPath: state.storageRootPath || state.appDataPath
    });

    if (!selectedBase) return false;

    const selectedStorageRoot = getManagedStorageRoot(selectedBase);
    if (selectedStorageRoot === state.storageRootPath) {
        showSnackbar('This folder is already in use.');
        return true;
    }

    cloneCurrentDataToStorage(selectedStorageRoot);
    saveStorageConfig({ storageRootPath: selectedStorageRoot });
    showSnackbar('Storage folder updated. Reloading...', 2200);
    setTimeout(() => window.location.reload(), 400);
    return true;
}

function buildBackupFolderName() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `wa_sender_backup_${timestamp}`;
}

async function createBackupSnapshot() {
    const backupDestinationBase = await ipcRenderer.invoke('select-folder', {
        title: 'Choose destination folder for backup',
        defaultPath: state.storageRootPath || state.appDataPath
    });
    if (!backupDestinationBase) return;

    const backupFolder = path.join(backupDestinationBase, buildBackupFolderName());
    ensureDirectoryExists(backupFolder);
    saveStore();

    copyFileIfExists(state.storePath, path.join(backupFolder, STORE_FILE_NAME));
    copyDirIfExists(state.authDataPath, path.join(backupFolder, AUTH_DIR_NAME));

    const metadata = {
        createdAt: new Date().toISOString(),
        sourceStorageRoot: state.storageRootPath,
        files: [STORE_FILE_NAME, AUTH_DIR_NAME]
    };
    fs.writeFileSync(path.join(backupFolder, 'backup_metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');
    showSnackbar(`Backup created: ${backupFolder}`, 4200);
}

async function restoreBackupSnapshot() {
    const backupFolder = await ipcRenderer.invoke('select-folder', {
        title: 'Choose backup folder to restore',
        defaultPath: state.storageRootPath || state.appDataPath
    });
    if (!backupFolder) return;

    const backupStorePath = path.join(backupFolder, STORE_FILE_NAME);
    const backupAuthPath = path.join(backupFolder, AUTH_DIR_NAME);
    const hasBackupData = fs.existsSync(backupStorePath) || fs.existsSync(backupAuthPath);
    if (!hasBackupData) {
        showSnackbar('Selected folder does not contain a valid backup.', 4200);
        return;
    }

    if (!confirm('Restore will replace current configs and sessions. Continue?')) {
        return;
    }

    await cleanup();
    state.clients.clear();

    if (fs.existsSync(state.storePath)) {
        fs.rmSync(state.storePath, { force: true });
    }
    if (fs.existsSync(state.authDataPath)) {
        fs.rmSync(state.authDataPath, { recursive: true, force: true });
    }

    ensureDirectoryExists(state.storageRootPath);
    ensureDirectoryExists(state.authDataPath);

    copyFileIfExists(backupStorePath, state.storePath);
    copyDirIfExists(backupAuthPath, state.authDataPath);

    showSnackbar('Backup restored. Reloading...', 2600);
    setTimeout(() => window.location.reload(), 500);
}

function saveStore() {
    fs.writeFileSync(state.storePath, JSON.stringify(state.store, null, 2), 'utf-8');
}

function loadStore() {
    try {
        if (fs.existsSync(state.storePath)) {
            const parsed = JSON.parse(fs.readFileSync(state.storePath, 'utf-8'));
            state.store = {
                version: 1,
                sessions: [],
                campaigns: [],
                lastDraft: null,
                activeCampaignId: null,
                settings: {
                    showBrowserOnConnect: false
                },
                ...parsed
            };
            state.store.settings = {
                showBrowserOnConnect: false,
                ...(parsed.settings || {})
            };
        } else {
            saveStore();
        }
    } catch (error) {
        console.error('Store load failed. Resetting store.', error);
        state.store = {
            version: 1,
            sessions: [],
            campaigns: [],
            lastDraft: null,
            activeCampaignId: null,
            settings: {
                showBrowserOnConnect: false
            }
        };
        saveStore();
    }
}

function sanitizeName(name) {
    return (name || '').trim().slice(0, 40);
}

function findSession(sessionId) {
    return state.store.sessions.find(s => s.id === sessionId) || null;
}

function sessionChip(status) {
    if (status === 'ready') return '<span class="chip ready">ready</span>';
    if (status === 'connecting' || status === 'qr') return '<span class="chip pending">pending</span>';
    return '<span class="chip error">offline</span>';
}

function updateAuthStatus(text) {
    byId('authStatus').textContent = text;
}

function updateProgress(sent, total) {
    const percent = total > 0 ? Math.floor((sent / total) * 100) : 0;
    byId('progressBarFill').style.width = `${percent}%`;
    byId('progressText').textContent = `${sent}/${total} messages sent`;
}

function normalizeNumber(rawNumber, defaultCountryCode) {
    if (rawNumber === null || rawNumber === undefined) return null;
    const raw = String(rawNumber).trim();
    if (!raw) return null;

    const hasPlus = raw.startsWith('+');
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) return null;

    if (!hasPlus) {
        digits = digits.replace(/^0+/, '');
        if (defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
            digits = `${defaultCountryCode}${digits}`;
        }
    }

    if (digits.length < 8 || digits.length > 15) return null;
    return digits;
}

function validateNumber(rawNumber, defaultCountryCode) {
    if (rawNumber === null || rawNumber === undefined) {
        return { normalized: null, reason: 'empty value' };
    }

    const raw = String(rawNumber).trim();
    if (!raw) {
        return { normalized: null, reason: 'empty value' };
    }

    const hasPlus = raw.startsWith('+');
    let digits = raw.replace(/[^\d]/g, '');
    if (!digits) {
        return { normalized: null, reason: 'no digits' };
    }

    if (!hasPlus) {
        digits = digits.replace(/^0+/, '');
        if (defaultCountryCode && !digits.startsWith(defaultCountryCode)) {
            digits = `${defaultCountryCode}${digits}`;
        }
    }

    if (digits.length < 8) {
        return { normalized: null, reason: 'too short' };
    }

    if (digits.length > 15) {
        return { normalized: null, reason: 'too long' };
    }

    return { normalized: digits, reason: null };
}

function readExcelRows(filePath) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet, { defval: '' });
}

function parseContactsFromExcel(phoneColumn) {
    const defaultCode = byId('defaultCountryCode').value.trim();
    const rows = state.excelRows;
    const contacts = [];
    const seen = new Set();
    let invalidCount = 0;
    let duplicateCount = 0;
    const invalidSamples = [];
    const invalidReasonCounts = {};

    rows.forEach((row, idx) => {
        const { normalized, reason } = validateNumber(row[phoneColumn], defaultCode);
        if (!normalized) {
            invalidCount += 1;
            invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1;
            if (invalidSamples.length < 8) {
                invalidSamples.push(`Row ${idx + 2}: "${String(row[phoneColumn] || '').slice(0, 40)}" (${reason})`);
            }
            return;
        }
        if (seen.has(normalized)) {
            duplicateCount += 1;
            return;
        }
        seen.add(normalized);
        contacts.push({
            id: `excel_${idx}`,
            source: 'excel',
            rawNumber: String(row[phoneColumn] || ''),
            normalizedNumber: normalized,
            rowData: row
        });
    });

    return { contacts, invalidCount, duplicateCount, invalidSamples, invalidReasonCounts };
}

function parseContactsFromManual(inputText) {
    const defaultCode = byId('defaultCountryCode').value.trim();
    const tokens = inputText
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean);

    const contacts = [];
    const seen = new Set(state.contacts.map(c => c.normalizedNumber));
    let invalidCount = 0;
    let duplicateCount = 0;
    const invalidSamples = [];
    const invalidReasonCounts = {};

    tokens.forEach((token, idx) => {
        const { normalized, reason } = validateNumber(token, defaultCode);
        if (!normalized) {
            invalidCount += 1;
            invalidReasonCounts[reason] = (invalidReasonCounts[reason] || 0) + 1;
            if (invalidSamples.length < 8) {
                invalidSamples.push(`Manual ${idx + 1}: "${token.slice(0, 40)}" (${reason})`);
            }
            return;
        }
        if (seen.has(normalized)) {
            duplicateCount += 1;
            return;
        }
        seen.add(normalized);
        contacts.push({
            id: `manual_${idx}_${normalized}`,
            source: 'manual',
            rawNumber: token,
            normalizedNumber: normalized,
            rowData: {}
        });
    });

    return { contacts, invalidCount, duplicateCount, invalidSamples, invalidReasonCounts };
}

function formatInvalidSummary(invalidReasonCounts, invalidSamples, duplicateCount) {
    const reasonText = Object.entries(invalidReasonCounts)
        .map(([reason, count]) => `${reason}: ${count}`)
        .join(' | ');
    const sampleText = invalidSamples.join(' | ');
    return `Duplicates: ${duplicateCount}${reasonText ? ` | Invalid reasons -> ${reasonText}` : ''}${sampleText ? ` | Samples -> ${sampleText}` : ''}`;
}

function clearReconnectTimer(sessionId) {
    const timer = state.reconnectTimers.get(sessionId);
    if (timer) {
        clearTimeout(timer);
        state.reconnectTimers.delete(sessionId);
    }
}

function scheduleReconnect(sessionId) {
    const session = findSession(sessionId);
    if (!session) return;

    clearReconnectTimer(sessionId);
    const attempts = (state.reconnectAttempts.get(sessionId) || 0) + 1;
    state.reconnectAttempts.set(sessionId, attempts);

    const delayMs = Math.min(30000, attempts * 4000);
    const timer = setTimeout(async () => {
        const liveSession = findSession(sessionId);
        if (!liveSession) return;
        if (!['disconnected', 'error', 'new'].includes(liveSession.status)) return;

        try {
            // Respect user preference: visible window for all work or fully headless.
            await ensureSessionClient(sessionId, {
                visibleBrowser: !!state.store.settings.showBrowserOnConnect
            });
            state.reconnectAttempts.set(sessionId, 0);
        } catch (error) {
            console.error('Auto reconnect failed', error);
            scheduleReconnect(sessionId);
        }
    }, delayMs);

    state.reconnectTimers.set(sessionId, timer);
}

function removeSessionAuthData(clientId) {
    if (!clientId || !state.authDataPath) return;

    const targets = [
        path.join(state.authDataPath, `session-${clientId}`),
        path.join(state.authDataPath, clientId),
        path.join(state.authDataPath, '.wwebjs_auth', `session-${clientId}`)
    ];

    targets.forEach(target => {
        if (fs.existsSync(target)) {
            try {
                fs.rmSync(target, { recursive: true, force: true });
            } catch (error) {
                console.error('Failed to remove auth path', target, error);
            }
        }
    });
}

function clearChromiumProfileLocks(clientId) {
    if (!clientId || !state.authDataPath) return;

    const profileRootCandidates = [
        path.join(state.authDataPath, `session-${clientId}`),
        path.join(state.authDataPath, '.wwebjs_auth', `session-${clientId}`)
    ];

    const lockFileNames = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

    for (const profileRoot of profileRootCandidates) {
        if (!fs.existsSync(profileRoot)) continue;

        const candidateDirs = [
            profileRoot,
            path.join(profileRoot, 'Default')
        ];

        for (const candidateDir of candidateDirs) {
            if (!fs.existsSync(candidateDir)) continue;
            for (const lockFileName of lockFileNames) {
                const lockPath = path.join(candidateDir, lockFileName);
                if (fs.existsSync(lockPath)) {
                    try {
                        fs.rmSync(lockPath, { force: true });
                    } catch (error) {
                        console.error('Failed to remove chromium profile lock', lockPath, error);
                    }
                }
            }
        }
    }
}

function applyTemplate(template, rowData) {
    // Legacy placeholder support: {column}. Do not touch ${column} placeholders.
    return template.replace(/(\$)?\{([^}]+)\}/g, (fullMatch, dollarPrefix, key) => {
        if (dollarPrefix) {
            return fullMatch;
        }
        const value = rowData[key.trim()];
        return value === undefined || value === null ? '' : String(value);
    });
}

function getRowValueCaseInsensitive(rowData, searchKey) {
    if (!rowData || !searchKey) return null;
    const normalizedSearch = String(searchKey).trim().toLowerCase();
    const keys = Object.keys(rowData);

    const exactKey = keys.find(k => String(k).trim().toLowerCase() === normalizedSearch);
    if (exactKey && rowData[exactKey] !== undefined && rowData[exactKey] !== null && String(rowData[exactKey]).trim() !== '') {
        return rowData[exactKey];
    }

    const looseKey = keys.find(k => String(k).trim().toLowerCase().replace(/[_\s-]+/g, '') === normalizedSearch.replace(/[_\s-]+/g, ''));
    if (looseKey && rowData[looseKey] !== undefined && rowData[looseKey] !== null && String(rowData[looseKey]).trim() !== '') {
        return rowData[looseKey];
    }

    return null;
}

function getBestNameFromRow(rowData) {
    if (!rowData) return null;

    const direct = getRowValueCaseInsensitive(rowData, 'name')
        || getRowValueCaseInsensitive(rowData, 'full name')
        || getRowValueCaseInsensitive(rowData, 'customer name')
        || getRowValueCaseInsensitive(rowData, 'contact name');

    if (direct !== null && direct !== undefined && String(direct).trim() !== '') {
        return String(direct).trim();
    }

    const keys = Object.keys(rowData);
    const fuzzy = keys.find(key => /name/i.test(String(key)));
    if (fuzzy) {
        const value = rowData[fuzzy];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }

    return null;
}

function applyDollarTemplate(template, rowData, waContact, nameFallback) {
    return template.replace(/\$\{\s*([^}]+?)\s*\}/g, (_, rawKey) => {
        const key = String(rawKey).trim();
        if (!key) return '';

        if (key.toLowerCase() === 'name') {
            const resolvedName = getBestNameFromRow(rowData)
                || waContact?.pushname
                || waContact?.name
                || nameFallback;
            return resolvedName ? String(resolvedName) : '';
        }

        if (key.toLowerCase() === 'pushname') {
            return waContact?.pushname ? String(waContact.pushname) : '';
        }

        if (key.toLowerCase() === 'waname' || key.toLowerCase() === 'wa_name') {
            return waContact?.name ? String(waContact.name) : '';
        }

        const rowValue = getRowValueCaseInsensitive(rowData, key);
        if (rowValue !== null && rowValue !== undefined) {
            return String(rowValue);
        }

        return '';
    });
}

function getCampaignById(campaignId) {
    return state.store.campaigns.find(c => c.id === campaignId) || null;
}

function getReadySessionIds() {
    return state.store.sessions
        .filter(s => s.status === 'ready' && state.clients.has(s.id))
        .map(s => s.id);
}

function getSelectedSessionIds(sendMode, singleId, poolIds) {
    if (sendMode === 'single') return singleId ? [singleId] : [];
    return poolIds;
}

function pickSessionForCampaign(campaign) {
    const readyIds = getReadySessionIds().filter(id => campaign.selectedSessionIds.includes(id));
    if (readyIds.length === 0) return null;

    if (campaign.sendMode === 'single') {
        return readyIds[0] || null;
    }

    if (!campaign.roundRobinIndex) campaign.roundRobinIndex = 0;
    const chosen = readyIds[campaign.roundRobinIndex % readyIds.length];
    campaign.roundRobinIndex += 1;
    return chosen;
}

async function ensureSessionClient(sessionId, options = {}) {
    let { forceReconnect = false, visibleBrowser = null } = options;

    const pendingInit = state.sessionInitPromises.get(sessionId);
    if (pendingInit && !forceReconnect) {
        return pendingInit;
    }

    const existingSession = findSession(sessionId);
    if (!existingSession) throw new Error('Session not found');
    if (state.clients.has(sessionId) && visibleBrowser !== null && !!existingSession.browserVisible !== !!visibleBrowser) {
        forceReconnect = true;
    }

    if (state.clients.has(sessionId) && !forceReconnect) return state.clients.get(sessionId);
    const session = existingSession;

    if (forceReconnect && state.clients.has(sessionId)) {
        try {
            const existing = state.clients.get(sessionId);
            await existing.destroy();
        } catch (error) {
            console.error('Existing client destroy before reconnect failed', error);
        }
        state.clients.delete(sessionId);
        clearReconnectTimer(sessionId);
    }

    const shouldShowBrowser = visibleBrowser !== null
        ? !!visibleBrowser
        : !!state.store.settings.showBrowserOnConnect;

    session.status = 'connecting';
    session.browserVisible = shouldShowBrowser;
    saveStore();
    renderAll();

    const createClient = (useBundledChromium) => {
        const puppeteerOptions = {
            headless: !shouldShowBrowser,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--window-size=1366,900'
            ]
        };

        if (useBundledChromium && puppeteerExecutablePath) {
            // Prefer bundled modern Chromium to avoid system Chrome path issues.
            puppeteerOptions.executablePath = puppeteerExecutablePath;
        }

        return new Client({
            authStrategy: new LocalAuth({
                dataPath: state.authDataPath,
                clientId: session.clientId
            }),
            puppeteer: puppeteerOptions
        });
    };

    const wireClientEvents = (clientInstance) => {
        clientInstance.on('qr', async (qr) => {
            session.status = 'qr';
            session.lastError = null;
            saveStore();
            try {
                const qrImage = await QRCode.toDataURL(qr, { width: 220, margin: 1 });
                state.qrImages.set(sessionId, qrImage);
                if (byId('authSessionSelect').value === sessionId) {
                    byId('qrCode').innerHTML = `<img src="${qrImage}" alt="QR Code">`;
                    updateAuthStatus(`Scan QR for ${session.name}`);
                }
            } catch (error) {
                console.error('QR generation failed', error);
            }
            renderAll();
        });

        clientInstance.on('authenticated', () => {
            session.status = 'authenticated';
            session.lastSeenAt = new Date().toISOString();
            session.lastError = null;
            saveStore();
            renderAll();
            showSnackbar(`Authenticated: ${session.name}`);
        });

        clientInstance.on('ready', () => {
            session.status = 'ready';
            session.lastSeenAt = new Date().toISOString();
            session.lastError = null;
            state.reconnectAttempts.set(sessionId, 0);
            clearReconnectTimer(sessionId);
            state.qrImages.delete(sessionId);
            if (byId('authSessionSelect').value === sessionId) {
                byId('qrCode').innerHTML = 'Session is ready';
                updateAuthStatus(`${session.name} is ready`);
            }
            saveStore();
            renderAll();
            showSnackbar(`Ready: ${session.name}`);
        });

        clientInstance.on('auth_failure', (message) => {
            session.status = 'error';
            session.lastError = message || 'Authentication failed';
            saveStore();
            renderAll();
            showSnackbar(`Auth failed: ${session.name}`, 5000);
            scheduleReconnect(sessionId);
        });

        clientInstance.on('disconnected', (reason) => {
            session.status = 'disconnected';
            session.lastError = reason || 'Disconnected';
            state.clients.delete(sessionId);
            saveStore();
            renderAll();
            showSnackbar(`Disconnected: ${session.name}`, 4000);
            scheduleReconnect(sessionId);
        });
    };

    // Prefer bundled Chromium; fallback launcher is kept as backup.
    const initPromise = (async () => {
        let shouldUseBundledChromium = !!puppeteerExecutablePath;
        const allowFallbackLauncher = true;
        let client = createClient(shouldUseBundledChromium);
        wireClientEvents(client);

        const initializeWithRecovery = async () => {
            try {
                await client.initialize();
            } catch (error) {
                const errorText = String(error && error.message ? error.message : error);
                const electronLaunchFailure = /Unable to find Electron app|about:blank|Failed to launch the browser process/i.test(errorText);
                const alreadyRunningError = /browser is already running|Use a different `userDataDir`/i.test(errorText);

                if (alreadyRunningError) {
                    clearChromiumProfileLocks(session.clientId);
                    try {
                        await client.destroy();
                    } catch (destroyError) {
                        console.error('Client destroy after lock error', destroyError);
                    }

                    client = createClient(shouldUseBundledChromium);
                    wireClientEvents(client);
                    await client.initialize();
                    return;
                }

                if (shouldUseBundledChromium && electronLaunchFailure && allowFallbackLauncher) {
                    try {
                        await client.destroy();
                    } catch (destroyError) {
                        console.error('Client destroy after failed launch', destroyError);
                    }

                    shouldUseBundledChromium = false;
                    client = createClient(false);
                    wireClientEvents(client);
                    await client.initialize();
                    showSnackbar('Fallback browser launcher used for this run.', 5000);
                    return;
                }

                throw error;
            }
        };

        try {
            await initializeWithRecovery();
        } catch (error) {
            const errorText = String(error && error.message ? error.message : error);
            if (/browser is already running|Use a different `userDataDir`/i.test(errorText)) {
                throw new Error('Session profile is locked by another process. Close old WhatsApp browser windows and try Connect again.');
            }
            throw error;
        }

        session.browserEngine = shouldUseBundledChromium ? 'bundled-chromium' : 'fallback-browser';
        state.clients.set(sessionId, client);
        return client;
    })();

    state.sessionInitPromises.set(sessionId, initPromise);

    try {
        return await initPromise;
    } finally {
        state.sessionInitPromises.delete(sessionId);
    }
}

function renderSessions() {
    const sessionsList = byId('sessionsList');
    const authSelect = byId('authSessionSelect');
    const singleSelect = byId('singleSessionSelect');
    const poolContainer = byId('poolSessions');

    sessionsList.innerHTML = '';
    setSelectItems(authSelect, []);
    setSelectItems(singleSelect, []);
    poolContainer.innerHTML = '';

    if (state.store.sessions.length === 0) {
        sessionsList.innerHTML = '<div class="list-item">No sessions yet.</div>';
        setSelectItems(authSelect, [], 'No sessions');
        setSelectItems(singleSelect, [], 'No sessions');
        poolContainer.innerHTML = '<div class="list-item">No sessions</div>';
        return;
    }

    const authItems = [];
    const singleItems = [];

    state.store.sessions.forEach(session => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.innerHTML = `
            <div class="row" style="justify-content:space-between; margin-bottom:4px;">
                <strong>${session.name}</strong>
                ${sessionChip(session.status)}
            </div>
            <div class="row" style="margin-bottom:0;">
                <button class="btn-soft session-rename" data-id="${session.id}"><span class="material-icons">edit</span>Rename</button>
                <button class="btn-soft session-connect" data-id="${session.id}"><span class="material-icons">link</span>Connect</button>
                <button class="btn-soft session-open-browser" data-id="${session.id}"><span class="material-icons">open_in_new</span>Open WA Window</button>
                <button class="btn-danger session-delete" data-id="${session.id}"><span class="material-icons">delete</span>Delete</button>
            </div>
        `;
        sessionsList.appendChild(row);

        authItems.push({ value: session.id, label: `${session.name} (${session.status})` });
        singleItems.push({ value: session.id, label: session.name });

        const poolRow = document.createElement('div');
        poolRow.className = 'list-item';
        poolRow.innerHTML = `
            <label style="display:flex;align-items:center;gap:6px;margin:0;">
                <input class="pool-session-check" data-id="${session.id}" type="checkbox" style="width:auto;">
                <span>${session.name}</span>
            </label>
        `;
        poolContainer.appendChild(poolRow);
    });

    setSelectItems(authSelect, authItems, 'No sessions');
    setSelectItems(singleSelect, singleItems, 'No sessions');

    if (!authSelect.value) authSelect.value = state.store.sessions[0].id;
    if (!singleSelect.value) singleSelect.value = state.store.sessions[0].id;
}

function renderContacts() {
    const summary = byId('contactsSummary');
    const preview = byId('contactsPreview');
    const total = state.contacts.length;
    summary.textContent = total === 0 ? 'No contacts loaded.' : `${total} contacts ready for sending.`;

    preview.innerHTML = '';
    if (total === 0) {
        preview.innerHTML = '<div class="list-item">No contact preview.</div>';
        return;
    }

    state.contacts.slice(0, 120).forEach((contact, idx) => {
        const row = document.createElement('div');
        row.className = 'list-item';
        row.textContent = `${idx + 1}. ${contact.normalizedNumber} (${contact.source})`;
        preview.appendChild(row);
    });
}

function campaignStatusChip(status) {
    if (status === 'completed') return '<span class="chip ready">completed</span>';
    if (status === 'running' || status === 'paused') return '<span class="chip pending">active</span>';
    return '<span class="chip error">stopped</span>';
}

function renderCampaigns() {
    const container = byId('campaignsList');
    container.innerHTML = '';

    const list = [...state.store.campaigns].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    if (list.length === 0) {
        container.innerHTML = '<div class="list-item">No saved campaigns.</div>';
        return;
    }

    list.slice(0, 30).forEach(campaign => {
        const row = document.createElement('div');
        row.className = 'list-item';
        const sent = campaign.sentCount || 0;
        const total = campaign.totalCount || campaign.contacts.length;
        row.innerHTML = `
            <div class="row" style="justify-content:space-between; margin-bottom:3px;">
                <strong>${campaign.name || campaign.id}</strong>
                ${campaignStatusChip(campaign.status)}
            </div>
            <div class="mono">${sent}/${total} sent</div>
            <div class="row" style="margin-top:4px;margin-bottom:0;">
                <button class="btn-soft campaign-open" data-id="${campaign.id}"><span class="material-icons">folder_open</span>Load</button>
                <button class="btn-soft campaign-resume" data-id="${campaign.id}"><span class="material-icons">play_arrow</span>Resume</button>
            </div>
        `;
        container.appendChild(row);
    });
}

function renderAuthPanel() {
    const selectedSessionId = byId('authSessionSelect').value;
    if (!selectedSessionId) {
        byId('qrCode').textContent = 'No session selected';
        updateAuthStatus('No session selected.');
        return;
    }

    const session = findSession(selectedSessionId);
    if (!session) return;

    if (state.qrImages.has(selectedSessionId)) {
        byId('qrCode').innerHTML = `<img src="${state.qrImages.get(selectedSessionId)}" alt="QR Code">`;
    } else if (session.status === 'ready') {
        byId('qrCode').textContent = 'Session is ready';
    } else {
        byId('qrCode').textContent = 'QR will appear after connect';
    }

    updateAuthStatus(`${session.name}: ${session.status}`);
}

function renderControlState() {
    const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
    const isRunning = !!active && active.status === 'running';
    const isPaused = !!active && active.status === 'paused';

    byId('startSending').disabled = isRunning;
    byId('pauseSending').disabled = !isRunning;
    byId('resumeSending').disabled = !isPaused;
    byId('stopSending').disabled = !(isRunning || isPaused);
    byId('downloadReport').disabled = !active;

    if (active) {
        updateProgress(active.sentCount || 0, active.totalCount || 0);
    } else {
        updateProgress(0, 0);
    }
}

function renderAll() {
    renderSessions();
    renderContacts();
    renderCampaigns();
    renderAuthPanel();
    renderStoragePanel();
    renderControlState();
}

function getCurrentPoolSelection() {
    const checks = Array.from(document.querySelectorAll('.pool-session-check:checked'));
    return checks.map(ch => ch.dataset.id);
}

function createCampaignFromForm() {
    const sendMode = byId('sendMode').value;
    const singleSessionId = byId('singleSessionSelect').value;
    const poolSessionIds = getCurrentPoolSelection();
    const selectedSessionIds = getSelectedSessionIds(sendMode, singleSessionId, poolSessionIds);

    if (selectedSessionIds.length === 0) {
        throw new Error('Select one session (single mode) or at least one session (pool mode).');
    }

    const readySessionSet = new Set(getReadySessionIds());
    const hasReadySelected = selectedSessionIds.some(id => readySessionSet.has(id));
    if (!hasReadySelected) {
        throw new Error('No selected session is ready. Connect and scan QR first.');
    }

    const minDelay = parseInt(byId('minDelay').value, 10) || 1;
    const maxDelay = parseInt(byId('maxDelay').value, 10) || 1;
    if (minDelay > maxDelay) {
        throw new Error('Max delay must be greater than or equal to min delay.');
    }

    if (state.contacts.length === 0) {
        throw new Error('Load contacts from Excel or manual input before starting.');
    }

    return {
        id: uniqueId('campaign'),
        name: sanitizeName(byId('campaignName').value) || `Campaign ${new Date().toLocaleString()}`,
        sendMode,
        selectedSessionIds,
        contacts: state.contacts,
        pendingIndices: state.contacts.map((_, idx) => idx),
        attemptsByIndex: {},
        sentCount: 0,
        failedCount: 0,
        totalCount: state.contacts.length,
        results: [],
        status: 'running',
        messageTemplate: byId('messageText').value || '',
        personalizationEnabled: !!byId('enableNamePersonalization').checked,
        mediaPath: state.selectedMediaPath,
        delay: { minMs: minDelay * 1000, maxMs: maxDelay * 1000 },
        roundRobinIndex: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

async function sendOneMessage(campaign, index) {
    const contact = campaign.contacts[index];
    const sessionId = pickSessionForCampaign(campaign);
    if (!sessionId) {
        throw new Error('No ready session available in selected mode.');
    }

    const client = state.clients.get(sessionId);
    if (!client) {
        throw new Error(`Session client not connected for ${sessionId}`);
    }

    const chatId = `${contact.normalizedNumber}@c.us`;
    const template = campaign.messageTemplate || '';
    const hasDollarPlaceholders = /\$\{\s*[^}]+\s*\}/.test(template);

    let waContact = null;
    // If ${...} is present, resolve it even if the toggle state was stale in a saved campaign.
    if (hasDollarPlaceholders) {
        try {
            waContact = await client.getContactById(chatId);
        } catch (error) {
            waContact = null;
        }
    }

    // Resolve ${...} first, then legacy {..} placeholders.
    const afterDollar = hasDollarPlaceholders
        ? applyDollarTemplate(template, contact.rowData || {}, waContact, 'there')
        : template;
    const message = applyTemplate(afterDollar, contact.rowData || {});

    if (campaign.mediaPath) {
        const media = MessageMedia.fromFilePath(campaign.mediaPath);
        await client.sendMessage(chatId, media, { caption: message || '' });
    } else {
        await client.sendMessage(chatId, message || ' ');
    }

    return { sessionId, phone: contact.normalizedNumber };
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runCampaignLoop(campaignId) {
    if (state.isLoopRunning) return;
    const campaign = getCampaignById(campaignId);
    if (!campaign || campaign.status !== 'running') return;

    state.isLoopRunning = true;
    state.loopStopRequested = false;
    renderControlState();

    try {
        while (campaign.status === 'running' && campaign.pendingIndices.length > 0 && !state.loopStopRequested) {
            const idx = campaign.pendingIndices.shift();
            campaign.attemptsByIndex[idx] = (campaign.attemptsByIndex[idx] || 0) + 1;

            try {
                const sendResult = await sendOneMessage(campaign, idx);
                campaign.sentCount += 1;
                campaign.results.push({
                    index: idx,
                    phone: sendResult.phone,
                    sessionId: sendResult.sessionId,
                    status: 'Success',
                    timestamp: new Date().toISOString(),
                    error: null
                });
            } catch (error) {
                const attempts = campaign.attemptsByIndex[idx];
                const canRetry = campaign.sendMode === 'pool' && attempts < 3;

                if (canRetry) {
                    campaign.pendingIndices.push(idx);
                } else {
                    campaign.failedCount += 1;
                    campaign.results.push({
                        index: idx,
                        phone: campaign.contacts[idx].normalizedNumber,
                        sessionId: null,
                        status: 'Failed',
                        timestamp: new Date().toISOString(),
                        error: error.message
                    });
                }
            }

            campaign.updatedAt = new Date().toISOString();
            state.store.activeCampaignId = campaign.id;
            saveStore();
            updateProgress(campaign.sentCount, campaign.totalCount);
            renderCampaigns();

            const delay = Math.floor(Math.random() * (campaign.delay.maxMs - campaign.delay.minMs + 1)) + campaign.delay.minMs;
            await sleep(delay);

            if (campaign.status === 'paused' || campaign.status === 'stopped') {
                break;
            }
        }

        if (campaign.pendingIndices.length === 0 && campaign.status === 'running') {
            campaign.status = 'completed';
            campaign.updatedAt = new Date().toISOString();
            saveStore();
            showSnackbar(`Campaign completed: ${campaign.name}`, 4500);
        }
    } finally {
        state.isLoopRunning = false;
        renderControlState();
        renderCampaigns();
    }
}

function saveDraft() {
    state.store.lastDraft = {
        campaignName: byId('campaignName').value,
        defaultCountryCode: byId('defaultCountryCode').value,
        selectedFilePath: state.selectedFilePath,
        selectedMediaPath: state.selectedMediaPath,
        messageText: byId('messageText').value,
        personalizationEnabled: !!byId('enableNamePersonalization').checked,
        sendMode: byId('sendMode').value,
        singleSessionId: byId('singleSessionSelect').value,
        poolSessionIds: getCurrentPoolSelection(),
        minDelay: byId('minDelay').value,
        maxDelay: byId('maxDelay').value,
        contacts: state.contacts,
        savedAt: new Date().toISOString()
    };
    saveStore();
    showSnackbar('Draft saved.');
}

function loadDraft() {
    const draft = state.store.lastDraft;
    if (!draft) {
        showSnackbar('No draft saved yet.');
        return;
    }

    byId('campaignName').value = draft.campaignName || '';
    byId('defaultCountryCode').value = draft.defaultCountryCode || '91';
    byId('messageText').value = draft.messageText || '';
    byId('enableNamePersonalization').checked = !!draft.personalizationEnabled;
    byId('sendMode').value = draft.sendMode || 'single';
    byId('minDelay').value = draft.minDelay || '6';
    byId('maxDelay').value = draft.maxDelay || '12';

    state.selectedFilePath = draft.selectedFilePath || null;
    state.selectedMediaPath = draft.selectedMediaPath || null;
    state.contacts = draft.contacts || [];
    byId('selectedFile').textContent = state.selectedFilePath ? path.basename(state.selectedFilePath) : 'No file';
    byId('selectedMedia').textContent = state.selectedMediaPath ? path.basename(state.selectedMediaPath) : 'No media';

    renderAll();

    if (draft.singleSessionId) {
        byId('singleSessionSelect').value = draft.singleSessionId;
    }

    const poolSet = new Set(draft.poolSessionIds || []);
    document.querySelectorAll('.pool-session-check').forEach(ch => {
        ch.checked = poolSet.has(ch.dataset.id);
    });

    showSnackbar('Draft loaded.');
}

function loadCampaignToForm(campaign) {
    byId('campaignName').value = campaign.name || '';
    byId('sendMode').value = campaign.sendMode || 'single';
    byId('messageText').value = campaign.messageTemplate || '';
    byId('enableNamePersonalization').checked = !!campaign.personalizationEnabled;
    byId('minDelay').value = String(Math.floor((campaign.delay?.minMs || 6000) / 1000));
    byId('maxDelay').value = String(Math.floor((campaign.delay?.maxMs || 12000) / 1000));
    state.selectedMediaPath = campaign.mediaPath || null;
    byId('selectedMedia').textContent = state.selectedMediaPath ? path.basename(state.selectedMediaPath) : 'No media';
    state.contacts = campaign.contacts || [];

    if (campaign.sendMode === 'single' && campaign.selectedSessionIds[0]) {
        byId('singleSessionSelect').value = campaign.selectedSessionIds[0];
    }

    const selectedSet = new Set(campaign.selectedSessionIds || []);
    document.querySelectorAll('.pool-session-check').forEach(ch => {
        ch.checked = selectedSet.has(ch.dataset.id);
    });

    updateProgress(campaign.sentCount || 0, campaign.totalCount || 0);
    renderContacts();
}

function openReport(reportPath) {
    const openCommand = process.platform === 'win32'
        ? `start "" "${reportPath}"`
        : process.platform === 'darwin'
            ? `open "${reportPath}"`
            : `xdg-open "${reportPath}"`;

    ipcRenderer.send('execute-command', openCommand);
}

function generateCampaignReport(campaign) {
    if (!campaign) {
        showSnackbar('No campaign available for report.');
        return;
    }

    const doc = new PDFDocument();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportFileName = `whatsapp_report_${campaign.id}_${timestamp}.pdf`;
    const reportPath = path.join(os.tmpdir(), reportFileName);
    const stream = fs.createWriteStream(reportPath, { mode: 0o644 });

    doc.pipe(stream);
    doc.fontSize(18).text('WhatsApp Campaign Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(11)
        .text(`Campaign: ${campaign.name}`)
        .text(`Status: ${campaign.status}`)
        .text(`Total: ${campaign.totalCount}`)
        .text(`Success: ${campaign.sentCount}`)
        .text(`Failed: ${campaign.failedCount}`)
        .text(`Generated: ${new Date().toLocaleString()}`);

    doc.moveDown();
    doc.fontSize(13).text('Results', { underline: true });
    doc.moveDown(0.5);

    campaign.results.forEach((result, i) => {
        doc.fontSize(9)
            .text(`${i + 1}. ${result.phone} | ${result.status} | session: ${result.sessionId || '-'} | ${new Date(result.timestamp).toLocaleString()}`)
            .text(result.error ? `   Error: ${result.error}` : '   Error: -');
    });

    doc.end();
    stream.on('finish', () => {
        showSnackbar(`Report generated: ${reportPath}`);
        openReport(reportPath);
    });
}

function bindEvents() {
    const renameDialog = byId('renameSessionDialog');
    const renameInput = byId('renameSessionInput');

    byId('windowMinBtn').addEventListener('click', async () => {
        await ipcRenderer.invoke('window-minimize');
    });

    byId('windowMaxBtn').addEventListener('click', async () => {
        const isMaximized = await ipcRenderer.invoke('window-maximize-toggle');
        byId('windowMaxBtn').textContent = isMaximized ? '[=]' : '[]';
    });

    byId('windowCloseBtn').addEventListener('click', async () => {
        await ipcRenderer.invoke('window-close');
    });

    ipcRenderer.on('window-maximized', (event, isMaximized) => {
        byId('windowMaxBtn').textContent = isMaximized ? '[=]' : '[]';
    });

    byId('showBrowserOnConnect').addEventListener('change', () => {
        state.store.settings.showBrowserOnConnect = !!byId('showBrowserOnConnect').checked;
        saveStore();
    });

    byId('chooseStorageFolderBtn').addEventListener('click', async () => {
        try {
            await chooseStorageFolderFlow();
        } catch (error) {
            showSnackbar(`Storage folder update failed: ${error.message}`, 4500);
        }
    });

    byId('openStorageFolderBtn').addEventListener('click', async () => {
        if (!state.storageRootPath) {
            showSnackbar('Storage folder is not configured yet.');
            return;
        }
        const opened = await ipcRenderer.invoke('open-path', state.storageRootPath);
        if (!opened) {
            showSnackbar('Could not open storage folder.', 4200);
        }
    });

    byId('createBackupBtn').addEventListener('click', async () => {
        try {
            await createBackupSnapshot();
        } catch (error) {
            showSnackbar(`Backup failed: ${error.message}`, 4500);
        }
    });

    byId('restoreBackupBtn').addEventListener('click', async () => {
        try {
            await restoreBackupSnapshot();
        } catch (error) {
            showSnackbar(`Restore failed: ${error.message}`, 4500);
        }
    });

    byId('addSessionBtn').addEventListener('click', () => {
        const name = sanitizeName(byId('sessionNameInput').value);
        if (!name) {
            showSnackbar('Enter a session name.');
            return;
        }
        const session = {
            id: uniqueId('sess'),
            name,
            clientId: uniqueId('client'),
            status: 'new',
            lastError: null,
            createdAt: new Date().toISOString(),
            lastSeenAt: null
        };
        state.store.sessions.push(session);
        saveStore();
        byId('sessionNameInput').value = '';
        renderAll();
        showSnackbar('Session added.');
    });

    byId('renameCancelBtn').addEventListener('click', () => {
        state.pendingRenameSessionId = null;
        if (renameDialog.close) renameDialog.close();
        else renameDialog.removeAttribute('open');
    });

    byId('renameSaveBtn').addEventListener('click', () => {
        const sessionId = state.pendingRenameSessionId;
        const session = findSession(sessionId);
        if (!session) {
            if (renameDialog.close) renameDialog.close();
            else renameDialog.removeAttribute('open');
            return;
        }
        const clean = sanitizeName(renameInput.value);
        if (!clean) {
            showSnackbar('Enter a valid session name.');
            return;
        }
        session.name = clean;
        state.pendingRenameSessionId = null;
        saveStore();
        renderAll();
        if (renameDialog.close) renameDialog.close();
        else renameDialog.removeAttribute('open');
        showSnackbar('Session renamed.');
    });

    byId('sessionsList').addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const sessionId = button.dataset.id;
        const session = findSession(sessionId);
        if (!session) return;

        if (button.classList.contains('session-rename')) {
            state.pendingRenameSessionId = sessionId;
            renameInput.value = session.name || '';
            if (renameDialog.showModal) renameDialog.showModal();
            else if (renameDialog.show) renameDialog.show();
            else renameDialog.setAttribute('open', 'true');
            return;
        }

        if (button.classList.contains('session-connect')) {
            byId('authSessionSelect').value = sessionId;
            renderAuthPanel();
            try {
                await ensureSessionClient(sessionId, {
                    visibleBrowser: !!byId('showBrowserOnConnect').checked
                });
            } catch (error) {
                session.status = 'error';
                session.lastError = error.message;
                saveStore();
                renderAll();
                showSnackbar(`Failed to connect ${session.name}: ${error.message}`, 4500);
            }
            return;
        }

        if (button.classList.contains('session-open-browser')) {
            byId('authSessionSelect').value = sessionId;
            renderAuthPanel();
            try {
                await ensureSessionClient(sessionId, {
                    forceReconnect: true,
                    visibleBrowser: true
                });
                showSnackbar(`Opened WA browser window for ${session.name}`);
            } catch (error) {
                showSnackbar(`Failed to open WA window: ${error.message}`, 4500);
            }
            return;
        }

        if (button.classList.contains('session-delete')) {
            if (!confirm(`Delete session ${session.name}?`)) return;
            const client = state.clients.get(sessionId);
            if (client) {
                try {
                    await client.destroy();
                } catch (error) {
                    console.error('Client destroy error', error);
                }
                state.clients.delete(sessionId);
            }
            clearReconnectTimer(sessionId);
            state.reconnectAttempts.delete(sessionId);
            removeSessionAuthData(session.clientId);
            state.store.sessions = state.store.sessions.filter(s => s.id !== sessionId);
            saveStore();
            renderAll();
            showSnackbar('Session deleted.');
        }
    });

    byId('authSessionSelect').addEventListener('change', renderAuthPanel);
    byId('connectSessionBtn').addEventListener('click', async () => {
        const sessionId = byId('authSessionSelect').value;
        if (!sessionId) {
            showSnackbar('No session selected.');
            return;
        }
        try {
            await ensureSessionClient(sessionId, {
                visibleBrowser: !!byId('showBrowserOnConnect').checked
            });
            renderAuthPanel();
        } catch (error) {
            showSnackbar(`Connect failed: ${error.message}`, 4500);
        }
    });

    byId('sendMode').addEventListener('change', () => {
        const isSingle = byId('sendMode').value === 'single';
        byId('singleSessionSelect').disabled = !isSingle;
        byId('poolSessions').style.opacity = isSingle ? '0.6' : '1';
    });

    const excelInput = byId('excelFileInput');
    const mediaInput = byId('mediaFileInput');

    byId('selectFile').addEventListener('click', async () => {
        excelInput.value = '';
        excelInput.click();
    });

    excelInput.addEventListener('change', async () => {
        try {
            const filePath = excelInput.files && excelInput.files[0] ? excelInput.files[0].path : null;
            if (!filePath) return;
            state.selectedFilePath = filePath;
            byId('selectedFile').textContent = path.basename(filePath);

            state.excelRows = readExcelRows(filePath);
            state.excelColumns = state.excelRows.length > 0 ? Object.keys(state.excelRows[0]) : [];

            const select = byId('phoneColumnSelect');
            setSelectItems(select, state.excelColumns.map(col => ({ value: col, label: col })), 'No columns');

            const guess = state.excelColumns.find(c => /phone|mobile|number|contact/i.test(c));
            if (guess) select.value = guess;

            byId('excelPreview').textContent = `Detected columns: ${state.excelColumns.join(', ') || 'none'} | Rows: ${state.excelRows.length}`;
            showSnackbar(`Excel loaded: ${state.excelRows.length} rows`);
        } catch (error) {
            showSnackbar(`Excel read error: ${error.message}`, 4500);
        }
    });

    byId('loadExcelContactsBtn').addEventListener('click', () => {
        if (!state.selectedFilePath || state.excelRows.length === 0) {
            showSnackbar('Select an Excel file first.');
            return;
        }
        const phoneColumn = byId('phoneColumnSelect').value;
        if (!phoneColumn) {
            showSnackbar('Choose a phone number column.');
            return;
        }

        const { contacts, invalidCount, duplicateCount, invalidSamples, invalidReasonCounts } = parseContactsFromExcel(phoneColumn);
        state.contacts = contacts;
        renderContacts();
        byId('invalidDetails').textContent = formatInvalidSummary(invalidReasonCounts, invalidSamples, duplicateCount);
        showSnackbar(`Excel contacts ready: ${contacts.length} valid, ${invalidCount} invalid, ${duplicateCount} duplicates`);
    });

    byId('loadManualContactsBtn').addEventListener('click', () => {
        const inputText = byId('manualNumbers').value;
        if (!inputText.trim()) {
            showSnackbar('Enter numbers in manual input first.');
            return;
        }

        const append = byId('appendManualCheckbox').checked;
        if (!append) state.contacts = [];

        const { contacts, invalidCount, duplicateCount, invalidSamples, invalidReasonCounts } = parseContactsFromManual(inputText);
        if (append) {
            state.contacts = [...state.contacts, ...contacts];
        } else {
            state.contacts = contacts;
        }
        renderContacts();
        byId('invalidDetails').textContent = formatInvalidSummary(invalidReasonCounts, invalidSamples, duplicateCount);
        showSnackbar(`Manual contacts added: ${contacts.length} valid, ${invalidCount} invalid, ${duplicateCount} duplicates`);
    });

    byId('selectMedia').addEventListener('click', async () => {
        mediaInput.value = '';
        mediaInput.click();
    });

    mediaInput.addEventListener('change', async () => {
        try {
            const mediaPath = mediaInput.files && mediaInput.files[0] ? mediaInput.files[0].path : null;
            if (!mediaPath) return;
            state.selectedMediaPath = mediaPath;
            byId('selectedMedia').textContent = path.basename(mediaPath);
            showSnackbar('Media attached.');
        } catch (error) {
            showSnackbar(`Media select error: ${error.message}`);
        }
    });

    byId('saveDraftBtn').addEventListener('click', saveDraft);
    byId('loadDraftBtn').addEventListener('click', loadDraft);

    byId('startSending').addEventListener('click', async () => {
        try {
            const campaign = createCampaignFromForm();
            state.store.campaigns.push(campaign);
            state.store.activeCampaignId = campaign.id;
            saveStore();
            renderAll();
            await runCampaignLoop(campaign.id);
        } catch (error) {
            showSnackbar(error.message, 4500);
        }
    });

    byId('pauseSending').addEventListener('click', () => {
        const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
        if (!active || active.status !== 'running') return;
        active.status = 'paused';
        active.updatedAt = new Date().toISOString();
        saveStore();
        renderControlState();
        renderCampaigns();
        showSnackbar('Campaign paused.');
    });

    byId('resumeSending').addEventListener('click', async () => {
        const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
        if (!active || active.status !== 'paused') {
            showSnackbar('No paused campaign to resume.');
            return;
        }
        active.status = 'running';
        active.updatedAt = new Date().toISOString();
        saveStore();
        renderControlState();
        await runCampaignLoop(active.id);
    });

    byId('stopSending').addEventListener('click', () => {
        const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
        if (!active) return;
        active.status = 'stopped';
        active.updatedAt = new Date().toISOString();
        saveStore();
        renderControlState();
        renderCampaigns();
        showSnackbar('Campaign stopped.');
    });

    byId('campaignsList').addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const campaignId = button.dataset.id;
        const campaign = getCampaignById(campaignId);
        if (!campaign) return;

        if (button.classList.contains('campaign-open')) {
            state.store.activeCampaignId = campaign.id;
            saveStore();
            loadCampaignToForm(campaign);
            renderControlState();
            showSnackbar(`Loaded campaign: ${campaign.name}`);
            return;
        }

        if (button.classList.contains('campaign-resume')) {
            state.store.activeCampaignId = campaign.id;
            if (campaign.status === 'completed') {
                showSnackbar('Campaign already completed.');
                return;
            }
            campaign.status = 'running';
            campaign.updatedAt = new Date().toISOString();
            saveStore();
            loadCampaignToForm(campaign);
            renderControlState();
            await runCampaignLoop(campaign.id);
        }
    });

    byId('downloadReport').addEventListener('click', () => {
        const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
        if (!active) {
            showSnackbar('No campaign selected for report.');
            return;
        }
        generateCampaignReport(active);
    });
}

async function initializeApp() {
    state.appDataPath = await ipcRenderer.invoke('get-user-data-path');
    ensureDirectoryExists(state.appDataPath);
    state.storageConfigPath = path.join(state.appDataPath, STORAGE_CONFIG_FILE_NAME);

    const storageConfig = loadStorageConfig();
    let chosenStorageRoot = storageConfig.storageRootPath;

    if (!chosenStorageRoot) {
        const selectedBase = await ipcRenderer.invoke('select-folder', {
            title: 'Choose folder to save configs and sessions',
            defaultPath: state.appDataPath
        });

        chosenStorageRoot = selectedBase
            ? getManagedStorageRoot(selectedBase)
            : state.appDataPath;

        saveStorageConfig({ storageRootPath: chosenStorageRoot });
    }

    configureStoragePaths(chosenStorageRoot);
    migrateLegacyDataIfNeeded(chosenStorageRoot);

    loadStore();
    bindEvents();

    byId('showBrowserOnConnect').checked = !!state.store.settings.showBrowserOnConnect;

    try {
        const isMax = await ipcRenderer.invoke('window-is-maximized');
        byId('windowMaxBtn').textContent = isMax ? '[=]' : '[]';
    } catch (error) {
        console.error('Window state read failed', error);
    }

    renderAll();

    for (const session of state.store.sessions) {
        if (['ready', 'authenticated', 'connecting'].includes(session.status)) {
            // Startup restore is always headless to avoid popup windows.
            ensureSessionClient(session.id, { visibleBrowser: false }).catch(error => {
                console.error(`Startup attach failed for ${session.name}:`, error.message);
                session.status = 'error';
                session.lastError = error.message;
                saveStore();
                scheduleReconnect(session.id);
            });
            continue;
        }

        if (['disconnected', 'error', 'new'].includes(session.status)) {
            scheduleReconnect(session.id);
        }
    }

    const active = state.store.activeCampaignId ? getCampaignById(state.store.activeCampaignId) : null;
    if (active && (active.status === 'running' || active.status === 'paused')) {
        loadCampaignToForm(active);
        showSnackbar(`Restored active campaign: ${active.name}`);
    }

    byId('sendMode').dispatchEvent(new Event('change'));
}

async function cleanup() {
    for (const timer of state.reconnectTimers.values()) {
        clearTimeout(timer);
    }
    state.reconnectTimers.clear();

    const allClients = Array.from(state.clients.values());
    for (const client of allClients) {
        try {
            await client.destroy();
        } catch (error) {
            console.error('Client cleanup error', error);
        }
    }
}

window.addEventListener('beforeunload', cleanup);
initializeApp().catch(error => {
    console.error('Initialization failed', error);
    showSnackbar(`Initialization failed: ${error.message}`, 5000);
});
