"use client";

/**
 * Geometry-Matched Skeleton Shimmer สำหรับ Panel รายการธนาคารและ BC365
 * ออกแบบตามหลัก Anti-Wait Motion Design ของอาร์ต (Art)
 * สัดส่วนความสูงและช่องไฟตรงกับ DateGroupRow และแถวรายการย่อยแบบ 1:1
 * เพื่อให้เกิด Zero Cumulative Layout Shift (CLS = 0) เมื่อข้อมูลจริงโหลดเสร็จ
 */
export default function PanelSkeleton() {
  return (
    <div className="divide-y divide-gray-100 animate-pulse-none">
      {/* Group 1: จำลองวันที่แรก (แบบคลี่แถวย่อย 2 รายการ) */}
      <div className="border-b border-gray-100 bg-white">
        {/* Date Group Header */}
        <div className="flex items-center gap-3 px-4 py-3 bg-gray-50/50">
          <div className="w-4 h-4 rounded-full skeleton-shimmer shrink-0" />
          <div className="w-3.5 h-3.5 rounded skeleton-shimmer shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-20 h-4 rounded-md skeleton-shimmer" />
              <div className="w-14 h-4 rounded-full skeleton-shimmer" />
              <div className="w-20 h-4 rounded-full skeleton-shimmer hidden sm:block" />
            </div>
            <div className="w-12 h-3.5 rounded skeleton-shimmer" />
          </div>
          <div className="text-right shrink-0 space-y-1">
            <div className="w-14 h-3 rounded skeleton-shimmer-subtle ml-auto" />
            <div className="w-24 h-5 rounded-md skeleton-shimmer ml-auto" />
          </div>
        </div>

        {/* Child Items */}
        <div className="divide-y divide-gray-100 bg-gray-50/30">
          <div className="flex items-center gap-3 pl-12 pr-4 py-2.5">
            <div className="w-4 h-4 rounded-full skeleton-shimmer shrink-0" />
            <div className="w-5 h-5 rounded-full skeleton-shimmer shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-28 h-3.5 rounded skeleton-shimmer" />
                <div className="w-10 h-3 rounded skeleton-shimmer-subtle" />
              </div>
              <div className="w-48 sm:w-72 h-3 rounded skeleton-shimmer-subtle" />
            </div>
            <div className="w-20 h-4.5 rounded skeleton-shimmer shrink-0 ml-auto" />
          </div>

          <div className="flex items-center gap-3 pl-12 pr-4 py-2.5">
            <div className="w-4 h-4 rounded-full skeleton-shimmer shrink-0" />
            <div className="w-5 h-5 rounded-full skeleton-shimmer shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <div className="w-24 h-3.5 rounded skeleton-shimmer" />
                <div className="w-10 h-3 rounded skeleton-shimmer-subtle" />
              </div>
              <div className="w-40 sm:w-60 h-3 rounded skeleton-shimmer-subtle" />
            </div>
            <div className="w-24 h-4.5 rounded skeleton-shimmer shrink-0 ml-auto" />
          </div>
        </div>
      </div>

      {/* Group 2: จำลองวันที่ที่สอง (แบบหุบปกติ) */}
      <div className="border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-4 h-4 rounded-full skeleton-shimmer shrink-0" />
          <div className="w-3.5 h-3.5 rounded skeleton-shimmer shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-20 h-4 rounded-md skeleton-shimmer" />
              <div className="w-14 h-4 rounded-full skeleton-shimmer" />
            </div>
            <div className="w-12 h-3.5 rounded skeleton-shimmer" />
          </div>
          <div className="text-right shrink-0 space-y-1">
            <div className="w-14 h-3 rounded skeleton-shimmer-subtle ml-auto" />
            <div className="w-20 h-5 rounded-md skeleton-shimmer ml-auto" />
          </div>
        </div>
      </div>

      {/* Group 3: จำลองวันที่ที่สาม */}
      <div className="border-b border-gray-100 bg-white">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="w-4 h-4 rounded-full skeleton-shimmer shrink-0" />
          <div className="w-3.5 h-3.5 rounded skeleton-shimmer shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-24 h-4 rounded-md skeleton-shimmer" />
              <div className="w-14 h-4 rounded-full skeleton-shimmer" />
              <div className="w-20 h-4 rounded-full skeleton-shimmer hidden sm:block" />
            </div>
            <div className="w-12 h-3.5 rounded skeleton-shimmer" />
          </div>
          <div className="text-right shrink-0 space-y-1">
            <div className="w-14 h-3 rounded skeleton-shimmer-subtle ml-auto" />
            <div className="w-24 h-5 rounded-md skeleton-shimmer ml-auto" />
          </div>
        </div>
      </div>
    </div>
  );
}
