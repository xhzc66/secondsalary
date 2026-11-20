/* =========================================================
 * storage.js — 本地数据与状态
 * localStorage 读写、默认配置、数据校验与迁移都集中在这里。
 * ========================================================= */
(function (global) {
  "use strict";

  const STORAGE_KEY = "secondsalary.state.v1";
  const STATE_VERSION = 3;
  const TOMBSTONE_RETENTION_DAYS = 400;

  const DEFAULT_SETTINGS = Object.freeze({
    defaultDailyWageCents: 30000,
    workStart: "09:00",
    workEnd: "18:00",
    breakEnabled: false,
    breakStart: "12:00",
    breakEnd: "13:00",
    overtimeMode: "multiplier",
    overtimeMultiplierBps: 150,
    overtimeHourlyCents: 5000
  });

  function cloneSettings(settings) {
    return {
      defaultDailyWageCents: settings.defaultDailyWageCents,
      workStart: settings.workStart,
      workEnd: settings.workEnd,
      breakEnabled: settings.breakEnabled,
      breakStart: settings.breakStart,
      breakEnd: settings.breakEnd,
      overtimeMode: settings.overtimeMode,
      overtimeMultiplierBps: settings.overtimeMultiplierBps,
      overtimeHourlyCents: settings.overtimeHourlyCents
    };
  }

  function normalizeSettings(raw) {
    const fallback = cloneSettings(DEFAULT_SETTINGS);
    if (!raw || typeof raw !== "object") return fallback;

    const result = cloneSettings(fallback);

    const wage = Number(raw.defaultDailyWageCents);
    if (Number.isInteger(wage) && wage > 0 && wage <= 1000000000) {
      result.defaultDailyWageCents = wage;
    }

    if (typeof raw.workStart === "string" && typeof raw.workEnd === "string") {
      const info = global.WageCore.scheduleInfo(raw.workStart, raw.workEnd);
      if (info.ok) {
        result.workStart = raw.workStart;
        result.workEnd = raw.workEnd;
      }
    }

    if (global.WageCore.parseTime(raw.breakStart) !== null) {
      result.breakStart = raw.breakStart;
    }
    if (global.WageCore.parseTime(raw.breakEnd) !== null) {
      result.breakEnd = raw.breakEnd;
    }
    result.breakEnabled = Boolean(raw.breakEnabled);
    if (result.breakEnabled) {
      const breakInfo = global.WageCore.scheduleInfo(result.workStart, result.workEnd, {
        enabled: true,
        start: result.breakStart,
        end: result.breakEnd
      });
      if (!breakInfo.ok) result.breakEnabled = false;
    }

    if (raw.overtimeMode === "hourly") {
      result.overtimeMode = "hourly";
    } else if (raw.overtimeMode === "multiplier") {
      result.overtimeMode = "multiplier";
    }

    const bps = Number(raw.overtimeMultiplierBps);
    if (Number.isInteger(bps) && bps >= 10 && bps <= 1000) {
      result.overtimeMultiplierBps = bps;
    }

    const hourly = Number(raw.overtimeHourlyCents);
    if (Number.isInteger(hourly) && hourly > 0 && hourly <= 1000000000) {
      result.overtimeHourlyCents = hourly;
    }

    return result;
  }

  function createSession(dateKey, settings) {
    const source = settings || DEFAULT_SETTINGS;
    return {
      date: dateKey,
      dailyWageCents: source.defaultDailyWageCents,
      workStart: source.workStart,
      workEnd: source.workEnd,
      breakEnabled: Boolean(source.breakEnabled),
      breakStart: source.breakStart,
      breakEnd: source.breakEnd,
      overtimeEnabled: false,
      accumulatedMs: 0,
      wasRunning: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  function normalizeSession(raw, settings) {
    const today = global.WageCore.todayKey();
    if (!raw || typeof raw !== "object") {
      return createSession(today, settings);
    }

    const date = global.WageCore.parseDateKey(raw.date) ? raw.date : today;
    const fallback = createSession(date, settings);
    const result = fallback;

    const wage = Number(raw.dailyWageCents);
    if (Number.isInteger(wage) && wage > 0 && wage <= 1000000000) {
      result.dailyWageCents = wage;
    }

    if (typeof raw.workStart === "string" && typeof raw.workEnd === "string") {
      const info = global.WageCore.scheduleInfo(raw.workStart, raw.workEnd);
      if (info.ok) {
        result.workStart = raw.workStart;
        result.workEnd = raw.workEnd;
      }
    }

    if (global.WageCore.parseTime(raw.breakStart) !== null) {
      result.breakStart = raw.breakStart;
    }
    if (global.WageCore.parseTime(raw.breakEnd) !== null) {
      result.breakEnd = raw.breakEnd;
    }
    result.breakEnabled = Boolean(raw.breakEnabled);
    if (result.breakEnabled) {
      const breakInfo = global.WageCore.scheduleInfo(result.workStart, result.workEnd, {
        enabled: true,
        start: result.breakStart,
        end: result.breakEnd
      });
      if (!breakInfo.ok) result.breakEnabled = false;
    }

    result.overtimeEnabled = Boolean(raw.overtimeEnabled);

    const accumulatedMs = Number(raw.accumulatedMs);
    if (Number.isFinite(accumulatedMs) && accumulatedMs >= 0) {
      result.accumulatedMs = Math.min(Math.floor(accumulatedMs), 315360000000);
    }

    result.wasRunning = Boolean(raw.wasRunning);

    if (typeof raw.createdAt === "string") result.createdAt = raw.createdAt;
    if (typeof raw.updatedAt === "string") result.updatedAt = raw.updatedAt;

    return result;
  }

  function normalizeRecord(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (!global.WageCore.parseDateKey(raw.date)) return null;

    const wage = Number(raw.dailyWageCents);
    if (!Number.isInteger(wage) || wage <= 0 || wage > 1000000000) return null;

    const breakEnabled = Boolean(raw.breakEnabled);
    const breakStart = global.WageCore.parseTime(raw.breakStart) !== null
      ? raw.breakStart
      : DEFAULT_SETTINGS.breakStart;
    const breakEnd = global.WageCore.parseTime(raw.breakEnd) !== null
      ? raw.breakEnd
      : DEFAULT_SETTINGS.breakEnd;
    const schedule = global.WageCore.scheduleInfo(raw.workStart, raw.workEnd, {
      enabled: breakEnabled,
      start: breakStart,
      end: breakEnd
    });
    if (!schedule.ok) return null;

    const workedSeconds = Math.max(0, Math.floor(Number(raw.workedSeconds) || 0));
    if (workedSeconds <= 0) return null;

    const config = {
      dailyWageCents: wage,
      workStart: raw.workStart,
      workEnd: raw.workEnd,
      breakEnabled: breakEnabled,
      breakStart: breakStart,
      breakEnd: breakEnd,
      overtimeEnabled: Boolean(raw.overtimeEnabled),
      overtimeMode: raw.overtimeMode === "hourly" ? "hourly" : "multiplier",
      overtimeMultiplierBps:
        Number.isInteger(Number(raw.overtimeMultiplierBps)) &&
        Number(raw.overtimeMultiplierBps) >= 10 &&
        Number(raw.overtimeMultiplierBps) <= 1000
          ? Number(raw.overtimeMultiplierBps)
          : DEFAULT_SETTINGS.overtimeMultiplierBps,
      overtimeHourlyCents:
        Number.isInteger(Number(raw.overtimeHourlyCents)) &&
        Number(raw.overtimeHourlyCents) > 0
          ? Number(raw.overtimeHourlyCents)
          : DEFAULT_SETTINGS.overtimeHourlyCents
    };

    const pay = global.WageCore.calcPay(config, workedSeconds);
    if (!pay) return null;

    return {
      date: raw.date,
      dailyWageCents: wage,
      workStart: raw.workStart,
      workEnd: raw.workEnd,
      breakEnabled: config.breakEnabled,
      breakStart: config.breakStart,
      breakEnd: config.breakEnd,
      standardSeconds: pay.totalSeconds,
      spanSeconds: pay.spanSeconds,
      breakSeconds: pay.breakSeconds,
      workedSeconds: pay.workedSeconds,
      standardWorkedSeconds: pay.standardWorkedSeconds,
      overtimeWorkedSeconds: pay.overtimeWorkedSeconds,
      overtimeEnabled: config.overtimeEnabled,
      overtimeMode: config.overtimeMode,
      overtimeMultiplierBps: config.overtimeMultiplierBps,
      overtimeHourlyCents: config.overtimeHourlyCents,
      standardPayCents: pay.standardCents,
      overtimePayCents: pay.overtimeCents,
      totalPayCents: pay.totalCents,
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString()
    };
  }

  function normalizeRecords(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const records = {};
    Object.keys(raw).forEach(function (key) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      const record = normalizeRecord(raw[key]);
      if (record) records[record.date] = record;
    });
    return records;
  }

  function normalizeDeletedRecords(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const result = {};
    const cutoff = Date.now() - TOMBSTONE_RETENTION_DAYS * 86400000;
    Object.keys(raw).forEach(function (key) {
      if (!global.WageCore.parseDateKey(key)) return;
      const stamp = Date.parse(raw[key]);
      if (!Number.isFinite(stamp) || stamp < cutoff) return;
      result[key] = new Date(stamp).toISOString();
    });
    return result;
  }

  function defaultState() {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    const now = new Date().toISOString();
    return {
      version: STATE_VERSION,
      settings: settings,
      settingsUpdatedAt: now,
      today: createSession(global.WageCore.todayKey(), settings),
      records: {},
      deletedRecords: {}
    };
  }

  function normalizeState(raw) {
    if (!raw || typeof raw !== "object") return defaultState();
    const fallback = defaultState();
    const settings = normalizeSettings(raw.settings);
    const settingsUpdatedAt =
      typeof raw.settingsUpdatedAt === "string" &&
      Number.isFinite(Date.parse(raw.settingsUpdatedAt))
        ? new Date(raw.settingsUpdatedAt).toISOString()
        : fallback.settingsUpdatedAt;
    const state = {
      version: STATE_VERSION,
      settings: settings,
      settingsUpdatedAt: settingsUpdatedAt,
      today: normalizeSession(raw.today, settings),
      records: normalizeRecords(raw.records),
      deletedRecords: normalizeDeletedRecords(raw.deletedRecords)
    };
    return state;
  }

  function load() {
    let raw = null;
    try {
      raw = global.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      return {
        state: defaultState(),
        warning: "无法读取本地存储，数据将只在本次打开期间保留。",
        storageError: true
      };
    }

    if (!raw) return { state: defaultState(), warning: null, storageError: false };

    try {
      const parsed = JSON.parse(raw);
      return {
        state: normalizeState(parsed),
        warning: null,
        storageError: false
      };
    } catch (error) {
      return {
        state: defaultState(),
        warning: "本地数据格式异常，已加载默认配置。",
        storageError: false
      };
    }
  }

  function save(state) {
    const payload = {
      version: STATE_VERSION,
      savedAt: new Date().toISOString(),
      settings: state.settings,
      settingsUpdatedAt: state.settingsUpdatedAt,
      today: state.today,
      records: state.records,
      deletedRecords: state.deletedRecords || {}
    };

    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      return { ok: true, error: null };
    } catch (error) {
      return {
        ok: false,
        error: error && error.name === "QuotaExceededError"
          ? "本地存储空间已满，请清理浏览器数据后重试。"
          : "本地保存失败，请检查浏览器是否禁用了 localStorage。"
      };
    }
  }

  function clear() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: "清空本地数据失败，请检查浏览器存储权限。" };
    }
  }

  global.SalaryStore = {
    STORAGE_KEY: STORAGE_KEY,
    STATE_VERSION: STATE_VERSION,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    cloneSettings: cloneSettings,
    normalizeSettings: normalizeSettings,
    createSession: createSession,
    normalizeRecord: normalizeRecord,
    normalizeRecords: normalizeRecords,
    normalizeDeletedRecords: normalizeDeletedRecords,
    defaultState: defaultState,
    normalizeState: normalizeState,
    load: load,
    save: save,
    clear: clear
  };
})(typeof window !== "undefined" ? window : globalThis);
