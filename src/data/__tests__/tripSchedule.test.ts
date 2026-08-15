import { describe, it, expect } from "vitest";
import {
  TRIP,
  TRIP_DAYS,
  PRACTICAL,
  parseTripMarkdown,
  parseAvoidList,
  findOverviewMismatches,
  checkOverviewConsistency,
  naverAppUrl,
  naverWebUrl,
  type OverviewRow,
  type TripDay,
  type Place,
} from "../tripSchedule";

// ---------------------------------------------------------------------------
// the real note, loaded via import.meta.glob at module load time
// ---------------------------------------------------------------------------

// These assert that the note *parsed*, not what the plan currently says.
// Deploys are gated on this suite, so pinning the exact day and item counts
// would mean that adding a stop mid-trip fails CI and blocks the site update
// unless the test is edited in the same push — precisely when nobody wants to
// be editing tests. What must never happen is the parser silently collapsing,
// so the checks below bound the shape and verify each row is usable.

describe("real trip note", () => {
  it("parses a plausible number of days, none of them empty", () => {
    expect(TRIP_DAYS.length).toBeGreaterThanOrEqual(2);
    expect(TRIP_DAYS.length).toBeLessThan(40);
    for (const d of TRIP_DAYS) {
      expect(d.items.length, `${d.date} parsed with no items`).toBeGreaterThan(0);
      expect(d.date, `${d.date} is not a YYYY-MM-DD date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("every row has a title and a time", () => {
    for (const d of TRIP_DAYS) {
      for (const it of d.items) {
        expect(it.title.trim(), `${d.date} has a row with no title`).not.toBe("");
        expect(it.time, `${d.date} ${it.title} has an unparseable time`).toMatch(
          /^\d{1,2}:\d{2}$/,
        );
      }
    }
  });

  it("rows within a day run forwards in time", () => {
    for (const d of TRIP_DAYS) {
      const minutes = d.items.map((it) => {
        const [h, m] = it.time.split(":");
        return Number(h) * 60 + Number(m);
      });
      expect(minutes, `${d.date} has rows out of order`).toEqual([...minutes].sort((a, b) => a - b));
    }
  });

  it("both flights appear, at the times the flight table gives", () => {
    const all = TRIP_DAYS.flatMap((d) => d.items);
    const out = all.find((it) => it.title.includes("TR872"));
    const back = all.find((it) => it.title.includes("KE2085"));
    expect(out?.time).toBe("18:10");
    expect(back?.time).toBe("09:00");
    expect(TRIP.flights[0].dep).toContain("18:10");
    expect(TRIP.flights[1].dep).toContain("09:00");
  });

  it("parses the Airbnb booking row: booking set, links lifted, no leftover link syntax", () => {
    const airbnbNight = TRIP_DAYS.flatMap((d) => d.items).find((it) =>
      it.title.startsWith("住宿：首爾弘大 Airbnb"),
    );
    expect(airbnbNight).toBeDefined();
    expect(airbnbNight!.booking).toBeTruthy();
    // One link — the room that was actually booked. The rejected candidates
    // were dropped once both stays were confirmed.
    expect(airbnbNight!.links.length).toBe(1);
    expect(airbnbNight!.notes).not.toContain("](http");
    expect(airbnbNight!.detail).not.toContain("](http");
  });

  it("parses the place for the title that itself contains '@' (baseball game)", () => {
    const baseball = TRIP_DAYS.flatMap((d) => d.items).find((it) =>
      it.title.includes("看棒球"),
    );
    expect(baseball).toBeDefined();
    expect(baseball!.title).toContain("@");
    expect(baseball!.place?.name).toBe("社稷棒球場（사직야구장）");
    expect(baseball!.place?.lat).toBe(35.194);
    expect(baseball!.place?.lng).toBe(129.0615);
  });

  it("puts the KBO footnote in the baseball row's detail, not its notes", () => {
    const baseball = TRIP_DAYS.flatMap((d) => d.items).find((it) => it.title.includes("看棒球"))!;
    expect(baseball.detail).toContain("giantsclub.com");
    // The summary stays short — that regression is the whole point of the
    // split, so assert the length rather than just the absence of the marker.
    expect(baseball.notes).not.toContain("[^");
    expect(baseball.notes).not.toContain("giantsclub");
    expect(baseball.notes.length).toBeLessThan(120);
    expect(baseball.links.map((l) => l.label)).toEqual(["KBO 官方賽程", "樂天官方售票"]);
  });

  it("keeps every row's summary skimmable now that footnotes live in detail", () => {
    const tooLong = TRIP_DAYS.flatMap((d) => d.items).filter((it) => it.notes.length > 200);
    expect(tooLong.map((it) => `${it.time} ${it.title}`)).toEqual([]);
  });

  it("keeps the footnote definitions out of the practical sections", () => {
    const flat = [...PRACTICAL.住宿, ...PRACTICAL.交通].join(" ");
    expect(flat).not.toContain("[^");
    expect(flat).not.toContain("giantsclub");
  });

  it("has exactly 15 avoid-list items", () => {
    expect(PRACTICAL.避雷清單.length).toBe(15);
  });

  it("loaded the trip title/subtitle/budget", () => {
    expect(TRIP.title).toBe("✈️ 首爾 × 釜山 8 天自由行");
    expect(TRIP.subtitle.length).toBeGreaterThan(0);
    expect(TRIP.budget).toContain("₩1.3");
    expect(TRIP.flights.length).toBe(2);
  });

  it("the real note's overview table matches its Day headings exactly", () => {
    expect(checkOverviewConsistency()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// synthetic fixtures — exercise edge cases the real note doesn't currently hit
// ---------------------------------------------------------------------------

const FIXTURE = `---
時間: 2026-01-01T00:00:00
tags:
  - travel
---
# 測試標題

測試副標題文字

## 🗓️ 行程總覽

| 日期 | 城市 | 主題 |
| --- | --- | --- |
| 2026-01-01 | A市 | 主題A |

## 每日行程

### Day 1 · 2026-01-01（四）· A市 — 主題A

| ✓ | 時間 | 實際 | 類型 | 項目 | 地點 | 花費 | 備註 | 紀錄 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| x | 09:00 |  | 景點 | 有座標景點 | 某地標 @12.3,45.6 |  | 備註A |  |
|  | 10:00 |  | 景點 | 無座標景點 | 某地標二 |  | 備註B |  |
|  | 11:00 |  | 美食 | 轉義測試A\\|B | 某地標三 |  | line1<br>line2 |  |
|  | 12:00 |  | 交通 | 空地點項目 |  |  |  |  |
|  | 13:00 |  | 景點 | 腳註項目 | 某地標四 |  | 訂位：短訂位｜摘要 [^fn1] |  |
|  | 14:00 |  | 景點 | 未定義腳註項目 | 某地標五 |  | 摘要 [^nope] |  |

## 🏨 住宿

- 住宿A

## 🚇 交通

- 交通A

## 💰 預算估算

預算A

## 🌤️ 天氣與打包

天氣A

## 📱 實用 App

AppA

[^fn1]: 長註解含全形分隔｜還有 [連結](https://example.com/a)
`;

describe("parseTripMarkdown (synthetic fixture)", () => {
  const parsed = parseTripMarkdown(FIXTURE);

  it("parses title/subtitle/budget/practical", () => {
    expect(parsed.trip.title).toBe("測試標題");
    expect(parsed.trip.subtitle).toBe("測試副標題文字");
    expect(parsed.trip.budget).toBe("預算A");
    expect(parsed.practical.住宿).toEqual(["住宿A"]);
    expect(parsed.practical.交通).toEqual(["交通A"]);
    expect(parsed.practical.天氣).toBe("天氣A");
    expect(parsed.practical.app).toBe("AppA");
  });

  it("parses one day with the heading split correctly", () => {
    expect(parsed.days.length).toBe(1);
    expect(parsed.days[0]).toMatchObject({
      date: "2026-01-01",
      city: "A市",
      theme: "主題A",
    });
    expect(parsed.days[0].items.length).toBe(6);
  });

  it("splits a footnote out of notes after the ｜ split, so its own ｜ and links survive", () => {
    const withFootnote = parsed.days[0].items[4];
    expect(withFootnote.booking).toBe("短訂位");
    // The cell's own one-line summary is all that stays in `notes` — the
    // prose moves to `detail` so the card can lead with the skimmable half.
    expect(withFootnote.notes).toBe("摘要");
    expect(withFootnote.detail).toBe("長註解含全形分隔｜還有 連結");
    expect(withFootnote.links).toEqual([{ label: "連結", url: "https://example.com/a" }]);
  });

  it("leaves an undefined footnote reference in place rather than dropping it", () => {
    expect(parsed.days[0].items[5].notes).toBe("摘要 [^nope]");
    expect(parsed.days[0].items[5].detail).toBeUndefined();
  });

  it("leaves detail unset on a row with no footnote", () => {
    expect(parsed.days[0].items[0].notes).toBe("備註A");
    expect(parsed.days[0].items[0].detail).toBeUndefined();
  });

  it("collapses the double space left behind by a removed marker", () => {
    // "摘要 [^fn1]" → dropping the marker would otherwise leave "摘要 ".
    expect(parsed.days[0].items[4].notes).not.toMatch(/\s{2}|\s$/);
  });

  it("does not leak footnote definitions into the practical sections", () => {
    expect(parsed.practical.app).toBe("AppA");
  });

  it("a place with coordinates parses lat/lng", () => {
    const withCoords = parsed.days[0].items[0];
    expect(withCoords.place).toEqual({ name: "某地標", lat: 12.3, lng: 45.6 });
  });

  it("a place with a name but no coordinates leaves lat/lng undefined", () => {
    const noCoords = parsed.days[0].items[1];
    expect(noCoords.place?.name).toBe("某地標二");
    expect(noCoords.place?.lat).toBeUndefined();
    expect(noCoords.place?.lng).toBeUndefined();
  });

  it("an empty 地點 cell parses to a null place", () => {
    const emptyPlace = parsed.days[0].items[3];
    expect(emptyPlace.place).toBeNull();
  });

  it("unescapes \\| to a literal pipe and <br> to a newline", () => {
    const escaped = parsed.days[0].items[2];
    expect(escaped.title).toBe("轉義測試A|B");
    expect(escaped.notes).toBe("line1\nline2");
  });

  it("marks the done column correctly ('x' → true, empty → false)", () => {
    expect(parsed.days[0].items[0].done).toBe(true);
    expect(parsed.days[0].items[1].done).toBe(false);
  });
});

describe("parseAvoidList (synthetic fixture)", () => {
  it("strips numbering and bold markers across renumbered sections", () => {
    const raw = [
      "> some intro quote",
      "1. **雷 A**內容一",
      "2. 雷 B 內容二",
      "",
      "---",
      "1. **雷 C**內容三",
      "2. 雷 D 內容四",
      "",
    ].join("\n");

    expect(parseAvoidList(raw)).toEqual(["雷 A內容一", "雷 B 內容二", "雷 C內容三", "雷 D 內容四"]);
  });
});

describe("findOverviewMismatches", () => {
  it("returns [] when the overview table and day headings agree", () => {
    const overview: OverviewRow[] = [{ date: "2026-01-01", city: "A市", theme: "主題A" }];
    const days: TripDay[] = [{ date: "2026-01-01", city: "A市", theme: "主題A", items: [] }];
    expect(findOverviewMismatches(overview, days)).toEqual([]);
  });

  it("reports a mismatch when date/city/theme disagree, without throwing", () => {
    const overview: OverviewRow[] = [{ date: "2026-01-01", city: "A市", theme: "主題A" }];
    const days: TripDay[] = [{ date: "2026-01-02", city: "B市", theme: "主題A", items: [] }];
    const mismatches = findOverviewMismatches(overview, days);
    expect(mismatches.length).toBe(2);
    expect(mismatches.some((m) => m.includes("日期不一致"))).toBe(true);
    expect(mismatches.some((m) => m.includes("城市不一致"))).toBe(true);
  });

  it("reports a missing day without throwing", () => {
    const overview: OverviewRow[] = [
      { date: "2026-01-01", city: "A市", theme: "主題A" },
      { date: "2026-01-02", city: "A市", theme: "主題B" },
    ];
    const days: TripDay[] = [{ date: "2026-01-01", city: "A市", theme: "主題A", items: [] }];
    const mismatches = findOverviewMismatches(overview, days);
    expect(mismatches.length).toBe(1);
    expect(mismatches[0]).toContain("每日行程缺少對應天數");
  });
});

// ---------------------------------------------------------------------------
// map link fallback — a hand-added place has no coordinates, so both
// functions must fall back to a name search instead of emitting `undefined`
// ---------------------------------------------------------------------------

describe("naverAppUrl / naverWebUrl", () => {
  const withCoords: Place = { name: "社稷棒球場（사직야구장）", lat: 35.194, lng: 129.0615 };
  const nameOnly: Place = { name: "手加景點 & 特殊字元/測試" };

  it("naverAppUrl: a place with coordinates builds an exact-pin deep link", () => {
    const url = naverAppUrl(withCoords);
    expect(url).not.toContain("undefined");
    expect(url.startsWith("nmap://place?")).toBe(true);
    const params = new URLSearchParams(url.slice("nmap://place?".length));
    expect(params.get("lat")).toBe("35.194");
    expect(params.get("lng")).toBe("129.0615");
    expect(params.get("name")).toBe(withCoords.name);
  });

  it("naverAppUrl: a place with no coordinates falls back to a name-search deep link", () => {
    const url = naverAppUrl(nameOnly);
    expect(url).not.toContain("undefined");
    expect(url.startsWith("nmap://search?")).toBe(true);
    const params = new URLSearchParams(url.slice("nmap://search?".length));
    expect(params.get("query")).toBe(nameOnly.name);
  });

  // Never Google: the note's own avoid-list warns that Google Maps misroutes
  // in Busan, and Korea blocks the map-data export Google would need.
  it("naverWebUrl: a place with coordinates queries lat,lng", () => {
    const url = naverWebUrl(withCoords);
    expect(url).not.toContain("undefined");
    expect(url).toBe("https://map.naver.com/p/search/35.194%2C129.0615");
  });

  it("naverWebUrl: a Korean name wins over coordinates, for a better POI match", () => {
    const url = naverWebUrl(withCoords, "사직야구장");
    expect(url).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent("사직야구장")}`,
    );
  });

  it("naverWebUrl: a place with no coordinates falls back to its name", () => {
    const url = naverWebUrl(nameOnly);
    expect(url).not.toContain("undefined");
    expect(url).toBe(
      `https://map.naver.com/p/search/${encodeURIComponent(nameOnly.name)}`,
    );
  });

  it("naverWebUrl: a blank Korean name does not become the query", () => {
    expect(naverWebUrl(withCoords, "   ")).toBe(
      "https://map.naver.com/p/search/35.194%2C129.0615",
    );
  });
});
