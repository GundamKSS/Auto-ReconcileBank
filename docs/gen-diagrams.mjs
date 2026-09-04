import fs from 'node:fs';
const OUT='./diagrams';
fs.mkdirSync(OUT,{recursive:true});
const FONT = `font-family:'Thonburi','Noto Sans Thai',-apple-system,'Helvetica Neue',sans-serif`;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const P={fill:'#eff6ff',stroke:'#2563eb',tc:'#12325c'};
const E={fill:'#f1f5f9',stroke:'#64748b',tc:'#1e293b'};
const D={fill:'#fef3c7',stroke:'#b45309',tc:'#7c3f0a'};
const A={fill:'#dcfce7',stroke:'#15803d',tc:'#14532d'};
const R={fill:'#ffe4e6',stroke:'#be123c',tc:'#881337'};

function box(x,y,w,h,lines,o={}){
  const s={...P,...o};const r=o.r??10;const fs_=o.fs??15;
  const arr=Array.isArray(lines)?lines:[lines];
  const lh=fs_+5; const startY=y+h/2-((arr.length-1)*lh)/2+fs_*0.35;
  let t=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>`;
  arr.forEach((ln,i)=>{
    const bold=(o.boldFirst&&i===0)||o.bold;
    t+=`<text x="${x+w/2}" y="${startY+i*lh}" text-anchor="middle" style="${FONT}" font-size="${i===0&&o.boldFirst?fs_+1:fs_}" font-weight="${bold?700:400}" fill="${s.tc}">${esc(ln)}</text>`;
  });
  return t;
}
function ell(cx,cy,rx,ry,lines,o={}){
  const s={...P,...o};const fs_=o.fs??14;
  const arr=Array.isArray(lines)?lines:[lines];
  const lh=fs_+4; const startY=cy-((arr.length-1)*lh)/2+fs_*0.35;
  let t=`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>`;
  arr.forEach((ln,i)=>{t+=`<text x="${cx}" y="${startY+i*lh}" text-anchor="middle" style="${FONT}" font-size="${fs_}" font-weight="${i===0?700:400}" fill="${s.tc}">${esc(ln)}</text>`;});
  return t;
}
function diamond(cx,cy,w,h,lines,o={}){
  const s={...R,...o};const fs_=o.fs??14;
  const arr=Array.isArray(lines)?lines:[lines];
  const lh=fs_+4;const startY=cy-((arr.length-1)*lh)/2+fs_*0.35;
  let t=`<polygon points="${cx},${cy-h/2} ${cx+w/2},${cy} ${cx},${cy+h/2} ${cx-w/2},${cy}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>`;
  arr.forEach((ln,i)=>{t+=`<text x="${cx}" y="${startY+i*lh}" text-anchor="middle" style="${FONT}" font-size="${fs_}" fill="${s.tc}">${esc(ln)}</text>`;});
  return t;
}
function store(x,y,w,h,lines,o={}){
  const s={...D,...o};const fs_=o.fs??14;
  const arr=Array.isArray(lines)?lines:[lines];
  const lh=fs_+4;const startY=y+h/2-((arr.length-1)*lh)/2+fs_*0.35;
  let t=`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="1.6"/>`
       +`<line x1="${x+34}" y1="${y}" x2="${x+34}" y2="${y+h}" stroke="${s.stroke}" stroke-width="1.4"/>`;
  arr.forEach((ln,i)=>{t+=`<text x="${x+34+(w-34)/2}" y="${startY+i*lh}" text-anchor="middle" style="${FONT}" font-size="${fs_}" fill="${s.tc}">${esc(ln)}</text>`;});
  if(o.id)t+=`<text x="${x+17}" y="${y+h/2+5}" text-anchor="middle" style="${FONT}" font-size="${fs_}" font-weight="700" fill="${s.tc}">${esc(o.id)}</text>`;
  return t;
}
function line(x1,y1,x2,y2,o={}){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke||'#475569'}" stroke-width="${o.w||1.6}" ${o.dash?`stroke-dasharray="${o.dash}"`:''} marker-end="url(#ah)"/>`;
}
function poly(pts,o={}){
  const d=pts.map((p,i)=>`${i?'L':'M'} ${p[0]} ${p[1]}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${o.stroke||'#475569'}" stroke-width="${o.w||1.6}" ${o.dash?`stroke-dasharray="${o.dash}"`:''} ${o.noArrow?'':'marker-end="url(#ah)"'}/>`;
}
function plain(x1,y1,x2,y2,o={}){
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${o.stroke||'#94a3b8'}" stroke-width="${o.w||1.4}" ${o.dash?`stroke-dasharray="${o.dash}"`:''}/>`;
}
function lbl(x,y,t,o={}){
  return `<text x="${x}" y="${y}" text-anchor="${o.anchor||'middle'}" style="${FONT}" font-size="${o.fs||12.5}" fill="${o.fill||'#475569'}" font-weight="${o.bold?700:400}">${esc(t)}</text>`;
}
function lblBg(x,y,t,o={}){
  const w=(String(t).length*(o.cw||7.0))+12;
  return `<rect x="${x-w/2}" y="${y-12}" width="${w}" height="17" rx="4" fill="#ffffff" opacity="0.96"/>`+lbl(x,y,t,o);
}
function dot(x,y){return `<circle cx="${x}" cy="${y}" r="4" fill="#475569"/>`;}
function stick(cx,cy,label){
  return `<g stroke="${A.stroke}" stroke-width="2" fill="none">`
    +`<circle cx="${cx}" cy="${cy-26}" r="11" fill="${A.fill}"/>`
    +`<line x1="${cx}" y1="${cy-15}" x2="${cx}" y2="${cy+10}"/>`
    +`<line x1="${cx-14}" y1="${cy-6}" x2="${cx+14}" y2="${cy-6}"/>`
    +`<line x1="${cx}" y1="${cy+10}" x2="${cx-12}" y2="${cy+30}"/>`
    +`<line x1="${cx}" y1="${cy+10}" x2="${cx+12}" y2="${cy+30}"/>`
    +`</g>`+ (Array.isArray(label)?label:[label]).map((t,i)=>lbl(cx,cy+50+i*17,t,{fs:13.5,bold:i===0,fill:A.tc})).join('');
}
function svg(w,h,body,title){
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M 0 0 L 10 5 L 0 10 z" fill="#475569"/></marker></defs>
<rect width="${w}" height="${h}" fill="#ffffff"/>
${title?lbl(w/2,32,title,{fs:19,bold:true,fill:'#0b1727'}):''}
${body}</svg>`;
}
const files={};

/* ============ 1. System Architecture ============ */
{
 const W=1220,H=850;let b='';
 b+=`<rect x="40" y="56" width="${W-80}" height="150" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="5 4"/>`;
 b+=lbl(66,78,'ชั้นผู้ใช้งาน (Client Tier)',{anchor:'start',bold:true,fs:13.5,fill:'#475569'});
 b+=box(70,92,230,96,['เว็บเบราว์เซอร์ของผู้ใช้','Chrome / Edge'],{boldFirst:true,fs:14});
 b+=box(330,92,820,96,['หน้าจอผู้ใช้ — Next.js 16 App Router + React 19','Dashboard · Import · Reconcile · Match History · Suspense','Master Data · Reports · Login   (สิทธิ์เมนูคุมด้วย roleProg)'],{boldFirst:true,fs:14});

 b+=`<rect x="40" y="238" width="${W-80}" height="238" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="5 4"/>`;
 b+=lbl(66,260,'ชั้นแอปพลิเคชัน (Application Tier — Next.js Route Handlers)',{anchor:'start',bold:true,fs:13.5,fill:'#475569'});
 const apis=[['/api/login','ตรวจสอบผู้ใช้ + สิทธิ์'],['/api/bank-statement/*','อ่าน & นำเข้าไฟล์'],['/api/reconcile/*','จับคู่ / พัก / ยกเลิก'],['/api/history','ประวัติการจับคู่'],['/api/master/*','จัดการข้อมูลหลัก'],['/api/dashboard/summary','สรุปภาพรวม'],['/api/reports/*','รายงาน & Export'],['/api/*/sync-gl','สั่งซิงค์ GL']];
 apis.forEach((a,i)=>{const col=i%4,row=Math.floor(i/4);b+=box(70+col*272,278+row*78,248,62,[a[0],a[1]],{boldFirst:true,fs:12.5});});
 b+=lbl(W/2,452,'lib/ : db.ts · menu.ts (สิทธิ์) · bankParsers/ (BBL, KBank, SCB) · bc365Sync.ts · trwApi.ts · currentUser.ts',{fs:12.5,fill:'#475569'});

 b+=`<rect x="40" y="510" width="510" height="216" rx="12" fill="#fffbeb" stroke="#f59e0b" stroke-dasharray="5 4"/>`;
 b+=lbl(66,532,'ชั้นข้อมูล (Data Tier)',{anchor:'start',bold:true,fs:13.5,fill:'#92400e'});
 b+=box(70,548,450,158,['Microsoft SQL Server — ฐานข้อมูล Reconcile_Bank','BankStatementImport · BankStatementLine','ReconciliationMatch · ReconciliationMatchLine','BankAccountLedgerEntries · BankAccountMapping'],{...D,boldFirst:true,fs:12.5});

 b+=`<rect x="590" y="510" width="590" height="216" rx="12" fill="#f8fafc" stroke="#cbd5e1" stroke-dasharray="5 4"/>`;
 b+=lbl(616,532,'ระบบภายนอกที่เชื่อมต่อด้วย',{anchor:'start',bold:true,fs:13.5,fill:'#475569'});
 b+=box(616,548,300,158,['TRW Data Center API','(พัฒนาขึ้นเอง ภายในองค์กร)','192.168.2.109 : 8000','/auth/auth_permission_prog','/sync/BankAccountLedgerEntries*'],{...E,boldFirst:true,fs:12.5});
 b+=box(946,548,214,158,['Microsoft Dynamics','Business Central 365','(ระบบบัญชีต้นทาง)'],{...E,boldFirst:true,fs:12.5});

 b+=line(W/2,188,W/2,278);b+=lblBg(W/2+90,240,'HTTP / JSON (fetch)');
 b+=line(295,418,295,548);b+=lblBg(295,492,'mssql (TCP 1433)');
 b+=line(766,418,766,548);b+=lblBg(790,492,'HTTP (LAN) — สั่งงานเท่านั้น');
 b+=line(916,600,946,600);b+=lblBg(931,586,'ดึง GL',{cw:6.4});
 b+=poly([[616,668],[560,668],[560,640],[520,640]]);
 b+=lblBg(600,700,'เขียนรายการ GL ลงฐานข้อมูลโดยตรง',{cw:6.6});
 b+=lbl(W/2,790,'หน้าบ้านไม่เชื่อมต่อกับ Business Central 365 โดยตรง — ข้อมูล GL ทั้งหมดผ่าน TRW Data Center API เท่านั้น',{fs:13.5,bold:true,fill:'#be123c'});
 b+=lbl(W/2,814,'ระบบนี้เพียง "สั่ง" ให้ TRW Data Center API ไปดึงข้อมูล ส่วนการเขียนข้อมูล GL ลงฐานข้อมูลเป็นหน้าที่ของ API ดังกล่าว',{fs:12.5,fill:'#475569'});
 files['01-architecture']=svg(W,H,b,'ภาพที่ 1  สถาปัตยกรรมระบบ (System Architecture)');
}

/* ============ 2. Use Case ============ */
{
 const W=1220,H=880;let b='';
 b+=`<rect x="330" y="66" width="560" height="742" rx="14" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.6"/>`;
 b+=lbl(610,92,'ระบบ Auto Reconcile Bank',{bold:true,fs:16,fill:'#334155'});
 const uc=[['UC-01 เข้าสู่ระบบ',142],['UC-02 นำเข้าไฟล์ Bank Statement',202],['UC-03 ซิงค์ข้อมูล GL',262],['UC-04 จับคู่รายการด้วยตนเอง',322],['UC-05 ให้ระบบเสนอคู่ที่ตรงกัน',382],['UC-06 พักรายการเข้าบัญชีพักโอน',442],['UC-07 ดึงรายการพักกลับมาจับคู่',502],['UC-08 ยกเลิกการจับคู่ (Unmatch)',562],['UC-09 จัดการข้อมูล Statement',622],['UC-10 ดูรายงาน & Export Excel',692],['UC-11 ดูสรุปภาพรวมรายเดือน',752]];
 uc.forEach(([t,y],i)=>{const userUc=i>=9;b+=ell(610,y,248,25,[t],{fs:13.5,...(userUc?{fill:'#dcfce7',stroke:'#15803d',tc:'#14532d'}:{})});});
 b+=stick(160,300,['Accountant (Admin)','ทำได้ทุกอย่างในระบบ']);
 b+=stick(160,700,['ผู้ใช้งานทั่วไป (User)','ดูรายงานและสรุปเท่านั้น']);
 b+=stick(1070,300,['TRW Data Center API','ตรวจสอบผู้ใช้ + ซิงค์ GL']);
 [142,202,262,322,382,442,502,562,622,692,752].forEach(y=>{b+=plain(206,300,360,y);});
 [142,692,752].forEach(y=>{b+=plain(206,700,360,y);});
 b+=plain(860,142,1024,300);
 b+=plain(860,262,1024,300);
 b+=lbl(610,838,'วงรีสีเขียว = Use Case ที่ผู้ใช้งานทั่วไป (User) เข้าถึงได้   ·   วงรีสีฟ้า = เฉพาะ Accountant (Admin)',{fs:13});
 b+=lbl(610,860,'TRW Data Center API เป็นผู้ติดต่อกับ Business Central 365 แทนระบบนี้',{fs:12.5});
 files['02-usecase']=svg(W,H,b,'ภาพที่ 2  แผนภาพ Use Case');
}

/* ============ 3. Flowchart ============ */
{
 const W=1220,H=1390;let b='';
 const MX=380, RX=880, JX=600;
 b+=box(MX-80,72,160,44,['เริ่มต้น'],{...A,r:22,bold:true});
 b+=box(MX-180,150,360,56,['1. นำเข้าไฟล์ Bank Statement (หน้า Import)'],{fs:14});
 b+=box(MX-180,232,360,56,['2. สั่งซิงค์ข้อมูล GL','ผ่าน TRW Data Center API'],{fs:13.5});
 b+=box(MX-180,314,360,56,['3. กด New reconciliation','เลือกธนาคารและช่วงวันที่'],{fs:13.5});
 b+=box(MX-180,396,360,56,['4. ระบบโหลดรายการค้างจับคู่ทั้ง 2 ฝั่ง'],{fs:14});
 b+=diamond(MX,512,350,92,['5. ใช้ปุ่ม Suggest matches','ให้ระบบหาคู่ให้หรือไม่?'],{fs:13.5});
 b+=box(MX-180,610,360,56,['6. ระบบจับกลุ่ม 1:1 / 1:N / N:1','แล้วเปิดหน้า Preview'],{fs:13.5});
 b+=box(MX-180,692,360,56,['7. ผู้ใช้ตรวจ และติ๊กเอากลุ่มที่ไม่ต้องการออก'],{fs:13.5});
 b+=box(RX-170,610,340,56,["6'. ผู้ใช้ติ๊กเลือกรายการเองทั้ง 2 ฝั่ง"],{fs:14});
 b+=diamond(JX,830,392,96,['8. ยอดรวม 2 ฝั่งเท่ากันพอดีหรือไม่?','(DIFFERENCE = 0.00)'],{fs:13.5});
 b+=box(JX-200,930,400,60,['9. กด Match → บันทึก MatchId และกลุ่มย่อย','อัปเดตสถานะฝั่ง Bank เป็น MATCHED'],{fs:13.5});
 b+=box(20,930,320,60,['10. เลือกรายการใหม่ให้ยอดตรง','หรือพักฝั่ง GL เข้าบัญชีพักโอน'],{...D,fs:13});
 b+=diamond(JX,1092,340,88,['11. ยังมีรายการค้างอีกหรือไม่?'],{fs:13.5});
 b+=box(JX-170,1196,340,56,['12. ออกรายงาน / Export Excel'],{fs:14});
 b+=box(JX-80,1292,160,44,['สิ้นสุด'],{...A,r:22,bold:true});

 b+=line(MX,116,MX,150);
 b+=line(MX,206,MX,232);
 b+=line(MX,288,MX,314);
 b+=line(MX,370,MX,396);
 b+=line(MX,452,MX,466);
 b+=line(MX,558,MX,610);b+=lblBg(MX+34,592,'ใช่',{cw:7.6});
 b+=line(MX,666,MX,692);
 b+=poly([[MX+175,512],[RX,512],[RX,610]]);b+=lblBg(660,500,'ไม่ใช่ — เลือกเอง',{cw:6.8});
 b+=poly([[MX,748],[MX,770],[JX,770]],{noArrow:true});
 b+=poly([[RX,666],[RX,770],[JX,770]],{noArrow:true});
 b+=dot(JX,770);
 b+=line(JX,770,JX,782);
 b+=line(JX,878,JX,930);b+=lblBg(JX+52,908,'เท่ากัน',{cw:7.2});
 b+=poly([[JX-196,830],[180,830],[180,930]]);b+=lblBg(300,818,'ไม่เท่ากัน',{cw:7.2});
 b+=poly([[180,930],[180,770],[JX,770]],{noArrow:true});b+=lblBg(120,846,'',{cw:1});
 b+=lbl(196,764,'เลือกใหม่',{anchor:'start',fs:12.5});
 b+=poly([[180,990],[180,1092],[JX-170,1092]]);b+=lblBg(300,1080,'พักไว้แล้ว',{cw:7.2});
 b+=line(JX,990,JX,1048);
 b+=line(JX,1136,JX,1196);b+=lblBg(JX+62,1174,'ไม่มีแล้ว',{cw:7.2});
 b+=line(JX,1252,JX,1292);
 b+=poly([[JX+170,1092],[1140,1092],[1140,424],[MX+180,424]]);
 b+=lblBg(860,1080,'ยังมีอยู่',{cw:7.2});
 b+=lblBg(830,412,'กลับไปจับคู่รายการที่เหลือ',{cw:6.8});
 files['03-flowchart']=svg(W,H,b,'ภาพที่ 3  Flowchart กระบวนการกระทบยอด');
}

/* ============ 4. Sequence ============ */
{
 const W=1260,H=1200;let b='';
 const lanes=[['ผู้ใช้งาน (Admin)',140],['หน้าจอ Reconcile',420],['Next.js API',760],['SQL Server',1090]];
 lanes.forEach(([t,x])=>{b+=box(x-110,60,220,46,[t],{bold:true,fs:13.5});b+=plain(x,106,x,1112,{dash:'6 5'});});
 const U=140,B=420,S=760,Q=1090;
 let y=142;
 const msg=(from,to,text,dashed)=>{const s=line(from,y,to,y,{dash:dashed?'5 4':null})+lblBg((from+to)/2,y-8,text,{cw:6.6});y+=44;return s;};
 const self=(x,text,o={})=>{const s=box(x-108,y-16,216,42,[text],{fs:12,...o});y+=60;return s;};
 b+=msg(U,B,'1. กดปุ่ม "Suggest matches"');
 b+=msg(B,S,'2. POST /api/reconcile/suggest');
 b+=msg(S,Q,'3. SELECT BankStatementLine ที่ UNMATCHED');
 b+=msg(S,Q,'4. SELECT GL ที่ยังไม่ถูกจับคู่ (NOT EXISTS)');
 b+=msg(Q,S,'5. รายการค้างทั้ง 2 ฝั่ง',true);
 b+=self(S,'6. จับกลุ่ม 1:1 → 1:N → N:1');
 b+=msg(S,B,'7. clusters — ยังไม่บันทึกลงฐานข้อมูล',true);
 b+=msg(B,U,'8. แสดงหน้า Preview ให้ตรวจสอบ',true);
 b+=msg(U,B,'9. ติ๊กเอากลุ่มที่ไม่ต้องการออก แล้วกด "ยืนยัน Match"');
 b+=msg(B,S,'10. POST /api/reconcile/match');
 b+=self(S,'11. ตรวจความถูกต้องของข้อมูลที่ส่งมา',{...E});
 b+=msg(S,Q,'12. BEGIN TRANSACTION');
 b+=msg(S,Q,'13. INSERT ReconciliationMatch → ได้ MatchId');
 b+=msg(S,Q,'14. INSERT ReconciliationMatchLine ทุกกลุ่ม (พร้อม Num)');
 b+=msg(S,Q,"15. UPDATE BankStatementLine → MatchStatus = 'MATCHED'");
 b+=msg(S,Q,'16. COMMIT');
 b+=msg(S,B,'17. { matchId, matchType, groupCount, bankLineCount }',true);
 b+=msg(B,S,'18. GET /api/reconcile/data (โหลดข้อมูลใหม่)');
 b+=msg(S,B,'19. รายการค้างที่เหลือ',true);
 b+=msg(B,U,'20. แจ้ง "จับคู่สำเร็จ" และแสดงตารางที่อัปเดตแล้ว',true);
 b+=box(700,1128,540,44,['หากขั้นตอนที่ 13–15 ล้มเหลว ระบบจะ ROLLBACK ทั้งหมด ไม่มีข้อมูลค้างครึ่งๆ กลางๆ'],{...R,fs:12.5});
 b+=lbl(350,1150,'ขั้นที่ 1–8 เป็นการดูตัวอย่างเท่านั้น ยังไม่เขียนฐานข้อมูล',{fs:12.5});
 files['04-sequence']=svg(W,H,b,'ภาพที่ 4  Sequence Diagram — การจับคู่ด้วย Suggest matches');
}

/* ============ 5. DFD Context (Level 0) ============ */
{
 const W=1220,H=640;let b='';
 b+=box(60,90,210,88,['Accountant (Admin)'],{...A,bold:true,fs:14});
 b+=box(60,260,210,88,['ผู้ใช้งานทั่วไป (User)'],{...A,bold:true,fs:14});
 b+=box(60,440,210,88,['ไฟล์ Bank Statement','(.xlsx / .csv)'],{...E,boldFirst:true,fs:13});
 b+=ell(610,300,180,102,['0','ระบบ','Auto Reconcile Bank'],{fs:15});
 b+=box(930,150,230,110,['TRW Data Center API','(พัฒนาเอง · ภายในองค์กร)','192.168.2.109 : 8000'],{...E,boldFirst:true,fs:12.5});
 b+=box(930,400,230,96,['Business Central 365','(ระบบบัญชีต้นทาง)'],{...E,boldFirst:true,fs:13});

 b+=line(270,120,438,262);b+=lblBg(340,150,'คำสั่งนำเข้า / จับคู่ / พัก / ยกเลิก',{cw:6.4});
 b+=line(440,286,270,150);b+=lblBg(360,236,'รายการค้าง / ผลการจับคู่',{cw:6.4});
 b+=line(270,290,430,296);b+=lblBg(352,278,'เงื่อนไขรายงาน',{cw:6.4});
 b+=line(430,320,270,326);b+=lblBg(352,344,'รายงาน / Excel / สรุปภาพรวม',{cw:6.4});
 b+=line(270,470,470,372);b+=lblBg(390,438,'ข้อมูลเดินบัญชี',{cw:6.4});
 b+=line(760,268,930,214);b+=lblBg(846,246,'username / password · คำสั่งซิงค์',{cw:6.2});
 b+=line(930,240,762,292);b+=lblBg(830,300,'ผลตรวจสิทธิ์ (roleProg) · สถานะซิงค์',{cw:6.2});
 b+=poly([[1045,260],[1045,400]],{dash:'6 4'});b+=lblBg(1120,340,'ดึงรายการ GL',{cw:6.4});
 b+=poly([[930,250],[900,250],[900,470],[700,470],[700,394]],{dash:'6 4'});b+=lblBg(806,492,'รายการ GL — TRW API เขียนลงฐานข้อมูลโดยตรง',{cw:6.2});
 b+=lbl(W/2,570,'ระบบไม่ติดต่อกับ Business Central 365 โดยตรง — ทุกอย่างผ่าน TRW Data Center API',{fs:13.5,bold:true,fill:'#be123c'});
 b+=lbl(W/2,594,'เส้นประ = การทำงานที่ TRW Data Center API เป็นผู้กระทำเอง',{fs:12.5});
 files['05-dfd0']=svg(W,H,b,'ภาพที่ 5  Data Flow Diagram — Context Diagram (ระดับ 0)');
}

/* ============ 6. DFD Level 1 ============ */
{
 const W=1220,H=960;let b='';
 b+=box(40,110,180,72,['Accountant (Admin)'],{...A,bold:true,fs:13});
 b+=box(40,232,180,72,['ไฟล์ Bank Statement'],{...E,bold:true,fs:12.5});
 b+=box(40,392,180,86,['TRW Data Center API','(พัฒนาเอง)'],{...E,boldFirst:true,fs:12.5});
 b+=box(40,760,180,72,['ผู้ใช้งานทั่วไป (User)'],{...A,bold:true,fs:13});

 b+=ell(470,150,126,48,['1.0','นำเข้า Statement'],{fs:13});
 b+=ell(470,300,126,48,['2.0','สั่งซิงค์ข้อมูล GL'],{fs:13});
 b+=ell(470,460,126,48,['3.0','จับคู่รายการ'],{fs:13});
 b+=ell(470,610,126,48,['4.0','พัก / ยกเลิก'],{fs:13});
 b+=ell(470,780,126,48,['5.0','ออกรายงาน'],{fs:13});

 b+=store(730,102,330,52,['BankStatementImport'],{id:'D1',fs:12.5});
 b+=store(730,178,330,52,['BankStatementLine'],{id:'D2',fs:12.5});
 b+=store(730,286,330,52,['BankAccountLedgerEntries'],{id:'D3',fs:12.5});
 b+=store(730,362,330,52,['BankAccountMapping'],{id:'D4',fs:12.5});
 b+=store(730,470,330,52,['ReconciliationMatch'],{id:'D5',fs:12.5});
 b+=store(730,546,330,52,['ReconciliationMatchLine'],{id:'D6',fs:12.5});
 const rd={stroke:'#94a3b8',dash:'5 4'};

 b+=line(220,132,346,146);
 b+=line(220,262,352,168);
 b+=line(220,140,352,292);
 b+=line(220,152,350,452);
 b+=line(220,164,348,600);
 b+=line(348,790,220,782);
 b+=line(220,790,348,800);

 b+=line(596,132,730,126);
 b+=line(596,162,730,202);
 b+=poly([[470,348],[470,392],[224,410]]);b+=lblBg(330,384,'คำสั่งซิงค์',{cw:6.4});
 b+=poly([[220,440],[300,440],[300,66],[860,66],[860,286]],{dash:'6 4'});
 b+=lblBg(600,60,'TRW API เขียนรายการ GL ลง D3 โดยตรง',{cw:6.4});

 b+=line(730,212,600,450,rd);
 b+=line(730,312,600,458,rd);
 b+=line(730,388,600,468,rd);
 b+=line(596,470,730,486);
 b+=line(596,480,730,558);
 b+=line(596,606,730,510);
 b+=line(596,618,730,574);
 b+=poly([[730,230],[660,230],[660,772],[596,772]],{dash:'5 4'});
 b+=line(730,592,600,790,rd);
 b+=lbl(W/2,900,'เส้นทึบ = เขียนข้อมูล (write)   ·   เส้นประสีเทา = อ่านข้อมูล (read)   ·   เส้นประยาว = การทำงานของ TRW Data Center API',{fs:12.5});
 b+=lbl(W/2,924,'D1–D6 = แหล่งเก็บข้อมูลในฐานข้อมูล Reconcile_Bank   ·   ผู้ใช้งานทั่วไป (User) เข้าถึงได้เฉพาะกระบวนการ 5.0',{fs:12.5});
 files['06-dfd1']=svg(W,H,b,'ภาพที่ 6  Data Flow Diagram — ระดับ 1');
}

/* ============ 7. ERD ============ */
{
 const W=1220,H=900;let b='';
 function ent(x,y,w,title,fields){
   const rowH=22,headH=36;const h=headH+fields.length*rowH+8;
   let t=`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="#ffffff" stroke="#2563eb" stroke-width="1.8"/>`;
   t+=`<path d="M ${x} ${y+8} a 8 8 0 0 1 8 -8 h ${w-16} a 8 8 0 0 1 8 8 v ${headH-8} h -${w} z" fill="#dbeafe"/>`;
   t+=`<line x1="${x}" y1="${y+headH}" x2="${x+w}" y2="${y+headH}" stroke="#2563eb" stroke-width="1.4"/>`;
   t+=lbl(x+w/2,y+24,title,{bold:true,fs:14.5,fill:'#12325c'});
   fields.forEach((f,i)=>{
     const [name,kind]=Array.isArray(f)?f:[f,''];
     t+=lbl(x+12,y+headH+18+i*rowH,name,{anchor:'start',fs:12.5,fill:'#1e293b',bold:kind==='PK'});
     if(kind)t+=lbl(x+w-12,y+headH+18+i*rowH,kind,{anchor:'end',fs:11,fill:kind==='PK'?'#b45309':'#2563eb',bold:true});
   });
   return {svg:t,h};
 }
 const e1=ent(60,80,300,'BankStatementImport',[['ImportId','PK'],'BankCode','FileName','PeriodStart / PeriodEnd','ImportedRowCount','FileHash (SHA-256)','Status','ImportedAt']);
 const e2=ent(60,400,300,'BankStatementLine',[['LineId','PK'],['ImportId','FK'],'BankCode','TranDate','Description / RawDescription','Debit / Credit / Balance','ChequeNo / Channel','MatchStatus']);
 const e3=ent(460,300,320,'ReconciliationMatch',[['MatchId','PK'],'BankCode','MatchType (MATCHED/SUSPENSE)','CreatedBy / CreatedAt','Status (ACTIVE/REVERSED)','ReversedAt / ReversedBy','ReversedReason']);
 const e4=ent(460,620,320,'ReconciliationMatchLine',[['MatchLineId','PK'],['MatchId','FK'],'Num (เลขกลุ่มย่อย)','SourceType (BANK/GL)',['BankLineId','FK'],['GLEntryNo','FK'],'Status (ACTIVE/REVERSED)','ReversedAt / By / Reason']);
 const e5=ent(880,620,290,'BankAccountLedgerEntries',[['Entry_No','PK'],'Posting_Date','Document_No',['Bank_Account_No','FK'],'Debit_Amount_LCY','Credit_Amount_LCY']);
 const e6=ent(880,340,290,'BankAccountMapping',[['BankAccountNo','PK'],'BankCode','BankAccountName']);
 [e1,e2,e3,e4,e5,e6].forEach(e=>{b+=e.svg;});
 b+=plain(210,80+e1.h,210,400,{stroke:'#475569',w:1.6});
 b+=lbl(224,300,'1',{anchor:'start',fs:14,bold:true,fill:'#b45309'});b+=lbl(224,390,'N',{anchor:'start',fs:14,bold:true,fill:'#b45309'});
 b+=plain(360,520,460,660,{stroke:'#475569',w:1.6});
 b+=lbl(374,530,'1',{anchor:'start',fs:14,bold:true,fill:'#b45309'});b+=lbl(444,652,'N',{anchor:'end',fs:14,bold:true,fill:'#b45309'});
 b+=plain(620,300+e3.h,620,620,{stroke:'#475569',w:1.6});
 b+=lbl(634,540,'1',{anchor:'start',fs:14,bold:true,fill:'#b45309'});b+=lbl(634,612,'N',{anchor:'start',fs:14,bold:true,fill:'#b45309'});
 b+=plain(780,700,880,700,{stroke:'#475569',w:1.6});
 b+=lbl(800,692,'N',{anchor:'start',fs:14,bold:true,fill:'#b45309'});b+=lbl(870,692,'1',{anchor:'end',fs:14,bold:true,fill:'#b45309'});
 b+=plain(1025,620,1025,340+e6.h,{stroke:'#475569',w:1.6});
 b+=lbl(1039,612,'N',{anchor:'start',fs:14,bold:true,fill:'#b45309'});b+=lbl(1039,545,'1',{anchor:'start',fs:14,bold:true,fill:'#b45309'});
 b+=lbl(W/2,872,'PK = Primary Key · FK = Foreign Key · ความสัมพันธ์ 1 : N อ่านจากฝั่ง 1 ไปหาฝั่ง N',{fs:13});
 files['07-erd']=svg(W,H,b,'ภาพที่ 7  Entity Relationship Diagram (ERD)');
}

/* ---------- banded level-2 DFD helper (กันป้ายชนกัน) ---------- */
function dfd2(key,title,bands,notes=[]){
  const W=1200;
  const AX=40, AW=170, PCX=470, PRX=126, PRY=46, SX=800, SW=340, SH=50;
  let y0=62, body='';
  const geo=[];
  bands.forEach(bd=>{
    const n=(bd.stores||[]).length;
    const h=Math.max(160, 46+n*72);
    geo.push({...bd, y0, h, cy:y0+h/2});
    y0+=h;
  });
  const H=y0+40+notes.length*24;
  geo.forEach((g,i)=>{
    if(i>0) body+=plain(30,g.y0,W-30,g.y0,{stroke:'#dbe3ec',dash:'7 6'});
    body+=lbl(38,g.y0+20,g.band,{anchor:'start',fs:12,bold:true,fill:'#94a3b8'});
    if(g.actor) body+=box(AX,g.cy-36,AW,72,g.actor.lines,{...(g.actor.ext?E:A),bold:true,fs:12.5});
    body+=ell(PCX,g.cy,PRX,PRY,[g.proc.id,g.proc.name],{fs:12.5});
    if(g.in){ body+=line(AX+AW,g.cy-16,PCX-PRX-4,g.cy-16); body+=lbl((AX+AW+PCX-PRX)/2,g.cy-26,g.in,{fs:11.5}); }
    if(g.out){ body+=line(PCX-PRX-4,g.cy+16,AX+AW,g.cy+16); body+=lbl((AX+AW+PCX-PRX)/2,g.cy+34,g.out,{fs:11.5}); }
    const n=(g.stores||[]).length;
    if(n){
      const startY=g.cy-(n*72-22)/2;
      g.stores.forEach((st,j)=>{
        const sy=startY+j*72, mid=sy+SH/2;
        body+=store(SX,sy,SW,SH,[st.name],{id:st.id,fs:12.5});
        if(st.read){ body+=line(SX,mid,PCX+PRX+4,mid,{stroke:'#94a3b8',dash:'5 4'}); }
        else { body+=line(PCX+PRX+4,mid,SX,mid); }
        body+=lbl((PCX+PRX+SX)/2,mid-9,st.label,{fs:11.5,fill:st.read?'#64748b':'#475569'});
      });
    }
    if(g.chain && geo[i+1]){
      const yA=g.cy+PRY, yB=geo[i+1].cy-PRY;
      body+=line(PCX,yA,PCX,yB);
      body+=lbl(PCX+16,(yA+yB)/2+4,g.chain,{anchor:'start',fs:11.5});
    }
  });
  notes.forEach((t,i)=>{ body+=lbl(W/2,y0+26+i*24,t.text,{fs:12.5,bold:!!t.bold,fill:t.bold?'#be123c':'#475569'}); });
  files[key]=svg(W,H,body,title);
}

/* ============ 8. DFD Level 2 — Process 1.0 ============ */
dfd2('08-dfd2-import','ภาพที่ 8  DFD ระดับ 2 — กระบวนการ 1.0 นำเข้า Bank Statement',[
 {band:'ขั้นที่ 1', proc:{id:'1.1',name:'อ่านและแปลงไฟล์'},
  actor:{lines:['ไฟล์ Bank Statement','(.xlsx / .csv)'],ext:true}, in:'ไฟล์จากธนาคาร', chain:'รายการที่แปลงแล้ว + ค่าแฮชไฟล์'},
 {band:'ขั้นที่ 2', proc:{id:'1.2',name:'ตรวจไฟล์ซ้ำ (SHA-256)'},
  stores:[{id:'D1',name:'BankStatementImport',label:'อ่านค่า FileHash ที่เคยนำเข้า',read:true}], chain:'ผลการตรวจไฟล์ซ้ำ'},
 {band:'ขั้นที่ 3', proc:{id:'1.3',name:'แสดงตัวอย่าง + คำเตือน'},
  actor:{lines:['Accountant (Admin)']}, out:'ตัวอย่าง 5 แถว + คำเตือน', in:'กดยืนยันการนำเข้า', chain:'ข้อมูลที่ตรวจแล้ว'},
 {band:'ขั้นที่ 4', proc:{id:'1.4',name:'บันทึกลงฐานข้อมูล'},
  actor:{lines:['Accountant (Admin)']}, out:'จำนวนแถวที่นำเข้าสำเร็จ',
  stores:[{id:'D1',name:'BankStatementImport',label:'หัวข้อมูลของไฟล์'},{id:'D2',name:'BankStatementLine',label:'รายการเดินบัญชีทุกแถว'}]},
],[{text:'กระบวนการ 1.1–1.3 ยังไม่เขียนฐานข้อมูล — การเขียนเกิดขึ้นที่ 1.4 ภายใน transaction เดียวเท่านั้น'}]);

/* ============ 10. DFD Level 2 — Process 3.0 ============ */
dfd2('10-dfd2-match','ภาพที่ 10  DFD ระดับ 2 — กระบวนการ 3.0 จับคู่รายการ',[
 {band:'ขั้นที่ 1', proc:{id:'3.1',name:'โหลดรายการค้าง'},
  actor:{lines:['Accountant (Admin)']}, in:'ธนาคาร + ช่วงวันที่', out:'รายการค้างทั้ง 2 ฝั่ง',
  stores:[{id:'D2',name:'BankStatementLine',label:"อ่านรายการ UNMATCHED",read:true},
          {id:'D3',name:'BankAccountLedgerEntries',label:'อ่าน GL ที่ยังไม่ถูกจับคู่',read:true},
          {id:'D4',name:'BankAccountMapping',label:'อ่านการเทียบเลขบัญชี',read:true}]},
 {band:'ขั้นที่ 2', proc:{id:'3.2',name:'เสนอคู่อัตโนมัติ'},
  actor:{lines:['Accountant (Admin)']}, in:'กด Suggest matches', out:'กลุ่มที่เสนอ (ยังไม่บันทึก)',
  stores:[{id:'D2',name:'BankStatementLine',label:'อ่านซ้ำตามช่วงเดิม',read:true},
          {id:'D3',name:'BankAccountLedgerEntries',label:'อ่านซ้ำตามช่วงเดิม',read:true}]},
 {band:'ขั้นที่ 3', proc:{id:'3.3',name:'ตรวจสอบยอด 2 ฝั่ง'},
  actor:{lines:['Accountant (Admin)']}, in:'รายการที่เลือก', out:'ผลต่าง / สถานะปุ่ม Match',
  chain:'ยอดตรงกัน → อนุญาตให้บันทึก'},
 {band:'ขั้นที่ 4', proc:{id:'3.4',name:'บันทึกการจับคู่'},
  actor:{lines:['Accountant (Admin)']}, out:'MatchId + จำนวนกลุ่ม',
  stores:[{id:'D5',name:'ReconciliationMatch',label:'หัวรายการ Match'},
          {id:'D6',name:'ReconciliationMatchLine',label:'บรรทัดย่อยทุกกลุ่ม (พร้อม Num)'},
          {id:'D2',name:'BankStatementLine',label:"อัปเดต MatchStatus = 'MATCHED'"}]},
],[{text:'กระบวนการ 3.1–3.3 อ่านข้อมูลอย่างเดียว — การเขียนเกิดขึ้นที่ 3.4 ภายใน transaction เดียวเท่านั้น'}]);

/* ============ 11. DFD Level 2 — Process 4.0 ============ */
dfd2('11-dfd2-suspend','ภาพที่ 11  DFD ระดับ 2 — กระบวนการ 4.0 พักรายการ / ยกเลิกการจับคู่',[
 {band:'4.1  พักเข้าบัญชีพักโอน', proc:{id:'4.1',name:'พักเข้าบัญชีพักโอน'},
  actor:{lines:['Accountant (Admin)']}, in:'เลือกรายการฝั่ง GL', out:'แจ้งผลการพักรายการ',
  stores:[{id:'D5',name:'ReconciliationMatch',label:'สร้างหัวรายการแบบ SUSPENSE'},
          {id:'D6',name:'ReconciliationMatchLine',label:'บันทึกบรรทัดเฉพาะฝั่ง GL'}]},
 {band:'4.2  ดึงรายการพักกลับ', proc:{id:'4.2',name:'ดึงรายการพักกลับ'},
  actor:{lines:['Accountant (Admin)']}, in:'เลือกรายการที่พักไว้', out:'จำนวนรายการที่ดึงกลับ',
  stores:[{id:'D6',name:'ReconciliationMatchLine',label:'ลบบรรทัดออกจากฐานข้อมูลจริง'},
          {id:'D5',name:'ReconciliationMatch',label:'ลบหัวรายการเมื่อไม่เหลือบรรทัด'},
          {id:'D2',name:'BankStatementLine',label:"คืนสถานะเป็น 'UNMATCHED'"}]},
 {band:'4.3  ยกเลิกการจับคู่', proc:{id:'4.3',name:'ยกเลิกการจับคู่'},
  actor:{lines:['Accountant (Admin)']}, in:'เลือกกลุ่มย่อย + เหตุผล', out:'จำนวนกลุ่มที่ยกเลิก',
  stores:[{id:'D6',name:'ReconciliationMatchLine',label:'ทำเครื่องหมาย REVERSED + เหตุผล'},
          {id:'D5',name:'ReconciliationMatch',label:'REVERSED เมื่อยกเลิกครบทุกกลุ่ม'},
          {id:'D2',name:'BankStatementLine',label:"คืนสถานะเป็น 'UNMATCHED'"}]},
],[{text:'ข้อแตกต่างสำคัญ: 4.2 ลบบรรทัดออกจริง ส่วน 4.3 ไม่ลบ แต่ทำเครื่องหมาย REVERSED ไว้',bold:true},
   {text:'เพื่อให้ตรวจสอบย้อนหลังได้ว่าเคยจับคู่รายการใดกับรายการใดไว้ ก่อนถูกยกเลิก'}]);

/* ============ 12. DFD Level 2 — Process 5.0 ============ */
dfd2('12-dfd2-report','ภาพที่ 12  DFD ระดับ 2 — กระบวนการ 5.0 ออกรายงาน',[
 {band:'5.1  สรุปภาพรวมรายเดือน', proc:{id:'5.1',name:'สรุปภาพรวมรายเดือน'},
  actor:{lines:['ผู้ใช้งานทั่วไป (User)','และ Accountant (Admin)']}, in:'เลือกเดือน + ตัวกรอง', out:'ตัวชี้วัด + กราฟสรุป',
  stores:[{id:'D2',name:'BankStatementLine',label:'อ่านรายการทั้งเดือน',read:true},
          {id:'D5',name:'ReconciliationMatch',label:'อ่านผลการจับคู่',read:true}]},
 {band:'5.2  รายงานการกระทบยอด', proc:{id:'5.2',name:'รายงานการกระทบยอด'},
  actor:{lines:['ผู้ใช้งานทั่วไป (User)','และ Accountant (Admin)']}, in:'เงื่อนไขการกรอง', out:'ตารางเทียบ 2 ฝั่ง',
  stores:[{id:'D3',name:'BankAccountLedgerEntries',label:'อ่านรายการฝั่ง GL',read:true},
          {id:'D6',name:'ReconciliationMatchLine',label:'อ่านบรรทัดย่อยของแต่ละ Match',read:true}],
  chain:'ใช้ตัวกรองชุดเดียวกัน'},
 {band:'5.3  ส่งออกไฟล์ Excel', proc:{id:'5.3',name:'ส่งออกไฟล์ Excel'},
  actor:{lines:['ผู้ใช้งานทั่วไป (User)','และ Accountant (Admin)']}, in:'กด Export Excel', out:'ไฟล์ .xlsx (sheet สรุป + รายละเอียด)'},
],[{text:'กระบวนการ 5.0 อ่านข้อมูลอย่างเดียว ไม่มีการเขียนกลับลงฐานข้อมูล',bold:true},
   {text:'เป็นกระบวนการเดียวที่ผู้ใช้งานทั่วไป (User) เข้าถึงได้ นอกเหนือจากการเข้าสู่ระบบ'}]);

for(const [name,content] of Object.entries(files)){
  fs.writeFileSync(`${OUT}/${name}.svg`,content);
  fs.writeFileSync(`${OUT}/${name}.html`,`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:#fff}</style>${content}`);
  console.log('wrote',name);
}
