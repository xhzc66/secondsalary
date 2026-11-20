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
    cloudAutoConnectTried: false
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
      "progressFootLeft", "progressFootRight", "startBtn", "startBtnText", "pauseBtn", "resetBtn",
      "dailyWageInput", "wageError", "workStartInput", "workEndInput", "standardDuration", "timeError",
      "breakToggle", "breakFields", "breakStartInput", "breakEndInput", "breakOffLabel", "breakHint", "breakError",
      "crossDayBadge", "dayMemberBadge", "overtimeToggle", "overtimeRuleText", "overtimeRuleDetail", "settingsLink",
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
      "confirmDialog", "dialogIcon", "confirmTitle", "confirmMessage", "confirmCancel", "confirmAccept", "toastRegion"
    ].forEach(function (id) { dom[id] = $(id); });
  }

  function restoreSession(loaded) {
    runtime.baseMs = Math.max(0, Number(session.accumulatedMs) || 0);
    session.accumulatedMs = runtime.baseMs;
    runtime.running = false;
    runtime.runStartedAt = 0;

    const wasRunning = Boolean(session.wasRunning);
    session.wasRunning = false;

    let rolled = false;
    let hadProgress = false;
    const today = W.todayKey();

    if (session.date !== today) {
      hadProgress = runtime.baseMs >= 1000;
      if (hadProgress && !state.records[session.date]) {
        const oldRecord = buildRecordFor(session, runtime.baseMs);
        if (oldRecord) state.records[oldRecord.date] = oldRecord;
      }
      state.today = Store.createSession(today, state.settings);
      session = state.today;
      runtime.baseMs = 0;
      runtime.lastSecond = -1;
      rolled = true;
    }

    if (loaded.storageError) {
      setStorageUnavailable();
    }

    persistState({ updateRecord: false, silent: true });

    if (wasRunning) {
      ui.initialToasts.push({
        message: "已恢复上次计时进度，并自动暂停；点击「继续计薪」即可接着累计。",
        type: "warning"
      });
    }
    if (rolled && hadProgress) {
      ui.initialToasts.push({
        message: "检测到新的一天，今日计时已重新开始，昨天的记录已保留。",
        type: "info"
      });
    }
  }

  function readInitialView() {
    const hash = String(window.location.hash || "").replace("#", "");
    if (hash === "today" || hash === "overview" || hash === "settings") return hash;
    return "today";
  }

  /* =======================================================
   * Time & persistence
   * ======================================================= */
  function activeMilliseconds() {
    if (runtime.running) {
      return runtime.baseMs + Math.max(0, performance.now() - runtime.runStartedAt);
    }
    return runtime.baseMs;
  }

  function activeSeconds() {
    return Math.floor(activeMilliseconds() / 1000);
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

  function currentPay() {
    return W.calcPay(dayConfig(), activeSeconds());
  }

  function buildRecordFor(targetSession, totalMs) {
    const workedSeconds = Math.floor(Math.max(0, Number(totalMs) || 0) / 1000);
    if (workedSeconds <= 0) return null;
    const config = dayConfig(targetSession);
    const pay = W.calcPay(config, workedSeconds);
    if (!pay) return null;
    return {
      date: targetSession.date,
      dailyWageCents: targetSession.dailyWageCents,
      workStart: targetSession.workStart,
      workEnd: targetSession.workEnd,
      breakEnabled: targetSession.breakEnabled,
      breakStart: targetSession.breakStart,
      breakEnd: targetSession.breakEnd,
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
    const totalMs = activeMilliseconds();
    session.accumulatedMs = Math.max(0, Math.floor(totalMs));
    session.wasRunning = runtime.running;
    session.updatedAt = new Date().toISOString();

    if (!state.deletedRecords) state.deletedRecords = {};

    if (opts.updateRecord !== false) {
      const record = buildRecordFor(session, totalMs);
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
      deletedRecords: state.deletedRecords
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

  function ensureCurrentDay() {
    const today = W.todayKey();
    if (session.date === today) return false;

    const wasRunning = runtime.running;
    if (wasRunning) {
      const pausedMs = activeMilliseconds();
      runtime.baseMs = pausedMs;
      runtime.running = false;
      runtime.runStartedAt = 0;
    }

    const currentMs = activeMilliseconds();
    const oldRecord = buildRecordFor(session, currentMs);
    if (oldRecord) state.records[oldRecord.date] = oldRecord;

    state.today = Store.createSession(today, state.settings);
    session = state.today;
    runtime.baseMs = 0;
    runtime.running = false;
    runtime.runStartedAt = 0;
    runtime.lastSecond = -1;
    runtime.lastCents = null;

    persistState({ updateRecord: false, silent: true });
    renderAll();
    showToast("检测到新的一天，今日计时已重新开始。", "info", 4000);

    if (wasRunning) {
      showToast("跨天后计时已自动暂停，请在新的一天重新开始。", "warning", 4200);
    }
    return true;
  }

  /* =======================================================
   * Tick
   * ======================================================= */
  function tick() {
    updateClock();
    if (ensureCurrentDay()) return;

    if (!runtime.running) return;

    const seconds = activeSeconds();
    if (seconds !== runtime.lastSecond) {
      runtime.lastSecond = seconds;
      renderTodayLive();
    }

    if (performance.now() - runtime.lastPersistAt >= 2000) {
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

    const today = W.todayKey();
    dom.todayDateLabel.textContent = W.formatFullDateCN(today);
    dom.todayWeekdayLabel.textContent = W.formatWeekdayCN(today);
    dom.heroDate.textContent = W.formatDateCN(today) + " · " + W.formatWeekdayCN(today, true);
  }

  /* =======================================================
   * Rendering — today
   * ======================================================= */
  function renderAll() {
    renderTodayConfig();
    renderTodayLive();
    if (ui.view === "overview") renderOverview();
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
        : "开启后从标准工时中扣除休息时间；休息时请暂停计时。";
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

    const rates = W.getRates(dayConfig());
    dom.dayBasePotential.textContent = "¥" + W.formatMoney(session.dailyWageCents);
    dom.dayOtPotential.textContent = rates
      ? "+¥" + W.formatHourlyYuan(rates.overtimeHourlyCents) + " / 时"
      : "—";

    renderSaveStateLabel();
  }

  function renderTodayLive() {
    const totalMs = activeMilliseconds();
    const seconds = Math.floor(totalMs / 1000);
    const calc = currentPay();
    if (!calc || !calc.rates) return;

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
    dom.workedTime.textContent = W.formatDuration(seconds);
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

    renderStatus(calc, seconds);
    renderControls(calc, seconds);
  }

  function renderStatus(calc, seconds) {
    let statusClass = "is-idle";
    let statusLabel = "等待开始";

    if (runtime.running) {
      statusClass = "is-running";
      statusLabel = "正在计薪";
    } else if (seconds > 0) {
      statusClass = "is-paused";
      statusLabel = "已暂停";
    }

    dom.statusPill.className = "status-pill " + statusClass;
    dom.statusText.textContent = statusLabel;

    dom.amountNote.classList.toggle("is-live", runtime.running);
    let note = "点击开始，工资将按秒累计";

    if (runtime.running) {
      if (calc.workedSeconds >= calc.totalSeconds && !session.overtimeEnabled) {
        note = "标准工时已满 · 开启今日加班可继续累计加班费";
      } else if (calc.workedSeconds >= calc.totalSeconds && session.overtimeEnabled) {
        note = "加班计费中 · 每秒 +¥" + W.formatPerSecond(calc.rates.overtimePerSecondCents);
      } else {
        note = "正在计薪 · 每秒 +¥" + W.formatPerSecond(calc.rates.standardPerSecondCents);
      }
    } else if (seconds > 0) {
      note = "已暂停 · 金额冻结在 ¥" + W.formatMoney(calc.totalCents);
    }

    dom.amountNoteText.textContent = note;
  }

  function renderControls(calc, seconds) {
    const hasProgress = activeMilliseconds() > 0;
    dom.startBtn.disabled = runtime.running;
    dom.startBtnText.textContent = runtime.running
      ? "计薪中…"
      : (hasProgress ? "继续计薪" : "开始计薪");
    dom.pauseBtn.disabled = !runtime.running;
    dom.resetBtn.disabled = !runtime.running && seconds === 0 && !state.records[session.date];
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
      dateStrong.textContent = W.formatDateCN(record.date);
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
      "，休息时请暂停计时。";
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
  function startTimer() {
    ensureCurrentDay();
    if (runtime.running) return;
    const current = activeMilliseconds();
    runtime.baseMs = current;
    runtime.runStartedAt = performance.now();
    runtime.running = true;
    runtime.lastSecond = Math.floor(current / 1000);
    runtime.lastCents = null;

    const calc = currentPay();
    if (calc && calc.workedSeconds >= calc.totalSeconds && !session.overtimeEnabled) {
      showToast("标准工时已经完成，先开启「今日加班」才会继续累计加班费。", "warning", 4200);
    }

    persistState({ updateRecord: false, silent: true });
    renderTodayLive();
    renderSaveStateLabel();
  }

  function pauseTimer(options) {
    if (!runtime.running) return;
    const total = activeMilliseconds();
    runtime.baseMs = total;
    runtime.running = false;
    runtime.runStartedAt = 0;
    session.accumulatedMs = Math.floor(total);
    session.wasRunning = false;

    persistState({ updateRecord: true, silent: true });
    nudgeCloudSync(0);
    renderTodayLive();
    renderSaveStateLabel();
    if (!options || options.toast !== false) {
      showToast("已暂停，金额已冻结。点击「继续计薪」可接着累计。", "info", 3200);
    }
  }

  function requestResetToday() {
    if (!runtime.running && activeSeconds() === 0 && !state.records[session.date]) {
      showToast("今日还没有可以重置的计时。", "warning");
      return;
    }

    const total = activeMilliseconds();
    const calc = W.calcPay(dayConfig(), Math.floor(total / 1000));
    const amount = calc ? "¥" + W.formatMoney(calc.totalCents) : "¥0.00";
    showConfirm({
      title: "重置今日计时？",
      message: "将清空今日已累计的 " + W.formatDuration(Math.floor(total / 1000)) + " 和 " + amount + "，并删除今日工资记录。\n其他日期的记录和当前配置不会受影响。",
      confirmText: "确认重置"
    }).then(function (confirmed) {
      if (!confirmed) return;
      resetToday();
    });
  }

  function resetToday() {
    runtime.running = false;
    runtime.runStartedAt = 0;
    runtime.baseMs = 0;
    runtime.lastSecond = 0;
    runtime.lastCents = null;
    session.accumulatedMs = 0;
    session.wasRunning = false;
    if (state.records[session.date]) {
      state.deletedRecords[session.date] = new Date().toISOString();
    }
    delete state.records[session.date];
    persistState({ updateRecord: false, silent: true });
    nudgeCloudSync(0);
    renderAll();
    showToast("今日计时已重置。", "success");
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
      showToast("设置已保存，加班费标准已立即生效；今日已有计时，原有日薪、工时和休息设置保持不变。", "success", 4600);
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
      + (isToday ? "\n今日计时也会一并重置，其他日期不受影响。" : "\n此操作无法撤销。");

    showConfirm({
      title: isToday ? "删除今日记录？" : "删除这一天的记录？",
      message: message,
      confirmText: "确认删除"
    }).then(function (confirmed) {
      if (!confirmed) return;

      if (isToday) {
        runtime.running = false;
        runtime.runStartedAt = 0;
        runtime.baseMs = 0;
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
    if (view !== "today" && view !== "overview" && view !== "settings") {
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
      deletedRecords: state.deletedRecords || {}
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
    const today = W.todayKey();
    const record = member.records && member.records[today];
    let next;
    if (record) {
      next = {
        date: today,
        dailyWageCents: record.dailyWageCents,
        workStart: record.workStart,
        workEnd: record.workEnd,
        breakEnabled: Boolean(record.breakEnabled),
        breakStart: record.breakStart,
        breakEnd: record.breakEnd,
        overtimeEnabled: Boolean(record.overtimeEnabled),
        accumulatedMs: Math.max(0, Number(record.workedSeconds) || 0) * 1000,
        wasRunning: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    } else {
      next = Store.createSession(today, member.settings);
    }

    runtime.running = false;
    runtime.runStartedAt = 0;
    runtime.baseMs = next.accumulatedMs;
    runtime.lastSecond = Math.floor(next.accumulatedMs / 1000);
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
    const message = "将永久删除本地保存的 " + count + " 条日工资记录、今日计时进度和全部设置。"
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

    dom.startBtn.addEventListener("click", startTimer);
    dom.pauseBtn.addEventListener("click", function () { pauseTimer(); });
    dom.resetBtn.addEventListener("click", requestResetToday);

    dom.dailyWageInput.addEventListener("change", applyDailyWage);
    dom.workStartInput.addEventListener("change", applyWorkSchedule);
    dom.workEndInput.addEventListener("change", applyWorkSchedule);
    dom.breakToggle.addEventListener("change", onBreakToggle);
    dom.breakStartInput.addEventListener("change", applyBreakTimes);
    dom.breakEndInput.addEventListener("change", applyBreakTimes);
    dom.overtimeToggle.addEventListener("change", onOvertimeToggle);

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
        updateClock();
        if (ui.view === "today") renderTodayLive();
      }
    });

    window.addEventListener("beforeunload", function () {
      persistState({ updateRecord: true, silent: true, cloudDirty: false });
    });
  }

  init();
})();
