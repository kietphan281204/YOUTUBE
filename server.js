const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sql = require("mssql");

require("dotenv").config();

const { sqlConfig } = require("./sql.config");

const app = express();

app.use(cors());
app.use(express.json());

// Serve the current "Đăng Video" page as-is
// (the HTML/CSS/JS live at the project root now)
const staticDir = __dirname;
app.use(express.static(staticDir));

// Because the file is named `INDEX.HTML` (uppercase),
// explicitly serve it at the root route.
app.get("/", (_req, res) => {
  res.sendFile(path.join(staticDir, "INDEX.HTML"));
});

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
    if (!file.mimetype?.startsWith("video/")) return cb(new Error("File không phải video."));
    cb(null, true);
  },
});

async function ensureTable(pool) {
  await pool.request().query(`
IF OBJECT_ID(N'dbo.Video', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.Video (
    Id INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(255) NULL,
    FileName NVARCHAR(255) NOT NULL,
    RelativeUrl NVARCHAR(500) NOT NULL,
    UploadedAt DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END
`);
}

app.get("/api/videos", async (_req, res) => {
  try {
    const pool = await sql.connect(sqlConfig);
    await ensureTable(pool);
    const result = await pool
      .request()
      .query("SELECT TOP (100) Id, Title, FileName, RelativeUrl, UploadedAt FROM dbo.Video ORDER BY Id DESC");
    res.json({ ok: true, videos: result.recordset });
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

app.post("/api/videos", upload.single("video"), async (req, res) => {
  try {
    const title = typeof req.body?.title === "string" ? req.body.title.trim().slice(0, 255) : null;
    if (!req.file) return res.status(400).json({ ok: false, error: "Thiếu file video." });

    const relativeUrl = `/uploads/${req.file.filename}`;

    const pool = await sql.connect(sqlConfig);
    await ensureTable(pool);

    const insert = await pool
      .request()
      .input("Title", sql.NVarChar(255), title)
      .input("FileName", sql.NVarChar(255), req.file.originalname)
      .input("RelativeUrl", sql.NVarChar(500), relativeUrl)
      .query(
        "INSERT INTO dbo.Video (Title, FileName, RelativeUrl) OUTPUT INSERTED.Id, INSERTED.Title, INSERTED.FileName, INSERTED.RelativeUrl, INSERTED.UploadedAt VALUES (@Title, @FileName, @RelativeUrl)"
      );

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

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${port}`);
});

