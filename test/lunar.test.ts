import { describe, expect, test } from "bun:test";
import {
  canChiDay, canChiMonth, canChiYear, jdFromDate, lunarHoliday, lunarInfo, lunarMonthName, lunarToSolar,
  luckyHours, solarHoliday, solarTerm, solarToLunar,
} from "../web/deck/src/lunar";
import { readFileSync } from "node:fs";

const lunar = (day: number, month: number, year: number, leap = false) => ({ day, month, year, leap });

describe("lunar: Tet and leap months", () => {
  test("lunar new year days", () => {
    expect(solarToLunar(17, 2, 2026)).toEqual(lunar(1, 1, 2026));
    expect(solarToLunar(29, 1, 2025)).toEqual(lunar(1, 1, 2025));
    expect(solarToLunar(10, 2, 2024)).toEqual(lunar(1, 1, 2024));
    expect(solarToLunar(22, 1, 2023)).toEqual(lunar(1, 1, 2023));
    expect(canChiYear(2026)).toBe("Bính Ngọ");
    expect(canChiYear(2025)).toBe("Ất Tỵ");
    expect(canChiYear(2024)).toBe("Giáp Thìn");
    expect(canChiYear(2023)).toBe("Quý Mão");
    expect(canChiYear(2025, "zh")).toBe("乙巳");
  });

  test("2025 has a leap month 6 from 2025-07-25", () => {
    expect(solarToLunar(24, 7, 2025)).toEqual(lunar(30, 6, 2025));
    expect(solarToLunar(25, 7, 2025)).toEqual(lunar(1, 6, 2025, true));
    expect(lunarToSolar(1, 6, 2025, true)).toEqual([25, 7, 2025]);
  });

  test("2023 has a leap month 2 from 2023-03-22", () => {
    expect(solarToLunar(22, 3, 2023)).toEqual(lunar(1, 2, 2023, true));
    expect(lunarToSolar(1, 2, 2023, true)).toEqual([22, 3, 2023]);
  });

  test("invalid lunar dates give [0, 0, 0]", () => {
    expect(lunarToSolar(1, 6, 2024, true)).toEqual([0, 0, 0]);
    expect(lunarToSolar(1, 5, 2025, true)).toEqual([0, 0, 0]);
    expect(lunarToSolar(30, 12, 2025, false)).toEqual([0, 0, 0]);
    expect(lunarToSolar(0, 1, 2025, false)).toEqual([0, 0, 0]);
    expect(lunarToSolar(1, 13, 2025, false)).toEqual([0, 0, 0]);
  });
});

describe("lunar: today, 2026-11-28", () => {
  test("is 20/10 Bính Ngọ, Tiểu tuyết", () => {
    const l = solarToLunar(28, 11, 2026);
    expect(l).toEqual(lunar(20, 10, 2026));
    // Second method: month 10 starts at the 2026-11-09 new moon.
    expect(lunarToSolar(1, 10, 2026, false)).toEqual([9, 11, 2026]);
    expect(jdFromDate(28, 11, 2026) - jdFromDate(9, 11, 2026)).toBe(19);
    expect(canChiMonth(10, 2026)).toBe("Kỷ Hợi");
    expect(canChiDay(28, 11, 2026)).toBe("Bính Ngọ");
    expect(solarTerm(28, 11, 2026)).toBe("Tiểu tuyết");
    expect(solarTerm(28, 11, 2026, 7, "zh")).toBe("小雪");
  });

  test("lunarInfo uses the local date", () => {
    const info = lunarInfo(new Date(2026, 10, 28, 23, 30));
    expect(info.lunar).toEqual(lunar(20, 10, 2026));
    expect(info.yearName).toBe("Bính Ngọ");
    expect(info.monthName).toBe("Kỷ Hợi");
    expect(info.dayName).toBe("Bính Ngọ");
    expect(info.term).toBe("Tiểu tuyết");
    expect(info.luckyHours).toEqual(["Tý (23-1)", "Sửu (1-3)", "Mão (5-7)", "Ngọ (11-13)", "Thân (15-17)", "Dậu (17-19)"]);
    expect(info.holiday).toBeNull();
    const zh = lunarInfo(new Date(2026, 10, 28), "zh");
    expect(zh.yearName).toBe("丙午");
    expect(zh.luckyHours[0]).toBe("子 (23-1)");
  });
});

describe("lunar: round trip", () => {
  test("every day 2000-01-01 .. 2030-12-31", () => {
    const start = jdFromDate(1, 1, 2000);
    const end = jdFromDate(31, 12, 2030);
    let bad = 0;
    let d = 1, m = 1, y = 2000;
    const dim = (mm: number, yy: number) => [31, (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
    for (let jd = start; jd <= end; jd++) {
      expect(jdFromDate(d, m, y)).toBe(jd);
      const l = solarToLunar(d, m, y);
      const back = lunarToSolar(l.day, l.month, l.year, l.leap);
      if (back[0] !== d || back[1] !== m || back[2] !== y) bad++;
      d++;
      if (d > dim(m, y)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    }
    expect(bad).toBe(0);
  });
});

describe("lunar: whole range 1900-2100", () => {
  test("every day has day 1..30, months 29 or 30 days, and round trips", () => {
    const start = jdFromDate(1, 1, 1900);
    const end = jdFromDate(31, 12, 2100);
    let bad = 0;
    let run = 0;
    let d = 1, m = 1, y = 1900;
    const dim = (mm: number, yy: number) => [31, (yy % 4 === 0 && yy % 100 !== 0) || yy % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
    for (let jd = start; jd <= end; jd++) {
      const l = solarToLunar(d, m, y);
      if (l.day < 1 || l.day > 30) bad++;
      if (l.day === 1 && jd > start && run !== 29 && run !== 30) bad++;
      run = l.day;
      const back = lunarToSolar(l.day, l.month, l.year, l.leap);
      if (back[0] !== d || back[1] !== m || back[2] !== y) bad++;
      d++;
      if (d > dim(m, y)) { d = 1; m++; if (m > 12) { m = 1; y++; } }
    }
    expect(bad).toBe(0);
  });

  test("days where the mean month estimate is one off", () => {
    expect(solarToLunar(7, 5, 2054).day).toBeGreaterThan(0);
    expect(solarToLunar(9, 4, 2062).day).toBeGreaterThan(0);
  });
});

describe("lunar: can chi", () => {
  test("days", () => {
    expect(canChiDay(1, 1, 2000)).toBe("Mậu Ngọ");
    expect(canChiDay(1, 1, 2000, "zh")).toBe("戊午");
  });
  test("months: the first month follows the year stem, leap shares it", () => {
    expect(canChiMonth(1, 2026)).toBe("Canh Dần");
    expect(canChiMonth(1, 2025)).toBe("Mậu Dần");
    expect(canChiMonth(12, 2025)).toBe("Kỷ Sửu");
    expect(canChiMonth(6, 2025)).toBe("Quý Mùi");
  });
});

describe("lunar: solar terms", () => {
  test("Đông chí 2026 begins on 2026-12-22 at tz 7", () => {
    // Solstice is 2026-12-21 20:50 UTC, which is 12-22 03:50 at +7.
    expect(solarTerm(21, 12, 2026)).toBe("Đại tuyết");
    expect(solarTerm(22, 12, 2026)).toBe("Đông chí");
    expect(solarTerm(22, 12, 2026, 7, "zh")).toBe("冬至");
    // At UTC the term already starts on the 21st.
    expect(solarTerm(21, 12, 2026, 0)).toBe("Đông chí");
  });
});

describe("lunar: lucky hours", () => {
  test("six hours, by day branch", () => {
    // 2025-10-06 is a Thân day.
    expect(luckyHours(6, 10, 2025)).toEqual(["Tý (23-1)", "Sửu (1-3)", "Thìn (7-9)", "Tỵ (9-11)", "Mùi (13-15)", "Tuất (19-21)"]);
    for (let d = 1; d <= 12; d++) expect(luckyHours(d, 1, 2026).length).toBe(6);
  });
});

describe("lunar: holidays", () => {
  test("Trung thu 2025 is 2025-10-06", () => {
    expect(lunarToSolar(15, 8, 2025, false)).toEqual([6, 10, 2025]);
    expect(lunarHoliday(solarToLunar(6, 10, 2025))).toBe("Tết Trung thu");
    expect(lunarHoliday(solarToLunar(6, 10, 2025), "zh")).toBe("中秋节");
  });

  test("Giao thừa of Ất Tỵ is 2026-02-16, month 12 has 29 days", () => {
    expect(solarToLunar(16, 2, 2026)).toEqual(lunar(29, 12, 2025));
    expect(lunarToSolar(30, 12, 2025, false)).toEqual([0, 0, 0]);
    expect(lunarHoliday(solarToLunar(16, 2, 2026))).toBe("Giao thừa");
    expect(lunarHoliday(solarToLunar(16, 2, 2026), "zh")).toBe("除夕");
    expect(lunarHoliday(solarToLunar(15, 2, 2026))).toBeNull();
  });

  test("Giao thừa on day 30 when month 12 is long", () => {
    // Lunar year Quý Mão ends on 30/12: Tết Giáp Thìn is 2024-02-10.
    expect(solarToLunar(9, 2, 2024)).toEqual(lunar(30, 12, 2023));
    expect(lunarHoliday(lunar(30, 12, 2023))).toBe("Giao thừa");
    expect(lunarHoliday(lunar(29, 12, 2023))).toBeNull();
  });

  test("fixed lunar festivals", () => {
    expect(lunarHoliday(lunar(1, 1, 2026))).toBe("Tết Nguyên Đán");
    expect(lunarHoliday(lunar(2, 1, 2026))).toBe("Mùng 2 Tết");
    expect(lunarHoliday(lunar(3, 1, 2026))).toBe("Mùng 3 Tết");
    expect(lunarHoliday(lunar(15, 1, 2026))).toBe("Rằm tháng Giêng");
    expect(lunarHoliday(lunar(3, 3, 2026))).toBe("Tết Hàn thực");
    expect(lunarHoliday(lunar(10, 3, 2026))).toBe("Giỗ Tổ Hùng Vương");
    expect(lunarHoliday(lunar(15, 4, 2026))).toBe("Lễ Phật đản");
    expect(lunarHoliday(lunar(5, 5, 2026))).toBe("Tết Đoan ngọ");
    expect(lunarHoliday(lunar(15, 7, 2026))).toBe("Lễ Vu Lan");
    expect(lunarHoliday(lunar(23, 12, 2026))).toBe("Ông Công Ông Táo");
    expect(lunarHoliday(lunar(1, 1, 2026), "zh")).toBe("春节");
    expect(lunarHoliday(lunar(10, 3, 2026), "zh")).toBe("雄王忌日");
  });

  test("Mùng 1 and Rằm in any month, leap included", () => {
    expect(lunarHoliday(lunar(1, 10, 2026))).toBe("Mùng 1");
    expect(lunarHoliday(lunar(15, 10, 2026))).toBe("Rằm");
    expect(lunarHoliday(lunar(1, 6, 2025, true))).toBe("Mùng 1");
    expect(lunarHoliday(lunar(15, 6, 2025, true), "zh")).toBe("十五");
    // A leap month 3 would not repeat Giỗ Tổ.
    expect(lunarHoliday(lunar(10, 3, 2026, true))).toBeNull();
    expect(lunarHoliday(lunar(20, 10, 2026))).toBeNull();
  });

  test("solar holidays", () => {
    expect(solarHoliday(1, 1)).toBe("Tết Dương lịch");
    expect(solarHoliday(30, 4)).toBe("Giải phóng miền Nam");
    expect(solarHoliday(2, 9)).toBe("Quốc khánh");
    expect(solarHoliday(20, 11)).toBe("Nhà giáo Việt Nam");
    expect(solarHoliday(2, 9, "zh")).toBe("国庆节");
    expect(solarHoliday(28, 11)).toBeNull();
  });
});

describe("lunar: month names", () => {
  test("vi and zh", () => {
    expect(lunarMonthName(1, false)).toBe("Giêng");
    expect(lunarMonthName(12, false)).toBe("Chạp");
    expect(lunarMonthName(6, true)).toBe("Sáu nhuận");
    expect(lunarMonthName(1, false, "zh")).toBe("正月");
    expect(lunarMonthName(12, false, "zh")).toBe("腊月");
    expect(lunarMonthName(6, true, "zh")).toBe("闰六月");
  });
});

describe("lunar: old WebView safe source", () => {
  test("no optional chaining, nullish, BigInt, Intl or em dash", () => {
    const src = readFileSync(new URL("../web/deck/src/lunar.ts", import.meta.url), "utf8");
    expect(src).not.toContain("?.");
    expect(src).not.toContain("??");
    expect(src).not.toMatch(/BigInt|\d+n\b|Intl\./);
    expect(src).not.toContain("\u2014");
  });
});
