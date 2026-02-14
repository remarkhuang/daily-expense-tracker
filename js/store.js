// ============================================
// store.js — LocalStorage 資料 CRUD
// ============================================

const ENTRIES_KEY = 'expense_tracker_entries';
const DELETED_IDS_KEY = 'expense_tracker_deleted_ids';

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 9);
}

export function getAllEntries() {
    const raw = localStorage.getItem(ENTRIES_KEY);
    return raw ? JSON.parse(raw) : [];
}

function saveEntries(entries) {
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
}

export function addEntry(entry) {
    const entries = getAllEntries();
    const newEntry = {
        id: generateId(),
        date: entry.date,
        type: entry.type, // 'expense' | 'income'
        category: entry.category,
        amount: Number(entry.amount),
        note: entry.note || '',
        createdAt: new Date().toISOString(),
        synced: false,
    };
    entries.push(newEntry);
    saveEntries(entries);
    return newEntry;
}

export function updateEntry(id, updates) {
    const entries = getAllEntries();
    const idx = entries.findIndex(e => e.id === id);
    if (idx === -1) return null;
    entries[idx] = { ...entries[idx], ...updates, synced: false };
    saveEntries(entries);
    return entries[idx];
}

export function deleteEntry(id) {
    const entries = getAllEntries();
    const entryToDelete = entries.find(e => e.id === id);
    if (!entryToDelete) return;

    // 如果是已經同步過的資料，記錄其 ID 以便後續在雲端刪除
    if (entryToDelete.synced) {
        addDeletedId(id);
    }

    const filtered = entries.filter(e => e.id !== id);
    saveEntries(filtered);
}

function addDeletedId(id) {
    const ids = getPendingDeletions();
    if (!ids.includes(id)) {
        ids.push(id);
        localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(ids));
    }
}

export function getPendingDeletions() {
    const raw = localStorage.getItem(DELETED_IDS_KEY);
    return raw ? JSON.parse(raw) : [];
}

export function clearPendingDeletions(idsToRemove = []) {
    if (idsToRemove.length === 0) {
        localStorage.removeItem(DELETED_IDS_KEY);
    } else {
        const current = getPendingDeletions();
        const filtered = current.filter(id => !idsToRemove.includes(id));
        if (filtered.length === 0) {
            localStorage.removeItem(DELETED_IDS_KEY);
        } else {
            localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(filtered));
        }
    }
}

export function getEntriesByMonth(year, month) {
    const entries = getAllEntries();
    return entries.filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === year && d.getMonth() === month;
    });
}

export function getEntriesFiltered({ year, month, type } = {}) {
    let entries = getAllEntries();
    if (year !== undefined && month !== undefined) {
        entries = entries.filter(e => {
            const d = new Date(e.date);
            return d.getFullYear() === year && d.getMonth() === month;
        });
    }
    if (type && type !== 'all') {
        entries = entries.filter(e => e.type === type);
    }
    // 按日期降序排列
    entries.sort((a, b) => new Date(b.date) - new Date(a.date) || new Date(b.createdAt) - new Date(a.createdAt));
    return entries;
}

export function getUnsyncedEntries() {
    return getAllEntries().filter(e => !e.synced);
}

export function markAsSynced(ids) {
    const entries = getAllEntries();
    ids.forEach(id => {
        const entry = entries.find(e => e.id === id);
        if (entry) entry.synced = true;
    });
    saveEntries(entries);
}

export function mergeEntries(remoteEntries) {
    const local = getAllEntries();
    const localIds = new Set(local.map(e => e.id));
    let added = 0;
    remoteEntries.forEach(re => {
        if (!localIds.has(re.id)) {
            local.push({ ...re, synced: true });
            added++;
        }
    });
    if (added > 0) {
        saveEntries(local);
    }
    return added;
}

export function getMonthSummary(year, month) {
    const entries = getEntriesByMonth(year, month);
    let income = 0, expense = 0;
    entries.forEach(e => {
        if (e.type === 'income') income += e.amount;
        else expense += e.amount;
    });
    return { income, expense, balance: income - expense };
}

// Budget
const BUDGET_KEY = 'expense_tracker_budget';

export function getBudget() {
    return Number(localStorage.getItem(BUDGET_KEY)) || 0;
}

export function setBudget(amount) {
    localStorage.setItem(BUDGET_KEY, String(amount));
}
