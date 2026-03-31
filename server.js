const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sql = require("mssql");
const crypto = require("crypto");
const { execFile } = require("child_process");

require("dotenv").config();

const { sqlConfig } = require("./sql.config");

const app = express();

// Sau ngrok, client IP thường nằm trong `x-forwarded-for`.
// bật trust proxy để `req.ip` có ý nghĩa hơn.
app.set("trust proxy", true);

// CORS: GitHub Pages → ngrok cần preflight; không giới hạn allowedHeaders quá hẹp
// (trình duyệt có thể gửi thêm header → nếu thiếu sẽ báo Failed to fetch).
app.use(
  cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS", "HEAD"],
    optionsSuccessStatus: 204,
    maxAge: 86400,
  })
);
app.use(express.json());

const staticDir = __dirname;

// Keep uploaded videos in a top-level uploads/ folder (ignored by Git).
const uploadsDir = path.join(staticDir, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const base = path
      .basename(file.originalname || "video", ext)
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .trim()
      .slice(0, 80);
    const safeBase = base.length ? base : "video";
    cb(null, `${Date.now()}-${Math.random().toString(16).slice(2)}-${safeBase}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB
  fileFilter: (_req, file, cb) => {
    const mime = String(file.mimetype || "");
    const ext = path.extname(file.originalname || "").toLowerCase();
    const okByMime = mime.startsWith("video/");
    const okByExt = [".mp4", ".webm", ".ogg", ".mov", ".mkv", ".avi", ".m4v"].includes(ext);
    // Một số trình duyệt/mobile không gửi mimetype → vẫn cho phép nếu đuôi file là video.
    if (okByMime || okByExt) return cb(null, true);
    return cb(new Error("File không phải video (chọn file .mp4, .webm, ...)."));
  },
});

function hashPassword(raw) {
  return crypto.createHash("sha256").update(String(raw || ""), "utf8").digest("hex");
}

function mapNguoiDungRow(row) {
  return {
    nguoi_dung_id: row?.nguoi_dung_id,
    ten_dang_nhap: row?.ten_dang_nhap,
    email: row?.email,
  };
}

let nguoiXemColumnsCache = null;
async function getNguoiXemColumns(pool) {
  if (nguoiXemColumnsCache) return nguoiXemColumnsCache;
  const result = await pool
    .request()
    .query(`
      SELECT c.name AS column_name
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_xem')
      ORDER BY c.column_id
    `);
  nguoiXemColumnsCache = new Set((result.recordset || []).map((r) => r.column_name));
  return nguoiXemColumnsCache;
}

let nguoiXemMetaCache = null;
async function getNguoiXemMeta(pool) {
  if (nguoiXemMetaCache) return nguoiXemMetaCache;
  const result = await pool
    .request()
    .query(`
      SELECT
        c.name AS column_name,
        TYPE_NAME(c.user_type_id) AS data_type,
        c.max_length
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_xem')
      ORDER BY c.column_id
    `);

  const meta = {};
  for (const row of result.recordset || []) {
    const max_length = Number(row.max_length);
    const type = String(row.data_type || "").toLowerCase();
    let maxChars = Infinity;
    if (Number.isFinite(max_length) && max_length >= 0) {
      // NVARCHAR/NCHAR: max_length tính theo byte
      if (type.includes("nvarchar") || type.includes("nchar")) maxChars = Math.floor(max_length / 2);
      else maxChars = max_length;
    }
    meta[row.column_name] = { maxChars };
  }

  nguoiXemMetaCache = meta;
  return nguoiXemMetaCache;
}

function safeSlice(str, maxChars) {
  const s = String(str ?? "");
  if (!Number.isFinite(maxChars) || maxChars === Infinity) return s;
  if (maxChars <= 0) return "";
  return s.slice(0, maxChars);
}

let ffprobePath = process.env.FFPROBE_PATH || null;
try {
  if (!ffprobePath) {
    // Bundled ffprobe binary (cross-platform) if installed.
    ffprobePath = require("ffprobe-static").path;
  }
} catch {
  // ffprobe-static may be absent; fallback to client duration.
}

function probeVideoDurationSeconds(filePath) {
  return new Promise((resolve) => {
    if (!ffprobePath) return resolve(0);
    execFile(
      ffprobePath,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(0);
        const n = Number.parseFloat(String(stdout || "").trim());
        if (!Number.isFinite(n) || n < 0) return resolve(0);
        return resolve(Math.round(n));
      }
    );
  });
}

function toAbsoluteUploadPath(relativeUrl) {
  const p = String(relativeUrl || "").trim();
  if (!p) return "";
  // "/uploads/abc.mp4" -> "uploads/abc.mp4"
  const cleaned = p.replace(/^[/\\]+/, "");
  return path.join(staticDir, cleaned);
}

async function backfillVideoDurations() {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(
      "SELECT TOP (300) video_id, duong_dan_video, thoi_luong FROM dbo.video WHERE ISNULL(thoi_luong, 0) = 0 ORDER BY video_id DESC"
    );
    const rows = result.recordset || [];
    if (!rows.length) return;

    let updated = 0;
    for (const row of rows) {
      const absPath = toAbsoluteUploadPath(row.duong_dan_video);
      if (!absPath || !fs.existsSync(absPath)) continue;
      const dur = await probeVideoDurationSeconds(absPath);
      if (!Number.isFinite(dur) || dur <= 0) continue;

      await pool
        .request()
        .input("Id", sql.Int, Number(row.video_id))
        .input("Duration", sql.Int, Math.trunc(dur))
        .query("UPDATE dbo.video SET thoi_luong = @Duration WHERE video_id = @Id");
      updated += 1;
    }

    // eslint-disable-next-line no-console
    console.log(`[duration] backfill done: updated ${updated}/${rows.length} rows with thoi_luong.`);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[duration] backfill failed:", e?.message || e);
  }
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const tenDangNhap = String(req.body?.ten_dang_nhap || "").trim().slice(0, 255);
    const email = String(req.body?.email || "").trim().slice(0, 255);
    const password = String(req.body?.password || "");

    if (!tenDangNhap || !email || !password) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu dữ liệu. Cần ten_dang_nhap, email, password.",
      });
    }

    const pool = await sql.connect(sqlConfig);
    const inserted = await pool
      .request()
      .input("TenDangNhap", sql.NVarChar(255), tenDangNhap)
      .input("Email", sql.NVarChar(255), email)
      .input("MatKhauHash", sql.NVarChar(255), hashPassword(password))
      .query(
        "INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat) " +
          "OUTPUT INSERTED.nguoi_dung_id, INSERTED.ten_dang_nhap, INSERTED.email " +
          "VALUES (@TenDangNhap, @Email, @MatKhauHash, NULL, GETDATE(), GETDATE())"
      );

    return res.json({ ok: true, user: mapNguoiDungRow(inserted.recordset?.[0] || null) });
  } catch (err) {
    if (err?.number === 2627 || err?.number === 2601) {
      return res.status(409).json({
        ok: false,
        error: "Tên đăng nhập hoặc email đã tồn tại.",
      });
    }
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const login = String(req.body?.login || "").trim().slice(0, 255);
    const password = String(req.body?.password || "");
    if (!login || !password) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu dữ liệu. Cần login (tên đăng nhập hoặc email) và password.",
      });
    }

    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("Login", sql.NVarChar(255), login)
      .query(
        "SELECT TOP (1) nguoi_dung_id, ten_dang_nhap, email, mat_khau_hash " +
          "FROM dbo.nguoi_dung " +
          "WHERE ten_dang_nhap = @Login OR email = @Login"
      );

    const user = result.recordset?.[0];
    if (!user) return res.status(401).json({ ok: false, error: "Sai tài khoản hoặc mật khẩu." });

    const incomingHash = hashPassword(password);
    if (String(user.mat_khau_hash || "") !== incomingHash) {
      return res.status(401).json({ ok: false, error: "Sai tài khoản hoặc mật khẩu." });
    }

    return res.json({ ok: true, user: mapNguoiDungRow(user) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos", async (_req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .query(
        // DB VIDEO1 — bảng dbo.video
        "SELECT TOP (100) video_id AS Id, tieu_de AS Title, duong_dan_video AS RelativeUrl, ngay_tao AS UploadedAt FROM dbo.video ORDER BY video_id DESC"
      );
    res.json({ ok: true, videos: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);

    // Ghi nhận người xem (dbo.nguoi_xem) khi mở trang chi tiết.
    // Logic upsert theo: dia_chi_ip + thiet_bi (nếu 2 cột này tồn tại).
    try {
      const cols = await getNguoiXemColumns(pool);
      const meta = await getNguoiXemMeta(pool);

      const xff = String(req.headers["x-forwarded-for"] || "");
      // x-forwarded-for có thể dạng "client, proxy1, proxy2"
      const ip = (xff.split(",")[0] || req.ip || "").trim();
      const thietBiRaw = String(req.headers["user-agent"] || "");

      const viewerHash = crypto
        .createHash("sha256")
        .update(`${ip}|${thietBiRaw}`)
        .digest("hex")
        .slice(0, 12);
      const ipSafe = ip || "0.0.0.0";
      const tenNguoiXemDefault = `viewer_${viewerHash}`;

      // Nếu dbo.nguoi_xem có cột nguoi_dung_id NOT NULL, ta phải điền giá trị.
      // Ưu tiên lấy nguoi_dung_id từ query (nếu frontend gửi), sau đó mới fallback env/first user.
      const nguoiDungIdFromReq = Number(req.query?.nguoi_dung_id);
      const defaultEnvId = Number(process.env.DEFAULT_NGUOI_DUNG_ID);
      let viewerNguoiDungId = NaN;
      let tenNguoiXem = tenNguoiXemDefault;

      if (cols.has("nguoi_dung_id")) {
        const candidates = [nguoiDungIdFromReq, defaultEnvId].filter(
          (x) => Number.isFinite(x) && x > 0
        );

        for (const cand of candidates) {
          const ok = await pool
            .request()
            .input("Uid", sql.Int, Math.trunc(cand))
            .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
          if (ok.recordset?.length) {
            viewerNguoiDungId = cand;
            break;
          }
        }

        if (!Number.isFinite(viewerNguoiDungId) || viewerNguoiDungId <= 0) {
          const first = await pool
            .request()
            .query("SELECT TOP (1) nguoi_dung_id FROM dbo.nguoi_dung ORDER BY nguoi_dung_id");
          const raw = first.recordset?.[0]?.nguoi_dung_id;
          if (raw != null) viewerNguoiDungId = Number(raw);
        }

        if (Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0 && cols.has("ten_nguoi_xem")) {
          const name = await pool
            .request()
            .input("Uid", sql.Int, Math.trunc(viewerNguoiDungId))
            .query("SELECT TOP (1) ten_dang_nhap FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
          const ten = name.recordset?.[0]?.ten_dang_nhap;
          tenNguoiXem =
            ten != null ? String(ten).trim().slice(0, 255) : tenNguoiXemDefault;
        }
      }

      const hasDiaChiIp = cols.has("dia_chi_ip");
      const hasThietBi = cols.has("thiet_bi");
      const hasNguoiDungIdCol = cols.has("nguoi_dung_id");
      const hasTenNguoiXemCol = cols.has("ten_nguoi_xem");
      const hasLuotXemCol = cols.has("luot_xem");

      // Nếu schema không có đủ cột để định danh, chỉ bỏ qua ghi nhận.
      if (hasDiaChiIp && hasThietBi) {
        const ipMax = meta?.dia_chi_ip?.maxChars ?? Infinity;
        const tbMax = meta?.thiet_bi?.maxChars ?? Infinity;
        const nameMax = meta?.ten_nguoi_xem?.maxChars ?? Infinity;

        const ipClamped = safeSlice(ipSafe, ipMax);
        const thietBi = safeSlice(thietBiRaw, tbMax);
        tenNguoiXem = safeSlice(tenNguoiXem, nameMax);

        const existing = await pool
          .request()
          .input("Ip", sql.NVarChar(255), ipClamped)
          .input("Tb", sql.NVarChar(500), thietBi)
          .query(
            "SELECT TOP (1) nguoi_xem_id AS Id FROM dbo.nguoi_xem WHERE dia_chi_ip = @Ip AND thiet_bi = @Tb"
          );

        const existedRow = existing.recordset?.[0];
        if (existedRow?.Id) {
          // cập nhật mốc thời gian nếu schema có sẵn
          if (cols.has("ngay_truy_cap")) {
            await pool
              .request()
              .input("Id", sql.Int, existedRow.Id)
              .query(
                `UPDATE dbo.nguoi_xem SET ngay_truy_cap = GETDATE()${
                  hasLuotXemCol ? ", luot_xem = ISNULL(luot_xem, 0) + 1" : ""
                } WHERE nguoi_xem_id = @Id`
              );
          } else if (cols.has("ngay_cap_nhat")) {
            await pool
              .request()
              .input("Id", sql.Int, existedRow.Id)
              .query(
                `UPDATE dbo.nguoi_xem SET ngay_cap_nhat = GETDATE()${
                  hasLuotXemCol ? ", luot_xem = ISNULL(luot_xem, 0) + 1" : ""
                } WHERE nguoi_xem_id = @Id`
              );
          }
        } else {
          // Nếu bảng nguoi_xem có UNIQUE theo nguoi_dung_id,
          // thì có thể đã tồn tại 1 dòng cho user đó (dù ip/thiet_bi khác).
          // Khi đó cần UPDATE theo nguoi_dung_id thay vì INSERT.
          if (hasNguoiDungIdCol && Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0) {
            const existingByUser = await pool
              .request()
              .input("Uid", sql.Int, Math.trunc(viewerNguoiDungId))
              .query("SELECT TOP (1) nguoi_xem_id AS Id FROM dbo.nguoi_xem WHERE nguoi_dung_id = @Uid");

            const existedByUser = existingByUser.recordset?.[0];
            if (existedByUser?.Id) {
              const setParts = [];
              if (cols.has("ten_nguoi_xem")) setParts.push("ten_nguoi_xem = @TenNguoiXem");
              if (cols.has("dia_chi_ip")) setParts.push("dia_chi_ip = @Ip");
              if (cols.has("thiet_bi")) setParts.push("thiet_bi = @Tb");
              if (cols.has("ngay_truy_cap")) setParts.push("ngay_truy_cap = GETDATE()");
              else if (cols.has("ngay_cap_nhat")) setParts.push("ngay_cap_nhat = GETDATE()");
              if (hasLuotXemCol) setParts.push("luot_xem = ISNULL(luot_xem, 0) + 1");

              if (setParts.length) {
                const uReq = pool.request().input("Id", sql.Int, existedByUser.Id).input("TenNguoiXem", sql.NVarChar(255), tenNguoiXem).input("Ip", sql.NVarChar(255), ipClamped).input("Tb", sql.NVarChar(500), thietBi);
                await uReq.query(`UPDATE dbo.nguoi_xem SET ${setParts.join(", ")} WHERE nguoi_xem_id = @Id`);
              }
              return; // đã update theo nguoi_dung_id
            }
          }

          // build insert theo cột tồn tại để tránh lỗi do schema khác
          const insertCols = [];
          const insertVals = [];
          const reqSql = pool.request();

          if (cols.has("ten_nguoi_xem")) {
            insertCols.push("ten_nguoi_xem");
            insertVals.push("@TenNguoiXem");
            reqSql.input("TenNguoiXem", sql.NVarChar(255), tenNguoiXem);
          }
          if (cols.has("dia_chi_ip")) {
            insertCols.push("dia_chi_ip");
            insertVals.push("@Ip");
            reqSql.input("Ip", sql.NVarChar(255), ipClamped);
          }
          if (cols.has("thiet_bi")) {
            insertCols.push("thiet_bi");
            insertVals.push("@Tb");
            reqSql.input("Tb", sql.NVarChar(500), thietBi);
          }
          if (cols.has("nguoi_dung_id") && Number.isFinite(viewerNguoiDungId) && viewerNguoiDungId > 0) {
            insertCols.push("nguoi_dung_id");
            insertVals.push("@NguoiDungId");
            reqSql.input("NguoiDungId", sql.Int, Math.trunc(viewerNguoiDungId));
          }
          if (hasLuotXemCol) {
            insertCols.push("luot_xem");
            insertVals.push("1");
          }

          if (hasNguoiDungIdCol && (!Number.isFinite(viewerNguoiDungId) || viewerNguoiDungId <= 0)) {
            console.warn("[viewer] nguoi_xem has nguoi_dung_id but viewerNguoiDungId not set", {
              nguoi_dung_id: viewerNguoiDungId,
              ipClamped,
              thietBiLen: String(thietBi || "").length,
            });
          }
          if (cols.has("ngay_tao")) {
            insertCols.push("ngay_tao");
            insertVals.push("GETDATE()");
          }
          if (cols.has("ngay_truy_cap")) {
            insertCols.push("ngay_truy_cap");
            insertVals.push("GETDATE()");
          }
          if (cols.has("ngay_cap_nhat")) {
            insertCols.push("ngay_cap_nhat");
            insertVals.push("GETDATE()");
          }

          if (insertCols.length >= 2) {
            await reqSql
              .query(
                `INSERT INTO dbo.nguoi_xem (${insertCols.join(",")}) VALUES (${insertVals.join(
                  ","
                )})`
              );
          }

          if (insertCols.length < 2) {
            console.warn("[viewer] skip insert because insertCols empty", {
              hasTenNguoiXemCol,
              hasNguoiDungIdCol,
              insertCols,
            });
          }
        }
      }
      else {
        console.warn("[viewer] missing dia_chi_ip/thiet_bi columns, skip upsert", {
          hasDiaChiIp,
          hasThietBi,
          columns: Array.from(cols || []),
        });
      }
    } catch (e) {
      // Không làm hỏng luồng xem video nếu insert nguoi_xem lỗi
      // (nhưng vẫn log để bạn biết vì sao không có dữ liệu).
      console.warn("[viewer]", {
        message: e?.message || String(e),
      });
    }

    const result = await pool
      .request()
      .input("Id", sql.Int, Math.trunc(id))
      .query(
        // Mỗi lần mở trang chi tiết => tăng lượt xem +1
        "UPDATE dbo.video SET luot_xem = luot_xem + 1 " +
          "OUTPUT INSERTED.video_id AS Id, " +
          "INSERTED.tieu_de AS Title, " +
          "INSERTED.mo_ta AS Description, " +
          "INSERTED.duong_dan_video AS RelativeUrl, " +
          "INSERTED.luot_xem AS LuotXem, " +
          "INSERTED.ngay_tao AS UploadedAt " +
          "WHERE video_id = @Id"
      );
    const row = result.recordset?.[0];
    if (!row) return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    res.json({ ok: true, video: row });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.get("/api/videos/:id/comments", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const pool = await sql.connect(sqlConfig);
    const result = await pool
      .request()
      .input("VideoId", sql.Int, Math.trunc(id))
      .query(
        "SELECT b.binh_luan_id AS Id, b.video_id AS VideoId, b.nguoi_dung_id AS NguoiDungId, " +
          "b.noi_dung AS NoiDung, b.ngay_tao AS NgayTao, n.ten_dang_nhap AS TenDangNhap " +
          "FROM dbo.binh_luan b " +
          "LEFT JOIN dbo.nguoi_dung n ON n.nguoi_dung_id = b.nguoi_dung_id " +
          "WHERE b.video_id = @VideoId " +
          "ORDER BY b.ngay_tao DESC"
      );
    res.json({ ok: true, comments: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/videos/:id/comments", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    const noiDung = String(req.body?.noi_dung ?? "").trim().slice(0, 1000);
    if (!noiDung) {
      return res.status(400).json({ ok: false, error: "Nội dung bình luận không được để trống." });
    }
    const bodyUserId = Number(req.body?.nguoi_dung_id);
    if (!Number.isFinite(bodyUserId) || bodyUserId <= 0) {
      return res.status(401).json({ ok: false, error: "Cần đăng nhập để bình luận (thiếu nguoi_dung_id)." });
    }

    const pool = await sql.connect(sqlConfig);
    const exists = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT 1 AS ok FROM dbo.video WHERE video_id = @Vid");
    if (!exists.recordset?.length) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    }

    const userOk = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(bodyUserId))
      .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    if (!userOk.recordset?.length) {
      return res.status(400).json({ ok: false, error: "Người dùng không tồn tại." });
    }

    const inserted = await pool
      .request()
      .input("VideoId", sql.Int, Math.trunc(videoId))
      .input("NguoiDungId", sql.Int, Math.trunc(bodyUserId))
      .input("NoiDung", sql.NVarChar(1000), noiDung)
      .query(
        "INSERT INTO dbo.binh_luan (video_id, nguoi_dung_id, noi_dung, ngay_tao) " +
          "OUTPUT INSERTED.binh_luan_id AS Id, INSERTED.video_id AS VideoId, INSERTED.nguoi_dung_id AS NguoiDungId, " +
          "INSERTED.noi_dung AS NoiDung, INSERTED.ngay_tao AS NgayTao " +
          "VALUES (@VideoId, @NguoiDungId, @NoiDung, GETDATE())"
      );

    const row = inserted.recordset?.[0];
    const name = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(bodyUserId))
      .query("SELECT ten_dang_nhap AS TenDangNhap FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    const ten = name.recordset?.[0]?.TenDangNhap ?? null;

    res.json({
      ok: true,
      comment: row ? { ...row, TenDangNhap: ten } : null,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Like / Unlike video
// GET  /api/videos/:id/likes?nguoi_dung_id=...
// POST /api/videos/:id/likes/toggle  { nguoi_dung_id: number }
app.get("/api/videos/:id/likes", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    const userId = Number(req.query?.nguoi_dung_id);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }

    const pool = await sql.connect(sqlConfig);

    const cnt = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT COUNT(*) AS n FROM dbo.luot_thich WHERE video_id = @Vid");

    let liked = false;
    if (Number.isFinite(userId) && userId > 0) {
      const r = await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query(
          "SELECT 1 AS ok FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid"
        );
      liked = !!r.recordset?.length;
    }

    res.json({
      ok: true,
      count: Number(cnt.recordset?.[0]?.n ?? 0),
      liked,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

app.post("/api/videos/:id/likes/toggle", async (req, res) => {
  try {
    const videoId = Number(req.params.id);
    const userId = Number(req.body?.nguoi_dung_id);

    if (!Number.isFinite(videoId) || videoId <= 0) {
      return res.status(400).json({ ok: false, error: "ID video không hợp lệ." });
    }
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ ok: false, error: "Cần đăng nhập để thích video." });
    }

    const pool = await sql.connect(sqlConfig);

    const vExists = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT 1 AS ok FROM dbo.video WHERE video_id = @Vid");
    if (!vExists.recordset?.length) {
      return res.status(404).json({ ok: false, error: "Không tìm thấy video." });
    }

    const uExists = await pool
      .request()
      .input("Uid", sql.Int, Math.trunc(userId))
      .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @Uid");
    if (!uExists.recordset?.length) {
      return res.status(400).json({ ok: false, error: "Người dùng không tồn tại." });
    }

    const existing = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .input("Uid", sql.Int, Math.trunc(userId))
      .query("SELECT 1 AS ok FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid");

    let liked;
    if (existing.recordset?.length) {
      await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query("DELETE FROM dbo.luot_thich WHERE video_id = @Vid AND nguoi_dung_id = @Uid");
      liked = false;
    } else {
      await pool
        .request()
        .input("Vid", sql.Int, Math.trunc(videoId))
        .input("Uid", sql.Int, Math.trunc(userId))
        .query("INSERT INTO dbo.luot_thich (video_id, nguoi_dung_id) VALUES (@Vid, @Uid)");
      liked = true;
    }

    const cnt = await pool
      .request()
      .input("Vid", sql.Int, Math.trunc(videoId))
      .query("SELECT COUNT(*) AS n FROM dbo.luot_thich WHERE video_id = @Vid");

    res.json({ ok: true, liked, count: Number(cnt.recordset?.[0]?.n ?? 0) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Quick diagnostics: confirms which DB settings server is using (no password leaked)
app.get("/api/diag", (_req, res) => {
  res.json({
    ok: true,
    port: process.env.PORT ? Number(process.env.PORT) : 3000,
    db: {
      server: sqlConfig.server,
      port: sqlConfig.port ?? null,
      database: sqlConfig.database,
      user: sqlConfig.user,
      passwordProvided: Boolean(sqlConfig.password && String(sqlConfig.password).length),
      encrypt: Boolean(sqlConfig?.options?.encrypt),
      instanceName: sqlConfig?.options?.instanceName ?? null,
    },
  });
});

// Xem cột thật của dbo.nguoi_dung (để viết INSERT đúng trong SSMS khi seed tự động thất bại)
async function nguoiDungColumnsHandler(_req, res) {
  try {
    const pool = await sql.connect(sqlConfig);
    const result = await pool.request().query(`
      SELECT
        c.name AS column_name,
        TYPE_NAME(c.user_type_id) AS data_type,
        c.is_nullable,
        c.is_identity
      FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'dbo.nguoi_dung')
      ORDER BY c.column_id
    `);
    res.json({ ok: true, columns: result.recordset || [] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
}
app.get("/api/db/nguoi-dung-columns", nguoiDungColumnsHandler);
app.get("/api/nguoi-dung-columns", nguoiDungColumnsHandler);

app.post("/api/videos", upload.single("video"), async (req, res) => {
  try {
    // tieu_de thường NOT NULL trong dbo.video — luôn gửi chuỗi (có thể rỗng).
    const title =
      typeof req.body?.title === "string"
        ? req.body.title.trim().slice(0, 255)
        : req.body?.title != null
          ? String(req.body.title).trim().slice(0, 255)
          : "";
    const descriptionSource = req.body?.mo_ta ?? req.body?.description ?? req.body?.title ?? "";
    const descriptionRaw =
      typeof descriptionSource === "string"
        ? descriptionSource.trim()
        : descriptionSource != null
          ? String(descriptionSource).trim()
          : "";
    const description = descriptionRaw.slice(0, 4000);
    const rawDuration = Number(req.body?.thoi_luong);
    const clientDuration =
      Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.trunc(rawDuration) : 0;
    if (!req.file) return res.status(400).json({ ok: false, error: "Thiếu file video." });

    const relativeUrl = `/uploads/${req.file.filename}`; // đường dẫn file thật trên server
    const absoluteFilePath = path.join(uploadsDir, req.file.filename);
    const probedDuration = await probeVideoDurationSeconds(absoluteFilePath);
    const durationSeconds = probedDuration > 0 ? probedDuration : clientDuration;

    const pool = await sql.connect(sqlConfig);

    // fk_video_nguoi_dung: nguoi_dung_id phải tồn tại trong dbo.nguoi_dung
    const firstUser = await pool.request().query(
      "SELECT TOP (1) nguoi_dung_id FROM dbo.nguoi_dung ORDER BY nguoi_dung_id"
    );
    const row0 = firstUser.recordset?.[0];
    const rawFallback = row0?.nguoi_dung_id ?? row0?.NGUOI_DUNG_ID ?? row0?.id;
    const fallbackId = rawFallback != null ? Number(rawFallback) : NaN;
    if (!Number.isFinite(fallbackId)) {
      return res.status(500).json({
        ok: false,
        error:
          "Chưa có người dùng trong dbo.nguoi_dung. Thêm ít nhất 1 dòng vào bảng nguoi_dung trước khi đăng video.",
      });
    }

    const bodyNguoiDungId = Number(req.body?.nguoi_dung_id);
    const wantId = Number.isFinite(bodyNguoiDungId) && bodyNguoiDungId > 0
      ? bodyNguoiDungId
      : Number(process.env.DEFAULT_NGUOI_DUNG_ID);
    let ownerId = fallbackId;
    if (Number.isFinite(wantId) && wantId > 0) {
      const exists = await pool
        .request()
        .input("CheckId", sql.Int, wantId)
        .query("SELECT 1 AS ok FROM dbo.nguoi_dung WHERE nguoi_dung_id = @CheckId");
      if (exists.recordset?.length) ownerId = wantId;
    }

    const insert = await pool
      .request()
      .input("NguoiDungId", sql.Int, Math.trunc(ownerId))
      .input("Title", sql.NVarChar(255), title)
      .input("Description", sql.NVarChar(sql.MAX), description)
      .input("Duration", sql.Int, durationSeconds)
      .input("Path", sql.NVarChar(500), relativeUrl)
      .query(
        // Khớp Design VIDEO1.dbo.video: mo_ta/danh_muc_id/tag_id nullable; luot_xem bigint NOT NULL
        "INSERT INTO dbo.video (nguoi_dung_id, tieu_de, mo_ta, duong_dan_video, duong_dan_anh_bia, thoi_luong, luot_xem, ngay_tao, ngay_cap_nhat, danh_muc_id, tag_id) " +
          "OUTPUT INSERTED.video_id AS Id, INSERTED.tieu_de AS Title, INSERTED.duong_dan_video AS RelativeUrl, INSERTED.ngay_tao AS UploadedAt " +
          "VALUES (@NguoiDungId, @Title, COALESCE(NULLIF(@Description, N''), @Title), @Path, @Path, @Duration, CAST(0 AS BIGINT), GETDATE(), GETDATE(), NULL, NULL)"
      );

    // Một số schema/trigger cũ có thể làm mo_ta về NULL khi INSERT.
    // Cập nhật lại chắc chắn ngay sau khi tạo video.
    const newId = Number(insert.recordset?.[0]?.Id);
    if (Number.isFinite(newId) && newId > 0 && description.length > 0) {
      await pool
        .request()
        .input("Id", sql.Int, Math.trunc(newId))
        .input("Description", sql.NVarChar(sql.MAX), description)
        .query(
          "UPDATE dbo.video SET mo_ta = COALESCE(NULLIF(@Description, N''), tieu_de) WHERE video_id = @Id"
        );
    } else if (Number.isFinite(newId) && newId > 0) {
      await pool
        .request()
        .input("Id", sql.Int, Math.trunc(newId))
        .query("UPDATE dbo.video SET mo_ta = COALESCE(NULLIF(mo_ta, N''), tieu_de) WHERE video_id = @Id");
    }

    res.json({ ok: true, video: insert.recordset[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});

// Ensure API errors always respond with JSON (helps the client parse errors reliably)
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
  next(err);
});

// Static + trang chủ đặt SAU các route /api để không bị che bởi file tĩnh
app.use(express.static(staticDir));
app.get("/", (_req, res) => {
  res.sendFile(path.join(staticDir, "INDEX.HTML"));
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;

/** Nếu dbo.nguoi_dung trống, INSERT video sẽ lỗi FK — thử thêm 1 user demo (vài kiểu cột phổ biến). */
async function ensureDemoNguoiDung() {
  try {
    const pool = await sql.connect(sqlConfig);
    const cnt = await pool.request().query(`SELECT COUNT(*) AS n FROM dbo.nguoi_dung`);
    const n = Number(cnt.recordset?.[0]?.n ?? 0);
    if (Number.isFinite(n) && n > 0) return;

    const attempts = [
      // VIDEO1: mat_khau_hash + ngay_tao + ngay_cap_nhat (bắt buộc)
      `INSERT INTO dbo.nguoi_dung (ten_dang_nhap, email, mat_khau_hash, anh_dai_dien, ngay_tao, ngay_cap_nhat) VALUES (N'demo_upload', N'demo@local.test', N'demo_sha256_placeholder', NULL, GETDATE(), GETDATE())`,
      `INSERT INTO dbo.nguoi_dung (ten_dang_nhap, mat_khau, ho_ten, email) VALUES (N'demo_upload', N'1', N'Demo', N'demo@local.test')`,
      `INSERT INTO dbo.nguoi_dung (tai_khoan, mat_khau, ho_ten) VALUES (N'demo_upload', N'1', N'Demo')`,
    ];

    for (const q of attempts) {
      try {
        await pool.request().query(q);
        // eslint-disable-next-line no-console
        console.log("[seed] Đã thêm user demo vào dbo.nguoi_dung (upload video sẽ hết lỗi FK).");
        return;
      } catch {
        /* thử câu khác */
      }
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[seed] Không tự thêm được user — mở SSMS, chạy script trong file database.sql (sửa tên cột theo Design dbo.nguoi_dung)."
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[seed]", e?.message || e);
  }
}

(async () => {
  await ensureDemoNguoiDung();
  await backfillVideoDurations();
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${port}`);
});
})();

