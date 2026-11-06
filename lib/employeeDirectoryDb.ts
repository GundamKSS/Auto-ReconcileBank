import sql from 'mssql';
import type { DirectoryEmployee } from './employeeDirectory';
import { employeeSearchPattern } from './employeeDirectory';

// Explicit projection: never read passwords, central roles or contact details.
const projection = `LTRIM(RTRIM([No])) AS employeeCode,
  LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(First_Name)), N' ', LTRIM(RTRIM(Last_Name))))) AS employeeName,
  COALESCE(Job_Title, N'') AS jobTitle`;

export async function searchEmployees(pool: sql.ConnectionPool, query: string, exact = false) {
  const result = await pool.request().input('query', sql.NVarChar(100), query)
    .input('pattern', sql.NVarChar(202), employeeSearchPattern(query)).query<DirectoryEmployee>(`
      SELECT TOP (21) ${projection} FROM [DATA_CENTER].[dbo].[Employee]
      WHERE ${exact ? '[No] = @query' : `([No] LIKE @pattern ESCAPE N'~'
        OR LTRIM(RTRIM(CONCAT(LTRIM(RTRIM(First_Name)), N' ', LTRIM(RTRIM(Last_Name))))) LIKE @pattern ESCAPE N'~')`}
      ORDER BY CASE WHEN [No]=@query THEN 0 ELSE 1 END, [No]
    `);
  return { employees: result.recordset.slice(0, 20), truncated: result.recordset.length > 20 };
}

export async function employeeNames(pool: sql.ConnectionPool, codes: string[]) {
  const unique = [...new Set(codes)];
  if (!unique.length) return new Map<string, string>();
  const request = pool.request();
  unique.forEach((code, index) => request.input(`emp${index}`, sql.NVarChar(50), code));
  const result = await request.query<DirectoryEmployee>(`SELECT ${projection}
    FROM [DATA_CENTER].[dbo].[Employee] WHERE [No] IN (${unique.map((_, index) => `@emp${index}`).join(',')})`);
  return new Map(result.recordset.map((row) => [row.employeeCode.trim().toUpperCase(), row.employeeName]));
}
