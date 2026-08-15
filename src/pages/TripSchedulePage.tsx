import {
  Fragment,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  CATS,
  FILTER_ORDER,
  TRIP,
  TRIP_DAYS,
  PRACTICAL,
  naverAppUrl,
  naverWebUrl,
  koreanNameOf,
  mdLabel,
  weekdayLabel,
  daysUntilTrip,
  initialDayIndex,
  todayIndex,
  itemInstant,
  type CategoryKey,
} from "../data/tripSchedule";
import "../styles/TripSchedule.css";

type FilterKey = "all" | CategoryKey;

// ---- stateful style helpers ----

const dayTabStyle = (active: boolean): CSSProperties => ({
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: 2,
  alignItems: "flex-start",
  padding: "9px 14px",
  borderRadius: 11,
  cursor: "pointer",
  transition: "all 180ms",
  textAlign: "left",
  whiteSpace: "nowrap",
  border: "1px solid " + (active ? "var(--purdue-gold)" : "rgba(206,184,136,0.12)"),
  background: active ? "var(--space-lighter)" : "var(--space-light)",
  color: active ? "var(--text-white)" : "var(--text-gray-400)",
  boxShadow: active ? "0 6px 20px -8px rgba(206,184,136,0.4)" : undefined,
});

const filterStyle = (active: boolean): CSSProperties => ({
  flex: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  whiteSpace: "nowrap",
  padding: "8px 14px",
  borderRadius: 999,
  cursor: "pointer",
  fontSize: "0.8rem",
  transition: "all 160ms",
  border: "1px solid " + (active ? "var(--purdue-gold)" : "rgba(206,184,136,0.14)"),
  background: active ? "rgba(206,184,136,0.12)" : "transparent",
  color: active ? "var(--purdue-gold)" : "var(--text-gray-400)",
});

const cardStyle = (expanded: boolean): CSSProperties => ({
  padding: "16px 18px",
  borderRadius: 14,
  cursor: "pointer",
  transition: "border-color 200ms, background 200ms",
  border:
    "1px solid " + (expanded ? "rgba(206,184,136,0.35)" : "rgba(206,184,136,0.1)"),
  background: expanded ? "var(--space-lighter)" : "var(--space-light)",
});

// ---- done / actual-time / log helpers ----

const doneTagStyle: CSSProperties = {
  flex: "none",
  fontSize: "0.64rem",
  letterSpacing: "0.04em",
  color: "var(--purdue-gold)",
  background: "rgba(206,184,136,0.16)",
  padding: "3px 8px",
  borderRadius: 5,
};

const actualTimeStyle: CSSProperties = {
  fontSize: "0.92rem",
  fontWeight: 700,
  color: "var(--purdue-gold)",
};

const timeArrowStyle: CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--text-gray-500)",
};

const titleStyle = (done: boolean): CSSProperties => ({
  fontSize: "1.05rem",
  fontWeight: done ? 500 : 700,
  color: done ? "var(--text-gray-500)" : "var(--text-white)",
  textDecoration: done ? "line-through" : "none",
  lineHeight: 1.4,
});

const doneDotStyle: CSSProperties = {
  width: 13,
  height: 13,
  borderRadius: "50%",
  background: "var(--purdue-gold)",
  border: "3px solid var(--space-blue)",
  boxShadow: "0 0 0 1px var(--purdue-gold)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: "8px",
  lineHeight: 1,
  color: "var(--space-blue)",
  fontWeight: 900,
};

/**
 * Render the `**bold**` runs a note actually uses, and nothing else.
 *
 * Not a markdown parser and not meant to become one: `[label](url)` is
 * already lifted into `links[]` before a note reaches the page, so bold is
 * the only inline mark left in the vault's prose. It used to ship raw, so
 * every emphasised phrase arrived wearing its asterisks — exactly the phrases
 * written to stand out were the ones that read as noise.
 */
function withBold(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i} style={{ color: "var(--purdue-gold)", fontWeight: 700 }}>
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Break footnote prose at its own `⚠️` markers. A definition has to be one
 * line in the vault (the table parser never sees a continuation line), so the
 * author's only paragraph signal is that emoji — every note uses it to start
 * a distinct warning. Splitting there is what turns a 1,200-character block
 * into something with edges.
 */
function detailParagraphs(detail: string): string[] {
  return detail
    .split(/\n\n+|(?=⚠️)/g)
    .map((p) => p.trim())
    .filter(Boolean);
}

const detailBox: CSSProperties = {
  margin: "0 0 14px",
  padding: "12px 14px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(206,184,136,0.14)",
};

const detailLabel: CSSProperties = {
  fontSize: "0.66rem",
  letterSpacing: "0.08em",
  color: "var(--purdue-muted)",
  marginBottom: 8,
};

const detailText: CSSProperties = {
  margin: "0 0 10px",
  fontSize: "0.85rem",
  lineHeight: 1.9,
  color: "var(--text-gray-400)",
  whiteSpace: "pre-line",
};

const logBox: CSSProperties = {
  margin: "0 0 14px",
  padding: "10px 12px",
  borderLeft: "3px solid var(--purdue-gold)",
  borderRadius: "0 8px 8px 0",
  background: "rgba(206,184,136,0.08)",
};

const logLabel: CSSProperties = {
  fontSize: "0.66rem",
  letterSpacing: "0.08em",
  color: "var(--purdue-gold)",
  marginBottom: 4,
};

const logText: CSSProperties = {
  margin: 0,
  fontSize: "0.88rem",
  lineHeight: 1.75,
  color: "var(--text-gray-300)",
  // A field note written mid-trip is the most likely place for `<br>`, which
  // the parser turns into a newline. Keep it.
  whiteSpace: "pre-line",
};

const progressTrack: CSSProperties = {
  flex: 1,
  height: 5,
  borderRadius: 3,
  background: "rgba(206,184,136,0.14)",
  overflow: "hidden",
};

const progressFill = (pct: number): CSSProperties => ({
  height: "100%",
  width: `${pct}%`,
  background: "var(--purdue-gold)",
  borderRadius: 3,
  transition: "width 320ms ease",
});

const progressLabel: CSSProperties = {
  flex: "none",
  fontSize: "0.72rem",
  color: "var(--text-gray-400)",
};

const chevronStyle = (expanded: boolean): CSSProperties => ({
  flex: "none",
  fontSize: "1.2rem",
  lineHeight: 1,
  color: "var(--purdue-gold)",
  transition: "transform 240ms",
  transform: `rotate(${expanded ? "180deg" : "0deg"})`,
});

// ---- static styles ----

const statCard: CSSProperties = {
  padding: "14px 16px",
  background: "var(--space-light)",
  border: "1px solid rgba(206,184,136,0.1)",
  borderRadius: 12,
};
const statNum: CSSProperties = {
  fontSize: "1.35rem",
  fontWeight: 700,
  color: "var(--purdue-gold)",
  lineHeight: 1.1,
};
const statSub: CSSProperties = {
  fontSize: "0.76rem",
  color: "var(--text-gray-500)",
  marginTop: 5,
};
const flightRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  background: "rgba(110,168,254,0.08)",
  border: "1px solid rgba(110,168,254,0.2)",
  borderRadius: 11,
};
const flightTag: CSSProperties = {
  flex: "none",
  fontSize: "0.7rem",
  color: "#6ea8fe",
  background: "rgba(110,168,254,0.14)",
  padding: "4px 8px",
  borderRadius: 6,
};
const infoCard: CSSProperties = {
  padding: "16px 18px",
  background: "var(--space-light)",
  border: "1px solid rgba(206,184,136,0.1)",
  borderRadius: 14,
};
const infoLabel: CSSProperties = {
  fontSize: "0.68rem",
  letterSpacing: "0.1em",
  color: "var(--purdue-gold)",
  marginBottom: 10,
};
const infoList: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontSize: "0.88rem",
  lineHeight: 1.9,
  color: "var(--text-gray-300)",
};
const detailRow: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};
const detailKey: CSSProperties = {
  flex: "none",
  fontSize: "0.7rem",
  letterSpacing: "0.06em",
  color: "var(--text-gray-500)",
};
const detailLink: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  fontSize: "0.82rem",
  padding: "11px 13px",
  background: "var(--space-blue)",
  border: "1px solid rgba(206,184,136,0.18)",
  borderRadius: 9,
};

// ---- header derivations ----

const START = TRIP_DAYS[0]?.date ?? "";
const END = TRIP_DAYS[TRIP_DAYS.length - 1]?.date ?? "";
const CITY_LIST = [
  ...new Set(TRIP_DAYS.map((d) => d.city).filter((c) => !/[→／/]/.test(c))),
];

/** Split a Notion day theme "潮流放鬆：聖水洞、汗蒸幕" into heading + detail. */
function splitTheme(theme: string): { head: string; sub: string } {
  const i = theme.indexOf("：");
  if (i === -1) return { head: theme, sub: "" };
  return { head: theme.slice(0, i), sub: theme.slice(i + 1) };
}

// Touch device → also offer the Naver app deep-link beside the web link.
// Subscribed as an external store so a pointer-type change (e.g. a tablet
// gaining a mouse) is picked up instead of being sampled once on mount.
const COARSE_QUERY = "(pointer: coarse)";

function subscribeCoarse(onChange: () => void) {
  const mq = window.matchMedia?.(COARSE_QUERY);
  if (!mq) return () => {};
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

const getCoarse = () => window.matchMedia?.(COARSE_QUERY)?.matches ?? false;

/**
 * `?now=2026-08-31T19:30` pins the clock. The whole page is read-only, so this
 * is only a preview switch: it makes the mid-trip states (today's tab, "next
 * up", the dimming of finished items) reachable before the trip starts, and
 * lets anyone check what a given evening will look like.
 */
function clockOverride(): Date | null {
  if (typeof location === "undefined") return null;
  const raw = new URLSearchParams(location.search).get("now");
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function TripSchedulePage() {
  const pinned = clockOverride();
  // Re-read the clock every minute so "next up" advances while the page is
  // open — a phone left on the itinerary during dinner should keep up.
  const [now, setNow] = useState(() => pinned ?? new Date());
  useEffect(() => {
    if (pinned) return;
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, [pinned]);

  const today = todayIndex(now);

  // Open on the day being travelled. Before the trip that is day 1, after it
  // the last day — never a day nobody is looking for.
  const [dayIndex, setDayIndex] = useState(() => initialDayIndex(pinned ?? new Date()));
  const [filter, setFilter] = useState<FilterKey>("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [infoOpen, setInfoOpen] = useState(false);
  const coarse = useSyncExternalStore(subscribeCoarse, getCoarse, () => false);
  // Korean name most recently copied, for the "已複製" acknowledgement.
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    document.title = "行程表 · 首爾 × 釜山";
  }, []);

  const day = TRIP_DAYS[dayIndex];

  const selectDay = (i: number) => {
    setDayIndex(i);
    setOpen({});
    setFilter("all");
  };

  const counts: Partial<Record<CategoryKey, number>> = {};
  day.items.forEach((it) => {
    counts[it.type] = (counts[it.type] ?? 0) + 1;
  });
  const doneCount = day.items.filter((it) => it.done).length;
  const totalCount = day.items.length;
  const donePct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const filterDefs: { key: FilterKey; label: string; color: string }[] = [
    { key: "all", label: "全部", color: "var(--purdue-gold)" },
    ...FILTER_ORDER.filter((t) => counts[t]).map((t) => ({
      key: t as FilterKey,
      label: t,
      color: CATS[t].color,
    })),
  ];

  const visible = day.items.filter((it) => filter === "all" || it.type === filter);
  const { head: dayHead, sub: daySub } = splitTheme(day.theme);

  /** When an item is due, or null for a row the note left without a time. */
  const instantOf = (it: (typeof day.items)[number]) => itemInstant(day.date, it.time);

  // The first item of today that has not started yet, skipping anything already
  // ticked off. Only meaningful while looking at today: on any other day
  // nothing is "next".
  const nextUpItem =
    dayIndex === today
      ? day.items.find((it) => {
          const at = instantOf(it);
          return !it.done && at !== null && at.getTime() > now.getTime();
        })
      : undefined;

  const isPast = (it: (typeof day.items)[number]) => {
    if (dayIndex !== today) return false;
    const at = instantOf(it);
    return at !== null && at.getTime() <= now.getTime();
  };

  /** Minutes between an item and the one after it, for the connector label. */
  const gapAfter = (it: (typeof visible)[number]): number | null => {
    const next = visible[visible.indexOf(it) + 1];
    const from = instantOf(it);
    const to = next ? instantOf(next) : null;
    if (!from || !to) return null;
    const mins = Math.round((to.getTime() - from.getTime()) / 60_000);
    return mins > 0 ? mins : null;
  };

  const gapLabel = (mins: number): string => {
    if (mins < 60) return `${mins} 分`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m === 0 ? `${h} 小時` : `${h} 小時 ${m} 分`;
  };

  return (
    <div
      className="trip-schedule"
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(900px 500px at 90% -8%, rgba(206,184,136,0.07), transparent 60%), var(--space-blue)",
        color: "var(--text-gray-300)",
      }}
    >
      {/* ---- top nav ---- */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          padding: "0 18px",
          background: "rgba(10,25,47,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(206,184,136,0.08)",
        }}
      >
        <div
          style={{
            maxWidth: 720,
            margin: "0 auto",
            height: 56,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: "1.05rem",
              fontWeight: 700,
              color: "var(--text-white)",
              letterSpacing: "-0.02em",
            }}
          >
            <span style={{ color: "var(--purdue-gold)", fontWeight: 400 }}>[</span>
            行程表
            <span style={{ color: "var(--purdue-gold)", fontWeight: 400 }}>]</span>
          </span>
          <div
            className="mono"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: "0.72rem",
              color: "var(--text-gray-400)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--purdue-gold)",
                boxShadow: "0 0 8px var(--purdue-gold)",
              }}
            />
            {CITY_LIST.join(" · ")} · 2026
          </div>
        </div>
      </nav>

      {/* ---- hero header ---- */}
      <header style={{ maxWidth: 720, margin: "0 auto", padding: "32px 18px 22px" }}>
        <div
          className="mono"
          style={{
            fontSize: "0.72rem",
            letterSpacing: "0.16em",
            color: "var(--purdue-muted)",
            marginBottom: 12,
          }}
        >
          🇰🇷 {CITY_LIST.join(" → ")} · {TRIP_DAYS.length} 天自由行
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(1.9rem,8vw,2.7rem)",
            lineHeight: 1.15,
            fontWeight: 800,
            color: "var(--text-white)",
            letterSpacing: "-0.01em",
          }}
        >
          {TRIP.title}
        </h1>
        <p
          style={{
            margin: "16px 0 0",
            fontSize: "0.98rem",
            lineHeight: 1.75,
            color: "var(--text-gray-400)",
          }}
        >
          {TRIP.subtitle}
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
            marginTop: 26,
          }}
        >
          <div style={statCard}>
            <div className="mono" style={statNum}>
              {mdLabel(START)}–{mdLabel(END)}
            </div>
            <div style={statSub}>{TRIP_DAYS.length} 天</div>
          </div>
          <div style={statCard}>
            <div className="mono" style={statNum}>
              {CITY_LIST.length} 城市
            </div>
            <div style={statSub}>{CITY_LIST.join(" · ")}</div>
          </div>
          <div
            style={{
              ...statCard,
              gridColumn: "span 2",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div
              className="mono"
              style={{ flex: "none", ...statNum, fontSize: "1.1rem" }}
            >
              💰
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-gray-400)", lineHeight: 1.6 }}>
              {TRIP.budget}
            </div>
            {/* No room code in this URL. The 6-char code is the group's only
                credential (see firestore.rules — any anonymous visitor holding
                it can read, add and delete expenses), and this page is public.
                The bare path is still one tap for us: the calculator resumes
                the group this device already joined from localStorage. */}
            <a
              href="/trip-debt-calculator"
              target="_blank"
              rel="noreferrer"
              style={{
                flex: "none",
                marginLeft: "auto",
                padding: "8px 12px",
                borderRadius: 8,
                background: "var(--purdue-gold)",
                color: "var(--space-blue)",
                fontSize: "0.76rem",
                fontWeight: 700,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              開啟記帳工具 ↗
            </a>
          </div>
        </div>

        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {TRIP.flights.map((f) => (
            <div key={f.seg} style={flightRow}>
              <span className="mono" style={flightTag}>
                {f.seg.slice(0, 2)}
              </span>
              <div style={{ fontSize: "0.82rem", color: "var(--text-gray-300)" }}>
                <span className="mono">{f.flightNo}</span> · {f.dep} → {f.arr}
              </div>
            </div>
          ))}
        </div>

      </header>

      {/* ---- sticky day tabs ---- */}
      <div
        style={{
          position: "sticky",
          top: 56,
          zIndex: 90,
          background: "rgba(10,25,47,0.92)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderTop: "1px solid rgba(206,184,136,0.06)",
          borderBottom: "1px solid rgba(206,184,136,0.06)",
        }}
      >
        <div
          className="noscroll"
          style={{
            maxWidth: 720,
            margin: "0 auto",
            padding: "12px 18px",
            display: "flex",
            gap: 8,
            overflowX: "auto",
          }}
        >
          {TRIP_DAYS.map((d, i) => (
            <button
              key={d.date}
              onClick={() => selectDay(i)}
              style={dayTabStyle(i === dayIndex)}
            >
              <span className="mono" style={{ fontSize: "0.66rem", opacity: 0.75 }}>
                {i === today ? "今天" : `DAY ${i + 1}`}
              </span>
              <span style={{ fontSize: "0.92rem", fontWeight: 700 }}>{mdLabel(d.date)}</span>
              <span style={{ fontSize: "0.66rem", opacity: 0.85 }}>{d.city}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ---- day detail ---- */}
      <main style={{ maxWidth: 720, margin: "0 auto", padding: "24px 18px 40px" }}>
        <div style={{ marginBottom: 18 }}>
          {today < 0 && dayIndex === 0 && daysUntilTrip(now) > 0 && (
            <div
              className="mono"
              style={{
                display: "inline-block",
                marginBottom: 10,
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: "0.72rem",
                color: "var(--space-blue)",
                background: "var(--purdue-gold)",
                fontWeight: 700,
              }}
            >
              距離出發還有 {daysUntilTrip(now)} 天
            </div>
          )}
          {today >= 0 && dayIndex !== today && (
            <button
              onClick={() => selectDay(today)}
              className="mono"
              style={{
                display: "block",
                marginBottom: 10,
                padding: "6px 12px",
                borderRadius: 999,
                fontSize: "0.74rem",
                fontWeight: 700,
                color: "var(--space-blue)",
                background: "var(--purdue-gold)",
                border: "none",
                cursor: "pointer",
              }}
            >
              ← 回到今天
            </button>
          )}
          <div className="mono" style={{ fontSize: "0.72rem", color: "var(--purdue-muted)" }}>
            {weekdayLabel(day.date)} · {day.city}
          </div>
          <h2
            style={{
              margin: "4px 0 0",
              fontSize: "1.4rem",
              fontWeight: 800,
              color: "var(--text-white)",
              letterSpacing: "-0.01em",
            }}
          >
            {dayHead}
          </h2>
          <div
            className="mono"
            style={{ fontSize: "0.78rem", color: "var(--text-gray-500)", marginTop: 6 }}
          >
            {daySub ? daySub + " · " : ""}
            {visible.length} 個行程
          </div>
          <div
            style={{
              marginTop: 10,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div style={progressTrack}>
              <div style={progressFill(donePct)} />
            </div>
            <span className="mono" style={progressLabel}>
              已完成 {doneCount} / {totalCount}
            </span>
          </div>
        </div>

        {/* filter pills */}
        <div
          className="noscroll"
          style={{
            display: "flex",
            flexWrap: "nowrap",
            gap: 8,
            marginBottom: 26,
            overflowX: "auto",
            paddingBottom: 2,
          }}
        >
          {filterDefs.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="mono"
              style={filterStyle(filter === f.key)}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: f.color,
                  flex: "none",
                }}
              />
              {f.label}
            </button>
          ))}
        </div>

        {/* timeline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          {visible.map((it) => {
            const hex = CATS[it.type].color;
            const key = dayIndex + "-" + day.items.indexOf(it);
            const expanded = !!open[key];
            const isNext = it === nextUpItem;
            const past = isPast(it);
            const gap = gapAfter(it);
            return (
              <Fragment key={key}>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "stretch",
                  opacity: past ? 0.55 : 1,
                }}
              >
                <div
                  style={{
                    flex: "none",
                    width: 22,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    paddingTop: 22,
                  }}
                >
                  {it.done ? (
                    <span style={doneDotStyle}>✓</span>
                  ) : (
                    <span
                      style={{
                        width: 13,
                        height: 13,
                        borderRadius: "50%",
                        background: hex,
                        border: "3px solid var(--space-blue)",
                        boxShadow: "0 0 0 1px " + hex,
                      }}
                    />
                  )}
                  <span
                    style={{
                      flex: 1,
                      width: 2,
                      background:
                        "linear-gradient(var(--space-lighter),rgba(35,53,84,0.15))",
                      margin: "4px 0",
                    }}
                  />
                </div>
                <div style={{ flex: 1, marginBottom: 14, minWidth: 0 }}>
                  {isNext && (
                    <div
                      className="mono"
                      style={{
                        display: "inline-block",
                        marginBottom: 6,
                        padding: "2px 8px",
                        borderRadius: 999,
                        fontSize: "0.62rem",
                        letterSpacing: "0.08em",
                        fontWeight: 700,
                        color: "var(--space-blue)",
                        background: "var(--purdue-gold)",
                      }}
                    >
                      接下來
                    </div>
                  )}
                  <div
                    onClick={() => setOpen((s) => ({ ...s, [key]: !s[key] }))}
                    style={{
                      ...cardStyle(expanded),
                      ...(isNext
                        ? { borderColor: "var(--purdue-gold)", boxShadow: "0 0 0 1px var(--purdue-gold)" }
                        : null),
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        justifyContent: "space-between",
                        gap: 10,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            flexWrap: "wrap",
                            marginBottom: 7,
                          }}
                        >
                          <span
                            className="mono"
                            style={{
                              fontSize: "0.92rem",
                              fontWeight: it.actualTime ? 400 : 700,
                              color: it.actualTime ? "var(--text-gray-500)" : "var(--text-white)",
                              textDecoration: it.actualTime ? "line-through" : "none",
                            }}
                          >
                            {it.time}
                          </span>
                          {it.actualTime && (
                            <>
                              <span className="mono" style={timeArrowStyle}>
                                →
                              </span>
                              <span className="mono" style={actualTimeStyle}>
                                {it.actualTime}
                              </span>
                            </>
                          )}
                          <span
                            className="mono"
                            style={{
                              fontSize: "0.64rem",
                              letterSpacing: "0.04em",
                              color: hex,
                              background: hex + "22",
                              padding: "3px 8px",
                              borderRadius: 5,
                            }}
                          >
                            {it.type}
                          </span>
                          {it.done && (
                            <span className="mono" style={doneTagStyle}>
                              ✓ 已完成
                            </span>
                          )}
                        </div>
                        <div style={titleStyle(it.done)}>{it.title}</div>
                        {it.place && (
                          <div
                            className="mono"
                            style={{
                              fontSize: "0.72rem",
                              color: "var(--text-gray-500)",
                              marginTop: 4,
                            }}
                          >
                            📍 {it.place.name}
                            {koreanNameOf(it) && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const name = koreanNameOf(it);
                                  if (name) {
                                    void navigator.clipboard?.writeText(name);
                                    setCopied(name);
                                  }
                                }}
                                className="mono"
                                style={{
                                  marginLeft: 8,
                                  padding: "1px 7px",
                                  borderRadius: 999,
                                  fontSize: "0.7rem",
                                  color: "var(--purdue-gold)",
                                  background: "rgba(206,184,136,0.12)",
                                  border: "1px solid rgba(206,184,136,0.35)",
                                  cursor: "pointer",
                                }}
                              >
                                {copied === koreanNameOf(it) ? "已複製" : `🚕 ${koreanNameOf(it)}`}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                      <span style={chevronStyle(expanded)}>⌄</span>
                    </div>

                    {expanded && (
                      <div
                        style={{
                          marginTop: 14,
                          paddingTop: 14,
                          borderTop: "1px solid rgba(206,184,136,0.12)",
                          animation: "tripRiseIn 240ms ease",
                        }}
                      >
                        {it.notes && (
                          <p
                            style={{
                              margin: "0 0 14px",
                              fontSize: "0.9rem",
                              lineHeight: 1.85,
                              color: "var(--text-gray-300)",
                              // `<br>` in a note cell is parsed into a real
                              // newline; without this the browser would
                              // collapse it back to a space.
                              whiteSpace: "pre-line",
                            }}
                          >
                            {withBold(it.notes)}
                          </p>
                        )}
                        {it.detail && (
                          <div style={detailBox}>
                            <div className="mono" style={detailLabel}>
                              📖 詳細說明
                            </div>
                            {detailParagraphs(it.detail).map((para, i, all) => (
                              <p
                                key={i}
                                style={
                                  i === all.length - 1
                                    ? { ...detailText, marginBottom: 0 }
                                    : detailText
                                }
                              >
                                {withBold(para)}
                              </p>
                            ))}
                          </div>
                        )}
                        {it.log && (
                          <div style={logBox}>
                            <div className="mono" style={logLabel}>
                              🖊 現場紀錄
                            </div>
                            <p style={logText}>{it.log}</p>
                          </div>
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {it.cost && (
                            <div style={detailRow}>
                              <div className="mono" style={detailKey}>
                                費用
                              </div>
                              <div
                                className="mono"
                                style={{
                                  fontSize: "0.95rem",
                                  fontWeight: 700,
                                  color: "var(--purdue-gold)",
                                }}
                              >
                                {it.cost}
                              </div>
                            </div>
                          )}
                          {it.booking && (
                            <div style={detailRow}>
                              <div className="mono" style={detailKey}>
                                預訂
                              </div>
                              <div
                                className="mono"
                                style={{
                                  fontSize: "0.82rem",
                                  color: "var(--text-gray-300)",
                                  textAlign: "right",
                                  // Booking details are the other cell that
                                  // regularly runs to several lines.
                                  whiteSpace: "pre-line",
                                }}
                              >
                                {withBold(it.booking)}
                              </div>
                            </div>
                          )}
                          {it.links.map((lnk) => (
                            <a
                              key={lnk.url}
                              href={lnk.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              style={detailLink}
                            >
                              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {lnk.label}
                              </span>
                              <span className="mono" style={{ color: "var(--purdue-gold)", flex: "none" }}>
                                ↗
                              </span>
                            </a>
                          ))}
                          {it.place && (
                            <div style={{ display: "flex", gap: 8 }}>
                              <a
                                href={naverWebUrl(it.place, koreanNameOf(it))}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="mono"
                                style={{
                                  flex: 1,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  gap: 6,
                                  fontSize: "0.85rem",
                                  padding: 11,
                                  background: "var(--space-blue)",
                                  border: "1px solid rgba(206,184,136,0.18)",
                                  borderRadius: 9,
                                }}
                              >
                                ↗ Naver 地圖{koreanNameOf(it) ? "" : "（含韓文地址）"}
                              </a>
                              {coarse && (
                                <a
                                  href={naverAppUrl(it.place)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="mono"
                                  style={{
                                    flex: "none",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 6,
                                    fontSize: "0.85rem",
                                    padding: "11px 14px",
                                    background: "var(--space-blue)",
                                    border: "1px solid rgba(206,184,136,0.18)",
                                    borderRadius: 9,
                                  }}
                                >
                                  App
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              {gap !== null && (
                <div
                  className="mono"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    margin: "-8px 0 8px 34px",
                    fontSize: "0.64rem",
                    color: "var(--text-gray-500)",
                    opacity: past ? 0.55 : 0.8,
                  }}
                >
                  <span>↓</span>
                  <span>{gapLabel(gap)}</span>
                </div>
              )}
              </Fragment>
            );
          })}
        </div>
      </main>

      {/* ---- practical info ---- */}
      <section style={{ maxWidth: 720, margin: "0 auto", padding: "8px 18px 90px" }}>
        <button
          onClick={() => setInfoOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "16px 18px",
            borderRadius: 14,
            cursor: "pointer",
            textAlign: "left",
            border: "1px solid rgba(206,184,136,0.14)",
            background: "var(--space-light)",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: "1.05rem" }}>🧭</span>
            <span style={{ fontSize: "1rem", fontWeight: 700, color: "var(--text-white)" }}>
              實用資訊 & 避雷清單
            </span>
          </span>
          <span style={chevronStyle(infoOpen)}>⌄</span>
        </button>

        {infoOpen && (
          <div
            style={{
              marginTop: 14,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              animation: "tripRiseIn 240ms ease",
            }}
          >
            <div style={infoCard}>
              <div className="mono" style={infoLabel}>
                🚇 交通
              </div>
              <ul style={infoList}>
                {PRACTICAL.交通.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            <div style={infoCard}>
              <div className="mono" style={infoLabel}>
                🏨 住宿重點
              </div>
              <ul style={infoList}>
                {PRACTICAL.住宿.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>

            <div style={infoCard}>
              <div className="mono" style={infoLabel}>
                🌤️ 天氣 & 打包 · 📱 App
              </div>
              <p
                style={{
                  margin: "0 0 8px",
                  fontSize: "0.88rem",
                  lineHeight: 1.85,
                  color: "var(--text-gray-300)",
                }}
              >
                {PRACTICAL.天氣}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "0.88rem",
                  lineHeight: 1.85,
                  color: "var(--text-gray-300)",
                }}
              >
                <strong>常用 App</strong>：{PRACTICAL.app}
              </p>
            </div>

            <div
              style={{
                ...infoCard,
                background: "var(--space-lighter)",
                border: "1px solid rgba(206,184,136,0.16)",
              }}
            >
              <div className="mono" style={infoLabel}>
                🚩 釜山避雷清單（{PRACTICAL.避雷清單.length} 條）
              </div>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 20,
                  fontSize: "0.86rem",
                  lineHeight: 1.95,
                  color: "var(--text-gray-300)",
                }}
              >
                {PRACTICAL.避雷清單.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
