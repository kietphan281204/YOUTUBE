document.getElementById("homeBtn").onclick = function () {
    window.location.href = "index.html";
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
        if (typeof loadHistoryVideos === "function") loadHistoryVideos();
        return;
    }
    setAuthStatus("Chưa đăng nhập. Vui lòng vào trang Đăng nhập trước khi đăng video.", true);
    setStatus("Bạn cần đăng nhập để đăng video.", true);
    updateUploadAccess();
    const historyAuthWarning = document.getElementById("historyAuthWarning");
    if (historyAuthWarning) historyAuthWarning.style.display = "block";
    const historyContainer = document.getElementById("historyContainer");
    if (historyContainer) historyContainer.innerHTML = "";
}

function updateUploadAccess() {
    const uploadBtn = document.getElementById("uploadBtn");
    const canUpload = Boolean(currentUser?.nguoi_dung_id);
    if (uploadBtn) uploadBtn.disabled = !canUpload;
    const historyBtn = document.getElementById("historyBtn");
    if (historyBtn) historyBtn.style.display = canUpload ? "inline-block" : "none";
    const uploadPageBtn = document.getElementById("uploadPageBtn");
    if (uploadPageBtn) uploadPageBtn.style.display = canUpload ? "inline-block" : "none";
}

function pickVideoDescription(v) {
    if (!v || typeof v !== "object") return "";
    const raw = v.Description ?? v.description ?? v.mo_ta ?? v.MO_TA ?? v.mota;
    if (raw == null || String(raw).trim() === "") return "";
    return String(raw).trim();
}

function renderVideoCard(v) {
    const card = document.createElement("div");
    card.className = "videoCard";
    card.style.cursor = "pointer";
    card.title = "Xem chi tiết và bình luận";

    const title = document.createElement("div");
    title.className = "videoTitle";
    title.textContent = v.Title || v.FileName || "Video";

    const descriptionText = pickVideoDescription(v);
    let description = null;
    if (descriptionText) {
        description = document.createElement("div");
        description.className = "videoDescription";
        description.textContent = descriptionText;
    }

    const video = document.createElement("video");
    // If frontend and backend are different origins, RelativeUrl is like "/uploads/.."
    // so we must prefix it with API_BASE.
    video.src = apiUrl(v.RelativeUrl);
    video.controls = true;
    video.addEventListener("click", (e) => e.stopPropagation());

    const meta = document.createElement("div");
    meta.className = "videoMeta";
    let metaLine = v.UploadedAt ? new Date(v.UploadedAt).toLocaleString() : "";
    const stats = [];
    if (v.LuotXem != null) stats.push(`${v.LuotXem} lượt xem`);
    if (v.SoLike != null) stats.push(`${v.SoLike} thích`);
    if (v.SoBinhLuan != null) stats.push(`${v.SoBinhLuan} BL`);
    if (stats.length) {
        metaLine += (metaLine ? " · " : "") + stats.join(" · ");
    }
    meta.textContent = metaLine;

    const id = v.Id ?? v.id;
    card.addEventListener("click", () => {
        if (id != null) window.location.href = `video.html?id=${encodeURIComponent(String(id))}`;
    });

    card.appendChild(title);
    if (description) card.appendChild(description);
    card.appendChild(video);
    card.appendChild(meta);
    return card;
}

function renderHistoryRow(v) {
    const row = document.createElement("div");
    row.className = "historyRow";
    const id = v.Id ?? v.id;

    const infoCell = document.createElement("div");
    infoCell.className = "historyCell historyInfo";

    const thumbWrapper = document.createElement("div");
    thumbWrapper.className = "historyThumbnail";
    const thumbVideo = document.createElement("video");
    thumbVideo.src = apiUrl(v.RelativeUrl);
    thumbVideo.muted = true;
    thumbVideo.preload = "metadata";
    thumbVideo.playsInline = true;
    thumbVideo.loop = true;
    thumbVideo.addEventListener("click", (e) => e.stopPropagation());
    thumbWrapper.appendChild(thumbVideo);

    const textWrapper = document.createElement("div");
    textWrapper.className = "historyText";

    const title = document.createElement("div");
    title.className = "historyTitle";
    title.textContent = v.Title || "Video";

    const tags = document.createElement("div");
    tags.className = "historyTags";
    const descText = pickVideoDescription(v);
    tags.textContent = descText || "Không có mô tả";

    textWrapper.appendChild(title);
    textWrapper.appendChild(tags);
    infoCell.appendChild(thumbWrapper);
    infoCell.appendChild(textWrapper);

    const privacyCell = document.createElement("div");
    privacyCell.className = "historyCell";
    privacyCell.textContent = "Mọi người";

    const viewsCell = document.createElement("div");
    viewsCell.className = "historyCell";
    viewsCell.textContent = v.LuotXem != null ? v.LuotXem : "0";

    const likesCell = document.createElement("div");
    likesCell.className = "historyCell";
    likesCell.textContent = v.SoLike != null ? v.SoLike : "0";

    const commentsCell = document.createElement("div");
    commentsCell.className = "historyCell";
    commentsCell.textContent = v.SoBinhLuan != null ? v.SoBinhLuan : "0";

    const actionsCell = document.createElement("div");
    actionsCell.className = "historyCell historyActions";

    const editBtn = document.createElement("button");
    editBtn.textContent = "Sửa";
    editBtn.style.background = "#ff9800";
    editBtn.style.color = "white";
    editBtn.onclick = (e) => {
        e.stopPropagation();
        if (id != null) window.location.href = `edit.html?id=${encodeURIComponent(String(id))}`;
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Xoá";
    deleteBtn.style.background = "#d32f2f";
    deleteBtn.style.color = "white";
    deleteBtn.onclick = async (e) => {
        e.stopPropagation();
        if (!confirm("Bạn có chắc chắn muốn xoá video này vĩnh viễn?")) return;
        await deleteVideo(id);
    };

    actionsCell.appendChild(editBtn);
    actionsCell.appendChild(deleteBtn);

    row.appendChild(infoCell);
    row.appendChild(privacyCell);
    row.appendChild(viewsCell);
    row.appendChild(likesCell);
    row.appendChild(commentsCell);
    row.appendChild(actionsCell);

    row.addEventListener("click", () => {
        if (id != null) window.location.href = `video.html?id=${encodeURIComponent(String(id))}`;
    });

    return row;
}

function createHistoryHeader() {
    const header = document.createElement("div");
    header.className = "historyHeader";
    ["Video", "Quyền riêng tư", "Lượt xem", "Lượt thích", "Bình luận", "Hành động"].forEach((label) => {
        const cell = document.createElement("div");
        cell.className = "historyCell";
        cell.textContent = label;
        header.appendChild(cell);
    });
    return header;
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

let currentCategoryId = null;

async function filterByCategory(id, element) {
    document.querySelectorAll(".category-btn").forEach(b => b.classList.remove("active"));
    if (element) element.classList.add("active");
    currentCategoryId = id;
    
    document.getElementById("feedTitle").textContent = id ? `Video trong danh mục` : `Video mới`;
    await loadVideos(id);
}

async function loadCategories() {
    try {
        const res = await apiFetch("/api/categories");
        const data = await parseJsonResponse(res);
        if (res.ok && data.ok && Array.isArray(data.categories)) {
            const select = document.getElementById("categoryInput");
            const filterBar = document.getElementById("categoryFilterBar");
            
            data.categories.forEach(c => {
                if (select) {
                    const opt = document.createElement("option");
                    opt.value = c.danh_muc_id;
                    opt.textContent = c.ten_danh_muc;
                    select.appendChild(opt);
                }
                if (filterBar) {
                    const btn = document.createElement("button");
                    btn.className = "category-btn";
                    btn.textContent = c.ten_danh_muc;
                    btn.onclick = () => filterByCategory(c.danh_muc_id, btn);
                    filterBar.appendChild(btn);
                }
            });
        }
    } catch (e) {
        console.warn("Lỗi load categories", e);
    }
}

async function onCategoryChange() {
    const select = document.getElementById("categoryInput");
    const container = document.getElementById("tagSuggestContainer");
    const buttonsDiv = document.getElementById("tagButtons");
    
    if (!select || !container || !buttonsDiv) return;
    
    const catId = select.value;
    if (!catId) {
        container.style.display = "none";
        return;
    }

    try {
        const res = await apiFetch(`/api/tags?categoryId=${encodeURIComponent(catId)}`);
        const data = await parseJsonResponse(res);
        
        if (res.ok && data.ok && Array.isArray(data.tags) && data.tags.length > 0) {
            buttonsDiv.innerHTML = "";
            data.tags.forEach(t => {
                const btn = document.createElement("button");
                btn.className = "tag-chip";
                btn.textContent = t.ten_tag;
                btn.type = "button";
                btn.onclick = (e) => {
                    e.preventDefault();
                    const descInput = document.getElementById("descriptionInput");
                    if (descInput) {
                        const current = descInput.value;
                        if (!current.includes(t.ten_tag)) {
                            descInput.value = current ? current + " " + t.ten_tag : t.ten_tag;
                        }
                    }
                };
                buttonsDiv.appendChild(btn);
            });
            container.style.display = "block";
        } else {
            container.style.display = "none";
        }
    } catch (e) {
        console.warn("Lỗi load thẻ tag", e);
        container.style.display = "none";
    }
}

async function addCustomTag() {
    const select = document.getElementById("categoryInput");
    const catId = select ? select.value : null;
    if (!catId) return alert("Vui lòng chọn danh mục trước khi thêm thẻ tag.");
    
    const input = document.getElementById("customTagInput");
    if (!input) return;
    let tag = input.value.trim();
    if (!tag) return;
    if (!tag.startsWith("#")) tag = "#" + tag;
    
    try {
        const res = await apiFetch("/api/tags", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categoryId: catId, tagName: tag })
        });
        const data = await parseJsonResponse(res);
        if (data.ok) {
            input.value = "";
            onCategoryChange(); // Làm mới danh sách tag hiện có
        } else {
            alert("Lỗi thêm tag: " + data.error);
        }
    } catch(e) {
        console.warn("Lỗi mạng khi thêm tag", e);
        alert("Có lỗi xảy ra khi lưu Tag");
    }
}
let currentSearchQuery = "";

async function handleSearch() {
    const input = document.getElementById("searchInput");
    if (!input) return;
    const q = input.value.trim();
    if (!q) return;
    window.location.href = `search.html?q=${encodeURIComponent(q)}`;
}

// Bắt sự kiện Enter khi gõ tìm kiếm
window.addEventListener("DOMContentLoaded", () => {
    const searchInput = document.getElementById("searchInput");
    if (searchInput) {
        searchInput.addEventListener("keypress", (e) => {
            if (e.key === "Enter") handleSearch();
        });
    }
});

async function loadVideos(categoryId = null, query = "") {
    try {
        let url = "/api/videos?";
        const params = new URLSearchParams();
        if (categoryId) params.append("categoryId", categoryId);
        if (query) params.append("q", query);
        url += params.toString();
        const res = await apiFetch(url);
        const data = await parseJsonResponse(res);
        if (!data.ok) throw new Error(data.error || "Load failed");
        const videos = Array.isArray(data.videos) ? data.videos : [];

        const container = document.getElementById("videoContainer");
        if (!container) return;
        container.innerHTML = "";
        
        if (!videos.length) {
            container.innerHTML = "<p>Khám phá chưa có video ở danh mục này.</p>";
            return;
        }

        for (const v of videos) {
            container.appendChild(renderVideoCard(v));
        }
    } catch (e) {
        setStatus(`Không tải được danh sách video: ${e.message}`, true);
    }
}

function setTrendingStatus(msg, isError = false) {
    const el = document.getElementById("trendingStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#555";
    el.style.fontSize = "13px";
}

async function loadTrendingVideos() {
    const container = document.getElementById("trendingContainer");
    if (!container) return;
    try {
        const res = await apiFetch("/api/videos/trending");
        if (res.status === 404) {
            setTrendingStatus(
                "API chưa có /api/videos/trending (404). git pull → npm run dev → cập nhật ngrok + config.js.",
                true
            );
            return;
        }
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.ok) throw new Error(data.error || "Trending failed");
        const videos = Array.isArray(data.videos) ? data.videos : [];
        if (!videos.length) {
            setTrendingStatus(
                `Chưa có video nào đạt đủ mốc 50 điểm Xu Hướng.`,
                false
            );
            return;
        }
        setTrendingStatus(
            `Xếp hạng dựa trên Điểm Xu Hướng trực tiếp.`,
            false
        );
        for (const v of videos) {
            container.appendChild(renderVideoCard(v));
        }
    } catch (e) {
        setTrendingStatus(`Không tải video xu hướng: ${e.message}`, true);
    }
}

async function loadHistoryVideos() {
    const container = document.getElementById("historyContainer");
    const warning = document.getElementById("historyAuthWarning");
    if (!container) return;
    if (!currentUser?.nguoi_dung_id) {
        if (warning) warning.style.display = "block";
        return;
    }
    if (warning) warning.style.display = "none";
    try {
        const res = await apiFetch(`/api/videos/history/${currentUser.nguoi_dung_id}`);
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.ok) throw new Error(data.error || "History failed");
        const videos = Array.isArray(data.videos) ? data.videos : [];
        container.innerHTML = "";
        if (!videos.length) {
            container.innerHTML = "<p>Trống (bạn chưa đăng video nào).</p>";
            return;
        }

        const table = document.createElement("div");
        table.className = "historyTable";
        table.appendChild(createHistoryHeader());

        for (const v of videos) {
            table.appendChild(renderHistoryRow(v));
        }

        container.appendChild(table);
    } catch (e) {
        container.innerHTML = `<p style="color:#b00020">Lỗi tải lịch sử: ${e.message}</p>`;
    }
}

async function deleteVideo(id) {
    try {
        const res = await apiFetch(`/api/videos/${id}`, { method: "DELETE" });
        const data = await parseJsonResponse(res);
        if (data.ok) {
            alert("Đã xoá video thành công.");
            loadHistoryVideos();
        } else {
            alert("Lỗi xoá video: " + data.error);
        }
    } catch(e) {
        alert("Lỗi mạng khi xoá video");
    }
}

async function saveEditedVideo() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('id');
    if(!videoId) return;

    const title = document.getElementById("titleInput").value.trim();
    const description = document.getElementById("descriptionInput").value.trim();
    const categoryId = document.getElementById("categoryInput").value;

    const statusEl = document.getElementById("status");
    setStatus("Đang lưu thay đổi...", false);

    try {
        const res = await apiFetch(`/api/videos/${videoId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, description, categoryId })
        });

        const data = await parseJsonResponse(res);
        if (data.ok) {
            setStatus("Sửa video thành công!", false);
            setTimeout(() => {
                window.location.href = "history.html";
            }, 1000);
        } else {
            setStatus("Sửa video thất bại: " + data.error, true);
        }
    } catch(e) {
        setStatus("Lỗi mạng: " + e.message, true);
    }
}

function getVideoDurationSeconds(file) {
    return new Promise((resolve) => {
        try {
            const el = document.createElement("video");
            const objectUrl = URL.createObjectURL(file);
            let done = false;

            const finish = (value) => {
                if (done) return;
                done = true;
                try {
                    URL.revokeObjectURL(objectUrl);
                } catch {
                    // ignore revoke errors
                }
                const n = Number(value);
                resolve(Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
            };

            el.preload = "metadata";
            el.src = objectUrl;
            el.onloadedmetadata = () => finish(el.duration);
            el.ondurationchange = () => {
                if (Number.isFinite(el.duration) && el.duration > 0) {
                    finish(el.duration);
                }
            };
            el.onerror = () => finish(0);

            // Safety timeout in case browser never fires metadata events.
            setTimeout(() => finish(0), 15000);
        } catch {
            resolve(0);
        }
    });
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
    const descriptionInput = document.getElementById("descriptionInput");
    if (!descriptionInput) {
        setStatus(
            "Trang thiếu ô mô tả (id=descriptionInput). Hãy git pull, push GitHub Pages và Ctrl+F5.",
            true
        );
        return;
    }

    if (input.files.length === 0) {
        alert("Vui lòng chọn video!");
        return;
    }

    const file = input.files[0];
    setStatus("Đang upload...", false);

    try {
        const durationSeconds = await getVideoDurationSeconds(file);
        const titleVal = (titleInput?.value || "").trim();
        const descVal = (descriptionInput.value || "").trim();
        const categoryVal = document.getElementById("categoryInput")?.value;

        const form = new FormData();
        // Một field JSON: multer luôn đọc được; không phụ thuộc tên field lạ.
        form.append(
            "meta",
            JSON.stringify({
                title: titleVal,
                mo_ta: descVal,
            })
        );
        form.append("title", titleVal);
        form.append("mo_ta", descVal);
        if (categoryVal) form.append("categoryId", categoryVal);
        form.append("thoi_luong", String(durationSeconds));
        if (Number.isFinite(Number(currentUser?.nguoi_dung_id))) {
            form.append("nguoi_dung_id", String(currentUser.nguoi_dung_id));
        }
        form.append("video", file);

        let uploadPath = "/api/videos";
        if (descVal.length > 0) {
            const qs = new URLSearchParams({ mo_ta: descVal }).toString();
            const candidate = `${uploadPath}?${qs}`;
            uploadPath = candidate.length < 1900 ? candidate : uploadPath;
        }

        const res = await apiFetch(uploadPath, {
            method: "POST",
            body: form,
        });
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");

        const card = renderVideoCard(data.video);
        if (container) container.prepend(card);

        input.value = "";
        if (titleInput) titleInput.value = "";
        if (descriptionInput) descriptionInput.value = "";
        setStatus("Đăng video thành công. Trở lại Trang Chủ để xem!", false);
        if (typeof loadHistoryVideos === "function") loadHistoryVideos();
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
    loadCategories();
    loadTrendingVideos();

    const qs = new URLSearchParams(window.location.search);
    const query = qs.get("q");

    if (window.location.pathname.includes("search.html")) {
        // Chúng ta đang ở trang tìm kiếm
        const searchInput = document.getElementById("searchInput");
        if (searchInput && query) searchInput.value = query;
        const feedTitle = document.getElementById("feedTitle");
        if (feedTitle) feedTitle.textContent = query ? `Kết quả tìm kiếm: "${query}"` : "Vui lòng nhập từ khóa tìm kiếm";
        
        if (query) {
            loadVideos(null, query);
        }
    } else {
        // Trang chủ bình thường
        const isHistoryPage = window.location.pathname.includes("history.html");
        const isUploadPage = window.location.pathname.includes("upload.html");
        if (!isHistoryPage && !isUploadPage) {
            loadVideos();
        }
    }
});