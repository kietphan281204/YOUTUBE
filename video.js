// API_BASE and AUTH_STORAGE_KEYS are inherited from script.js

// apiUrl, apiFetch, loadCurrentUser are provided by script.js

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

function addSingleCommentToUI(c, videoOwnerId) {
    const list = document.getElementById("commentList");
    if (!list) return;
    
    // Nếu đang hiện thông báo "Chưa có bình luận", xóa nó đi
    if (list.querySelector("p")) {
        list.innerHTML = "";
    }

    const user = loadCurrentUser();
    const currentUid = user?.nguoi_dung_id || user?.id;

    const row = document.createElement("div");
    row.className = "comment-item";
    const who = c.TenDangNhap || "Người dùng";
    const avatar = c.AnhDaiDien || c.anh_dai_dien ? apiUrl(c.AnhDaiDien || c.anh_dai_dien) : "https://cdn-icons-png.flaticon.com/512/149/149071.png";
    
    let when = "";
    if (c.NgayTao || c.ngay_tao) {
        const date = new Date(c.NgayTao || c.ngay_tao);
        when = date.toLocaleDateString("vi-VN");
    }

    const cId = c.Id || c.BinhLuanId || c.binh_luan_id || c.id;
    const cOwnerId = c.NguoiDungId || c.nguoi_dung_id;
    const canDelete = currentUid && (currentUid == cOwnerId || currentUid == videoOwnerId);

    row.innerHTML = `
        <img src="${avatar}" class="comment-avatar">
        <div class="comment-content" style="flex: 1;">
            <div class="comment-author" style="display: flex; justify-content: space-between;">
                <span>${escapeHtml(who)} <span style="font-weight: normal; color: #606060; font-size: 12px; margin-left: 8px;">${when}</span></span>
                ${canDelete ? `<button onclick="deleteComment(${cId}, event)" style="background: none; border: none; color: #999; cursor: pointer; font-size: 11px;">Xoá</button>` : ''}
            </div>
            <div class="comment-text">${escapeHtml(c.NoiDung || c.noi_dung || "")}</div>
        </div>
    `;
    // Thêm vào đầu danh sách (mới nhất lên trên)
    list.insertBefore(row, list.firstChild);
}

function renderComments(comments, videoOwnerId) {
    const list = document.getElementById("commentList");
    if (!list) return;
    list.innerHTML = "";
    if (!comments?.length) {
        list.innerHTML = "<p style='color: #666; font-size: 14px;'>Chưa có bình luận nào.</p>";
        return;
    }
    
    // Đảo ngược để hiện cái mới lên đầu nếu backend trả về cũ trước
    const sorted = [...comments].sort((a, b) => new Date(b.NgayTao || b.ngay_tao) - new Date(a.NgayTao || a.ngay_tao));

    for (const c of sorted) {
        addSingleCommentToUI(c, videoOwnerId);
    }
}

async function deleteComment(id, event) {
    event.stopPropagation();
    if (!id) return alert("Không tìm thấy ID bình luận");
    if (!confirm("Bạn có chắc muốn xoá bình luận này?")) return;
    const user = loadCurrentUser();
    const uid = user?.nguoi_dung_id || user?.id || user?.ma_nguoi_dung;
    
    if (!uid) return alert("Lỗi: Không xác định được người dùng. Vui lòng đăng nhập lại.");

    try {
        const res = await apiFetch(`/api/comments/${id}`, { method: "DELETE" });
        const data = await parseJsonResponse(res);
        if (data.ok) {
            location.reload(); 
        } else {
            alert("Lỗi từ server: " + (data.error || "Không thể xoá"));
        }
    } catch (e) { alert("Lỗi mạng khi xoá bình luận"); }
}

async function loadRecommendations(categoryId, currentVideoId) {
    const list = document.getElementById("recommendationsList");
    if (!list) return;

    // Hiển thị skeleton cho đề xuất
    list.innerHTML = Array(4).fill(0).map(() => `
        <div class="rec-card">
            <div class="rec-thumb-wrapper skeleton"></div>
            <div class="rec-info">
                <div class="skeleton skeleton-text" style="width: 80%"></div>
                <div class="skeleton skeleton-text" style="width: 50%"></div>
            </div>
        </div>
    `).join('');

    try {
        const res = await apiFetch(`/api/videos?categoryId=${categoryId}`);
        const data = await parseJsonResponse(res);
        if (data.ok && Array.isArray(data.videos)) {
            const filtered = data.videos.filter(v => (v.Id || v.video_id) != currentVideoId);
            list.innerHTML = "";
            
            if (filtered.length === 0) {
                list.innerHTML = "<p style='font-size: 13px; color: #666;'>Không có video liên quan nào khác.</p>";
                return;
            }

            filtered.forEach(v => {
                const card = document.createElement("div");
                card.className = "rec-card";
                const vId = v.Id || v.video_id;
                card.onclick = () => window.location.href = `video.html?id=${vId}`;

                const videoUrl = apiUrl(v.RelativeUrl);
                const views = v.LuotXem || 0;

                card.innerHTML = `
                    <div class="rec-thumb-wrapper">
                        <video src="${videoUrl}#t=0.1" class="rec-thumb" muted playsinline preload="metadata" onmouseover="this.play()" onmouseout="this.pause(); this.currentTime=0.1;"></video>
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

async function downloadVideo() {
    const video = document.getElementById("detailVideo");
    const dlBtn = document.querySelector('button[onclick="downloadVideo()"]');
    if (!video || !video.src) {
        alert("Không tìm thấy tệp video để tải.");
        return;
    }

    const originalText = dlBtn.innerHTML;
    dlBtn.innerHTML = "<span>⏳ Đang tải...</span>";
    dlBtn.disabled = true;

    try {
        const response = await fetch(video.src);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        
        const title = document.getElementById("detailTitle")?.textContent || "video";
        a.download = `${title.replace(/[/\\?%*:|"<>]/g, '-')}.mp4`;
        
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    } catch (e) {
        console.error("Download failed:", e);
        // Fallback: Mở trong tab mới nếu fetch bị lỗi
        const a = document.createElement("a");
        a.href = video.src;
        a.target = "_blank";
        a.download = "";
        a.click();
    } finally {
        dlBtn.innerHTML = originalText;
        dlBtn.disabled = false;
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
                likeBtn.classList.add("liked");
            } else {
                likeBtn.classList.remove("liked");
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
        const subWrap = document.getElementById("subBtnPlaceholder");
        if (subWrap && (!user || user.nguoi_dung_id != creatorId)) {
            subWrap.innerHTML = ""; // Clear old
            const subBtn = document.createElement("button");
            subBtn.className = "action-btn";
            subBtn.style.marginLeft = "15px";
            subBtn.style.padding = "10px 20px";
            subBtn.style.borderRadius = "20px";
            subBtn.style.fontWeight = "bold";
            subBtn.style.border = "none";
            subBtn.style.cursor = "pointer";
            subBtn.style.transition = "all 0.2s";
            subWrap.appendChild(subBtn);

            const updateSubUI = async () => {
                try {
                    const subscriberId = user ? user.nguoi_dung_id : "";
                    const r = await apiFetch(`/api/subscribe/status?subscriberId=${subscriberId}&channelId=${creatorId}`);
                    const d = await parseJsonResponse(r);
                    
                    // Cập nhật số người đăng ký
                    const subCountEl = document.getElementById("subCount");
                    if (subCountEl) {
                        subCountEl.textContent = `${d.count || 0} người đăng ký`;
                    }

                    if (!user) {
                        subBtn.textContent = "Đăng ký";
                        subBtn.style.background = "#0f0f0f";
                        subBtn.style.color = "white";
                        return;
                    }

                    if (d.subscribed) {
                        subBtn.textContent = "Đã đăng ký";
                        subBtn.style.background = "#f2f2f2";
                        subBtn.style.color = "#606060";
                    } else {
                        subBtn.textContent = "Đăng ký";
                        subBtn.style.background = "#0f0f0f";
                        subBtn.style.color = "white";
                    }
                } catch (e) { console.error("UpdateSubUI Error:", e); }
            };
            
            await updateSubUI();

            subBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!user) {
                    window.location.href = "login.html";
                    return;
                }
                subBtn.disabled = true;
                subBtn.style.opacity = "0.5";
                try {
                    const r = await apiFetch("/api/subscribe", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ channelId: creatorId })
                    });
                    const d = await parseJsonResponse(r);
                    if (d.ok) {
                        await updateSubUI();
                    }
                } catch (err) {
                    alert("Lỗi: " + err.message);
                } finally {
                    subBtn.disabled = false;
                    subBtn.style.opacity = "1";
                }
            };
        }

        document.getElementById("recHeader").textContent = `Video liên quan`;

        loadRecommendations(v.DanhMucId, id);
        loadLikeState(id, user);

        // Comments
        const loadComments = async () => {
            const r = await apiFetch(`/api/videos/${id}/comments`);
            const d = await parseJsonResponse(r);
            if (d.ok) renderComments(d.comments, creatorId);
        };
        loadComments();

        document.getElementById("sendCommentBtn").onclick = async () => {
            if (!user) return alert("Bạn cần đăng nhập để bình luận!");
            const txt = document.getElementById("commentInput").value.trim();
            if (!txt) return;
            const r = await apiFetch(`/api/videos/${id}/comments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ noi_dung: txt }),
            });
            const d = await parseJsonResponse(r);
            if (d.ok) {
                document.getElementById("commentInput").value = "";
                // loadComments(); // KHÔNG CẦN TẢI LẠI, Socket sẽ tự push
                if (typeof cancelComment === "function") cancelComment();
            } else {
                alert("Lỗi bình luận: " + (d.error || "Không rõ nguyên nhân"));
                if (r.status === 401 || r.status === 403) {
                    console.warn("Token hết hạn hoặc không hợp lệ, yêu cầu đăng nhập lại.");
                }
            }
        };

        document.getElementById("likeBtn").onclick = async () => {
            if (!user) return alert("Đăng nhập để like!");
            const r = await apiFetch(`/api/videos/${id}/likes/toggle`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
            });
            const d = await parseJsonResponse(r);
            if (d.ok) loadLikeState(id, user);
        };

        // Autoplay Logic
        const videoEl = document.getElementById("detailVideo");
        const autoplayOverlay = document.getElementById("autoplayOverlay");
        const autoplayTimer = document.getElementById("autoplayTimer");
        const cancelAutoplayBtn = document.getElementById("cancelAutoplayBtn");
        const playNowBtn = document.getElementById("playNowBtn");
        let autoplayInterval = null;

        const startAutoplay = () => {
            // Lấy ID video đầu tiên trong danh sách đề xuất
            const firstRec = document.querySelector(".rec-card");
            if (!firstRec) return;

            autoplayOverlay.style.display = "flex";
            let seconds = 5;
            autoplayTimer.textContent = seconds;

            autoplayInterval = setInterval(() => {
                seconds--;
                autoplayTimer.textContent = seconds;
                if (seconds <= 0) {
                    clearInterval(autoplayInterval);
                    firstRec.click(); // Giả lập click để chuyển trang
                }
            }, 1000);
        };

        videoEl.addEventListener("ended", startAutoplay);

        cancelAutoplayBtn.onclick = () => {
            clearInterval(autoplayInterval);
            autoplayOverlay.style.display = "none";
        };

        playNowBtn.onclick = () => {
            const firstRec = document.querySelector(".rec-card");
            if (firstRec) firstRec.click();
        };

        // Ghi lại lịch sử xem
        const recordWatchHistory = async () => {
            if (!user) return;
            const uid = user.nguoi_dung_id || user.id || user.ma_nguoi_dung;
            const vid = Number(id);
            if (!uid || !vid) return;

            console.log(`[History] Recording watch for User:${uid}, Video:${vid}`);
            try {
                const res = await apiFetch("/api/history/watch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ videoId: vid })
                });
                const result = await res.json();
                if (!result.ok) console.warn("[History] Save failed:", result.error);
                else console.log("[History] Watch recorded successfully");
            } catch (err) { console.error("[History] Error:", err); }
        };

        // Ghi nhận lịch sử khi video bắt đầu phát
        videoEl.onplay = () => {
            if (!videoEl.dataset.recorded) {
                videoEl.dataset.recorded = "true";
                recordWatchHistory();
            }
        };

        // --- REAL-TIME LOGIC ---
        if (typeof socket !== 'undefined' && socket) {
            // Tham gia phòng video
            socket.emit("joinVideo", id);

            // Nghe bình luận mới
            socket.on("newComment", (newComment) => {
                if (Number(newComment.VideoId || newComment.video_id) === Number(id)) {
                    addSingleCommentToUI(newComment, creatorId);
                }
            });

            // Nghe cập nhật Like
            socket.on("updateLikes", (data) => {
                if (Number(data.videoId) === Number(id)) {
                    const likeCount = document.getElementById("likeCount");
                    if (likeCount) likeCount.textContent = data.count;
                }
            });

            // Nghe cập nhật View
            socket.on("updateViews", (data) => {
                if (Number(data.videoId) === Number(id)) {
                    const viewCount = document.getElementById("viewCount");
                    if (viewCount) viewCount.textContent = data.count;
                }
            });

            // Rời phòng khi chuyển trang
            window.addEventListener("beforeunload", () => {
                socket.emit("leaveVideo", id);
            });
        }

    } catch (e) {
        setDetailStatus("Lỗi: " + e.message, true);
    }
});
