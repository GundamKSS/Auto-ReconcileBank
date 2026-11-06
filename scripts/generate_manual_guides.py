#!/usr/bin/env python3
"""
Generate visual screenshot guides and animated GIFs for the Auto Reconcile Bank manual:
1. Match Assistant (ผู้ช่วยจับคู่): Location callout and animated demo
2. Period Close (การปิดงวดและยืนยันงาน): Location callout and animated demo
"""

import os
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = "public/manual/img"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# Fonts
FONT_PATH = "/System/Library/Fonts/Supplemental/Thonburi.ttc"
f_title = ImageFont.truetype(FONT_PATH, 18, index=1)
f_sub = ImageFont.truetype(FONT_PATH, 14, index=1)
f_body = ImageFont.truetype(FONT_PATH, 13, index=0)
f_small = ImageFont.truetype(FONT_PATH, 11, index=0)
f_badge = ImageFont.truetype(FONT_PATH, 12, index=1)
f_mono = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)

def draw_rounded_rect(draw, bbox, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(bbox, radius=radius, fill=fill, outline=outline, width=width)

def draw_header_bar(draw, w, balance_tone="balanced", balance_text="ผลต่างคงเหลือ 0.00 บาท"):
    # Background
    draw.rectangle([0, 0, w, 56], fill="#ffffff", outline="#e2e8f0", width=1)
    
    # Left: App title / breadcrumb
    draw_rounded_rect(draw, [16, 12, 40, 44], 6, "#f1f5f9", "#cbd5e1")
    draw.polygon([(25, 28), (31, 22), (31, 34)], fill="#475569") # back arrow
    
    draw.text((48, 14), "ธนาคารกสิกรไทย · บัญชี 012-3-45678-9", fill="#0f172a", font=f_sub)
    draw.text((48, 33), "งวด 01/08/2026 - 31/08/2026 · บัญชียังใช้งาน", fill="#64748b", font=f_small)

    # Right: Lock status pill
    if balance_tone == "closed":
        draw_rounded_rect(draw, [w - 180, 14, w - 16, 42], 14, "#ecfdf5", "#a7f3d0")
        draw.text((w - 165, 20), "🔒 ปิดงวดและล็อกแล้ว", fill="#065f46", font=f_badge)
    else:
        draw_rounded_rect(draw, [w - 160, 14, w - 16, 42], 14, "#f8fafc", "#e2e8f0")
        draw.text((w - 148, 20), "งวดเปิดอยู่ (ยังไม่ปิด)", fill="#64748b", font=f_small)

    # Center: BalanceBadge (Key target for Period Close!)
    badge_w = 230
    bx1 = (w - badge_w) // 2
    bx2 = bx1 + badge_w
    if balance_tone == "balanced" or balance_tone == "closed":
        b_bg = "#ecfdf5"
        b_border = "#10b981"
        dot_c = "#10b981"
        b_text_c = "#065f46"
    else:
        b_bg = "#fffbeb"
        b_border = "#f59e0b"
        dot_c = "#f59e0b"
        b_text_c = "#92400e"

    draw_rounded_rect(draw, [bx1, 10, bx2, 46], 10, b_bg, b_border, width=2)
    draw.ellipse([bx1 + 12, 24, bx1 + 20, 32], fill=dot_c)
    draw.text((bx1 + 28, 18), balance_text, fill=b_text_c, font=f_badge)
    return (bx1, 10, bx2, 46)

def draw_toolbar(draw, w, assistant_highlight=False):
    # Action toolbar (y: 56 to 106)
    draw.rectangle([0, 56, w, 106], fill="#f8fafc", outline="#e2e8f0", width=1)
    
    # Quick match buttons
    # Button 1: ยอดตรงกันพอดี
    draw_rounded_rect(draw, [16, 66, 150, 96], 6, "#ffffff", "#cbd5e1")
    draw.text((28, 73), "✓ ยอดตรงกันพอดี", fill="#334155", font=f_small)
    
    # Button 2: ต้องรวมหลายรายการ
    draw_rounded_rect(draw, [158, 66, 310, 96], 6, "#ffffff", "#cbd5e1")
    draw.text((170, 73), "+ รวมหลายรายการ", fill="#334155", font=f_small)
    
    # Button 3: ✨ ผู้ช่วยจับคู่ (Key target for Match Assistant!)
    ax1, ay1, ax2, ay2 = 318, 66, 465, 96
    if assistant_highlight:
        draw_rounded_rect(draw, [ax1, ay1, ax2, ay2], 6, "#eef2ff", "#6366f1", width=2)
        draw.text((ax1 + 14, 73), "✨ ผู้ช่วยจับคู่", fill="#4338ca", font=f_badge)
    else:
        draw_rounded_rect(draw, [ax1, ay1, ax2, ay2], 6, "#ffffff", "#c7d2fe")
        draw.text((ax1 + 14, 73), "✨ ผู้ช่วยจับคู่", fill="#4f46e5", font=f_badge)
        
    # Button 4: ลิงก์วันที่
    draw_rounded_rect(draw, [473, 66, 575, 96], 6, "#ffffff", "#cbd5e1")
    draw.text((485, 73), "🔗 เชื่อมวันที่", fill="#64748b", font=f_small)

    # Search box right
    draw_rounded_rect(draw, [w - 240, 66, w - 16, 96], 6, "#ffffff", "#e2e8f0")
    draw.text((w - 225, 73), "🔍 ค้นหาคำอธิบาย / เลขเอกสาร...", fill="#94a3b8", font=f_small)
    return (ax1, ay1, ax2, ay2)

def draw_tables_preview(draw, w, h):
    # Two columns: Left Bank, Right GL
    mid = w // 2
    draw.rectangle([0, 106, mid, h], fill="#ffffff", outline="#e2e8f0")
    draw.rectangle([mid, 106, w, h], fill="#ffffff", outline="#e2e8f0")
    
    # Column headers
    draw.rectangle([0, 106, mid, 136], fill="#f1f5f9", outline="#e2e8f0")
    draw.text((16, 114), "รายการเดินบัญชี ธนาคาร (Statement)", fill="#1e293b", font=f_sub)
    draw.text((mid - 120, 114), "รอจับคู่: 2 รายการ", fill="#64748b", font=f_small)
    
    draw.rectangle([mid, 106, w, 136], fill="#f1f5f9", outline="#e2e8f0")
    draw.text((mid + 16, 114), "รายการบัญชีแยกประเภท BC365 (GL)", fill="#1e293b", font=f_sub)
    draw.text((w - 120, 114), "รอจับคู่: 2 รายการ", fill="#64748b", font=f_small)
    
    # Rows preview (Bank)
    rows_bank = [
        ("15/08/2026", "บจก. ซัพพลาย คอร์ป", "52,400.00"),
        ("22/08/2026", "ค่าบริการระบบคลาวด์", "14,850.00"),
    ]
    for i, (dt, desc, amt) in enumerate(rows_bank):
        y = 142 + i * 36
        draw.rectangle([0, y, mid, y + 34], fill="#ffffff" if i % 2 == 0 else "#f8fafc")
        draw.text((16, y + 8), f"☐ {dt}", fill="#334155", font=f_body)
        draw.text((115, y + 8), desc, fill="#1e293b", font=f_body)
        draw.text((mid - 110, y + 8), amt, fill="#0f172a", font=f_sub)
        draw.line([(0, y + 34), (mid, y + 34)], fill="#f1f5f9")

    # Rows preview (GL)
    rows_gl = [
        ("17/08/2026", "PV-2608-0114 ซัพพลาย คอร์ป (ต่างวัน)", "52,400.00"),
        ("22/08/2026", "PV-2608-0182 ค่าบริการระบบคลาวด์", "14,850.00"),
    ]
    for i, (dt, desc, amt) in enumerate(rows_gl):
        y = 142 + i * 36
        draw.rectangle([mid, y, w, y + 34], fill="#ffffff" if i % 2 == 0 else "#f8fafc")
        draw.text((mid + 16, y + 8), f"☐ {dt}", fill="#334155", font=f_body)
        draw.text((mid + 115, y + 8), desc, fill="#1e293b", font=f_body)
        draw.text((w - 110, y + 8), amt, fill="#0f172a", font=f_sub)
        draw.line([(mid, y + 34), (w, y + 34)], fill="#f1f5f9")


# ==========================================
# 1. Match Assistant Static & GIF
# ==========================================
def generate_match_assistant_assets():
    W, H = 960, 520
    
    # 1. Static Annotated Screenshot Guide
    im = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(im)
    
    draw_header_bar(draw, W, balance_tone="balanced", balance_text="ผลต่างคงเหลือ 0.00 บาท")
    ax1, ay1, ax2, ay2 = draw_toolbar(draw, W, assistant_highlight=True)
    draw_tables_preview(draw, W, H)
    
    # Overlay Callout 1: Pointer pointing to ✨ ผู้ช่วยจับคู่
    # Red/Indigo callout box above or below button
    draw_rounded_rect(draw, [ax1 - 6, ay1 - 6, ax2 + 6, ay2 + 6], 8, None, outline="#ef4444", width=3)
    
    # Pointer arrow and badge
    callout_x1, callout_y1, callout_x2, callout_y2 = 280, 115, 590, 185
    draw_rounded_rect(draw, [callout_x1, callout_y1, callout_x2, callout_y2], 10, "#1e1b4b", outline="#818cf8", width=2)
    # Triangle arrow pointing up to button
    draw.polygon([(390, 105), (380, 115), (400, 115)], fill="#1e1b4b")
    draw.text((callout_x1 + 16, callout_y1 + 10), "📍 ตำแหน่งปุ่ม: แถบเครื่องมือเหนือตาราง", fill="#a5b4fc", font=f_sub)
    draw.text((callout_x1 + 16, callout_y1 + 34), "กด '✨ ผู้ช่วยจับคู่' เพื่อให้ระบบค้นหาคู่ยอดตรงกันข้ามวัน", fill="#ffffff", font=f_body)
    
    # Modal preview in lower center
    mx1, my1, mx2, my2 = 180, 210, 780, 480
    draw_rounded_rect(draw, [mx1, my1, mx2, my2], 14, "#ffffff", outline="#6366f1", width=2)
    
    # Modal header
    draw.rectangle([mx1, my1, mx2, my1 + 44], fill="#eef2ff")
    draw.text((mx1 + 18, my1 + 12), "✨ ค้นหาคู่แนะนำ (Suggest Matches) — ข้ามวันได้", fill="#312e81", font=f_sub)
    draw.text((mx2 - 40, my1 + 12), "✕", fill="#64748b", font=f_sub)
    
    # Suggestion card 1
    cx1, cy1, cx2, cy2 = mx1 + 20, my1 + 56, mx2 - 20, my1 + 170
    draw_rounded_rect(draw, [cx1, cy1, cx2, cy2], 8, "#f8fafc", "#cbd5e1")
    
    # Confidence tag
    draw_rounded_rect(draw, [cx1 + 14, cy1 + 12, cx1 + 110, cy1 + 34], 11, "#ecfdf5", "#a7f3d0")
    draw.text((cx1 + 22, cy1 + 15), "🟢 มั่นใจสูง 98%", fill="#065f46", font=f_badge)
    draw.text((cx1 + 120, cy1 + 16), "ยอดตรงกันพอดี 52,400.00 บาท (ลงบัญชีต่างกัน 2 วัน)", fill="#334155", font=f_body)
    
    # Details row
    draw.text((cx1 + 16, cy1 + 44), "ธนาคาร: 15/08/2026 · บจก. ซัพพลาย คอร์ป", fill="#475569", font=f_small)
    draw.text((cx1 + 16, cy1 + 64), "BC365: 17/08/2026 · PV-2608-0114 ซัพพลาย คอร์ป", fill="#475569", font=f_small)
    
    # Accept button
    btn_x1, btn_y1, btn_x2, btn_y2 = cx2 - 140, cy1 + 48, cx2 - 16, cy1 + 86
    draw_rounded_rect(draw, [btn_x1, btn_y1, btn_x2, btn_y2], 8, "#4f46e5", None)
    draw.text((btn_x1 + 22, btn_y1 + 9), "✓ ยอมรับ Match", fill="#ffffff", font=f_badge)
    
    # Step indicator in modal bottom
    draw.text((mx1 + 24, my2 - 32), "💡 ตรวจสอบรายละเอียดแล้วกด 'ยอมรับ Match' เพื่อยืนยันการจับคู่ทันที", fill="#6366f1", font=f_small)
    
    static_path = os.path.join(OUTPUT_DIR, "match-assistant-guide.png")
    im.save(static_path, "PNG")
    print(f"Generated: {static_path}")

    # 2. Animated GIF Demo (4 frames loop)
    frames = []
    # Frame 1: Workspace view with pointer moving towards ✨ ผู้ช่วยจับคู่
    f1 = Image.new("RGB", (W, H), "#ffffff")
    d1 = ImageDraw.Draw(f1)
    draw_header_bar(d1, W, "balanced", "ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d1, W, assistant_highlight=False)
    draw_tables_preview(d1, W, H)
    # Cursor approaching button
    d1.polygon([(410, 130), (410, 110), (425, 120)], fill="#ef4444")
    d1.text((360, 140), "👆 กำลังคลิก...", fill="#ef4444", font=f_small)
    frames.append(f1)

    # Frame 2: Button highlighted + clicked
    f2 = Image.new("RGB", (W, H), "#ffffff")
    d2 = ImageDraw.Draw(f2)
    draw_header_bar(d2, W, "balanced", "ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d2, W, assistant_highlight=True)
    draw_tables_preview(d2, W, H)
    draw_rounded_rect(d2, [314, 62, 469, 100], 8, None, outline="#ef4444", width=3)
    d2.polygon([(400, 110), (390, 85), (410, 95)], fill="#ef4444")
    frames.append(f2)

    # Frame 3: Modal opens with suggested pair
    f3 = Image.new("RGB", (W, H), "#ffffff")
    d3 = ImageDraw.Draw(f3)
    draw_header_bar(d3, W, "balanced", "ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d3, W, assistant_highlight=True)
    draw_tables_preview(d3, W, H)
    # Darken backdrop slightly
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 100))
    f3.paste(Image.new("RGB", (W, H), "#000000"), (0, 0), mask=overlay.split()[3])
    # Draw Modal
    d3 = ImageDraw.Draw(f3)
    draw_rounded_rect(d3, [mx1, my1, mx2, my2], 14, "#ffffff", outline="#6366f1", width=2)
    d3.rectangle([mx1, my1, mx2, my1 + 44], fill="#eef2ff")
    d3.text((mx1 + 18, my1 + 12), "✨ ค้นหาคู่แนะนำ (Suggest Matches) — ข้ามวันได้", fill="#312e81", font=f_sub)
    draw_rounded_rect(d3, [cx1, cy1, cx2, cy2], 8, "#f8fafc", "#cbd5e1")
    draw_rounded_rect(d3, [cx1 + 14, cy1 + 12, cx1 + 110, cy1 + 34], 11, "#ecfdf5", "#a7f3d0")
    d3.text((cx1 + 22, cy1 + 15), "🟢 มั่นใจสูง 98%", fill="#065f46", font=f_badge)
    d3.text((cx1 + 120, cy1 + 16), "ยอดตรงกันพอดี 52,400.00 บาท (ลงบัญชีต่างกัน 2 วัน)", fill="#334155", font=f_body)
    d3.text((cx1 + 16, cy1 + 44), "ธนาคาร: 15/08/2026 · บจก. ซัพพลาย คอร์ป", fill="#475569", font=f_small)
    d3.text((cx1 + 16, cy1 + 64), "BC365: 17/08/2026 · PV-2608-0114 ซัพพลาย คอร์ป", fill="#475569", font=f_small)
    draw_rounded_rect(d3, [btn_x1, btn_y1, btn_x2, btn_y2], 8, "#4f46e5", None)
    d3.text((btn_x1 + 22, btn_y1 + 9), "✓ ยอมรับ Match", fill="#ffffff", font=f_badge)
    # Cursor over Accept button
    d3.polygon([(btn_x1 + 60, btn_y1 + 30), (btn_x1 + 50, btn_y1 + 15), (btn_x1 + 70, btn_y1 + 20)], fill="#ef4444")
    frames.append(f3)

    # Frame 4: Match Success Toast
    f4 = Image.new("RGB", (W, H), "#ffffff")
    d4 = ImageDraw.Draw(f4)
    draw_header_bar(d4, W, "balanced", "ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d4, W, assistant_highlight=False)
    draw_tables_preview(d4, W, H)
    # Toast notification top-right
    tx1, ty1, tx2, ty2 = W - 320, 115, W - 20, 175
    draw_rounded_rect(d4, [tx1, ty1, tx2, ty2], 8, "#ecfdf5", "#10b981", width=2)
    d4.text((tx1 + 14, ty1 + 10), "🎉 จับคู่สำเร็จ!", fill="#065f46", font=f_sub)
    d4.text((tx1 + 14, ty1 + 32), "ระบบจับคู่ 1 รายการเรียบร้อยแล้ว", fill="#047857", font=f_small)
    frames.append(f4)

    gif_path = os.path.join(OUTPUT_DIR, "match-assistant-demo.gif")
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=[1400, 1200, 2200, 1600], loop=0)
    print(f"Generated: {gif_path}")


# ==========================================
# 2. Period Close Static & GIF
# ==========================================
def generate_period_close_assets():
    W, H = 960, 520
    
    # 1. Static Annotated Screenshot Guide
    im = Image.new("RGB", (W, H), "#ffffff")
    draw = ImageDraw.Draw(im)
    
    bx1, by1, bx2, by2 = draw_header_bar(draw, W, balance_tone="balanced", balance_text="● ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(draw, W, assistant_highlight=False)
    draw_tables_preview(draw, W, H)
    
    # Highlight on BalanceBadge (center of header)
    draw_rounded_rect(draw, [bx1 - 5, by1 - 4, bx2 + 5, by2 + 4], 12, None, outline="#ef4444", width=3)
    
    # Callout badge for BalanceBadge location
    badge_call_x1, badge_call_y1, badge_call_x2, badge_call_y2 = 290, 60, 670, 120
    draw_rounded_rect(draw, [badge_call_x1, badge_call_y1, badge_call_x2, badge_call_y2], 8, "#0f172a", outline="#38bdf8", width=2)
    draw.polygon([(480, 50), (470, 60), (490, 60)], fill="#0f172a") # arrow pointing up to badge
    draw.text((badge_call_x1 + 16, badge_call_y1 + 8), "📍 จุดเริ่มต้น: ป้ายผลต่าง (BalanceBadge) กึ่งกลางแถบด้านบน", fill="#38bdf8", font=f_badge)
    draw.text((badge_call_x1 + 16, badge_call_y1 + 30), "คลิกป้ายนี้เพื่อเปิดหน้าต่าง 'ยอดคงเหลือและยืนยันงานปิดงวด'", fill="#ffffff", font=f_small)

    # Modal PeriodWorkflowPanel in center
    mx1, my1, mx2, my2 = 140, 140, 820, 485
    draw_rounded_rect(draw, [mx1, my1, mx2, my2], 14, "#ffffff", outline="#0ea5e9", width=2)
    
    # Modal Header
    draw.rectangle([mx1, my1, mx2, my1 + 44], fill="#f0f9ff")
    draw.text((mx1 + 20, my1 + 12), "📊 ยอดคงเหลือและยืนยันงานปิดงวด (Period Workflow)", fill="#0369a1", font=f_sub)
    draw.text((mx2 - 40, my1 + 12), "✕", fill="#64748b", font=f_sub)
    
    # 2 Role Cards: AP and AR
    card_w = (mx2 - mx1 - 48) // 2
    
    # Card 1: AP (เงินออก)
    c1_x1, c1_y1, c1_x2, c1_y2 = mx1 + 16, my1 + 56, mx1 + 16 + card_w, my1 + 220
    draw_rounded_rect(draw, [c1_x1, c1_y1, c1_x2, c1_y2], 10, "#ecfdf5", outline="#10b981", width=2)
    draw.text((c1_x1 + 14, c1_y1 + 14), "งานเงินออก (AP) · ยืนยันแล้ว ✓", fill="#065f46", font=f_sub)
    draw.text((c1_x1 + 14, c1_y1 + 40), "โดย: สุภาณี (AP Staff) · 31/08/2026", fill="#475569", font=f_small)
    draw.text((c1_x1 + 14, c1_y1 + 60), "ตรวจ Statement เงินออกครบถ้วนแล้ว", fill="#64748b", font=f_small)
    # Reopen button
    draw_rounded_rect(draw, [c1_x1 + 14, c1_y2 - 44, c1_x1 + 140, c1_y2 - 12], 6, "#ffffff", "#cbd5e1")
    draw.text((c1_x1 + 24, c1_y2 - 34), "เปิดงานอีกครั้ง", fill="#64748b", font=f_small)
    
    # Card 2: AR (เงินเข้า)
    c2_x1, c2_y1, c2_x2, c2_y2 = c1_x2 + 16, my1 + 56, c1_x2 + 16 + card_w, my1 + 220
    draw_rounded_rect(draw, [c2_x1, c2_y1, c2_x2, c2_y2], 10, "#fffbeb", outline="#f59e0b", width=2)
    draw.text((c2_x1 + 14, c2_y1 + 14), "งานเงินเข้า (AR) · รอการยืนยัน", fill="#92400e", font=f_sub)
    draw.text((c2_x1 + 14, c2_y1 + 40), "สถานะ: จับคู่ครบแล้ว รอเจ้าหน้าที่กดยืนยัน", fill="#64748b", font=f_small)
    draw.text((c2_x1 + 14, c2_y1 + 60), "ผลต่างคงเหลือสุทธิ: 0.00 บาท", fill="#047857", font=f_badge)
    # Confirm button AR (Highlighted)
    draw_rounded_rect(draw, [c2_x1 + 14, c2_y2 - 44, c2_x1 + 150, c2_y2 - 12], 6, "#0284c7", None)
    draw.text((c2_x1 + 24, c2_y2 - 34), "✓ ยืนยันงาน AR", fill="#ffffff", font=f_badge)
    
    # Auto-lock condition box at bottom
    bot_y1 = my1 + 235
    draw_rounded_rect(draw, [mx1 + 16, bot_y1, mx2 - 16, bot_y1 + 80], 8, "#f8fafc", "#e2e8f0")
    draw.text((mx1 + 30, bot_y1 + 12), "🔒 กฎการปิดงวดและล็อกอัตโนมัติ:", fill="#0f172a", font=f_sub)
    draw.text((mx1 + 30, bot_y1 + 34), "1. ทั้ง AP และ AR กดยืนยันงานครบทั้ง 2 ฝั่งในช่วงวันที่เดียวกัน", fill="#475569", font=f_small)
    draw.text((mx1 + 30, bot_y1 + 52), "2. ผลต่างคงเหลือสุทธิหลังปรับปรุงเป็น 0.00 บาทพอดี ➔ ระบบจะปิดและล็อกงวดทันที", fill="#059669", font=f_badge)

    static_path = os.path.join(OUTPUT_DIR, "period-close-guide.png")
    im.save(static_path, "PNG")
    print(f"Generated: {static_path}")

    # 2. Animated GIF Demo (4 frames loop)
    frames = []
    
    # Frame 1: Reconcile screen, cursor moving to BalanceBadge
    f1 = Image.new("RGB", (W, H), "#ffffff")
    d1 = ImageDraw.Draw(f1)
    draw_header_bar(d1, W, "balanced", "● ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d1, W)
    draw_tables_preview(d1, W, H)
    d1.polygon([(480, 55), (480, 35), (495, 45)], fill="#ef4444")
    d1.text((505, 30), "1. คลิกป้ายผลต่าง", fill="#ef4444", font=f_badge)
    frames.append(f1)

    # Frame 2: Modal opens with AP confirmed, AR waiting
    f2 = Image.new("RGB", (W, H), "#ffffff")
    d2 = ImageDraw.Draw(f2)
    draw_header_bar(d2, W, "balanced", "● ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d2, W)
    draw_tables_preview(d2, W, H)
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 100))
    f2.paste(Image.new("RGB", (W, H), "#000000"), (0, 0), mask=overlay.split()[3])
    d2 = ImageDraw.Draw(f2)
    draw_rounded_rect(d2, [mx1, my1, mx2, my2], 14, "#ffffff", outline="#0ea5e9", width=2)
    d2.rectangle([mx1, my1, mx2, my1 + 44], fill="#f0f9ff")
    d2.text((mx1 + 20, my1 + 12), "📊 ยอดคงเหลือและยืนยันงานปิดงวด (Period Workflow)", fill="#0369a1", font=f_sub)
    draw_rounded_rect(d2, [c1_x1, c1_y1, c1_x2, c1_y2], 10, "#ecfdf5", outline="#10b981", width=2)
    d2.text((c1_x1 + 14, c1_y1 + 14), "งานเงินออก (AP) · ยืนยันแล้ว ✓", fill="#065f46", font=f_sub)
    d2.text((c1_x1 + 14, c1_y1 + 40), "โดย: สุภาณี (AP Staff) · 31/08/2026", fill="#475569", font=f_small)
    draw_rounded_rect(d2, [c2_x1, c2_y1, c2_x2, c2_y2], 10, "#fffbeb", outline="#f59e0b", width=2)
    d2.text((c2_x1 + 14, c2_y1 + 14), "งานเงินเข้า (AR) · รอการยืนยัน", fill="#92400e", font=f_sub)
    draw_rounded_rect(d2, [c2_x1 + 14, c2_y2 - 44, c2_x1 + 150, c2_y2 - 12], 6, "#0284c7", None)
    d2.text((c2_x1 + 24, c2_y2 - 34), "✓ ยืนยันงาน AR", fill="#ffffff", font=f_badge)
    # Cursor on Confirm AR
    d2.polygon([(c2_x1 + 75, c2_y2 - 20), (c2_x1 + 65, c2_y2 - 35), (c2_x1 + 85, c2_y2 - 30)], fill="#ef4444")
    d2.text((c2_x1 + 95, c2_y2 - 36), "2. กดปุ่มยืนยัน", fill="#ef4444", font=f_badge)
    frames.append(f2)

    # Frame 3: Confirm Dialog / Note input
    f3 = Image.new("RGB", (W, H), "#ffffff")
    d3 = ImageDraw.Draw(f3)
    draw_header_bar(d3, W, "balanced", "● ผลต่างคงเหลือ 0.00 บาท")
    draw_toolbar(d3, W)
    draw_tables_preview(d3, W, H)
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 140))
    f3.paste(Image.new("RGB", (W, H), "#000000"), (0, 0), mask=overlay.split()[3])
    d3 = ImageDraw.Draw(f3)
    # Confirmation popover
    px1, py1, px2, py2 = 260, 160, 700, 420
    draw_rounded_rect(d3, [px1, py1, px2, py2], 12, "#ffffff", outline="#64748b", width=2)
    d3.text((px1 + 24, py1 + 20), "ยืนยันงานเงินเข้า (AR)", fill="#0f172a", font=f_title)
    d3.text((px1 + 24, py1 + 54), "หมายเหตุ:", fill="#475569", font=f_small)
    draw_rounded_rect(d3, [px1 + 24, py1 + 74, px2 - 24, py1 + 130], 6, "#f8fafc", "#cbd5e1")
    d3.text((px1 + 34, py1 + 86), "ตรวจสอบรายการเงินเข้าและใบเสร็จรับเงินครบถ้วน", fill="#1e293b", font=f_body)
    d3.text((px1 + 24, py1 + 144), "☑ ข้าพเจ้าได้ตรวจสอบยอดเงินและรายการทั้งหมดแล้ว", fill="#0f172a", font=f_small)
    # Submit button
    draw_rounded_rect(d3, [px2 - 160, py2 - 50, px2 - 24, py2 - 16], 6, "#059669", None)
    d3.text((px2 - 138, py2 - 40), "ยืนยันบันทึก", fill="#ffffff", font=f_badge)
    frames.append(f3)

    # Frame 4: Both confirmed -> Period Automatically LOCKED!
    f4 = Image.new("RGB", (W, H), "#ffffff")
    d4 = ImageDraw.Draw(f4)
    draw_header_bar(d4, W, "closed", "🔒 ปิดงวดรวมแล้ว")
    draw_toolbar(d4, W)
    draw_tables_preview(d4, W, H)
    overlay = Image.new("RGBA", (W, H), (15, 23, 42, 100))
    f4.paste(Image.new("RGB", (W, H), "#000000"), (0, 0), mask=overlay.split()[3])
    d4 = ImageDraw.Draw(f4)
    draw_rounded_rect(d4, [mx1, my1, mx2, my2], 14, "#ffffff", outline="#10b981", width=2)
    # Closed Period Success Banner
    draw_rounded_rect(d4, [mx1 + 20, my1 + 60, mx2 - 20, my1 + 220], 12, "#ecfdf5", "#a7f3d0", width=2)
    d4.text((mx1 + 40, my1 + 80), "🔒 ปิดงวดรวมสมบูรณ์แล้ว (Auto-Locked)", fill="#065f46", font=f_title)
    d4.text((mx1 + 40, my1 + 115), "✓ AP ยืนยันแล้ว · โดย สุภาณี (31/08/2026)", fill="#047857", font=f_body)
    d4.text((mx1 + 40, my1 + 140), "✓ AR ยืนยันแล้ว · โดย ธนพล (31/08/2026)", fill="#047857", font=f_body)
    d4.text((mx1 + 40, my1 + 165), "✓ ผลต่างสุทธิหลังปรับปรุง: 0.00 บาทพอดี", fill="#047857", font=f_body)
    d4.text((mx1 + 40, my1 + 190), "ระบบทำการล็อกงวดเรียบร้อย ห้ามแก้ไขเพิ่มเติม", fill="#059669", font=f_badge)
    frames.append(f4)

    gif_path = os.path.join(OUTPUT_DIR, "period-close-demo.gif")
    frames[0].save(gif_path, save_all=True, append_images=frames[1:], duration=[1500, 1500, 1800, 2400], loop=0)
    print(f"Generated: {gif_path}")

if __name__ == "__main__":
    generate_match_assistant_assets()
    generate_period_close_assets()
