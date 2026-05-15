const sql = require("mssql");
require("dotenv").config();
const { sqlConfig } = require("./sql.config");

async function fixDatabase() {
  try {
    console.log("Connecting to database...");
    console.log("Config:", { ...sqlConfig, password: "***" });
    const pool = await sql.connect(sqlConfig);
    console.log("Connected successfully!");

    const statements = [
      `USE VIDEO1;`,
      // 1. UNIQUE constraint
      `IF NOT EXISTS (SELECT * FROM sys.objects WHERE name = 'UQ_tai_khoan_admin_username' AND type = 'UQ')
       AND NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_tai_khoan_admin_username')
       BEGIN
          ALTER TABLE dbo.tai_khoan_admin ADD CONSTRAINT UQ_tai_khoan_admin_username UNIQUE (username);
       END`,
      // 2. FK Admin
      `IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_kiem_duyet_admin')
       BEGIN
          ALTER TABLE dbo.kiem_duyet_video ADD CONSTRAINT FK_kiem_duyet_admin 
          FOREIGN KEY (admin_username) REFERENCES dbo.tai_khoan_admin(username);
       END`,
      // 3. FK Video
      `IF NOT EXISTS (SELECT * FROM sys.foreign_keys WHERE name = 'FK_kiem_duyet_video')
       BEGIN
          ALTER TABLE dbo.kiem_duyet_video ADD CONSTRAINT FK_kiem_duyet_video 
          FOREIGN KEY (video_id) REFERENCES dbo.video(video_id) ON DELETE CASCADE;
       END`
    ];

    for (let stmt of statements) {
      try {
        console.log(`Executing: ${stmt.split('\n')[0]}...`);
        await pool.request().query(stmt);
      } catch (err) {
        console.error(`Statement failed: ${err.message}`);
      }
    }

    console.log("Database relationship check finished.");
    process.exit(0);
  } catch (err) {
    console.error("Error fixing database:", err.message);
    process.exit(1);
  }
}

fixDatabase();
