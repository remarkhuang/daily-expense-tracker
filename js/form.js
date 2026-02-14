// ============================================
// form.js — 記帳表單
// ============================================

import { addEntry } from './store.js';
import { getCategoriesByType, getCategoryIcon } from './categories.js';
import { startListening, stopListening, onVoiceResult, isVoiceSupported, getIsListening } from './voice.js';
import { syncSingleEntry } from './sync.js';
import { isLoggedIn } from './auth.js';

let currentType = 'expense';
let selectedCategory = '飲食';
let dropdownOpen = false;

export function initForm() {
    const form = document.getElementById('expense-form');
    const dateInput = document.getElementById('input-date');
    const toggleBtns = document.querySelectorAll('#type-toggle .toggle-btn');
    const categoryBtn = document.getElementById('category-dropdown-btn');
    const voiceBtn = document.getElementById('btn-voice');

    // 預設今日
    dateInput.value = new Date().toISOString().split('T')[0];

    // 收入/支出切換
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentType = btn.dataset.type;
            renderCategoryDropdown();
            // 切換時選第一個分類
            const cats = getCategoriesByType(currentType);
            if (cats.length > 0) {
                selectCategory(cats[0].name, cats[0].icon);
            }
        });
    });

    // 分類下拉
    categoryBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdownOpen = !dropdownOpen;
        const dropdown = document.getElementById('category-dropdown');
        dropdown.classList.toggle('open', dropdownOpen);
        categoryBtn.classList.toggle('open', dropdownOpen);
    });

    document.addEventListener('click', () => {
        if (dropdownOpen) {
            dropdownOpen = false;
            document.getElementById('category-dropdown').classList.remove('open');
            document.getElementById('category-dropdown-btn').classList.remove('open');
        }
    });

    // 初始化分類下拉
    renderCategoryDropdown();

    // 表單送出
    form.addEventListener('submit', handleSubmit);

    // 語音按鈕
    if (isVoiceSupported()) {
        voiceBtn.addEventListener('click', handleVoiceClick);
        initVoiceHandlers();
    } else {
        voiceBtn.style.display = 'none';
    }
}

function renderCategoryDropdown() {
    const dropdown = document.getElementById('category-dropdown');
    const cats = getCategoriesByType(currentType);

    dropdown.innerHTML = cats.map(c => `
    <div class="category-option ${c.name === selectedCategory ? 'selected' : ''}" 
         data-name="${c.name}" data-icon="${c.icon}">
      <span>${c.icon}</span>
      <span>${c.name}</span>
    </div>
  `).join('');

    dropdown.querySelectorAll('.category-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            selectCategory(opt.dataset.name, opt.dataset.icon);
            dropdownOpen = false;
            dropdown.classList.remove('open');
            document.getElementById('category-dropdown-btn').classList.remove('open');
        });
    });
}

function selectCategory(name, icon) {
    selectedCategory = name;
    document.getElementById('selected-category-icon').textContent = icon;
    document.getElementById('selected-category-text').textContent = name;
    renderCategoryDropdown();
}

async function handleSubmit(e) {
    e.preventDefault();

    const date = document.getElementById('input-date').value;
    const amount = document.getElementById('input-amount').value;
    const note = document.getElementById('input-note').value;

    if (!date || !amount || Number(amount) <= 0) {
        window.showToast('請填寫日期和金額', 'warning');
        return;
    }

    const entry = addEntry({
        date,
        type: currentType,
        category: selectedCategory,
        amount: Number(amount),
        note,
    });

    // 清空表單
    document.getElementById('input-amount').value = '';
    document.getElementById('input-note').value = '';
    document.getElementById('input-date').value = new Date().toISOString().split('T')[0];

    window.showToast(
        `已新增 ${currentType === 'income' ? '收入' : '支出'} $${Number(amount).toLocaleString()}`,
        'success'
    );

    // 如果已登入，同步到 Sheets
    if (isLoggedIn()) {
        syncSingleEntry(entry);
    }

    // 通知其他模組重新整理
    window.dispatchEvent(new CustomEvent('entries-changed'));
}

// ---- 語音相關 ----

function handleVoiceClick() {
    if (getIsListening()) {
        stopListening();
    } else {
        startListening();
    }
}

function initVoiceHandlers() {
    const voiceBtn = document.getElementById('btn-voice');
    const statusText = voiceBtn.querySelector('.voice-status');
    const voicePanel = document.getElementById('voice-result-panel');
    const rawText = document.getElementById('voice-raw-text');
    const parsedDiv = document.getElementById('voice-parsed');
    const confirmBtn = document.getElementById('btn-voice-confirm');
    const cancelBtn = document.getElementById('btn-voice-cancel');

    let lastParsed = null;

    onVoiceResult((event, data) => {
        switch (event) {
            case 'start':
                voiceBtn.classList.add('recording');
                statusText.textContent = '聆聽中...';
                break;

            case 'interim':
                statusText.textContent = data;
                break;

            case 'final':
                voiceBtn.classList.remove('recording');
                statusText.textContent = '點擊語音記帳';
                rawText.textContent = `「${data.raw}」`;
                lastParsed = data.parsed;

                const tags = [];
                tags.push(`${data.parsed.type === 'income' ? '收入' : '支出'}`);
                tags.push(`${getCategoryIcon(data.parsed.category)} ${data.parsed.category}`);
                if (data.parsed.amount > 0) tags.push(`$${data.parsed.amount.toLocaleString()}`);

                parsedDiv.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('');
                voicePanel.style.display = 'block';
                break;

            case 'error':
                voiceBtn.classList.remove('recording');
                statusText.textContent = '點擊語音記帳';
                if (data === 'not-allowed') {
                    window.showToast('請允許麥克風權限', 'error');
                } else {
                    window.showToast('語音辨識失敗，請再試一次', 'error');
                }
                break;

            case 'end':
                voiceBtn.classList.remove('recording');
                statusText.textContent = '點擊語音記帳';
                break;
        }
    });

    confirmBtn.addEventListener('click', () => {
        if (!lastParsed) return;

        // 填入表單
        if (lastParsed.type !== currentType) {
            // 切換收入/支出
            const toggleBtns = document.querySelectorAll('#type-toggle .toggle-btn');
            toggleBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.type === lastParsed.type);
            });
            currentType = lastParsed.type;
            renderCategoryDropdown();
        }

        selectedCategory = lastParsed.category;
        const icon = getCategoryIcon(lastParsed.category);
        selectCategory(lastParsed.category, icon);

        if (lastParsed.amount > 0) {
            document.getElementById('input-amount').value = lastParsed.amount;
        }
        document.getElementById('input-note').value = lastParsed.note || '';

        voicePanel.style.display = 'none';
        lastParsed = null;
    });

    cancelBtn.addEventListener('click', () => {
        voicePanel.style.display = 'none';
        lastParsed = null;
    });
}

export function refreshFormCategories() {
    renderCategoryDropdown();
}
