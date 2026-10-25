/**
 * Kidcastle 薪資系統 — 後端 Code.gs（多公司版，新帳號 biggoalaidan@gmail.com）
 * ---------------------------------------------------------------
 * 搭配 Receipt.gs 使用。每家公司的資料分開存放；公司清單與權限設定存在 KidcastleSalary_Companies.json。
 *   GET  ?action=ping | read | log | changelog | receipt | list_companies | get_company   （可加 &company=代號）
 *   POST action = write | write_log | append_log | backup
 *                 send_payslip | send_test_mail | send_name_request | receipt_list        （body 帶 company）
 *                 verify_admin | admin_list_companies | add_company | update_company     （需 ADMIN_KEY）
 *
 * 安裝方式：
 *   1. Code.gs 整份貼上本檔；另一個指令碼檔「Receipt」貼上 Receipt.gs
 *   2. 修改下面的 MAIL_KEY（寄信密碼）與 ADMIN_KEY（首頁「管理者模式」密碼），兩個都請設長一點、不要相同
 *   3. 部署 → 管理部署作業 → 鉛筆 → 版本選「新版本」→ 部署（網址不變），第一次會要求授權
 *   4. 開啟「網址?action=list_companies」確認有回傳
 *
 * 資料位置（執行此指令碼的帳號的雲端硬碟根目錄）：
 *   預設公司（代號 default）：KidcastleSalary_Data.json、KidcastleSalary_Log.json、Kidcastle_Backups/
 *   其他公司（代號 abc）    ：KidcastleSalary_Data_abc.json、KidcastleSalary_Log_abc.json、Kidcastle_Backups_abc/
 *   公司清單與權限          ：KidcastleSalary_Companies.json
 *   回條紀錄                ：KidcastleSalary_Receipts.json（Receipt.gs）
 */

// ===================== 設定（請在這裡修改） =====================
const MAIL_KEY       = '請改成你自己的寄信密碼';
const ADMIN_KEY      = '請改成你自己的首頁管理密碼';
const MAIL_SENDER    = 'biggoalaidan@gmail.com';
const MAIL_FROM_NAME = 'Kidcastle 薪水條系統';

const DATA_FILE      = 'KidcastleSalary_Data.json';      // 預設公司（default）的資料檔
const LOG_FILE       = 'KidcastleSalary_Log.json';
const BACKUP_FOLDER  = 'Kidcastle_Backups';
const COMPANY_FILE   = 'KidcastleSalary_Companies.json';
const LOG_MAX        = 500;
const BACKUP_MAX_B64 = 28 * 1024 * 1024;

const BACKEND_VERSION = 'V20261024V1500';
const BACKEND_CHANGELOG = [
  { version: 'V20261024V1500', date: '2026-10-24 15:00',
    changes: ['多公司：公司清單、新增公司、各公司資料分開存放、角色分頁權限設定'] },
  { version: 'V20261024V1400', date: '2026-10-24 14:00',
    changes: ['新帳號 biggoalaidan@gmail.com 版後端：重新撰寫 Code.gs'] }
];

// 可設定權限的分頁（與 Salary_System.html 的分頁對應）
const PERM_TABS = ['overview', 'manager', 'owner', 'payslip', 'accounts'];
const DEFAULT_PERMS = {
  owner:    ['overview', 'manager', 'owner', 'payslip', 'accounts'],
  manager:  ['overview', 'manager'],
  employee: ['payslip']
};

// ===================== 入口 =====================
function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    const action = String(p.action || 'ping');
    if (action === 'receipt')        return receiptPage_(p);
    if (action === 'ping')           return ok({ time: new Date().toISOString(), version: BACKEND_VERSION });
    if (action === 'changelog')      return ok({ version: BACKEND_VERSION, changelog: BACKEND_CHANGELOG });
    if (action === 'list_companies') return ok({ companies: listPublicCompanies_() });
    if (action === 'get_company')    return ok({ company: getCompanyPublic_(cid_(p.company)) });

    const cid = cid_(p.company);
    requireCompany_(cid);
    if (action === 'read') return ok({ data: readJson(dataFileOf_(cid)) || {}, ts: new Date().toISOString() });
    if (action === 'log')  return ok({ log: readJson(logFileOf_(cid)) || [] });
    return fail('未知 action: ' + action);
  } catch (err) {
    return fail(err && err.message ? err.message : String(err));
  }
}

function doPost(e) {
  try {
    let body = {};
    try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
    catch (x) { return fail('請求內容不是有效的 JSON'); }
    const action = String(body.action || '');

    // 首頁管理（需 ADMIN_KEY）
    if (action === 'verify_admin')         { checkAdmin_(body); return ok({}); }
    if (action === 'admin_list_companies') { checkAdmin_(body); return ok({ companies: listAdminCompanies_() }); }
    if (action === 'add_company')          { checkAdmin_(body); return ok(addCompany_(body)); }
    if (action === 'update_company')       { checkAdmin_(body); return ok(updateCompany_(body)); }

    // 各公司資料
    const cid = cid_(body.company);
    requireCompany_(cid);
    body.company = cid;
    if (action === 'write')             return ok(writeData_(body, cid));
    if (action === 'write_log')         return ok(writeLog_(body, cid));
    if (action === 'append_log')        return ok(appendLog_(body, cid));
    if (action === 'backup')            return ok(saveBackup_(body, cid));
    if (action === 'send_payslip')      return ok(sendPayslip_(body, cid));
    if (action === 'send_test_mail')    return ok(sendTestMailWithReceipt_(body));
    if (action === 'send_name_request') return ok(sendNameRequestMail_(body));
    if (action === 'receipt_list')      return ok(listReceipts_(body));
    return fail('未知 action: ' + action);
  } catch (err) {
    return fail(err && err.message ? err.message : String(err));
  }
}

// ===================== 回應工具（Receipt.gs 也會使用 ok） =====================
function ok(obj) {
  const out = Object.assign({ ok: true }, obj || {});
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}
function fail(msg) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(msg) }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===================== 雲端硬碟讀寫（Receipt.gs 也會使用 readJson） =====================
function readJson(name) {
  const it = DriveApp.getFilesByName(name);
  if (!it.hasNext()) return null;
  const txt = it.next().getBlob().getDataAsString('UTF-8');
  if (!txt) return null;
  try { return JSON.parse(txt); } catch (e) { return null; }
}
function writeJson_(name, obj) {
  const txt = JSON.stringify(obj);
  const it = DriveApp.getFilesByName(name);
  if (it.hasNext()) it.next().setContent(txt);
  else DriveApp.createFile(name, txt, 'application/json');
}
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); }
  finally { try { lock.releaseLock(); } catch (_) {} }
}

// ===================== 公司 =====================
// 公司代號：小寫英數、底線、連字號（1~30 字）；未提供視為 default
function cid_(x) {
  const s = String(x == null || x === '' ? 'default' : x).toLowerCase();
  if (!/^[a-z0-9_-]{1,30}$/.test(s)) throw new Error('公司代號格式錯誤');
  return s;
}
function dataFileOf_(cid)     { return cid === 'default' ? DATA_FILE : 'KidcastleSalary_Data_' + cid + '.json'; }
function logFileOf_(cid)      { return cid === 'default' ? LOG_FILE  : 'KidcastleSalary_Log_' + cid + '.json'; }
function backupFolderOf_(cid) { return cid === 'default' ? BACKUP_FOLDER : BACKUP_FOLDER + '_' + cid; }

function loadCompanies_() {
  const j = readJson(COMPANY_FILE);
  return (j && Array.isArray(j.companies)) ? j.companies : [];
}
function saveCompanies_(arr) { writeJson_(COMPANY_FILE, { companies: arr }); }

function defaultCompany_() {
  return { id: 'default', name: 'Kidcastle', icon: '🏰', color: '#667eea', archived: false,
           bossInitHash: '', permissions: JSON.parse(JSON.stringify(DEFAULT_PERMS)) };
}
function getCompany_(cid) {
  const found = loadCompanies_().filter(function (c) { return c.id === cid; })[0];
  if (found) return Object.assign({}, found, { permissions: sanitizePerms_(found.permissions) });
  return cid === 'default' ? defaultCompany_() : null;
}
function requireCompany_(cid) {
  const c = getCompany_(cid);
  if (!c) throw new Error('找不到公司：' + cid);
  if (c.archived) throw new Error('這家公司已停用：' + c.name);
  return c;
}
// 各頁面讀取用（不含管理資訊）
function getCompanyPublic_(cid) {
  const c = getCompany_(cid);
  if (!c) throw new Error('找不到公司：' + cid);
  return { id: c.id, name: c.name, icon: c.icon, color: c.color, archived: !!c.archived,
           permissions: c.permissions, bossInitHash: c.bossInitHash || '' };
}
function listPublicCompanies_() {
  const all = loadCompanies_();
  const out = [];
  if (!all.some(function (c) { return c.id === 'default'; })) out.push(defaultCompany_());
  all.forEach(function (c) { out.push(c); });
  return out.filter(function (c) { return !c.archived; })
            .map(function (c) { return { id: c.id, name: c.name, icon: c.icon, color: c.color }; });
}
function listAdminCompanies_() {
  const all = loadCompanies_();
  const out = [];
  if (!all.some(function (c) { return c.id === 'default'; })) out.push(defaultCompany_());
  all.forEach(function (c) { out.push(c); });
  return out.map(function (c) {
    return { id: c.id, name: c.name, icon: c.icon, color: c.color, archived: !!c.archived,
             hasBossInit: !!c.bossInitHash, permissions: sanitizePerms_(c.permissions) };
  });
}

// 權限整理：員工固定只能看薪水條；老闆一定要有「老闆輸入」「帳號管理」；主管不能看這兩個
function sanitizePerms_(p) {
  p = p || {};
  function clean(list, fallback) {
    const arr = Array.isArray(list) ? list : fallback;
    return PERM_TABS.filter(function (t) { return arr.indexOf(t) >= 0; });
  }
  const owner = clean(p.owner, DEFAULT_PERMS.owner);
  ['owner', 'accounts'].forEach(function (t) { if (owner.indexOf(t) < 0) owner.push(t); });
  const manager = clean(p.manager, DEFAULT_PERMS.manager).filter(function (t) { return t !== 'owner' && t !== 'accounts'; });
  return {
    owner:    PERM_TABS.filter(function (t) { return owner.indexOf(t) >= 0; }),
    manager:  manager,
    employee: ['payslip']
  };
}

function checkAdmin_(body) {
  if (!ADMIN_KEY || ADMIN_KEY === '請改成你自己的首頁管理密碼') throw new Error('Apps Script 尚未設定 ADMIN_KEY（首頁管理密碼）');
  if (String(body.adminKey || '') !== ADMIN_KEY) throw new Error('管理密碼錯誤');
}
function cleanName_(s) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, 40); }
function cleanIcon_(s) { s = String(s || '').trim(); return s ? Array.from(s).slice(0, 4).join('') : '🏢'; }
function cleanColor_(s) { return /^#[0-9a-fA-F]{6}$/.test(String(s || '')) ? String(s) : '#667eea'; }

// Body: { adminKey, name, id?, icon?, color?, bossInitHash, permissions? }
function addCompany_(body) {
  const name = cleanName_(body.name);
  if (!name) throw new Error('請輸入公司名稱');
  if (!/^[0-9a-f]{64}$/.test(String(body.bossInitHash || ''))) throw new Error('缺少 Boss 初始密碼');
  return withLock_(function () {
    const arr = loadCompanies_();
    let id = String(body.id || '').trim().toLowerCase();
    if (!id) { do { id = 'c' + Math.random().toString(36).slice(2, 8); } while (arr.some(function (c) { return c.id === id; })); }
    if (!/^[a-z0-9_-]{2,30}$/.test(id)) throw new Error('公司代號只能用小寫英文、數字、底線、連字號（2~30 字）');
    if (id === 'default' || arr.some(function (c) { return c.id === id; })) throw new Error('公司代號已存在：' + id);
    const c = { id: id, name: name, icon: cleanIcon_(body.icon), color: cleanColor_(body.color), archived: false,
                bossInitHash: String(body.bossInitHash), permissions: sanitizePerms_(body.permissions),
                created: new Date().toISOString() };
    arr.push(c);
    saveCompanies_(arr);
    return { id: id };
  });
}

// Body: { adminKey, id, name?, icon?, color?, archived?, permissions?, bossInitHash?, resetBoss? }
function updateCompany_(body) {
  const id = cid_(body.id);
  return withLock_(function () {
    const arr = loadCompanies_();
    let c = arr.filter(function (x) { return x.id === id; })[0];
    if (!c) {
      if (id !== 'default') throw new Error('找不到公司：' + id);
      c = defaultCompany_(); arr.unshift(c);
    }
    if (body.name !== undefined) { const n = cleanName_(body.name); if (!n) throw new Error('公司名稱不可空白'); c.name = n; }
    if (body.icon !== undefined)  c.icon = cleanIcon_(body.icon);
    if (body.color !== undefined) c.color = cleanColor_(body.color);
    if (body.archived !== undefined && id !== 'default') c.archived = !!body.archived;
    if (body.permissions !== undefined) c.permissions = sanitizePerms_(body.permissions);
    if (body.bossInitHash !== undefined && body.bossInitHash !== '') {
      if (!/^[0-9a-f]{64}$/.test(String(body.bossInitHash))) throw new Error('Boss 初始密碼格式錯誤');
      c.bossInitHash = String(body.bossInitHash);
    }
    if (body.resetBoss) {
      // 移除該公司資料裡 boss 的新密碼紀錄 → boss 回到「初始密碼」並強制重新設定
      const df = dataFileOf_(id);
      const data = readJson(df);
      if (data && data.accountAuth) {
        ['1', '2', '3'].forEach(function (s) { delete data.accountAuth[s + ':boss']; });
        writeJson_(df, data);
      }
    }
    saveCompanies_(arr);
    return { id: id };
  });
}

// ===================== 資料 / 記錄（依公司） =====================
function writeData_(body, cid) {
  const d = body.data;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('data 格式錯誤');
  return withLock_(function () {
    writeJson_(dataFileOf_(cid), d);
    return { ts: new Date().toISOString() };
  });
}
function writeLog_(body, cid) {
  const log = Array.isArray(body.log) ? body.log.slice(0, LOG_MAX) : [];
  return withLock_(function () { writeJson_(logFileOf_(cid), log); return { count: log.length }; });
}
function appendLog_(body, cid) {
  if (!body.entry || typeof body.entry !== 'object') throw new Error('entry 格式錯誤');
  return withLock_(function () {
    const log = readJson(logFileOf_(cid));
    const arr = Array.isArray(log) ? log : [];
    arr.unshift(body.entry);
    if (arr.length > LOG_MAX) arr.length = LOG_MAX;
    writeJson_(logFileOf_(cid), arr);
    return { count: arr.length };
  });
}
function saveBackup_(body, cid) {
  const b64 = String(body.contentBase64 || '');
  if (!b64) throw new Error('備份內容是空的');
  if (b64.length > BACKUP_MAX_B64) throw new Error('備份檔太大');
  const filename = String(body.filename || ('backup_' + Date.now() + '.json')).replace(/[\\\/:*?"<>|]/g, '_').slice(0, 120);
  const mime = String(body.mime || 'application/json');
  const fname = backupFolderOf_(cid);
  const it = DriveApp.getFoldersByName(fname);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(fname);
  const f = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, filename));
  return { name: f.getName(), id: f.getId(), size: f.getSize() };
}

// ===================== 寄薪資條 =====================
function sendPayslip_(body, cid) {
  if (!MAIL_KEY || MAIL_KEY === '請改成你自己的寄信密碼') throw new Error('Apps Script 尚未設定 MAIL_KEY（寄信密碼）');
  if (String(body.key || '') !== MAIL_KEY) throw new Error('寄信密碼錯誤 (key)');
  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('收件人 Email 格式錯誤：' + to);
  if (to.toLowerCase() !== MAIL_SENDER.toLowerCase()) {
    const data = readJson(dataFileOf_(cid)) || {};
    const found = (data.employees || []).some(function (e) { return String(e['Email'] || '').trim().toLowerCase() === to.toLowerCase(); });
    if (!found) throw new Error('收件人不在員工資料中：' + to);
  }
  const subject = String(body.subject || 'Kidcastle 薪資條').slice(0, 200);
  const html = String(body.html || '');
  if (!html) throw new Error('信件內容是空的');
  const plain = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const opts = receiptMailOptions_({ htmlBody: html });
  if (body.attachPdf) {
    const pdfName = String(body.pdfName || 'payslip.pdf').replace(/[\\\/:*?"<>|]/g, '_');
    opts.attachments = [Utilities.newBlob(html, 'text/html', 'payslip.html').getAs('application/pdf').setName(pdfName)];
  }
  GmailApp.sendEmail(to, subject, plain, opts);
  return { to: to, remaining: MailApp.getRemainingDailyQuota() };
}
