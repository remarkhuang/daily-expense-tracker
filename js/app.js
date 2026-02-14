// ============================================
// app.js — 應用程式進入點、路由、全域工具
// ============================================

import { initForm, refreshFormCategories } from './form.js';
import { initList, renderList } from './list.js';
import { initCharts, renderCharts } from './charts.js';
import { initExport } from './export.js';
import { initBudget } from './budget.js';
import { initAuth, login, logout, onAuthChange, isLoggedIn } from './auth.js';
import { fullSync, onSyncChange, getSpreadsheetUrl } from './sync.js';
import { initVoice } from './voice.js';
import { getCategories, addCategory, removeCategory, getCategoriesByType } from './categories.js';

// ---- Toast 全域函式 ----
window.showToast = function (message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out forwards';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
};

// ---- 頁面路由 ----
function initRouter() {
    const navBtns = document.querySelectorAll('.nav-btn');
    const pages = document.querySelectorAll('.page');

    navBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPage = btn.dataset.page;

            navBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            pages.forEach(p => {
                p.classList.remove('active');
                if (p.id === `page-${targetPage}`) {
                    p.classList.add('active');

                    // 切換到圖表頁時重新渲染
                    if (targetPage === 'charts') {
                        renderCharts();
                    }
                    // 切換到列表頁時重新渲染
                    if (targetPage === 'list') {
                        renderList();
                    }
                }
            });
        });
    });
}

// ---- Google Auth UI ----
function initAuthUI() {
    const loginBtn = document.getElementById('btn-google-login');
    const settingsLoginBtn = document.getElementById('btn-settings-login');
    const syncBtn = document.getElementById('btn-sync');
    const avatarDiv = document.getElementById('user-avatar');
    const avatarImg = document.getElementById('user-avatar-img');
    const syncStatusText = document.getElementById('sync-status-text');
    const sheetUrlDiv = document.getElementById('setting-sheet-url');
    const sheetLink = document.getElementById('sheet-link');
    const loginBtnWall = document.getElementById('btn-login-wall');

    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            if (isLoggedIn()) logout(); else login();
        });
    }

    if (loginBtnWall) {
        loginBtnWall.addEventListener('click', () => {
            login();
        });
    }

    if (settingsLoginBtn) {
        settingsLoginBtn.addEventListener('click', () => {
            if (isLoggedIn()) logout(); else login();
        });
    }

    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            syncBtn.classList.add('syncing');
            await fullSync();
            syncBtn.classList.remove('syncing');
            renderList();
            renderCharts();
        });
    }

    onAuthChange(({ isLoggedIn: loggedIn, userInfo }) => {
        const loginWall = document.getElementById('login-wall');
        const appContainer = document.getElementById('app-container');

        if (loggedIn) {
            if (loginWall) loginWall.style.display = 'none';
            if (appContainer) appContainer.style.display = 'block';

            if (loginBtn) loginBtn.style.display = 'none';
            if (avatarDiv) avatarDiv.style.display = 'block';
            if (syncBtn) syncBtn.style.display = 'flex';
            if (settingsLoginBtn) settingsLoginBtn.textContent = '登出';
            if (syncStatusText) syncStatusText.textContent = `已登入：${userInfo?.name || userInfo?.email || ''}`;

            if (userInfo?.picture && avatarImg) {
                avatarImg.src = userInfo.picture;
            }

            if (avatarDiv) avatarDiv.onclick = logout;

            fullSync().then(() => {
                renderList();
                renderCharts();
            });

            window.showToast('Google 登入成功！', 'success');
        } else {
            if (loginWall) loginWall.style.display = 'flex';
            if (appContainer) appContainer.style.display = 'none';

            if (loginBtn) loginBtn.style.display = 'flex';
            if (avatarDiv) avatarDiv.style.display = 'none';
            if (syncBtn) syncBtn.style.display = 'none';
            if (settingsLoginBtn) settingsLoginBtn.textContent = '登入';
            if (syncStatusText) syncStatusText.textContent = '尚未登入';
            if (sheetUrlDiv) sheetUrlDiv.style.display = 'none';
        }
    });

    onSyncChange(({ status, message, spreadsheetId }) => {
        if (status === 'success' || status === 'idle') {
            syncBtn.classList.remove('syncing');
            if (spreadsheetId) {
                sheetUrlDiv.style.display = 'flex';
                const url = getSpreadsheetUrl();
                sheetLink.href = url;
            }
        }
        if (status === 'error') {
            syncBtn.classList.remove('syncing');
            window.showToast(message, 'error');
        }
        if (message && status !== 'error') {
            syncStatusText.textContent = message;
        }
    });
}

// ---- 分類管理 UI ----
function initCategoryManager() {
    renderCategoryManager();

    document.getElementById('btn-add-category').addEventListener('click', () => {
        const icon = document.getElementById('input-new-category-icon').value.trim();
        const name = document.getElementById('input-new-category-name').value.trim();
        const type = document.getElementById('input-new-category-type').value;

        if (!icon || !name) {
            window.showToast('請填寫圖示和名稱', 'warning');
            return;
        }

        const success = addCategory(icon, name, type);
        if (success) {
            document.getElementById('input-new-category-icon').value = '';
            document.getElementById('input-new-category-name').value = '';
            renderCategoryManager();
            refreshFormCategories();
            window.showToast(`已新增分類「${icon} ${name}」`, 'success');
        } else {
            window.showToast('分類已存在', 'warning');
        }
    });
}

function renderCategoryManager() {
    const container = document.getElementById('category-manager');
    const cats = getCategories();

    container.innerHTML = cats.map(c => `
    <div class="category-tag">
      <span>${c.icon} ${c.name}</span>
      <span class="cat-type" style="font-size:0.7rem;color:var(--text-muted)">${c.type === 'income' ? '收' : '支'}</span>
      <button class="remove-cat" data-name="${c.name}" data-type="${c.type}" title="移除">✕</button>
    </div>
  `).join('');

    container.querySelectorAll('.remove-cat').forEach(btn => {
        btn.addEventListener('click', () => {
            removeCategory(btn.dataset.name, btn.dataset.type);
            renderCategoryManager();
            refreshFormCategories();
            window.showToast('已移除分類', 'info');
        });
    });
}

// ---- PWA Service Worker 註冊 ----
function registerSW() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('[SW] 註冊成功:', reg.scope))
            .catch(err => console.error('[SW] 註冊失敗:', err));
    }
}

// ---- 初始化 ----
document.addEventListener('DOMContentLoaded', () => {
    initRouter();
    initForm();
    initList();
    initCharts();
    initExport();
    initBudget();
    initVoice();
    initAuthUI();
    initCategoryManager();
    registerSW();

    // 嘗試初始化 Google Auth（等 GIS 腳本載入完成）
    const checkGIS = setInterval(() => {
        if (window.google && window.google.accounts) {
            clearInterval(checkGIS);
            initAuth();
        }
    }, 500);

    // 10秒後停止檢查
    setTimeout(() => clearInterval(checkGIS), 10000);
});
