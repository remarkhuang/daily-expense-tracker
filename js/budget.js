// ============================================
// budget.js — 月度預算管理
// ============================================

import { getBudget, setBudget, getMonthSummary } from './store.js';

export function initBudget() {
    const input = document.getElementById('input-budget');
    const saveBtn = document.getElementById('btn-save-budget');
    const closeBtn = document.getElementById('budget-alert-close');

    // 載入已儲存的預算
    const saved = getBudget();
    if (saved > 0) {
        input.value = saved;
    }

    saveBtn.addEventListener('click', () => {
        const val = Number(input.value);
        if (val >= 0) {
            setBudget(val);
            window.showToast(val > 0 ? `月度預算已設為 $${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '已取消月度預算', 'success');
            checkBudget();
        }
    });

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('budget-alert').style.display = 'none';
        });
    }

    window.addEventListener('entries-changed', checkBudget);
    checkBudget();
}

export function checkBudget() {
    const budget = getBudget();
    const alertDiv = document.getElementById('budget-alert');

    if (!budget || budget <= 0) {
        alertDiv.style.display = 'none';
        return;
    }

    const now = new Date();
    const summary = getMonthSummary(now.getFullYear(), now.getMonth());

    if (summary.expense > budget) {
        alertDiv.style.display = 'flex';
        alertDiv.querySelector('span').textContent =
            `⚠️ 本月支出 $${summary.expense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 已超過預算 $${budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}！`;
    } else if (summary.expense > budget * 0.8) {
        alertDiv.style.display = 'flex';
        alertDiv.querySelector('span').textContent =
            `⚡ 本月支出已達預算 ${((summary.expense / budget) * 100).toFixed(0)}%（$${summary.expense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $${budget.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}）`;
    } else {
        alertDiv.style.display = 'none';
    }
}
