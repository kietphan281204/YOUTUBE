const sql = require('mssql');
require('dotenv').config();
const { sqlConfig } = require('./sql.config');

async function run() {
    try {
        let pool = await sql.connect(sqlConfig);
        let result = await pool.query(`
            SELECT 
                fk.name AS FK_Name, 
                tp.name AS Parent_Table, 
                tr.name AS Ref_Table 
            FROM sys.foreign_keys fk 
            INNER JOIN sys.tables tp ON fk.parent_object_id = tp.object_id 
            INNER JOIN sys.tables tr ON fk.referenced_object_id = tr.object_id 
            WHERE tr.name IN ('the_tag', 'binh_luan') OR tp.name IN ('the_tag', 'binh_luan')
        `);
        console.table(result.recordset);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
run();
