// ============================================
// list.js — 帳目列表、篩選、刪除、編輯
// ============================================

import { getEntriesFiltered, deleteEntry, updateEntry } from './store.js';
import { getCategoryIcon, getCategoriesByType } from './categories.js';
import { isLoggedIn } from './auth.js';
import { syncSingleEntry } from './sync.js';

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
    document.getElementById('confirm-no').addEventListener('click', closeConfirmModal);

    // 監聽資料變更
    window.addEventListener('entries-changed', renderList);

    renderList();
}

export function renderList() {
    const container = document.getElementById('entries-list');
    const summaryDiv = document.getElementById('entries-summary');

    let filters = { type: currentFilterType };
    if (currentFilterMonth) {
        const [y, m] = currentFilterMonth.split('-').map(Number);
        filters.year = y;
        filters.month = m - 1;
    }

    const entries = getEntriesFiltered(filters);

    if (entries.length === 0) {
        container.innerHTML = `
      <div class="empty-state">
        <p>📝 尚無帳目紀錄</p>
        <p class="sub">到「記帳」頁新增第一筆吧！</p>
      </div>
    `;
        summaryDiv.innerHTML = '';
        return;
    }

    // 統計
    let totalIncome = 0, totalExpense = 0;
    entries.forEach(e => {
        if (e.type === 'income') totalIncome += e.amount;
        else totalExpense += e.amount;
    });

    summaryDiv.innerHTML = `
    <span class="income">收入 $${totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    <span class="expense">支出 $${totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    <span>共 ${entries.length} 筆</span>
  `;

    // 按日期分組
    const grouped = {};
    entries.forEach(e => {
        if (!grouped[e.date]) grouped[e.date] = [];
        grouped[e.date].push(e);
    });

    let html = '';
    for (const [date, items] of Object.entries(grouped)) {
        const d = new Date(date);
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
        const dateLabel = `${d.getMonth() + 1}/${d.getDate()} 星期${weekdays[d.getDay()]}`;

        // 當日小計
        let dayTotal = 0;
        items.forEach(e => {
            dayTotal += (e.type === 'expense' ? -1 : 1) * e.amount;
        });

        html += `<div class="date-separator">${dateLabel} <span style="float:right">${dayTotal >= 0 ? '+' : ''}$${dayTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></div>`;

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
            <div class="entry-amount ${e.type}">${e.type === 'income' ? '+' : '-'}$${e.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          </div>
          <div class="entry-actions">
            <button class="btn-edit" title="編輯" data-id="${e.id}">✏️</button>
            <button class="btn-delete" title="刪除" data-id="${e.id}">🗑️</button>
          </div>
        </div>
      `;
        });
    }

    container.innerHTML = html;

    // 綁定事件
    container.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            showConfirmModal('確定要刪除這筆帳目嗎？', () => {
                deleteEntry(btn.dataset.id);
                window.dispatchEvent(new CustomEvent('entries-changed'));
                window.showToast('已刪除', 'info');
            });
        });
    });

    container.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditModal(btn.dataset.id);
        });
    });
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

    document.getElementById('confirm-yes').onclick = () => {
        closeConfirmModal();
        if (pendingConfirmCallback) pendingConfirmCallback();
    };
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
