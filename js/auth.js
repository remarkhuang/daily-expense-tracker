// ============================================
// auth.js — Google OAuth (GIS) 認證
// ============================================

const CLIENT_ID = ''; // 使用者需填入自己的 Client ID
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

let tokenClient = null;
let accessToken = null;
let userInfo = null;

const listeners = [];

export function onAuthChange(callback) {
    listeners.push(callback);
}

function notifyListeners() {
    listeners.forEach(fn => fn({ isLoggedIn: !!accessToken, userInfo, accessToken }));
}

export function getAccessToken() {
    return accessToken;
}

export function isLoggedIn() {
    return !!accessToken;
}

export function getUserInfo() {
    return userInfo;
}

export function initAuth() {
    if (!CLIENT_ID) {
        console.warn('[Auth] 請在 auth.js 中填入 Google OAuth Client ID');
        notifyListeners(); // 即使沒設定也通知，讓 UI 進入未登入狀態
        return;
    }

    // eslint-disable-next-line no-undef
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (response) => {
            if (response.error) {
                console.error('[Auth] 授權失敗:', response.error);
                return;
            }
            accessToken = response.access_token;
            // 儲存 token 到本地 (選用，GIS token 通常短效，但在同一 session 內有用)
            localStorage.setItem('google_access_token', accessToken);
            fetchUserInfo();
        },
    });

    // 檢查是否有快取的 token (僅限本次 session 使用)
    const cachedToken = localStorage.getItem('google_access_token');
    if (cachedToken) {
        accessToken = cachedToken;
        fetchUserInfo();
    } else {
        notifyListeners();
    }
}

export function login() {
    if (!CLIENT_ID) {
        alert('請先在設定中填入 Google OAuth Client ID。\n\n詳見 README 或 auth.js 檔案。');
        return;
    }
    if (tokenClient) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    }
}

export function logout() {
    localStorage.removeItem('google_access_token');
    if (accessToken) {
        // eslint-disable-next-line no-undef
        google.accounts.oauth2.revoke(accessToken, () => {
            accessToken = null;
            userInfo = null;
            notifyListeners();
        });
    } else {
        accessToken = null;
        userInfo = null;
        notifyListeners();
    }
}

async function fetchUserInfo() {
    try {
        const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (res.ok) {
            userInfo = await res.json();
        }
    } catch (e) {
        console.error('[Auth] 取得使用者資訊失敗:', e);
    }
    notifyListeners();
}
