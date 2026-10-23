/**
 * Kidcastle 薪資系統 — 📬 測試信「確認收到，寄送回條」按鈕（V20261020V1200）
 * ---------------------------------------------------------------
 * 測試信裡多一個「✅ 確認收到，寄送回條」按鈕。員工按下後會開啟確認頁，
 * 再按一次「確認收到」就會記錄回條，並寄一封回條通知給寄件人（MAIL_SENDER）。
 * 老闆在「✉ 寄送薪資條」視窗按「📬 查詢回條」即可看到誰已回條。
 *
 * 本檔不含任何密碼，會使用 Code.gs 裡已有的：
 *   MAIL_KEY、MAIL_SENDER、MAIL_FROM_NAME、DATA_FILE、readJson、ok
 *
 * 安裝方式：
 *   1. Apps Script 專案 → 左側「檔案」旁的 ＋ → 指令碼 → 命名為 Receipt → 貼上本檔全部內容
 *   2. Code.gs 的 doGet() 裡，在 `const action = ...` 下一行加入：
 *        if (action === 'receipt') return receiptPage_(p);
 *   3. Code.gs 的 doPost() 裡，把原本 send_test_mail 那一行改成下面這行，並在下面再加 receipt_list：
 *        if (action === 'send_test_mail') return ok(sendTestMailWithReceipt_(body));
 *        if (action === 'receipt_list')   return ok(listReceipts_(body));
 *   3b.（V20261020V1200 新增）同一處再加一行，用於「批次匯入 Email」比對不到中文姓名時，寄信請對方提供完整中文姓名：
 *        if (action === 'send_name_request') return ok(sendNameRequestMail_(body));
 *   4. 部署 → 管理部署作業 → 鉛筆 → 版本選「新版本」→ 部署（網址不變）
 *
 * 回條紀錄存在雲端硬碟「KidcastleSalary_Receipts.json」。
 * 回條連結有簽章（指令碼屬性 RECEIPT_SECRET，第一次寄信時自動產生），無法偽造別人的回條。
 */

const RECEIPT_FILE         = 'KidcastleSalary_Receipts.json';
const RECEIPT_MAX          = 2000;     // 最多保留幾筆寄送紀錄（新的在前）
const RECEIPT_TZ           = 'Asia/Taipei';
const RECEIPT_NOTIFY_OWNER = true;     // 員工回條時，是否寄一封「回條通知」給 MAIL_SENDER
const RECEIPT_TEST_TEXT    = '這是Kidcastle林口校及國中部的薪水條系統寄送測試';

// ---------- 寄送測試信（附回條按鈕） ----------
// Body: { action:'send_test_mail', key, to, eid?, name? }
function sendTestMailWithReceipt_(body) {
  if (!MAIL_KEY || MAIL_KEY === '請改成你自己的寄信密碼') {
    throw new Error('Apps Script 尚未設定 MAIL_KEY（寄信密碼）');
  }
  if (String(body.key || '') !== MAIL_KEY) throw new Error('寄信密碼錯誤 (key)');

  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('收件人 Email 格式錯誤：' + to);

  // 只允許寄給員工資料裡登記的 Email，或寄件人自己
  const isSelf = to.toLowerCase() === MAIL_SENDER.toLowerCase();
  const data = readJson(DATA_FILE) || {};
  const emp = (data.employees || []).filter(function (e) {
    return String(e['Email'] || '').trim().toLowerCase() === to.toLowerCase();
  })[0];
  if (!emp && !isSelf) throw new Error('收件人不在員工資料中：' + to + '（請先在員工資料 ④ 填寫並儲存）');

  const eid  = emp ? String(emp['員工編號'] || '') : String(body.eid || '');
  const name = emp ? String(emp['員工姓名'] || '') : String(body.name || '寄件人（自己）');

  const id = Utilities.getUuid();
  const sentAt = new Date().toISOString();
  const sig = receiptWithLock_(function (arr) {
    arr.unshift({ id: id, kind: 'test', to: to, eid: eid, name: name, sentAt: sentAt, ackAt: '' });
    if (arr.length > RECEIPT_MAX) arr.length = RECEIPT_MAX;
    return receiptSig_(id, true);
  });

  const link = ScriptApp.getService().getUrl() + '?action=receipt&id=' + encodeURIComponent(id) + '&sig=' + encodeURIComponent(sig);
  const html =
    '<div style="font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a202c;">' +
      '<p style="font-size:15px;line-height:1.7;margin:0 0 12px;">' + receiptEsc_(RECEIPT_TEST_TEXT) + '</p>' +
      '<p style="font-size:13px;line-height:1.7;color:#475569;margin:0 0 18px;">' + receiptEsc_(name) +
        ' 您好，收到這封信後請按下方按鈕送出回條，讓學校確認您的 Email 可以正常收到薪資條。</p>' +
      '<table role="presentation" cellspacing="0" cellpadding="0"><tr>' +
        '<td style="border-radius:10px;background:#10B981;">' +
          '<a href="' + link + '" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;">✅ 確認收到，寄送回條</a>' +
        '</td></tr></table>' +
      '<p style="font-size:11px;color:#94a3b8;line-height:1.6;margin:18px 0 0;">若按鈕無法點選，請複製以下網址到瀏覽器開啟：<br>' +
        '<span style="word-break:break-all;">' + link + '</span></p>' +
    '</div>';
  const plain = RECEIPT_TEST_TEXT + '\n\n收到這封信後，請開啟以下網址送出回條：\n' + link;

  GmailApp.sendEmail(to, 'Kidcastle 薪水條系統 — 寄送測試', plain, receiptMailOptions_({ htmlBody: html }));
  return { to: to, receiptId: id, remaining: MailApp.getRemainingDailyQuota() };
}

// ---------- 寄信請對方提供完整中文姓名 ----------
// Body: { action:'send_name_request', key, to, given? }   given = 檔案中填寫的姓名（可空白）
// 用於「批次匯入 Email」比對不到員工姓名(中文)時；收件人不限員工資料（因為就是找不到），但需寄信密碼。
function sendNameRequestMail_(body) {
  if (!MAIL_KEY || MAIL_KEY === '請改成你自己的寄信密碼') {
    throw new Error('Apps Script 尚未設定 MAIL_KEY（寄信密碼）');
  }
  if (String(body.key || '') !== MAIL_KEY) throw new Error('寄信密碼錯誤 (key)');
  const to = String(body.to || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('收件人 Email 格式錯誤：' + to);
  const given = String(body.given || '').trim().slice(0, 40);

  const hello = given ? receiptEsc_(given) + ' 您好，' : '您好，';
  const ask = '學校薪水條系統在核對您的 Email 時，比對不到您的中文姓名。請直接回覆這封信，告知您的「完整中文姓名」（與身分證／勞健保相同的全名，不要只寫暱稱或英文名），以及任教的校區（同安／莊敬）。';
  const html =
    '<div style="font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;max-width:560px;margin:0 auto;padding:20px;color:#1a202c;">' +
      '<p style="font-size:15px;line-height:1.7;margin:0 0 12px;">' + hello + '</p>' +
      '<p style="font-size:14px;line-height:1.8;margin:0 0 12px;">' + receiptEsc_(ask) + '</p>' +
      '<p style="font-size:14px;line-height:1.8;margin:0 0 12px;">回覆範例：<br>完整中文姓名：王小明　校區：同安</p>' +
      '<p style="font-size:12px;color:#94a3b8;margin:18px 0 0;">Kidcastle 薪資系統（此信僅用於確認姓名，不含薪資資料）</p>' +
    '</div>';
  const plain = (given ? given + ' 您好，\n\n' : '您好，\n\n') + ask + '\n\n回覆範例：\n完整中文姓名：王小明　校區：同安\n';
  GmailApp.sendEmail(to, 'Kidcastle 薪水條系統 — 請提供您的完整中文姓名', plain, receiptMailOptions_({ htmlBody: html }));
  return { to: to, remaining: MailApp.getRemainingDailyQuota() };
}

// ---------- 員工按下按鈕後開啟的網頁 ----------
// GET ?action=receipt&id=..&sig=..          → 顯示「確認收到」按鈕（避免信箱的連結掃描誤觸）
// GET ?action=receipt&id=..&sig=..&confirm=1 → 記錄回條
function receiptPage_(p) {
  const id = String(p.id || ''), sig = String(p.sig || '');
  if (!id || !sig || receiptSig_(id, false) !== sig) {
    return receiptHtml_('⚠ 連結無效', '這個回條連結不正確，請直接使用信件裡的按鈕，或洽學校行政。', '');
  }
  if (String(p.confirm || '') !== '1') {
    const rec = receiptLoad_().filter(function (r) { return r.id === id; })[0];
    if (!rec) return receiptHtml_('⚠ 找不到紀錄', '這封信的寄送紀錄已不存在，請洽學校行政。', '');
    if (rec.ackAt) {
      return receiptHtml_('✅ 已送出回條', receiptEsc_(rec.name) + ' 您好，您已於 ' + receiptFmt_(rec.ackAt) + ' 送出回條，謝謝！', '');
    }
    const url = ScriptApp.getService().getUrl() + '?action=receipt&id=' + encodeURIComponent(id) +
                '&sig=' + encodeURIComponent(sig) + '&confirm=1';
    return receiptHtml_('📬 確認收到測試信', receiptEsc_(rec.name) + ' 您好，請按下方按鈕送出回條。',
      '<a href="' + url + '" target="_top" style="display:inline-block;margin-top:18px;padding:14px 28px;background:#10B981;color:#fff;font-weight:700;font-size:16px;text-decoration:none;border-radius:12px;">✅ 確認收到，寄送回條</a>');
  }

  let first = false;
  const rec = receiptWithLock_(function (arr) {
    const r = arr.filter(function (x) { return x.id === id; })[0];
    if (r && !r.ackAt) { r.ackAt = new Date().toISOString(); first = true; }
    return r;
  });
  if (!rec) return receiptHtml_('⚠ 找不到紀錄', '這封信的寄送紀錄已不存在，請洽學校行政。', '');

  if (first && RECEIPT_NOTIFY_OWNER) {
    try {
      GmailApp.sendEmail(MAIL_SENDER, '【回條】' + rec.name + ' 已確認收到測試信',
        rec.name + (rec.eid ? '（' + rec.eid + '）' : '') + ' 已於 ' + receiptFmt_(rec.ackAt) +
        ' 確認收到寄至 ' + rec.to + ' 的薪水條系統測試信。',
        receiptMailOptions_({}));
    } catch (e) { /* 通知寄不出去不影響回條紀錄 */ }
  }
  return receiptHtml_('✅ 回條已送出', '謝謝 ' + receiptEsc_(rec.name) + '！學校已收到您的回條（' +
    receiptFmt_(rec.ackAt) + '）。<br>您可以關閉此頁面。', '');
}

// ---------- 老闆查詢回條 ----------
// Body: { action:'receipt_list', key }
function listReceipts_(body) {
  if (String(body.key || '') !== MAIL_KEY) throw new Error('寄信密碼錯誤 (key)');
  return {
    receipts: receiptLoad_().map(function (r) {
      return { id: r.id, kind: r.kind, to: r.to, eid: r.eid, name: r.name, sentAt: r.sentAt, ackAt: r.ackAt || '' };
    })
  };
}

// ---------- helpers ----------
function receiptMailOptions_(opts) {
  opts.name = MAIL_FROM_NAME;
  opts.replyTo = MAIL_SENDER;
  // 若此 Apps Script 不是用 MAIL_SENDER 部署，改用 Gmail「別名寄件」
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (me && me !== MAIL_SENDER.toLowerCase()) {
    const aliases = GmailApp.getAliases().map(function (a) { return a.toLowerCase(); });
    if (aliases.indexOf(MAIL_SENDER.toLowerCase()) < 0) {
      throw new Error('此 Apps Script 由 ' + me + ' 執行，且未將 ' + MAIL_SENDER + ' 設為寄件別名');
    }
    opts.from = MAIL_SENDER;
  }
  return opts;
}

// create=true 時若尚無密鑰會自動產生（只在持有 lock 時呼叫）
function receiptSig_(id, create) {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('RECEIPT_SECRET');
  if (!secret) {
    if (!create) return '';
    secret = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('RECEIPT_SECRET', secret);
  }
  const raw = Utilities.computeHmacSha256Signature(String(id), secret);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '').slice(0, 24);
}

function receiptLoad_() {
  const it = DriveApp.getFilesByName(RECEIPT_FILE);
  if (!it.hasNext()) return [];
  try {
    const arr = JSON.parse(it.next().getBlob().getDataAsString() || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function receiptWithLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(8000);
  try {
    const arr = receiptLoad_();
    const result = fn(arr);
    const txt = JSON.stringify(arr);
    const it = DriveApp.getFilesByName(RECEIPT_FILE);
    if (it.hasNext()) it.next().setContent(txt);
    else DriveApp.createFile(RECEIPT_FILE, txt, 'application/json');
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function receiptFmt_(iso) {
  return iso ? Utilities.formatDate(new Date(iso), RECEIPT_TZ, 'yyyy-MM-dd HH:mm') : '';
}

function receiptEsc_(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function receiptHtml_(title, msg, extra) {
  const html =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;padding:0;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;' +
      'font-family:\'Microsoft JhengHei\',\'PingFang TC\',Arial,sans-serif;">' +
    '<div style="max-width:440px;margin:60px auto;padding:0 16px;">' +
      '<div style="background:#fff;border-radius:16px;padding:30px 24px;text-align:center;box-shadow:0 16px 40px rgba(0,0,0,.18);">' +
        '<div style="font-size:22px;font-weight:700;color:#1e293b;margin-bottom:12px;">' + title + '</div>' +
        '<div style="font-size:15px;line-height:1.8;color:#475569;">' + msg + '</div>' +
        (extra || '') +
        '<div style="margin-top:22px;font-size:11px;color:#94a3b8;">Kidcastle 薪資系統</div>' +
      '</div></div></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setTitle('Kidcastle 回條')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
