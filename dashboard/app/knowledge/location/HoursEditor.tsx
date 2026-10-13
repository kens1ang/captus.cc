"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import { cx } from "@/components/ui";
import type { BusinessHoursInterval } from "@/lib/data";

// Monday-first, as customers read a week; values are still 0 = Sunday storage indices.
const DAYS = [
  { index: 1, label: "Monday" },
  { index: 2, label: "Tuesday" },
  { index: 3, label: "Wednesday" },
  { index: 4, label: "Thursday" },
  { index: 5, label: "Friday" },
  { index: 6, label: "Saturday" },
  { index: 0, label: "Sunday" },
];

interface DayState {
  open: boolean;
  start: string;
  end: string;
}

/**
 * Weekly hours as controlled state (toggle + two times per day), submitted
 * as plain open_N / start_N / end_N form fields. One interval per day — the
 * backend supports split hours, but every existing form has been one-per-day
 * and that covers almost every small business.
 */
export function HoursEditor({ initial }: { initial: BusinessHoursInterval[] }) {
  const [days, setDays] = useState<Record<number, DayState>>(() =>
    Object.fromEntries(
      DAYS.map(({ index }) => {
        const existing = initial.find((h) => h.dayOfWeek === index);
        return [index, { open: !!existing, start: existing?.startTime ?? "09:00", end: existing?.endTime ?? "18:00" }];
      }),
    ),
  );

  const update = (index: number, patch: Partial<DayState>) => setDays((d) => ({ ...d, [index]: { ...d[index], ...patch } }));

  function copyMondayToWeekdays() {
    setDays((d) => ({ ...d, ...Object.fromEntries([2, 3, 4, 5].map((i) => [i, { ...d[1] }])) }));
  }

  return (
    <div className="flex flex-col gap-1">
      {DAYS.map(({ index, label }) => {
        const day = days[index];
        return (
          <div key={index} className="flex flex-wrap items-center gap-3 rounded-md py-1.5">
            <label className="flex w-36 cursor-pointer items-center gap-2.5 text-sm">
              <button
                type="button"
                role="switch"
                aria-checked={day.open}
                onClick={() => update(index, { open: !day.open })}
                className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", day.open ? "bg-brand" : "bg-line-strong")}
              >
                <span className={cx("absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform", day.open && "translate-x-4")} />
              </button>
              <span className={cx(day.open ? "text-fg" : "text-muted")}>{label}</span>
            </label>
            {day.open && <input type="hidden" name={`open_${index}`} value="on" />}
            {day.open ? (
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  name={`start_${index}`}
                  value={day.start}
                  onChange={(e) => update(index, { start: e.target.value })}
                  className="control w-32"
                  aria-label={`${label} opening time`}
                />
                <span className="text-sm text-faint">to</span>
                <input
                  type="time"
                  name={`end_${index}`}
                  value={day.end}
                  onChange={(e) => update(index, { end: e.target.value })}
                  className="control w-32"
                  aria-label={`${label} closing time`}
                />
              </div>
            ) : (
              <span className="text-sm text-faint">Closed</span>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={copyMondayToWeekdays}
        className="mt-2 inline-flex items-center gap-1.5 self-start text-xs font-medium text-muted hover:text-fg"
      >
        <Copy className="size-3.5" /> Copy Monday to Tuesday–Friday
      </button>
    </div>
  );
}
