// Nút trang chủ
document.getElementById("homeBtn").onclick = function () {
    alert("Đây là trang chủ!");
};

// If backend API isn't available (e.g., GitHub Pages), fall back to local storage (IndexedDB).
let useLocalStore = false;

function setStatus(msg, isError = false) {
    const el = document.getElementById("status");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

const LOCAL_DB = {
    name: "video_app_db",
    version: 1,
    store: "videos",
};

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(LOCAL_DB.name, LOCAL_DB.version);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(LOCAL_DB.store)) {
                const store = db.createObjectStore(LOCAL_DB.store, { keyPath: "id" });
                store.createIndex("createdAt", "createdAt");
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error("Không mở được IndexedDB"));
    });
}

async function idbGetAllNewestFirst() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_DB.store, "readonly");
        const store = tx.objectStore(LOCAL_DB.store);
        const req = store.getAll();
        req.onsuccess = () => {
            const items = Array.isArray(req.result) ? req.result : [];
            items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            resolve(items);
        };
        req.onerror = () => reject(req.error || new Error("Không đọc được dữ liệu local"));
        tx.oncomplete = () => db.close();
    });
}

async function idbAddVideo({ title, file }) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(LOCAL_DB.store, "readwrite");
        const store = tx.objectStore(LOCAL_DB.store);
        const now = Date.now();
        const record = {
            id: `${now}-${Math.random().toString(16).slice(2)}`,
            title: String(title || "").trim().slice(0, 255),
            fileName: file?.name || "video",
            blob: file,
            createdAt: now,
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(record);
        req.onerror = () => reject(req.error || new Error("Không lưu được video local"));
        tx.oncomplete = () => db.close();
    });
}

function renderVideoCard(v) {
    const card = document.createElement("div");
    card.className = "videoCard";

    const title = document.createElement("div");
    title.className = "videoTitle";
    title.textContent = v.Title || v.title || v.FileName || v.fileName || "Video";

    const video = document.createElement("video");
    if (v.RelativeUrl) {
        video.src = v.RelativeUrl;
    } else if (v.blob instanceof Blob) {
        video.src = URL.createObjectURL(v.blob);
        video.addEventListener("loadeddata", () => {
            // release when browser is done buffering enough
            // (safe to revoke after loadeddata for most cases)
            try { URL.revokeObjectURL(video.src); } catch { /* ignore */ }
        }, { once: true });
    }
    video.controls = true;

    const meta = document.createElement("div");
    meta.className = "videoMeta";
    const t = v.UploadedAt || v.uploadedAt || v.createdAt;
    meta.textContent = t ? new Date(t).toLocaleString() : "";

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
        let videos = [];

        if (!useLocalStore) {
            const res = await fetch("/api/videos");
            const data = await parseJsonResponse(res);
            if (!data.ok) throw new Error(data.error || "Load failed");
            videos = Array.isArray(data.videos) ? data.videos : [];
        } else {
            videos = await idbGetAllNewestFirst();
        }

        const container = document.getElementById("videoContainer");
        container.innerHTML = "";
        for (const v of videos) {
            container.appendChild(renderVideoCard(v));
        }
    } catch (e) {
        // Most common on GitHub Pages: /api/videos is 404 HTML. Switch to local store and retry.
        useLocalStore = true;
        try {
            const videos = await idbGetAllNewestFirst();
            const container = document.getElementById("videoContainer");
            container.innerHTML = "";
            for (const v of videos) container.appendChild(renderVideoCard(v));
            setStatus("Đang chạy chế độ local (không có backend). Video sẽ lưu trong trình duyệt.", false);
        } catch (inner) {
            setStatus(`Không tải được danh sách video: ${e.message}`, true);
        }
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
        if (!useLocalStore) {
            const form = new FormData();
            form.append("title", titleInput?.value || "");
            form.append("video", file);

            const res = await fetch("/api/videos", { method: "POST", body: form });
            const data = await parseJsonResponse(res);
            if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");

            const card = renderVideoCard(data.video);
            container.prepend(card);
            setStatus("Đăng video thành công (đã lưu SQL).", false);
        } else {
            const record = await idbAddVideo({ title: titleInput?.value || "", file });
            const card = renderVideoCard(record);
            container.prepend(card);
            setStatus("Đăng video thành công (lưu trong trình duyệt).", false);
        }

        input.value = "";
        if (titleInput) titleInput.value = "";
    } catch (e) {
        // If backend upload fails (common on GitHub Pages), fall back to local store and retry once.
        if (!useLocalStore) {
            useLocalStore = true;
            try {
                const record = await idbAddVideo({ title: titleInput?.value || "", file });
                const card = renderVideoCard(record);
                container.prepend(card);
                input.value = "";
                if (titleInput) titleInput.value = "";
                setStatus("Không có backend, đã chuyển sang lưu local trong trình duyệt.", false);
                return;
            } catch (inner) {
                // fall through
            }
        }
        setStatus(`Đăng video thất bại: ${e.message}`, true);
    }
}

window.addEventListener("DOMContentLoaded", () => {
    // Heuristic: GitHub Pages cannot run backend, so start in local mode to avoid 404 spam.
    if (location.hostname.endsWith("github.io")) useLocalStore = true;
    loadVideos();
});