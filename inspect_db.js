const sql = require("mssql");
require("dotenv").config();
const { sqlConfig } = require("./sql.config");

async function inspectDb() {
  try {
    const pool = await sql.connect(sqlConfig);
    const tables = ['video', 'kiem_duyet_video', 'tai_khoan_admin'];
    
    for (let table of tables) {
      console.log(`--- Columns for ${table} ---`);
      const res = await pool.request().query(`
        USE VIDEO1;
        SELECT c.name, TYPE_NAME(c.user_type_id) as type, c.is_nullable
        FROM sys.columns c
        WHERE c.object_id = OBJECT_ID('dbo.${table}')
      `);
      console.table(res.recordset);

      console.log(`--- Keys/Indexes for ${table} ---`);
      const res2 = await pool.request().query(`
        USE VIDEO1;
        SELECT i.name, i.is_primary_key, i.is_unique_constraint, i.type_desc
        FROM sys.indexes i
        WHERE i.object_id = OBJECT_ID('dbo.${table}')
      `);
      console.table(res2.recordset);
      console.log(`--- Foreign Keys for ${table} ---`);
      const res3 = await pool.request().query(`
        USE VIDEO1;
        SELECT name, OBJECT_NAME(parent_object_id) as parent_table, OBJECT_NAME(referenced_object_id) as referenced_table
        FROM sys.foreign_keys
        WHERE parent_object_id = OBJECT_ID('dbo.${table}')
      `);
      console.table(res3.recordset);
    }
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
inspectDb();
