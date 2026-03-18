// Nút trang chủ
document.getElementById("homeBtn").onclick = function () {
    alert("Đây là trang chủ!");
};

// Backend base URL (for GitHub Pages or separate hosting).
// Configure in config.js as: window.API_BASE = "https://your-backend.com"
const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";

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

function renderVideoCard(v) {
    const card = document.createElement("div");
    card.className = "videoCard";

    const title = document.createElement("div");
    title.className = "videoTitle";
    title.textContent = v.Title || v.FileName || "Video";

    const video = document.createElement("video");
    // If frontend and backend are different origins, RelativeUrl is like "/uploads/.."
    // so we must prefix it with API_BASE.
    video.src = apiUrl(v.RelativeUrl);
    video.controls = true;

    const meta = document.createElement("div");
    meta.className = "videoMeta";
    meta.textContent = v.UploadedAt ? new Date(v.UploadedAt).toLocaleString() : "";

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
        throw new Error(`Invalid JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
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
    loadVideos();
});