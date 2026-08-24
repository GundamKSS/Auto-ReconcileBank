import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../lib/db';
import sql from 'mssql';
import bcrypt from 'bcryptjs';

// ตาราง Employee ไม่ได้อยู่ใน database หลักของระบบ reconcile (Reconcile_Bank) — ยังอยู่ที่ DATA_CENTER
// ทั้งสอง query ด้านล่างจึงต้องระบุชื่อ database เต็มเพื่อ query ข้าม database ไป
// (จำกัดให้เป็นชื่อ identifier ล้วนๆ เพราะค่านี้ถูกต่อเข้า SQL ตรงๆ ไม่ได้ผ่าน parameter)
const EMPLOYEE_DB = /^[A-Za-z0-9_]+$/.test(process.env.DB_EMPLOYEE_NAME || '')
  ? process.env.DB_EMPLOYEE_NAME
  : 'DATA_CENTER';
const EMPLOYEE_TABLE = `[${EMPLOYEE_DB}].[dbo].[Employee]`;

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json({ error: 'กรุณากรอก username และ password' }, { status: 400 });
    }
    console.log('Received login request for username:', username);

    const pool = await getPool();
    const userResult = await pool
      .request()
      .input('username', sql.NVarChar, username)
      .query(`SELECT TOP 1 [No], [PasswordHash] FROM ${EMPLOYEE_TABLE} WHERE [No] = @username`);

    const user = userResult.recordset[0];

    if (!user) {
      return NextResponse.json({ error: 'ไม่พบผู้ใช้งาน' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, user.PasswordHash);
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
        FROM ${EMPLOYEE_TABLE}
        WHERE [No] = @empNo
      `);

    const employee = empResult.recordset[0];

    return NextResponse.json({
      username: user.No,
      employee: employee || null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาดในระบบ' }, { status: 500 });
  }
}
