// ============================================
// list.js — 帳目列表、篩選、刪除、編輯
// ============================================

import { getEntriesFiltered, deleteEntry, updateEntry } from './store.js';
import { getCategoryIcon, getCategoriesByType } from './categories.js';
import { isLoggedIn } from './auth.js';
import { syncSingleEntry, syncToSheet } from './sync.js';

let currentFilterMonth = null;
let currentFilterType = 'all';

export function initList() {
    const filterMonth = document.getElementById('filter-month');
    const filterType = document.getElementById('filter-type');

    // 預設本月
    const now = new Date();
    filterMonth.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    currentFilterMonth = filterMonth.value;

    filterMonth.addEventListener('change', () => {
        currentFilterMonth = filterMonth.value;
        renderList();
    });

    filterType.addEventListener('change', () => {
        currentFilterType = filterType.value;
        renderList();
    });

    // 編輯 Modal
    const editForm = document.getElementById('edit-form');
    const editCancel = document.getElementById('edit-cancel');

    editForm.addEventListener('submit', handleEditSubmit);
    editCancel.addEventListener('click', closeEditModal);

    // 確認刪除 Modal
    const confirmYesBtn = document.getElementById('confirm-yes');
    const confirmNoBtn = document.getElementById('confirm-no');

    confirmNoBtn.addEventListener('click', closeConfirmModal);
    confirmYesBtn.addEventListener('click', () => {
        console.log('[List] 使用者點擊確認刪除 (Modal Yes)');
        if (pendingConfirmCallback) {
            pendingConfirmCallback();
        }
        closeConfirmModal();
    });

    // 監聽資料變更
    window.addEventListener('entries-changed', renderList);

    // 使用 Event Delegation 處理列表點擊事件 (刪除/編輯)
    const listContainer = document.getElementById('entries-list');
    listContainer.addEventListener('click', (e) => {
        // 刪除按鈕
        const delBtn = e.target.closest('.btn-delete');
        if (delBtn) {
            e.stopPropagation();
            const idToDelete = delBtn.dataset.id;
            console.log(`[List] 偵測到刪除點擊 (Delegation)，ID: ${idToDelete}`);

            showConfirmModal('確定要刪除這筆帳目嗎？', () => {
                console.log(`[List] 執行刪除 callback, ID: ${idToDelete}`);
                deleteEntry(idToDelete);
                window.dispatchEvent(new CustomEvent('entries-changed'));
                window.showToast('已刪除', 'info');

                // 如果已登入，嘗試同步刪除到雲端
                if (isLoggedIn()) {
                    syncToSheet().then(() => {
                        console.log('[List] 雲端刪除同步完成');
                    }).catch(err => {
                        console.error('[List] 雲端刪除同步失敗:', err);
                        window.showToast('雲端同步失敗，下次同步時將重試', 'warning');
                    });
                }
            });
            return;
        }

        // 編輯按鈕
        const editBtn = e.target.closest('.btn-edit');
        if (editBtn) {
            e.stopPropagation();
            const idToEdit = editBtn.dataset.id;
            console.log(`[List] 偵測到編輯點擊 (Delegation)，ID: ${idToEdit}`);
            openEditModal(idToEdit);
        }
    });

    renderList();
}

export function renderList() {
    const container = document.getElementById('entries-list');
    const summaryDiv = document.getElementById('entries-summary');

    console.log('[List] renderList 被呼叫');

    let filters = { type: currentFilterType };
    if (currentFilterMonth) {
        const [y, m] = currentFilterMonth.split('-').map(Number);
        filters.year = y;
        filters.month = m - 1;
    }

    const entries = getEntriesFiltered(filters);
    console.log(`[List] 渲染列表，共 ${entries.length} 筆資料`);

    if (entries.length === 0) {
        container.innerHTML = '<div class="no-data">尚無帳目</div>';
        summaryDiv.innerHTML = '';
        return;
    }

    // 計算總計
    let totalIncome = 0;
    let totalExpense = 0;
    entries.forEach(e => {
        if (e.type === 'income') totalIncome += e.amount;
        else totalExpense += e.amount;
    });

    summaryDiv.innerHTML = `
    <div class="summary-card expense">
      <div class="label">總支出</div>
      <div class="amount">$${totalExpense.toLocaleString()}</div>
    </div>
    <div class="summary-card income">
      <div class="label">總收入</div>
      <div class="amount">$${totalIncome.toLocaleString()}</div>
    </div>
    <div class="summary-card balance">
      <div class="label">結餘</div>
      <div class="amount" style="color: ${totalIncome - totalExpense >= 0 ? '#4caf50' : '#ff5252'}">
        $${(totalIncome - totalExpense).toLocaleString()}
      </div>
    </div>
  `;

    let html = '';
    let currentDate = '';
    let dayTotal = 0;
    let items = [];

    // 分組邏輯
    entries.forEach((entry, index) => {
        if (entry.date !== currentDate) {
            // 輸出上一組
            if (items.length > 0) {
                const d = new Date(currentDate);
                const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
                const dateLabel = `${d.getMonth() + 1}/${d.getDate()} 星期${weekdays[d.getDay()]}`;
                html += `<div class="date-separator">${dateLabel} <span style="float:right">${dayTotal >= 0 ? '+' : ''}$${dayTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>`;
                items.forEach(e => {
                    const icon = getCategoryIcon(e.category);
                    html += `
            <div class="entry-item" data-id="${e.id}">
              <div class="entry-icon">${icon}</div>
              <div class="entry-info">
                <div class="entry-category">${e.category}</div>
                ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
              </div>
              <div class="entry-right">
                <div class="entry-amount ${e.type}">${e.type === 'income' ? '+' : '-'}$${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div class="entry-actions">
                <button class="btn-edit" title="編輯" data-id="${e.id}">✏️</button>
                <button class="btn-delete" title="刪除" data-id="${e.id}">🗑️</button>
              </div>
            </div>`;
                });
            }
            currentDate = entry.date;
            dayTotal = 0;
            items = [];
        }

        const sign = entry.type === 'expense' ? -1 : 1;
        dayTotal += entry.amount * sign;
        items.push(entry);
    });

    // 輸出最後一組
    if (items.length > 0) {
        const d = new Date(currentDate);
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()} 星期${weekdays[d.getDay()]}`;
        html += `<div class="date-separator">${dateLabel} <span style="float:right">${dayTotal >= 0 ? '+' : ''}$${dayTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span></div>`;
        items.forEach(e => {
            const icon = getCategoryIcon(e.category);
            html += `
            <div class="entry-item" data-id="${e.id}">
              <div class="entry-icon">${icon}</div>
              <div class="entry-info">
                <div class="entry-category">${e.category}</div>
                ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
              </div>
              <div class="entry-right">
                <div class="entry-amount ${e.type}">${e.type === 'income' ? '+' : '-'}$${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</div>
              </div>
              <div class="entry-actions">
                <button class="btn-edit" title="編輯" data-id="${e.id}">✏️</button>
                <button class="btn-delete" title="刪除" data-id="${e.id}">🗑️</button>
              </div>
            </div>`;
        });
    }

    container.innerHTML = html;
    // 移除舊的個別事件綁定，改用 initList 中的 delegation
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ---- 確認 Modal ----

let pendingConfirmCallback = null;

function showConfirmModal(message, callback) {
    const modal = document.getElementById('confirm-modal');
    document.getElementById('confirm-message').textContent = message;
    modal.style.display = 'flex';
    pendingConfirmCallback = callback;
    console.log('[List] Confirm Modal 已顯示');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').style.display = 'none';
    pendingConfirmCallback = null;
}

// ---- 編輯 Modal ----

function openEditModal(id) {
    const entries = getEntriesFiltered({});
    const entry = entries.find(e => e.id === id);
    if (!entry) return;

    const modal = document.getElementById('edit-modal');
    document.getElementById('edit-id').value = entry.id;
    document.getElementById('edit-date').value = entry.date;
    document.getElementById('edit-type').value = entry.type;
    document.getElementById('edit-amount').value = entry.amount;
    document.getElementById('edit-note').value = entry.note || '';

    // 填充分類選項
    const categorySelect = document.getElementById('edit-category');
    const allCats = [...getCategoriesByType('expense'), ...getCategoriesByType('income')];
    categorySelect.innerHTML = allCats.map(c =>
        `<option value="${c.name}" ${c.name === entry.category ? 'selected' : ''}>${c.icon} ${c.name}</option>`
    ).join('');

    modal.style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('edit-modal').style.display = 'none';
}

async function handleEditSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('edit-id').value;
    const updates = {
        date: document.getElementById('edit-date').value,
        type: document.getElementById('edit-type').value,
        category: document.getElementById('edit-category').value,
        amount: Number(document.getElementById('edit-amount').value),
        note: document.getElementById('edit-note').value,
    };

    const updated = updateEntry(id, updates);
    closeEditModal();
    window.dispatchEvent(new CustomEvent('entries-changed'));
    window.showToast('已更新', 'success');

    if (isLoggedIn() && updated) {
        syncSingleEntry(updated);
    }
}
