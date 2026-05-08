const API_BASE = typeof window.API_BASE === "string" ? window.API_BASE.replace(/\/+$/, "") : "";
const AUTH_STORAGE_KEYS = ["current_user", "currentUser"];

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

function setDetailStatus(msg, isError = false) {
    const el = document.getElementById("detailStatus");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#1b5e20";
}

function setCommentHint(msg, isError = false) {
    const el = document.getElementById("commentHint");
    if (!el) return;
    el.textContent = msg || "";
    el.style.color = isError ? "#b00020" : "#555";
}

async function parseJsonResponse(res) {
    const text = await res.text();
    if (!text) return { ok: false, error: `Empty response (HTTP ${res.status})` };
    try {
        return JSON.parse(text);
    } catch {
        return { ok: false, error: `Lỗi server (HTTP ${res.status})` };
    }
}

function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

function pickVideoDescription(v) {
    const raw = v.Description ?? v.description ?? v.mo_ta ?? v.MO_TA;
    return raw ? String(raw).trim() : "";
}

function renderComments(comments) {
    const list = document.getElementById("commentList");
    if (!list) return;
    list.innerHTML = "";
    if (!comments?.length) {
        list.innerHTML = "<p style='color: #666; font-size: 14px;'>Chưa có bình luận nào.</p>";
        return;
    }
    for (const c of comments) {
        const row = document.createElement("div");
        row.className = "comment-item";
        const who = c.TenDangNhap || "Người dùng";
        const avatar = c.AnhDaiDien ? apiUrl(c.AnhDaiDien) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
        
        let when = "";
        if (c.NgayTao) {
            const date = new Date(c.NgayTao);
            when = date.toLocaleDateString("vi-VN");
        }

        row.innerHTML = `
            <img src="${avatar}" class="comment-avatar">
            <div class="comment-content">
                <div class="comment-author">${escapeHtml(who)} <span style="font-weight: normal; color: #606060; font-size: 12px; margin-left: 8px;">${when}</span></div>
                <div class="comment-text">${escapeHtml(c.NoiDung || "")}</div>
            </div>
        `;
        list.appendChild(row);
    }
}

async function loadRecommendations(creatorId, currentVideoId) {
    const list = document.getElementById("recommendationsList");
    if (!list) return;

    try {
        const res = await apiFetch(`/api/videos?userId=${creatorId}`);
        const data = await parseJsonResponse(res);
        if (data.ok && Array.isArray(data.videos)) {
            const filtered = data.videos.filter(v => (v.VideoId || v.video_id) != currentVideoId);
            list.innerHTML = "";
            
            if (filtered.length === 0) {
                list.innerHTML = "<p style='font-size: 13px; color: #666;'>Không có video nào khác từ kênh này.</p>";
                return;
            }

            filtered.forEach(v => {
                const card = document.createElement("div");
                card.className = "rec-card";
                const vId = v.VideoId || v.video_id;
                card.onclick = () => window.location.href = `video.html?id=${vId}`;

                const thumb = v.ThumbnailUrl ? apiUrl(v.ThumbnailUrl) : "https://via.placeholder.com/160x90?text=No+Thumb";
                const views = v.LuotXem || 0;

                card.innerHTML = `
                    <div class="rec-thumb-wrapper">
                        <img src="${thumb}" class="rec-thumb">
                    </div>
                    <div class="rec-info">
                        <div class="rec-title">${escapeHtml(v.Title || "Video")}</div>
                        <div class="rec-meta">${escapeHtml(v.TenDangNhap || "")}</div>
                        <div class="rec-meta">${views} lượt xem</div>
                    </div>
                `;
                list.appendChild(card);
            });
        }
    } catch (e) {
        list.innerHTML = "<p>Lỗi tải đề xuất.</p>";
    }
}

async function loadLikeState(videoId, user) {
    const likeBtn = document.getElementById("likeBtn");
    const likeCount = document.getElementById("likeCount");
    if (!videoId) return;

    try {
        const url = `/api/videos/${videoId}/likes${user ? `?nguoi_dung_id=${user.nguoi_dung_id}` : ""}`;
        const res = await apiFetch(url);
        const data = await parseJsonResponse(res);
        
        if (likeCount) likeCount.textContent = data.count || 0;
        if (likeBtn) {
            if (data.liked) {
                likeBtn.style.background = "rgba(0,0,0,0.1)";
                document.getElementById("likeIcon").textContent = "❤️";
            } else {
                likeBtn.style.background = "rgba(0,0,0,0.05)";
                document.getElementById("likeIcon").textContent = "👍";
            }
        }
    } catch (e) { console.error(e); }
}

window.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    if (!id) return;

    const user = loadCurrentUser();
    if (user?.anh_dai_dien) {
        document.getElementById("currentUserAvatar").src = apiUrl(user.anh_dai_dien);
    }

    document.getElementById("backBtn")?.addEventListener("click", () => window.location.href = "index.html");
    document.getElementById("loginPageBtn")?.addEventListener("click", () => window.location.href = "login.html");

    try {
        const res = await apiFetch(`/api/videos/${id}${user ? `?nguoi_dung_id=${user.nguoi_dung_id}` : ""}`);
        const data = await parseJsonResponse(res);
        if (!data.ok) {
            if (res.status === 403) {
                document.body.innerHTML = `<div style="text-align:center; padding: 100px;"><h1>🔞 Nội dung giới hạn độ tuổi</h1><button onclick="history.back()">Quay lại</button></div>`;
                return;
            }
            throw new Error(data.error);
        }

        const v = data.video;
        const creatorId = v.NguoiDungId || v.nguoi_dung_id;

        document.getElementById("detailTitle").textContent = v.Title || "Video";
        document.getElementById("detailVideo").src = apiUrl(v.RelativeUrl);
        document.getElementById("detailDescription").textContent = pickVideoDescription(v);
        document.getElementById("viewCount").textContent = v.LuotXem || 0;
        
        if (v.UploadedAt) {
            document.getElementById("publishDate").textContent = new Date(v.UploadedAt).toLocaleDateString("vi-VN");
        }

        const creatorName = v.TenDangNhap || "Kênh Video";
        document.getElementById("creatorName").textContent = creatorName;
        document.getElementById("creatorAvatar").src = v.Avatar ? apiUrl(v.Avatar) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
        document.getElementById("channelInfo").onclick = () => window.location.href = `user.html?id=${creatorId}`;
        document.getElementById("recHeader").textContent = `Video của ${creatorName}`;

        // Subscribe Button
        if (user && user.nguoi_dung_id != creatorId) {
            const subWrap = document.getElementById("subBtnPlaceholder");
            const subBtn = document.createElement("button");
            subBtn.className = "action-btn";
            subBtn.style.marginLeft = "15px";
            subBtn.style.padding = "10px 20px";
            subBtn.style.borderRadius = "20px";
            subBtn.style.fontWeight = "bold";
            subBtn.style.border = "none";
            subBtn.style.cursor = "pointer";
            subWrap.appendChild(subBtn);

            const updateSubUI = async () => {
                const r = await apiFetch(`/api/subscribe/status?subscriberId=${user.nguoi_dung_id}&channelId=${creatorId}`);
                const d = await parseJsonResponse(r);
                if (d.subscribed) {
                    subBtn.textContent = "Đã đăng ký";
                    subBtn.style.background = "#e0e0e0";
                    subBtn.style.color = "#0f0f0f";
                } else {
                    subBtn.textContent = "Đăng ký";
                    subBtn.style.background = "#0f0f0f";
                    subBtn.style.color = "white";
                }
            };
            updateSubUI();

            subBtn.onclick = async () => {
                const r = await apiFetch("/api/subscribe", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ subscriberId: user.nguoi_dung_id, channelId: creatorId })
                });
                const d = await parseJsonResponse(r);
                if (d.ok) updateSubUI();
            };
        }

        loadRecommendations(creatorId, id);
        loadLikeState(id, user);

        // Comments
        const loadComments = async () => {
            const r = await apiFetch(`/api/videos/${id}/comments`);
            const d = await parseJsonResponse(r);
            if (d.ok) renderComments(d.comments);
        };
        loadComments();

        document.getElementById("sendCommentBtn").onclick = async () => {
            const txt = document.getElementById("commentInput").value.trim();
            if (!txt) return;
            const r = await apiFetch(`/api/videos/${id}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ noi_dung: txt, nguoi_dung_id: user.nguoi_dung_id }),
            });
            const d = await parseJsonResponse(r);
            if (d.ok) {
                document.getElementById("commentInput").value = "";
                loadComments();
            }
        };

        document.getElementById("likeBtn").onclick = async () => {
            if (!user) return alert("Đăng nhập để like!");
            const r = await apiFetch(`/api/videos/${id}/likes/toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ nguoi_dung_id: user.nguoi_dung_id }),
            });
            const d = await parseJsonResponse(r);
            if (d.ok) loadLikeState(id, user);
        };

    } catch (e) {
        setDetailStatus("Lỗi: " + e.message, true);
    }
});
