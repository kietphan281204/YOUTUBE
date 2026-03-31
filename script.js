// Nút trang chủ: mở API diag trong tab mới để kích hoạt ngrok cho thiết bị
document.getElementById("homeBtn").onclick = function () {
    const url = apiUrl("/api/diag");
    window.open(url, "_blank");
};
document.getElementById("loginPageBtn").onclick = function () {
    window.location.href = "login.html";
};

// Backend base URL (for GitHub Pages or separate hosting).
// Configure in config.js as: window.API_BASE = "https://your-backend.com"
const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEY = "current_user";
let currentUser = null;

function apiUrl(path) {
    const p = String(path || "");
    if (!p.startsWith("/")) return API_BASE ? `${API_BASE}/${p}` : p;
    return API_BASE ? `${API_BASE}${p}` : p;
}

function apiFetch(path, init = {}) {
    const headers = new Headers(init.headers || {});
    // Needed for ngrok free: skip the browser warning interstitial.
    // Triggers CORS preflight; backend must allow it.
    headers.set("ngrok-skip-browser-warning", "1");
    return fetch(apiUrl(path), { ...init, headers });
}

function setStatus(msg, isError = false) {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

function setAuthStatus(msg, isError = false) {
    const el = document.getElementById("authStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

function saveCurrentUser(user) {
    currentUser = user || null;
    if (!currentUser) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(currentUser));
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

function renderCurrentUser() {
    if (currentUser?.ten_dang_nhap) {
        setAuthStatus(
            `Đã đăng nhập: ${currentUser.ten_dang_nhap} (ID: ${currentUser.nguoi_dung_id})`,
            false
        );
        setStatus("", false);
        updateUploadAccess();
        return;
    }
    setAuthStatus("Chưa đăng nhập. Vui lòng vào trang Đăng nhập trước khi đăng video.", true);
    setStatus("Bạn cần đăng nhập để đăng video.", true);
    updateUploadAccess();
}

function updateUploadAccess() {
    const uploadBtn = document.getElementById("uploadBtn");
    const canUpload = Boolean(currentUser?.nguoi_dung_id);
    if (uploadBtn) uploadBtn.disabled = !canUpload;
}

function renderVideoCard(v) {
    const card = document.createElement("div");
    card.className = "videoCard";
    card.style.cursor = "pointer";
    card.title = "Xem chi tiết và bình luận";

    const title = document.createElement("div");
    title.className = "videoTitle";
    title.textContent = v.Title || v.FileName || "Video";

    const video = document.createElement("video");
    // If frontend and backend are different origins, RelativeUrl is like "/uploads/.."
    // so we must prefix it with API_BASE.
    video.src = apiUrl(v.RelativeUrl);
    video.controls = true;
    video.addEventListener("click", (e) => e.stopPropagation());

    const meta = document.createElement("div");
    meta.className = "videoMeta";
    meta.textContent = v.UploadedAt ? new Date(v.UploadedAt).toLocaleString() : "";

    const id = v.Id ?? v.id;
    card.addEventListener("click", () => {
        if (id != null) window.location.href = `video.html?id=${encodeURIComponent(String(id))}`;
    });

    card.appendChild(title);
    card.appendChild(video);
    card.appendChild(meta);
    return card;
}

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) {
        throw new Error(`Empty response (HTTP ${res.status})`);
    }

    try {
        return JSON.parse(text);
    } catch (parseError) {
        // Backend đôi khi trả HTML mặc định (404/route không tồn tại),
        // nên tránh throw "Invalid JSON" để người dùng thấy đúng lỗi.
        return {
            ok: false,
            error: `Server trả về không phải JSON (HTTP ${res.status}): ${String(text).slice(0, 200)}`,
        };
    }
}

async function loadVideos() {
    try {
        const res = await apiFetch("/api/videos");
        const data = await parseJsonResponse(res);
        if (!data.ok) throw new Error(data.error || "Load failed");
        const videos = Array.isArray(data.videos) ? data.videos : [];

        const container = document.getElementById("videoContainer");
        container.innerHTML = "";
        for (const v of videos) {
            container.appendChild(renderVideoCard(v));
        }
    } catch (e) {
        setStatus(`Không tải được danh sách video: ${e.message}`, true);
    }
}

// Hàm đăng video
async function uploadVideo() {
    if (!currentUser?.nguoi_dung_id) {
        setStatus("Bạn chưa đăng nhập. Không thể đăng video.", true);
        return;
    }

    const input = document.getElementById("videoInput");
    const container = document.getElementById("videoContainer");
    const titleInput = document.getElementById("titleInput");

    if (input.files.length === 0) {
        alert("Vui lòng chọn video!");
        return;
    }

    const file = input.files[0];
    setStatus("Đang upload...", false);

    try {
        const form = new FormData();
        form.append("title", titleInput?.value || "");
        if (Number.isFinite(Number(currentUser?.nguoi_dung_id))) {
            form.append("nguoi_dung_id", String(currentUser.nguoi_dung_id));
        }
        form.append("video", file);

        const res = await apiFetch("/api/videos", { method: "POST", body: form });
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");

        const card = renderVideoCard(data.video);
        container.prepend(card);

        input.value = "";
        if (titleInput) titleInput.value = "";
        setStatus("Đăng video thành công (đã lưu SQL).", false);
    } catch (e) {
        setStatus(`Đăng video thất bại: ${e.message}`, true);
    }
}

window.addEventListener("DOMContentLoaded", () => {
    if (location.hostname.endsWith("github.io") && !API_BASE) {
        setStatus("Bạn đang mở GitHub Pages nhưng chưa cấu hình backend. Mở `config.js` và set `window.API_BASE`.", true);
    }
    currentUser = loadCurrentUser();
    renderCurrentUser();
    loadVideos();
});