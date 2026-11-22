/* =========================================================
 * ai.js — 本地 AI 财务教练
 * 纯本地规则分析：目标差距、消费提醒、达成预测与鼓励。
 * 不上传账本，不依赖外部 API。
 * ========================================================= */
(function (global) {
  "use strict";

  function dayKeyOffset(dateKey, offset) {
    const parsed = global.WageCore.parseDateKey(dateKey);
    if (!parsed) return dateKey;
    const date = new Date(parsed.year, parsed.month - 1, parsed.day + offset, 12, 0, 0, 0);
    return global.WageCore.localDateKey(date);
  }

  function sumEntries(entries, predicate) {
    return entries.reduce(function (total, entry) {
      return total + (predicate(entry) ? entry.amountCents : 0);
    }, 0);
  }

  function formatDateShort(dateKey) {
    const parsed = global.WageCore.parseDateKey(dateKey);
    if (!parsed) return "";
    return parsed.month + "月" + parsed.day + "日";
  }

  function analyze(input) {
    const W = global.WageCore;
    const today = input.todayKey || W.todayKey();
    const targetCents = Math.max(1, Number(input.targetCents) || 1);
    const initialSavedCents = Math.max(0, Number(input.initialSavedCents) || 0);
    const records = input.records || {};
    const ledger = input.ledger || {};
    const dailyWageCents = Math.max(0, Number(input.dailyWageCents) || 0);
    const entries = Object.keys(ledger).map(function (key) { return ledger[key]; }).filter(function (entry) {
      return entry && !entry.deleted;
    });

    const salaryCents = Object.keys(records).reduce(function (total, date) {
      return total + Math.max(0, Number(records[date].totalPayCents) || 0);
    }, 0);
    const incomeCents = sumEntries(entries, function (entry) { return entry.type === "income"; });
    const expenseCents = sumEntries(entries, function (entry) { return entry.type === "expense"; });
    const savedCents = initialSavedCents + salaryCents + incomeCents - expenseCents;
    const gapCents = Math.max(0, targetCents - savedCents);
    const progress = W.clamp((savedCents / targetCents) * 100, 0, 100);

    const monthKey = today.slice(0, 7);
    const monthEntries = entries.filter(function (entry) { return entry.date.slice(0, 7) === monthKey; });
    const monthExpenseCents = sumEntries(monthEntries, function (entry) { return entry.type === "expense"; });
    const monthIncomeCents = sumEntries(monthEntries, function (entry) { return entry.type === "income"; });
    const monthSalaryCents = Object.keys(records).reduce(function (total, date) {
      if (date.slice(0, 7) !== monthKey) return total;
      return total + Math.max(0, Number(records[date].totalPayCents) || 0);
    }, 0);
    const monthNetCents = monthSalaryCents + monthIncomeCents - monthExpenseCents;

    const days = [];
    for (let i = 0; i < 14; i += 1) days.push(dayKeyOffset(today, -i));
    let recentNetCents = 0;
    let recentExpenseCents = 0;
    let activeDays = 0;
    days.forEach(function (date) {
      const salary = records[date] ? Math.max(0, Number(records[date].totalPayCents) || 0) : 0;
      const income = sumEntries(entries, function (entry) { return entry.date === date && entry.type === "income"; });
      const expense = sumEntries(entries, function (entry) { return entry.date === date && entry.type === "expense"; });
      recentNetCents += salary + income - expense;
      recentExpenseCents += expense;
      if (salary || income || expense) activeDays += 1;
    });
    const avgNetCents = activeDays > 0 ? Math.round(recentNetCents / Math.max(1, activeDays)) : 0;
    const etaDays = gapCents > 0 && avgNetCents > 0 ? Math.ceil(gapCents / avgNetCents) : null;
    const etaDate = etaDays ? dayKeyOffset(today, etaDays) : "";

    const categoryTotals = {};
    entries.forEach(function (entry) {
      if (entry.type !== "expense") return;
      const age = Math.round((W.dateTimeMs(today, "12:00") - W.dateTimeMs(entry.date, "12:00")) / 86400000);
      if (age > 30 || age < 0) return;
      categoryTotals[entry.category] = (categoryTotals[entry.category] || 0) + entry.amountCents;
    });
    const topCategory = Object.keys(categoryTotals).sort(function (a, b) {
      return categoryTotals[b] - categoryTotals[a];
    })[0] || "";
    const topCategoryCents = topCategory ? categoryTotals[topCategory] : 0;
    const expense30 = Object.keys(categoryTotals).reduce(function (total, key) { return total + categoryTotals[key]; }, 0);
    const topShare = expense30 > 0 ? topCategoryCents / expense30 : 0;

    const prev7Days = [];
    for (let i = 7; i < 14; i += 1) prev7Days.push(dayKeyOffset(today, -i));
    let prev7Expense = 0;
    prev7Days.forEach(function (date) {
      prev7Expense += sumEntries(entries, function (entry) { return entry.date === date && entry.type === "expense"; });
    });
    const recent7Expense = recentExpenseCents - prev7Expense;
    const spendTrend = prev7Expense > 0 ? (recent7Expense - prev7Expense) / prev7Expense : 0;

    const insights = [];
    insights.push({
      tag: gapCents === 0 ? "GOAL REACHED" : "GOAL GAP",
      tone: gapCents === 0 ? "success" : "gold",
      title: gapCents === 0 ? "目标已经达成" : "离 SU7 还差 " + W.formatMoney(gapCents),
      text: gapCents === 0
        ? "心愿单已经攒满。可以设置新的目标，或把这笔钱留作提车后的第一份礼物。"
        : "已攒 " + W.formatMoney(savedCents) + "，完成 " + Math.round(progress) + "%。把大目标拆成每天的一小笔，差距会越来越小。"
    });

    let spendText;
    if (entries.length === 0) {
      spendText = "还没有支出记录。从今天的第一笔外卖或通勤开始记，AI 才能看出你的消费节奏。";
    } else if (topCategory && topShare >= 0.35) {
      spendText = "最近 30 天「" + topCategory + "」花了 " + W.formatMoney(topCategoryCents) + "，占支出的 " + Math.round(topShare * 100) + "%。这是最值得先优化的部分。";
    } else if (spendTrend > 0.2) {
      spendText = "最近 7 天支出比前 7 天高 " + Math.round(spendTrend * 100) + "%。节奏有点加快，今天可以先设一个更小的消费上限。";
    } else if (recentExpenseCents === 0) {
      spendText = "最近 14 天没有支出记录，结余正在完整地流向心愿单。保持这个节奏。";
    } else {
      spendText = "最近 14 天支出 " + W.formatMoney(recentExpenseCents) + "，整体节奏平稳。继续记录，才能看见真正可以省下的部分。";
    }
    insights.push({
      tag: "SPENDING PULSE",
      tone: topCategory && topShare >= 0.35 ? "warning" : "neutral",
      title: topCategory ? "最大支出： " + topCategory : "消费提醒",
      text: spendText
    });

    let etaText;
    if (gapCents === 0) {
      etaText = "目标已经完成，接下来每一笔都是额外的底气。";
    } else if (etaDays && etaDays <= 3650) {
      etaText = "按最近 " + Math.max(1, activeDays) + " 个有记录日的平均结余 " + W.formatMoney(avgNetCents) + " 计算，约 " + etaDays + " 天后（" + formatDateShort(etaDate) + "）可以达成。";
    } else if (avgNetCents <= 0) {
      etaText = "最近的支出不低于收入。先把每日结余转正，预测才会变得有意义。";
    } else {
      etaText = "按当前节奏还需要较长时间。提高日薪、减少非必要支出，都会明显缩短这条路。";
    }
    insights.push({
      tag: "FORECAST",
      tone: etaDays && etaDays <= 365 ? "success" : "neutral",
      title: etaDays ? "预计 " + etaDays + " 天后达成" : "先让结余转正",
      text: etaText
    });

    let motivation;
    if (progress >= 100) {
      motivation = "你做到了。每一秒的认真，最后都变成了想要的生活。";
    } else if (progress >= 70) {
      motivation = "已经走过 " + Math.round(progress) + "%，最后一段最难也最值得。别急，继续按自己的节奏。";
    } else if (progress >= 30) {
      motivation = "你已经攒下 " + W.formatMoney(savedCents) + "。这不是数字，是你一次次对欲望说“等等”的结果。";
    } else if (savedCents > 0) {
      motivation = "第一笔 " + W.formatMoney(savedCents) + " 已经到账。SU7 不是一天的冲动，是每天多一点点的选择。";
    } else {
      motivation = "今天的工资会自动进来。先记下第一笔支出，让心愿单从“想要”变成“正在发生”。";
    }
    insights.push({
      tag: "KEEP GOING",
      tone: "quote",
      title: "给正在攒车的你",
      text: motivation
    });

    return {
      savedCents: savedCents,
      gapCents: gapCents,
      progress: progress,
      salaryCents: salaryCents,
      incomeCents: incomeCents,
      expenseCents: expenseCents,
      monthExpenseCents: monthExpenseCents,
      monthIncomeCents: monthIncomeCents,
      monthSalaryCents: monthSalaryCents,
      monthNetCents: monthNetCents,
      recentExpenseCents: recentExpenseCents,
      avgNetCents: avgNetCents,
      etaDays: etaDays,
      etaDate: etaDate,
      topCategory: topCategory,
      topCategoryCents: topCategoryCents,
      insights: insights
    };
  }

  async function remoteAdvice(analysis, targetCents) {
    const W = global.WageCore;
    const summary = {
      目标金额: W.formatMoney(targetCents),
      已攒: W.formatMoney(analysis.savedCents),
      还差: W.formatMoney(analysis.gapCents),
      完成度: Math.round(analysis.progress * 10) / 10 + "%",
      累计工资: W.formatMoney(analysis.salaryCents),
      累计支出: W.formatMoney(analysis.expenseCents),
      本月支出: W.formatMoney(analysis.monthExpenseCents),
      本月结余: W.formatMoney(analysis.monthNetCents),
      最大支出分类: analysis.topCategory || "暂无",
      最近14天支出: W.formatMoney(analysis.recentExpenseCents),
      预计达成天数: analysis.etaDays || "暂无法预测"
    };
    const prompt = "你是「秒薪」应用的 AI 财务教练。用户正在为小米 SU7 攒钱。"
      + "下面是用户主动授权的汇总数据（不含姓名、备注和逐笔明细）：" + JSON.stringify(summary) + "。"
      + "请用中文给出 3 句话：第一句指出与目标的差距和当前进度；第二句给出一个具体、温和的消费提醒；第三句给一句不油腻、有行动感的鼓励。"
      + "只能使用给出的数字，不要编造，不要提及其他隐私，总字数控制在 120 字以内。";
    const controller = new AbortController();
    const timer = global.setTimeout(function () { controller.abort(); }, 22000);
    try {
      const response = await global.fetch("https://text.pollinations.ai/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "openai",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7,
          max_tokens: 320
        }),
        signal: controller.signal
      });
      if (!response.ok) throw new Error("AI 请求失败（" + response.status + "）");
      const data = await response.json();
      const text = data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";
      const clean = String(text || "").replace(/^["“]|["”]$/g, "").trim();
      if (!clean) throw new Error("AI 没有返回内容");
      return clean.slice(0, 500);
    } finally {
      global.clearTimeout(timer);
    }
  }

  global.FinanceAI = { analyze: analyze, remoteAdvice: remoteAdvice };
})(typeof window !== "undefined" ? window : globalThis);