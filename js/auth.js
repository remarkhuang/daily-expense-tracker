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
            fetchUserInfo();
        },
    });
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
    if (accessToken) {
        // eslint-disable-next-line no-undef
        google.accounts.oauth2.revoke(accessToken, () => {
            accessToken = null;
            userInfo = null;
            notifyListeners();
        });
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
