// content.js — v6.6 — OTP button shows live state: waiting / OTP / Call / timeout

const SIM_KEY         = "okvip_sims";
const CURRENT_SIM_KEY = "okvip_current_sim"; // SIM đang dùng cho lần xác minh hiện tại
const API_KEY_STORE   = "okvip_api_key";
const WORKER          = "https://api.dblgamingg.workers.dev";
const SV2_BASE        = "https://noisy-darkness-b3aa.dblgamingg.workers.dev/api";
const FIXED_SVC       = 49;
const APP_ID          = 1200;

// =====================================================
//  SMART SELECTOR — tự nhận dạng ô SĐT / OTP
//  hoạt động trên mọi trang có layout tương tự
// =====================================================

function findPhoneInput() {
  // Direct match for data-input-name="phone" (SC88, OKVIP sites)
  const direct = document.querySelector('input[data-input-name="phone"]');
  if (direct) return direct;
  // Fallback: type=tel
  const tel = document.querySelector('input[type="tel"]');
  if (tel) return tel;
  // Fallback: keyword match on name/id/placeholder
  const KW = /phone|mobile|sdt|sdт/i;
  const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"]')];
  return inputs.find(el =>
    KW.test(el.placeholder || "") ||
    KW.test(el.name        || "") ||
    KW.test(el.id          || "") ||
    KW.test(el.getAttribute("data-input-name") || "") ||
    KW.test(el.getAttribute("aria-label")      || "")
  ) || null;
}

function findOtpInput() {
  const KW = /otp|m[aã].? ?x[aá]c|verif|code|captcha|s[mM][sS]/i;
  const inputs = [...document.querySelectorAll('input[type="text"], input[type="number"], input[type="tel"]')];
  return inputs.find(el =>
    KW.test(el.placeholder || "") ||
    KW.test(el.name        || "") ||
    KW.test(el.id          || "") ||
    KW.test(el.getAttribute("data-input-name") || "") ||
    KW.test(el.getAttribute("aria-label")      || "")
  ) || null;
}

// =====================================================
//  UTILS
// =====================================================
const stripZero = (p) => p.startsWith("0") ? p.slice(1) : p;

function isVerifyPhonePage() {
  // Nhận dạng trang xác minh SĐT: placeholder chứa số điện thoại bị che (vd: 84*425, 09***23)
  const inputs = [...document.querySelectorAll('input[type="tel"], input[type="text"], input[type="number"]')];
  const hasMaskedPhone = inputs.some(el => /\d[\*•x]+\d/i.test(el.placeholder || ""));
  if (hasMaskedPhone) return true;
  // Kiểm tra text trang có từ khoá xác minh rõ ràng
  const txt = document.title + " " + document.body.innerText.substring(0, 500);
  return /x[aá]c\s*(minh|nh[aậ]n)|verif(y|ication)|confirm/i.test(txt);
}

function isRegisterPage() {
  if (isVerifyPhonePage()) return false;
  const txt = document.title + " " + document.body.innerText.substring(0, 500);
  return /[đd][aă]ng\s*k[yý]|register|sign.?up/i.test(txt);
}

function fillInput(el, val) {
  if (!el) return false;
  try {
    const setter = (Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')||{}).set;
    if (setter) setter.call(el, val); else el.value = val;
  } catch(e) { el.value = val; }
  ["input","change"].forEach(ev => el.dispatchEvent(new Event(ev, { bubbles:true })));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true }));
  return true;
}

const getStorage=(keys)=>Promise.resolve(Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])));
const setStorage=(obj)=>{Object.entries(obj).forEach(([k,v])=>localStorage.setItem(k,v));return Promise.resolve();};

function detectType(key) {
  if (!key) return null;
  if (key.startsWith("eyJ") && key.split(".").length === 3) return "okvip";
  if (/^[a-f0-9]{32}$/i.test(key)) return "sv2";
  return null;
}

// =====================================================
//  API
// =====================================================
async function callOkvip(path) {
  return (await fetch(WORKER + path)).json();
}
async function callSv2(apiKey, params) {
  return (await fetch(SV2_BASE + "?" + new URLSearchParams({ apik:apiKey, ...params }))).json();
}

async function cancelSim(sim, apiKey) {
  try {
    if (sim.source === "okvip") await callOkvip("/cancel?api_key="+apiKey+"&sim_id="+sim.simId);
    else await callSv2(apiKey, { act:"expired", id:sim.otpId });
  } catch(e) {}
}

async function rentNewSim(apiKey, type) {
  showToast("⏳ Đang thuê SIM mới...", "info");
  if (type === "okvip") {
    const d = await callOkvip("/get-sim?api_key="+apiKey+"&service_id="+FIXED_SVC);
    if ((d && d.status) !== 200) { showToast("❌ " + ((d && d.message) || "Không thuê được SIM"), "error"); return null; }
    return { phone:d.data.phone, simObj:{ source:"okvip", otpId:d.data.otpId, simId:d.data.simId, phone:d.data.phone, code:null, done:false } };
  } else {
    const d = await callSv2(apiKey, { act:"number", appId:APP_ID });
    if ((d && d.ResponseCode) !== 0) { showToast("❌ " + ((d && d.ResponseCode)===3 ? "Kho số tạm hết!" : (d && d.Msg)||"Lỗi"), "error"); return null; }
    const phone = "0" + d.Result.Number;
    return { phone, simObj:{ source:"sv2", otpId:d.Result.Id, simId:d.Result.Id, phone, code:null, done:false } };
  }
}

// =====================================================
//  POLL OTP
// =====================================================
async function pollOtp(sim, apiKey, btn) {
  const setBtn = (text, color) => {
    if (!btn) return;
    btn.textContent = text;
    btn.style.background = color;
  };

  const maxTry = 30;
  let count = 0;
  return new Promise((resolve) => {
    const timer = setInterval(async () => {
      count++;
      if (count > maxTry) {
        clearInterval(timer);
        setBtn("⏰ Hết giờ", "#dc3545");
        showToast("⏰ Hết thời gian chờ OTP","error");
        resolve(null); return;
      }
      try {
        let code = null, audioUrl = null;
        if (sim.source === "okvip") {
          const d = await callOkvip("/get-otp?api_key="+apiKey+"&otp_id="+sim.otpId);
          const content = (d && d.data && d.data.content) || "";
          const audio   = (d && d.data && d.data.audio)   || "";
          const m = content.match(/\b\d{4,8}\b/);
          if (m)     code     = m[0];
          if (audio) audioUrl = audio;
        } else {
          const d = await callSv2(apiKey, { act:"code", id:sim.otpId });
          if ((d && d.ResponseCode) === 0 && (d && d.Result)) {
            if (d.Result.Code)                        code     = d.Result.Code;
            if (d.Result.IsCall && d.Result.CallFile) audioUrl = d.Result.CallFile;
          } else if ((d && d.ResponseCode) === 2) {
            clearInterval(timer);
            setBtn("⏰ Hết giờ", "#dc3545");
            showToast("⏰ Hết giờ OTP","error");
            resolve(null); return;
          }
        }

        if (code) {
          clearInterval(timer);
          setBtn("OTP: "+code, "#28a745");
          showToast("OTP: "+code, "success");
          fillInput(findOtpInput(), code);
          sim.code = code; sim.done = true;
          await setStorage({ [CURRENT_SIM_KEY]: JSON.stringify(sim) });
          resolve(code);
        } else if (audioUrl) {
          clearInterval(timer);
          setBtn("📞 [Call] — Mở extension nghe", "#ff6b00");
          sim.audio = audioUrl; sim.done = true;
          await setStorage({ [CURRENT_SIM_KEY]: JSON.stringify(sim) });
          showToast("📞 [Call] OTP — Mở extension để nghe!", "info");
          resolve(null);
        }
      } catch(e) {}
    }, 4000);
  });
}

// =====================================================
//  HANDLERS
// =====================================================
// Bước 1 — Điền SĐT: hủy current_sim cũ nếu có → thuê mới → lưu current_sim → điền
async function handleFillPhoneClick() {
  const { [API_KEY_STORE]:apiKey, [CURRENT_SIM_KEY]:currentRaw } = await getStorage([API_KEY_STORE, CURRENT_SIM_KEY]);
  const type = detectType(apiKey);
  if (!apiKey || !type) { showToast("❌ Chưa có API key! Mở extension nhập key.","error"); return; }

  // Hủy current_sim cũ nếu chưa done
  let currentSim = null;
  try { currentSim = JSON.parse(currentRaw || "null"); } catch(e) {}
  if (currentSim && !currentSim.done) {
    showToast("🔄 Đang hủy SIM cũ...","info");
    await cancelSim(currentSim, apiKey);
    // Xóa khỏi sims[] luôn
    const { [SIM_KEY]:raw } = await getStorage([SIM_KEY]);
    let sims = [];
    try { sims = JSON.parse(raw || "[]"); } catch(e) {}
    sims = sims.filter(s => s.otpId !== currentSim.otpId);
    await setStorage({ [SIM_KEY]: JSON.stringify(sims) });
  }

  const res = await rentNewSim(apiKey, type);
  if (!res) return;

  const { [SIM_KEY]:raw2 } = await getStorage([SIM_KEY]);
  let sims2 = [];
  try { sims2 = JSON.parse(raw2 || "[]"); } catch(e) {}
  sims2.push(res.simObj);
  await setStorage({
    [SIM_KEY]: JSON.stringify(sims2),
    [CURRENT_SIM_KEY]: JSON.stringify(res.simObj)
  });

  showToast("Da thue: "+res.phone, "success");
  setTimeout(() => fillInput(findPhoneInput(), stripZero(res.phone)), 300);
}

// Bước 2 — Xác minh SĐT trên trang khác: điền lại SĐT của current_sim
async function handleVerPhoneClick() {
  const { [CURRENT_SIM_KEY]:raw } = await getStorage([CURRENT_SIM_KEY]);
  let sim = null;
  try { sim = JSON.parse(raw || "null"); } catch(e) {}
  if (!(sim && sim.phone)) { showToast("❌ Chưa có SIM! Nhấn 'Điền SĐT' ở trang trước.","error"); return; }
  const ok = fillInput(findPhoneInput(), stripZero(sim.phone));
  showToast(ok ? "Da dien: "+sim.phone : "❌ Không tìm thấy ô SĐT", ok ? "success" : "error");
}

async function handleOtpClick() {
  const { [CURRENT_SIM_KEY]:raw, [API_KEY_STORE]:apiKey } = await getStorage([CURRENT_SIM_KEY, API_KEY_STORE]);
  if (!apiKey) { showToast("❌ Chưa có API key!","error"); return; }
  let sim = null;
  try { sim = JSON.parse(raw || "null"); } catch(e) {}
  if (!sim) { showToast("❌ Chưa có SIM! Nhấn 'Điền SĐT' trước.","error"); return; }

  const btn = document.getElementById("okvip-btn-otp");
  showToast("⏳ Đang chờ mã SMS...", "info");
  if (btn) { btn.textContent = "⏳ Đang chờ SMS..."; btn.style.background = "#6c757d"; }

  await pollOtp(sim, apiKey, btn);
}

// =====================================================
//  INJECT NÚT
// =====================================================
function injectBtn(inputEl, id, label, color, handler) {
  if (document.getElementById(id)) return;
  const parent = inputEl.parentElement;
  if (getComputedStyle(parent).position === "static") parent.style.position = "relative";
  const btn = document.createElement("button");
  btn.id = id; btn.type = "button"; btn.textContent = label;
  btn.style.cssText = "position:absolute;right:8px;top:50%;transform:translateY(-50%);z-index:9999;padding:4px 10px;background:"+color+";color:#fff;border:none;border-radius:6px;font-size:12px;font-weight:bold;cursor:pointer;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.2);line-height:1.4;";
  btn.addEventListener("click", async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (btn.disabled) return;
    btn.disabled = true;
    // Chỉ reset text nếu không phải nút OTP (nút OTP tự quản lý text)
    const isOtpBtn = id === "okvip-btn-otp";
    if (!isOtpBtn) btn.textContent = "⏳...";
    await handler();
    btn.disabled = false;
    if (!isOtpBtn) btn.textContent = label;
  });
  parent.appendChild(btn);
}

// =====================================================
//  TOAST
// =====================================================
function showToast(msg, type) {
  var _t=document.getElementById("okvip-toast");if(_t)_t.remove();
  const colors = { success:"#28a745", error:"#dc3545", info:"#007bff" };
  const t = document.createElement("div");
  t.id = "okvip-toast"; t.textContent = msg;
  t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:99999;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:bold;font-family:Arial,sans-serif;color:#fff;background:"+(colors[type]||"#333")+";box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;";
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity="0"; setTimeout(()=>t.remove(),300); }, 2800);
}

// =====================================================
//  INIT
// =====================================================
function tryInject() {
  const phoneEl = findPhoneInput();
  if (phoneEl && !document.getElementById("okvip-btn-phone")) {
    // Ưu tiên: nếu nhận ra trang xác minh → điền lại current_sim
    // Còn lại (đăng ký hoặc không rõ) → thuê SIM mới
    const handler = isVerifyPhonePage() ? handleVerPhoneClick : handleFillPhoneClick;
    injectBtn(phoneEl, "okvip-btn-phone", "📲 Điền SĐT", "#ff6b00", handler);
  }
  const otpEl = findOtpInput();
  if (otpEl && !document.getElementById("okvip-btn-otp")) {
    injectBtn(otpEl, "okvip-btn-otp", "📨 Lấy mã SMS", "#28a745", handleOtpClick);
  }
}

tryInject();
new MutationObserver(tryInject).observe(document.body, { childList:true, subtree:true });
