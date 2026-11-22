/* =========================================================
 * wage.js — 计薪核心
 * 时间、金额、精度和工资推导都集中在这里。
 * 金额内部使用「微厘」整数（1 厘 = 0.001 分），避免浮点累计误差。
 * ========================================================= */
(function (global) {
  "use strict";

  const MICRO_PER_CENT = 1000000n;
  const SECONDS_PER_DAY = 86400;
  const MAX_WAGE_CENTS = 1000000000; // ¥10,000,000.00
  const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  function pad2(value) {
    return String(value).padStart(2, "0");
  }

  function localDateKey(date) {
    const target = date instanceof Date ? date : new Date();
    return target.getFullYear() + "-" + pad2(target.getMonth() + 1) + "-" + pad2(target.getDate());
  }

  function todayKey() {
    return localDateKey(new Date());
  }

  function parseDateKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return { year: year, month: month, day: day, date: date };
  }

  function formatDateCN(key) {
    const parsed = parseDateKey(key);
    if (!parsed) return String(key || "");
    return parsed.month + "月" + parsed.day + "日";
  }

  function formatFullDateCN(key) {
    const parsed = parseDateKey(key);
    if (!parsed) return String(key || "");
    return parsed.year + "年" + parsed.month + "月" + parsed.day + "日";
  }

  function formatWeekdayCN(key, short) {
    const parsed = parseDateKey(key);
    if (!parsed) return "";
    const weekday = WEEKDAYS[parsed.date.getDay()];
    return short ? weekday : "星期" + weekday.charAt(1);
  }

  function formatDateWithWeekday(key, short) {
    const weekday = formatWeekdayCN(key, short);
    return formatDateCN(key) + (weekday ? " " + weekday : "");
  }

  function parseTime(value) {
    const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || "").trim());
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function minutesToTime(totalMinutes) {
    const normalized = ((Math.floor(Number(totalMinutes) || 0) % 1440) + 1440) % 1440;
    return pad2(Math.floor(normalized / 60)) + ":" + pad2(normalized % 60);
  }

  /**
   * 计算工作时段与计薪工时。
   * breakConfig: { enabled, start, end }，休息时间会从标准工时中扣除。
   * 返回的 seconds / minutes 是扣除休息后的计薪时长。
   */
  function scheduleInfo(start, end, breakConfig) {
    const startMinutes = parseTime(start);
    const endMinutes = parseTime(end);
    if (startMinutes === null || endMinutes === null) {
      return { ok: false, error: "请选择完整的开始和结束时间" };
    }
    if (startMinutes === endMinutes) {
      return { ok: false, error: "开始时间和结束时间不能相同" };
    }

    const crossDay = endMinutes < startMinutes;
    const endAbsolute = endMinutes + (crossDay ? 1440 : 0);
    const spanMinutes = endAbsolute - startMinutes;
    if (spanMinutes <= 0) {
      return { ok: false, error: "工作时间段无效，请重新选择" };
    }

    const enabled = Boolean(breakConfig && breakConfig.enabled);
    let breakMinutes = 0;
    let breakStartAbsolute = null;
    let breakEndAbsolute = null;

    if (enabled) {
      const breakStartMinutes = parseTime(breakConfig.start);
      const breakEndMinutes = parseTime(breakConfig.end);
      if (breakStartMinutes === null || breakEndMinutes === null) {
        return { ok: false, error: "请选择完整的休息开始和结束时间" };
      }
      if (breakStartMinutes === breakEndMinutes) {
        return { ok: false, error: "休息开始时间和结束时间不能相同" };
      }

      breakStartAbsolute = breakStartMinutes;
      breakEndAbsolute = breakEndMinutes;
      while (breakStartAbsolute < startMinutes) breakStartAbsolute += 1440;
      while (breakEndAbsolute < startMinutes) breakEndAbsolute += 1440;
      if (breakEndAbsolute <= breakStartAbsolute) breakEndAbsolute += 1440;

      if (breakStartAbsolute < startMinutes || breakEndAbsolute > endAbsolute) {
        return {
          ok: false,
          error: "休息时间必须位于工作时段内，并支持整段跨天"
        };
      }

      breakMinutes = breakEndAbsolute - breakStartAbsolute;
      if (breakMinutes >= spanMinutes) {
        return { ok: false, error: "休息时间不能覆盖整个工作时段" };
      }
    }

    const paidMinutes = spanMinutes - breakMinutes;
    return {
      ok: true,
      seconds: paidMinutes * 60,
      minutes: paidMinutes,
      spanSeconds: spanMinutes * 60,
      spanMinutes: spanMinutes,
      breakEnabled: enabled,
      breakSeconds: breakMinutes * 60,
      breakMinutes: breakMinutes,
      breakStart: breakConfig ? breakConfig.start : "",
      breakEnd: breakConfig ? breakConfig.end : "",
      crossDay: crossDay,
      startMinutes: startMinutes,
      endMinutes: endMinutes,
      endAbsoluteMinutes: endAbsolute,
      breakStartMinutes: breakStartAbsolute,
      breakEndMinutes: breakEndAbsolute
    };
  }

  /**
   * 为当前班次推荐一个合法休息段。优先使用 12:00–13:00；
   * 若不在工作时段内，则取班次中部，最长 60 分钟。
   */
  function suggestBreak(start, end) {
    const base = scheduleInfo(start, end);
    if (!base.ok) return { ok: false, error: base.error };

    const preferred = scheduleInfo(start, end, {
      enabled: true,
      start: "12:00",
      end: "13:00"
    });
    if (preferred.ok) {
      return {
        ok: true,
        breakStart: "12:00",
        breakEnd: "13:00",
        breakSeconds: preferred.breakSeconds,
        breakMinutes: preferred.breakMinutes
      };
    }

    if (base.spanMinutes < 2) {
      return { ok: false, error: "工作时段太短，无法再扣除休息时间" };
    }

    const breakMinutes = Math.min(60, Math.max(1, Math.floor(base.spanMinutes / 4)));
    const offset = Math.floor((base.spanMinutes - breakMinutes) / 2);
    const startAbsolute = base.startMinutes + offset;
    const endAbsolute = startAbsolute + breakMinutes;
    return {
      ok: true,
      breakStart: minutesToTime(startAbsolute),
      breakEnd: minutesToTime(endAbsolute),
      breakSeconds: breakMinutes * 60,
      breakMinutes: breakMinutes
    };
  }

  function formatDuration(totalSeconds) {
    const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const seconds = value % 60;
    return pad2(hours) + ":" + pad2(minutes) + ":" + pad2(seconds);
  }

  function formatDurationShort(totalSeconds) {
    const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    if (hours > 0) return hours + " 小时 " + pad2(minutes) + " 分";
    if (minutes > 0) return minutes + " 分钟";
    return value + " 秒";
  }

  function formatDurationTight(totalSeconds) {
    const value = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    return hours + " 小时 " + pad2(minutes) + " 分";
  }

  function formatHoursDecimal(totalSeconds) {
    return (Math.max(0, Number(totalSeconds) || 0) / 3600).toFixed(1);
  }

  /**
   * 金额输入 → 分（整数）
   * 只接受正数，最多两位小数。
   */
  function parseMoneyToCents(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw)
      .trim()
      .replace(/[¥￥,\s]/g, "");

    if (!text) return { ok: false, error: "请输入金额" };
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      return { ok: false, error: "请输入有效金额，最多保留两位小数" };
    }

    const parts = text.split(".");
    const whole = parts[0];
    const fraction = (parts[1] || "").padEnd(2, "0");
    const cents = BigInt(whole) * 100n + BigInt(fraction);

    if (cents <= 0n) return { ok: false, error: "金额必须大于 0" };
    if (cents > BigInt(MAX_WAGE_CENTS)) {
      return { ok: false, error: "金额不能超过 10,000,000 元" };
    }

    return { ok: true, cents: Number(cents), text: text };
  }

  function parseMultiplierToBps(raw) {
    const text = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!text) return { ok: false, error: "请输入加班倍率" };
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
      return { ok: false, error: "请输入有效倍率，最多保留两位小数" };
    }
    const parts = text.split(".");
    const whole = parts[0];
    const fraction = (parts[1] || "").padEnd(2, "0");
    const bps = Number(whole) * 100 + Number(fraction);
    if (bps < 10) return { ok: false, error: "加班倍率不能低于 0.1 倍" };
    if (bps > 1000) return { ok: false, error: "加班倍率不能高于 10 倍" };
    return { ok: true, bps: bps, text: text };
  }

  function formatMultiplier(bps) {
    const value = Number(bps) / 100;
    return String(Number(value.toFixed(2)));
  }

  function formatMoney(cents) {
    let value;
    try {
      value = typeof cents === "bigint" ? cents : BigInt(Math.round(Number(cents) || 0));
    } catch (error) {
      value = 0n;
    }
    const negative = value < 0n;
    const absolute = negative ? -value : value;
    const whole = absolute / 100n;
    const fraction = String(absolute % 100n).padStart(2, "0");
    const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (negative ? "-" : "") + grouped + "." + fraction;
  }

  function formatMoneyFromMicro(micro) {
    let value;
    try {
      value = typeof micro === "bigint" ? micro : BigInt(Math.floor(Number(micro) || 0));
    } catch (error) {
      value = 0n;
    }
    if (value < 0n) value = 0n;
    return formatMoney(value / MICRO_PER_CENT);
  }

  function formatPerSecond(centsPerSecond) {
    const value = Math.max(0, Number(centsPerSecond) || 0) / 100;
    return value.toFixed(6);
  }

  function formatHourlyYuan(cents) {
    return formatMoney(Math.round(Number(cents) || 0));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getRates(config) {
    const info = scheduleInfo(config.workStart, config.workEnd, {
      enabled: Boolean(config.breakEnabled),
      start: config.breakStart,
      end: config.breakEnd
    });
    if (!info.ok) return null;

    const totalSeconds = info.seconds;
    const dailyCents = Math.max(0, Number(config.dailyWageCents) || 0);
    const standardPerSecondCents = dailyCents / totalSeconds;
    const standardHourlyCents = standardPerSecondCents * 3600;
    let overtimePerSecondCents = 0;
    let overtimeHourlyCents = 0;

    if (config.overtimeMode === "hourly") {
      overtimeHourlyCents = Math.max(0, Number(config.overtimeHourlyCents) || 0);
      overtimePerSecondCents = overtimeHourlyCents / 3600;
    } else {
      const multiplier = Math.max(0, Number(config.overtimeMultiplierBps) || 0) / 100;
      overtimePerSecondCents = standardPerSecondCents * multiplier;
      overtimeHourlyCents = standardHourlyCents * multiplier;
    }

    return {
      totalSeconds: totalSeconds,
      minutes: info.minutes,
      spanSeconds: info.spanSeconds,
      breakSeconds: info.breakSeconds,
      breakMinutes: info.breakMinutes,
      crossDay: info.crossDay,
      standardPerSecondCents: standardPerSecondCents,
      overtimePerSecondCents: overtimePerSecondCents,
      standardHourlyCents: standardHourlyCents,
      overtimeHourlyCents: overtimeHourlyCents
    };
  }

  /**
   * 核心计薪函数。
   * 计时按实际累计秒数推进：前 standardSeconds 秒属于标准时段，
   * 之后若开启加班则进入加班时段。
   */
  function calcPay(config, workedSeconds) {
    const info = scheduleInfo(config.workStart, config.workEnd, {
      enabled: Boolean(config.breakEnabled),
      start: config.breakStart,
      end: config.breakEnd
    });
    if (!info.ok) return null;

    const totalSeconds = info.seconds;
    const worked = Math.max(0, Math.floor(Number(workedSeconds) || 0));
    const standardWorked = Math.min(worked, totalSeconds);
    const overtimeWorked = config.overtimeEnabled
      ? Math.max(0, worked - totalSeconds)
      : 0;

    const baseCents = BigInt(Math.max(0, Math.round(Number(config.dailyWageCents) || 0)));
    const totalSecondsBig = BigInt(totalSeconds);
    const standardMicro =
      (baseCents * BigInt(standardWorked) * MICRO_PER_CENT) / totalSecondsBig;

    let overtimeMicro = 0n;
    if (config.overtimeEnabled && overtimeWorked > 0) {
      if (config.overtimeMode === "hourly") {
        const hourlyCents = BigInt(
          Math.max(0, Math.round(Number(config.overtimeHourlyCents) || 0))
        );
        overtimeMicro =
          (hourlyCents * BigInt(overtimeWorked) * MICRO_PER_CENT) / 3600n;
      } else {
        const multiplierBps = BigInt(
          Math.max(0, Math.round(Number(config.overtimeMultiplierBps) || 0))
        );
        overtimeMicro =
          (baseCents *
            BigInt(overtimeWorked) *
            multiplierBps *
            MICRO_PER_CENT) /
          (totalSecondsBig * 100n);
      }
    }

    // 展示金额四舍五入到分；内部仍使用微厘整数，避免累计漂移。
    const roundToCents = function (micro) {
      return Number((micro + MICRO_PER_CENT / 2n) / MICRO_PER_CENT);
    };
    const standardCents = roundToCents(standardMicro);
    const overtimeCents = roundToCents(overtimeMicro);
    const rates = getRates(config);

    return {
      totalSeconds: totalSeconds,
      spanSeconds: info.spanSeconds,
      breakSeconds: info.breakSeconds,
      breakMinutes: info.breakMinutes,
      breakEnabled: info.breakEnabled,
      workedSeconds: worked,
      standardWorkedSeconds: standardWorked,
      overtimeWorkedSeconds: overtimeWorked,
      unpaidSeconds: config.overtimeEnabled
        ? 0
        : Math.max(0, worked - standardWorked),
      standardMicro: standardMicro,
      overtimeMicro: overtimeMicro,
      standardCents: standardCents,
      overtimeCents: overtimeCents,
      totalCents: standardCents + overtimeCents,
      rates: rates
    };
  }

  function dateTimeMs(dateKey, time) {
    const parsed = parseDateKey(dateKey);
    const minutes = parseTime(time);
    if (!parsed || minutes === null) return null;
    return new Date(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      Math.floor(minutes / 60),
      minutes % 60,
      0,
      0
    ).getTime();
  }

  function parsePauseIntervals(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.map(function (item) {
      const start = Date.parse(item && item.start);
      const end = item && item.end ? Date.parse(item.end) : null;
      if (!Number.isFinite(start)) return null;
      return {
        start: start,
        end: Number.isFinite(end) ? Math.max(start, end) : null
      };
    }).filter(Boolean).sort(function (a, b) { return a.start - b.start; });
  }

  function subtractPauses(segmentStart, segmentEnd, pauses, nowMs) {
    if (segmentEnd <= segmentStart) return 0;
    let paused = 0;
    pauses.forEach(function (pause) {
      const pauseEnd = pause.end === null ? nowMs : pause.end;
      const overlap = Math.max(0, Math.min(segmentEnd, pauseEnd) - Math.max(segmentStart, pause.start));
      paused += overlap;
    });
    return Math.max(0, segmentEnd - segmentStart - paused);
  }

  /**
   * 自动计薪：根据班次时钟计算截至 nowMs 的计薪秒数。
   * 不依赖页面是否可见；暂停区间会从标准/加班时长中扣除。
   */
  function autoWork(config, dateKey, nowMs, pauseIntervals) {
    const info = scheduleInfo(config.workStart, config.workEnd, {
      enabled: Boolean(config.breakEnabled),
      start: config.breakStart,
      end: config.breakEnd
    });
    if (!info.ok) return null;

    const parsed = parseDateKey(dateKey);
    if (!parsed) return null;
    const now = Number(nowMs) || Date.now();
    const dayStart = new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime();
    const shiftStart = dayStart + info.startMinutes * 60000;
    const shiftEnd = dayStart + info.endAbsoluteMinutes * 60000;
    const breakStart = info.breakEnabled ? dayStart + info.breakStartMinutes * 60000 : null;
    const breakEnd = info.breakEnabled ? dayStart + info.breakEndMinutes * 60000 : null;
    const pauses = parsePauseIntervals(pauseIntervals);
    const isPaused = pauses.some(function (pause) {
      return pause.end === null || (now >= pause.start && now < pause.end);
    });

    const segments = info.breakEnabled
      ? [[shiftStart, breakStart], [breakEnd, shiftEnd]]
      : [[shiftStart, shiftEnd]];

    let standardMs = 0;
    segments.forEach(function (segment) {
      const segmentEnd = Math.min(segment[1], now);
      if (segmentEnd > segment[0]) {
        standardMs += subtractPauses(segment[0], segmentEnd, pauses, now);
      }
    });

    const standardTotalSeconds = info.seconds;
    let standardSeconds = Math.floor(standardMs / 1000);
    standardSeconds = Math.min(standardSeconds, standardTotalSeconds);

    const overtimeCapMs = 8 * 3600 * 1000;
    let overtimeSeconds = 0;
    if (config.overtimeEnabled && now > shiftEnd) {
      const otEnd = Math.min(now, shiftEnd + overtimeCapMs);
      const otMs = subtractPauses(shiftEnd, otEnd, pauses, now);
      overtimeSeconds = Math.min(8 * 3600, Math.floor(otMs / 1000));
    }

    let phase = "working";
    if (isPaused) phase = "paused";
    else if (now < shiftStart) phase = "before";
    else if (info.breakEnabled && now >= breakStart && now < breakEnd) phase = "break";
    else if (now >= shiftEnd) {
      phase = config.overtimeEnabled && now < shiftEnd + overtimeCapMs ? "overtime" : "off";
    }

    return {
      dateKey: dateKey,
      phase: phase,
      isPaused: isPaused,
      shiftStartMs: shiftStart,
      shiftEndMs: shiftEnd,
      breakStartMs: breakStart,
      breakEndMs: breakEnd,
      standardSeconds: standardSeconds,
      overtimeSeconds: overtimeSeconds,
      totalSeconds: standardSeconds + overtimeSeconds,
      standardTotalSeconds: standardTotalSeconds,
      standardMs: standardMs,
      overtimeMs: overtimeSeconds * 1000,
      capReached: config.overtimeEnabled && now >= shiftEnd + overtimeCapMs
    };
  }

  function currentMonthKey(date) {
    const target = date instanceof Date ? date : new Date();
    return target.getFullYear() + "-" + pad2(target.getMonth() + 1);
  }

  function parseMonthKey(monthKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || ""));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { year: year, month: month };
  }

  function formatMonthCN(monthKey) {
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return "";
    return parsed.year + "年" + pad2(parsed.month) + "月";
  }

  function shiftMonth(monthKey, delta) {
    const parsed = parseMonthKey(monthKey);
    if (!parsed) return currentMonthKey();
    const date = new Date(parsed.year, parsed.month - 1 + delta, 1, 12, 0, 0, 0);
    return currentMonthKey(date);
  }

  function isToday(key) {
    return key === todayKey();
  }

  global.WageCore = {
    MICRO_PER_CENT: MICRO_PER_CENT,
    SECONDS_PER_DAY: SECONDS_PER_DAY,
    WEEKDAYS: WEEKDAYS,
    pad2: pad2,
    localDateKey: localDateKey,
    todayKey: todayKey,
    parseDateKey: parseDateKey,
    parseTime: parseTime,
    minutesToTime: minutesToTime,
    dateTimeMs: dateTimeMs,
    parsePauseIntervals: parsePauseIntervals,
    autoWork: autoWork,
    scheduleInfo: scheduleInfo,
    suggestBreak: suggestBreak,
    formatDuration: formatDuration,
    formatDurationShort: formatDurationShort,
    formatDurationTight: formatDurationTight,
    formatHoursDecimal: formatHoursDecimal,
    formatDateCN: formatDateCN,
    formatFullDateCN: formatFullDateCN,
    formatWeekdayCN: formatWeekdayCN,
    formatDateWithWeekday: formatDateWithWeekday,
    parseMoneyToCents: parseMoneyToCents,
    parseMultiplierToBps: parseMultiplierToBps,
    formatMultiplier: formatMultiplier,
    formatMoney: formatMoney,
    formatMoneyFromMicro: formatMoneyFromMicro,
    formatPerSecond: formatPerSecond,
    formatHourlyYuan: formatHourlyYuan,
    clamp: clamp,
    getRates: getRates,
    calcPay: calcPay,
    currentMonthKey: currentMonthKey,
    parseMonthKey: parseMonthKey,
    formatMonthCN: formatMonthCN,
    shiftMonth: shiftMonth,
    isToday: isToday
  };
})(typeof window !== "undefined" ? window : globalThis);
