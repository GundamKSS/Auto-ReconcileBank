import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';
import sql from 'mssql';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'กรุณากรอก username และ password' }, { status: 400 });
    }
    console.log('Received login request for username:', username);
    console.log('Password:', password);

    const pool = await getPool();
    const userResult = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .query('SELECT TOP 1 No, PasswordHash FROM Employee WHERE No = @username');

    const user = userResult.recordset[0];

    console.log('User result:', user);

    // return false;
    if (!user) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้งาน' }, { status: 401 });
    }
    console.log('PasswordH:', password);
    console.log('User password hash:', user.PasswordHash);
    const isValid = await bcrypt.compare(password, user.PasswordHash);
    console.log('Password valid:', isValid);
    if (!isValid) {
      return NextResponse.json({ error: 'รหัสผ่านไม่ถูกต้อง' }, { status: 401 });
    }

const empResult = await pool
  .request()
  .input('empNo', sql.NVarChar, user.No)
  .query(`
    SELECT
      [No],
      [First_Name],
      [Last_Name],
      [E_Mail],
      [Mobile_Phone_No],
      [Job_Title],
      [Role]
    FROM [DATA_CENTER].[dbo].[Employee]
    WHERE [No] = @empNo
  `);
      
    const employee = empResult.recordset[0];
    console.log('Employee result:', employee);
   return NextResponse.json({
      username: user.No,
      employee: employee || null,
    
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในระบบ' }, { status: 500 });
  }
}