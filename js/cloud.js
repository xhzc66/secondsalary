/* =========================================================
 * cloud.js — 多人共享工资簿
 * GitHub Pages + KVdb + 端到端加密（PBKDF2 / AES-GCM）
 * 一个加密空间内可按成员保存各自的设置与日工资记录。
 * ========================================================= */
(function (global) {
  "use strict";

  const W = global.WageCore;
  const Store = global.SalaryStore;

  const CONFIG_KEY = "secondsalary.cloud.config.v1";
  const KVDB_ORIGIN = "https://kvdb.io";
  const KVDB_KEY = "ledger";
  const PBKDF2_ITERATIONS = 310000;
  const MIN_PASSPHRASE_LENGTH = 8;
  const MAX_MEMBER_NAME = 16;
  const MAX_MEMBERS = 80;
  const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]{16,40}$/;
  const REQUEST_TIMEOUT_MS = 11000;
  const SYNC_INTERVAL_MS = 60000;
  const PUSH_DELAY_MS = 60000;
  const CLOUD_VERSION = 1;

  const state = {
    adapter: null,
    connected: false,
    mode: "local",
    spaceId: "",
    memberKey: "",
    memberName: "",
    passphrase: "",
    cryptoKey: null,
    envelopeMeta: null,
    data: null,
    revision: 0,
    lastSyncedAt: 0,
    lastError: "",
    dirty: false,
    localMutation: 0,
    syncing: false,
    flushing: false,
    applying: false,
    pushTimer: 0,
    pollTimer: 0,
    initialized: false
  };

  class CloudError extends Error {
    constructor(message, code, options) {
      super(message);
      this.name = "CloudError";
      this.code = code || "cloud_error";
      this.status = (options && options.status) || 0;
    }
  }

  /* =========================================================
   * Small helpers
   * ========================================================= */
  function nowIso() {
    return new Date().toISOString();
  }

  function parseStamp(value) {
    const stamp = Date.parse(value);
    return Number.isFinite(stamp) ? stamp : 0;
  }

  function delay(ms) {
    return new Promise(function (resolve) { global.setTimeout(resolve, ms); });
  }

  function normalizeMemberName(value) {
    return String(value == null ? "" : value)
      .normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_MEMBER_NAME);
  }

  function memberKeyForName(value) {
    const name = normalizeMemberName(value);
    return name ? name.toLocaleLowerCase("zh-CN") : "";
  }

  function validateMemberName(value) {
    const name = normalizeMemberName(value);
    if (!name) {
      throw new CloudError("请填写你在共享工资簿中的称呼", "invalid_member");
    }
    return name;
  }

  function validatePassphrase(value) {
    const passphrase = String(value == null ? "" : value);
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      throw new CloudError("空间口令至少需要 " + MIN_PASSPHRASE_LENGTH + " 个字符", "invalid_passphrase");
    }
    return passphrase;
  }

  function normalizeSpaceId(value) {
    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";

    const direct = raw.match(/^([A-Za-z0-9_-]{16,40})$/);
    if (direct) return direct[1];

    try {
      const url = new URL(raw);
      const query = url.searchParams.get("space");
      if (query && SPACE_ID_PATTERN.test(query)) return query;
      const hash = url.hash.match(/space=([A-Za-z0-9_-]{16,40})/);
      if (hash) return hash[1];
    } catch (error) {
      // 继续按普通文本匹配。
    }

    const embedded = raw.match(/[?&#]space=([A-Za-z0-9_-]{16,40})/);
    return embedded ? embedded[1] : raw;
  }

  function getUrlSpaceId() {
    try {
      const url = new URL(global.location.href);
      const query = url.searchParams.get("space");
      if (query && SPACE_ID_PATTERN.test(query)) return query;
    } catch (error) {
      // ignore
    }
    const legacy = String(global.location.hash || "").match(/^#space=([A-Za-z0-9_-]{16,40})$/);
    return legacy ? legacy[1] : "";
  }

  function setUrlSpaceId(spaceId) {
    try {
      const url = new URL(global.location.href);
      if (spaceId) url.searchParams.set("space", spaceId);
      else url.searchParams.delete("space");
      if (/^#space=/.test(url.hash)) url.hash = "#today";
      const next = url.pathname + url.search + url.hash;
      global.history.replaceState(null, "", next);
    } catch (error) {
      // ignore
    }
  }

  function getShareUrl() {
    if (!state.spaceId) return "";
    try {
      const url = new URL(global.location.href);
      url.searchParams.set("space", state.spaceId);
      url.hash = "";
      return url.toString();
    } catch (error) {
      return "";
    }
  }

  /* =========================================================
   * Local config
   * ========================================================= */
  function readConfig() {
    try {
      const raw = JSON.parse(global.localStorage.getItem(CONFIG_KEY) || "null");
      if (!raw || !SPACE_ID_PATTERN.test(raw.spaceId || "")) return null;
      return {
        spaceId: raw.spaceId,
        passphrase: typeof raw.passphrase === "string" ? raw.passphrase : "",
        memberKey: typeof raw.memberKey === "string" ? raw.memberKey : "",
        memberName: typeof raw.memberName === "string" ? raw.memberName : ""
      };
    } catch (error) {
      return null;
    }
  }

  function saveConfig() {
    try {
      global.localStorage.setItem(CONFIG_KEY, JSON.stringify({
        spaceId: state.spaceId,
        passphrase: state.passphrase,
        memberKey: state.memberKey,
        memberName: state.memberName,
        savedAt: nowIso()
      }));
    } catch (error) {
      // 本次会话仍然可以继续同步。
    }
  }

  function clearConfig() {
    try {
      global.localStorage.removeItem(CONFIG_KEY);
    } catch (error) {
      // ignore
    }
  }

  /* =========================================================
   * Crypto
   * ========================================================= */
  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk));
    }
    return global.btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = global.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function ensureCrypto() {
    if (!global.crypto || !global.crypto.subtle) {
      throw new CloudError("共享功能需要 HTTPS 或 localhost 环境（浏览器 Web Crypto）", "crypto_unavailable");
    }
  }

  async function deriveKey(passphrase, saltBytes, iterations) {
    const material = await global.crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return global.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptPayload(key, payload, meta) {
    const iv = global.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const cipher = await global.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain);
    return {
      v: 1,
      kdf: {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: meta.iterations,
        salt: meta.salt
      },
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(cipher))
    };
  }

  async function decryptPayload(envelope, key) {
    let plain;
    try {
      plain = await global.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
        key,
        base64ToBytes(envelope.data)
      );
    } catch (error) {
      throw new CloudError("空间口令不正确，或共享数据已损坏", "decrypt_failed");
    }

    try {
      return JSON.parse(new TextDecoder().decode(plain));
    } catch (error) {
      throw new CloudError("共享空间的数据格式异常", "invalid_data");
    }
  }

  function validateEnvelope(envelope) {
    if (!envelope || envelope.v !== 1 || !envelope.kdf ||
        typeof envelope.kdf.salt !== "string" ||
        !Number.isInteger(envelope.kdf.iterations) ||
        typeof envelope.iv !== "string" ||
        typeof envelope.data !== "string") {
      throw new CloudError("共享空间里的数据格式异常", "invalid_envelope");
    }
    return envelope;
  }

  /* =========================================================
   * KVdb
   * ========================================================= */
  function makeTimeout(timeout) {
    const controller = new AbortController();
    const timer = global.setTimeout(function () { controller.abort(); }, timeout);
    return { controller: controller, timer: timer };
  }

  async function fetchEnvelope(spaceId, timeout) {
    const limit = timeout || REQUEST_TIMEOUT_MS;
    const guard = makeTimeout(limit);
    try {
      const response = await global.fetch(
        KVDB_ORIGIN + "/" + encodeURIComponent(spaceId) + "/" + KVDB_KEY + "?t=" + Date.now(),
        {
          method: "GET",
          headers: { Accept: "text/plain" },
          cache: "no-store",
          signal: guard.controller.signal
        }
      );
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new CloudError("共享空间暂时不可用（" + response.status + "）", "kvdb_error", { status: response.status });
      }
      const text = await response.text();
      if (!text.trim()) return null;
      let envelope;
      try {
        envelope = JSON.parse(text);
      } catch (error) {
        throw new CloudError("共享空间返回了异常数据", "invalid_envelope");
      }
      return validateEnvelope(envelope);
    } catch (error) {
      if (error instanceof CloudError) throw error;
      if (error && error.name === "AbortError") {
        throw new CloudError("连接共享空间超时，请检查网络", "timeout");
      }
      throw new CloudError("无法连接共享空间，请检查网络", "network_error");
    } finally {
      global.clearTimeout(guard.timer);
    }
  }

  async function fetchEnvelopeWithRetry(spaceId) {
    try {
      return await fetchEnvelope(spaceId, 10000);
    } catch (error) {
      if (error.code !== "timeout" && error.code !== "network_error") throw error;
      await delay(650);
      return fetchEnvelope(spaceId, 20000);
    }
  }

  async function putEnvelope(spaceId, envelope, timeout) {
    const limit = timeout || 12000;
    const guard = makeTimeout(limit);
    try {
      const response = await global.fetch(
        KVDB_ORIGIN + "/" + encodeURIComponent(spaceId) + "/" + KVDB_KEY,
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify(envelope),
          signal: guard.controller.signal
        }
      );
      if (!response.ok) {
        throw new CloudError("保存到共享空间失败（" + response.status + "）", "kvdb_write_failed", { status: response.status });
      }
    } catch (error) {
      if (error instanceof CloudError) throw error;
      if (error && error.name === "AbortError") {
        throw new CloudError("保存共享数据超时，请检查网络", "timeout");
      }
      throw new CloudError("无法写入共享空间，请检查网络", "network_error");
    } finally {
      global.clearTimeout(guard.timer);
    }
  }

  async function putEnvelopeWithRetry(spaceId, envelope) {
    try {
      return await putEnvelope(spaceId, envelope, 12000);
    } catch (error) {
      if (error.code !== "timeout" && error.code !== "network_error") throw error;
      await delay(650);
      return putEnvelope(spaceId, envelope, 20000);
    }
  }

  async function createKvdbBucket(email) {
    const guard = makeTimeout(25000);
    try {
      const response = await global.fetch(KVDB_ORIGIN + "/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "email=" + encodeURIComponent(email),
        signal: guard.controller.signal
      });
      const text = (await response.text()).trim();
      if (!response.ok) {
        throw new CloudError("创建共享空间失败（" + response.status + "）", "bucket_create_failed", { status: response.status });
      }
      if (!SPACE_ID_PATTERN.test(text)) {
        throw new CloudError("共享存储返回了无效的空间 ID", "bucket_create_failed");
      }
      return text;
    } catch (error) {
      if (error instanceof CloudError) throw error;
      if (error && error.name === "AbortError") {
        throw new CloudError("创建共享空间超时，请检查网络", "timeout");
      }
      throw new CloudError("无法创建共享空间，请检查网络或邮箱", "network_error");
    } finally {
      global.clearTimeout(guard.timer);
    }
  }

  /* =========================================================
   * Cloud data model
   * ========================================================= */
  function emptyCloudData() {
    return {
      version: CLOUD_VERSION,
      revision: 1,
      updatedAt: nowIso(),
      members: {}
    };
  }

  function recordStamp(record) {
    return parseStamp(record && record.updatedAt);
  }

  function mergeRecordSets(localRecords, localDeleted, remoteRecords, remoteDeleted) {
    const records = Object.assign({}, remoteRecords || {}, localRecords || {});
    const deleted = Object.assign({}, remoteDeleted || {}, localDeleted || {});
    const dates = new Set(Object.keys(records).concat(Object.keys(deleted)));
    const mergedRecords = {};
    const mergedDeleted = {};

    dates.forEach(function (date) {
      const localRecord = localRecords && localRecords[date];
      const remoteRecord = remoteRecords && remoteRecords[date];
      let winner = null;
      if (localRecord && remoteRecord) {
        winner = recordStamp(localRecord) >= recordStamp(remoteRecord) ? localRecord : remoteRecord;
      } else {
        winner = localRecord || remoteRecord || null;
      }

      const localDeleteStamp = parseStamp(localDeleted && localDeleted[date]);
      const remoteDeleteStamp = parseStamp(remoteDeleted && remoteDeleted[date]);
      const deleteStamp = Math.max(localDeleteStamp, remoteDeleteStamp);

      if (winner && recordStamp(winner) > deleteStamp) {
        mergedRecords[date] = winner;
      } else if (deleteStamp > 0) {
        mergedDeleted[date] = new Date(deleteStamp).toISOString();
      }
    });

    return {
      records: Store.normalizeRecords(mergedRecords),
      deletedRecords: Store.normalizeDeletedRecords(mergedDeleted)
    };
  }

  function mergeRestDays(localRestDays, localUpdated, remoteRestDays, remoteUpdated) {
    const days = Object.assign({}, remoteRestDays || {}, localRestDays || {});
    const updated = {};
    const localMap = localUpdated || {};
    const remoteMap = remoteUpdated || {};
    const dates = new Set(Object.keys(localMap).concat(Object.keys(remoteMap)));
    dates.forEach(function (date) {
      const localStamp = parseStamp(localMap[date]);
      const remoteStamp = parseStamp(remoteMap[date]);
      const winner = Math.max(localStamp, remoteStamp);
      if (winner > 0) updated[date] = new Date(winner).toISOString();
      if (localStamp || remoteStamp) {
        const localWins = localStamp >= remoteStamp;
        const value = localWins ? Boolean(localRestDays && localRestDays[date]) : Boolean(remoteRestDays && remoteRestDays[date]);
        if (value) days[date] = true;
        else delete days[date];
      }
    });
    return { restDays: Store.normalizeRestDays(days), restDayUpdated: Store.normalizeRestDayUpdated(updated) };
  }

  function mergeWishlist(localWishlist, remoteWishlist, preferLocal) {
    if (!remoteWishlist) return Store.normalizeWishlist(localWishlist);
    if (!localWishlist) return Store.normalizeWishlist(remoteWishlist);
    if (!preferLocal) return Store.normalizeWishlist(remoteWishlist);
    return parseStamp(localWishlist.updatedAt) > parseStamp(remoteWishlist.updatedAt)
      ? Store.normalizeWishlist(localWishlist)
      : Store.normalizeWishlist(remoteWishlist);
  }

  function mergeLedger(localLedger, remoteLedger) {
    const result = {};
    const local = Store.normalizeLedger(localLedger);
    const remote = Store.normalizeLedger(remoteLedger);
    Object.keys(remote).forEach(function (id) { result[id] = remote[id]; });
    Object.keys(local).forEach(function (id) {
      const localEntry = local[id];
      const remoteEntry = result[id];
      if (!remoteEntry || parseStamp(localEntry.updatedAt) >= parseStamp(remoteEntry.updatedAt)) {
        result[id] = localEntry;
      }
    });
    return Store.normalizeLedger(result);
  }

  function mergeMember(existing, snapshot, options) {
    const opts = options || {};
    const name = existing ? existing.name : normalizeMemberName(snapshot.memberName);
    const key = memberKeyForName(name);
    if (!key) throw new CloudError("成员称呼无效", "invalid_member");

    let settings;
    let settingsUpdatedAt;
    if (!existing) {
      settings = Store.normalizeSettings(snapshot.settings);
      settingsUpdatedAt = snapshot.settingsUpdatedAt || nowIso();
    } else if (opts.mergeSettings) {
      const localStamp = parseStamp(snapshot.settingsUpdatedAt);
      const remoteStamp = parseStamp(existing.settingsUpdatedAt);
      if (localStamp > remoteStamp) {
        settings = Store.normalizeSettings(snapshot.settings);
        settingsUpdatedAt = new Date(localStamp).toISOString();
      } else {
        settings = existing.settings;
        settingsUpdatedAt = existing.settingsUpdatedAt;
      }
    } else {
      settings = existing.settings;
      settingsUpdatedAt = existing.settingsUpdatedAt;
    }

    const recordData = mergeRecordSets(
      Store.normalizeRecords(snapshot.records),
      Store.normalizeDeletedRecords(snapshot.deletedRecords),
      existing ? existing.records : {},
      existing ? existing.deletedRecords : {}
    );

    const restData = mergeRestDays(
      snapshot.restDays,
      snapshot.restDayUpdated,
      existing ? existing.restDays : {},
      existing ? existing.restDayUpdated : {}
    );
    const wishlist = mergeWishlist(
      snapshot.wishlist,
      existing ? existing.wishlist : null,
      !existing || Boolean(opts.mergeSettings)
    );
    const ledger = mergeLedger(snapshot.ledger, existing ? existing.ledger : {});

    return {
      id: key,
      name: existing ? existing.name : name,
      settings: settings,
      settingsUpdatedAt: settingsUpdatedAt,
      records: recordData.records,
      deletedRecords: recordData.deletedRecords,
      restDays: restData.restDays,
      restDayUpdated: restData.restDayUpdated,
      wishlist: wishlist,
      ledger: ledger,
      createdAt: existing ? existing.createdAt : nowIso(),
      updatedAt: existing ? existing.updatedAt : nowIso()
    };
  }

  function memberEquivalent(left, right) {
    if (!left || !right) return false;
    return JSON.stringify({
      name: left.name,
      settings: left.settings,
      settingsUpdatedAt: left.settingsUpdatedAt,
      records: left.records,
      deletedRecords: left.deletedRecords,
      restDays: left.restDays,
      restDayUpdated: left.restDayUpdated,
      wishlist: left.wishlist,
      ledger: left.ledger
    }) === JSON.stringify({
      name: right.name,
      settings: right.settings,
      settingsUpdatedAt: right.settingsUpdatedAt,
      records: right.records,
      deletedRecords: right.deletedRecords,
      restDays: right.restDays,
      restDayUpdated: right.restDayUpdated,
      wishlist: right.wishlist,
      ledger: right.ledger
    });
  }

  function normalizeMember(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = normalizeMemberName(raw.name);
    if (!name) return null;
    const key = memberKeyForName(name);
    const settings = Store.normalizeSettings(raw.settings);
    const settingsUpdatedAt = parseStamp(raw.settingsUpdatedAt) > 0
      ? new Date(raw.settingsUpdatedAt).toISOString()
      : parseStamp(raw.updatedAt) > 0
        ? new Date(raw.updatedAt).toISOString()
        : nowIso();
    return {
      id: key,
      name: name,
      settings: settings,
      settingsUpdatedAt: settingsUpdatedAt,
      records: Store.normalizeRecords(raw.records),
      deletedRecords: Store.normalizeDeletedRecords(raw.deletedRecords),
      restDays: Store.normalizeRestDays(raw.restDays),
      restDayUpdated: Store.normalizeRestDayUpdated(raw.restDayUpdated),
      wishlist: Store.normalizeWishlist(raw.wishlist),
      ledger: Store.normalizeLedger(raw.ledger),
      createdAt: parseStamp(raw.createdAt) > 0 ? new Date(raw.createdAt).toISOString() : nowIso(),
      updatedAt: parseStamp(raw.updatedAt) > 0 ? new Date(raw.updatedAt).toISOString() : nowIso()
    };
  }

  function normalizeCloudData(raw) {
    if (!raw || typeof raw !== "object" || !raw.members || typeof raw.members !== "object") {
      throw new CloudError("共享工资簿的数据格式异常", "invalid_data");
    }
    const members = {};
    Object.keys(raw.members).slice(0, MAX_MEMBERS).forEach(function (key) {
      const member = normalizeMember(raw.members[key]);
      if (!member) return;
      if (members[member.id]) {
        const existing = members[member.id];
        const newer = parseStamp(member.updatedAt) >= parseStamp(existing.updatedAt) ? member : existing;
        const older = newer === member ? existing : member;
        members[member.id] = {
          id: newer.id,
          name: newer.name,
          settings: newer.settings,
          settingsUpdatedAt: newer.settingsUpdatedAt,
          records: mergeRecordSets(older.records, older.deletedRecords, newer.records, newer.deletedRecords).records,
          deletedRecords: mergeRecordSets(older.records, older.deletedRecords, newer.records, newer.deletedRecords).deletedRecords,
          restDays: mergeRestDays(newer.restDays, newer.restDayUpdated, older.restDays, older.restDayUpdated).restDays,
          restDayUpdated: mergeRestDays(newer.restDays, newer.restDayUpdated, older.restDays, older.restDayUpdated).restDayUpdated,
          wishlist: mergeWishlist(newer.wishlist, older.wishlist, true),
          ledger: mergeLedger(newer.ledger, older.ledger),
          createdAt: older.createdAt,
          updatedAt: newer.updatedAt
        };
      } else {
        members[member.id] = member;
      }
    });
    return {
      version: CLOUD_VERSION,
      revision: Math.max(1, Number(raw.revision) || 1),
      updatedAt: parseStamp(raw.updatedAt) > 0 ? new Date(raw.updatedAt).toISOString() : nowIso(),
      members: members
    };
  }

  function createMemberSnapshot(snapshot) {
    const settings = Store.normalizeSettings(snapshot.settings);
    return {
      id: memberKeyForName(snapshot.memberName),
      name: normalizeMemberName(snapshot.memberName),
      settings: settings,
      settingsUpdatedAt: parseStamp(snapshot.settingsUpdatedAt) > 0
        ? new Date(snapshot.settingsUpdatedAt).toISOString()
        : nowIso(),
      records: Store.normalizeRecords(snapshot.records),
      deletedRecords: Store.normalizeDeletedRecords(snapshot.deletedRecords),
      restDays: Store.normalizeRestDays(snapshot.restDays),
      restDayUpdated: Store.normalizeRestDayUpdated(snapshot.restDayUpdated),
      wishlist: Store.normalizeWishlist(snapshot.wishlist),
      ledger: Store.normalizeLedger(snapshot.ledger),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  function getMembers() {
    if (!state.data || !state.data.members) return [];
    return Object.keys(state.data.members)
      .map(function (key) { return state.data.members[key]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "zh-CN"); });
  }

  function getCurrentMember() {
    return state.data && state.data.members ? state.data.members[state.memberKey] || null : null;
  }

  function sanitizeSnapshot(snapshot) {
    const source = snapshot || {};
    return {
      memberName: normalizeMemberName(source.memberName),
      settings: Store.normalizeSettings(source.settings),
      settingsUpdatedAt: parseStamp(source.settingsUpdatedAt) > 0
        ? new Date(source.settingsUpdatedAt).toISOString()
        : nowIso(),
      records: Store.normalizeRecords(source.records),
      deletedRecords: Store.normalizeDeletedRecords(source.deletedRecords),
      restDays: Store.normalizeRestDays(source.restDays),
      restDayUpdated: Store.normalizeRestDayUpdated(source.restDayUpdated),
      wishlist: Store.normalizeWishlist(source.wishlist),
      ledger: Store.normalizeLedger(source.ledger)
    };
  }

  /* =========================================================
   * Status
   * ========================================================= */
  function statusLabel() {
    if (!state.connected) {
      if (state.mode === "connecting") return "连接中";
      if (state.mode === "locked") return "需解锁";
      if (state.mode === "offline") return "离线";
      return "共享";
    }
    if (state.mode === "offline") return "离线";
    if (state.syncing) return "同步中";
    if (state.dirty) return "待同步";
    return "已同步";
  }

  function getStatus() {
    return {
      connected: state.connected,
      mode: state.mode,
      label: statusLabel(),
      spaceId: state.spaceId,
      memberName: state.memberName,
      memberKey: state.memberKey,
      memberCount: state.data ? Object.keys(state.data.members || {}).length : 0,
      lastSyncedAt: state.lastSyncedAt,
      dirty: state.dirty,
      error: state.lastError,
      passphraseRequired: state.mode === "locked"
    };
  }

  function emitStatus() {
    if (state.adapter && typeof state.adapter.onStatus === "function") {
      try {
        state.adapter.onStatus(getStatus());
      } catch (error) {
        // UI 回调异常不应中断同步。
      }
    }
  }

  function setMode(mode, error) {
    state.mode = mode;
    if (error !== undefined) state.lastError = error || "";
    emitStatus();
  }

  function applyMember(member, source) {
    state.applying = true;
    try {
      if (state.adapter && typeof state.adapter.onData === "function") {
        state.adapter.onData({
          currentMember: member,
          members: getMembers(),
          source: source,
          revision: state.revision,
          lastSyncedAt: state.lastSyncedAt
        });
      }
    } finally {
      state.applying = false;
    }
  }

  /* =========================================================
   * Connection lifecycle
   * ========================================================= */
  async function unlockSpace(spaceId, passphrase) {
    ensureCrypto();
    const cleanSpace = normalizeSpaceId(spaceId);
    if (!SPACE_ID_PATTERN.test(cleanSpace)) {
      throw new CloudError("共享空间 ID 格式不正确，请从邀请链接复制", "invalid_space");
    }
    const cleanPassphrase = validatePassphrase(passphrase);

    const envelope = await fetchEnvelopeWithRetry(cleanSpace);
    if (!envelope) {
      throw new CloudError("没有找到这个共享空间，请确认空间 ID 或先创建空间", "space_not_found");
    }

    const key = await deriveKey(
      cleanPassphrase,
      base64ToBytes(envelope.kdf.salt),
      envelope.kdf.iterations
    );
    const payload = await decryptPayload(envelope, key);
    const data = normalizeCloudData(payload);
    return {
      spaceId: cleanSpace,
      passphrase: cleanPassphrase,
      key: key,
      meta: { salt: envelope.kdf.salt, iterations: envelope.kdf.iterations },
      data: data
    };
  }

  async function writeData(data) {
    const envelope = await encryptPayload(state.cryptoKey, data, state.envelopeMeta);
    await putEnvelopeWithRetry(state.spaceId, envelope);
  }

  async function autoConnect() {
    const config = readConfig();
    if (!config || !config.passphrase || !config.memberKey) {
      state.mode = "local";
      emitStatus();
      return { ok: false, code: "no_config" };
    }

    state.spaceId = config.spaceId;
    state.memberKey = config.memberKey;
    state.memberName = config.memberName;
    setMode("connecting");

    try {
      const unlocked = await unlockSpace(config.spaceId, config.passphrase);
      const member = unlocked.data.members[config.memberKey];
      if (!member) {
        throw new CloudError("共享空间里已经没有这个成员，请重新加入", "member_missing");
      }

      state.cryptoKey = unlocked.key;
      state.envelopeMeta = unlocked.meta;
      state.passphrase = unlocked.passphrase;
      state.data = unlocked.data;
      state.revision = unlocked.data.revision;
      state.connected = true;

      const snapshot = sanitizeSnapshot(state.adapter.getSnapshot());
      const merged = mergeMember(member, snapshot, { mergeSettings: true, mergeRecords: true });
      const changed = !memberEquivalent(member, merged);
      if (changed) {
        merged.updatedAt = nowIso();
        state.data.members[state.memberKey] = merged;
        state.data.revision = (Number(state.data.revision) || 0) + 1;
        state.data.updatedAt = nowIso();
        state.revision = state.data.revision;
        await writeData(state.data);
      }

      state.memberName = merged.name;
      saveConfig();
      startPolling();
      setMode("online");
      applyMember(merged, "initial");
      state.lastSyncedAt = Date.now();
      emitStatus();
      return { ok: true, memberName: merged.name, spaceId: state.spaceId };
    } catch (error) {
      state.connected = false;
      state.cryptoKey = null;
      state.envelopeMeta = null;
      state.lastError = error.message || "连接失败";
      if (error.code === "decrypt_failed") {
        setMode("locked", error.message);
      } else if (error.code === "space_not_found" || error.code === "member_missing" || error.code === "invalid_space") {
        setMode("locked", error.message);
      } else {
        setMode("offline", error.message);
      }
      return { ok: false, code: error.code || "cloud_error", error: error.message || "连接失败" };
    }
  }

  async function createSpace(input) {
    ensureCrypto();
    const email = String(input.email || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new CloudError("请填写有效邮箱，用于在 KVdb 创建共享空间", "invalid_email");
    }
    const passphrase = validatePassphrase(input.passphrase);
    const memberName = validateMemberName(input.memberName);
    const snapshot = sanitizeSnapshot(Object.assign({}, state.adapter.getSnapshot(), { memberName: memberName }));

    setMode("connecting");
    try {
      const spaceId = await createKvdbBucket(email);
      const salt = global.crypto.getRandomValues(new Uint8Array(16));
      const meta = { salt: bytesToBase64(salt), iterations: PBKDF2_ITERATIONS };
      const key = await deriveKey(passphrase, salt, meta.iterations);
      const data = emptyCloudData();
      const member = mergeMember(null, snapshot, { mergeSettings: true, mergeRecords: true });
      member.name = memberName;
      member.id = memberKeyForName(memberName);
      data.members[member.id] = member;

      state.spaceId = spaceId;
      state.passphrase = passphrase;
      state.cryptoKey = key;
      state.envelopeMeta = meta;
      state.data = data;
      state.revision = data.revision;
      state.memberKey = member.id;
      state.memberName = member.name;
      state.connected = true;
      state.dirty = false;
      state.lastSyncedAt = Date.now();

      await writeData(data);
      saveConfig();
      setUrlSpaceId(spaceId);
      startPolling();
      applyMember(member, "create");
      setMode("online");
      return { ok: true, spaceId: spaceId, memberName: member.name };
    } catch (error) {
      state.connected = false;
      state.lastError = error.message || "创建空间失败";
      setMode("offline", state.lastError);
      throw error;
    }
  }

  async function joinSpace(input) {
    const spaceId = normalizeSpaceId(input.spaceId);
    const passphrase = validatePassphrase(input.passphrase);
    const memberName = validateMemberName(input.memberName);
    if (!SPACE_ID_PATTERN.test(spaceId)) {
      throw new CloudError("共享空间 ID 格式不正确，请从邀请链接复制", "invalid_space");
    }

    setMode("connecting");
    try {
      const unlocked = await unlockSpace(spaceId, passphrase);
      const snapshot = sanitizeSnapshot(Object.assign({}, state.adapter.getSnapshot(), { memberName: memberName }));
      const key = memberKeyForName(memberName);
      const existing = unlocked.data.members[key];
      const merged = mergeMember(existing, snapshot, {
        mergeSettings: !existing,
        mergeRecords: true
      });
      merged.name = existing ? existing.name : memberName;
      merged.id = key;
      const changed = !existing || !memberEquivalent(existing, merged);
      if (changed) {
        merged.updatedAt = nowIso();
        unlocked.data.members[key] = merged;
        unlocked.data.revision = (Number(unlocked.data.revision) || 0) + 1;
        unlocked.data.updatedAt = nowIso();
      }

      state.spaceId = spaceId;
      state.passphrase = passphrase;
      state.cryptoKey = unlocked.key;
      state.envelopeMeta = unlocked.meta;
      state.data = unlocked.data;
      state.revision = unlocked.data.revision;
      state.memberKey = key;
      state.memberName = merged.name;
      state.connected = true;
      state.dirty = false;
      state.lastSyncedAt = Date.now();

      if (changed) await writeData(unlocked.data);
      saveConfig();
      setUrlSpaceId(spaceId);
      startPolling();
      applyMember(merged, "join");
      setMode("online");
      return {
        ok: true,
        spaceId: spaceId,
        memberName: merged.name,
        created: !existing,
        memberCount: getMembers().length
      };
    } catch (error) {
      state.connected = false;
      state.lastError = error.message || "加入空间失败";
      setMode("offline", state.lastError);
      throw error;
    }
  }

  function disconnect(options) {
    const opts = options || {};
    state.connected = false;
    state.mode = "local";
    state.cryptoKey = null;
    state.envelopeMeta = null;
    state.data = null;
    state.revision = 0;
    state.dirty = false;
    state.syncing = false;
    state.flushing = false;
    state.spaceId = "";
    state.memberKey = "";
    state.memberName = "";
    state.passphrase = "";
    state.lastSyncedAt = 0;
    state.lastError = "";
    state.localMutation += 1;
    global.clearTimeout(state.pushTimer);
    state.pushTimer = 0;
    stopPolling();
    clearConfig();
    setUrlSpaceId("");
    emitStatus();
    if (opts.toast) {
      // UI 负责提示；模块不直接操作页面。
    }
  }

  /* =========================================================
   * Push / polling
   * ========================================================= */
  function schedulePush(delayMs) {
    global.clearTimeout(state.pushTimer);
    state.pushTimer = global.setTimeout(function () {
      state.pushTimer = 0;
      pushNow().catch(function () {});
    }, typeof delayMs === "number" ? delayMs : PUSH_DELAY_MS);
  }

  function isOffline() {
    return Boolean(global.navigator && global.navigator.onLine === false);
  }

  function markDirty(options) {
    if (!state.connected || !state.cryptoKey) return;
    state.localMutation += 1;
    const wasDirty = state.dirty;
    state.dirty = true;
    if (isOffline()) {
      if (!wasDirty || state.mode !== "offline") setMode("offline");
      return;
    }
    if (!wasDirty) emitStatus();
    if (!state.pushTimer) {
      schedulePush(options && options.immediate ? 0 : PUSH_DELAY_MS);
    }
  }

  async function pushNow(options) {
    if (!state.connected || !state.cryptoKey || state.flushing) {
      return { ok: false, code: "not_connected" };
    }
    if (isOffline()) {
      state.dirty = true;
      setMode("offline");
      return { ok: false, code: "offline", error: "当前离线，无法同步共享工资簿" };
    }
    const mutationAtStart = state.localMutation;
    state.flushing = true;
    state.syncing = true;
    setMode("online");
    emitStatus();

    try {
      const envelope = await fetchEnvelopeWithRetry(state.spaceId);
      if (!envelope) throw new CloudError("共享空间里的数据不存在", "space_not_found");
      const latest = normalizeCloudData(await decryptPayload(envelope, state.cryptoKey));

      const snapshot = sanitizeSnapshot(state.adapter.getSnapshot());
      const existing = latest.members[state.memberKey];
      const merged = mergeMember(existing, snapshot, { mergeSettings: true, mergeRecords: true });
      merged.name = existing ? existing.name : state.memberName;
      merged.id = state.memberKey;
      const changed = !existing || !memberEquivalent(existing, merged);

      if (changed) {
        merged.updatedAt = nowIso();
        latest.members[state.memberKey] = merged;
        latest.revision = (Number(latest.revision) || 0) + 1;
        latest.updatedAt = nowIso();
        await writeData(latest);
      }

      state.data = latest;
      state.revision = latest.revision;
      state.lastSyncedAt = Date.now();
      state.lastError = "";
      const newerLocalChange = state.localMutation !== mutationAtStart;
      state.dirty = newerLocalChange;
      state.syncing = false;
      state.flushing = false;
      setMode("online");

      if (!newerLocalChange) {
        applyMember(merged, "push");
      }
      if (state.dirty) schedulePush(PUSH_DELAY_MS);
      emitStatus();
      return { ok: true, changed: changed, dirty: state.dirty };
    } catch (error) {
      state.lastError = error.message || "同步失败";
      state.dirty = true;
      state.syncing = false;
      state.flushing = false;
      if (error.code === "decrypt_failed" || error.code === "invalid_data" || error.code === "space_not_found") {
        setMode("locked", state.lastError);
      } else {
        setMode("offline", state.lastError);
      }
      return { ok: false, code: error.code || "cloud_error", error: state.lastError };
    }
  }

  async function pullNow(options) {
    if (!state.connected || !state.cryptoKey) {
      return { ok: false, code: "not_connected" };
    }
    if (isOffline()) {
      setMode("offline");
      return { ok: false, code: "offline", error: "当前离线，无法同步共享工资簿" };
    }
    if (state.dirty) {
      return pushNow(options);
    }
    if (state.syncing) return { ok: false, code: "busy" };

    state.syncing = true;
    setMode("online");
    emitStatus();
    try {
      const envelope = await fetchEnvelopeWithRetry(state.spaceId);
      if (!envelope) throw new CloudError("共享空间里的数据不存在", "space_not_found");
      const latest = normalizeCloudData(await decryptPayload(envelope, state.cryptoKey));
      const member = latest.members[state.memberKey];
      if (!member) throw new CloudError("共享空间里已经没有这个成员", "member_missing");

      const revisionChanged = latest.revision !== state.revision;
      state.data = latest;
      state.revision = latest.revision;
      state.lastSyncedAt = Date.now();
      state.lastError = "";
      state.syncing = false;
      state.dirty = false;
      setMode("online");
      if (revisionChanged) {
        applyMember(member, "poll");
      }
      emitStatus();
      return { ok: true, changed: revisionChanged, members: getMembers().length };
    } catch (error) {
      state.syncing = false;
      state.lastError = error.message || "同步失败";
      if (error.code === "decrypt_failed" || error.code === "invalid_data" || error.code === "space_not_found" || error.code === "member_missing") {
        setMode("locked", state.lastError);
      } else {
        setMode("offline", state.lastError);
      }
      return { ok: false, code: error.code || "cloud_error", error: state.lastError };
    }
  }

  async function syncNow(options) {
    if (!state.connected || !state.cryptoKey) {
      return { ok: false, code: "not_connected" };
    }
    if (state.flushing || state.syncing) {
      return { ok: false, code: "busy", error: "正在同步，请稍候" };
    }
    return state.dirty ? pushNow(options) : pullNow(options);
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = global.setInterval(function () {
      if (!state.connected || document.visibilityState === "hidden") return;
      if (state.dirty) pushNow().catch(function () {});
      else pullNow().catch(function () {});
    }, SYNC_INTERVAL_MS);
  }

  function stopPolling() {
    global.clearInterval(state.pollTimer);
    state.pollTimer = 0;
  }

  function init(adapter) {
    state.adapter = adapter || {};
    if (state.initialized) return;
    state.initialized = true;

    global.addEventListener("online", function () {
      if (!state.connected) {
        const config = readConfig();
        if (config && config.passphrase) {
          autoConnect().catch(function () {});
        }
        return;
      }
      if (state.dirty) pushNow().catch(function () {});
      else pullNow().catch(function () {});
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible" || !state.connected) return;
      if (state.dirty) pushNow().catch(function () {});
      else pullNow().catch(function () {});
    });

    emitStatus();
  }

  function getSavedConfig() {
    return readConfig();
  }

  function hasSavedConfig() {
    return Boolean(readConfig());
  }

  function isConnected() {
    return state.connected;
  }

  function isApplying() {
    return state.applying;
  }

  function isDirty() {
    return state.dirty;
  }

  function getSpaceId() {
    return state.spaceId;
  }

  function getMemberName() {
    return state.memberName;
  }

  function getMemberKey() {
    return state.memberKey;
  }

  global.CloudSync = {
    init: init,
    autoConnect: autoConnect,
    createSpace: createSpace,
    joinSpace: joinSpace,
    disconnect: disconnect,
    syncNow: syncNow,
    pushNow: pushNow,
    markDirty: markDirty,
    schedulePush: schedulePush,
    getStatus: getStatus,
    getMembers: getMembers,
    getCurrentMember: getCurrentMember,
    getShareUrl: getShareUrl,
    getSavedConfig: getSavedConfig,
    hasSavedConfig: hasSavedConfig,
    getUrlSpaceId: getUrlSpaceId,
    setUrlSpaceId: setUrlSpaceId,
    normalizeSpaceId: normalizeSpaceId,
    normalizeMemberName: normalizeMemberName,
    memberKeyForName: memberKeyForName,
    isConnected: isConnected,
    isApplying: isApplying,
    isDirty: isDirty,
    getSpaceId: getSpaceId,
    getMemberName: getMemberName,
    getMemberKey: getMemberKey,
    MIN_PASSPHRASE_LENGTH: MIN_PASSPHRASE_LENGTH,
    MAX_MEMBER_NAME: MAX_MEMBER_NAME,
    CloudError: CloudError
  };
})(typeof window !== "undefined" ? window : globalThis);
