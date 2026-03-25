const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEY = "current_user";

function apiUrl(path) {
    const p = String(path || "");
    if (!p.startsWith("/")) return API_BASE ? `${API_BASE}/${p}` : p;
    return API_BASE ? `${API_BASE}${p}` : p;
}

function apiFetch(path, init = {}) {
    const headers = new Headers(init.headers || {});
    headers.set("ngrok-skip-browser-warning", "1");
    return fetch(apiUrl(path), { ...init, headers });
}

function setAuthStatus(msg, isError = false) {
    const el = document.getElementById("authStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

function saveCurrentUser(user) {
    if (!user) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
}

function loadCurrentUser() {
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function renderAccountInfo(user) {
    const accountInfo = document.getElementById("accountInfo");
    if (!accountInfo) return;
    if (user?.ten_dang_nhap) {
        accountInfo.textContent = `Đang đăng nhập: ${user.ten_dang_nhap} (ID: ${user.nguoi_dung_id}, email: ${user.email || "-"})`;
        accountInfo.style.color = "#1b5e20";
        return;
    }
    accountInfo.textContent = "Chưa đăng nhập.";
    accountInfo.style.color = "#555";
}

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) {
        return { ok: false, error: `Empty response (HTTP ${res.status})` };
    }
    try {
        return JSON.parse(text);
    } catch {
        return {
            ok: false,
            error: `Server trả về không phải JSON (HTTP ${res.status}): ${String(text).slice(0, 200)}`,
        };
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const backHomeBtn = document.getElementById("backHomeBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const showLoginBtn = document.getElementById("showLoginBtn");
    const showRegisterBtn = document.getElementById("showRegisterBtn");

    backHomeBtn?.addEventListener("click", () => {
        window.location.href = "index.html";
    });
    logoutBtn?.addEventListener("click", () => {
        saveCurrentUser(null);
        renderAccountInfo(null);
        setAuthStatus("Đã đăng xuất.", false);
    });

    function showLogin() {
        loginForm?.classList.remove("hidden");
        registerForm?.classList.add("hidden");
    }

    function showRegister() {
        registerForm?.classList.remove("hidden");
        loginForm?.classList.add("hidden");
    }

    showLoginBtn?.addEventListener("click", showLogin);
    showRegisterBtn?.addEventListener("click", showRegister);

    loginForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const login = document.getElementById("loginInput")?.value?.trim() || "";
        const password = document.getElementById("loginPasswordInput")?.value || "";
        try {
            const res = await apiFetch("/api/auth/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ login, password }),
            });
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Đăng nhập thất bại");
            saveCurrentUser(data.user);
            renderAccountInfo(data.user);
            setAuthStatus(`Đăng nhập thành công: ${data.user.ten_dang_nhap}`, false);
            setTimeout(() => {
                window.location.href = "index.html";
            }, 500);
        } catch (err) {
            setAuthStatus(`Đăng nhập thất bại: ${err.message}`, true);
        }
    });

    registerForm?.addEventListener("submit", async (e) => {
        e.preventDefault();
        const ten_dang_nhap = document.getElementById("registerUsernameInput")?.value?.trim() || "";
        const email = document.getElementById("registerEmailInput")?.value?.trim() || "";
        const password = document.getElementById("registerPasswordInput")?.value || "";
        try {
            const res = await apiFetch("/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ten_dang_nhap, email, password }),
            });
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Đăng ký thất bại");
            saveCurrentUser(data.user);
            renderAccountInfo(data.user);
            setAuthStatus(`Đăng ký thành công: ${data.user.ten_dang_nhap}`, false);
            showLogin();
        } catch (err) {
            setAuthStatus(`Đăng ký thất bại: ${err.message}`, true);
        }
    });

    renderAccountInfo(loadCurrentUser());
});
