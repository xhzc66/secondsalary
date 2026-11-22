/* =========================================================
 * app.js — 界面、计时器与交互
 * 依赖 wage.js（计薪核心）与 storage.js（本地状态）
 * ========================================================= */
(function () {
  "use strict";

  const W = window.WageCore;
  const Store = window.SalaryStore;
  const $ = function (id) { return document.getElementById(id); };

  const dom = {};
  const runtime = {
    running: false,
    baseMs: 0,
    runStartedAt: 0,
    lastPersistAt: 0,
    lastSecond: -1,
    lastPhase: "",
    lastCents: null,
    amountAnimationTimer: 0,
    persistFailures: 0,
    storageErrorShown: false
  };

  const ui = {
    view: "today",
    month: W.currentMonthKey(),
    settingsDirty: false,
    lastClock: "",
    lastSavedLabel: "自动保存已开启",
    initialToasts: [],
    cloudTab: "create",
    cloudConnected: false,
    cloudMemberScope: "me",
    cloudStatus: null,
    localStorageError: false,
    pendingCloudSpace: "",
    cloudAutoConnectTried: false,
    ledgerType: "expense",
    aiAdvice: "",
    aiAdviceLoading: false
  };

  let state = null;
  let session = null;
  let pendingDialog = null;

  /* =======================================================
   * Boot
   * ======================================================= */
  function init() {
    cacheDom();
    const loaded = Store.load();
    state = loaded.state;
    session = state.today;

    bindEvents();
    restoreSession(loaded);
    fillSettingsForm(state.settings);
    renderAll();
    activateView(readInitialView(), { updateHash: false, focus: false, scroll: false });
    ensureCurrentWorkday();
    updateClock();
    window.setInterval(tick, 250);

    if (loaded.storageError) {
      setStorageUnavailable();
    }
    if (loaded.warning && !loaded.storageError) {
      window.setTimeout(function () { showToast(loaded.warning, "warning", 4200); }, 500);
    }
    ui.initialToasts.forEach(function (toast, index) {
      window.setTimeout(function () { showToast(toast.message, toast.type, 3800); }, 620 + index * 260);
    });

    initCloudSync();
  }

  function cacheDom() {
    [
      "headerClock", "storageChip", "storageChipText",
      "todayDateLabel", "todayWeekdayLabel", "saveIndicator", "saveIndicatorText", "dataScopeNote",
      "statusPill", "statusText", "heroDate", "liveAmount", "amountNote", "notePulse", "amountNoteText",
      "standardPay", "standardMeta", "overtimePay", "overtimeMeta", "workedTime", "workedMeta",
      "perSecondRate", "perSecondMeta", "progressLabel", "progressPercent", "progressTrack", "progressFill",
      "progressFootLeft", "progressFootRight", "startBtn", "startBtnText", "resetBtn",
      "dailyWageInput", "wageError", "workStartInput", "workEndInput", "standardDuration", "timeError",
      "breakToggle", "breakFields", "breakStartInput", "breakEndInput", "breakOffLabel", "breakHint", "breakError",
      "crossDayBadge", "dayMemberBadge", "overtimeToggle", "overtimeRuleText", "overtimeRuleDetail", "settingsLink",
      "restTomorrowToggle", "restTomorrowHint",
      "dayBasePotential", "dayOtPotential", "dayPotential",
      "jumpOverviewBtn", "monthPicker", "prevMonthBtn", "nextMonthBtn", "currentMonthBtn", "recordCount",
      "exportCsvBtn", "summaryTotal", "summaryTotalSub", "summaryBase", "summaryBaseSub", "summaryOt",
      "summaryOtSub", "summaryDays", "summaryDaysSub", "compositionMonth", "compositionTotal",
      "compositionBase", "compositionOt", "compositionBasePct", "compositionOtPct", "overviewMonthLabel",
      "recordsTable", "tableWrap", "recordsBody", "emptyState", "recordsSubhead",
      "memberFilterWrap", "memberFilter", "settingsForm",
      "defaultWageInput", "defaultWageError", "settingsStart", "settingsEnd", "settingsDurationPreview",
      "settingsTimeError", "settingsBreakToggle", "settingsBreakChip", "settingsBreakFields",
      "settingsBreakStart", "settingsBreakEnd", "settingsBreakHint", "settingsBreakError",
      "modeMultiplier", "modeHourly", "multiplierField", "multiplierInput",
      "multiplierError", "hourlyField", "hourlyInput", "hourlyError", "previewStandardHourly",
      "previewOtHourly", "previewOtSecond", "saveSettingsBtn", "resetSettingsBtn", "settingsStatus",
      "settingsDirtyDot", "localRecordCount", "clearDataBtn", "cloudDialog", "cloudClose",
      "cloudIntro", "cloudTabs", "cloudCreatePane", "cloudJoinPane", "cloudConnectedPane",
      "cloudCreateForm", "cloudEmail", "cloudCreatePass", "cloudCreateConfirm", "cloudCreateName",
      "cloudCreateError", "cloudCreateBtn", "cloudJoinForm", "cloudSpaceInput", "cloudJoinPass",
      "cloudJoinName", "cloudJoinError", "cloudJoinBtn", "cloudMemberText", "cloudSpaceText",
      "cloudMembersText", "cloudSyncText", "cloudLastSync", "cloudSyncNowBtn", "cloudCopyLinkBtn",
      "cloudDisconnectBtn", "cloudMemberCountLabel",
      "confirmDialog", "dialogIcon", "confirmTitle", "confirmMessage", "confirmCancel", "confirmAccept", "toastRegion",
      "goalStrip", "goalStripTitle", "goalStripHeadline", "goalStripGap", "goalStripSaved", "goalStripTarget", "goalStripPercent", "goalStripFill", "goalJumpBtn",
      "wishlistTitle", "wishlistSubtitle", "wishlistHeroTarget", "wishlistHeroSaved", "wishlistSaved",
      "wishlistGap", "wishlistGapSub", "wishlistProgress", "wishlistProgressFill", "wishlistProgressSub",
      "wishlistEta", "wishlistEtaSub", "ledgerForm", "ledgerDate", "ledgerTypeExpense", "ledgerTypeIncome",
      "ledgerCategory", "ledgerAmount", "ledgerNote", "ledgerError", "ledgerSubmitBtn",
      "ledgerMonthExpense", "ledgerMonthIncome", "ledgerMonthNet", "ledgerCount", "ledgerList", "ledgerEmpty",
      "aiInsights", "aiStatus", "aiRefreshBtn", "aiDeepBtn", "wishlistConfigForm", "wishlistTargetInput",
      "wishlistInitialInput", "wishlistConfigError", "wishlistConfigStatus", "wishlistSaveBtn"
    ].forEach(function (id) { dom[id] = $(id); });
  }

  function restoreSession(loaded) {
    runtime.running = false;
    runtime.runStartedAt = 0;
    runtime.baseMs = 0;
    runtime.lastSecond = -1;
    runtime.lastPhase = "";
    session.accumulatedMs = 0;
    session.wasRunning = false;

    if (loaded.storageError) {
      setStorageUnavailable();
    }

    persistState({ updateRecord: false, silent: true });
  }

  function readInitialView() {
    const hash = String(window.location.hash || "").replace("#", "");
    if (hash === "today" || hash === "overview" || hash === "wishlist" || hash === "settings") return hash;
    return "today";
  }

  /* =======================================================
   * Time & persistence
   * ======================================================= */
  function offsetDateKey(dateKey, days) {
    const parsed = W.parseDateKey(dateKey);
    if (!parsed) return dateKey;
    const date = new Date(parsed.year, parsed.month - 1, parsed.day + days, 12, 0, 0, 0);
    return W.localDateKey(date);
  }

  function settingsConfig() {
    return {
      dailyWageCents: state.settings.defaultDailyWageCents,
      workStart: state.settings.workStart,
      workEnd: state.settings.workEnd,
      breakEnabled: state.settings.breakEnabled,
      breakStart: state.settings.breakStart,
      breakEnd: state.settings.breakEnd,
      overtimeEnabled: false,
      overtimeMode: state.settings.overtimeMode,
      overtimeMultiplierBps: state.settings.overtimeMultiplierBps,
      overtimeHourlyCents: state.settings.overtimeHourlyCents
    };
  }

  function dayConfig(source) {
    const target = source || session;
    return {
      dailyWageCents: target.dailyWageCents,
      workStart: target.workStart,
      workEnd: target.workEnd,
      breakEnabled: target.breakEnabled,
      breakStart: target.breakStart,
      breakEnd: target.breakEnd,
      overtimeEnabled: target.overtimeEnabled,
      overtimeMode: state.settings.overtimeMode,
      overtimeMultiplierBps: state.settings.overtimeMultiplierBps,
      overtimeHourlyCents: state.settings.overtimeHourlyCents
    };
  }

  function shiftWindowFor(dateKey, config) {
    const info = W.scheduleInfo(config.workStart, config.workEnd, {
      enabled: Boolean(config.breakEnabled),
      start: config.breakStart,
      end: config.breakEnd
    });
    if (!info.ok) return null;
    const start = W.dateTimeMs(dateKey, config.workStart);
    if (start === null) return null;
    return {
      start: start,
      end: start + (info.endAbsoluteMinutes - info.startMinutes) * 60000,
      info: info
    };
  }

  function restAutoResult(dateKey, config) {
    const window = shiftWindowFor(dateKey, config);
    return {
      dateKey: dateKey,
      phase: "rest",
      isPaused: false,
      shiftStartMs: window ? window.start : null,
      shiftEndMs: window ? window.end : null,
      breakStartMs: null,
      breakEndMs: null,
      standardSeconds: 0,
      overtimeSeconds: 0,
      totalSeconds: 0,
      standardTotalSeconds: window ? window.info.seconds : 0,
      standardMs: 0,
      overtimeMs: 0,
      capReached: false
    };
  }

  function autoForSession(targetSession, atMs) {
    if (!targetSession) return null;
    const config = dayConfig(targetSession);
    if (state.restDays && state.restDays[targetSession.date]) {
      return restAutoResult(targetSession.date, config);
    }
    return W.autoWork(config, targetSession.date, atMs || Date.now(), targetSession.pauseIntervals || []);
  }

  function currentAuto(atMs) {
    return autoForSession(session, atMs || Date.now());
  }

  function activeSeconds() {
    const auto = currentAuto();
    return auto ? auto.totalSeconds : 0;
  }

  function activeMilliseconds() {
    return activeSeconds() * 1000;
  }

  function currentPay() {
    const auto = currentAuto();
    if (!auto || auto.phase === "rest") {
      const pay = W.calcPay(dayConfig(), 0);
      if (pay && auto) pay.auto = auto;
      return pay;
    }
    const pay = W.calcPay(dayConfig(), auto.totalSeconds);
    if (pay) pay.auto = auto;
    return pay;
  }

  function buildRecordFor(targetSession, atMs) {
    if (!targetSession) return null;
    const auto = autoForSession(targetSession, atMs || Date.now());
    if (!auto || auto.phase === "rest" || auto.totalSeconds <= 0) return null;
    const config = dayConfig(targetSession);
    const pay = W.calcPay(config, auto.totalSeconds);
    if (!pay) return null;
    return {
      date: targetSession.date,
      dailyWageCents: targetSession.dailyWageCents,
      workStart: targetSession.workStart,
      workEnd: targetSession.workEnd,
      breakEnabled: targetSession.breakEnabled,
      breakStart: targetSession.breakStart,
      breakEnd: targetSession.breakEnd,
      pauseIntervals: targetSession.pauseIntervals || [],
      standardSeconds: pay.totalSeconds,
      spanSeconds: pay.spanSeconds,
      breakSeconds: pay.breakSeconds,
      workedSeconds: pay.workedSeconds,
      standardWorkedSeconds: pay.standardWorkedSeconds,
      overtimeWorkedSeconds: pay.overtimeWorkedSeconds,
      overtimeEnabled: targetSession.overtimeEnabled,
      overtimeMode: config.overtimeMode,
      overtimeMultiplierBps: config.overtimeMultiplierBps,
      overtimeHourlyCents: config.overtimeHourlyCents,
      standardPayCents: pay.standardCents,
      overtimePayCents: pay.overtimeCents,
      totalPayCents: pay.totalCents,
      updatedAt: new Date().toISOString()
    };
  }

  function persistState(options) {
    const opts = options || {};
    const now = Date.now();
    const auto = currentAuto(now);
    session.accumulatedMs = auto ? auto.totalSeconds * 1000 : 0;
    session.wasRunning = false;
    session.updatedAt = new Date().toISOString();

    if (!state.deletedRecords) state.deletedRecords = {};

    if (opts.updateRecord !== false) {
      const record = buildRecordFor(session, now);
      if (record) {
        state.records[session.date] = record;
        delete state.deletedRecords[session.date];
      }
    }

    const result = Store.save({
      settings: state.settings,
      settingsUpdatedAt: state.settingsUpdatedAt,
      today: session,
      records: state.records,
      deletedRecords: state.deletedRecords,
      restDays: state.restDays,
      restDayUpdated: state.restDayUpdated,
      wishlist: state.wishlist,
      ledger: state.ledger
    });

    runtime.lastPersistAt = performance.now();

    if (result.ok) {
      runtime.persistFailures = 0;
      if (!opts.silent) setSaveIndicator("saved");
      else setSaveIndicator("saved");
      if (opts.cloudDirty !== false && window.CloudSync && window.CloudSync.isConnected() && !window.CloudSync.isApplying()) {
        window.CloudSync.markDirty();
      }
    } else {
      runtime.persistFailures += 1;
      setSaveIndicator("error");
      setStorageUnavailable();
      if (!runtime.storageErrorShown) {
        runtime.storageErrorShown = true;
        showToast(result.error || "本地保存失败", "error", 4600);
      }
    }
    return result.ok;
  }

  function resolveWorkdayDate(nowMs) {
    const today = W.localDateKey(new Date(nowMs));
    const yesterday = offsetDateKey(today, -1);
    const yesterdaySession = session.date === yesterday ? session : null;
    const yesterdayConfig = yesterdaySession ? dayConfig(yesterdaySession) : settingsConfig();
    const yesterdayWindow = shiftWindowFor(yesterday, yesterdayConfig);
    if (
      yesterdayWindow &&
      yesterdayWindow.info.crossDay &&
      nowMs >= yesterdayWindow.start &&
      nowMs < yesterdayWindow.end
    ) {
      return yesterday;
    }
    return today;
  }

  function finalizeSessionRecord(targetSession, nowMs) {
    if (!targetSession) return null;
    if (state.restDays && state.restDays[targetSession.date]) return null;
    const tomb = Date.parse(state.deletedRecords && state.deletedRecords[targetSession.date]);
    const existing = state.records[targetSession.date];
    if (tomb && (!existing || Date.parse(existing.updatedAt) <= tomb)) return null;
    const auto = autoForSession(targetSession, nowMs);
    if (!auto || !auto.shiftEndMs) return null;
    const cutoff = Math.min(nowMs, auto.shiftEndMs);
    const record = buildRecordFor(targetSession, cutoff);
    if (record) state.records[record.date] = record;
    return record;
  }

  function backfillMissedWorkdays(activeDate, nowMs) {
    if (!session || session.date >= activeDate) return;
    const oldDate = session.date;
    const dates = [];
    let cursor = oldDate;
    let guard = 0;
    while (cursor < activeDate && guard < 31) {
      dates.push(cursor);
      cursor = offsetDateKey(cursor, 1);
      guard += 1;
    }

    dates.forEach(function (date) {
      if (state.restDays && state.restDays[date]) return;
      const tomb = Date.parse(state.deletedRecords && state.deletedRecords[date]);
      const existing = state.records[date];
      if (tomb && (!existing || Date.parse(existing.updatedAt) <= tomb)) return;
      const target = date === oldDate ? session : Store.createSession(date, state.settings);
      if (date !== oldDate && state.records[date]) return;
      const window = shiftWindowFor(date, dayConfig(target));
      if (!window) return;
      const record = buildRecordFor(target, window.end);
      if (record) state.records[record.date] = record;
    });
  }

  function ensureCurrentWorkday(nowMs) {
    const now = nowMs || Date.now();
    const activeDate = resolveWorkdayDate(now);
    if (session.date === activeDate) return false;

    backfillMissedWorkdays(activeDate, now);
    finalizeSessionRecord(session, now);

    state.today = Store.createSession(activeDate, state.settings);
    session = state.today;
    runtime.lastSecond = -1;
    runtime.lastPhase = "";
    runtime.lastCents = null;

    persistState({ updateRecord: false, silent: true });
    renderAll();
    const isRest = Boolean(state.restDays && state.restDays[activeDate]);
    showToast(
      isRest
        ? "新的一天是休息日，自动计薪不会启动；后天会自动恢复。"
        : "已进入新的工作日，自动计薪已开启。",
      "info",
      3800
    );
    return true;
  }

  /* =======================================================
   * Tick
   * ======================================================= */
  function tick() {
    updateClock();
    if (ensureCurrentWorkday()) return;

    const auto = currentAuto();
    if (!auto) return;

    const seconds = auto.totalSeconds;
    if (seconds !== runtime.lastSecond || auto.phase !== runtime.lastPhase) {
      runtime.lastSecond = seconds;
      runtime.lastPhase = auto.phase;
      renderTodayLive();
    }

    if (performance.now() - runtime.lastPersistAt >= 5000) {
      persistState({ updateRecord: true, silent: true });
      renderSaveStateLabel();
    }
  }

  function updateClock() {
    const now = new Date();
    const text = W.pad2(now.getHours()) + ":" + W.pad2(now.getMinutes());
    if (text !== ui.lastClock) {
      ui.lastClock = text;
      dom.headerClock.textContent = text;
    }

    const workday = session ? session.date : W.todayKey();
    dom.todayDateLabel.textContent = W.formatFullDateCN(workday);
    dom.todayWeekdayLabel.textContent = W.formatWeekdayCN(workday);
    dom.heroDate.textContent = W.formatDateCN(workday) + " · " + W.formatWeekdayCN(workday, true);
  }

  /* =======================================================
   * Rendering — today
   * ======================================================= */
  function renderAll() {
    renderTodayConfig();
    renderTodayLive();
    renderGoalStrip();
    if (ui.view === "overview") renderOverview();
    if (ui.view === "wishlist") renderWishlist();
    renderSettingsStats();
  }

  function renderTodayConfig() {
    const breakConfig = {
      enabled: Boolean(session.breakEnabled),
      start: session.breakStart,
      end: session.breakEnd
    };
    const info = W.scheduleInfo(session.workStart, session.workEnd, breakConfig);
    if (document.activeElement !== dom.dailyWageInput && !dom.dailyWageInput.classList.contains("is-invalid")) {
      dom.dailyWageInput.value = (session.dailyWageCents / 100).toFixed(2);
    }
    if (document.activeElement !== dom.workStartInput && !dom.workStartInput.classList.contains("is-invalid")) {
      dom.workStartInput.value = session.workStart;
    }
    if (document.activeElement !== dom.workEndInput && !dom.workEndInput.classList.contains("is-invalid")) {
      dom.workEndInput.value = session.workEnd;
    }
    if (document.activeElement !== dom.breakStartInput && !dom.breakStartInput.classList.contains("is-invalid")) {
      dom.breakStartInput.value = session.breakStart;
    }
    if (document.activeElement !== dom.breakEndInput && !dom.breakEndInput.classList.contains("is-invalid")) {
      dom.breakEndInput.value = session.breakEnd;
    }
    dom.overtimeToggle.checked = session.overtimeEnabled;
    dom.breakToggle.checked = Boolean(session.breakEnabled);
    dom.breakFields.hidden = !session.breakEnabled;
    dom.breakOffLabel.hidden = Boolean(session.breakEnabled);
    dom.dayPotential.hidden = Boolean(session.breakEnabled);

    if (info.ok) {
      dom.standardDuration.textContent = W.formatDurationTight(info.seconds);
      dom.crossDayBadge.hidden = !info.crossDay;
      dom.progressFootLeft.textContent = "标准工时 " + W.formatDuration(info.seconds);
      dom.breakHint.textContent = info.breakEnabled
        ? "在岗 " + W.formatDurationTight(info.spanSeconds) + " · 扣除休息 " + W.formatDurationTight(info.breakSeconds) + " · 计薪 " + W.formatDurationTight(info.seconds)
        : "开启后从标准工时中扣除休息时间；休息时段自动不计薪。";
    } else {
      dom.breakHint.textContent = "当前休息时间不在工作时段内，请重新选择。";
    }

    if (state.settings.overtimeMode === "hourly") {
      dom.overtimeRuleText.textContent = "¥" + W.formatMoney(state.settings.overtimeHourlyCents) + " / 小时";
      dom.overtimeRuleDetail.textContent = "超出标准工时后，按固定加班时薪计算";
    } else {
      const multiplier = W.formatMultiplier(state.settings.overtimeMultiplierBps);
      dom.overtimeRuleText.textContent = multiplier + " 倍时薪";
      dom.overtimeRuleDetail.textContent = "超出标准工时后，每秒按 " + multiplier + " 倍计算";
    }

    const tomorrow = offsetDateKey(session.date, 1);
    const restTomorrow = Boolean(state.restDays && state.restDays[tomorrow]);
    const restingToday = Boolean(state.restDays && state.restDays[session.date]);
    dom.restTomorrowToggle.checked = restTomorrow;
    dom.restTomorrowHint.textContent = restingToday
      ? "今日休息，自动计薪暂停；非休息日会自动恢复。"
      : (restTomorrow
        ? "明日不自动计薪；后天会自动恢复。"
        : "明日会自动开始计薪；开启后明日暂停，后天恢复。");

    const rates = W.getRates(dayConfig());
    dom.dayBasePotential.textContent = "¥" + W.formatMoney(session.dailyWageCents);
    dom.dayOtPotential.textContent = rates
      ? "+¥" + W.formatHourlyYuan(rates.overtimeHourlyCents) + " / 时"
      : "—";

    renderSaveStateLabel();
  }

  function renderTodayLive() {
    const auto = currentAuto();
    const seconds = auto ? auto.totalSeconds : 0;
    const calc = currentPay();
    if (!calc || !calc.rates) return;
    runtime.running = Boolean(auto && (auto.phase === "working" || auto.phase === "overtime"));

    const totalText = W.formatMoney(calc.totalCents);
    dom.liveAmount.textContent = totalText;
    dom.liveAmount.classList.toggle("is-long", totalText.length > 10 && totalText.length <= 13);
    dom.liveAmount.classList.toggle("is-very-long", totalText.length > 13);

    if (runtime.lastCents !== null && calc.totalCents !== runtime.lastCents && runtime.running) {
      animateAmount();
    }
    runtime.lastCents = calc.totalCents;

    dom.standardPay.textContent = "¥" + W.formatMoney(calc.standardCents);
    dom.overtimePay.textContent = "¥" + W.formatMoney(calc.overtimeCents);
    dom.workedTime.textContent = W.formatDuration(calc.workedSeconds);
    dom.standardMeta.textContent = "已完成 " + W.formatDuration(calc.standardWorkedSeconds);
    dom.overtimeMeta.textContent = session.overtimeEnabled
      ? "加班 " + W.formatDuration(calc.overtimeWorkedSeconds)
      : "今日未开启加班";
    dom.workedMeta.textContent = "目标 " + W.formatDuration(calc.totalSeconds);

    const standardRate = calc.rates.standardPerSecondCents;
    const overtimeRate = calc.rates.overtimePerSecondCents;
    dom.perSecondRate.textContent = "¥" + W.formatPerSecond(standardRate);
    dom.perSecondMeta.textContent = "加班 ¥" + W.formatPerSecond(overtimeRate) + " / 秒";

    const progress = W.clamp((calc.standardWorkedSeconds / calc.totalSeconds) * 100, 0, 100);
    const progressRounded = Math.round(progress);
    dom.progressFill.style.width = progress.toFixed(2) + "%";
    dom.progressPercent.textContent = progressRounded + "%";
    dom.progressTrack.setAttribute("aria-valuenow", String(progressRounded));
    dom.progressLabel.textContent = calc.standardWorkedSeconds >= calc.totalSeconds
      ? "标准工时已完成"
      : "标准工时进度";

    const beyondStandard = calc.workedSeconds >= calc.totalSeconds;
    if (beyondStandard && session.overtimeEnabled) {
      dom.progressFootRight.textContent = "加班计费中 · 已加班 " + W.formatDuration(calc.overtimeWorkedSeconds);
    } else if (beyondStandard && !session.overtimeEnabled) {
      dom.progressFootRight.textContent = "已超出标准工时 · 开启加班后继续计薪";
    } else {
      const rule = state.settings.overtimeMode === "hourly"
        ? "¥" + W.formatMoney(state.settings.overtimeHourlyCents) + " / 小时"
        : W.formatMultiplier(state.settings.overtimeMultiplierBps) + " 倍";
      dom.progressFootRight.textContent = "超出后按 " + rule + " 计费";
    }

    renderStatus(calc, auto);
    renderControls(calc, auto);
    renderGoalStrip();
  }

  function renderStatus(calc, auto) {
    let statusClass = "is-idle";
    let statusLabel = "自动计薪待命";
    let live = false;

    if (auto) {
      if (auto.phase === "rest") {
        statusClass = "is-rest";
        statusLabel = "今日休息";
      } else if (auto.isPaused) {
        statusClass = "is-paused";
        statusLabel = "已暂停";
      } else if (auto.phase === "before") {
        statusClass = "is-idle";
        statusLabel = "未到上班时间";
      } else if (auto.phase === "break") {
        statusClass = "is-break";
        statusLabel = "休息中";
      } else if (auto.phase === "overtime") {
        statusClass = "is-running";
        statusLabel = "加班自动计薪";
        live = true;
      } else if (auto.phase === "off") {
        statusClass = "is-idle";
        statusLabel = "今日已下班";
      } else {
        statusClass = "is-running";
        statusLabel = "自动计薪中";
        live = true;
      }
    }

    dom.statusPill.className = "status-pill " + statusClass;
    dom.statusText.textContent = statusLabel;
    dom.amountNote.classList.toggle("is-live", live);

    let note = "根据班次时间自动计薪";
    if (auto) {
      if (auto.phase === "rest") {
        note = "今日休息 · 不自动计薪；非休息日会继续自动开始";
      } else if (auto.isPaused) {
        note = "已暂停 · 金额冻结在 ¥" + W.formatMoney(calc.totalCents);
      } else if (auto.phase === "before") {
        note = "未到上班时间 · " + session.workStart + " 自动开始";
      } else if (auto.phase === "break") {
        note = "休息时段不计薪 · " + session.breakEnd + " 自动恢复";
      } else if (auto.phase === "off") {
        note = "今日班次已结束" + (session.overtimeEnabled ? " · 已到加班上限" : " · 开启今日加班可继续");
      } else if (auto.phase === "overtime") {
        note = "加班自动计薪中 · 每秒 +¥" + W.formatPerSecond(calc.rates.overtimePerSecondCents);
      } else {
        note = "自动计薪中 · 每秒 +¥" + W.formatPerSecond(calc.rates.standardPerSecondCents);
      }
    }

    dom.amountNoteText.textContent = note;
  }

  function renderControls(calc, auto) {
    const hasProgress = Boolean(auto && auto.totalSeconds > 0) || Boolean(state.records[session.date]);
    const rest = Boolean(auto && auto.phase === "rest");
    const paused = Boolean(auto && auto.isPaused);
    const waiting = Boolean(auto && auto.phase === "before");
    const off = Boolean(auto && auto.phase === "off");
    dom.startBtn.disabled = rest || waiting || off;
    dom.startBtnText.textContent = rest
      ? "今日休息"
      : (paused ? "恢复自动计薪" : (waiting ? "等待自动开始" : (off ? "今日已下班" : "暂停今日计薪")));
    if (dom.pauseBtn) {
      dom.pauseBtn.hidden = true;
      dom.pauseBtn.disabled = true;
    }
    dom.resetBtn.disabled = !hasProgress;
  }

  function animateAmount() {
    window.clearTimeout(runtime.amountAnimationTimer);
    dom.liveAmount.classList.remove("is-ticking");
    void dom.liveAmount.offsetWidth;
    dom.liveAmount.classList.add("is-ticking");
    runtime.amountAnimationTimer = window.setTimeout(function () {
      dom.liveAmount.classList.remove("is-ticking");
    }, 380);
  }

  function renderSaveStateLabel() {
    if (runtime.persistFailures > 0) {
      dom.saveIndicator.className = "save-state is-error";
      dom.saveIndicatorText.textContent = "本地保存失败";
      return;
    }
    dom.saveIndicator.className = "save-state";
    if (runtime.running) {
      dom.saveIndicatorText.textContent = "计薪中 · 自动保存";
    } else if (ui.lastSavedLabel && ui.lastSavedLabel !== "自动保存已开启") {
      dom.saveIndicatorText.textContent = ui.lastSavedLabel;
    } else {
      dom.saveIndicatorText.textContent = "自动保存已开启";
    }
  }

  function setSaveIndicator(kind) {
    if (kind === "error") {
      dom.saveIndicator.className = "save-state is-error";
      dom.saveIndicatorText.textContent = "本地保存失败";
      return;
    }
    const now = new Date();
    ui.lastSavedLabel = "已自动保存 · " + W.pad2(now.getHours()) + ":" + W.pad2(now.getMinutes()) + ":" + W.pad2(now.getSeconds());
    dom.saveIndicator.className = "save-state";
    dom.saveIndicatorText.textContent = ui.lastSavedLabel;
  }

  /* =======================================================
   * Rendering — overview
   * ======================================================= */
  function currentMemberName() {
    if (window.CloudSync && window.CloudSync.isConnected()) {
      return window.CloudSync.getMemberName() || "我";
    }
    return "本机";
  }

  function getMonthRecords(month) {
    const connected = window.CloudSync && window.CloudSync.isConnected();
    const currentKey = connected ? window.CloudSync.getMemberKey() : "local";
    const currentName = currentMemberName();
    const scopeAll = connected && ui.cloudMemberScope === "all";

    if (!scopeAll) {
      return Object.keys(state.records)
        .filter(function (date) { return date.slice(0, 7) === month; })
        .sort()
        .map(function (date) {
          return Object.assign({}, state.records[date], {
            memberKey: currentKey,
            memberName: currentName,
            mine: true
          });
        });
    }

    const entries = [];
    const members = window.CloudSync.getMembers();
    members.forEach(function (member) {
      const isMine = member.id === currentKey;
      const source = isMine ? state.records : member.records;
      Object.keys(source || {}).forEach(function (date) {
        if (date.slice(0, 7) !== month) return;
        entries.push(Object.assign({}, source[date], {
          memberKey: member.id,
          memberName: member.name,
          mine: isMine
        }));
      });
    });
    return entries.sort(function (left, right) {
      return left.date.localeCompare(right.date) || left.memberName.localeCompare(right.memberName, "zh-CN");
    });
  }

  function renderOverview() {
    const records = getMonthRecords(ui.month);
    const connected = window.CloudSync && window.CloudSync.isConnected();
    const multipleMembers = connected && window.CloudSync.getMembers().length > 1;

    if (!multipleMembers && ui.cloudMemberScope === "all") {
      ui.cloudMemberScope = "me";
    }
    dom.memberFilterWrap.hidden = !multipleMembers;
    dom.memberFilter.value = ui.cloudMemberScope;

    const totals = records.reduce(function (acc, record) {
      acc.base += record.standardPayCents;
      acc.overtime += record.overtimePayCents;
      acc.total += record.totalPayCents;
      acc.seconds += record.workedSeconds;
      return acc;
    }, { base: 0, overtime: 0, total: 0, seconds: 0 });

    dom.monthPicker.value = ui.month;
    dom.currentMonthBtn.disabled = ui.month === W.currentMonthKey();
    dom.recordCount.textContent = records.length + " 条记录";
    dom.exportCsvBtn.disabled = records.length === 0;
    dom.overviewMonthLabel.textContent = W.formatMonthCN(ui.month);
    dom.compositionMonth.textContent = ui.month.replace("-", ".");
    dom.recordsSubhead.textContent = ui.cloudMemberScope === "all"
      ? "全部成员 · 按日期从早到晚排列"
      : "按日期从早到晚排列";

    dom.summaryTotal.textContent = "¥" + W.formatMoney(totals.total);
    dom.summaryBase.textContent = "¥" + W.formatMoney(totals.base);
    dom.summaryOt.textContent = "¥" + W.formatMoney(totals.overtime);
    dom.summaryDays.textContent = String(records.length);
    dom.summaryTotalSub.textContent = records.length
      ? (ui.cloudMemberScope === "all" ? "全部成员 · " : "") +
        records.length + " 个工作日 · 共 " + W.formatDurationShort(totals.seconds)
      : "还没有计时记录";
    dom.summaryBaseSub.textContent = totals.total > 0
      ? "占当月收入 " + Math.round((totals.base / totals.total) * 100) + "%"
      : "标准时段收入";
    dom.summaryOtSub.textContent = totals.total > 0
      ? "占当月收入 " + Math.round((totals.overtime / totals.total) * 100) + "%"
      : "加班时段收入";
    dom.summaryDaysSub.textContent = "共 " + W.formatDurationShort(totals.seconds);
    dom.compositionTotal.textContent = "合计 ¥" + W.formatMoney(totals.total);

    const basePct = totals.total > 0 ? (totals.base / totals.total) * 100 : 0;
    const otPct = totals.total > 0 ? (totals.overtime / totals.total) * 100 : 0;
    dom.compositionBase.style.width = basePct.toFixed(2) + "%";
    dom.compositionOt.style.width = otPct.toFixed(2) + "%";
    dom.compositionBasePct.textContent = Math.round(basePct) + "%";
    dom.compositionOtPct.textContent = Math.round(otPct) + "%";

    renderRecords(records);
  }

  function renderRecords(records) {
    dom.recordsBody.replaceChildren();

    if (!records.length) {
      dom.tableWrap.hidden = true;
      dom.emptyState.hidden = false;
      return;
    }

    dom.tableWrap.hidden = false;
    dom.emptyState.hidden = true;

    const fragment = document.createDocumentFragment();
    records.forEach(function (record) {
      const parsed = W.parseDateKey(record.date);
      if (!parsed) return;
      const tr = document.createElement("tr");

      const dateTd = document.createElement("td");
      dateTd.dataset.label = "日期";
      const dateCell = document.createElement("div");
      dateCell.className = "date-cell";
      const dateNumber = document.createElement("span");
      dateNumber.className = "date-number";
      dateNumber.textContent = String(parsed.day);
      const dateCopy = document.createElement("span");
      dateCopy.className = "date-copy";
      const dateStrong = document.createElement("strong");
      dateStrong.textContent = parsed.month + "月";
      const dateWeekday = document.createElement("span");
      dateWeekday.textContent = W.formatWeekdayCN(record.date);
      dateCopy.append(dateStrong, dateWeekday);
      dateCell.append(dateNumber, dateCopy);
      if (ui.cloudMemberScope === "all" && record.memberName) {
        const memberTag = document.createElement("span");
        memberTag.className = "member-tag";
        memberTag.textContent = record.memberName;
        dateCell.appendChild(memberTag);
      }
      if (record.date === W.todayKey()) {
        const todayTag = document.createElement("span");
        todayTag.className = "today-tag";
        todayTag.textContent = "今天";
        dateCell.appendChild(todayTag);
      }
      dateTd.appendChild(dateCell);

      const timeTd = document.createElement("td");
      timeTd.dataset.label = "工时明细";
      const timeDetail = document.createElement("div");
      timeDetail.className = "time-detail";
      const standardLine = document.createElement("span");
      const standardDot = document.createElement("i");
      standardLine.append(standardDot, document.createTextNode("标准 " + W.formatDuration(record.standardWorkedSeconds)));
      timeDetail.appendChild(standardLine);
      if (record.overtimeWorkedSeconds > 0) {
        const otLine = document.createElement("span");
        otLine.className = "is-ot";
        const otDot = document.createElement("i");
        otLine.append(otDot, document.createTextNode("加班 " + W.formatDuration(record.overtimeWorkedSeconds)));
        timeDetail.appendChild(otLine);
      }
      if (record.breakSeconds > 0) {
        const breakLine = document.createElement("span");
        breakLine.className = "is-break";
        const breakDot = document.createElement("i");
        breakLine.append(breakDot, document.createTextNode("休息扣 " + W.formatDuration(record.breakSeconds)));
        timeDetail.appendChild(breakLine);
      }
      timeTd.appendChild(timeDetail);

      const baseTd = document.createElement("td");
      baseTd.dataset.label = "基本工资";
      baseTd.className = "num money-cell" + (record.standardPayCents === 0 ? " is-muted" : "");
      baseTd.textContent = "¥" + W.formatMoney(record.standardPayCents);

      const otTd = document.createElement("td");
      otTd.dataset.label = "加班工资";
      otTd.className = "num money-cell" + (record.overtimePayCents === 0 ? " is-muted" : "");
      otTd.textContent = "¥" + W.formatMoney(record.overtimePayCents);
      otTd.title = record.overtimeEnabled
        ? (record.overtimeMode === "hourly"
          ? "固定加班时薪 ¥" + W.formatMoney(record.overtimeHourlyCents) + " / 小时"
          : "加班倍率 " + W.formatMultiplier(record.overtimeMultiplierBps) + " 倍")
        : "当日未开启加班";

      const totalTd = document.createElement("td");
      totalTd.dataset.label = "当日合计";
      totalTd.className = "num money-cell is-total";
      totalTd.textContent = "¥" + W.formatMoney(record.totalPayCents);

      const actionTd = document.createElement("td");
      actionTd.dataset.label = "操作";
      const actionWrap = document.createElement("div");
      actionWrap.className = "row-action";
      if (record.mine !== false) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "delete-row-btn";
        deleteButton.type = "button";
        deleteButton.dataset.deleteDate = record.date;
        deleteButton.dataset.deleteMember = record.memberKey || "";
        deleteButton.setAttribute("aria-label", "删除 " + W.formatDateWithWeekday(record.date, true) + " 的记录");
        deleteButton.title = "删除这条记录";
        deleteButton.innerHTML = '<svg viewBox="0 0 18 18" fill="none" aria-hidden="true"><path d="M3.5 5h11M7 2.8h4M5.3 5l.6 9a1.5 1.5 0 0 0 1.5 1.4h3.2a1.5 1.5 0 0 0 1.5-1.4l.6-9M7.3 8v4.8M10.7 8v4.8" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        actionWrap.appendChild(deleteButton);
      } else {
        const readonly = document.createElement("span");
        readonly.className = "readonly-mark";
        readonly.textContent = "只读";
        actionWrap.appendChild(readonly);
      }
      actionTd.appendChild(actionWrap);

      tr.append(dateTd, timeTd, baseTd, otTd, totalTd, actionTd);
      fragment.appendChild(tr);
    });
    dom.recordsBody.appendChild(fragment);
  }

  /* =======================================================
   * Rendering — settings
   * ======================================================= */
  function fillSettingsForm(settings) {
    dom.defaultWageInput.value = (settings.defaultDailyWageCents / 100).toFixed(2);
    dom.settingsStart.value = settings.workStart;
    dom.settingsEnd.value = settings.workEnd;
    dom.settingsBreakToggle.checked = Boolean(settings.breakEnabled);
    dom.settingsBreakStart.value = settings.breakStart;
    dom.settingsBreakEnd.value = settings.breakEnd;
    dom.settingsBreakFields.hidden = !settings.breakEnabled;
    dom.modeMultiplier.checked = settings.overtimeMode === "multiplier";
    dom.modeHourly.checked = settings.overtimeMode === "hourly";
    dom.multiplierInput.value = W.formatMultiplier(settings.overtimeMultiplierBps);
    dom.hourlyInput.value = (settings.overtimeHourlyCents / 100).toFixed(2);
    clearSettingsErrors();
    syncOvertimeModeUI();
    updateSettingsPreview();
    setSettingsDirty(false, "设置已保存");
    renderSettingsStats();
  }

  function syncOvertimeModeUI() {
    const isHourly = dom.modeHourly.checked;
    dom.multiplierField.hidden = isHourly;
    dom.hourlyField.hidden = !isHourly;
  }

  function renderSettingsStats() {
    if (!dom.localRecordCount) return;
    dom.localRecordCount.textContent = String(Object.keys(state.records).length);
    const info = W.scheduleInfo(state.settings.workStart, state.settings.workEnd, {
      enabled: Boolean(state.settings.breakEnabled),
      start: state.settings.breakStart,
      end: state.settings.breakEnd
    });
    if (info.ok) {
      dom.settingsDurationPreview.textContent = W.formatDurationTight(info.seconds);
    }
  }

  function updateSettingsBreakUI(schedule) {
    const enabled = dom.settingsBreakToggle.checked;
    dom.settingsBreakFields.hidden = !enabled;

    if (!enabled) {
      dom.settingsBreakChip.textContent = "未扣除";
      dom.settingsBreakHint.textContent = "开启后，午休等不计薪时间会从标准工时中扣除。";
      return;
    }

    if (!schedule.ok) {
      dom.settingsBreakChip.textContent = "待完善";
      dom.settingsBreakHint.textContent = "休息时间必须位于当前工作时段内。";
      return;
    }

    dom.settingsBreakChip.textContent = "扣除 " + W.formatDurationTight(schedule.breakSeconds);
    dom.settingsBreakHint.textContent =
      "在岗 " + W.formatDurationTight(schedule.spanSeconds) +
      " · 扣除休息 " + W.formatDurationTight(schedule.breakSeconds) +
      " · 计薪 " + W.formatDurationTight(schedule.seconds) +
      "，休息时段自动不计薪。";
  }

  function updateSettingsPreview() {
    const wage = W.parseMoneyToCents(dom.defaultWageInput.value);
    const schedule = W.scheduleInfo(
      dom.settingsStart.value,
      dom.settingsEnd.value,
      {
        enabled: dom.settingsBreakToggle.checked,
        start: dom.settingsBreakStart.value,
        end: dom.settingsBreakEnd.value
      }
    );
    updateSettingsBreakUI(schedule);

    if (!wage.ok || !schedule.ok) {
      dom.previewStandardHourly.textContent = "—";
      dom.previewOtHourly.textContent = "—";
      dom.previewOtSecond.textContent = "—";
      dom.settingsDurationPreview.textContent = schedule.ok ? W.formatDurationTight(schedule.seconds) : "—";
      return;
    }

    dom.settingsDurationPreview.textContent = W.formatDurationTight(schedule.seconds);

    let mode = dom.modeHourly.checked ? "hourly" : "multiplier";
    let multiplierBps = 150;
    let hourlyCents = 5000;
    if (mode === "multiplier") {
      const parsed = W.parseMultiplierToBps(dom.multiplierInput.value);
      if (!parsed.ok) {
        dom.previewStandardHourly.textContent = "—";
        dom.previewOtHourly.textContent = "—";
        dom.previewOtSecond.textContent = "—";
        return;
      }
      multiplierBps = parsed.bps;
    } else {
      const parsed = W.parseMoneyToCents(dom.hourlyInput.value);
      if (!parsed.ok) {
        dom.previewStandardHourly.textContent = "—";
        dom.previewOtHourly.textContent = "—";
        dom.previewOtSecond.textContent = "—";
        return;
      }
      hourlyCents = parsed.cents;
    }

    const rates = W.getRates({
      dailyWageCents: wage.cents,
      workStart: dom.settingsStart.value,
      workEnd: dom.settingsEnd.value,
      breakEnabled: dom.settingsBreakToggle.checked,
      breakStart: dom.settingsBreakStart.value,
      breakEnd: dom.settingsBreakEnd.value,
      overtimeMode: mode,
      overtimeMultiplierBps: multiplierBps,
      overtimeHourlyCents: hourlyCents
    });

    if (!rates) {
      dom.previewStandardHourly.textContent = "—";
      dom.previewOtHourly.textContent = "—";
      dom.previewOtSecond.textContent = "—";
      return;
    }

    dom.previewStandardHourly.textContent = "¥" + W.formatHourlyYuan(rates.standardHourlyCents) + " / 时";
    dom.previewOtHourly.textContent = "¥" + W.formatHourlyYuan(rates.overtimeHourlyCents) + " / 时";
    dom.previewOtSecond.textContent = "¥" + W.formatPerSecond(rates.overtimePerSecondCents) + " / 秒";
  }

  /* =======================================================
   * Controls
   * ======================================================= */
  function toggleAutoPause() {
    if (state.restDays && state.restDays[session.date]) {
      showToast("今天是休息日，自动计薪不会启动。", "info");
      return;
    }
    const now = Date.now();
    const intervals = (session.pauseIntervals || []).slice();
    const openIndex = intervals.findIndex(function (item) { return !item.end; });
    if (openIndex >= 0) {
      intervals[openIndex] = {
        start: intervals[openIndex].start,
        end: new Date(now).toISOString()
      };
      session.pauseIntervals = intervals;
      showToast("已恢复自动计薪，暂停的这段时间不会计入工资。", "success", 3200);
    } else {
      intervals.push({ start: new Date(now).toISOString(), end: null });
      session.pauseIntervals = intervals;
      showToast("已暂停自动计薪，金额冻结；恢复后继续按班次时钟计算。", "info", 3200);
    }
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderAll();
  }

  function requestResetToday() {
    const auto = currentAuto();
    const calc = currentPay();
    if (!auto || (auto.totalSeconds === 0 && !state.records[session.date])) {
      showToast("今日还没有可以重置的计薪进度。", "warning");
      return;
    }

    const amount = calc ? "¥" + W.formatMoney(calc.totalCents) : "¥0.00";
    showConfirm({
      title: "重置今日自动计薪？",
      message: "将清空今日已累计的 " + W.formatDuration(auto.totalSeconds) + " 和 " + amount + "，并从现在重新开始自动计薪。\n其他日期的记录和当前配置不会受影响。",
      confirmText: "确认重置"
    }).then(function (confirmed) {
      if (!confirmed) return;
      resetToday();
    });
  }

  function resetToday() {
    const now = Date.now();
    const auto = currentAuto(now);
    const shiftStart = auto && auto.shiftStartMs ? auto.shiftStartMs : now;
    session.pauseIntervals = now > shiftStart
      ? [{ start: new Date(shiftStart).toISOString(), end: new Date(now).toISOString() }]
      : [];
    session.accumulatedMs = 0;
    session.wasRunning = false;
    runtime.lastSecond = 0;
    runtime.lastCents = null;
    if (state.records[session.date]) {
      state.deletedRecords[session.date] = new Date().toISOString();
    }
    delete state.records[session.date];
    persistState({ updateRecord: false, silent: true });
    nudgeCloudSync(0);
    renderAll();
    showToast("今日已从当前时刻重新开始自动计薪。", "success");
  }

  /* =======================================================
   * Today config events
   * ======================================================= */
  function applyDailyWage() {
    const result = W.parseMoneyToCents(dom.dailyWageInput.value);
    if (!result.ok) {
      setFieldError(dom.dailyWageInput, dom.wageError, result.error);
      showToast(result.error, "error");
      return false;
    }
    setFieldError(dom.dailyWageInput, dom.wageError, "");
    if (result.cents === session.dailyWageCents) {
      dom.dailyWageInput.value = (session.dailyWageCents / 100).toFixed(2);
      return true;
    }

    session.dailyWageCents = result.cents;
    session.updatedAt = new Date().toISOString();
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayLive();
    dom.dailyWageInput.value = (result.cents / 100).toFixed(2);
    showToast("今日基本工资已更新为 ¥" + W.formatMoney(result.cents) + "，金额已按新配置重算。", "success", 3600);
    return true;
  }

  function applyWorkSchedule() {
    const nextStart = dom.workStartInput.value;
    const nextEnd = dom.workEndInput.value;
    const baseInfo = W.scheduleInfo(nextStart, nextEnd);
    if (!baseInfo.ok) {
      setFieldError(dom.workStartInput, dom.timeError, baseInfo.error);
      setFieldError(dom.workEndInput, dom.timeError, baseInfo.error);
      showToast(baseInfo.error, "error");
      return false;
    }
    setFieldError(dom.workStartInput, dom.timeError, "");
    setFieldError(dom.workEndInput, dom.timeError, "");
    setDayBreakError("");

    if (session.workStart === nextStart && session.workEnd === nextEnd) {
      return true;
    }

    let nextBreakStart = session.breakStart;
    let nextBreakEnd = session.breakEnd;
    let breakChanged = false;
    let breakDisabled = false;

    if (session.breakEnabled) {
      const fullInfo = W.scheduleInfo(nextStart, nextEnd, {
        enabled: true,
        start: nextBreakStart,
        end: nextBreakEnd
      });
      if (!fullInfo.ok) {
        const suggestion = W.suggestBreak(nextStart, nextEnd);
        if (suggestion.ok) {
          nextBreakStart = suggestion.breakStart;
          nextBreakEnd = suggestion.breakEnd;
          breakChanged = true;
        } else {
          session.breakEnabled = false;
          breakDisabled = true;
        }
      }
    }

    session.workStart = nextStart;
    session.workEnd = nextEnd;
    if (breakChanged) {
      session.breakStart = nextBreakStart;
      session.breakEnd = nextBreakEnd;
    }
    session.updatedAt = new Date().toISOString();

    const info = W.scheduleInfo(session.workStart, session.workEnd, {
      enabled: Boolean(session.breakEnabled),
      start: session.breakStart,
      end: session.breakEnd
    });
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayConfig();
    renderTodayLive();

    if (breakDisabled) {
      showToast("新的工作时段太短，今日休息扣除已自动关闭。", "warning", 4200);
    } else if (breakChanged) {
      showToast(
        "工作时段已更新，休息时间已自动调整为 " + nextBreakStart + "–" + nextBreakEnd + "，计薪工时 " + W.formatDurationTight(info.seconds) + "。",
        "info",
        4400
      );
    } else {
      showToast("今日工作时间段已更新，计薪工时 " + W.formatDurationTight(info.seconds) + "。", "success", 3600);
    }
    return true;
  }

  function onBreakToggle() {
    if (!dom.breakToggle.checked) {
      session.breakEnabled = false;
      session.updatedAt = new Date().toISOString();
      setDayBreakError("");
      persistState({ updateRecord: true, silent: true });
      nudgeCloudSync(0);
      renderTodayConfig();
      renderTodayLive();
      showToast("今日已取消休息扣除，标准工时恢复为在岗时长。", "info", 3400);
      return;
    }

    let nextStart = dom.breakStartInput.value || session.breakStart;
    let nextEnd = dom.breakEndInput.value || session.breakEnd;
    let info = W.scheduleInfo(session.workStart, session.workEnd, {
      enabled: true,
      start: nextStart,
      end: nextEnd
    });
    let adjusted = false;

    if (!info.ok) {
      const suggestion = W.suggestBreak(session.workStart, session.workEnd);
      if (!suggestion.ok) {
        dom.breakToggle.checked = false;
        setDayBreakError(suggestion.error);
        showToast(suggestion.error, "error", 4200);
        return;
      }
      nextStart = suggestion.breakStart;
      nextEnd = suggestion.breakEnd;
      adjusted = true;
      info = W.scheduleInfo(session.workStart, session.workEnd, {
        enabled: true,
        start: nextStart,
        end: nextEnd
      });
    }

    session.breakEnabled = true;
    session.breakStart = nextStart;
    session.breakEnd = nextEnd;
    session.updatedAt = new Date().toISOString();
    setDayBreakError("");
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayConfig();
    renderTodayLive();

    if (adjusted) {
      showToast(
        "原休息时间不在工作时段内，已调整为 " + nextStart + "–" + nextEnd + "，每日扣除 " + W.formatDurationTight(info.breakSeconds) + "。",
        "warning",
        4600
      );
    } else {
      showToast(
        "今日已扣除休息 " + nextStart + "–" + nextEnd + "，计薪工时 " + W.formatDurationTight(info.seconds) + "。",
        "success",
        3800
      );
    }
  }

  function applyBreakTimes() {
    if (!session.breakEnabled) return false;
    const nextStart = dom.breakStartInput.value;
    const nextEnd = dom.breakEndInput.value;
    const info = W.scheduleInfo(session.workStart, session.workEnd, {
      enabled: true,
      start: nextStart,
      end: nextEnd
    });

    if (!info.ok) {
      setDayBreakError(info.error);
      showToast(info.error, "error", 4000);
      return false;
    }

    setDayBreakError("");
    if (nextStart === session.breakStart && nextEnd === session.breakEnd) {
      renderTodayConfig();
      return true;
    }

    session.breakStart = nextStart;
    session.breakEnd = nextEnd;
    session.updatedAt = new Date().toISOString();
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayConfig();
    renderTodayLive();
    showToast(
      "休息时间已更新为 " + nextStart + "–" + nextEnd + "，每日扣除 " + W.formatDurationTight(info.breakSeconds) + "，计薪工时 " + W.formatDurationTight(info.seconds) + "。",
      "success",
      4200
    );
    return true;
  }

  function onOvertimeToggle() {
    session.overtimeEnabled = dom.overtimeToggle.checked;
    session.updatedAt = new Date().toISOString();
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayConfig();
    renderTodayLive();

    if (session.overtimeEnabled) {
      showToast("今日加班已开启，超出标准工时后按加班规则计费。", "success", 3300);
    } else {
      showToast("今日加班已关闭，超出标准工时的部分不再计费。", "info", 3300);
    }
  }

  function onRestTomorrowToggle() {
    const tomorrow = offsetDateKey(session.date, 1);
    if (!state.restDays) state.restDays = {};
    if (!state.restDayUpdated) state.restDayUpdated = {};
    if (dom.restTomorrowToggle.checked) {
      state.restDays[tomorrow] = true;
      showToast("已设置明日休息：明日不会自动计薪，后天会自动恢复。", "success", 3800);
    } else {
      delete state.restDays[tomorrow];
      showToast("已取消明日休息：明日会正常自动计薪。", "info", 3300);
    }
    state.restDayUpdated[tomorrow] = new Date().toISOString();
    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderAll();
  }

  function setFieldError(input, errorElement, message) {
    const hasError = Boolean(message);
    if (input) {
      input.classList.toggle("is-invalid", hasError);
      input.setAttribute("aria-invalid", hasError ? "true" : "false");
    }
    if (errorElement) {
      errorElement.hidden = !hasError;
      errorElement.textContent = message || "";
    }
  }

  function setDayBreakError(message) {
    setFieldError(dom.breakStartInput, null, message);
    setFieldError(dom.breakEndInput, null, message);
    setFieldError(null, dom.breakError, message);
  }

  function clearDayErrors() {
    setFieldError(dom.dailyWageInput, dom.wageError, "");
    setFieldError(dom.workStartInput, dom.timeError, "");
    setFieldError(dom.workEndInput, dom.timeError, "");
    setDayBreakError("");
  }

  /* =======================================================
   * SU7 wishlist, daily ledger and AI coach
   * ======================================================= */
  function activeLedgerEntries() {
    return Object.keys(state.ledger || {})
      .map(function (id) { return state.ledger[id]; })
      .filter(function (entry) { return entry && !entry.deleted; });
  }

  function wishlistAnalysis() {
    if (!window.FinanceAI) {
      return null;
    }
    return window.FinanceAI.analyze({
      todayKey: W.todayKey(),
      targetCents: state.wishlist.targetCents,
      initialSavedCents: state.wishlist.initialSavedCents,
      records: state.records,
      ledger: state.ledger,
      dailyWageCents: session ? session.dailyWageCents : state.settings.defaultDailyWageCents
    });
  }

  function renderGoalStrip(analysis) {
    if (!dom.goalStrip) return;
    const result = analysis || wishlistAnalysis();
    if (!result) return;
    dom.goalStripTitle.textContent = state.wishlist.title || "小米 SU7";
    dom.goalStripGap.textContent = "¥" + W.formatMoney(result.gapCents);
    dom.goalStripSaved.textContent = "¥" + W.formatMoney(result.savedCents);
    dom.goalStripTarget.textContent = "¥" + W.formatMoney(state.wishlist.targetCents);
    dom.goalStripPercent.textContent = Math.round(result.progress) + "%";
    dom.goalStripFill.style.width = W.clamp(result.progress, 0, 100).toFixed(2) + "%";
    if (result.gapCents === 0) {
      dom.goalStripHeadline.textContent = "SU7 目标已经达成";
    } else {
      dom.goalStripHeadline.innerHTML = '距离目标还差 <strong id="goalStripGap">¥' + W.formatMoney(result.gapCents) + '</strong>';
      dom.goalStripGap = $("goalStripGap");
    }
  }

  function etaLabel(result) {
    if (result.gapCents === 0) return { value: "已达成", sub: "可以设定下一个目标" };
    if (!result.etaDays) return { value: "待积累", sub: "保持正结余后开始预测" };
    return {
      value: "约 " + result.etaDays + " 天",
      sub: W.formatDateCN(result.etaDate) + " 达成"
    };
  }

  function renderWishlist(analysis) {
    if (!state.wishlist) return;
    const result = analysis || wishlistAnalysis();
    if (!result) return;
    dom.wishlistTitle.textContent = state.wishlist.title || "小米 SU7";
    dom.wishlistSubtitle.textContent = state.wishlist.subtitle || "";
    dom.wishlistHeroTarget.textContent = "¥" + W.formatMoney(state.wishlist.targetCents);
    dom.wishlistHeroSaved.textContent = "¥" + W.formatMoney(result.savedCents);
    dom.wishlistSaved.textContent = "¥" + W.formatMoney(result.savedCents);
    dom.wishlistGap.textContent = "¥" + W.formatMoney(result.gapCents);
    const workdays = result.gapCents > 0 && session && session.dailyWageCents > 0
      ? Math.ceil(result.gapCents / session.dailyWageCents)
      : 0;
    dom.wishlistGapSub.textContent = result.gapCents === 0
      ? "心愿单已经攒满"
      : (workdays ? "约 " + workdays + " 个工作日" : "从第一笔工资开始");
    dom.wishlistProgress.textContent = result.progress.toFixed(1).replace(/\.0$/, "") + "%";
    dom.wishlistProgressFill.style.width = W.clamp(result.progress, 0, 100).toFixed(2) + "%";
    dom.wishlistProgressSub.textContent = "目标 ¥" + W.formatMoney(state.wishlist.targetCents);
    const eta = etaLabel(result);
    dom.wishlistEta.textContent = eta.value;
    dom.wishlistEtaSub.textContent = eta.sub;

    renderGoalStrip(result);
    renderLedger(result);
    renderAiInsights(result);

    if (document.activeElement !== dom.wishlistTargetInput) {
      dom.wishlistTargetInput.value = (state.wishlist.targetCents / 100).toFixed(2);
    }
    if (document.activeElement !== dom.wishlistInitialInput) {
      dom.wishlistInitialInput.value = (state.wishlist.initialSavedCents / 100).toFixed(2);
    }
    dom.ledgerDate.max = W.todayKey();
    if (!dom.ledgerDate.value) dom.ledgerDate.value = W.todayKey();
    populateLedgerCategories();
  }

  function renderLedger(analysis) {
    const result = analysis || wishlistAnalysis();
    if (!result) return;
    dom.ledgerMonthExpense.textContent = "¥" + W.formatMoney(result.monthExpenseCents);
    dom.ledgerMonthIncome.textContent = "¥" + W.formatMoney(result.monthIncomeCents);
    dom.ledgerMonthNet.textContent = "¥" + W.formatMoney(result.monthNetCents);
    dom.ledgerMonthNet.classList.toggle("is-positive", result.monthNetCents > 0);
    dom.ledgerMonthNet.classList.toggle("is-negative", result.monthNetCents < 0);

    const entries = activeLedgerEntries().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
    dom.ledgerCount.textContent = entries.length + " 笔";
    dom.ledgerList.replaceChildren();
    dom.ledgerEmpty.hidden = entries.length > 0;
    entries.slice(0, 40).forEach(function (entry) {
      const row = document.createElement("div");
      row.className = "ledger-row";
      row.dataset.ledgerId = entry.id;

      const date = document.createElement("span");
      date.className = "ledger-date";
      date.textContent = W.formatDateCN(entry.date);
      row.appendChild(date);

      const category = document.createElement("span");
      category.className = "ledger-cat";
      category.textContent = entry.category;
      row.appendChild(category);

      const note = document.createElement("span");
      note.className = "ledger-note";
      note.textContent = entry.note || (entry.type === "income" ? "收入" : "支出");
      row.appendChild(note);

      const amount = document.createElement("strong");
      amount.className = "ledger-amount " + (entry.type === "income" ? "is-income" : "is-expense");
      amount.textContent = (entry.type === "income" ? "+" : "−") + "¥" + W.formatMoney(entry.amountCents);
      row.appendChild(amount);

      const remove = document.createElement("button");
      remove.className = "ledger-delete";
      remove.type = "button";
      remove.dataset.deleteLedger = entry.id;
      remove.setAttribute("aria-label", "删除这笔" + (entry.type === "income" ? "收入" : "支出"));
      remove.textContent = "×";
      row.appendChild(remove);

      dom.ledgerList.appendChild(row);
    });
  }

  function renderAiInsights(analysis) {
    const result = analysis || wishlistAnalysis();
    if (!result || !dom.aiInsights) return;
    dom.aiInsights.replaceChildren();

    if (ui.aiAdviceLoading || ui.aiAdvice) {
      const article = document.createElement("article");
      article.className = "ai-insight tone-ai";
      const tag = document.createElement("span");
      tag.className = "ai-tag";
      tag.textContent = ui.aiAdviceLoading ? "AI COACH · THINKING" : "AI COACH · ONLINE";
      const title = document.createElement("h3");
      title.textContent = ui.aiAdviceLoading ? "AI 正在读你的攒钱节奏" : "AI 给你的三句话";
      const text = document.createElement("p");
      text.textContent = ui.aiAdviceLoading
        ? "正在把目标差距、消费结构和达成预测整理成一段建议…"
        : ui.aiAdvice;
      article.append(tag, title, text);
      dom.aiInsights.appendChild(article);
    }

    result.insights.forEach(function (insight) {
      const article = document.createElement("article");
      article.className = "ai-insight tone-" + insight.tone;
      const tag = document.createElement("span");
      tag.className = "ai-tag";
      tag.textContent = insight.tag;
      const title = document.createElement("h3");
      title.textContent = insight.title;
      const text = document.createElement("p");
      text.textContent = insight.text;
      article.appendChild(tag);
      article.appendChild(title);
      article.appendChild(text);
      dom.aiInsights.appendChild(article);
    });
    const count = result.insights.length;
    dom.aiStatus.textContent = ui.aiAdviceLoading
      ? "AI 在线分析中"
      : (ui.aiAdvice ? "在线 AI 已生成" : "本地智能分析 · " + count + " 条");
    if (dom.aiDeepBtn) {
      dom.aiDeepBtn.disabled = ui.aiAdviceLoading;
      dom.aiDeepBtn.textContent = ui.aiAdviceLoading ? "AI 分析中…" : "AI 深度分析 ✦";
    }
  }

  async function handleDeepAi() {
    if (ui.aiAdviceLoading) return;
    if (!window.FinanceAI || typeof window.FinanceAI.remoteAdvice !== "function") {
      showToast("当前浏览器无法使用在线 AI，请继续查看本地建议。", "warning", 3400);
      return;
    }
    const confirmed = await showConfirm({
      title: "使用在线 AI 深度分析？",
      message: "将向 Pollinations 在线模型发送目标金额、已攒金额、支出分类等汇总数字，用于生成个性化建议。\n不会发送姓名、成员称呼、备注或逐笔明细。",
      confirmText: "开始在线分析"
    });
    if (!confirmed) return;
    const analysis = wishlistAnalysis();
    if (!analysis) return;
    ui.aiAdviceLoading = true;
    ui.aiAdvice = "";
    renderWishlist();
    try {
      const advice = await window.FinanceAI.remoteAdvice(analysis, state.wishlist.targetCents);
      ui.aiAdvice = advice;
      showToast("在线 AI 已根据汇总数据生成建议。", "success", 3200);
    } catch (error) {
      showToast("在线 AI 暂时不可用，已保留本地智能建议。", "warning", 4200);
    } finally {
      ui.aiAdviceLoading = false;
      renderWishlist();
    }
  }

  const EXPENSE_CATEGORIES = ["餐饮", "交通", "购物", "居住", "娱乐", "学习", "医疗", "其他支出"];
  const INCOME_CATEGORIES = ["其他收入", "红包", "奖金", "理财", "退款"];

  function populateLedgerCategories() {
    if (!dom.ledgerCategory) return;
    const type = dom.ledgerTypeIncome.checked ? "income" : "expense";
    const list = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    const previous = dom.ledgerCategory.value;
    dom.ledgerCategory.replaceChildren();
    list.forEach(function (name) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      dom.ledgerCategory.appendChild(option);
    });
    if (list.indexOf(previous) >= 0) dom.ledgerCategory.value = previous;
    ui.ledgerType = type;
  }

  function handleLedgerSubmit(event) {
    if (event) event.preventDefault();
    const date = dom.ledgerDate.value || W.todayKey();
    if (!W.parseDateKey(date)) {
      setFieldError(null, dom.ledgerError, "请选择有效的日期。");
      return;
    }
    const parsed = W.parseMoneyToCents(dom.ledgerAmount.value);
    if (!parsed.ok) {
      setFieldError(null, dom.ledgerError, parsed.error);
      dom.ledgerAmount.focus();
      return;
    }
    setFieldError(null, dom.ledgerError, "");
    const type = dom.ledgerTypeIncome.checked ? "income" : "expense";
    const category = dom.ledgerCategory.value || (type === "income" ? "其他收入" : "其他支出");
    const note = dom.ledgerNote.value.trim();
    const id = "led-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
    const now = new Date().toISOString();
    state.ledger[id] = {
      id: id,
      date: date,
      type: type,
      category: category,
      amountCents: parsed.cents,
      note: note,
      deleted: false,
      createdAt: now,
      updatedAt: now
    };
    ui.aiAdvice = "";
    persistState({ updateRecord: false, silent: true });
    nudgeCloudSync(0);
    dom.ledgerAmount.value = "";
    dom.ledgerNote.value = "";
    renderWishlist();
    renderGoalStrip();
    showToast(type === "income" ? "收入已记入心愿单。" : "支出已记入账本，AI 教练已更新建议。", "success", 3000);
  }

  function deleteLedgerEntry(id) {
    const entry = state.ledger && state.ledger[id];
    if (!entry || entry.deleted) return;
    showConfirm({
      title: "删除这笔记录？",
      message: "将删除 " + W.formatDateCN(entry.date) + " 的「" + entry.category + "」" + (entry.type === "income" ? "收入" : "支出") + " ¥" + W.formatMoney(entry.amountCents) + "。",
      confirmText: "确认删除"
    }).then(function (confirmed) {
      if (!confirmed) return;
      entry.deleted = true;
      entry.updatedAt = new Date().toISOString();
      ui.aiAdvice = "";
      persistState({ updateRecord: false, silent: true });
      nudgeCloudSync(0);
      renderWishlist();
      showToast("记录已删除，心愿进度已重新计算。", "success", 2800);
    });
  }

  function handleWishlistConfigSubmit(event) {
    if (event) event.preventDefault();
    const target = W.parseMoneyToCents(dom.wishlistTargetInput.value);
    if (!target.ok) {
      setFieldError(null, dom.wishlistConfigError, "目标金额：" + target.error);
      return;
    }
    const initialInput = String(dom.wishlistInitialInput.value || "0").replace(/,/g, "").trim();
    const initialNumber = Number(initialInput);
    const initial = initialInput === "" || (Number.isFinite(initialNumber) && initialNumber === 0)
      ? { ok: true, cents: 0 }
      : W.parseMoneyToCents(initialInput);
    if (!initial.ok) {
      setFieldError(null, dom.wishlistConfigError, "已有存款：" + initial.error);
      return;
    }
    setFieldError(null, dom.wishlistConfigError, "");
    state.wishlist.targetCents = target.cents;
    state.wishlist.initialSavedCents = initial.cents;
    state.wishlist.updatedAt = new Date().toISOString();
    ui.aiAdvice = "";
    persistState({ updateRecord: false, silent: true });
    nudgeCloudSync(0);
    renderWishlist();
    showToast("心愿目标已更新。", "success", 2800);
  }

  /* =======================================================
   * Settings
   * ======================================================= */
  function setSettingsBreakError(message) {
    setFieldError(dom.settingsBreakStart, null, message);
    setFieldError(dom.settingsBreakEnd, null, message);
    setFieldError(null, dom.settingsBreakError, message);
  }

  function clearSettingsErrors() {
    setFieldError(dom.defaultWageInput, dom.defaultWageError, "");
    setFieldError(dom.settingsStart, dom.settingsTimeError, "");
    setFieldError(dom.settingsEnd, dom.settingsTimeError, "");
    setSettingsBreakError("");
    setFieldError(dom.multiplierInput, dom.multiplierError, "");
    setFieldError(dom.hourlyInput, dom.hourlyError, "");
  }

  function collectSettings() {
    clearSettingsErrors();
    let firstInvalid = null;
    let valid = true;

    const wage = W.parseMoneyToCents(dom.defaultWageInput.value);
    if (!wage.ok) {
      setFieldError(dom.defaultWageInput, dom.defaultWageError, wage.error);
      firstInvalid = firstInvalid || dom.defaultWageInput;
      valid = false;
    }

    const workSchedule = W.scheduleInfo(dom.settingsStart.value, dom.settingsEnd.value);
    if (!workSchedule.ok) {
      setFieldError(dom.settingsStart, dom.settingsTimeError, workSchedule.error);
      setFieldError(dom.settingsEnd, dom.settingsTimeError, workSchedule.error);
      firstInvalid = firstInvalid || dom.settingsStart;
      valid = false;
    }

    const breakEnabled = dom.settingsBreakToggle.checked;
    let breakStart = dom.settingsBreakStart.value || state.settings.breakStart || "12:00";
    let breakEnd = dom.settingsBreakEnd.value || state.settings.breakEnd || "13:00";
    if (workSchedule.ok) {
      const breakSchedule = W.scheduleInfo(dom.settingsStart.value, dom.settingsEnd.value, {
        enabled: breakEnabled,
        start: breakStart,
        end: breakEnd
      });
      if (!breakSchedule.ok) {
        setSettingsBreakError(breakSchedule.error);
        firstInvalid = firstInvalid || dom.settingsBreakStart;
        valid = false;
      }
    }

    const mode = dom.modeHourly.checked ? "hourly" : "multiplier";
    let multiplierBps = state.settings.overtimeMultiplierBps;
    let hourlyCents = state.settings.overtimeHourlyCents;

    if (mode === "multiplier") {
      const multiplier = W.parseMultiplierToBps(dom.multiplierInput.value);
      if (!multiplier.ok) {
        setFieldError(dom.multiplierInput, dom.multiplierError, multiplier.error);
        firstInvalid = firstInvalid || dom.multiplierInput;
        valid = false;
      } else {
        multiplierBps = multiplier.bps;
      }
    } else {
      const hourly = W.parseMoneyToCents(dom.hourlyInput.value);
      if (!hourly.ok) {
        setFieldError(dom.hourlyInput, dom.hourlyError, hourly.error);
        firstInvalid = firstInvalid || dom.hourlyInput;
        valid = false;
      } else {
        hourlyCents = hourly.cents;
      }
    }

    if (!valid) {
      if (firstInvalid) firstInvalid.focus();
      showToast("设置中有需要检查的输入项。", "error");
      return null;
    }

    return {
      defaultDailyWageCents: wage.cents,
      workStart: dom.settingsStart.value,
      workEnd: dom.settingsEnd.value,
      breakEnabled: breakEnabled,
      breakStart: breakStart,
      breakEnd: breakEnd,
      overtimeMode: mode,
      overtimeMultiplierBps: multiplierBps,
      overtimeHourlyCents: hourlyCents
    };
  }

  function saveSettings(event) {
    if (event) event.preventDefault();
    const values = collectSettings();
    if (!values) return;

    state.settings = values;
    state.settingsUpdatedAt = new Date().toISOString();

    const todayHasProgress = activeSeconds() > 0 || Boolean(state.records[session.date]);
    let appliedToToday = false;
    if (!todayHasProgress) {
      session.dailyWageCents = values.defaultDailyWageCents;
      session.workStart = values.workStart;
      session.workEnd = values.workEnd;
      session.breakEnabled = values.breakEnabled;
      session.breakStart = values.breakStart;
      session.breakEnd = values.breakEnd;
      appliedToToday = true;
    }

    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderAll();
    fillSettingsForm(state.settings);
    const now = new Date();
    const time = W.pad2(now.getHours()) + ":" + W.pad2(now.getMinutes());
    setSettingsDirty(false, "已保存 · " + time);

    if (appliedToToday) {
      showToast("设置已保存，并已应用到今日配置。", "success", 3600);
    } else {
      showToast("设置已保存，加班费标准已立即生效；今日已有计薪进度，原有日薪、工时和休息设置保持不变。", "success", 4600);
    }
  }

  function setSettingsDirty(dirty, message) {
    ui.settingsDirty = Boolean(dirty);
    dom.settingsStatus.textContent = message || (dirty ? "有未保存的修改" : "设置已保存");
    const wrapper = dom.settingsStatus.parentElement;
    if (wrapper) wrapper.classList.toggle("is-dirty", Boolean(dirty));
  }

  function markSettingsDirty() {
    if (!ui.settingsDirty) {
      setSettingsDirty(true, "有未保存的修改");
    }
  }

  function resetSettingsToDefaults() {
    fillSettingsForm(Store.DEFAULT_SETTINGS);
    setSettingsDirty(true, "已填入默认值，点击保存后生效");
    showToast("已填入默认设置，点击「保存设置」后生效。", "info", 3400);
  }

  /* =======================================================
   * Overview events
   * ======================================================= */
  function changeMonth(delta) {
    ui.month = W.shiftMonth(ui.month, delta);
    renderOverview();
  }

  function setMonthFromPicker() {
    const value = dom.monthPicker.value;
    if (W.parseMonthKey(value)) {
      ui.month = value;
      renderOverview();
    } else {
      dom.monthPicker.value = ui.month;
    }
  }

  function deleteRecord(dateKey, memberKey) {
    if (
      window.CloudSync &&
      window.CloudSync.isConnected() &&
      memberKey &&
      memberKey !== window.CloudSync.getMemberKey()
    ) {
      showToast("只能删除自己的工资记录。", "warning");
      return;
    }

    const record = state.records[dateKey];
    if (!record) return;
    const isToday = dateKey === session.date;
    const message = "将删除 " + W.formatDateWithWeekday(dateKey, false) + " 的工资记录，合计 ¥" + W.formatMoney(record.totalPayCents) + "。"
      + (isToday ? "\n今日自动计薪也会从当前时刻重置，其他日期不受影响。" : "\n此操作无法撤销。");

    showConfirm({
      title: isToday ? "删除今日记录？" : "删除这一天的记录？",
      message: message,
      confirmText: "确认删除"
    }).then(function (confirmed) {
      if (!confirmed) return;

      if (isToday) {
        const now = Date.now();
        const auto = currentAuto(now);
        const shiftStart = auto && auto.shiftStartMs ? auto.shiftStartMs : now;
        session.pauseIntervals = now > shiftStart
          ? [{ start: new Date(shiftStart).toISOString(), end: new Date(now).toISOString() }]
          : [];
        runtime.lastSecond = 0;
        runtime.lastCents = null;
        session.accumulatedMs = 0;
        session.wasRunning = false;
        state.deletedRecords[dateKey] = new Date().toISOString();
        delete state.records[dateKey];
        persistState({ updateRecord: false, silent: true });
        nudgeCloudSync(0);
        renderAll();
      } else {
        state.deletedRecords[dateKey] = new Date().toISOString();
        delete state.records[dateKey];
        persistState({ updateRecord: false, silent: true });
        nudgeCloudSync(0);
        renderOverview();
        renderSettingsStats();
      }
      showToast("已删除 " + W.formatDateCN(dateKey) + " 的工资记录。", "success", 3200);
    });
  }

  function exportCsv() {
    const records = getMonthRecords(ui.month);
    if (!records.length) {
      showToast("当前月份没有可导出的记录。", "warning");
      return;
    }

    const header = ["日期", "成员", "星期", "日基本工资(元)", "工作时段", "休息时段", "休息扣除", "标准工作时长", "加班工作时长", "基本工资(元)", "加班工资(元)", "当日合计(元)", "加班规则"];
    const rows = records.map(function (record) {
      const rule = record.overtimeEnabled
        ? (record.overtimeMode === "hourly"
          ? W.formatMoney(record.overtimeHourlyCents) + " 元/小时"
          : W.formatMultiplier(record.overtimeMultiplierBps) + " 倍")
        : "未开启加班";
      return [
        record.date,
        record.memberName || "本机",
        W.formatWeekdayCN(record.date),
        (record.dailyWageCents / 100).toFixed(2),
        record.workStart + "–" + record.workEnd,
        record.breakEnabled ? record.breakStart + "–" + record.breakEnd : "未扣除",
        W.formatDuration(record.breakSeconds || 0),
        W.formatDuration(record.standardWorkedSeconds),
        W.formatDuration(record.overtimeWorkedSeconds),
        (record.standardPayCents / 100).toFixed(2),
        (record.overtimePayCents / 100).toFixed(2),
        (record.totalPayCents / 100).toFixed(2),
        rule
      ];
    });

    const lines = [header].concat(rows).map(function (row) {
      return row.map(function (cell) {
        return '"' + String(cell).replace(/"/g, '""') + '"';
      }).join(",");
    });
    const csv = "\uFEFF" + lines.join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ui.month + "_秒薪工资总览.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 800);
    showToast("已导出 " + records.length + " 条工资记录。", "success");
  }

  /* =======================================================
   * Navigation
   * ======================================================= */
  function activateView(view, options) {
    const opts = options || {};
    if (view !== "today" && view !== "overview" && view !== "wishlist" && view !== "settings") {
      view = "today";
    }
    ui.view = view;

    document.querySelectorAll(".tab-button").forEach(function (button) {
      const active = button.dataset.view === view;
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    document.querySelectorAll("[data-view-panel]").forEach(function (panel) {
      const active = panel.dataset.viewPanel === view;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    });

    if (view === "overview") {
      if (opts.resetMonthToCurrent) ui.month = W.currentMonthKey();
      persistState({ updateRecord: true, silent: true, cloudDirty: false });
      renderOverview();
    } else if (view === "today") {
      renderTodayConfig();
      renderTodayLive();
      renderGoalStrip();
    } else if (view === "wishlist") {
      renderWishlist();
    } else if (view === "settings") {
      renderSettingsStats();
      updateSettingsPreview();
    }

    if (opts.updateHash !== false) {
      const target = "#" + view;
      if (window.location.hash !== target) {
        window.history.replaceState(null, "", target);
      }
    }
    if (opts.scroll !== false) {
      window.scrollTo({ top: 0, behavior: opts.smooth === false ? "auto" : "smooth" });
    }
    if (opts.focus !== false) {
      const heading = document.querySelector("#view-" + view + " h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus({ preventScroll: true });
      }
    }
  }

  /* =======================================================
   * Toasts and dialogs
   * ======================================================= */
  function showToast(message, type, duration) {
    const toastType = type || "success";
    const toast = document.createElement("div");
    toast.className = "toast" + (toastType === "error" ? " is-error" : toastType === "warning" ? " is-warning" : "");
    const icon = document.createElement("span");
    icon.className = "toast-icon";
    icon.textContent = toastType === "error" || toastType === "warning" ? "!" : "✓";
    const text = document.createElement("span");
    text.className = "toast-text";
    text.textContent = message;
    toast.append(icon, text);
    dom.toastRegion.appendChild(toast);

    while (dom.toastRegion.children.length > 3) {
      dom.toastRegion.firstElementChild.remove();
    }

    const remove = function () {
      if (!toast.isConnected) return;
      toast.classList.add("is-leaving");
      window.setTimeout(function () { toast.remove(); }, 220);
    };
    window.setTimeout(remove, duration || 3200);
  }

  function showConfirm(options) {
    const opts = options || {};
    if (pendingDialog) {
      dom.confirmDialog.returnValue = "cancel";
      dom.confirmDialog.close();
      const previous = pendingDialog;
      pendingDialog = null;
      previous(false);
    }

    dom.confirmTitle.textContent = opts.title || "确认操作";
    dom.confirmMessage.textContent = opts.message || "";
    dom.confirmAccept.textContent = opts.confirmText || "确认";
    dom.confirmAccept.className = "button button-danger";

    return new Promise(function (resolve) {
      pendingDialog = resolve;
      dom.confirmDialog.returnValue = "cancel";
      dom.confirmDialog.showModal();
      dom.confirmCancel.focus();
    });
  }

  function settleConfirm(confirmed) {
    if (!pendingDialog) return;
    dom.confirmDialog.returnValue = confirmed ? "confirm" : "cancel";
    dom.confirmDialog.close();
  }

  function handleDialogClosed() {
    if (!pendingDialog) return;
    const resolve = pendingDialog;
    pendingDialog = null;
    resolve(dom.confirmDialog.returnValue === "confirm");
  }

  /* =======================================================
   * Cloud / shared ledger
   * ======================================================= */
  function nudgeCloudSync(delay) {
    if (window.CloudSync && window.CloudSync.isConnected() && window.CloudSync.isDirty()) {
      window.CloudSync.schedulePush(typeof delay === "number" ? delay : 0);
    }
  }

  function getCloudSnapshot() {
    return {
      memberName: window.CloudSync ? window.CloudSync.getMemberName() : "",
      settings: state.settings,
      settingsUpdatedAt: state.settingsUpdatedAt,
      records: state.records,
      deletedRecords: state.deletedRecords || {},
      restDays: state.restDays || {},
      restDayUpdated: state.restDayUpdated || {},
      wishlist: state.wishlist,
      ledger: state.ledger || {}
    };
  }

  function shortMemberName(name) {
    const value = String(name || "");
    return value.length > 6 ? value.slice(0, 5) + "…" : value;
  }

  function formatCloudTime(timestamp) {
    if (!timestamp) return "尚未同步";
    const date = new Date(timestamp);
    return "最近同步 " + W.pad2(date.getHours()) + ":" + W.pad2(date.getMinutes()) + ":" + W.pad2(date.getSeconds());
  }

  function updateCloudStatus(status) {
    if (!status) return;
    ui.cloudStatus = status;
    ui.cloudConnected = Boolean(status.connected);
    if (!status.connected) {
      ui.cloudMemberScope = "me";
    }

    dom.storageChip.className = "storage-chip cloud-chip";
    if (ui.localStorageError) {
      dom.storageChip.classList.add("is-error");
      dom.storageChipText.textContent = "存储异常";
      dom.storageChip.title = "浏览器本地存储不可用";
    } else {
      if (status.connected) dom.storageChip.classList.add("is-connected");
      if (status.mode === "connecting" || status.label === "同步中" || status.label === "待同步") {
        dom.storageChip.classList.add("is-busy");
      }
      if (status.mode === "offline" || status.mode === "locked") {
        dom.storageChip.classList.add("is-error");
      }
      dom.storageChipText.textContent = status.connected
        ? shortMemberName(status.memberName) + " · " + status.label
        : status.label;
      dom.storageChip.title = status.connected
        ? "共享空间 " + status.spaceId + " · 点击管理或同步"
        : "点击创建或加入共享工资簿";
    }

    if (status.connected) {
      dom.dayMemberBadge.hidden = false;
      dom.dayMemberBadge.textContent = status.memberName || "成员";
      dom.dataScopeNote.textContent = "端到端加密共享中";
    } else {
      dom.dayMemberBadge.hidden = true;
      dom.dayMemberBadge.textContent = "成员";
      dom.dataScopeNote.textContent = ui.localStorageError
        ? "本机存储异常"
        : "本机保存 · 可选加密共享";
    }

    const multipleMembers = status.connected && status.memberCount > 1;
    dom.memberFilterWrap.hidden = !multipleMembers;
    if (!multipleMembers) {
      ui.cloudMemberScope = "me";
    }
    dom.memberFilter.value = ui.cloudMemberScope;

    if (ui.view === "overview") {
      renderOverview();
    }
    if (dom.cloudDialog.open) {
      updateCloudDialogPane();
    }
  }

  function initCloudSync() {
    if (!window.CloudSync) return;
    window.CloudSync.init({
      getSnapshot: getCloudSnapshot,
      onData: handleCloudData,
      onStatus: updateCloudStatus
    });

    let urlSpace = window.CloudSync.getUrlSpaceId();
    if (urlSpace) {
      ui.pendingCloudSpace = urlSpace;
      dom.cloudSpaceInput.value = urlSpace;
      window.CloudSync.setUrlSpaceId(urlSpace);
    }

    const saved = window.CloudSync.getSavedConfig();
    if (saved && saved.spaceId) {
      ui.pendingCloudSpace = saved.spaceId;
      if (!dom.cloudSpaceInput.value) dom.cloudSpaceInput.value = saved.spaceId;
    }
    updateCloudStatus(window.CloudSync.getStatus());

    if (saved && saved.spaceId && (!urlSpace || saved.spaceId === urlSpace)) {
      window.CloudSync.autoConnect().then(function (result) {
        if (result.ok) {
          window.CloudSync.setUrlSpaceId(result.spaceId);
          return;
        }
        if (["decrypt_failed", "member_missing", "space_not_found", "invalid_space"].includes(result.code)) {
          ui.pendingCloudSpace = saved.spaceId;
          openCloudDialog("join", {
            spaceId: saved.spaceId,
            message: result.code === "decrypt_failed"
              ? "空间口令已失效或输入有误，请重新输入。"
              : (result.error || "无法恢复共享空间，请重新加入。")
          });
        } else if (result.code === "no_config") {
          openCloudDialog("join", {
            spaceId: saved.spaceId,
            message: "请输入空间口令重新解锁共享工资簿。"
          });
        } else {
          showToast("共享空间连接失败，当前继续使用本机记录。", "warning", 4200);
        }
      });
      return;
    }

    if (urlSpace) {
      window.setTimeout(function () {
        openCloudDialog("join", {
          spaceId: urlSpace,
          message: "你正在打开一个共享工资簿邀请。输入空间口令和称呼即可加入。"
        });
      }, 260);
    }
  }

  function hydrateSessionFromMember(member) {
    const activeDate = resolveWorkdayDate(Date.now());
    const record = member.records && member.records[activeDate];
    let next;
    if (record) {
      next = {
        date: activeDate,
        dailyWageCents: record.dailyWageCents,
        workStart: record.workStart,
        workEnd: record.workEnd,
        breakEnabled: Boolean(record.breakEnabled),
        breakStart: record.breakStart,
        breakEnd: record.breakEnd,
        overtimeEnabled: Boolean(record.overtimeEnabled),
        pauseIntervals: record.pauseIntervals || [],
        accumulatedMs: Math.max(0, Number(record.workedSeconds) || 0) * 1000,
        wasRunning: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      next = Store.createSession(activeDate, member.settings);
    }

    runtime.running = false;
    runtime.runStartedAt = 0;
    runtime.baseMs = 0;
    runtime.lastSecond = -1;
    runtime.lastPhase = "";
    runtime.lastCents = null;
    state.today = next;
    session = next;
  }

  function handleCloudData(payload) {
    if (!payload || !payload.currentMember) return;
    const member = payload.currentMember;
    const source = payload.source || "poll";
    const previousKey = window.CloudSync.getMemberKey();
    const needsHydrate = source === "initial" || source === "join" || source === "create" ||
      (source === "poll" && !runtime.running);

    state.settings = member.settings;
    state.settingsUpdatedAt = member.settingsUpdatedAt;
    state.records = member.records;
    state.deletedRecords = member.deletedRecords;
    state.restDays = member.restDays || {};
    state.restDayUpdated = member.restDayUpdated || {};
    state.wishlist = member.wishlist || state.wishlist;
    state.ledger = member.ledger || {};

    if (needsHydrate) {
      hydrateSessionFromMember(member);
    }

    if (!ui.settingsDirty) {
      fillSettingsForm(state.settings);
    }

    persistState({ updateRecord: false, silent: true });
    renderAll();
    if (source === "join" || previousKey !== member.id) {
      ui.cloudMemberScope = "me";
      ui.aiAdvice = "";
      ui.aiAdviceLoading = false;
    }
    updateCloudStatus(window.CloudSync.getStatus());
  }

  function setCloudError(element, message) {
    element.hidden = !message;
    element.textContent = message || "";
  }

  function setCloudButtonBusy(button, busy, label) {
    if (!button) return;
    const span = button.querySelector("span");
    if (busy) {
      if (!button.dataset.idleLabel) {
        button.dataset.idleLabel = span ? span.textContent : button.textContent;
      }
      button.disabled = true;
      if (span) span.textContent = label || "处理中…";
      else button.textContent = label || "处理中…";
    } else {
      button.disabled = false;
      if (span) span.textContent = button.dataset.idleLabel || "保存";
      else button.textContent = button.dataset.idleLabel || "保存";
      delete button.dataset.idleLabel;
    }
  }

  function setCloudTab(tab) {
    ui.cloudTab = tab === "join" ? "join" : "create";
    document.querySelectorAll("[data-cloud-tab]").forEach(function (button) {
      const active = button.dataset.cloudTab === ui.cloudTab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    dom.cloudCreatePane.hidden = ui.cloudTab !== "create";
    dom.cloudJoinPane.hidden = ui.cloudTab !== "join";
    dom.cloudConnectedPane.hidden = true;
    dom.cloudTabs.hidden = false;
    dom.cloudIntro.textContent = ui.cloudTab === "create"
      ? "创建一个加密共享空间，把邀请链接和口令分别告诉同事或家人；每个人用自己的称呼记录工资。"
      : "输入共享空间 ID 和口令，用你的称呼进入同一本工资簿。称呼相同会继续同一份记录。";
  }

  function updateCloudDialogPane() {
    const status = ui.cloudStatus || (window.CloudSync ? window.CloudSync.getStatus() : null);
    if (!status) return;

    if (status.connected) {
      dom.cloudTabs.hidden = true;
      dom.cloudCreatePane.hidden = true;
      dom.cloudJoinPane.hidden = true;
      dom.cloudConnectedPane.hidden = false;
      dom.cloudIntro.textContent = "已连接到加密共享工资簿。同一空间内的成员可以查看彼此的工资记录。";
      dom.cloudMemberText.textContent = status.memberName || "--";
      dom.cloudSpaceText.textContent = status.spaceId || "--";
      dom.cloudSpaceText.title = status.spaceId || "";
      dom.cloudSyncText.textContent = status.label;
      dom.cloudLastSync.textContent = formatCloudTime(status.lastSyncedAt);
      dom.cloudMemberCountLabel.textContent = (status.memberCount || 0) + " 位成员 · GitHub Pages 共享版";

      dom.cloudMembersText.replaceChildren();
      const members = window.CloudSync.getMembers();
      members.forEach(function (member) {
        const pill = document.createElement("span");
        pill.className = "cloud-member-pill" + (member.id === status.memberKey ? " is-me" : "");
        pill.textContent = member.name;
        dom.cloudMembersText.appendChild(pill);
      });
      if (!members.length) dom.cloudMembersText.textContent = "--";
      dom.cloudSyncNowBtn.disabled = status.mode === "connecting";
    } else {
      dom.cloudTabs.hidden = false;
      dom.cloudConnectedPane.hidden = true;
      dom.cloudCreatePane.hidden = ui.cloudTab !== "create";
      dom.cloudJoinPane.hidden = ui.cloudTab !== "join";
      dom.cloudMemberCountLabel.textContent = "GitHub Pages 共享版";
    }
  }

  function openCloudDialog(tab, options) {
    const opts = options || {};
    if (opts.spaceId) {
      ui.pendingCloudSpace = opts.spaceId;
      dom.cloudSpaceInput.value = opts.spaceId;
    } else if (!dom.cloudSpaceInput.value) {
      const saved = window.CloudSync && window.CloudSync.getSavedConfig();
      dom.cloudSpaceInput.value = ui.pendingCloudSpace || (saved ? saved.spaceId : "");
    }

    const saved = window.CloudSync && window.CloudSync.getSavedConfig();
    if (saved && saved.memberName && !dom.cloudJoinName.value) {
      dom.cloudJoinName.value = saved.memberName;
    }
    if (saved && saved.memberName && !dom.cloudCreateName.value) {
      dom.cloudCreateName.value = saved.memberName;
    }

    setCloudError(dom.cloudCreateError, tab === "create" ? opts.message || "" : "");
    setCloudError(dom.cloudJoinError, tab === "join" ? opts.message || "" : "");

    if (ui.cloudConnected) {
      updateCloudDialogPane();
    } else {
      const nextTab = tab === "join" || ui.pendingCloudSpace ? "join" : (tab || "create");
      setCloudTab(nextTab);
      updateCloudDialogPane();
    }

    if (!dom.cloudDialog.open) {
      dom.cloudDialog.showModal();
    }

    window.setTimeout(function () {
      if (ui.cloudConnected) {
        dom.cloudSyncNowBtn.focus();
      } else if (ui.cloudTab === "join") {
        if (!dom.cloudSpaceInput.value) dom.cloudSpaceInput.focus();
        else dom.cloudJoinPass.focus();
      } else {
        dom.cloudEmail.focus();
      }
    }, 60);
  }

  function closeCloudDialog() {
    if (dom.cloudDialog.open) dom.cloudDialog.close();
  }

  async function handleCloudCreate(event) {
    event.preventDefault();
    if (dom.cloudCreateBtn.disabled) return;
    setCloudError(dom.cloudCreateError, "");

    const email = dom.cloudEmail.value.trim();
    const passphrase = dom.cloudCreatePass.value;
    const confirmation = dom.cloudCreateConfirm.value;
    const memberName = dom.cloudCreateName.value.trim();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setCloudError(dom.cloudCreateError, "请填写有效邮箱，用于创建 KVdb 共享空间。");
      dom.cloudEmail.focus();
      return;
    }
    if (passphrase.length < 8) {
      setCloudError(dom.cloudCreateError, "空间口令至少需要 8 个字符。");
      dom.cloudCreatePass.focus();
      return;
    }
    if (passphrase !== confirmation) {
      setCloudError(dom.cloudCreateError, "两次输入的空间口令不一致。");
      dom.cloudCreateConfirm.focus();
      return;
    }
    if (!memberName) {
      setCloudError(dom.cloudCreateError, "请填写你的成员称呼。");
      dom.cloudCreateName.focus();
      return;
    }

    setCloudButtonBusy(dom.cloudCreateBtn, true, "创建中…");
    try {
      const result = await window.CloudSync.createSpace({ email: email, passphrase: passphrase, memberName: memberName });
      updateCloudDialogPane();
      showToast("共享工资簿已创建。复制邀请链接，并把口令单独告诉成员。", "success", 5200);
      dom.cloudCreateForm.reset();
      dom.cloudMemberCountLabel.textContent = "空间 ID：" + result.spaceId;
      updateCloudStatus(window.CloudSync.getStatus());
    } catch (error) {
      setCloudError(dom.cloudCreateError, error && error.message ? error.message : "创建共享空间失败。");
    } finally {
      setCloudButtonBusy(dom.cloudCreateBtn, false);
    }
  }

  async function handleCloudJoin(event) {
    event.preventDefault();
    if (dom.cloudJoinBtn.disabled) return;
    setCloudError(dom.cloudJoinError, "");

    const spaceId = dom.cloudSpaceInput.value.trim();
    const passphrase = dom.cloudJoinPass.value;
    const memberName = dom.cloudJoinName.value.trim();

    if (!spaceId) {
      setCloudError(dom.cloudJoinError, "请粘贴邀请链接或填写空间 ID。");
      dom.cloudSpaceInput.focus();
      return;
    }
    if (passphrase.length < 8) {
      setCloudError(dom.cloudJoinError, "请输入至少 8 个字符的空间口令。");
      dom.cloudJoinPass.focus();
      return;
    }
    if (!memberName) {
      setCloudError(dom.cloudJoinError, "请填写你的成员称呼。");
      dom.cloudJoinName.focus();
      return;
    }

    setCloudButtonBusy(dom.cloudJoinBtn, true, "解锁中…");
    try {
      const result = await window.CloudSync.joinSpace({ spaceId: spaceId, passphrase: passphrase, memberName: memberName });
      updateCloudDialogPane();
      if (result.created) {
        showToast("已加入共享空间，并创建了成员「" + result.memberName + "」。", "success", 4800);
      } else {
        showToast("已进入「" + result.memberName + "」的共享工资簿。", "success", 4200);
      }
      dom.cloudJoinPass.value = "";
      updateCloudStatus(window.CloudSync.getStatus());
    } catch (error) {
      setCloudError(dom.cloudJoinError, error && error.message ? error.message : "加入共享空间失败。");
    } finally {
      setCloudButtonBusy(dom.cloudJoinBtn, false);
    }
  }

  async function handleCloudSyncNow() {
    if (!window.CloudSync || !window.CloudSync.isConnected()) {
      openCloudDialog("join");
      return;
    }
    dom.cloudSyncNowBtn.disabled = true;
    try {
      const result = await window.CloudSync.syncNow();
      if (result.ok) {
        showToast("共享工资簿已同步。", "success", 2400);
      } else if (result.code === "busy") {
        showToast("正在同步，请稍候。", "info", 2200);
      } else {
        showToast(result.error || "同步失败，请稍后重试。", "error", 4000);
      }
    } finally {
      dom.cloudSyncNowBtn.disabled = false;
      updateCloudDialogPane();
    }
  }

  async function handleCloudCopyLink() {
    const link = window.CloudSync.getShareUrl();
    if (!link) {
      showToast("当前还没有连接共享空间。", "warning");
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      showToast("邀请链接已复制，请把空间口令单独告诉成员。", "success", 4200);
    } catch (error) {
      window.prompt("复制邀请链接", link);
    }
  }

  function handleCloudDisconnect() {
    closeCloudDialog();
    showConfirm({
      title: "退出共享空间？",
      message: "本机工资记录会保留，云端共享记录不会被删除。之后可以重新输入口令加入。",
      confirmText: "退出空间"
    }).then(function (confirmed) {
      if (!confirmed) return;
      window.CloudSync.disconnect();
      ui.cloudMemberScope = "me";
      ui.pendingCloudSpace = "";
      updateCloudStatus(window.CloudSync.getStatus());
      renderAll();
      showToast("已退出共享空间，当前使用本机记录。", "info", 3800);
    });
  }

  function bindCloudEvents() {
    if (!window.CloudSync) return;
    dom.storageChip.addEventListener("click", function () {
      openCloudDialog(ui.cloudConnected ? "connected" : (ui.pendingCloudSpace ? "join" : "create"));
    });
    document.querySelectorAll("[data-cloud-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        if (ui.cloudConnected) return;
        setCloudTab(button.dataset.cloudTab);
      });
    });
    dom.cloudClose.addEventListener("click", closeCloudDialog);
    dom.cloudDialog.addEventListener("click", function (event) {
      if (event.target === dom.cloudDialog) closeCloudDialog();
    });
    dom.cloudCreateForm.addEventListener("submit", handleCloudCreate);
    dom.cloudJoinForm.addEventListener("submit", handleCloudJoin);
    dom.cloudSyncNowBtn.addEventListener("click", handleCloudSyncNow);
    dom.cloudCopyLinkBtn.addEventListener("click", handleCloudCopyLink);
    dom.cloudDisconnectBtn.addEventListener("click", handleCloudDisconnect);
    dom.memberFilter.addEventListener("change", function () {
      ui.cloudMemberScope = dom.memberFilter.value === "all" ? "all" : "me";
      renderOverview();
    });
    [dom.cloudEmail, dom.cloudCreatePass, dom.cloudCreateConfirm, dom.cloudCreateName].forEach(function (input) {
      input.addEventListener("input", function () { setCloudError(dom.cloudCreateError, ""); });
    });
    [dom.cloudSpaceInput, dom.cloudJoinPass, dom.cloudJoinName].forEach(function (input) {
      input.addEventListener("input", function () { setCloudError(dom.cloudJoinError, ""); });
    });
  }

  /* =======================================================
   * Misc
   * ======================================================= */
  function setStorageUnavailable() {
    ui.localStorageError = true;
    dom.storageChip.classList.add("is-error");
    dom.storageChipText.textContent = "存储异常";
    if (!ui.cloudConnected) {
      dom.dataScopeNote.textContent = "本机存储异常";
    }
  }

  function requestClearData() {
    const count = Object.keys(state.records).length;
    const connected = window.CloudSync && window.CloudSync.isConnected();
    const message = "将永久删除本地保存的 " + count + " 条日工资记录、今日计薪进度、心愿单和全部设置。"
      + (connected ? "\n当前共享空间不会被删除，本机会同时退出共享空间。" : "")
      + "\n此操作无法撤销，建议确认无误后再继续。";

    showConfirm({
      title: "清空全部本地数据？",
      message: message,
      confirmText: "确认清空全部"
    }).then(function (confirmed) {
      if (!confirmed) return;
      if (dom.cloudDialog.open) dom.cloudDialog.close();
      if (window.CloudSync) window.CloudSync.disconnect();
      ui.pendingCloudSpace = "";
      runtime.running = false;
      runtime.runStartedAt = 0;
      runtime.baseMs = 0;
      runtime.lastSecond = 0;
      runtime.lastCents = null;
      const result = Store.clear();
      state = Store.defaultState();
      session = state.today;
      ui.cloudMemberScope = "me";
      runtime.running = false;
      fillSettingsForm(state.settings);
      renderAll();
      activateView("today", { updateHash: true, focus: false });
      if (result.ok) {
        showToast("本地数据已清空，已恢复默认设置。", "success", 3800);
      } else {
        showToast(result.error, "error", 4600);
      }
    });
  }

  /* =======================================================
   * Events
   * ======================================================= */
  function bindEvents() {
    document.querySelectorAll(".tab-button").forEach(function (button) {
      button.addEventListener("click", function () {
        activateView(button.dataset.view, { updateHash: true });
      });
    });

    document.querySelectorAll(".brand").forEach(function (brand) {
      brand.addEventListener("click", function (event) {
        event.preventDefault();
        activateView("today", { updateHash: true });
      });
    });

    dom.startBtn.addEventListener("click", toggleAutoPause);
    if (dom.pauseBtn) {
      dom.pauseBtn.addEventListener("click", toggleAutoPause);
    }
    dom.resetBtn.addEventListener("click", requestResetToday);

    dom.dailyWageInput.addEventListener("change", applyDailyWage);
    dom.workStartInput.addEventListener("change", applyWorkSchedule);
    dom.workEndInput.addEventListener("change", applyWorkSchedule);
    dom.breakToggle.addEventListener("change", onBreakToggle);
    dom.breakStartInput.addEventListener("change", applyBreakTimes);
    dom.breakEndInput.addEventListener("change", applyBreakTimes);
    dom.overtimeToggle.addEventListener("change", onOvertimeToggle);
    dom.restTomorrowToggle.addEventListener("change", onRestTomorrowToggle);

    dom.goalJumpBtn.addEventListener("click", function () {
      activateView("wishlist", { updateHash: true });
    });
    dom.ledgerForm.addEventListener("submit", handleLedgerSubmit);
    dom.ledgerTypeExpense.addEventListener("change", populateLedgerCategories);
    dom.ledgerTypeIncome.addEventListener("change", populateLedgerCategories);
    dom.ledgerAmount.addEventListener("input", function () { setFieldError(null, dom.ledgerError, ""); });
    dom.ledgerList.addEventListener("click", function (event) {
      const button = event.target.closest("[data-delete-ledger]");
      if (button) deleteLedgerEntry(button.dataset.deleteLedger);
    });
    dom.aiRefreshBtn.addEventListener("click", function () {
      renderWishlist();
      showToast("AI 财务教练已根据最新账本重新分析。", "success", 2600);
    });
    dom.aiDeepBtn.addEventListener("click", handleDeepAi);
    dom.wishlistConfigForm.addEventListener("submit", handleWishlistConfigSubmit);
    dom.wishlistTargetInput.addEventListener("input", function () { setFieldError(null, dom.wishlistConfigError, ""); });
    dom.wishlistInitialInput.addEventListener("input", function () { setFieldError(null, dom.wishlistConfigError, ""); });

    [dom.dailyWageInput, dom.workStartInput, dom.workEndInput, dom.breakStartInput, dom.breakEndInput].forEach(function (input) {
      input.addEventListener("input", clearDayErrors);
    });

    dom.settingsLink.addEventListener("click", function () {
      activateView("settings", { updateHash: true });
    });
    dom.jumpOverviewBtn.addEventListener("click", function () {
      activateView("overview", { updateHash: true, resetMonthToCurrent: true });
    });

    dom.prevMonthBtn.addEventListener("click", function () { changeMonth(-1); });
    dom.nextMonthBtn.addEventListener("click", function () { changeMonth(1); });
    dom.monthPicker.addEventListener("change", setMonthFromPicker);
    dom.currentMonthBtn.addEventListener("click", function () {
      ui.month = W.currentMonthKey();
      renderOverview();
    });
    dom.exportCsvBtn.addEventListener("click", exportCsv);

    dom.recordsBody.addEventListener("click", function (event) {
      const button = event.target.closest("[data-delete-date]");
      if (button) deleteRecord(button.dataset.deleteDate, button.dataset.deleteMember || "");
    });

    document.querySelectorAll("[data-go-today]").forEach(function (button) {
      button.addEventListener("click", function () {
        activateView("today", { updateHash: true });
      });
    });

    dom.settingsForm.addEventListener("submit", saveSettings);
    dom.settingsForm.addEventListener("input", function (event) {
      if (event.target.matches("input")) markSettingsDirty();
      if (event.target === dom.defaultWageInput) setFieldError(dom.defaultWageInput, dom.defaultWageError, "");
      if (event.target === dom.settingsStart || event.target === dom.settingsEnd) {
        setFieldError(dom.settingsStart, dom.settingsTimeError, "");
        setFieldError(dom.settingsEnd, dom.settingsTimeError, "");
      }
      if (event.target === dom.settingsBreakStart || event.target === dom.settingsBreakEnd) {
        setSettingsBreakError("");
      }
      if (event.target === dom.multiplierInput) setFieldError(dom.multiplierInput, dom.multiplierError, "");
      if (event.target === dom.hourlyInput) setFieldError(dom.hourlyInput, dom.hourlyError, "");
      updateSettingsPreview();
    });
    dom.settingsForm.addEventListener("change", function (event) {
      if (event.target.name === "overtimeMode") {
        syncOvertimeModeUI();
        updateSettingsPreview();
        markSettingsDirty();
      }
    });
    dom.resetSettingsBtn.addEventListener("click", resetSettingsToDefaults);
    dom.clearDataBtn.addEventListener("click", requestClearData);

    dom.confirmAccept.addEventListener("click", function () { settleConfirm(true); });
    dom.confirmCancel.addEventListener("click", function () { settleConfirm(false); });
    dom.confirmDialog.addEventListener("close", handleDialogClosed);
    dom.confirmDialog.addEventListener("click", function (event) {
      if (event.target === dom.confirmDialog) {
        dom.confirmDialog.returnValue = "cancel";
        dom.confirmDialog.close();
      }
    });

    bindCloudEvents();

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") {
        persistState({ updateRecord: true, silent: true, cloudDirty: false });
      } else {
        ensureCurrentWorkday();
        updateClock();
        if (ui.view === "today") renderTodayLive();
        persistState({ updateRecord: true, silent: true });
      }
    });

    window.addEventListener("beforeunload", function () {
      persistState({ updateRecord: true, silent: true, cloudDirty: false });
    });
  }

  init();
})();
