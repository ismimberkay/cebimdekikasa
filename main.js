/* ========================================
   AUTO-SYNC SYSTEM (File System Access API + IndexedDB)
   Zero-click cloud sync via Google Drive
======================================== */

let fileHandle;
let lastSyncDate = null; // Dosyadaki son kayıt tarihi

// IndexedDB Helper (Dosya iznini tarayıcıda saklamak için)
const DB_NAME = 'CebimdekiKasaDB';
const STORE_NAME = 'FileHandleStore';

async function getDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            e.target.result.createObjectStore(STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getStoredHandle() {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get('db_handle');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function saveHandle(handle) {
    const db = await getDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(handle, 'db_handle');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function verifyPermission(handle, withWrite = false) {
    const options = { mode: withWrite ? 'readwrite' : 'read' };
    if ((await handle.queryPermission(options)) === 'granted') {
        return true;
    }
    if ((await handle.requestPermission(options)) === 'granted') {
        return true;
    }
    return false;
}

// --- OTOMATİK YÜKLEME VE KAYDETME ---

// --- GÜNCELLENMİŞ initAutoSync (SecurityError Düzeltildi) ---

async function initAutoSync() {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl) return;

    try {
        fileHandle = await getStoredHandle();

        if (fileHandle) {
            // 1. Dosya sistemi izni varsa (Otomatik Mod)
            const options = { mode: 'readwrite' };
            const permission = await fileHandle.queryPermission(options);

            if (permission === 'granted') {
                await loadFromFile();
            } else {
                // İzin düşmüşse
                statusEl.innerHTML = '<i class="fa-solid fa-lock"></i> İzin Ver (Tıkla)';
                statusEl.className = 'needs-attention';

                // CSS'ten renkleri kaldırdığımız için manuel ekliyoruz:
                statusEl.style.backgroundColor = 'rgba(57, 255, 20, 0.15)';
                statusEl.style.borderColor = '#39ff14';
                statusEl.style.color = '#39ff14';
                statusEl.style.boxShadow = '0 0 15px rgba(57, 255, 20, 0.6)';

                statusEl.style.cursor = 'pointer';
                statusEl.style.pointerEvents = 'auto';

                statusEl.onclick = async () => {
                    try {
                        if ((await fileHandle.requestPermission(options)) === 'granted') {
                            await loadFromFile();
                            statusEl.onclick = null;
                        } else {
                            statusEl.innerHTML = 'İzin Reddedildi';
                            statusEl.classList.add('permission-denied');
                        }
                    } catch (e) { console.error(e); }
                };
            }
        } else {
            // 2. Dosya sistemi YOKSA (Manuel Mod / Yedek Yükle Modu)
            // LocalStorage'dan son tarihi çek
            const lastSync = localStorage.getItem('exp_last_sync');
            if (lastSync) {
                lastSyncDate = new Date(lastSync);
            }

            // Renk ve durum hesaplamasını 'updateSyncStatus'a bırak
            updateSyncStatus();
        }
    } catch (err) {
        console.error("Sync Error:", err);
        statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Hata';
        statusEl.classList.add('error');
    }
}

async function loadFromFile() {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl || !fileHandle) return;

    statusEl.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i> Yükleniyor...';
    statusEl.style.backgroundColor = '';
    statusEl.style.borderColor = '';
    statusEl.style.color = '';

    try {
        const file = await fileHandle.getFile();
        const text = await file.text();

        // Dosya boşsa, yeni başlangıç verisi oluştur
        if (!text.trim()) {
            console.log('Dosya boş, varsayılan verilerle devam ediliyor.');
            updateSyncStatus();
            return;
        }

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            console.error('JSON parse hatası:', parseErr);
            statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Geçersiz JSON';
            statusEl.classList.add('error');
            return;
        }

        // State'i güncelle (eski format desteği dahil)
        if (data.expenses) state.expenses = data.expenses;
        if (data.cards) state.cards = data.cards;
        if (data.assets) state.assets = data.assets;
        if (data.methods) state.methods = data.methods;
        if (data.categories) state.categories = data.categories;
        if (data.merchants) state.merchants = data.merchants;
        if (data.recurringPlans) state.recurringPlans = data.recurringPlans;
        if (data.recurringIncome) state.recurringIncome = data.recurringIncome;
        if (data.balanceLogs) state.balanceLogs = data.balanceLogs;
        if (data.isDark !== undefined) state.isDark = data.isDark;
        if (data.isPrivacyMode !== undefined) state.isPrivacyMode = data.isPrivacyMode;

        // Son kayıt tarihini sakla (lastSync yoksa dosya adından veya tarihi kullan)
        if (data.lastSync) {
            lastSyncDate = new Date(data.lastSync);
            console.log('lastSync JSON\'dan alındı:', data.lastSync);
        } else {
            // Dosya adından tarihi çıkarmayı dene (YYYY-MM-DD veya DD.MM.YYYY formatları)
            const fileName = file.name;
            const isoMatch = fileName.match(/(\d{4})-(\d{2})-(\d{2})/); // YYYY-MM-DD
            const trMatch = fileName.match(/(\d{2})\.(\d{2})\.(\d{4})/); // DD.MM.YYYY

            if (isoMatch) {
                lastSyncDate = new Date(isoMatch[1], parseInt(isoMatch[2]) - 1, isoMatch[3]);
                console.log('Tarih dosya adından alındı (ISO):', fileName, '→', lastSyncDate);
            } else if (trMatch) {
                lastSyncDate = new Date(trMatch[3], parseInt(trMatch[2]) - 1, trMatch[1]);
                console.log('Tarih dosya adından alındı (TR):', fileName, '→', lastSyncDate);
            } else {
                // Hiçbir format bulunamazsa dosya tarihini kullan
                lastSyncDate = new Date(file.lastModified);
                console.log('Dosya adında tarih yok, dosya tarihi kullanıldı:', lastSyncDate);
            }
        }
        console.log('Son yedek tarihi:', lastSyncDate.toLocaleDateString('tr-TR'));

        // LocalStorage'ı da güncelle
        localStorage.setItem('exp_logs', JSON.stringify(state.expenses));
        localStorage.setItem('exp_cards', JSON.stringify(state.cards));
        localStorage.setItem('exp_assets', JSON.stringify(state.assets));
        localStorage.setItem('exp_methods', JSON.stringify(state.methods));
        localStorage.setItem('exp_cats', JSON.stringify(state.categories));
        localStorage.setItem('exp_merchants', JSON.stringify(state.merchants));
        localStorage.setItem('exp_recurring_plans', JSON.stringify(state.recurringPlans));
        localStorage.setItem('exp_recurring_income', JSON.stringify(state.recurringIncome));
        localStorage.setItem('exp_balance_logs', JSON.stringify(state.balanceLogs));

        // Tema uygula
        if (data.isDark !== undefined) {
            localStorage.setItem('dark_mode', data.isDark);
            applyTheme();
        }

        // Ekranı yenile (Sadece aktif sayfada)
        const page = document.body.dataset.page || 'dashboard';

        if (page === 'dashboard' && typeof updateDashboard === 'function') updateDashboard();
        if (page === 'expenses' && typeof renderFullHistory === 'function') renderFullHistory();
        if (page === 'credit' && typeof renderCreditPage === 'function') renderCreditPage();
        if (page === 'credit' && typeof updateStatementView === 'function') updateStatementView();
        if (page === 'savings' && typeof renderSavingsPage === 'function') renderSavingsPage();
        if (page === 'recurring' && typeof renderRecurringList === 'function') renderRecurringList();
        if (page === 'calendar' && typeof renderCalendarPage === 'function') renderCalendarPage();

        updateSyncStatus();
    } catch (err) {
        console.error('Dosya okuma hatası:', err);
        statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Okuma hatası';
        statusEl.classList.add('error');
        statusEl.style.cursor = 'pointer';
        statusEl.style.pointerEvents = 'auto';
        statusEl.onclick = () => location.reload();
    }
}

async function saveToFile() {
    const statusEl = document.getElementById('sync-status');
    if (!fileHandle || !statusEl) return;

    statusEl.innerHTML = '<i class="fa-solid fa-pen-nib"></i> Kaydediliyor...';

    try {
        const dataToSave = {
            expenses: state.expenses,
            cards: state.cards,
            assets: state.assets,
            methods: state.methods,
            categories: state.categories,
            merchants: state.merchants,
            recurringPlans: state.recurringPlans,
            recurringIncome: state.recurringIncome,
            balanceLogs: state.balanceLogs,
            isDark: state.isDark,
            isPrivacyMode: state.isPrivacyMode,
            lastSync: new Date().toISOString()
        };

        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(dataToSave, null, 2));
        await writable.close();

        updateSyncStatus(true);
    } catch (err) {
        console.error('Dosya yazma hatası:', err);
        statusEl.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> Kayıt hatası';
        statusEl.classList.add('error');
    }
}

// Senkronizasyon dosyasını değiştir (Ayarlar'dan seçilebilir)
window.changeSyncFile = async function () {
    try {
        [fileHandle] = await window.showOpenFilePicker({
            types: [{
                description: 'JSON Veritabanı',
                accept: { 'application/json': ['.json'] }
            }]
        });
        await saveHandle(fileHandle);
        await loadFromFile();
        showToast('Dosya Değiştirildi', 'Yeni yedek dosyası seçildi ve yüklendi.', 'success');
    } catch (e) {
        if (e.name !== 'AbortError') {
            console.error('Dosya değiştirme hatası:', e);
            showToast('Hata', 'Dosya seçilemedi.', 'error');
        }
    }
};

function updateSyncStatus(justSaved = false) {
    const statusEl = document.getElementById('sync-status');
    if (!statusEl) return;

    // Stilleri sıfırla
    statusEl.style.backgroundColor = '';
    statusEl.style.borderColor = '';
    statusEl.style.color = '';
    statusEl.classList.remove('error', 'synced', 'needs-attention');

    // Eğer yeni kaydettiyse tarihi güncelle
    if (justSaved) {
        lastSyncDate = new Date();
        // Manuel moddaysa localStorage'ı da güncelle ki reload edince tarih gitmesin
        if (!fileHandle) {
            localStorage.setItem('exp_last_sync', lastSyncDate.toISOString());
        }
    }

    // TIKLAMA OLAYI AYARI (Kritik Düzeltme Burası)
    if (!fileHandle) {
        // Otomatik bağlantı yoksa, butona basınca YEDEK YÜKLEME inputu çalışsın
        statusEl.style.cursor = 'pointer';
        statusEl.style.pointerEvents = 'auto';
        statusEl.onclick = () => {
            const globalInput = document.getElementById('global-restore-input');
            if (globalInput) globalInput.click();
            else alert('Hata: global-restore-input bulunamadı!');
        };
    } else {
        // Otomatik bağlantı varsa tıklama işlevsiz olsun (zaten otomatiktir)
        statusEl.style.pointerEvents = 'none';
        statusEl.style.cursor = 'default';
        statusEl.onclick = null;
    }

    // TARİH HESAPLAMA VE RENKLENDİRME
    if (!lastSyncDate) {
        // Tarih hiç yoksa -> "Yedek Yükle" butonu gibi davran
        statusEl.innerHTML = '<i class="fa-solid fa-upload"></i> Yedek Yükle';
        statusEl.style.backgroundColor = 'rgba(67, 97, 238, 0.2)'; // Mavi ton
        statusEl.style.borderColor = 'var(--primary)';
        statusEl.style.color = 'var(--primary)';
        return;
    }

    const now = new Date();
    const diffMs = now - lastSyncDate;
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    // Tarih formatı
    const day = String(lastSyncDate.getDate()).padStart(2, '0');
    const month = String(lastSyncDate.getMonth() + 1).padStart(2, '0');
    const year = lastSyncDate.getFullYear();
    const dateStr = `${day}.${month}.${year}`;

    let icon, text, bgColor, borderColor, textColor, boxShadow;

    if (diffDays <= 3) {
        // YEŞİL: 0-3 gün (Güncel)
        icon = fileHandle ? 'fa-rotate' : 'fa-check'; // Oto ise sync ikonu, manuel ise tik
        text = `Yakın zamanda yedeklendi! <br> ${dateStr}`;
        bgColor = 'rgba(46, 204, 113, 0.2)';
        borderColor = '#2ecc71';
        textColor = '#2ecc71';
        boxShadow = 'none';
    } else if (diffDays <= 5) {
        // SARI: 3-5 gün (Eskiyor)
        icon = 'fa-clock';
        text = ` <strong>DİKKAT!</strong> <br> Verileriniz kaybolabilir! <br> Son yedek:${dateStr}`;
        bgColor = 'rgba(255, 159, 28, 0.2)';
        borderColor = '#ff9f1c';
        textColor = '#ff9f1c';
        boxShadow = '0 0 10px rgba(255, 159, 28, 0.4)';
    } else {
        // KIRMIZI: 5+ gün (Kritik)
        icon = 'fa-exclamation-triangle';
        text = `Son yedek tarihi çok eski! Hemen yedekleme yapın! <br> ${dateStr}`;
        bgColor = 'rgba(231, 76, 60, 0.2)';
        borderColor = '#e74c3c';
        textColor = '#e74c3c';
        boxShadow = '0 0 15px rgba(231, 76, 60, 0.6)';

        // Kritik durumda dikkat çeksin (CSS'teki animasyon çalışsın)
        statusEl.classList.add('needs-attention');
    }

    statusEl.innerHTML = `<i class="fa-solid ${icon}"></i> ${text}`;
    statusEl.style.backgroundColor = bgColor;
    statusEl.style.borderColor = borderColor;
    statusEl.style.color = textColor;
    statusEl.style.boxShadow = boxShadow;
}

// Tarihli dosya adı formatı: "08.02.2026 tarihli Cebimdeki Kasa.json"
function getBackupFileName() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}.${month}.${year} tarihli Cebimdeki Kasa.json`;
}

// saveData - Tüm kayıt işlemlerini merkezi yönetir
function saveData() {
    localStorage.setItem('exp_logs', JSON.stringify(state.expenses));
    localStorage.setItem('exp_cards', JSON.stringify(state.cards));
    localStorage.setItem('exp_assets', JSON.stringify(state.assets));
    localStorage.setItem('exp_methods', JSON.stringify(state.methods));
    localStorage.setItem('exp_cats', JSON.stringify(state.categories));
    localStorage.setItem('exp_merchants', JSON.stringify(state.merchants));
    localStorage.setItem('exp_recurring_plans', JSON.stringify(state.recurringPlans));
    localStorage.setItem('exp_recurring_income', JSON.stringify(state.recurringIncome));
    localStorage.setItem('exp_balance_logs', JSON.stringify(state.balanceLogs));

    // Otomatik Dosyaya Yazma
    saveToFile();
}

/* ======================================== */

let state = {
    expenses: JSON.parse(localStorage.getItem('exp_logs')) || [],
    cards: JSON.parse(localStorage.getItem('exp_cards')) || [],
    assets: JSON.parse(localStorage.getItem('exp_assets')) || [],
    methods: JSON.parse(localStorage.getItem('exp_methods')) || ['Nakit', 'Havale / EFT'],
    categories: JSON.parse(localStorage.getItem('exp_cats')) || ['Market', 'Yemek', 'Ulaşım', 'Teknoloji', 'Online Alışveriş', 'Fatura', 'Giyim', 'Sağlık', 'Eğlence', 'Diğer'],
    merchants: JSON.parse(localStorage.getItem('exp_merchants')) || [],

    isDark: localStorage.getItem('dark_mode') === 'true',
    activeViewCardId: 'all',
    activeCardId: null,
    periodOffset: 0,
    customRange: { start: null, end: null },
    chart: null,
    isPrivacyMode: localStorage.getItem('privacy_mode') === 'true',
    isWalletHidden: localStorage.getItem('wallet_privacy') === 'true',
    recurringPlans: JSON.parse(localStorage.getItem('exp_recurring_plans')) || [],
    recurringIncome: JSON.parse(localStorage.getItem('exp_recurring_income')) || [],
    balanceLogs: JSON.parse(localStorage.getItem('exp_balance_logs')) || [],
    dataVersion: parseInt(localStorage.getItem('exp_data_version')) || 1 // v1=TL float, v2=kuruş int
};

/**
 * Migrates all monetary values from TL (float) to Kuruş (integer)
 * Called once on first load after update, then dataVersion is set to 2
 */
function migrateToKurus() {
    if (state.dataVersion >= 2) return; // Already migrated

    console.log('[Migration] Starting TL → Kuruş conversion...');

    // Helper: Check if value looks like TL (has decimals or is small)
    const needsMigration = (val) => {
        if (val === null || val === undefined) return false;
        const num = Number(val);
        // If it has decimals OR is reasonably small (< 100000), it's probably TL
        return !Number.isInteger(num) || num < 100000;
    };

    // Migrate expenses
    state.expenses.forEach(exp => {
        if (needsMigration(exp.amount)) {
            exp.amount = Math.round(Number(exp.amount) * 100);
        }
    });

    // Migrate cards (limit)
    state.cards.forEach(card => {
        if (needsMigration(card.limit)) {
            card.limit = Math.round(Number(card.limit) * 100);
        }
    });

    // Migrate assets (price, amount stays as quantity)
    state.assets.forEach(asset => {
        if (needsMigration(asset.price)) {
            asset.price = Math.round(Number(asset.price) * 100);
        }
    });

    // Migrate balanceLogs
    state.balanceLogs.forEach(log => {
        if (needsMigration(log.amount)) {
            log.amount = Math.round(Number(log.amount) * 100);
        }
    });

    // Migrate recurringPlans
    state.recurringPlans.forEach(plan => {
        if (needsMigration(plan.amount)) {
            plan.amount = Math.round(Number(plan.amount) * 100);
        }
        if (needsMigration(plan.cashbackValue)) {
            plan.cashbackValue = Math.round(Number(plan.cashbackValue) * 100);
        }
    });

    // Migrate recurringIncome
    state.recurringIncome.forEach(inc => {
        if (needsMigration(inc.amount)) {
            inc.amount = Math.round(Number(inc.amount) * 100);
        }
    });

    // Mark as migrated
    state.dataVersion = 2;
    localStorage.setItem('exp_data_version', '2');

    // Save all migrated data
    saveData();

    console.log('[Migration] Complete! All values now in kuruş (integer cents)');
}

// Robust Name Matching Helper
function namesMatch(n1, n2) {
    if (!n1 || !n2) return false;
    return n1.toString().trim().toLowerCase() === n2.toString().trim().toLowerCase();
}

// HATA 2 FIX: Get local date in YYYY-MM-DD format (avoids UTC timezone issues)
function getLocalDateISO(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Generate unique ID to prevent collision (HATA 4 FIX)
function generateUniqueId() {
    return Date.now() + Math.floor(Math.random() * 1000000);
}

const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', icon: 'fa-solid fa-house', link: 'index.html' },
    { id: 'credit', label: 'Kredi Kartı', icon: 'fa-regular fa-credit-card', link: 'credit.html' },
    { id: 'recurring', label: 'Düzenli Giderler', icon: 'fa-solid fa-clock-rotate-left', link: 'recurring.html' },
    { id: 'expenses', label: 'Tüm Hareketler', icon: 'fa-solid fa-list', link: 'expenses.html' },
    { id: 'calendar', label: 'Takvim', icon: 'fa-solid fa-calendar-days', link: 'calendar.html' },
    { id: 'analysis', label: 'Analiz', icon: 'fa-solid fa-chart-pie', link: 'analysis.html' },
    { id: 'savings', label: 'Birikimler', icon: 'fa-solid fa-coins', link: 'savings.html' },
    { id: 'settings', label: 'Ayarlar', icon: 'fa-solid fa-gear', link: 'settings.html' },
    { id: 'guide', label: 'Nasıl Kullanılır', icon: 'fa-solid fa-circle-question', link: 'guide.html' },
    { id: 'feedback', label: 'İletişim', icon: 'fa-solid fa-headset', link: 'feedback.html' }
];

function renderSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    const currentPage = document.body.dataset.page || 'dashboard';

    let navHtml = '';
    NAV_ITEMS.forEach(item => {
        const isActive = (item.id === currentPage);
        navHtml += `<a href="${item.link}" class="nav-item ${isActive ? 'active' : ''}"> <i class="${item.icon}"></i> ${item.label} </a>`;
    });

    sidebar.innerHTML = `
        <div>
            <div class="brand">
                <img src="salary.png" alt="Logo" class="brand-logo">
                <h1>Cebimdeki<span class="light-text"> Kasa</span></h1>
            </div>
            <nav class="nav-links">
                ${navHtml}
            </nav>
        </div>
        <div class="sidebar-footer">
            <div id="sync-status"><i class="fa-solid fa-circle-notch fa-spin"></i> Bağlantı...</div>
            <!-- Global Restore Input (Hidden) -->
            <input type="file" id="global-restore-input" accept=".json" style="display: none;" onchange="window.restoreBackup(event)">
            
            <div style="display:flex; gap:10px;">
                <button onclick="togglePrivacyMode()" class="sidebar-privacy-btn" title="Gizlilik Modu">
                    <i class="fa-solid fa-eye-slash"></i>
                </button>
                <button id="theme-btn" class="sidebar-theme-btn" style="flex:2;">
                    <i class="fa-solid fa-moon"></i>
                    <span>Tema Değiştir</span>
                </button>
            </div>
        </div>
    `;
}

// HATA 6 FIX: Event delegation for sidebar elements (prevents event loss on re-render)
document.addEventListener('click', (e) => {
    // Theme button click
    if (e.target.closest('#theme-btn')) {
        toggleTheme();
    }
    // Brand click
    if (e.target.closest('.brand')) {
        window.location.href = 'index.html';
    }
});

function setFavicon() {
    const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
    link.type = 'image/png';
    link.rel = 'icon';
    link.href = 'salary.png';
    document.getElementsByTagName('head')[0].appendChild(link);
}

function init() {
    migrateToKurus(); // Convert TL → Kuruş if needed (v1→v2)
    renderSidebar(); // Auto-render sidebar
    setFavicon();    // Auto-set favicon
    applyTheme();
    if (state.isPrivacyMode) document.body.classList.add('privacy-active');
    setupModalHTML();
    setupGlobalHotkeys();
    checkRecurringTransactions();
    checkRecurringIncome(); // GLOBAL TRIGGER

    if (window.location.hash === '#settings') {
        setTimeout(() => toggleSettingsView(true), 100);
    }

    if (state.cards.length > 0 && !state.activeCardId) {
        state.activeCardId = state.cards[0].id;
    }

    // Event listeners now handled by event delegation (HATA 6 FIX)

    // Robust Routing using data-page
    const page = document.body.dataset.page || 'dashboard';

    if (page === 'dashboard') {
        renderDropdowns('exp'); // Modernize inputs
        updateDashboard();
        setupAddButton();
        if (document.getElementById('exp-date'))
            document.getElementById('exp-date').valueAsDate = new Date();

        setupAutocomplete('exp-merchant', 'exp-merchant-suggestions');
        fetchMarketData(); // Ana sayfa açılınca verileri çek
    }

    else if (page === 'credit') {
        renderCreditPage();
        updateStatementView();
        updateCardActionButton();

        if (document.getElementById('cr-date'))
            document.getElementById('cr-date').valueAsDate = new Date();

        const addCrBtn = document.getElementById('add-credit-btn');
        if (addCrBtn) addCrBtn.addEventListener('click', addCreditExpense);

        const viewSelect = document.getElementById('view-card-select');
        if (viewSelect) viewSelect.addEventListener('change', (e) => {
            state.activeViewCardId = e.target.value === 'all' ? 'all' : parseInt(e.target.value);
            updatePeriodSelector();
            updateStatementView();
            updateCardActionButton();
        });

        const btnPrev = document.getElementById('btn-prev-period');
        const btnNext = document.getElementById('btn-next-period');
        if (btnPrev) btnPrev.addEventListener('click', () => { state.periodOffset--; updateStatementView(); });
        if (btnNext) btnNext.addEventListener('click', () => { state.periodOffset++; updateStatementView(); });

        setupAutocomplete('cr-merchant', 'cr-merchant-suggestions');
    }

    else if (page === 'expenses') {
        populateFilters();
        renderFullHistory();

        const toggleBtn = document.getElementById('toggle-filter-btn');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                const panel = document.getElementById('filter-panel');
                if (panel) {
                    panel.classList.toggle('active');
                    toggleBtn.classList.toggle('active');
                }
            });
        }

        const fMethod = document.getElementById('filter-method');
        if (fMethod) fMethod.addEventListener('change', renderFullHistory);
        const fCat = document.getElementById('filter-category');
        if (fCat) fCat.addEventListener('change', renderFullHistory);
        const fRange = document.getElementById('filter-range');
        if (fRange) fRange.addEventListener('change', (e) => {
            if (e.target.value === 'custom') openCustomRangeModal();
            else renderFullHistory();
        });
        const fSearch = document.getElementById('filter-search');
        if (fSearch) fSearch.addEventListener('input', renderFullHistory);
    }

    else if (page === 'analysis') {
        populateFilters();
        initCustomSelect('sort-analysis');
        renderChart();
        renderAnalysisList();

        const fRange = document.getElementById('filter-range');
        if (fRange) fRange.addEventListener('change', (e) => {
            if (e.target.value === 'custom') openCustomRangeModal();
            else { renderChart(); renderAnalysisList(); }
        });

        const fMethod = document.getElementById('filter-method');
        if (fMethod) fMethod.addEventListener('change', () => { renderChart(); renderAnalysisList(); });

        const fSort = document.getElementById('sort-analysis');
        if (fSort) fSort.addEventListener('change', () => renderAnalysisList());
    }

    else if (page === 'savings') {
        initCustomSelect('asset-type');
        if (document.getElementById('asset-date')) document.getElementById('asset-date').valueAsDate = new Date();

        const tabs = document.querySelectorAll('.trade-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const btn = document.getElementById('trade-btn');
                const type = tab.getAttribute('data-type');
                btn.setAttribute('onclick', `handleAssetTrade('${type}')`);
                if (type === 'buy') {
                    btn.textContent = 'Varlık Al (Ekle)';
                    btn.style.background = 'var(--success)';
                } else {
                    btn.textContent = 'Varlık Sat (Nakit Girişi)';
                    btn.style.background = 'var(--danger)';
                }
            });
        });

        fetchMarketData().then(() => {
            renderSavingsPage();
        });

        // Auto-process Recurring Income on page load
        checkRecurringIncome();
    }

    else if (page === 'recurring') {
        renderDropdowns('rec');
        renderRecIconSelector();
        renderRecurringList();
        setupAutocomplete('rec-name', 'rec-name-suggestions'); // Enable autocomplete

        // Modernize dropdowns
        initCustomSelect('rec-method-select');
        initCustomSelect('rec-cb-type');
    }

    else if (page === 'calendar') {
        state.periodOffset = 0; // Reset to current month initially
        renderCalendarPage();

        document.getElementById('cal-prev').onclick = () => { state.periodOffset--; renderCalendarPage(); };
        document.getElementById('cal-next').onclick = () => { state.periodOffset++; renderCalendarPage(); };
    }

    checkBackupUsage();

    // AUTO-SYNC INIT (File System Access API)
    initAutoSync();

    // GLOBAL FLATPICKR INIT
    setTimeout(() => {
        if (window.flatpickr) {
            flatpickr("input[type='date']:not(#w-date)", {
                locale: "tr",
                dateFormat: "Y-m-d",
                altInput: true,
                altFormat: "d F Y",
                disableMobile: true,
                monthSelectorType: "static",
                minDate: "2010-01-01",
                maxDate: "today",
                onReady: function (selectedDates, dateStr, instance) {
                    const monthNames = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
                    const overlay = document.createElement("div");
                    overlay.className = "flatpickr-month-overlay";

                    monthNames.forEach((m, idx) => {
                        const btn = document.createElement("div");
                        btn.className = "flatpickr-month-option";
                        btn.textContent = m;
                        btn.onclick = (e) => {
                            e.stopPropagation();
                            instance.changeMonth(idx, false);
                            overlay.classList.remove("active");
                            // Update active state
                            overlay.querySelectorAll(".flatpickr-month-option").forEach(el => el.classList.remove("selected"));
                            btn.classList.add("selected");
                        };
                        overlay.appendChild(btn);
                    });

                    instance.calendarContainer.appendChild(overlay);

                    const monthLabel = instance.monthNav.querySelector(".cur-month");
                    if (monthLabel) {
                        monthLabel.addEventListener("click", () => {
                            overlay.classList.toggle("active");
                            monthLabel.classList.toggle("active");
                            // Highlight current month
                            const currentMonth = instance.currentMonth;
                            overlay.querySelectorAll(".flatpickr-month-option").forEach((el, i) => {
                                if (i === currentMonth) el.classList.add("selected");
                                else el.classList.remove("selected");
                            });
                        });
                    }

                    // --- YEAR VALIDATION ---
                    const yearInput = instance.currentYearElement;
                    if (yearInput) {
                        const minYear = 2010;
                        const maxYear = new Date().getFullYear();

                        // NATIVE CONSTRAINT (Fixes arrow keys)
                        yearInput.min = minYear;
                        yearInput.max = maxYear;

                        yearInput.addEventListener("change", (e) => {
                            const val = parseInt(e.target.value);
                            if (val < minYear || val > maxYear) {
                                showToast("Geçersiz Yıl", `Lütfen ${minYear} ile ${maxYear} arasında bir yıl giriniz.`, "error");
                                const safeYear = Math.max(minYear, Math.min(maxYear, val || maxYear));
                                instance.changeYear(safeYear);
                            }
                        });
                    }
                }
            });
        }
    }, 50);
}

function setupGlobalHotkeys() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('app-modal');
            if (modal && modal.classList.contains('active')) {
                closeModal();
            }
        }

        if (e.key === 'Enter') {
            const modal = document.getElementById('app-modal');

            if (modal && modal.classList.contains('active')) {
                const confirmBtn = modal.querySelector('.btn-confirm') || modal.querySelector('.btn-delete');
                if (confirmBtn) confirmBtn.click();
                return;
            }

            if (document.activeElement.tagName === 'INPUT') {
                const path = window.location.pathname;
                if (path.includes('index.html') || path === '/' || path.endsWith('/')) {
                    addExpense();
                } else if (path.includes('credit.html')) {
                    addCreditExpense();
                }
            }
        }
    });
}

function setupAutocomplete(inputId, listId) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(listId);
    if (!input || !box) return;

    function showSuggestions(val) {
        box.innerHTML = '';
        const filtered = state.merchants.filter(m => m.toLowerCase().includes(val.toLowerCase()));

        if (filtered.length === 0) {
            box.classList.remove('active');
            return;
        }

        filtered.forEach(m => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';

            item.onclick = () => {
                input.value = m;
                box.classList.remove('active');
            };

            const textSpan = document.createElement('span');
            textSpan.textContent = m;

            const delBtn = document.createElement('div');
            delBtn.className = 'btn-delete-suggestion';
            delBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteMerchant(m);
                showSuggestions(input.value);
            };

            item.appendChild(textSpan);
            item.appendChild(delBtn);
            box.appendChild(item);
        });

        box.classList.add('active');
    }

    input.addEventListener('input', () => showSuggestions(input.value));
    input.addEventListener('focus', () => showSuggestions(input.value));

    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !box.contains(e.target)) {
            box.classList.remove('active');
        }
    });
}

function saveMerchant(name) {
    if (name && !state.merchants.includes(name)) {
        state.merchants.push(name);
        localStorage.setItem('exp_merchants', JSON.stringify(state.merchants));
    }
}

function deleteMerchant(name) {
    state.merchants = state.merchants.filter(m => m !== name);
    localStorage.setItem('exp_merchants', JSON.stringify(state.merchants));
    showToast('Silindi', `"${name}" hafızadan silindi.`, 'info');
}

function setupAddButton() {
    const btn = document.getElementById('add-btn');
    if (btn) btn.addEventListener('click', addExpense);
}

function addExpense() {
    const merchant = document.getElementById('exp-merchant').value.trim();
    const description = document.getElementById('exp-desc') ? document.getElementById('exp-desc').value.trim() : '';
    const amountKurus = toKurus(parseFloat(document.getElementById('exp-amount').value)); // Store in kuruş
    const dateVal = document.getElementById('exp-date').value;
    const method = document.getElementById('exp-method-select').value;
    const category = document.getElementById('exp-category-select').value;
    const isRecurring = document.getElementById('exp-recurring') ? document.getElementById('exp-recurring').checked : false;

    if (merchant && amountKurus > 0 && isValidDate(dateVal)) {
        const linkedCard = state.cards.find(c => c.name === method);

        if (linkedCard) {
            showToast('İşlem Kısıtlaması', 'Kredi kartı harcamalarınızı lütfen Kredi Kartı sekmesinden yapınız.', 'error');
            return;
        }

        state.expenses.push({
            id: Date.now(),
            merchant, description,
            amount: amountKurus, // Now in kuruş
            method, category,
            isoDate: dateVal, date: formatDateTR(dateVal),
            isCredit: false,
            isRecurring: isRecurring,
            recurrenceFrequency: isRecurring ? 'monthly' : null
        });

        // --- NEW: Auto-deduct from Wallet if not credit ---
        // Since it's not a linked card (checked above), it's a cash/debit expense.
        state.balanceLogs.push({
            id: Date.now() + 1, // Ensure unique ID from expense
            title: merchant, // Use merchant name as description
            amount: -amountKurus, // Negative kuruş for expense
            date: dateVal,
            createdAt: new Date().toISOString()
        });

        saveMerchant(merchant);
        saveData();

        showToast('Başarılı', isRecurring ? 'Abonelik takibe alındı ve bakiyeden düşüldü.' : 'Harcama kaydedildi ve bakiyeden düşüldü.', 'success');

        document.getElementById('exp-merchant').value = '';
        if (document.getElementById('exp-desc')) document.getElementById('exp-desc').value = '';
        document.getElementById('exp-amount').value = '';
        if (document.getElementById('exp-recurring')) document.getElementById('exp-recurring').checked = false;
        updateDashboard();
    } else {
        showToast('Hata', 'Bilgileri kontrol ediniz.', 'error');
    }
}

function updateDashboard() {
    renderDropdowns('exp');
    let displayList = [];
    const rawList = state.expenses.slice().sort((a, b) => {
        // Sort by Date Descending
        if (b.isoDate !== a.isoDate) return b.isoDate.localeCompare(a.isoDate);
        // Fallback to ID Descending
        return b.id - a.id;
    });

    rawList.forEach(item => {
        const match = item.merchant.match(/(.*) \((\d+)\/(\d+)\)/);
        if (match) {
            if (parseInt(match[2]) === 1) {
                displayList.push({ ...item, merchant: `${match[1]} (${match[3]} Taksit)`, amount: item.amount * parseInt(match[3]) });
            }
        } else {
            displayList.push(item);
        }
    });

    // Filter out future dates for "Recent Transactions" (History)
    // Use Local Time for "Today" comparison, not UTC
    const now = new Date();
    const localTodayISO = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

    // We only show items where date <= today (Local)
    const historyList = displayList.filter(item => item.isoDate <= localTodayISO);

    renderList(historyList.slice(0, 10), 'transaction-history');

    // 'now' is already defined above
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // DÜZELTME: isPayment (Borç Ödemesi) olanları toplama dahil etme (!x.isPayment)
    const currentTotal = state.expenses
        .filter(x => { const d = new Date(x.isoDate); return d.getMonth() === currentMonth && d.getFullYear() === currentYear; })
        .filter(x => !x.isPayment) // <-- YENİ EKLENDİ
        .reduce((sum, x) => sum + Number(x.amount), 0);

    const prevDate = new Date(currentYear, currentMonth - 1, 1);
    const prevTotal = state.expenses
        .filter(x => { const d = new Date(x.isoDate); return d.getMonth() === prevDate.getMonth() && d.getFullYear() === prevDate.getFullYear(); })
        .filter(x => !x.isPayment) // <-- YENİ EKLENDİ
        .reduce((sum, x) => sum + Number(x.amount), 0);

    const grandTotalEl = document.getElementById('grand-total');
    if (grandTotalEl) grandTotalEl.textContent = formatMoney(currentTotal);

    const trendEl = document.querySelector('.trend');
    if (trendEl) {
        if (prevTotal === 0) {
            trendEl.innerHTML = currentTotal > 0 ? '<i class="fa-solid fa-arrow-trend-up"></i> Bu ay başladı' : '<i class="fa-solid fa-minus"></i> Veri yok';
            trendEl.style.color = currentTotal > 0 ? 'var(--danger)' : 'var(--text-light)';
        } else {
            const diff = currentTotal - prevTotal;
            const percentage = ((diff / prevTotal) * 100).toFixed(1);
            if (diff > 0) {
                trendEl.innerHTML = `<i class="fa-solid fa-arrow-trend-up"></i> Geçen aya göre %${percentage} artış`;
                trendEl.style.color = 'var(--danger)';
            } else {
                trendEl.innerHTML = `<i class="fa-solid fa-arrow-trend-down"></i> Geçen aya göre %${Math.abs(percentage)} azalış`;
                trendEl.style.color = 'var(--success)';
            }
        }
    }

    // Render Wallet Widget
    renderWalletWidget();
}

function renderCreditPage() {
    const viewSelect = document.getElementById('view-card-select');
    if (viewSelect) {
        let options = '<option value="all">Tüm Kartlar (Genel Durum)</option>';
        state.cards.forEach(c => {
            options += `<option value="${c.id}" ${c.id === state.activeViewCardId ? 'selected' : ''}>${c.name}</option>`;
        });
        viewSelect.innerHTML = options;
        initCustomSelect('view-card-select');
    }

    const formSelect = document.getElementById('form-card-select');
    if (formSelect) {
        let formOptions = '<option value="">Kart Seçiniz...</option>';
        state.cards.forEach(c => {
            formOptions += `<option value="${c.id}">${c.name}</option>`;
        });
        formSelect.innerHTML = formOptions;
        initCustomSelect('form-card-select');
    }

    if (document.getElementById('cr-installments')) {
        initCustomSelect('cr-installments');
    }

    renderDropdowns('cr');
}

function updateStatementView() {
    const totalEl = document.getElementById('statement-total');
    if (!totalEl) return;

    const limitEl = document.getElementById('remaining-limit');
    const periodEl = document.getElementById('statement-period');
    const dueEl = document.getElementById('due-date-display');
    const periodTextEl = document.getElementById('period-display-text');
    const barFill = document.getElementById('limit-bar-fill');
    const cardDigits = document.getElementById('card-last-digits');
    const logoDiv = document.querySelector('.card-logo');

    // FIX: Helper to handle month overflow (e.g. Feb 30 -> Mar 2 issues)
    const getClampedDate = (year, month, day) => {
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const effectiveDay = Math.min(day, daysInMonth);
        return new Date(year, month, effectiveDay);
    };

    const setBarGradient = (element, percent) => {
        if (percent <= 20) {
            element.style.background = 'linear-gradient(90deg, #ff416c 0%, #ff4b2b 100%)';
            element.style.boxShadow = '0 0 10px rgba(255, 65, 108, 0.5)';
        } else if (percent <= 50) {
            element.style.background = 'linear-gradient(90deg, #f7971e 0%, #ffd200 100%)';
            element.style.boxShadow = '0 0 10px rgba(247, 151, 30, 0.5)';
        } else {
            element.style.background = 'linear-gradient(90deg, #00c6ff 0%, #0072ff 100%)';
            element.style.boxShadow = '0 0 10px rgba(0, 198, 255, 0.5)';
        }
    };

    const setCardLogo = (brand) => {
        if (!logoDiv) return;

        let html = '<i class="fa-solid fa-credit-card"></i>';

        if (brand === 'visa') {
            html = '<i class="fa-brands fa-cc-visa" style="font-size:2rem;"></i>';
        } else if (brand === 'mastercard') {
            html = '<i class="fa-brands fa-cc-mastercard" style="font-size:2rem;"></i>';
        } else if (brand === 'amex') {
            html = '<i class="fa-brands fa-cc-amex" style="font-size:2rem;"></i>';
        } else if (brand === 'troy') {
            html = '<span style="font-weight:900; letter-spacing:1px; font-style:normal; font-family:sans-serif;">TROY</span>';
        } else if (brand === 'bofa') {
            html = '<div style="display:flex; align-items:center; gap:5px;"><i class="fa-solid fa-building-columns"></i> <span style="font-size:0.9rem; font-weight:700;">BofA</span></div>';
        }

        logoDiv.innerHTML = html;
    };

    if (state.activeViewCardId === 'all') {
        const totalLimit = state.cards.reduce((sum, c) => sum + c.limit, 0);

        if (periodTextEl) {
            const now = new Date();
            const today = getClampedDate(now.getFullYear(), now.getMonth() + state.periodOffset, now.getDate());
            periodTextEl.innerText = today.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });
        }

        if (cardDigits) cardDigits.textContent = "TÜMÜ";
        setCardLogo('default');

        const allCreditOps = state.expenses.filter(x => {
            if (x.isCredit) return true;
            return state.cards.some(c => namesMatch(c.name, x.method));
        });
        const allSpends = allCreditOps.filter(x => !x.isPayment).reduce((sum, x) => sum + Number(x.amount), 0);
        const allPayments = allCreditOps.filter(x => x.isPayment).reduce((sum, x) => sum + Number(x.amount), 0);

        const periodOps = state.expenses.filter(x => {
            const card = state.cards.find(c => c.name.trim().toLowerCase() === x.method.trim().toLowerCase());
            if (!card) return false;

            const now = new Date();
            const today = getClampedDate(now.getFullYear(), now.getMonth() + state.periodOffset, now.getDate());
            let start, end;
            const cutoff = card.cutoff;
            if (today.getDate() < cutoff) {
                start = getClampedDate(today.getFullYear(), today.getMonth() - 1, cutoff);
                end = getClampedDate(today.getFullYear(), today.getMonth(), cutoff);
            } else {
                start = getClampedDate(today.getFullYear(), today.getMonth(), cutoff);
                end = getClampedDate(today.getFullYear(), today.getMonth() + 1, cutoff);
            }
            // End date should be inclusive
            const d = new Date(x.isoDate); d.setHours(0, 0, 0, 0);
            start.setHours(0, 0, 0, 0);
            end.setHours(23, 59, 59, 999); // Span the whole cutoff day
            return d >= start && d <= end;
        });

        // FIXED: Show Period Debt (Sum of period expenses - Sum of period payments)
        // This is strictly for the CURRENT VIEWED PERIOD
        const periodSpends = periodOps.filter(x => !x.isPayment).reduce((sum, x) => sum + Number(x.amount), 0);
        const periodPayments = periodOps.filter(x => x.isPayment).reduce((sum, x) => sum + Number(x.amount), 0);

        // "Dönem Borcu" = Spends in this period - Payments in this period
        // If it's negative (more paid than spent), it shows 0 (or could show credit)
        const periodDebtReal = Math.max(0, periodSpends - periodPayments);

        // Remaining Limit is still based on GLOBAL debt
        const totalDebtReal = Math.max(0, allSpends - allPayments);
        const remaining = totalLimit - totalDebtReal;

        totalEl.innerText = formatMoney(periodDebtReal);
        limitEl.innerText = formatMoney(remaining);

        if (barFill) {
            const ratio = totalLimit > 0 ? (remaining / totalLimit) * 100 : 0;
            barFill.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
            setBarGradient(barFill, ratio);
        }
        if (periodEl) periodEl.innerText = "Tüm Kartlar";
        dueEl.innerText = "--.--";
        renderList(periodOps.sort((a, b) => b.isoDate.localeCompare(a.isoDate)), 'statement-list');
        return;
    }

    const activeCard = state.cards.find(c => c.id === state.activeViewCardId);
    if (!activeCard) return;

    if (cardDigits) cardDigits.textContent = activeCard.last4 ? activeCard.last4 : '----';
    setCardLogo(activeCard.brand || 'visa');

    const now = new Date();
    const today = getClampedDate(now.getFullYear(), now.getMonth() + state.periodOffset, now.getDate());
    let start, end;
    const cutoff = activeCard.cutoff;

    if (today.getDate() < cutoff) {
        start = getClampedDate(today.getFullYear(), today.getMonth() - 1, cutoff);
        end = getClampedDate(today.getFullYear(), today.getMonth(), cutoff);
    } else {
        start = getClampedDate(today.getFullYear(), today.getMonth(), cutoff);
        end = getClampedDate(today.getFullYear(), today.getMonth() + 1, cutoff);
    }

    if (periodTextEl) {
        periodTextEl.innerText = `${formatDateTR(getLocalDateISO(start))} - ${formatDateTR(getLocalDateISO(end))}`;
    }

    let dueDate = new Date(end);
    dueDate.setDate(dueDate.getDate() + 10);
    dueDate = getNextWorkDayTR(dueDate);

    const periodOps = state.expenses.filter(x => {
        if (x.method.trim().toLowerCase() !== activeCard.name.trim().toLowerCase()) return false;
        const d = new Date(x.isoDate); d.setHours(0, 0, 0, 0);
        start.setHours(0, 0, 0, 0);
        end.setHours(23, 59, 59, 999);
        return d >= start && d <= end;
    });

    const allCardOps = state.expenses.filter(x => namesMatch(x.method, activeCard.name));

    const cumulativeSpends = allCardOps
        .filter(x => !x.isPayment && new Date(x.isoDate) <= end)
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const totalPaymentsAllTime = allCardOps
        .filter(x => x.isPayment)
        .reduce((acc, curr) => acc + Number(curr.amount), 0);

    const displayedPeriodDebt = Math.max(0, cumulativeSpends - totalPaymentsAllTime);
    const totalSpendsAllTime = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + Number(curr.amount), 0);
    const currentTotalDebt = Math.max(0, totalSpendsAllTime - totalPaymentsAllTime);
    const remaining = activeCard.limit - currentTotalDebt;

    totalEl.textContent = formatMoney(displayedPeriodDebt);
    limitEl.textContent = formatMoney(remaining);

    if (barFill) {
        const ratio = activeCard.limit > 0 ? (remaining / activeCard.limit) * 100 : 0;
        barFill.style.width = `${Math.max(0, Math.min(100, ratio))}%`;
        setBarGradient(barFill, ratio);
    }

    if (periodEl) periodEl.textContent = `${formatDateTR(getLocalDateISO(start))} - ${formatDateTR(getLocalDateISO(end))}`;
    dueEl.textContent = formatDateTR(getLocalDateISO(dueDate));

    renderList(periodOps.sort((a, b) => b.isoDate.localeCompare(a.isoDate)), 'statement-list');
}

function addCreditExpense() {
    const formSelect = document.getElementById('form-card-select');
    const selectedCardId = formSelect ? parseInt(formSelect.value) : null;
    if (!selectedCardId) { showToast('Hata', 'Lütfen harcamanın yapılacağı kartı seçin.', 'error'); return; }

    const activeCard = state.cards.find(c => c.id === selectedCardId);
    const amountVal = toKurus(parseFloat(document.getElementById('cr-amount').value)); // Store in kuruş
    const merchant = document.getElementById('cr-merchant').value.trim();

    const allCardOps = state.expenses.filter(x => namesMatch(x.method, activeCard.name));
    const totalSpends = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + Number(curr.amount), 0);
    const totalPayments = allCardOps.filter(x => x.isPayment).reduce((acc, curr) => acc + Number(curr.amount), 0);
    const currentTotalDebt = Math.max(0, totalSpends - totalPayments);
    const remaining = Number(activeCard.limit) - currentTotalDebt;

    if (amountVal > remaining + 0.1) { showToast('Limit Yetersiz', `Lütfen limitinize uygun harcama yapın veya limitinizi güncelleyin!`, 'error'); return; }

    const isRecurring = document.getElementById('cr-recurring') ? document.getElementById('cr-recurring').checked : false;
    const installments = isRecurring ? 1 : parseInt(document.getElementById('cr-installments').value);
    const dateInput = document.getElementById('cr-date').value;
    const category = document.getElementById('cr-category-select').value;

    if (!merchant || !amountVal || !isValidDate(dateInput)) { showToast('Eksik Bilgi', 'Tüm alanları doldurun.', 'error'); return; }

    saveMerchant(merchant);

    const baseDate = new Date(dateInput);
    // Integer-safe installment splitting (avoid floating point issues)
    const totalAmountKurus = amountVal;
    const baseInstallment = Math.floor(totalAmountKurus / installments);
    const remainder = totalAmountKurus % installments;

    for (let i = 0; i < installments; i++) {
        const nextDate = new Date(baseDate);
        // Remainder goes to first installment
        const currentInstallmentAmount = baseInstallment + (i === 0 ? remainder : 0);

        // FIX: Handle 31st day overflow (e.g. Jan 31 -> Feb 28/29)
        const expectedMonth = (baseDate.getMonth() + i) % 12;
        nextDate.setMonth(baseDate.getMonth() + i);

        if (nextDate.getMonth() !== expectedMonth && nextDate.getMonth() !== (expectedMonth + 12) % 12) {
            // If month jumped (overflow), set to last day of previous month
            nextDate.setDate(0);
        }

        const iso = getLocalDateISO(nextDate); // HATA 2 FIX: Use local date

        state.expenses.push({
            id: generateUniqueId(), // HATA 4 FIX: Use unique ID generator
            merchant: installments > 1 ? `${merchant} (${i + 1}/${installments})` : merchant,
            amount: currentInstallmentAmount, // Integer guaranteed
            method: activeCard.name,
            category: category,
            isoDate: iso,
            date: formatDateTR(iso),
            isCredit: true,
            isRecurring: (isRecurring && i === 0),
            recurrenceFrequency: (isRecurring && i === 0) ? 'monthly' : null
        });
    }

    saveData();
    document.getElementById('cr-merchant').value = '';
    document.getElementById('cr-amount').value = '';
    if (document.getElementById('cr-recurring')) document.getElementById('cr-recurring').checked = false;

    showToast('Başarılı', isRecurring ? 'Abonelik karta tanımlandı.' : `${formatMoney(amountVal)} TL karta işlendi.`, 'success'); // formatMoney for display

    if (state.activeViewCardId === 'all' || state.activeViewCardId === selectedCardId) {
        updatePeriodSelector();
        updateStatementView();
    }
}

function openCardManagerModal() {
    const isEditing = state.activeViewCardId !== 'all';
    let card = null;
    if (isEditing) card = state.cards.find(c => c.id === state.activeViewCardId);

    const brand = card && card.brand ? card.brand : 'visa';
    const last4 = card && card.last4 ? card.last4 : '';

    const html = `
        <div class="modal-input-group"><label>Kart Adı</label><input type="text" id="new-card-name" value="${card ? card.name : ''}" placeholder="Örn: Bonus, Axess"></div>
        
        <div style="display:flex; gap:10px;">
            <div class="modal-input-group" style="flex:1;">
                <label>Kart Markası</label>
                <select id="new-card-brand" style="width:100%; padding:12px; border:1px solid var(--border); border-radius:8px; background:rgba(125,125,125,0.05); color:var(--text-main); outline:none;">
                    <option value="visa" ${brand === 'visa' ? 'selected' : ''}>Visa</option>
                    <option value="mastercard" ${brand === 'mastercard' ? 'selected' : ''}>Mastercard</option>
                    <option value="amex" ${brand === 'amex' ? 'selected' : ''}>American Express</option>
                    <option value="troy" ${brand === 'troy' ? 'selected' : ''}>Troy</option>                </select>
            </div>
            <div class="modal-input-group" style="flex:1;">
                <label>Son 4 Hane</label>
                <input type="text" id="new-card-last4" value="${last4}" maxlength="4" placeholder="1234" oninput="this.value = this.value.replace(/[^0-9]/g, '').slice(0, 4);" style="font-family:monospace; letter-spacing:1px;">
            </div>
        </div>

        <div class="modal-input-group"><label>Hesap Kesim Günü (1-31)</label><input type="number" id="new-card-cutoff" value="${card ? card.cutoff : ''}" min="1" max="31"></div>
        <div class="modal-input-group"><label>Kart Limiti (TL)</label><input type="number" id="new-card-limit" value="${card ? card.limit : ''}" placeholder="Limit"></div>
    `;

    const actions = [
        { text: 'Vazgeç', class: 'btn-cancel' },
        { text: isEditing ? 'Güncelle' : 'Kaydet', class: 'btn-confirm', onClick: () => saveCardProcess(isEditing ? card.id : null) }
    ];
    if (isEditing) actions.unshift({ text: 'Kartı Sil', class: 'btn-delete', onClick: deleteActiveCard });
    showModal(isEditing ? 'Kart Düzenle' : 'Yeni Kart Ekle', document.createRange().createContextualFragment(html), actions);
    setTimeout(() => initCustomSelect('new-card-brand'), 50);
}

function saveCardProcess(editId = null) {
    const name = document.getElementById('new-card-name').value.trim();
    const cutoff = parseInt(document.getElementById('new-card-cutoff').value);
    const limit = toKurus(parseFloat(document.getElementById('new-card-limit').value)); // Store in kuruş
    const brand = document.getElementById('new-card-brand').value;
    const last4 = document.getElementById('new-card-last4').value;

    if (name && cutoff >= 1 && cutoff <= 31 && limit > 0) {
        if (editId) {
            const cardIndex = state.cards.findIndex(c => c.id === editId);
            if (cardIndex > -1) {
                const oldName = state.cards[cardIndex].name;
                state.cards[cardIndex].name = name;
                state.cards[cardIndex].cutoff = cutoff;
                state.cards[cardIndex].limit = limit; // Already in kuruş
                state.cards[cardIndex].brand = brand;
                state.cards[cardIndex].last4 = last4;

                if (name !== oldName) {
                    state.expenses.forEach(ex => { if (ex.method === oldName) ex.method = name; });
                    const mIdx = state.methods.indexOf(oldName);
                    if (mIdx > -1) state.methods[mIdx] = name;
                    else if (!state.methods.includes(name)) state.methods.push(name);
                }
                showToast('Güncellendi', 'Kart bilgileri güncellendi.');
            }
        } else {
            const newCard = { id: Date.now(), name, cutoff, limit, brand, last4 };
            state.cards.push(newCard);
            if (!state.methods.includes(name)) state.methods.push(name);
            state.activeViewCardId = newCard.id;
            showToast('Eklendi', `${name} başarıyla oluşturuldu.`);
        }
        saveData(); renderCreditPage(); updateStatementView(); closeModal();
    } else { showToast('Hata', 'Bilgileri kontrol ediniz.', 'error'); }
}

function deleteActiveCard() {
    if (state.activeViewCardId === 'all') return;
    closeModal();
    setTimeout(() => {
        showModal('Onay', 'Bu kart ve bağlı tüm harcamalar silinecek. Emin misin?', [
            { text: 'Vazgeç', class: 'btn-cancel' },
            {
                text: 'Sil', class: 'btn-delete', onClick: () => {
                    // HATA 3 FIX: Get card name before deletion
                    const cardToDelete = state.cards.find(c => c.id === state.activeViewCardId);
                    const cardName = cardToDelete?.name;

                    // Delete the card
                    state.cards = state.cards.filter(c => c.id !== state.activeViewCardId);

                    // HATA 3 FIX: Clean up orphan expenses
                    if (cardName) {
                        const beforeCount = state.expenses.length;
                        state.expenses = state.expenses.filter(e => !namesMatch(e.method, cardName));
                        const deletedExpenses = beforeCount - state.expenses.length;

                        // Also clean up recurring plans tied to this card
                        state.recurringPlans = state.recurringPlans.filter(p => !namesMatch(p.method, cardName));
                    }

                    state.activeViewCardId = 'all';
                    saveData(); renderCreditPage(); closeModal();
                    showToast('Bilgi', 'Kart ve ilişkili harcamalar silindi.', 'info');
                }
            }
        ]);
    }, 200);
}

function renderDropdowns(prefix) {
    const methodSel = document.getElementById(`${prefix}-method-select`);
    if (methodSel) {
        methodSel.innerHTML = state.methods.map(m => `<option value="${m}">${m}</option>`).join('');
        initCustomSelect(`${prefix}-method-select`);
    }

    const catSel = document.getElementById(`${prefix}-category-select`);
    if (catSel) {
        // Handle categories that could be strings or objects {name: ...}
        catSel.innerHTML = state.categories.map(c => {
            const name = (typeof c === 'object' && c.name) ? c.name : c;
            return `<option value="${name}">${name}</option>`;
        }).join('');
        initCustomSelect(`${prefix}-category-select`);
    }
}

window.toggleSmartAdd = function (type) {
    const container = document.getElementById(`smart-${type}`);
    if (!container) return;
    container.querySelector('.smart-view-select').classList.add('hidden');
    container.querySelector('.smart-view-add').classList.remove('hidden');
    const btns = container.querySelectorAll('.btn-icon');
    if (btns[0]) btns[0].classList.add('hidden');
    if (btns[1]) btns[1].classList.add('hidden');
    if (btns[2]) btns[2].classList.remove('hidden');
    if (btns[3]) btns[3].classList.remove('hidden');
    const input = document.getElementById(`new-${type}-name`);
    if (input) input.focus();
}

window.cancelSmartItem = function (type) {
    const container = document.getElementById(`smart-${type}`);
    if (!container) return;
    container.querySelector('.smart-view-select').classList.remove('hidden');
    container.querySelector('.smart-view-add').classList.add('hidden');
    const btns = container.querySelectorAll('.btn-icon');
    if (btns[0]) btns[0].classList.remove('hidden');
    if (btns[1]) btns[1].classList.remove('hidden');
    if (btns[2]) btns[2].classList.add('hidden');
    if (btns[3]) btns[3].classList.add('hidden');
    const input = document.getElementById(`new-${type}-name`);
    if (input) input.value = '';
}

window.saveSmartItem = function (type) {
    const input = document.getElementById(`new-${type}-name`);
    const val = input.value.trim();
    if (val) {
        let added = false;
        if (type === 'method') { if (!state.methods.includes(val)) { state.methods.push(val); added = true; } }
        else if (type === 'category') { if (!state.categories.includes(val)) { state.categories.push(val); added = true; } }

        if (added) {
            saveData(); renderDropdowns('exp');
            const select = document.getElementById(`exp-${type}-select`);
            if (select) select.value = val;
            showToast('Eklendi', `"${val}" eklendi.`);
            cancelSmartItem(type);
        } else { showToast('Uyarı', 'Bu seçenek zaten mevcut.', 'error'); }
    } else { showToast('Hata', 'Lütfen bir isim giriniz.', 'error'); }
}

window.deleteSmartItem = function (type) {
    const select = document.getElementById(`exp-${type}-select`);
    const val = select ? select.value : null;
    if (!val) { showToast('Hata', 'Silinecek bir öğe seçili değil.', 'error'); return; }

    showModal('Silme Onayı', `"${val}" seçeneğini silmek istiyor musun?`, [
        { text: 'Vazgeç', class: 'btn-cancel' },
        {
            text: 'Evet, Sil', class: 'btn-delete', onClick: () => {
                if (type === 'method') state.methods = state.methods.filter(m => m !== val);
                else state.categories = state.categories.filter(c => c !== val);
                saveData(); renderDropdowns('exp'); showToast('Silindi', `"${val}" silindi.`, 'info');
            }
        }
    ]);
}

function populateFilters() {
    const mFilter = document.getElementById('filter-method');
    const cFilter = document.getElementById('filter-category');
    const dFilter = document.getElementById('filter-range');

    if (mFilter) {
        const uniqueMethods = [...new Set([...state.methods, ...state.cards.map(c => c.name)])];

        mFilter.innerHTML = '<option value="all">Tüm Yöntemler</option>' +
            uniqueMethods.map(m => `<option value="${m}">${m}</option>`).join('');

        initCustomSelect('filter-method');
    }

    if (cFilter) {
        let catHtml = '<option value="all">Tüm Kategoriler</option>';
        catHtml += '<option value="Kart Ödemesi">Borç Ödemeleri</option>';
        catHtml += state.categories.map(c => `<option value="${c}">${c}</option>`).join('');
        cFilter.innerHTML = catHtml;
        initCustomSelect('filter-category');
    }

    if (dFilter) {
        dFilter.innerHTML = `
            <option value="all">Tüm Zamanlar</option>
            <option value="7days">Son 1 Hafta</option>
            <option value="1month">Son 1 Ay</option>
            <option value="3months">Son 3 Ay</option>
            <option value="6months">Son 6 Ay</option>
            <option value="1year">Son 1 Yıl</option>
            <option value="custom">Özel Aralık...</option>
        `;
        initCustomSelect('filter-range');
    }
}
function openCustomRangeModal() {
    const html = `<div class="modal-input-group"><label>Başlangıç</label><input type="date" id="custom-start"></div><div class="modal-input-group"><label>Bitiş</label><input type="date" id="custom-end"></div>`;

    const isAnalysis = window.location.pathname.includes('analysis.html');
    const refreshFunc = isAnalysis ? () => { renderChart(); renderAnalysisList(); } : renderFullHistory;

    showModal('Tarih Aralığı', document.createRange().createContextualFragment(html), [
        {
            text: 'Vazgeç', class: 'btn-cancel', onClick: () => {
                document.getElementById('filter-range').value = 'all';
                refreshFunc();
            }
        },
        {
            text: 'Uygula', class: 'btn-confirm', onClick: () => {
                const s = document.getElementById('custom-start').value;
                const e = document.getElementById('custom-end').value;
                if (s && e) {
                    state.customRange.start = s;
                    state.customRange.end = e;
                    refreshFunc();
                }
                else { setTimeout(() => showModal('Hata', 'Tarihleri seçiniz'), 200); }
            }
        }
    ]);
}

function renderFullHistory() {
    const list = document.getElementById('full-history-list'); if (!list) return;
    const mVal = document.getElementById('filter-method').value;
    const cVal = document.getElementById('filter-category').value;
    const dVal = document.getElementById('filter-range').value;
    const sVal = document.getElementById('filter-search').value.toLocaleLowerCase('tr');

    let filtered = state.expenses.filter(item => {
        if (mVal !== 'all' && item.method !== mVal) return false;
        if (cVal !== 'all' && item.category !== cVal) return false;
        if (sVal && !item.merchant.toLocaleLowerCase('tr').includes(sVal)) return false;
        return checkDateFilter(item.isoDate, dVal);
    });

    // DÜZELTME: Önce Tarihe (isoDate) göre, tarih aynıysa ID'ye göre sırala
    filtered.sort((a, b) => {
        // Tarih karşılaştırması (Yeniden eskiye)
        if (b.isoDate !== a.isoDate) {
            return b.isoDate.localeCompare(a.isoDate);
        }
        // Eğer tarihler aynıysa son ekleneni üste al
        return b.id - a.id;
    });

    renderList(filtered, 'full-history-list');
}

function checkDateFilter(itemDateIso, filterVal) {
    if (filterVal === 'all') return true;
    const itemDate = new Date(itemDateIso);
    const today = new Date(); today.setHours(23, 59, 59, 999);
    if (filterVal === 'custom') {
        const s = new Date(state.customRange.start); const e = new Date(state.customRange.end); e.setHours(23, 59, 59);
        return itemDate >= s && itemDate <= e;
    }
    const past = new Date();
    if (filterVal === '7days') past.setDate(today.getDate() - 7);
    else if (filterVal === '1month') past.setMonth(today.getMonth() - 1);
    else if (filterVal === '3months') past.setMonth(today.getMonth() - 3);
    else if (filterVal === '6months') past.setMonth(today.getMonth() - 6);
    else if (filterVal === '1year') past.setFullYear(today.getFullYear() - 1);
    past.setHours(0, 0, 0, 0);
    return itemDate >= past && itemDate <= today;
}

function renderList(data, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (data.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fa-solid fa-cookie-bite"></i>
                <p>Henüz buralar dutluk...</p>
                ${containerId === 'transaction-history' ? '<button class="empty-state-btn" onclick="document.getElementById(\'exp-merchant\').focus()">Harcama Ekle</button>' : ''}
            </div>
        `;
        return;
    }

    let htmlContent = ''; let lastDate = '';
    const todayStr = formatDateTR(getLocalDateISO());
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterdayStr = formatDateTR(getLocalDateISO(y));

    data.forEach(item => {
        if (item.date !== lastDate) {
            let label = item.date;
            if (item.date === todayStr) label = "Bugün";
            else if (item.date === yesterdayStr) label = "Dün";
            htmlContent += `<div style="font-size:0.75rem; font-weight:800; color:var(--text-light); margin: 15px 0 8px 5px; text-transform:uppercase; letter-spacing:1px; opacity:0.8;">${label}</div>`;
            lastDate = item.date;
        }

        const isPayment = item.isPayment === true;
        const amountClass = isPayment ? 'var(--success)' : 'var(--text-main)';
        const amountPrefix = isPayment ? '+' : '-';

        // Icon Logic
        let iconClass = 'fa-bag-shopping'; // Default
        const cat = (item.category || '').toLowerCase();

        if (isPayment) {
            iconClass = 'fa-check';
        } else {
            if (cat.includes('market')) iconClass = 'fa-basket-shopping';
            else if (cat.includes('giyim')) iconClass = 'fa-shirt';
            else if (cat.includes('yemek') || cat.includes('restoran')) iconClass = 'fa-utensils';
            else if (cat.includes('ulaşım') || cat.includes('yakıt')) iconClass = 'fa-car';
            else if (cat.includes('fatura')) iconClass = 'fa-file-invoice';
            else if (cat.includes('sağlık')) iconClass = 'fa-heart-pulse';
            else if (cat.includes('eğlence')) iconClass = 'fa-film';
            else if (cat.includes('elektronik') || cat.includes('teknoloji')) iconClass = 'fa-plug';
            else if (cat.includes('eğitim')) iconClass = 'fa-graduation-cap';
            else if (cat.includes('kozmetik')) iconClass = 'fa-eye'; // or fa-spray-can if available, but eye is safe
            else if (cat.includes('ev')) iconClass = 'fa-house-chimney';
            else if (cat.includes('tatil')) iconClass = 'fa-plane';
            else if (cat.includes('spor')) iconClass = 'fa-dumbbell';
            else if (cat.includes('abonelik')) iconClass = 'fa-repeat';
        }

        const iconStyle = isPayment ? 'color:var(--success); background:rgba(46, 196, 182, 0.15);' : '';

        htmlContent += `
        <div class="t-row" onclick="openDetails(${item.id})">
            <div class="t-icon" style="${iconStyle}">
                <i class="fa-solid ${iconClass}"></i>
            </div>
            <div class="t-details">
                <span class="t-merchant" style="${isPayment ? 'color:var(--success)' : ''}">${item.merchant}</span>
                <span class="t-meta">${item.description ? item.description + ' • ' : ''}${item.method} • ${item.category || '-'}</span>
            </div>
            <div class="t-amount" style="color:${amountClass}">${amountPrefix}${formatMoney(item.amount)}₺</div>
        </div>`;
    });
    container.innerHTML = htmlContent;
}

function renderChart() {
    const ctx = document.getElementById('expenseChart');
    if (!ctx) return;

    const rangeVal = document.getElementById('filter-range') ? document.getElementById('filter-range').value : 'all';
    const methodVal = document.getElementById('filter-method') ? document.getElementById('filter-method').value : 'all';

    const filteredData = state.expenses.filter(item => {
        if (methodVal !== 'all' && item.method !== methodVal) return false;
        return checkDateFilter(item.isoDate, rangeVal);
    });

    const catTotals = {};
    filteredData.forEach(x => { catTotals[x.category] = (catTotals[x.category] || 0) + x.amount; });

    const labels = Object.keys(catTotals);
    const data = Object.values(catTotals).map(val => val / 100);
    if (labels.length === 0) return;
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: ['#4361ee', '#3f37c9', '#4cc9f0', '#f72585', '#7209b7', '#2ec4b6', '#ff9f1c', '#fee440'],
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (e, elements) => {
                const listHeader = document.querySelector('#analysis-list').previousElementSibling.querySelector('h3');

                if (elements.length > 0) {
                    const index = elements[0].index;
                    const categoryName = state.chart.data.labels[index];

                    const filtered = state.expenses
                        .filter(x => x.category === categoryName)
                        .sort((a, b) => b.isoDate.localeCompare(a.isoDate));

                    renderList(filtered, 'analysis-list');
                    if (listHeader) listHeader.textContent = `${categoryName} Harcamaları`;
                } else {
                    renderAnalysisList();
                    if (listHeader) listHeader.textContent = 'En Yüksek Harcamalar';
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: state.isDark ? '#edf2f4' : '#2b2d42', padding: 20 }
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.label || '';
                            if (label) { label += ': '; }
                            if (context.parsed !== null) {
                                label += new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(context.parsed);
                            }
                            return label;
                        }
                    }
                }
            },
            cutout: '70%'
        }
    });
}

function renderAnalysisList() {
    const listDiv = document.getElementById('analysis-list');
    if (!listDiv) return;

    const rangeVal = document.getElementById('filter-range') ? document.getElementById('filter-range').value : 'all';
    const methodVal = document.getElementById('filter-method') ? document.getElementById('filter-method').value : 'all';
    const sortVal = document.getElementById('sort-analysis') ? document.getElementById('sort-analysis').value : 'date-desc';

    let filtered = state.expenses.filter(item => {
        if (methodVal !== 'all' && item.method !== methodVal) return false;
        return checkDateFilter(item.isoDate, rangeVal);
    });

    filtered.sort((a, b) => {
        if (sortVal === 'amount-desc') return b.amount - a.amount;
        if (sortVal === 'amount-asc') return a.amount - b.amount;
        if (sortVal === 'date-asc') return a.isoDate.localeCompare(b.isoDate);
        return b.isoDate.localeCompare(a.isoDate);
    });

    renderList(filtered, 'analysis-list');
}

function toggleSettingsView(showSettings) {
    const dashboard = document.getElementById('dashboard-view');
    const settings = document.getElementById('settings-view');
    const title = document.getElementById('page-title');
    const desc = document.getElementById('page-desc');
    const navItems = document.querySelectorAll('.nav-item');

    if (!dashboard || !settings) return;

    if (showSettings) {
        dashboard.classList.add('hidden');
        settings.classList.remove('hidden');
        if (title) title.innerText = "Ayarlar ⚙️";
        if (desc) desc.innerText = "Veri yönetimi ve yedekleme.";
        navItems.forEach(n => n.classList.remove('active'));
        const setBtn = document.getElementById('nav-settings');
        if (setBtn) setBtn.classList.add('active');
    } else {
        settings.classList.add('hidden');
        dashboard.classList.remove('hidden');
        if (title) title.innerText = "Hoş Geldin! 👋";
        if (desc) desc.innerText = "Finansal durumunu kontrol et.";
        const dashBtn = document.querySelector('a[href="index.html"]');
        if (dashBtn) dashBtn.classList.add('active');
        const setBtn = document.getElementById('nav-settings');
        if (setBtn) setBtn.classList.remove('active');
    }
}

function isValidDate(d) { if (!d) return false; const y = new Date(d).getFullYear(); return y >= 2000 && y <= 2100; }
function formatDateTR(iso) { const p = iso.split('-'); return `${p[2]}.${p[1]}.${p[0]}`; }
function saveData() {
    localStorage.setItem('exp_logs', JSON.stringify(state.expenses));
    localStorage.setItem('exp_cards', JSON.stringify(state.cards));
    localStorage.setItem('exp_assets', JSON.stringify(state.assets));
    localStorage.setItem('exp_methods', JSON.stringify(state.methods));
    localStorage.setItem('exp_cats', JSON.stringify(state.categories));
    localStorage.setItem('exp_merchants', JSON.stringify(state.merchants));
    localStorage.setItem('exp_recurring_plans', JSON.stringify(state.recurringPlans));
    localStorage.setItem('exp_recurring_income', JSON.stringify(state.recurringIncome));
    localStorage.setItem('exp_balance_logs', JSON.stringify(state.balanceLogs));
}
function applyTheme() { document.body.className = state.isDark ? 'dark-theme' : ''; }
function toggleTheme() {
    state.isDark = !state.isDark;
    localStorage.setItem('dark_mode', state.isDark);
    applyTheme();
    if (document.getElementById('expenseChart') && typeof renderChart === 'function') {
        renderChart();
    }
}

function setupModalHTML() {
    if (document.getElementById('app-modal')) return;
    const d = document.createElement('div'); d.id = 'app-modal'; d.className = 'modal-overlay';
    d.innerHTML = `
        <div class="custom-modal">
            <div class="modal-header-row">
                <div id="modal-title" class="modal-header"></div>
                <button onclick="closeModal()" class="modal-close-btn"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="modal-body" class="modal-body"></div>
            <div id="modal-actions" class="modal-actions"></div>
        </div>`;
    document.body.appendChild(d);
}
function showModal(t, c, acts = [], extraClass = '') {
    const m = document.getElementById('app-modal');
    const modalBox = m.querySelector('.custom-modal');
    // Reset Classes
    modalBox.className = 'custom-modal';
    if (extraClass) {
        // Handle space-separated class names
        extraClass.split(' ').filter(cls => cls).forEach(cls => modalBox.classList.add(cls));
    }

    document.getElementById('modal-title').textContent = t;
    const b = document.getElementById('modal-body'); b.innerHTML = '';
    if (typeof c === 'string') b.textContent = c; else b.appendChild(c);
    const a = document.getElementById('modal-actions'); a.innerHTML = '';
    if (acts.length === 0) acts.push({ text: 'Tamam', class: 'btn-confirm' });
    acts.forEach(x => {
        const btn = document.createElement('button'); btn.className = `btn-modal ${x.class}`; btn.textContent = x.text;
        btn.onclick = () => { if (x.onClick && x.onClick() === false) return; closeModal(); };
        a.appendChild(btn);
    });
    m.classList.add('active');

    // Backdrop click to close
    m.onclick = function (e) {
        if (e.target === m) {
            closeModal();
        }
    };

    // UX FIX: Auto-focus first input when modal opens
    setTimeout(() => {
        const firstInput = modalBox.querySelector('input, select, textarea');
        if (firstInput) firstInput.focus();
    }, 100);
}
function closeModal() { document.getElementById('app-modal').classList.remove('active'); }

window.openDetails = function (id) {
    const item = state.expenses.find(x => x.id === id);
    if (!item) return;
    const html = `
        <div class="modal-input-group"><label>Yer</label><input id="edit-merch" value="${item.merchant}"></div>
        <div class="modal-input-group"><label>Tutar</label><input type="number" id="edit-amount" value="${item.amount}"></div>
        <div class="modal-input-group"><label>Tarih</label>
            <div class="input-wrapper" style="position:relative;">
                <input type="date" id="edit-date" value="${item.isoDate}" style="padding-left:40px !important;">
                <i class="fa-regular fa-calendar" style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--text-light); pointer-events:none;"></i>
            </div>
        </div>
        ${item.recurringPlanId ? `<div style="padding:10px; background:rgba(67,97,238,0.1); border-radius:8px; font-size:0.85rem; color:var(--primary); margin-bottom:15px; border-left:4px solid var(--primary);">
            <i class="fa-solid fa-clock-rotate-left"></i> Bu harcama bir <strong>Düzenli Gider</strong> planından otomatik oluşturulmuştur.
        </div>` : ''}
    `;
    showModal('Detay / Düzenle', document.createRange().createContextualFragment(html), [
        {
            text: 'Sil', class: 'btn-delete', onClick: () => {
                setTimeout(() => {
                    showModal('Onay', 'Silmek istediğine emin misin?', [
                        { text: 'Vazgeç', class: 'btn-cancel' }, { text: 'Evet', class: 'btn-delete', onClick: () => deleteExpense(id) }
                    ]);
                }, 200);
            }
        },
        {
            text: 'Güncelle', class: 'btn-confirm', onClick: () => {
                const m = document.getElementById('edit-merch').value;
                const a = parseFloat(document.getElementById('edit-amount').value);
                const d = document.getElementById('edit-date').value;

                if (m && a) {
                    // --- EKLENEN KISIM BAŞLANGIÇ (Farkı Hesapla) ---
                    if (!item.isCredit) { // Sadece nakit/banka harcamaları için
                        const oldAmount = item.amount;
                        const diff = a - oldAmount; // Yeni Tutar - Eski Tutar

                        // Eğer tutar arttıysa (örn: 100 -> 150), fark 50'dir. Cüzdandan 50 daha düşmeliyiz (-50).
                        if (diff !== 0) {
                            state.balanceLogs.push({
                                id: Date.now(),
                                title: `Düzeltme: ${m}`,
                                amount: -diff,
                                date: getLocalDateISO(),
                                createdAt: new Date().toISOString()
                            });
                        }
                    }
                    // --- EKLENEN KISIM BİTİŞ ---

                    item.merchant = m; item.amount = a; item.isoDate = d; item.date = formatDateTR(d);
                    saveData();
                    if (window.location.pathname.includes('credit')) updateStatementView();
                    else if (window.location.pathname.includes('expenses')) renderFullHistory();
                    else updateDashboard();
                    showToast('Güncellendi', 'Kayıt ve bakiye düzenlendi.');
                }
            }
        }
    ]);

    // Initialize Flatpickr for "Tarih" input in Edit Modal
    if (window.flatpickr) {
        flatpickr("#edit-date", {
            locale: "tr",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d F Y",
            defaultDate: item.isoDate,
            disableMobile: true,
            theme: "dark" // Our CSS overrides layout
        });
    }
};

function deleteExpense(id) {
    const deletedItem = state.expenses.find(x => x.id === id);
    if (!deletedItem) return;

    // --- EKLENEN KISIM BAŞLANGIÇ ---
    // Eğer işlem kredi kartı değilse (yani nakit/banka ise), bakiyeye iade et
    if (!deletedItem.isCredit) {
        state.balanceLogs.push({
            id: Date.now(),
            title: `İade: ${deletedItem.merchant}`, // İade açıklaması
            amount: Number(deletedItem.amount), // Pozitif tutar (Para girişi)
            date: getLocalDateISO(),
            createdAt: new Date().toISOString()
        });
        showToast('Bakiye İadesi', 'Silinen harcama tutarı cüzdana geri eklendi.', 'info');
    }
    // --- EKLENEN KISIM BİTİŞ ---

    state.expenses = state.expenses.filter(x => x.id !== id);
    saveData();

    if (window.location.pathname.includes('credit')) updateStatementView();
    else if (window.location.pathname.includes('expenses')) renderFullHistory();
    else updateDashboard();

    closeModal();
}

function showToast(title, message, type = 'success', action = null) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    let iconClass = 'fa-circle-info';
    if (type === 'success') iconClass = 'fa-circle-check';
    if (type === 'error') iconClass = 'fa-circle-exclamation';

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let actionHtml = '';
    if (action) {
        actionHtml = `<button class="btn-toast-action" id="toast-action-${Date.now()}">${action.text}</button>`;
    }

    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:15px; flex:1;">
            <div class="toast-icon"><i class="fa-solid ${iconClass}"></i></div>
            <div class="toast-content">
                <span class="toast-title">${title}</span>
                <span class="toast-msg">${message}</span>
            </div>
        </div>
        ${actionHtml}
    `;

    container.appendChild(toast);

    if (action) {
        const btn = toast.querySelector('button');
        btn.onclick = () => {
            action.onClick();
            toast.remove();
        };
    }

    const duration = action ? 5000 : 3000;

    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'fadeOutRight 0.5s forwards';
            setTimeout(() => { if (toast.parentElement) toast.remove(); }, 500);
        }
    }, duration);
}

// YENİ YEDEKLEME FONKSİYONU (Her şeyi kapsar)
window.downloadBackup = function () {
    const data = {
        expenses: state.expenses,
        cards: state.cards,
        methods: state.methods,
        categories: state.categories,
        merchants: state.merchants,
        recurringPlans: state.recurringPlans,
        recurringIncome: state.recurringIncome,
        balanceLogs: state.balanceLogs,
        assets: state.assets,
        isDark: state.isDark,
        isPrivacyMode: state.isPrivacyMode,
        dataVersion: state.dataVersion, // Track currency format version
        lastSync: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getBackupFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showModal('Başarılı', 'Tüm veriler (Cüzdan, Varlıklar, Ayarlar) dahil yedeklendi.');
}

// YENİ GERİ YÜKLEME FONKSİYONU
window.changeSyncFile = function () {
    const input = document.getElementById('restore-file-input');
    if (input) input.click();
    else console.error('Restore input not found!');
};

window.restoreBackup = function (eventOrInput) {
    // Handle both direct element pass and event object
    let input = eventOrInput;
    if (eventOrInput.target && eventOrInput.target.files) {
        input = eventOrInput.target;
    }

    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data.expenses) && Array.isArray(data.cards)) {
                // Temel Veriler
                const defaultMethods = ['Nakit', 'Havale / EFT'];
                const defaultCats = ['Market', 'Yemek', 'Ulaşım', 'Teknoloji', 'Online Alışveriş', 'Fatura', 'Giyim', 'Sağlık', 'Eğlence', 'Diğer'];

                // Merge Sets to avoid duplicates
                const methodsSet = new Set([...defaultMethods, ...(data.methods || [])]);
                const catsSet = new Set([...defaultCats, ...(data.categories || [])]);

                localStorage.setItem('exp_logs', JSON.stringify(data.expenses));
                localStorage.setItem('exp_cards', JSON.stringify(data.cards));
                localStorage.setItem('exp_methods', JSON.stringify([...methodsSet]));
                localStorage.setItem('exp_cats', JSON.stringify([...catsSet]));
                if (data.merchants) localStorage.setItem('exp_merchants', JSON.stringify(data.merchants));

                // Yeni Eklenenler (Eksikse boş array atar)
                localStorage.setItem('exp_recurring_plans', JSON.stringify(data.recurringPlans || []));
                localStorage.setItem('exp_recurring_income', JSON.stringify(data.recurringIncome || []));
                localStorage.setItem('exp_balance_logs', JSON.stringify(data.balanceLogs || []));
                localStorage.setItem('exp_assets', JSON.stringify(data.assets || []));

                // Ayarlar
                if (data.isDark !== undefined) localStorage.setItem('dark_mode', data.isDark);
                if (data.isPrivacyMode !== undefined) localStorage.setItem('privacy_mode', data.isPrivacyMode);

                // Yedekleme Tarihini Kaydet (Görünürlük için)
                let backupDate = null;

                if (data.lastSync) {
                    backupDate = new Date(data.lastSync);
                } else {
                    // 1. Dosya adından YYYY-MM-DD (2026-02-05)
                    const isoMatch = file.name.match(/(\d{4})-(\d{2})-(\d{2})/);
                    if (isoMatch) {
                        backupDate = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00`);
                    } else {
                        // 2. Dosya adından DD.MM.YYYY (05.02.2026)
                        const dotMatch = file.name.match(/(\d{2})\.(\d{2})\.(\d{4})/);
                        if (dotMatch) {
                            backupDate = new Date(`${dotMatch[3]}-${dotMatch[2]}-${dotMatch[1]}T12:00:00`);
                        } else if (file.lastModified) {
                            // 3. Dosya metadatasından
                            backupDate = new Date(file.lastModified);
                        }
                    }
                }

                if (!backupDate || isNaN(backupDate.getTime())) {
                    backupDate = new Date(); // Fallback to now
                }

                localStorage.setItem('exp_last_sync', backupDate.toISOString());

                // Reset dataVersion to trigger migration on reload (for legacy backups)
                if (!data.dataVersion || data.dataVersion < 2) {
                    localStorage.setItem('exp_data_version', '1');
                } else {
                    localStorage.setItem('exp_data_version', data.dataVersion.toString());
                }

                showModal('Tamamlandı', 'Tüm veriler başarıyla yüklendi. Sayfa yenileniyor...');
                setTimeout(() => location.reload(), 1500);
            } else {
                showModal('Hata', 'Geçersiz veya eski sürüm yedek dosyası.');
            }
        } catch (err) {
            console.error(err);
            showModal('Hata', 'Dosya okunamadı. JSON formatı bozuk olabilir.');
        }
    };
    reader.readAsText(file);
}

// Dinamik içerik için Event Delegation (Akıllı Dinleyici)
// Bu kod, settings sayfası sonradan yüklense bile dosya seçimini yakalar.
document.addEventListener('change', function (e) {
    if (e.target && e.target.id === 'restore-file-input') {
        console.log("[Restore] Yedek dosyası seçildi, işlem başlatılıyor...");
        restoreBackup(e.target);
    }
});

window.confirmReset = function () {
    showModal('DİKKAT!', 'Tüm veriler (Harcamalar, Kartlar, Ayarlar) kalıcı olarak silinecek ve uygulama fabrika ayarlarına dönecek.\n\nBu işlem geri alınamaz!', [
        { text: 'Vazgeç', class: 'btn-cancel', onClick: () => toggleSettingsView(true) },
        {
            text: 'Evet, Hepsini Sil', class: 'btn-delete', onClick: () => {
                localStorage.clear();
                // Extra safety: explicit removal
                const keys = ['exp_logs', 'exp_cards', 'exp_assets', 'exp_methods', 'exp_cats', 'exp_merchants', 'dark_mode', 'privacy_mode', 'wallet_privacy', 'exp_recurring_plans', 'exp_recurring_income', 'exp_balance_logs'];
                keys.forEach(k => localStorage.removeItem(k));

                showToast('Sıfırlandı', 'Veriler temizlendi, uygulama yeniden başlatılıyor...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            }
        }
    ]);
}
function updatePeriodSelector() { }

// === KURUŞ (INTEGER CURRENCY) HELPER FUNCTIONS ===
// Tüm parasal değerler kuruş cinsinden (integer) saklanır
// 100.50 TL = 10050 kuruş

/**
 * TL değerini kuruşa çevirir (kayıt için)
 * @param {number} tl - TL cinsinden değer (örn: 100.50)
 * @returns {number} - Kuruş cinsinden integer değer (örn: 10050)
 */
function toKurus(tl) {
    if (tl === null || tl === undefined || isNaN(tl)) return 0;
    return Math.round(Number(tl) * 100);
}

/**
 * Kuruşu TL'ye çevirir (görüntüleme için)
 * @param {number} kurus - Kuruş cinsinden integer değer
 * @returns {number} - TL cinsinden değer
 */
function toTL(kurus) {
    if (kurus === null || kurus === undefined || isNaN(kurus)) return 0;
    return Number(kurus) / 100;
}

/**
 * Kuruş değerini formatlı TL string'e çevirir
 * @param {number} kurus - Kuruş cinsinden integer değer
 * @returns {string} - Formatlı TL (örn: "1.234,50")
 */
function formatMoney(kurus) {
    const tl = toTL(kurus);
    return tl.toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/**
 * @deprecated - Use toKurus() instead for new code
 */
function roundToTwo(num) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
}

function updateCardActionButton() {
    const btn = document.getElementById('card-action-btn');
    if (!btn) return;

    if (state.activeViewCardId === 'all') {
        btn.innerHTML = '<i class="fa-solid fa-plus"></i> Kart Ekle';
    } else {
        btn.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Kart Yönetimi';
    }
}

function getOfficialHolidays(year) {
    let holidays = {};

    // Fixed Holidays (Same every year)
    holidays[`${year}-01-01`] = "Yılbaşı";
    holidays[`${year}-04-23`] = "Ulusal Egemenlik ve Çocuk Bayramı";
    holidays[`${year}-05-01`] = "Emek ve Dayanışma Günü";
    holidays[`${year}-05-19`] = "Atatürk’ü Anma, Gençlik ve Spor Bayramı";
    holidays[`${year}-07-15`] = "Demokrasi ve Millî Birlik Günü";
    holidays[`${year}-08-30`] = "Zafer Bayramı";
    holidays[`${year}-10-28`] = "Cumhuriyet Bayramı Arifesi";
    holidays[`${year}-10-29`] = "Cumhuriyet Bayramı";
    // holidays[`${year}-12-31`] = "Yılbaşı Gecesi"; // Not an official holiday for work, but listed by user.

    // Dynamic Holidays (Specific to 2026/2027)
    if (year === 2026) {
        holidays["2026-03-19"] = "Ramazan Bayramı Arifesi";
        holidays["2026-03-20"] = "Ramazan Bayramı 1.gün";
        holidays["2026-03-21"] = "Ramazan Bayramı 2.gün";
        holidays["2026-03-22"] = "Ramazan Bayramı 3.gün";

        holidays["2026-05-26"] = "Kurban Bayramı Arifesi";
        holidays["2026-05-27"] = "Kurban Bayramı 1.gün";
        holidays["2026-05-28"] = "Kurban Bayramı 2.gün";
        holidays["2026-05-29"] = "Kurban Bayramı 3.gün";
        holidays["2026-05-30"] = "Kurban Bayramı 4.gün";
    }

    if (year === 2027) {
        holidays["2027-03-08"] = "Ramazan Bayramı Arifesi";
        holidays["2027-03-09"] = "Ramazan Bayramı 1.gün";
        holidays["2027-03-10"] = "Ramazan Bayramı 2.gün";
        holidays["2027-03-11"] = "Ramazan Bayramı 3.gün";

        holidays["2027-05-15"] = "Kurban Bayramı Arifesi";
        holidays["2027-05-16"] = "Kurban Bayramı 1.gün";
        holidays["2027-05-17"] = "Kurban Bayramı 2.gün";
        holidays["2027-05-18"] = "Kurban Bayramı 3.gün";
        if (holidays["2027-05-19"]) holidays["2027-05-19"] += " & Kurban Bayramı 4.gün";
        else holidays["2027-05-19"] = "Kurban Bayramı 4.gün";
    }

    return holidays;
}

function getNextWorkDayTR(date) {
    let checkDate = new Date(date);
    let iterations = 0;

    while (iterations < 60) {
        iterations++;
        const year = checkDate.getFullYear();
        const holidays = getOfficialHolidays(year);

        const day = checkDate.getDay(); // 0=Sun, 6=Sat
        const dateStr = `${year}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;

        // If Saturday (6), Sunday (0), or Official Holiday -> Move next day
        if (day === 0 || day === 6 || holidays[dateStr]) {
            checkDate.setDate(checkDate.getDate() + 1);
        } else {
            break; // Found a workday
        }
    }
    return checkDate;
}

function openPayDebtModal() {
    if (state.activeViewCardId === 'all') {
        showToast('Kart Seçiniz', 'Borç ödemek için lütfen yukarıdan belirli bir kart seçin.', 'error');
        return;
    }

    const activeCard = state.cards.find(c => c.id === state.activeViewCardId);
    if (!activeCard) return;

    const today = new Date();
    today.setMonth(today.getMonth() + state.periodOffset);
    let start, end;
    const cutoff = activeCard.cutoff;

    if (today.getDate() < cutoff) {
        start = new Date(today.getFullYear(), today.getMonth() - 1, cutoff);
        end = new Date(today.getFullYear(), today.getMonth(), cutoff);
    } else {
        start = new Date(today.getFullYear(), today.getMonth(), cutoff);
        end = new Date(today.getFullYear(), today.getMonth() + 1, cutoff);
    }

    // Adjust end date if it falls on weekend/holiday (Accurate Cutoff Date)
    end = getNextWorkDayTR(end);

    const allCardOps = state.expenses.filter(x => x.method === activeCard.name);

    const cumulativeSpends = allCardOps
        .filter(x => !x.isPayment && new Date(x.isoDate) < end)
        .reduce((acc, curr) => acc + curr.amount, 0);

    const totalPaymentsAllTime = allCardOps
        .filter(x => x.isPayment)
        .reduce((acc, curr) => acc + curr.amount, 0);

    const periodDebt = Math.max(0, cumulativeSpends - totalPaymentsAllTime);

    const totalSpends = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
    const totalDebt = Math.max(0, totalSpends - totalPaymentsAllTime);

    const html = `
        <div class="modal-input-group">
            <label>Ödenecek Kart</label>
            <input type="text" value="${activeCard.name}" disabled style="opacity:0.7; cursor:not-allowed;">
        </div>
        
        <div class="modal-input-group">
            <label>Ödeme Tutarı (TL)</label>
            <input type="number" id="debt-payment-amount" placeholder="0.00">
            <small style="color:var(--text-light); font-size:0.75rem;">Maksimum ödenebilir: ${formatMoney(totalDebt)} ₺</small>
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <button onclick="document.getElementById('debt-payment-amount').value = '${periodDebt}'; document.getElementById('debt-payment-amount').focus();" 
                style="flex:1; padding:10px; font-size:0.85rem; background:rgba(67, 97, 238, 0.1); color:var(--primary); border:1px solid var(--primary); border-radius:8px; cursor:pointer; transition:0.2s;">
                <i class="fa-solid fa-calendar-day"></i> Dönem Borcu: <strong>${formatMoney(periodDebt)}₺</strong>
            </button>
            <button onclick="document.getElementById('debt-payment-amount').value = '${totalDebt}'; document.getElementById('debt-payment-amount').focus();" 
                style="flex:1; padding:10px; font-size:0.85rem; background:rgba(239, 35, 60, 0.1); color:var(--danger); border:1px solid var(--danger); border-radius:8px; cursor:pointer; transition:0.2s;">
                <i class="fa-solid fa-wallet"></i> Tüm Borç: <strong>${formatMoney(totalDebt)}₺</strong>
            </button>
        </div>

        <div class="modal-input-group">
            <label>Ödeme Tarihi</label>
            <input type="date" id="debt-payment-date" value="${getLocalDateISO()}">
        </div>
    `;

    showModal(`Ödeme Yap: ${activeCard.name}`, document.createRange().createContextualFragment(html), [
        { text: 'Vazgeç', class: 'btn-cancel' },
        { text: 'Ödemeyi Onayla', class: 'btn-confirm', onClick: () => saveDebtPayment(activeCard) }
    ], '');
}

function saveDebtPayment(card) {
    const amountVal = toKurus(parseFloat(document.getElementById('debt-payment-amount').value)); // Store in kuruş
    const dateVal = document.getElementById('debt-payment-date').value;

    if (!amountVal || amountVal <= 0) {
        showToast('Hata', 'Geçerli bir tutar giriniz.', 'error');
        return false;
    }

    const allCardOps = state.expenses.filter(x => x.method === card.name);
    const totalSpends = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
    const totalPayments = allCardOps.filter(x => x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
    const currentTotalDebt = Math.max(0, totalSpends - totalPayments);

    if (amountVal > (currentTotalDebt + 0.1)) {
        showToast('Limit Hatası', `Toplam borçtan (${formatMoney(currentTotalDebt)}₺) fazla ödeme yapılamaz.`, 'error');
        return false;
    }

    state.expenses.push({
        id: Date.now(),
        merchant: 'Kredi Kartı Borç Ödeme',
        amount: amountVal,
        method: card.name,
        category: 'Kart Ödemesi',
        isoDate: dateVal,
        date: formatDateTR(dateVal),
        isCredit: true,
        isPayment: true
    });

    // --- EKLENEN KISIM BAŞLANGIÇ (Cüzdandan Düşme) ---
    state.balanceLogs.push({
        id: Date.now() + 1, // Benzersiz ID için +1
        title: `KK Borç Ödemesi: ${card.name}`,
        amount: -amountVal, // Eksi bakiye (Para çıkışı)
        date: dateVal,
        createdAt: new Date().toISOString()
    });
    // --- EKLENEN KISIM BİTİŞ ---

    saveData();
    updateStatementView();
    if (typeof renderWalletWidget === 'function') renderWalletWidget();
    showToast('Başarılı', 'Borç ödendi ve bakiyeden düşüldü.', 'success');
    closeModal();
}

function initCustomSelect(selectId) {
    const originalSelect = document.getElementById(selectId);
    if (!originalSelect) return;

    // FIX: Only check the element immediately after this select
    const nextEl = originalSelect.nextElementSibling;
    if (nextEl && nextEl.classList.contains('custom-select-wrapper')) {
        nextEl.remove();
    }

    originalSelect.style.display = 'none';

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select-wrapper';

    // Helper to get icon for category/method
    function getIconForOption(text) {
        if (!text) return 'fa-solid fa-tag';
        const t = text.toString().toLowerCase();

        // 1. Placeholder / Default
        if (t.includes('kategori')) return 'fa-solid fa-layer-group';
        if (t.includes('seçiniz') || t.includes('seciniz') || t.includes('tüm kartlar') || t.includes('tum kartlar')) return 'fa-regular fa-credit-card';

        // 2. Specific Turkish Banks & Cards (Prioritized)
        if (t.includes('enpara') || t.includes('ziraat') || t.includes('garanti') || t.includes('yapı kredi') ||
            t.includes('akbank') || t.includes('iş bankası') || t.includes('finans') || t.includes('vakıf') ||
            t.includes('debit')) {
            return 'fa-regular fa-credit-card';
        }

        // 3. Specific Installment/Payment Terms
        if (t.includes('tek çekim') || t.includes('tek cekim')) return 'fa-solid fa-money-bill-1';
        if (t.includes('taksit')) return 'fa-solid fa-layer-group';
        if (t.includes('havale') || t.includes('eft') || t.includes('transfer')) return 'fa-solid fa-money-bill-transfer';
        if (t === 'nakit') return 'fa-solid fa-wallet';

        // Cashback / Return Types
        if (t.includes('iade yok')) return 'fa-solid fa-circle-xmark';
        if (t.includes('yüzde')) return 'fa-solid fa-percent';
        if (t.includes('sabit')) return 'fa-solid fa-turkish-lira-sign';

        // Brand Icons
        if (t.includes('visa')) return 'fa-brands fa-cc-visa';
        if (t.includes('mastercard')) return 'fa-brands fa-cc-mastercard';
        if (t.includes('amex') || t.includes('american express')) return 'fa-brands fa-cc-amex';
        if (t.includes('troy')) return 'fa-regular fa-credit-card';

        // 4. Generic Card Detection (User Created)
        const isUserCard = state.cards && state.cards.some(c => c.name.toLowerCase() === t);
        if (isUserCard) {
            if (t.includes('visa')) return 'fa-brands fa-cc-visa';
            if (t.includes('mastercard')) return 'fa-brands fa-cc-mastercard';
            if (t.includes('amex')) return 'fa-brands fa-cc-amex';
            return 'fa-regular fa-credit-card';
        }

        // 5. Categories
        if (t.includes('market')) return 'fa-solid fa-basket-shopping';
        if (t.includes('giyim')) return 'fa-solid fa-shirt';
        if (t.includes('yemek') || t.includes('restoran')) return 'fa-solid fa-utensils';
        if (t.includes('ulaşım') || t.includes('yakıt')) return 'fa-solid fa-car';
        if (t.includes('fatura')) return 'fa-solid fa-file-invoice';
        if (t.includes('sağlık')) return 'fa-solid fa-heart-pulse';
        if (t.includes('eğlence')) return 'fa-solid fa-film';
        if (t.includes('elektronik') || t.includes('teknoloji')) return 'fa-solid fa-plug';
        if (t.includes('eğitim')) return 'fa-solid fa-graduation-cap';
        if (t.includes('kozmetik')) return 'fa-solid fa-eye';
        if (t.includes('ev')) return 'fa-solid fa-house-chimney';
        if (t.includes('tatil')) return 'fa-solid fa-plane';
        if (t.includes('spor')) return 'fa-solid fa-dumbbell';
        if (t.includes('abonelik')) return 'fa-solid fa-repeat';
        if (t.includes('online') || t.includes('alışveriş')) return 'fa-solid fa-cart-shopping';

        // Default
        return 'fa-solid fa-tag';
    }

    const trigger = document.createElement('div');
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('tabindex', '0');

    const selectedOption = originalSelect.options[originalSelect.selectedIndex];
    const initialText = selectedOption ? selectedOption.text : 'Seçiniz...';
    // FIX: Using only the returned class from helper (which includes fa-solid/brands/regular)
    trigger.innerHTML = `<i class="${getIconForOption(initialText)}"></i>${initialText}`;

    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            wrapper.classList.toggle('open');
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!wrapper.classList.contains('open')) wrapper.classList.add('open');
        } else if (e.key === 'Escape') {
            wrapper.classList.remove('open');
        }
    });

    const optionsList = document.createElement('div');
    optionsList.className = 'custom-options';



    Array.from(originalSelect.options).forEach(opt => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'custom-option';

        // Add Icon if applicable
        const iconClass = getIconForOption(opt.text);
        // Icon positioning handled by CSS
        optionDiv.innerHTML = `<i class="${iconClass}"></i>${opt.text}`;

        optionDiv.setAttribute('data-value', opt.value);

        if (opt.value === 'Kart Ödemesi') {
            optionDiv.style.color = 'var(--success)';
            optionDiv.style.fontWeight = 'bold';
            optionDiv.style.textShadow = '0 0 8px rgba(46, 196, 182, 0.4)';
        }

        if (opt.selected) {
            optionDiv.classList.add('selected');
            // Icon positioning handled by CSS
            trigger.innerHTML = `<i class="${iconClass}"></i>${opt.text}`;
        }

        optionDiv.addEventListener('click', function (e) {
            e.stopPropagation();

            // Get the icon class from clicked option
            const clickedIcon = this.querySelector('i');
            const iconClass = clickedIcon ? clickedIcon.className : 'fa-solid fa-tag';
            const text = this.textContent.trim();

            // Icon positioning handled by CSS
            trigger.innerHTML = `<i class="${iconClass}"></i>${text}`;
            wrapper.classList.remove('open');

            optionsList.querySelectorAll('.custom-option').forEach(el => el.classList.remove('selected'));
            this.classList.add('selected');

            originalSelect.value = this.getAttribute('data-value');
            originalSelect.dispatchEvent(new Event('change'));
        });

        optionsList.appendChild(optionDiv);
    });

    trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        document.querySelectorAll('.custom-select-wrapper').forEach(el => {
            if (el !== wrapper) el.classList.remove('open');
        });
        wrapper.classList.toggle('open');
    });

    wrapper.appendChild(trigger);
    wrapper.appendChild(optionsList);

    originalSelect.parentNode.insertBefore(wrapper, originalSelect.nextSibling);
}

document.addEventListener('click', function () {
    document.querySelectorAll('.custom-select-wrapper').forEach(el => el.classList.remove('open'));
});


async function fetchMarketData() {

    // CACHE CHECK: Rate Limit Prevention (10 mins)
    const lastFetch = localStorage.getItem('last_market_fetch');
    const now = Date.now();
    if (lastFetch && (now - lastFetch < 600000) && state.marketData && Object.keys(state.marketData).length > 0) {
        console.log('Veriler güncel (Cache), API pas geçildi.');
        renderMarketTicker();
        if (window.location.pathname.includes('savings.html')) renderSavingsPage();
        return;
    }


    // 1. YEDEK VERİLER
    const fallbackData = {
        'gram-altin': 7550.00,
        'usd': 43.30,
        'eur': 53.20,
        'btc': 0
    };

    if (!state.marketData || Object.keys(state.marketData).length === 0) {
        state.marketData = { ...fallbackData };
    }

    try {
        // CoinGecko: Crypto & Gold (PAXG)
        // Frankfurter: Fiat (EUR) - USD'yi CoinGecko'dan (USDT) alıyoruz çünkü TR piyasasında USDT daha yaygın referans

        const cgUrl = 'https://api.coingecko.com/api/v3/simple/price?ids=tether,pax-gold,bitcoin&vs_currencies=try';
        const ffUrl = 'https://api.frankfurter.app/latest?from=EUR&to=TRY';

        const [cgRes, ffRes] = await Promise.all([
            fetch(cgUrl),
            fetch(ffUrl)
        ]);

        if (!cgRes.ok || !ffRes.ok) throw new Error('API yanıtı başarısız.');

        const cgData = await cgRes.json();
        const ffData = await ffRes.json();

        // --- CoinGecko Verileri ---
        if (cgData.tether && cgData.tether.try) {
            state.marketData['usd'] = cgData.tether.try;
        }
        if (cgData.bitcoin && cgData.bitcoin.try) {
            state.marketData['btc'] = cgData.bitcoin.try;
        }
        if (cgData['pax-gold'] && cgData['pax-gold'].try) {
            // PAXG (1 Ons) -> Gram Hesabı
            state.marketData['gram-altin'] = cgData['pax-gold'].try / 31.1035;
        }

        // --- Frankfurter Verileri ---
        if (ffData.rates && ffData.rates.TRY) {
            state.marketData['eur'] = ffData.rates.TRY;
        }



        renderMarketTicker();
        if (typeof renderSavingsPage === 'function' && window.location.pathname.includes('savings.html')) {
            renderSavingsPage();
        }
        localStorage.setItem('last_market_fetch', Date.now()); // CACHE SUCCESS

    } catch (e) {
        console.warn('API Hatası, yedek veriler devrede:', e);
        showToast('Piyasa Verileri Güncel Değil', 'İnternet bağlantınızı kontrol edin. Son bilinen veya varsayılan değerler gösteriliyor.', 'warning');
        renderMarketTicker();
    }
}

function checkBackupUsage() {
    let count = parseInt(localStorage.getItem('user_login_count') || '0');
    count++;
    localStorage.setItem('user_login_count', count);

    // Her 30. girişte sor
    if (count % 100 === 0) {
        setTimeout(() => {
            showModal('Yedek Hatırlatması', 'Verilerini en son ne zaman yedekledin? Geri alınamaz veri kaybını önlemek için şimdi yedek indirebilirsin.', [
                { text: 'Daha Sonra', class: 'btn-cancel' },
                { text: 'Yedek İndir', class: 'btn-confirm', onClick: () => { downloadBackup(); closeModal(); } }
            ]);
        }, 1500);
    }
}

function exportToSheets() {
    // Google Sheets için özel format (Noktalı virgül yerine tab veya virgül daha iyi olabilir ama TR excel için noktalı virgül standarttır. 
    // Sheets için en temiz yöntem kopyalanabilir bir alan sunmak veya direkt CSV indirmektir.)
    // Burada kullanıcı isteğine göre "Sheets" isminde farklı bir CSV formatı sunacağız.

    const headers = ['Tarih', 'Yer', 'Aciklama', 'Tutar', 'Yontem', 'Kategori'];
    const rows = state.expenses.map(x => [
        x.date,
        `"${x.merchant.replace(/"/g, '""')}"`,
        `"${(x.description || '').replace(/"/g, '""')}"`,
        x.amount.toString().replace('.', ','),
        x.method,
        x.category
    ]);

    const csvContent = [
        headers.join('\t'),
        ...rows.map(r => r.join('\t'))
    ].join('\n'); // Tab separated values

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `google_sheets_import_${new Date().toISOString().slice(0, 10)}.tsv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Başarılı', 'Google Sheets uyumlu dosya (TSV) indirildi.');
}



function renderMarketTicker() {
    const container = document.getElementById('market-ticker');
    if (!container) return;

    const items = [
        { key: 'gram-altin', label: 'Gram Altın', icon: 'fa-coins', color: '#d4af37' },
        { key: 'usd', label: 'Dolar (USD)', icon: 'fa-dollar-sign', color: '#2ec4b6' },
        { key: 'eur', label: 'Euro (EUR)', icon: 'fa-euro-sign', color: '#4361ee' },
        { key: 'btc', label: 'Bitcoin', icon: 'fa-bitcoin-sign', color: '#f7931a' }
    ];

    let html = '';
    items.forEach(item => {
        const val = state.marketData[item.key];
        // FIX: formatMoney expects Kuruş (divides by 100), but marketData is already in TL.
        // So we use toLocaleString directly.
        const displayVal = val > 0 ? val.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';
        const isSavings = window.location.pathname.includes('savings.html');
        const clickAttr = isSavings ? `onclick="document.getElementById('asset-type').value='${item.key}'; document.getElementById('asset-price').value='${val}'; initCustomSelect('asset-type');"` : '';

        html += `
            <div class="market-card" ${clickAttr}>
                <div style="display:flex; justify-content:space-between;">
                    <span class="market-symbol" style="color:${item.color}">${item.label}</span>
                    <i class="fa-solid ${item.icon}" style="color:${item.color}; opacity:0.5;"></i>
                </div>
                <span class="market-price">${displayVal}</span>
            </div>
        `;
    });
    container.innerHTML = html;
}

function handleAssetTrade(type) {
    const assetType = document.getElementById('asset-type').value;
    const amount = parseFloat(document.getElementById('asset-amount').value); // Asset quantity stays float
    const priceKurus = toKurus(parseFloat(document.getElementById('asset-price').value)); // Store in kuruş
    const dateVal = document.getElementById('asset-date').value;

    if (!amount || amount <= 0 || !priceKurus || !dateVal) {
        showToast('Hata', 'Miktar ve fiyat giriniz.', 'error');
        return;
    }

    if (type === 'sell') {
        const currentQty = state.assets
            .filter(a => a.type === assetType)
            .reduce((acc, curr) => acc + (curr.tradeType === 'buy' ? curr.amount : -curr.amount), 0);

        if (amount > currentQty) {
            showToast('Yetersiz Bakiye', `Elinizde sadece ${currentQty} adet var.`, 'error');
            return;
        }
    }

    const trade = {
        id: Date.now(),
        type: assetType,
        amount: amount, // Quantity stays as float
        price: priceKurus, // Now in kuruş
        date: formatDateTR(dateVal),
        isoDate: dateVal,
        tradeType: type
    };

    state.assets.push(trade);

    // --- EKLENEN KISIM: Cüzdan Bakiyesi Güncelleme ---
    const totalValueKurus = Math.round(amount * priceKurus); // Total in kuruş
    state.balanceLogs.push({
        id: Date.now() + 1,
        title: `Yatırım ${type === 'buy' ? 'Alışı' : 'Satışı'}: ${assetType.toUpperCase()} (${amount}x)`,
        amount: type === 'buy' ? -totalValueKurus : totalValueKurus, // Alışta para çıkar, satışta para girer
        date: formatDateTR(dateVal), // Veya isoDate
        createdAt: new Date().toISOString()
    });
    // ------------------------------------------------

    saveData();

    document.getElementById('asset-amount').value = '';

    showToast('İşlem Başarılı', `${type === 'buy' ? 'Alış' : 'Satış'} kaydedildi. Cüzdan: ${formatMoney(Math.abs(totalValueKurus))} TL ${type === 'buy' ? 'Düştü' : 'Eklendi'}.`);
    renderSavingsPage();
}

/* --- RECURRING INCOME LOGIC --- */

window.addRecurringIncome = function () {
    const name = document.getElementById('income-name').value.trim();
    const amount = toKurus(parseFloat(document.getElementById('income-amount').value)); // Store in kuruş
    const day = parseInt(document.getElementById('income-day').value);

    if (!name || !amount || amount <= 0 || !day || day < 1 || day > 31) {
        showToast('Hata', 'Tüm alanları doğru doldurun.', 'error');
        return;
    }

    state.recurringIncome.push({
        id: Date.now(),
        name: name,
        amount: amount, // Now in kuruş
        day: day,
        active: true,
        lastProcessedMonth: null
    });

    saveData();
    showToast('Eklendi', `${name} düzenli gelir olarak kaydedildi.`);

    // Clear inputs
    document.getElementById('income-name').value = '';
    document.getElementById('income-amount').value = '';
    document.getElementById('income-day').value = '';

    renderRecurringIncomeList();
    checkRecurringIncome();
}

window.deleteRecurringIncome = function (id) {
    closeModal();
    setTimeout(() => {
        showModal('Sil', 'Bu düzenli geliri silmek istiyor musunuz?', [
            { text: 'Vazgeç', class: 'btn-cancel', onClick: () => { setTimeout(openWalletDetails, 100); } },
            {
                text: 'Sil', class: 'btn-delete', onClick: () => {
                    state.recurringIncome = state.recurringIncome.filter(i => i.id !== id);
                    saveData();
                    closeModal();
                    setTimeout(openWalletDetails, 100);
                    showToast('Silindi', 'Düzenli gelir silindi.');
                }
            }
        ]);
    }, 200);
}

function renderRecurringIncomeList() {
    const container = document.getElementById('recurring-income-list');
    if (!container) return;

    if (state.recurringIncome.length === 0) {
        container.innerHTML = '<div style="padding:15px; text-align:center; color:var(--text-light); font-size:0.9rem;">Henüz düzenli gelir eklenmemiş.</div>';
        return;
    }

    let html = '';
    state.recurringIncome.forEach(income => {
        html += `
            <div class="transaction-item" style="display:flex; justify-content:space-between; align-items:center; padding:12px; border-bottom:1px solid var(--border);">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:40px; height:40px; background:rgba(46,196,182,0.1); color:var(--success); border-radius:10px; display:flex; align-items:center; justify-content:center;">
                        <i class="fa-solid fa-money-bill-trend-up"></i>
                    </div>
                    <div>
                        <div style="font-weight:600; color:var(--text-main);">${income.name}</div>
                        <div style="font-size:0.8rem; color:var(--text-light);">Her ayın ${income.day}. günü</div>
                    </div>
                </div>
                <div style="display:flex; align-items:center; gap:15px;">
                    <span style="font-weight:700; color:var(--success);">+${formatMoney(income.amount)}₺</span>
                    <button class="btn-action-small" onclick="deleteRecurringIncome(${income.id})"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function checkRecurringIncome() {
    const now = new Date();
    const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const currentDay = now.getDate();
    let processedAny = false;

    state.recurringIncome.forEach(income => {
        if (!income.active) return;
        if (income.lastProcessedMonth === currentMonthStr) return; // Already processed this month
        if (currentDay < income.day) return; // Not yet time

        // Process this income
        const iso = `${currentMonthStr}-${String(income.day).padStart(2, '0')}`;

        state.balanceLogs.push({
            id: Date.now() + Math.random(),
            title: `Düzenli Gelir: ${income.name}`,
            amount: income.amount, // Positive = income
            date: formatDateTR(iso),
            isoDate: iso,
            createdAt: new Date().toISOString(),
            recurringIncomeId: income.id
        });

        income.lastProcessedMonth = currentMonthStr;
        processedAny = true;

    });

    if (processedAny) {
        saveData();
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof renderSavingsPage === 'function') renderSavingsPage();
    }
}

/* --- RECURRING PAGE & CALENDAR LOGIC --- */

// Predefined Icons
const REC_ICONS = [
    { id: 'default', icon: 'fa-solid fa-bolt' },
    { id: 'spotify', icon: 'fa-brands fa-spotify' },
    { id: 'youtube', icon: 'fa-brands fa-youtube' },
    { id: 'netflix', icon: 'fa-solid fa-n' },
    { id: 'amazon', icon: 'fa-brands fa-amazon' },
    { id: 'apple', icon: 'fa-brands fa-apple' },
    { id: 'google', icon: 'fa-brands fa-google' },
    { id: 'cloud', icon: 'fa-solid fa-cloud' },
    { id: 'house', icon: 'fa-solid fa-house' },
    { id: 'gym', icon: 'fa-solid fa-dumbbell' },
    { id: 'internet', icon: 'fa-solid fa-wifi' },
    { id: 'phone', icon: 'fa-solid fa-mobile-screen' },
    { id: 'joker', icon: 'fa-solid fa-star-of-life' }, // Joker Icon
];

let selectedRecIcon = 'fa-solid fa-bolt';
let editingRecId = null; // Track if we are editing a plan

function renderRecIconSelector() {
    const container = document.getElementById('rec-icon-selector');
    if (!container) return;

    container.innerHTML = REC_ICONS.map(i => `
        <div class="icon-option ${i.icon === selectedRecIcon ? 'selected' : ''}" onclick="selectRecIcon('${i.icon}')">
            <i class="${i.icon}"></i>
        </div>
    `).join('');
}

window.selectRecIcon = function (icon) {
    selectedRecIcon = icon;
    renderRecIconSelector();
}

function addRecurringPlan() {
    const name = document.getElementById('rec-name').value.trim();
    const amount = toKurus(parseFloat(document.getElementById('rec-amount').value)); // Store in kuruş
    const day = parseInt(document.getElementById('rec-day').value);
    const method = document.getElementById('rec-method-select').value;
    const autoPay = document.getElementById('rec-autopay').checked;

    // Cashback Fields
    const cbType = document.getElementById('rec-cb-type').value;
    const cbValue = parseFloat(document.getElementById('rec-cb-value').value) || 0;
    const campEnd = document.getElementById('rec-camp-end').value;

    // Limit Validation for Credit Cards
    const matchedCard = state.cards.find(c => c.name.trim().toLowerCase() === method.trim().toLowerCase());
    if (matchedCard) {
        const allCardOps = state.expenses.filter(x => x.method === matchedCard.name);
        const totalSpends = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
        const totalPayments = allCardOps.filter(x => x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
        const currentDebt = Math.max(0, totalSpends - totalPayments);
        const remaining = matchedCard.limit - currentDebt;

        if (amount > remaining) {
            showToast('Limit Yetersiz', `Kart limitiniz (${formatMoney(remaining)}₺) bu harcama için yetersiz.`, 'error');
            return;
        }
    }

    if (name && amount > 0 && day >= 1 && day <= 31) {
        if (editingRecId) {
            // Update existing plan
            const planIndex = state.recurringPlans.findIndex(p => p.id === editingRecId);
            if (planIndex > -1) {
                const oldPlan = state.recurringPlans[planIndex];
                const updatedPlan = {
                    ...oldPlan,
                    name, amount, day, method, autoPay,
                    icon: selectedRecIcon,
                    cashbackType: cbType,
                    cashbackValue: cbValue,
                    campaignEndDate: campEnd || null
                };
                state.recurringPlans[planIndex] = updatedPlan;

                // Sync with existing generated expenses for the CURRENT MONTH
                const now = new Date();
                const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                if (updatedPlan.lastProcessedMonth === currentMonthStr) {
                    let finalAmount = updatedPlan.amount;
                    let isCampaignActive = true;
                    if (updatedPlan.campaignEndDate) {
                        if (now > new Date(updatedPlan.campaignEndDate)) isCampaignActive = false;
                    }
                    if (isCampaignActive) {
                        if (updatedPlan.cashbackType === 'percent') finalAmount -= (updatedPlan.amount * (updatedPlan.cashbackValue / 100));
                        else if (updatedPlan.cashbackType === 'fixed') finalAmount -= updatedPlan.cashbackValue;
                    }
                    finalAmount = Math.max(0, finalAmount);

                    const expIdx = state.expenses.findIndex(e => e.recurringPlanId === editingRecId && e.isoDate.startsWith(currentMonthStr));
                    if (expIdx > -1) {
                        const matchedCard = state.cards.find(c => namesMatch(c.name, updatedPlan.method));
                        // FIX: Update date logic when editing plan
                        const newIsoDate = `${currentMonthStr}-${String(updatedPlan.day).padStart(2, '0')}`;

                        state.expenses[expIdx] = {
                            ...state.expenses[expIdx],
                            merchant: updatedPlan.name,
                            amount: Number(finalAmount),
                            method: matchedCard ? matchedCard.name : updatedPlan.method,
                            isCredit: !!matchedCard,
                            isoDate: newIsoDate,           // DATE UPDATE
                            date: formatDateTR(newIsoDate) // DATE UPDATE
                        };
                    }
                }
                showToast('Güncellendi', 'Plan ve bu ayki ödeme güncellendi.');
            }
            editingRecId = null;
            document.getElementById('add-rec-btn').textContent = 'Ekle';
        } else {
            // Add new plan
            // FIX: If day passed, skip current month
            const now = new Date();
            let initialLastProcessed = null;
            if (day < now.getDate()) {
                initialLastProcessed = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            }

            state.recurringPlans.push({
                id: Date.now(),
                name, amount, day, method,
                autoPay,
                icon: selectedRecIcon,
                cashbackType: cbType,
                cashbackValue: cbValue,
                campaignEndDate: campEnd || null,
                active: true,
                lastProcessedMonth: initialLastProcessed
            });
            showToast('Eklendi', 'Düzenli ödeme planı oluşturuldu.');
        }

        saveData();
        renderRecurringList();

        // Refresh all views to ensure sync with Credit Portfolio
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof renderCreditPage === 'function') {
            renderCreditPage();
            if (typeof updateStatementView === 'function') updateStatementView();
        }
        if (typeof renderFullHistory === 'function') renderFullHistory();

        // Reset form
        document.getElementById('rec-name').value = '';
        document.getElementById('rec-amount').value = '';
        document.getElementById('rec-day').value = '';
        document.getElementById('rec-cb-value').value = '';
        const campInput = document.getElementById('rec-camp-end');
        if (campInput) campInput.value = '';

        // Reset Icon
        selectedRecIcon = 'fa-solid fa-bolt';
        renderRecIconSelector();

        checkRecurringTransactions();
    } else {
        showToast('Hata', 'Bilgileri kontrol ediniz.', 'error');
    }
}

function renderRecurringList() {
    const container = document.getElementById('recurring-list');
    if (!container) return;

    if (state.recurringPlans.length === 0) {
        container.innerHTML = '<div class="empty-state-container"><div class="empty-state-title">Kayıtlı düzenli gider yok</div></div>';
        return;
    }

    let html = '';
    const today = new Date();

    state.recurringPlans.forEach(plan => {
        // Validation for Campaign
        let warningClass = ''; // 'rec-warning-yellow' or 'rec-warning-red'
        let isCampaignActive = true;

        if (plan.campaignEndDate) {
            const endDate = new Date(plan.campaignEndDate);
            if (today > endDate) {
                isCampaignActive = false;
                warningClass = 'rec-warning-red'; // Expired
            } else {
                // Check if < 1 month left
                const diffTime = Math.abs(endDate - today);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (diffDays <= 30) warningClass = 'rec-warning-yellow';
            }
        }

        // Calculate Net Cost
        let netCost = plan.amount;
        let cashbackText = '';

        if (isCampaignActive && plan.cashbackType !== 'none' && plan.cashbackValue > 0) {
            let deduction = 0;
            if (plan.cashbackType === 'percent') {
                deduction = plan.amount * (plan.cashbackValue / 100);
                cashbackText = `%${plan.cashbackValue} İade`;
            } else if (plan.cashbackType === 'fixed') {
                deduction = plan.cashbackValue;
                cashbackText = `${plan.cashbackValue}₺ İade`;
            }
            netCost = Math.max(0, plan.amount - deduction); // Prevent negative cost
        }

        html += `
            <div class="recurring-card ${warningClass}" style="opacity:${plan.active ? 1 : 0.6}">
                <div class="rec-icon-box">
                    <i class="${plan.icon || 'fa-solid fa-bolt'}"></i>
                </div>
                <div class="rec-info-col">
                    <div class="rec-name">${plan.name}</div>
                    <div class="rec-sub">
                        <span>Her ayın ${plan.day}. günü</span> • <span>${plan.method}</span>
                        ${plan.autoPay ? '<i class="fa-solid fa-bolt" style="color:var(--warning);" title="Otomatik Ödeme"></i>' : ''}
                    </div>
                     ${plan.campaignEndDate ? `<div style="font-size:0.75rem; color:${warningClass.includes('red') ? 'var(--danger)' : 'var(--text-light)'}">Kampanya Bitiş: ${formatDateTR(plan.campaignEndDate)}</div>` : ''}
                </div>
                
                <div class="rec-cost-col">
                     ${cashbackText ? `<div class="rec-orig-cost">${formatMoney(plan.amount)}₺</div>` : ''}
                    <div class="rec-net-cost">${formatMoney(netCost)}₺</div>
                     ${cashbackText ? `<div class="rec-cashback-badge">${cashbackText}</div>` : ''}
                </div>

                <div style="display:flex; gap:10px; margin-left:15px;">
                    <button class="btn-icon" style="width:32px; height:32px;" onclick="editRecurringPlan(${plan.id})">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon" style="width:32px; height:32px;" onclick="toggleRecurringStatus(${plan.id})">
                        <i class="fa-solid ${plan.active ? 'fa-pause' : 'fa-play'}"></i>
                    </button>
                    <button class="btn-icon" style="width:32px; height:32px; color:var(--danger); border-color:var(--danger);" onclick="deleteRecurringPlan(${plan.id})">
                         <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

function editRecurringPlan(id) {
    const plan = state.recurringPlans.find(p => p.id === id);
    if (!plan) return;

    editingRecId = id;

    // Populate Form
    document.getElementById('rec-name').value = plan.name;
    document.getElementById('rec-amount').value = plan.amount;
    document.getElementById('rec-day').value = plan.day;
    document.getElementById('rec-method-select').value = plan.method;
    document.getElementById('rec-autopay').checked = plan.autoPay;

    document.getElementById('rec-cb-type').value = plan.cashbackType || 'none';
    document.getElementById('rec-cb-value').value = plan.cashbackValue || '';
    if (document.getElementById('rec-camp-end')) document.getElementById('rec-camp-end').value = plan.campaignEndDate || '';

    // Icon
    selectedRecIcon = plan.icon || 'fa-solid fa-bolt';
    renderRecIconSelector();

    // Change Button Text
    const btn = document.getElementById('add-rec-btn');
    if (btn) btn.textContent = 'Güncelle';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleRecurringStatus(id) {
    const plan = state.recurringPlans.find(p => p.id === id);
    if (plan) {
        const oldStatus = plan.active;
        plan.active = !plan.active;

        // SYNC: If plan is paused, remove current month's generated expense
        if (!plan.active) {
            const now = new Date();
            const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            state.expenses = state.expenses.filter(e => !(e.recurringPlanId === id && e.isoDate.startsWith(currentMonthStr)));
        }

        saveData();
        renderRecurringList();

        // SYNC: If plan is resumed, try to process it immediately if it's due
        if (plan.active && !oldStatus) {
            checkRecurringTransactions();
        } else {
            // Force refresh UI to reflect removed expense
            if (typeof updateDashboard === 'function') updateDashboard();
            if (typeof renderCreditPage === 'function') {
                renderCreditPage();
                if (typeof updateStatementView === 'function') updateStatementView();
            }
        }

        showToast('Güncellendi', `Plan ${plan.active ? 'aktif edildi' : 'durduruldu'}.`);
    }
}

function deleteRecurringPlan(id) {
    showModal('Sil', 'Bu planı silmek istiyor musun? (Bu aya ait oluşturulmuş harcama varsa o da silinecektir)', [
        { text: 'Vazgeç', class: 'btn-cancel' },
        {
            text: 'Evet, Sil', class: 'btn-delete', onClick: () => {
                // SYNC: Remove current month's generated expense
                const now = new Date();
                const currentMonthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
                state.expenses = state.expenses.filter(e => !(e.recurringPlanId === id && e.isoDate.startsWith(currentMonthStr)));

                state.recurringPlans = state.recurringPlans.filter(p => p.id !== id);
                saveData();
                renderRecurringList();

                // Force Update All Views
                if (typeof updateDashboard === 'function') updateDashboard();
                if (typeof renderCreditPage === 'function') {
                    renderCreditPage();
                    if (typeof updateStatementView === 'function') updateStatementView();
                }
            }
        }
    ]);
}

function renderCalendarPage() {
    const grid = document.getElementById('calendar-days');
    const periodDisplay = document.getElementById('cal-period-display');
    if (!grid || !periodDisplay) return;

    grid.innerHTML = '';

    const today = new Date();
    const date = new Date();
    date.setDate(1); // 1st of current month
    date.setMonth(today.getMonth() + state.periodOffset);

    periodDisplay.innerText = date.toLocaleString('tr-TR', { month: 'long', year: 'numeric' });

    const month = date.getMonth();
    const year = date.getFullYear();

    const totalDays = new Date(year, month + 1, 0).getDate();
    // Week starts Monday (1) to Sunday (0 in JS, 7 for us)
    let firstDayIndex = date.getDay();
    if (firstDayIndex === 0) firstDayIndex = 7; // Sunday is 7
    firstDayIndex -= 1; // 0-indexed for array (Mon=0)

    // Empty slots for previous month
    for (let i = 0; i < firstDayIndex; i++) {
        const div = document.createElement('div');
        div.style.visibility = 'hidden';
        grid.appendChild(div);
    }

    // Official Holidays Map for Calendar Display
    const holidayMap = getOfficialHolidays(year);

    // Days
    for (let i = 1; i <= totalDays; i++) {
        const currentDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dateObj = new Date(year, month, i);
        const dayOfWeek = dateObj.getDay(); // 0=Sun, 6=Sat
        const shortDate = String(i).padStart(2, '0') + "-" + String(month + 1).padStart(2, '0');

        // Check conditions
        const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6);
        const isHoliday = holidayMap[currentDateStr];
        const isToday = (today.getDate() === i && today.getMonth() === month && today.getFullYear() === year);

        // Find expenses
        const dayExpenses = state.expenses.filter(x => x.isoDate === currentDateStr);
        const dayTotal = dayExpenses.reduce((acc, curr) => acc + curr.amount, 0);

        // Find recurring
        const recurringDue = state.recurringPlans.filter(p => p.active && p.day === i);

        const dayEl = document.createElement('div');
        let classes = 'cal-day';
        if (isToday) classes += ' today';
        if (isWeekend) classes += ' weekend';
        if (isHoliday) classes += ' holiday';

        dayEl.className = classes;
        if (isToday) dayEl.style.borderColor = 'var(--primary)';

        let html = `<div class="cal-date-num ${isWeekend || isHoliday ? 'red-text' : ''}">${i}</div>`;

        if (isHoliday) {
            html += `<div class="holiday-name">${isHoliday}</div>`;
        }

        if (dayTotal > 0) {
            html += `<div class="cal-total ${dayTotal > 2000 ? 'high-spend' : ''}">${formatMoney(dayTotal)}₺</div>`;
        } else if (today > dateObj) {
            // Show checkmark for all past days with zero spending
            html += `<div class="no-spend-badge"><i class="fa-solid fa-check"></i></div>`;
        }

        if (recurringDue.length > 0) {
            html += `<div class="bill-icon" title="${recurringDue.length} Ödeme"><i class="fa-solid fa-receipt"></i></div>`;
        }

        dayEl.innerHTML = html;
        dayEl.onclick = () => {
            showDayDetails(currentDateStr, dayExpenses, recurringDue);
        };

        grid.appendChild(dayEl);
    }
}

function showDayDetails(dateStr, expenses, recurring) {
    const formattedDate = formatDateTR(dateStr);
    let content = '';

    if (recurring.length > 0) {
        content += `<h4 style="margin-bottom:10px; color:var(--text-light)">Planlı Ödemeler</h4>`;
        recurring.forEach(r => {
            content += `<div style="padding:10px; background:rgba(67,97,238,0.05); border-radius:8px; margin-bottom:5px; font-size:0.9rem;">
                <strong>${r.name}</strong> - ${formatMoney(r.amount)}₺
             </div>`;
        });
        content += `<hr style="margin:15px 0; border:0; border-top:1px solid var(--border)">`;
    }

    if (expenses.length > 0) {
        content += `<h4 style="margin-bottom:10px; color:var(--text-light)">Harcamalar</h4>`;
        expenses.forEach(x => {
            content += `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.9rem;">
                    <span>${x.merchant}</span>
                    <span style="font-weight:700;">${formatMoney(x.amount)}₺</span>
                </div>
            `;
        });
    } else {
        content += `<div style="text-align:center; padding:20px; color:var(--success);">
            <i class="fa-solid fa-star" style="font-size:2rem; margin-bottom:10px;"></i>
            <p>Tasarruf Günü! Harcama yok.</p>
        </div>`;
    }

    showModal(formattedDate, document.createRange().createContextualFragment(content));
}

function renderSavingsPage() {
    // --- EKLENEN KISIM: Cüzdan Bakiyesini Başlıkta Göster ---
    const walletBalance = state.balanceLogs.reduce((sum, log) => sum + Number(log.amount), 0);
    const greetingP = document.querySelector('.greeting p');
    if (greetingP) {
        greetingP.innerHTML = `Altın, döviz ve borsa takibi. <span style="color:var(--success); font-weight:bold; margin-left:15px; background:rgba(46,196,182,0.1); padding:4px 8px; border-radius:6px;">Cüzdan: ${formatMoney(walletBalance)} ₺</span>`;
    }
    // --------------------------------------------------------

    const portfolio = {};
    const historyList = [];

    const sortedTrans = state.assets.slice().sort((a, b) => a.isoDate.localeCompare(b.isoDate));

    sortedTrans.forEach(t => {
        if (!portfolio[t.type]) portfolio[t.type] = { qty: 0, totalCost: 0, avgCost: 0 };
        const amount = Number(t.amount);
        const price = Number(t.price);

        if (t.tradeType === 'buy') {
            portfolio[t.type].totalCost += (amount * price);
            portfolio[t.type].qty += amount;
        } else {
            if (portfolio[t.type].qty <= 0) {
                portfolio[t.type].qty = 0;
                portfolio[t.type].totalCost = 0;
            } else {
                const avg = portfolio[t.type].totalCost / portfolio[t.type].qty;
                portfolio[t.type].qty -= amount;
                portfolio[t.type].totalCost -= (amount * avg);
            }
        }
        if (portfolio[t.type].qty <= 0.00001) {
            portfolio[t.type].qty = 0;
            portfolio[t.type].totalCost = 0;
        }
        portfolio[t.type].avgCost = portfolio[t.type].qty > 0 ? portfolio[t.type].totalCost / portfolio[t.type].qty : 0;

        const iconClass = t.tradeType === 'buy' ? 'fa-arrow-down' : 'fa-arrow-up';
        const colorClass = t.tradeType === 'buy' ? 'var(--success)' : 'var(--danger)';

        historyList.unshift(`
            <div class="t-row" onclick="openAssetTransactionDetails(${t.id})">
                <div class="t-icon" style="background:${t.tradeType === 'buy' ? 'rgba(46,196,182,0.1)' : 'rgba(239,35,60,0.1)'}; color:${colorClass}">
                    <i class="fa-solid ${iconClass}"></i>
                </div>
                <div class="t-details">
                    <span class="t-merchant">${getAssetLabel(t.type)}</span>
                    <span class="t-meta">${t.date} • ${formatMoney(t.price)} TL'den</span>
                </div>
                <div class="t-amount" style="color:${colorClass}">
                    ${t.tradeType === 'buy' ? '+' : '-'}${t.amount} <small>${getAssetUnit(t.type)}</small>
                </div>
            </div>
        `);
    });

    document.getElementById('asset-history-list').innerHTML = historyList.join('') || '<div style="text-align:center; padding:20px; color:var(--text-light)">İşlem yok.</div>';

    let totalPortfolioValue = 0;
    let totalPortfolioCost = 0;
    const assetListHTML = [];

    Object.keys(portfolio).forEach(key => {
        const item = portfolio[key];
        if (item.qty > 0.0001) {
            // API returns prices in TL, convert to kuruş for calculation
            const rawMarketPrice = state.marketData[key] || 0;
            const currentPriceKurus = toKurus(rawMarketPrice); // TL → Kuruş
            const currentValue = item.qty * currentPriceKurus; // Now in kuruş
            const profit = currentValue - item.totalCost; // Both in kuruş
            const profitRate = item.totalCost > 0 ? (profit / item.totalCost) * 100 : 0;

            totalPortfolioValue += currentValue;
            totalPortfolioCost += item.totalCost;

            let styleClass = 'asset-bist';
            let icon = 'fa-chart-simple';
            if (key === 'gram-altin') { styleClass = 'asset-gold'; icon = 'fa-coins'; }
            else if (key === 'usd') { styleClass = 'asset-usd'; icon = 'fa-dollar-sign'; }
            else if (key === 'eur') { styleClass = 'asset-eur'; icon = 'fa-euro-sign'; }
            else if (key === 'btc') { styleClass = 'asset-btc'; icon = 'fa-bitcoin-sign'; }

            assetListHTML.push(`
                <div class="asset-item">
                    <div style="display:flex; align-items:center;">
                        <div class="asset-icon-box ${styleClass}">
                            <i class="fa-solid ${icon}"></i>
                        </div>
                        <div class="asset-info">
                            <h4>${getAssetLabel(key)}</h4>
                            <p>${Number(item.qty).toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${getAssetUnit(key)} x ${formatMoney(item.avgCost)} TL</p>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div class="asset-values">
                            <span class="asset-total">${formatMoney(currentValue)} ₺</span>
                            <span class="asset-pl" style="color:${profit >= 0 ? 'var(--success)' : 'var(--danger)'}">
                                ${profit >= 0 ? '+' : ''}${formatMoney(profit)} ₺ (%${profitRate.toFixed(1)})
                            </span>
                        </div>
                        <button class="btn-action-small" onclick="openSellAllModal('${key}', ${item.qty})" title="Hepsini Sat / Boz">
                            <i class="fa-solid fa-money-bill-transfer"></i>
                        </button>
                    </div>
                </div>
            `);
        }
    });

    document.getElementById('asset-list').innerHTML = assetListHTML.join('') || '<div style="text-align:center; padding:20px; color:var(--text-light)">Aktif varlık yok.</div>';

    document.getElementById('total-asset-val').textContent = formatMoney(totalPortfolioValue);
    document.getElementById('total-asset-cost').textContent = formatMoney(totalPortfolioCost);
    const totalProfit = totalPortfolioValue - totalPortfolioCost;
    const profitEl = document.getElementById('total-asset-profit');
    profitEl.textContent = formatMoney(totalProfit);
    profitEl.style.color = totalProfit >= 0 ? 'var(--success)' : 'var(--danger)';

    renderSavingsChart(sortedTrans);
}

function openAssetTransactionDetails(id) {
    const item = state.assets.find(x => x.id === id);
    if (!item) return;

    const html = `
        <div class="modal-input-group"><label>Miktar</label><input type="number" id="edit-asset-amount" value="${item.amount}"></div>
        <div class="modal-input-group"><label>Birim Fiyat (TL)</label><input type="number" id="edit-asset-price" value="${item.price}"></div>
        <div class="modal-input-group"><label>Tarih</label><input type="date" id="edit-asset-date" value="${item.isoDate}"></div>
        <div class="modal-input-group">
            <label>İşlem Türü</label>
            <select id="edit-asset-tradeType" style="width:100%; padding:12px; border:1px solid var(--border); border-radius:8px; background:rgba(125,125,125,0.05); color:var(--text-main); outline:none;">
                <option value="buy" ${item.tradeType === 'buy' ? 'selected' : ''}>Alış (Ekle)</option>
                <option value="sell" ${item.tradeType === 'sell' ? 'selected' : ''}>Satış (Çıkar)</option>
            </select>
        </div>
    `;

    showModal('İşlem Düzenle', document.createRange().createContextualFragment(html), [
        { text: 'Sil', class: 'btn-delete', onClick: () => deleteAssetTransaction(id) },
        { text: 'Güncelle', class: 'btn-confirm', onClick: () => saveAssetEdit(id, item) }
    ]);
}

function saveAssetEdit(id, originalItem) {
    const amount = roundToTwo(parseFloat(document.getElementById('edit-asset-amount').value)); // Asset qty stays float
    const price = toKurus(parseFloat(document.getElementById('edit-asset-price').value)); // Price in kuruş
    const dateVal = document.getElementById('edit-asset-date').value;
    const tradeType = document.getElementById('edit-asset-tradeType').value;

    if (amount > 0 && price > 0 && dateVal) {

        // --- EKLENEN KISIM: Bakiye Farkını Hesapla ---
        const oldTotal = originalItem.amount * originalItem.price;
        const oldImpact = originalItem.tradeType === 'buy' ? -oldTotal : oldTotal;

        const newTotal = amount * price;
        const newImpact = tradeType === 'buy' ? -newTotal : newTotal;

        const diff = newImpact - oldImpact;

        if (Math.abs(diff) > 0.01) {
            state.balanceLogs.push({
                id: Date.now(),
                title: `Düzenleme: ${getAssetLabel(originalItem.type)} (${originalItem.id})`,
                amount: diff,
                date: formatDateTR(dateVal),
                createdAt: new Date().toISOString()
            });
        }
        // ------------------------------------------------

        originalItem.amount = amount;
        originalItem.price = price;
        originalItem.isoDate = dateVal;
        originalItem.date = formatDateTR(dateVal);
        originalItem.tradeType = tradeType;

        saveData();
        renderSavingsPage();
        showToast('Başarılı', 'İşlem ve cüzdan bakiyesi güncellendi.');
        closeModal();
    } else {
        showToast('Hata', 'Geçersiz değerler.', 'error');
        return false;
    }
}

function deleteAssetTransaction(id) {
    const item = state.assets.find(x => x.id === id); // Silmeden önce öğeyi buluyoruz
    if (!item) return;

    closeModal();
    setTimeout(() => {
        showModal('Silme Onayı', 'Bu varlık işlemini silmek ve cüzdan bakiyesini düzeltmek istiyor musun?', [
            { text: 'Vazgeç', class: 'btn-cancel' },
            {
                text: 'Evet, Sil',
                class: 'btn-delete',
                onClick: () => {
                    // --- EKLENEN KISIM BAŞLANGIÇ (İade/Düzeltme) ---
                    const totalVal = item.amount * item.price;

                    if (item.tradeType === 'buy') {
                        // "Alış" işlemini siliyorsak, harcanan parayı cüzdana GERİ EKLE (+)
                        state.balanceLogs.push({
                            id: Date.now(),
                            title: `İptal: ${getAssetLabel(item.type)} Alışı`,
                            amount: totalVal,
                            date: getLocalDateISO(),
                            createdAt: new Date().toISOString()
                        });
                    } else {
                        // "Satış" işlemini siliyorsak, cüzdana giren parayı GERİ AL (-)
                        state.balanceLogs.push({
                            id: Date.now(),
                            title: `İptal: ${getAssetLabel(item.type)} Satışı`,
                            amount: -totalVal,
                            date: getLocalDateISO(),
                            createdAt: new Date().toISOString()
                        });
                    }
                    // --- EKLENEN KISIM BİTİŞ ---

                    state.assets = state.assets.filter(x => x.id !== id);
                    saveData();
                    renderSavingsPage();
                    showToast('Silindi', 'Kayıt silindi ve bakiye düzeltildi.', 'info');
                    closeModal();
                }
            }
        ]);
    }, 200);
}

function openSellAllModal(type, qty) {
    const currentPrice = state.marketData[type] || 0;
    const estTotal = qty * currentPrice;
    const label = getAssetLabel(type);

    const html = `
        <div style="margin-bottom:15px; font-size:0.9rem; color:var(--text-light);">
            Toplam <strong>${qty} ${getAssetUnit(type)}</strong> varlığınızın tamamı satılacak.
        </div>
        <div class="modal-input-group">
            <label>Satış Fiyatı (Birim)</label>
            <input type="number" id="sell-all-price" value="${currentPrice}">
        </div>
        <div class="modal-input-group">
            <label>İşlem Tarihi</label>
            <input type="date" id="sell-all-date" value="${getLocalDateISO()}">
        </div>
    `;

    showModal(`${label} - Tümü Sat`, document.createRange().createContextualFragment(html), [
        { text: 'Vazgeç', class: 'btn-cancel' },
        {
            text: 'Satışı Onayla', class: 'btn-confirm', onClick: () => {
                const finalPrice = parseFloat(document.getElementById('sell-all-price').value);
                const finalDate = document.getElementById('sell-all-date').value;

                if (finalPrice > 0 && finalDate) {
                    state.assets.push({
                        id: Date.now(),
                        type: type,
                        amount: qty,
                        price: finalPrice,
                        date: formatDateTR(finalDate),
                        isoDate: finalDate,
                        tradeType: 'sell'
                    });

                    // --- EKLENEN KISIM: Cüzdan Bakiyesi Güncelleme ---
                    const totalVal = qty * finalPrice;
                    state.balanceLogs.push({
                        id: Date.now() + 1,
                        title: `Varlık Satışı (Tümü): ${getAssetLabel(type)}`,
                        amount: totalVal,
                        date: formatDateTR(finalDate), // isoDate formatında kaydedilip görüntülenirken formatlanmalı aslında, ama yapıya uyuyoruz
                        createdAt: new Date().toISOString()
                    });
                    // ------------------------------------------------
                    saveData();
                    renderSavingsPage();
                    showToast('İşlem Başarılı', 'Varlıklarınız nakite çevrildi.');
                    closeModal();
                } else {
                    showToast('Hata', 'Fiyat ve tarih giriniz.', 'error');
                    return false;
                }
            }
        }
    ]);
}

function renderSavingsChart(transactions) {
    const ctx = document.getElementById('savingsChart');
    if (!ctx) return;

    let labels = [];
    let dataPoints = [];
    let runningCost = 0;

    transactions.forEach(t => {
        if (t.tradeType === 'buy') runningCost += (t.amount * t.price);
        else runningCost -= (t.amount * t.price);

        labels.push(t.date);
        dataPoints.push(Math.max(0, runningCost));
    });

    if (state.chart) state.chart.destroy();

    state.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Yatırım Maliyeti (Kümülatif)',
                data: dataPoints,
                borderColor: '#4361ee',
                backgroundColor: 'rgba(67, 97, 238, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function (context) {
                            return 'Yatırım: ' + formatMoney(context.raw) + ' ₺';
                        }
                    }
                }
            },
            scales: {
                x: { display: false },
                y: {
                    display: true,
                    grid: { color: state.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' }
                }
            }
        }
    });
}

function getAssetLabel(key) {
    const map = { 'gram-altin': 'Gram Altın', 'usd': 'Dolar', 'eur': 'Euro', 'btc': 'Bitcoin' };
    return map[key] || key;
}
function getAssetUnit(key) {
    if (key === 'gram-altin') return 'Gr';
    return 'Adet';
}
init();
/* --- NEW FEATURES --- */

function togglePrivacyMode() {
    state.isPrivacyMode = !state.isPrivacyMode;
    localStorage.setItem('privacy_mode', state.isPrivacyMode);

    if (state.isPrivacyMode) {
        document.body.classList.add('privacy-active');
    } else {
        document.body.classList.remove('privacy-active');
    }

    // Add animation to all eye icons
    document.querySelectorAll('.fa-eye, .fa-eye-slash').forEach(icon => {
        icon.classList.add('privacy-anim');
        setTimeout(() => {
            icon.classList.remove('privacy-anim');
            // Toggle icon class if needed for visual feedback
            if (state.isPrivacyMode) {
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        }, 200);
    });
}

function exportToExcel() {
    const headers = ['Tarih', 'Yer', 'Tutar', 'Yöntem', 'Kategori', 'Tür'];
    const rows = state.expenses.map(x => [
        x.date,
        `"${x.merchant.replace(/"/g, '""')}"`,
        x.amount.toString().replace('.', ','),
        x.method,
        x.category,
        x.isCredit ? 'Kredi Kartı' : 'Nakit/Banka'
    ]);

    const csvContent = [
        headers.join(';'),
        ...rows.map(r => r.join(';'))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `harcamalar_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('Başarılı', 'Excel raporu indirildi.');
}

/* exportToPDF Removed */

/* Patch: Check Recurring Transactions Fix */
/* HATA 1 FIX: Added backfill logic to process missed months */
function checkRecurringTransactions() {
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth(); // 0-indexed
    let changeMade = false;

    state.recurringPlans.forEach(plan => {
        if (!plan.active) return;
        if (!plan.autoPay) return; // Only process autopay plans

        // Determine start point for backfill
        let startYear, startMonth;

        if (plan.lastProcessedMonth) {
            // Parse last processed month (stored as "YYYY-MM")
            const [ly, lm] = plan.lastProcessedMonth.split('-').map(Number);
            startYear = ly;
            startMonth = lm - 1; // Convert to 0-indexed
        } else if (plan.createdAt) {
            // Start from plan creation date
            const created = new Date(plan.createdAt);
            startYear = created.getFullYear();
            startMonth = created.getMonth();
        } else {
            // Fallback: start from current month (no backfill)
            startYear = currentYear;
            startMonth = currentMonth - 1; // Will be incremented to current month
        }

        // HATA 1 FIX: Loop through each month from last processed to current
        let y = startYear;
        let m = startMonth;

        while (true) {
            // Move to next month
            m++;
            if (m > 11) { m = 0; y++; }

            // Stop if we've passed current month
            if (y > currentYear || (y === currentYear && m > currentMonth)) break;

            // For current month, check if the day has passed
            if (y === currentYear && m === currentMonth) {
                const daysInMonth = new Date(y, m + 1, 0).getDate();
                const effectiveDay = Math.min(plan.day, daysInMonth);
                if (today.getDate() < effectiveDay) break; // Day hasn't come yet
            }

            const monthStr = `${y}-${String(m + 1).padStart(2, '0')}`;

            // Check if plan was active during this month (campaign check)
            let isCampaignActive = true;
            if (plan.campaignEndDate) {
                const endDate = new Date(plan.campaignEndDate);
                const checkDate = new Date(y, m, plan.day);
                if (checkDate > endDate) isCampaignActive = false;
            }

            // Calculate final amount with cashback
            let finalAmount = plan.amount;
            if (isCampaignActive) {
                if (plan.cashbackType === 'percent') {
                    finalAmount -= (plan.amount * (plan.cashbackValue / 100));
                } else if (plan.cashbackType === 'fixed') {
                    finalAmount -= plan.cashbackValue;
                }
                finalAmount = Math.max(0, finalAmount);
            }

            // Create expense for this month
            const daysInTargetMonth = new Date(y, m + 1, 0).getDate();
            const effectiveDay = Math.min(plan.day, daysInTargetMonth);
            const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(effectiveDay).padStart(2, '0')}`;

            // LIMIT CHECK LOGIC
            let canProcess = true;
            const matchedCard = state.cards.find(c => namesMatch(c.name, plan.method));
            if (matchedCard) {
                const allCardOps = state.expenses.filter(x => x.method === matchedCard.name);
                const totalSpends = allCardOps.filter(x => !x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
                const totalPayments = allCardOps.filter(x => x.isPayment).reduce((acc, curr) => acc + curr.amount, 0);
                const currentDebt = Math.max(0, totalSpends - totalPayments);
                const remaining = matchedCard.limit - currentDebt;

                if (finalAmount > remaining) {
                    console.warn(`Otomatik Ödeme Atlandı (Yetersiz Limit): ${plan.name}`);
                    canProcess = false;
                }
            }

            if (canProcess) {
                state.expenses.push({
                    id: generateUniqueId(),
                    merchant: plan.name,
                    amount: finalAmount,
                    method: plan.method,
                    category: 'Abonelik',
                    isoDate: iso,
                    date: formatDateTR(iso),
                    isCredit: !!matchedCard,
                    isRecurring: true,
                    recurringPlanId: plan.id,
                    recurrenceFrequency: 'monthly'
                });

                // Auto-deduct from Wallet if NOT credit
                if (!matchedCard) {
                    state.balanceLogs.push({
                        id: Date.now() + Math.random(),
                        title: `Otomatik Ödeme: ${plan.name}`,
                        amount: -finalAmount,
                        date: formatDateTR(iso),
                        createdAt: new Date().toISOString()
                    });
                }


                // Update last processed month
                plan.lastProcessedMonth = monthStr;
                changeMade = true;
            }
            changeMade = true;

            // Show toast only for current month
            if (y === currentYear && m === currentMonth) {
                showToast('Otomatik Ödeme', `${plan.name} ödendi (${formatMoney(finalAmount)}₺)`);
            }
        }
    });

    if (changeMade) {
        saveData();
        // Force Update All Views
        if (typeof updateDashboard === 'function') updateDashboard();
        if (typeof renderCreditPage === 'function') {
            renderCreditPage();
            if (typeof updateStatementView === 'function') updateStatementView();
        }
        if (typeof renderFullHistory === 'function') renderFullHistory();
        if (typeof renderRecurringList === 'function') renderRecurringList();
    }
}

// --- WALLET / BALANCE WIDGET LOGIC ---
function renderWalletWidget() {
    const totalEl = document.getElementById('wallet-total');
    if (!totalEl) return;

    // Calculate Total Safe
    const totalBalance = state.balanceLogs.reduce((sum, log) => sum + Number(log.amount), 0);
    totalEl.textContent = formatMoney(totalBalance);
}

// toggleWalletPrivacy removed


function openWalletDetails() {
    const totalBalance = state.balanceLogs.reduce((sum, log) => sum + Number(log.amount), 0);
    const sortedLogs = state.balanceLogs.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Blur style for privacy mode
    const blurStyle = state.isPrivacyMode ? 'filter:blur(8px); opacity:0.6;' : '';

    // Recurring income list (V2)
    const recurringHtml = state.recurringIncome.map(inc => `
        <div class="wm-item positive">
            <div class="wm-item-left">
                <span class="wm-item-desc">${inc.name}</span>
                <span class="wm-item-date">Her ay ${inc.day}. gün</span>
            </div>
            <div class="wm-item-right" style="display:flex; align-items:center; gap:10px;">
                <span class="wm-item-amount pos" style="${blurStyle}">+${formatMoney(inc.amount)}₺</span>
                <button onclick="deleteRecurringIncome(${inc.id})" style="background:none; border:none; color:var(--text-light); cursor:pointer;"><i class="fa-solid fa-trash-can"></i></button>
            </div>
        </div>
    `).join('') || '<div class="empty-state" style="padding:20px; text-align:center; color:var(--text-light);"><i class="fa-solid fa-calendar-plus" style="font-size:1.5rem; margin-bottom:5px;"></i><p>Düzenli gelir yok</p></div>';

    // Transaction history (V2)
    const logListHTML = sortedLogs.slice(0, 8).map(log => `
        <div class="wm-item ${Number(log.amount) >= 0 ? 'positive' : 'negative'}" data-log-id="${log.id}">
             <div class="w-log-checkbox-area" style="display:none; margin-right:10px;">
                <input type="checkbox" class="log-checkbox" data-id="${log.id}">
            </div>
            <div class="wm-item-left">
                <span class="wm-item-desc">${log.title}</span>
                <span class="wm-item-date">${formatDateTR(log.date)}</span>
            </div>
            <span class="wm-item-amount ${Number(log.amount) >= 0 ? 'pos' : 'neg'}" style="${blurStyle}">
                ${Number(log.amount) >= 0 ? '+' : ''}${formatMoney(Number(log.amount))}₺
            </span>
        </div>
    `).join('') || '<div class="empty-state" style="padding:20px; text-align:center; color:var(--text-light);"><i class="fa-solid fa-clock-rotate-left" style="font-size:1.5rem; margin-bottom:5px;"></i><p>Henüz işlem yok</p></div>';

    const content = `
        <div class="wallet-modal-v2">
            <!-- Header -->
            <div class="wm-header">
                <h2><i class="fa-solid fa-wallet" style="color:var(--primary);"></i> Cüzdanım</h2>
                <button class="wm-close-btn" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>

            <!-- Hero Grid -->
            <div class="wm-hero-grid">
                <!-- Balance Card -->
                <div class="wm-balance-card">
                    <span class="wm-balance-label">Şu Anki Bakiye</span>
                    <span class="wm-balance-amount" style="${blurStyle}">${formatMoney(totalBalance)} ₺</span>
                </div>

                <!-- Quick Add Block -->
                <div class="wm-quick-add-block">
                    <span class="wm-label"><i class="fa-solid fa-plus-circle"></i> Cüzdanına Gelir Ekle</span>
                    <div class="wm-input-group">
                        <input type="number" id="w-amount" class="wm-input amount" placeholder="Tutar" min="0">
                        <input type="text" id="w-desc" class="wm-input flex" placeholder="Açıklama">
                        <input type="date" id="w-date" class="wm-input date" value="${getLocalDateISO()}">
                        <button class="wm-add-btn" onclick="addBalanceLog()"><i class="fa-solid fa-check"></i></button>
                    </div>
                </div>
            </div>

            <!-- Content Grid -->
            <div class="wm-content-grid">
                <!-- Left: History -->
                <div class="wm-section history-section">
                    <div class="wm-section-header">
                        <span class="wm-section-title"><i class="fa-solid fa-clock-rotate-left"></i> Son İşlemler (${sortedLogs.length})</span>
                        <div style="display:flex; gap:5px;">
                            <button onclick="toggleLogEditMode()" class="wm-close-btn" style="width:30px; height:30px; font-size:0.8rem;"><i class="fa-solid fa-pen"></i></button>
                             <div id="delete-selected-bar" style="display:none;">
                                <button onclick="deleteSelectedLogs()" style="background:var(--danger); color:white; border:none; padding:5px 10px; border-radius:6px; cursor:pointer; font-size:0.8rem;">Sil</button>
                            </div>
                        </div>
                    </div>
                    <div class="wm-list">${logListHTML}</div>
                </div>

                <!-- Right: Recurring -->
                <div class="wm-section recurring-section">
                    <div class="wm-section-header">
                        <span class="wm-section-title"><i class="fa-solid fa-repeat"></i> Düzenli Gelirler (${state.recurringIncome.length})</span>
                    </div>
                    <div class="wm-list">${recurringHtml}</div>
                    
                    <div class="wm-recurring-form">
                        <input type="text" id="w-inc-name" placeholder="Gelir adı" style="flex:2;">
                        <input type="number" id="w-inc-amount" placeholder="₺" style="width:80px;">
                        <input type="number" id="w-inc-day" placeholder="Gün" min="1" max="31" style="width:60px;">
                        <button onclick="saveRecurringIncomeFromModal()"><i class="fa-solid fa-plus"></i></button>
                    </div>
                </div>
            </div>
        </div>
    `;

    showModal('', document.createRange().createContextualFragment(content), [], 'wide-modal no-footer no-header');

    // Initialize Flatpickr for Modern Date Picker
    if (window.flatpickr) {
        flatpickr("#w-date", {
            locale: "tr",
            dateFormat: "Y-m-d",
            altInput: true,
            altFormat: "d F Y",
            defaultDate: getLocalDateISO(),
            disableMobile: true,
            theme: "dark" // Our CSS overrides will handle the rest
        });
    }
}

window.currentWalletType = 'income';
window.setWalletType = function (type) {
    window.currentWalletType = type;
    // Toggle active class on the Gelir/Gider buttons
    const incomeBtn = document.getElementById('w-type-income');
    const expenseBtn = document.getElementById('w-type-expense');
    if (incomeBtn) incomeBtn.classList.toggle('active', type === 'income');
    if (expenseBtn) expenseBtn.classList.toggle('active', type === 'expense');

    // Update add button color
    const addBtn = document.querySelector('.w-add-btn');
    if (addBtn) {
        if (type === 'income') {
            addBtn.style.background = 'linear-gradient(135deg, #11998e, #38ef7d)';
        } else {
            addBtn.style.background = 'linear-gradient(135deg, #e63946, #ff6b6b)';
        }
    }
}

function addBalanceLog() {
    const amountVal = document.getElementById('w-amount').value;
    const title = document.getElementById('w-desc').value.trim();
    const date = document.getElementById('w-date').value;

    if (!amountVal || !title || !date) {
        showToast('Eksik', 'Lütfen tutar ve açıklama giriniz.', 'error');
        return;
    }

    let amountKurus = toKurus(Math.abs(Number(amountVal))); // Convert to kuruş
    if (window.currentWalletType === 'expense') {
        amountKurus = -amountKurus;
    }

    state.balanceLogs.push({
        id: Date.now(),
        title,
        amount: amountKurus, // Now in kuruş
        date,
        createdAt: new Date().toISOString()
    });

    saveData();
    renderWalletWidget();
    closeModal();
    // Re-open detailed modal to see update
    setTimeout(openWalletDetails, 100);
    showToast('Kaydedildi', 'Bakiye güncellendi.');
}

function deleteBalanceLog(id) {
    closeModal(); // Close detail modal temporarily
    setTimeout(() => {
        showModal('Silme Onayı', 'Bu işlemi silmek istediğine emin misin?', [
            {
                text: 'Vazgeç',
                class: 'btn-cancel',
                onClick: () => {
                    setTimeout(openWalletDetails, 100); // Re-open details if cancelled
                }
            },
            {
                text: 'Evet, Sil',
                class: 'btn-delete',
                onClick: () => {
                    state.balanceLogs = state.balanceLogs.filter(l => l.id !== id);
                    saveData();
                    renderWalletWidget();
                    closeModal();
                    setTimeout(openWalletDetails, 100); // Re-open details to show updated list
                    showToast('Silindi', 'Kayıt silindi.', 'info');
                }
            }
        ]);
    }, 200);
}

// Toggle edit mode for multi-delete
window.toggleLogEditMode = function () {
    const checkboxAreas = document.querySelectorAll('.w-log-checkbox-area');
    const deleteBar = document.getElementById('delete-selected-bar');
    const editBtn = document.getElementById('edit-logs-btn');

    const isEditMode = checkboxAreas[0]?.style.display !== 'none';

    checkboxAreas.forEach(area => {
        area.style.display = isEditMode ? 'none' : 'flex';
    });

    if (deleteBar) {
        deleteBar.style.display = isEditMode ? 'none' : 'block';
    }

    if (editBtn) {
        editBtn.innerHTML = isEditMode ? '<i class="fa-solid fa-pen"></i>' : '<i class="fa-solid fa-xmark"></i>';
        editBtn.style.color = isEditMode ? '' : 'var(--danger)';
    }
};

// Delete selected logs
window.deleteSelectedLogs = function () {
    const checked = document.querySelectorAll('.log-checkbox:checked');
    if (checked.length === 0) {
        showToast('Uyarı', 'Silinecek kayıt seçilmedi.', 'error');
        return;
    }

    closeModal();
    setTimeout(() => {
        showModal('Toplu Silme', `${checked.length} kayıt silinecek. Emin misin?`, [
            { text: 'Vazgeç', class: 'btn-cancel', onClick: () => setTimeout(openWalletDetails, 100) },
            {
                text: 'Evet, Sil',
                class: 'btn-delete',
                onClick: () => {
                    const idsToDelete = Array.from(checked).map(cb => Number(cb.dataset.id));
                    state.balanceLogs = state.balanceLogs.filter(l => !idsToDelete.includes(l.id));
                    saveData();
                    renderWalletWidget();
                    closeModal();
                    setTimeout(openWalletDetails, 100);
                    showToast('Silindi', `${idsToDelete.length} kayıt silindi.`, 'info');
                }
            }
        ]);
    }, 200);
};

// Show add recurring income form
window.showAddRecurringIncomeForm = function () {
    const form = document.getElementById('add-recurring-form');
    if (form) {
        form.style.display = form.style.display === 'none' ? 'block' : 'none';
    }
};

// Save recurring income from modal
window.saveRecurringIncomeFromModal = function () {
    const name = document.getElementById('w-inc-name')?.value.trim();
    const amount = toKurus(parseFloat(document.getElementById('w-inc-amount')?.value)); // Store in kuruş
    const day = parseInt(document.getElementById('w-inc-day')?.value);

    if (!name || !amount || amount <= 0 || !day || day < 1 || day > 31) {
        showToast('Hata', 'Tüm alanları doğru doldurun.', 'error');
        return;
    }

    state.recurringIncome.push({
        id: Date.now(),
        name: name,
        amount: amount, // Now in kuruş
        day: day,
        active: true,
        lastProcessedMonth: null
    });

    saveData();
    closeModal();
    setTimeout(openWalletDetails, 100);
    showToast('Kaydedildi', `${name} düzenli gelir olarak eklendi.`);
};
