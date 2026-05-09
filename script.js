const homeBtn = document.getElementById("homeBtn");
if (homeBtn) homeBtn.onclick = () => window.location.href = "index.html";

const loginPageBtn = document.getElementById("loginPageBtn");
if (loginPageBtn) loginPageBtn.onclick = () => window.location.href = "login.html";

// Backend base URL (for GitHub Pages or separate hosting).
// Configure in config.js as: window.API_BASE = "https://your-backend.com"
var API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEYS = ["current_user", "currentUser"];
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
        AUTH_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        return;
    }
    const value = JSON.stringify(currentUser);
    AUTH_STORAGE_KEYS.forEach((key) => localStorage.setItem(key, value));
}

function loadCurrentUser() {
    try {
        for (const key of AUTH_STORAGE_KEYS) {
            const raw = localStorage.getItem(key);
            if (raw) return JSON.parse(raw);
        }
        return null;
    } catch {
        return null;
    }
}

function renderCurrentUser() {
    const el = document.getElementById("authStatus");
    if (currentUser?.ten_dang_nhap) {
        if (el) {
            const avatarUrl = currentUser.anh_dai_dien ? apiUrl(currentUser.anh_dai_dien) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
            el.innerHTML = `
                <div style="display: flex; align-items: center; gap: 12px; padding: 6px 16px; border-radius: 24px; background: #fff; border: 1px solid #ddd; width: fit-content; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                    <img src="${avatarUrl}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                    <div style="display: flex; flex-direction: column;">
                        <span style="font-weight: 600; color: #0f0f0f; font-size: 14px;">Xin chào, ${currentUser.ten_dang_nhap}</span>
                    </div>
                </div>
            `;
            el.style.background = "none";
            el.style.padding = "0";
        }
        setStatus("", false);
        updateUploadAccess();
        if (typeof loadHistoryVideos === "function") loadHistoryVideos();
        return;
    }
    setAuthStatus("Chưa đăng nhập. Vui lòng vào trang Đăng nhập để sử dụng đầy đủ tính năng.", true);
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
    const subsPageBtn = document.getElementById("subsPageBtn");
    if (subsPageBtn) subsPageBtn.style.display = canUpload ? "inline-block" : "none";

    const notifWrapper = document.getElementById("notifWrapper");
    if (notifWrapper) {
        notifWrapper.style.display = canUpload ? "block" : "none";
        if (canUpload) {
            loadNotifications();
            // Xử lý đóng/mở dropdown
            const bell = document.getElementById("notifBell");
            const dropdown = document.getElementById("notifDropdown");
            if (bell && dropdown) {
                bell.onclick = (e) => {
                    e.stopPropagation();
                    dropdown.style.display = dropdown.style.display === "block" ? "none" : "block";
                    if (dropdown.style.display === "block") loadNotifications();
                };
                window.addEventListener("click", () => dropdown.style.display = "none");
                dropdown.onclick = (e) => e.stopPropagation();
            }
        }
    }
}

async function loadNotifications() {
    if (!currentUser) return;
    try {
        const res = await apiFetch(`/api/notifications/${currentUser.nguoi_dung_id || currentUser.id}`);
        const data = await res.json();
        if (data.ok) {
            const list = data.notifications || [];
            const unread = list.filter(n => !n.da_xem).length;
            const badge = document.getElementById("notifBadge");
            if (badge) {
                if (unread > 0) {
                    badge.textContent = unread > 99 ? "99+" : unread;
                    badge.style.display = "flex";
                } else {
                    badge.style.display = "none";
                }
            }

            const notifList = document.getElementById("notifList");
            if (notifList) {
                if (list.length === 0) {
                    notifList.innerHTML = `<div style="text-align: center; color: #999; padding: 20px; font-size: 13px;">Không có thông báo nào</div>`;
                } else {
                    notifList.innerHTML = list.map(n => `
                        <div onclick="window.location.href='${n.link || '#'}'" style="padding: 10px; border-bottom: 1px solid #f4f4f4; cursor: pointer; background: ${n.da_xem ? 'transparent' : '#f0f7ff'}; transition: background 0.2s;">
                            <div style="font-size: 13px; color: #333; line-height: 1.4;">${n.noi_dung}</div>
                            <div style="font-size: 11px; color: #999; margin-top: 4px;">${new Date(n.ngay_tao).toLocaleString()}</div>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (err) { console.error("Lỗi tải thông báo:", err); }
}

async function markAllNotifsRead() {
    if (!currentUser) return;
    try {
        const res = await apiFetch("/api/notifications/mark-read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: currentUser.nguoi_dung_id || currentUser.id })
        });
        const data = await res.json();
        if (data.ok) loadNotifications();
    } catch (err) { console.error("Lỗi đánh dấu đã đọc:", err); }
}

// Kiểm tra định kỳ mỗi 60 giây
setInterval(loadNotifications, 60000);

function pickVideoDescription(v) {
    if (!v || typeof v !== "object") return "";
    const raw = v.Description ?? v.description ?? v.mo_ta ?? v.MO_TA ?? v.mota;
    if (raw == null || String(raw).trim() === "") return "";
    return String(raw).trim();
}

function renderVideoCard(v) {
    if (!currentUser && typeof loadCurrentUser === "function") {
        currentUser = loadCurrentUser();
    }
    const card = document.createElement("div");
    card.className = "videoCard";
    card.style.cursor = "pointer";
    card.title = "Xem chi tiết và bình luận";

    const uploaderId = v.NguoiDungId ?? v.nguoi_dung_id;

    // Video container
    const video = document.createElement("video");
    video.src = apiUrl(v.RelativeUrl);
    video.controls = true;
    video.addEventListener("click", (e) => e.stopPropagation());
    
    // Kiểm tra giới hạn độ tuổi
    const userAge = parseInt(currentUser?.do_tuoi) || 0;
    const isRestricted = (v.ForKids === 0 || v.ForKids === false);
    const shouldWarn = isRestricted && userAge < 18;

    if (shouldWarn) {
        const thumbWrap = document.createElement("div");
        thumbWrap.style.position = "relative";
        thumbWrap.style.width = "100%";
        thumbWrap.style.aspectRatio = "16/9";
        thumbWrap.style.background = "#000";
        thumbWrap.style.borderRadius = "12px";
        thumbWrap.style.overflow = "hidden";
        
        video.style.filter = "blur(20px) grayscale(100%)";
        video.controls = false; // Chặn xem trước
        
        const overlay = document.createElement("div");
        overlay.innerHTML = `
            <div style="background: rgba(176, 0, 32, 0.9); color: white; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: bold; text-align: center;">
                🔞 Video dành cho người trên 18 tuổi
            </div>
        `;
        overlay.style.position = "absolute";
        overlay.style.top = "0";
        overlay.style.left = "0";
        overlay.style.width = "100%";
        overlay.style.height = "100%";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.zIndex = "5";
        
        thumbWrap.appendChild(video);
        thumbWrap.appendChild(overlay);
        card.appendChild(thumbWrap);
    } else {
        card.appendChild(video);
    }

    // Info container (Avatar + Text)
    const infoContainer = document.createElement("div");
    infoContainer.className = "videoCardInfo";
    infoContainer.style.display = "flex";
    infoContainer.style.gap = "12px";
    infoContainer.style.marginTop = "12px";

    // Avatar
    const avatarImg = document.createElement("img");
    const avatarUrl = v.Avatar ? apiUrl(v.Avatar) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    avatarImg.src = avatarUrl;
    avatarImg.className = "uploaderAvatar";
    avatarImg.style.width = "36px";
    avatarImg.style.height = "36px";
    avatarImg.style.borderRadius = "50%";
    avatarImg.style.objectFit = "cover";
    avatarImg.style.flexShrink = "0";
    avatarImg.onerror = () => { avatarImg.src = "https://cdn-icons-png.flaticon.com/512/149/149071.png"; };
    
    if (uploaderId) {
        const avatarLink = document.createElement("a");
        avatarLink.href = `user.html?id=${uploaderId}`;
        avatarLink.onclick = (e) => e.stopPropagation();
        avatarLink.appendChild(avatarImg);
        infoContainer.appendChild(avatarLink);
    } else {
        infoContainer.appendChild(avatarImg);
    }

    // Text container
    const textContainer = document.createElement("div");
    textContainer.style.flex = "1";
    textContainer.style.overflow = "hidden";

    // Title
    const title = document.createElement("div");
    title.className = "videoTitle";
    title.textContent = v.Title || v.FileName || "Video";
    title.style.margin = "0 0 4px 0";
    title.style.fontSize = "16px";
    title.style.lineHeight = "1.4";
    title.style.display = "-webkit-box";
    title.style.webkitLineClamp = "2";
    title.style.webkitBoxOrient = "vertical";
    title.style.overflow = "hidden";
    textContainer.appendChild(title);

    // Uploader Name
    const uploader = document.createElement("div");
    uploader.className = "uploaderName";
    if (uploaderId) {
        const userLink = document.createElement("a");
        userLink.href = `user.html?id=${uploaderId}`;
        userLink.textContent = v.TenDangNhap || "Người dùng ẩn danh";
        userLink.style.textDecoration = "none";
        userLink.style.color = "inherit";
        userLink.onclick = (e) => e.stopPropagation();
        uploader.appendChild(userLink);
    } else {
        uploader.textContent = v.TenDangNhap || "Người dùng ẩn danh";
    }
    uploader.style.fontSize = "13px";
    uploader.style.color = "#606060";
    uploader.style.marginBottom = "2px";
    textContainer.appendChild(uploader);

    // Metadata (Views + Date)
    const meta = document.createElement("div");
    meta.className = "videoMeta";
    
    let dateStr = "";
    if (v.UploadedAt) {
        const date = new Date(v.UploadedAt);
        dateStr = date.toLocaleDateString("vi-VN");
    }

    let metaLine = "";
    const stats = [];
    if (v.LuotXem != null) stats.push(`${v.LuotXem} lượt xem`);
    if (stats.length) {
        metaLine = stats.join(" · ") + (dateStr ? " · " + dateStr : "");
    } else {
        metaLine = dateStr;
    }
    meta.textContent = metaLine;
    meta.style.fontSize = "13px";
    meta.style.color = "#606060";
    textContainer.appendChild(meta);

    infoContainer.appendChild(textContainer);
    card.appendChild(infoContainer);

    const id = v.Id ?? v.id;
    card.addEventListener("click", () => {
        if (id != null) window.location.href = `video.html?id=${encodeURIComponent(String(id))}`;
    });

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
    ["Video", "Lượt xem", "Lượt thích", "Bình luận", ""].forEach((label) => {
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
        if (currentUser?.nguoi_dung_id) params.append("nguoi_dung_id", currentUser.nguoi_dung_id);
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
    container.innerHTML = "";
    try {
        const userId = currentUser?.nguoi_dung_id ? `?nguoi_dung_id=${currentUser.nguoi_dung_id}` : "";
        const res = await apiFetch(`/api/videos/trending${userId}`);
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
    const titleInput = document.getElementById("titleInput");
    const descriptionInput = document.getElementById("descriptionInput");
    const uploadBtn = document.getElementById("uploadBtn");
    const progressContainer = document.getElementById("uploadProgressContainer");
    const progressBar = document.getElementById("uploadProgressBar");
    const progressPercent = document.getElementById("uploadPercentage");
    const progressSpeed = document.getElementById("uploadSpeed");
    const progressTime = document.getElementById("uploadTimeRemaining");
    const statusText = document.getElementById("uploadStatusText");

    if (input.files.length === 0) {
        alert("Vui lòng chọn video!");
        return;
    }

    const file = input.files[0];
    const durationSeconds = await getVideoDurationSeconds(file);
    const titleVal = (titleInput?.value || "").trim();
    const descVal = (descriptionInput?.value || "").trim();
    const categoryVal = document.getElementById("categoryInput")?.value;
    const forKids = document.querySelector('input[name="forKids"]:checked')?.value || "yes";

    const form = new FormData();
    form.append("meta", JSON.stringify({ title: titleVal, mo_ta: descVal }));
    form.append("title", titleVal);
    form.append("mo_ta", descVal);
    if (categoryVal) form.append("categoryId", categoryVal);
    form.append("forKids", forKids);
    form.append("thoi_luong", String(durationSeconds));
    form.append("nguoi_dung_id", String(currentUser.nguoi_dung_id));
    form.append("video", file);

    // Chuẩn bị UI
    if (progressContainer) progressContainer.style.display = "block";
    if (uploadBtn) uploadBtn.disabled = true;
    setStatus("", false);

    const startTime = Date.now();

    const xhr = new XMLHttpRequest();
    let uploadUrl = apiUrl("/api/videos");
    
    xhr.open("POST", uploadUrl, true);
    xhr.setRequestHeader("ngrok-skip-browser-warning", "1");

    xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
            const percentComplete = (e.loaded / e.total) * 100;
            const elapsedTime = (Date.now() - startTime) / 1000; // seconds
            const speedBytes = e.loaded / elapsedTime; // bytes/sec
            
            // Format Speed
            let speedText = "";
            if (speedBytes > 1024 * 1024) {
                speedText = (speedBytes / (1024 * 1024)).toFixed(2) + " MB/s";
            } else {
                speedText = (speedBytes / 1024).toFixed(2) + " KB/s";
            }

            // Format Time Remaining
            const bytesRemaining = e.total - e.loaded;
            const secondsRemaining = bytesRemaining / speedBytes;
            let timeText = "--:--";
            if (secondsRemaining > 0 && Number.isFinite(secondsRemaining)) {
                const mins = Math.floor(secondsRemaining / 60);
                const secs = Math.floor(secondsRemaining % 60);
                timeText = `${mins}:${secs.toString().padStart(2, '0')}`;
            }

            // Update UI
            if (progressBar) progressBar.style.width = percentComplete + "%";
            if (progressPercent) progressPercent.textContent = Math.round(percentComplete) + "%";
            if (progressSpeed) progressSpeed.textContent = "Tốc độ: " + speedText;
            if (progressTime) progressTime.textContent = "Còn lại: " + timeText;
        }
    };

    xhr.onload = async () => {
        if (uploadBtn) uploadBtn.disabled = false;
        try {
            const data = JSON.parse(xhr.responseText);
            if (xhr.status >= 200 && xhr.status < 300 && data.ok) {
                if (statusText) statusText.textContent = "Hoàn tất!";
                if (progressBar) progressBar.style.background = "#2ed573";
                setStatus("Đăng video thành công. Chờ quản trị viên duyệt!", false);
                input.value = "";
                if (titleInput) titleInput.value = "";
                if (descriptionInput) descriptionInput.value = "";
                setTimeout(() => {
                    if (progressContainer) progressContainer.style.display = "none";
                }, 3000);
            } else {
                throw new Error(data.error || "Upload failed");
            }
        } catch (e) {
            setStatus("Lỗi upload: " + e.message, true);
        }
    };

    xhr.onerror = () => {
        if (uploadBtn) uploadBtn.disabled = false;
        setStatus("Lỗi kết nối khi upload.", true);
    };

    xhr.send(form);
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