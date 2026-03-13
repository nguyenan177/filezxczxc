// content.js — v6.7 — auto API KEY + retry SIM + stable OTP

const SIM_KEY         = "okvip_sims";
const CURRENT_SIM_KEY = "okvip_current_sim";
const API_KEY_STORE   = "okvip_api_key";

const DEFAULT_API_KEY = "ed7192f2d8bd0a6ee3b60a1915cc0084";

const WORKER   = "https://api.dblgamingg.workers.dev";
const SV2_BASE = "https://noisy-darkness-b3aa.dblgamingg.workers.dev/api";

const FIXED_SVC = 49;
const APP_ID    = 1200;


// =====================================================
// AUTO SET API KEY
// =====================================================

if(!localStorage.getItem(API_KEY_STORE)){
  localStorage.setItem(API_KEY_STORE, DEFAULT_API_KEY);
}


// =====================================================
// SMART INPUT DETECT
// =====================================================

function findPhoneInput(){

  const direct=document.querySelector('input[data-input-name="phone"]');
  if(direct) return direct;

  const tel=document.querySelector('input[type="tel"]');
  if(tel) return tel;

  const KW=/phone|mobile|sdt|sdт/i;

  const inputs=[...document.querySelectorAll('input[type="text"],input[type="number"]')];

  return inputs.find(el =>
      KW.test(el.placeholder||"") ||
      KW.test(el.name||"") ||
      KW.test(el.id||"") ||
      KW.test(el.getAttribute("data-input-name")||"") ||
      KW.test(el.getAttribute("aria-label")||"")
  ) || null;
}


function findOtpInput(){

  const KW=/otp|m[aã].? ?x[aá]c|verif|code|captcha|sms/i;

  const inputs=[...document.querySelectorAll('input[type="text"],input[type="number"],input[type="tel"]')];

  return inputs.find(el =>
      KW.test(el.placeholder||"") ||
      KW.test(el.name||"") ||
      KW.test(el.id||"") ||
      KW.test(el.getAttribute("data-input-name")||"") ||
      KW.test(el.getAttribute("aria-label")||"")
  ) || null;
}


// =====================================================
// UTILS
// =====================================================

const stripZero=p=>p.startsWith("0")?p.slice(1):p;


function fillInput(el,val){

  if(!el) return false;

  try{
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
    if(setter) setter.call(el,val);
    else el.value=val;
  }catch(e){el.value=val;}

  ["input","change"].forEach(ev=>el.dispatchEvent(new Event(ev,{bubbles:true})));

  el.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true}));

  return true;
}


const getStorage=(keys)=>Promise.resolve(Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)])));

const setStorage=(obj)=>{
  Object.entries(obj).forEach(([k,v])=>localStorage.setItem(k,v));
  return Promise.resolve();
};


function detectType(key){

  if(!key) return null;

  if(key.startsWith("eyJ") && key.split(".").length===3) return "okvip";

  if(/^[a-f0-9]{32}$/i.test(key)) return "sv2";

  return null;
}


// =====================================================
// API
// =====================================================

async function callOkvip(path){

  return (await fetch(WORKER+path)).json();
}


async function callSv2(apiKey,params){

  return (await fetch(SV2_BASE+"?"+new URLSearchParams({apik:apiKey,...params}))).json();
}


// =====================================================
// CANCEL SIM
// =====================================================

async function cancelSim(sim,apiKey){

  try{

    if(sim.source==="okvip")
      await callOkvip(`/cancel?api_key=${apiKey}&sim_id=${sim.simId}`);

    else
      await callSv2(apiKey,{act:"expired",id:sim.otpId});

  }catch(e){}
}


// =====================================================
// RENT SIM
// =====================================================

async function rentNewSim(apiKey,type){

  showToast("⏳ Đang thuê SIM...","info");

  for(let i=0;i<3;i++){

    try{

      if(type==="okvip"){

        const d=await callOkvip(`/get-sim?api_key=${apiKey}&service_id=${FIXED_SVC}`);

        if(d?.status!==200) continue;

        return {
          phone:d.data.phone,
          simObj:{
            source:"okvip",
            otpId:d.data.otpId,
            simId:d.data.simId,
            phone:d.data.phone,
            code:null,
            done:false
          }
        };

      }else{

        const d=await callSv2(apiKey,{act:"number",appId:APP_ID});

        if(d?.ResponseCode!==0) continue;

        const phone="0"+d.Result.Number;

        return{
          phone,
          simObj:{
            source:"sv2",
            otpId:d.Result.Id,
            simId:d.Result.Id,
            phone,
            code:null,
            done:false
          }
        };

      }

    }catch(e){}

    await new Promise(r=>setTimeout(r,1500));
  }

  showToast("❌ Kho số tạm hết","error");

  return null;
}


// =====================================================
// POLL OTP
// =====================================================

async function pollOtp(sim,apiKey,btn){

  const maxTry=30;

  let count=0;

  return new Promise(resolve=>{

    const timer=setInterval(async()=>{

      count++;

      if(count>maxTry){

        clearInterval(timer);

        btn.textContent="⏰ Hết giờ";

        btn.style.background="#dc3545";

        resolve(null);

        return;
      }

      try{

        let code=null;

        if(sim.source==="okvip"){

          const d=await callOkvip(`/get-otp?api_key=${apiKey}&otp_id=${sim.otpId}`);

          const content=d?.data?.content||"";

          const m=content.match(/\b\d{4,8}\b/);

          if(m) code=m[0];

        }else{

          const d=await callSv2(apiKey,{act:"code",id:sim.otpId});

          if(d?.ResponseCode===0 && d?.Result?.Code)
            code=d.Result.Code;

        }

        if(code){

          clearInterval(timer);

          btn.textContent=`✅ OTP ${code}`;

          btn.style.background="#28a745";

          fillInput(findOtpInput(),code);

          sim.code=code;

          sim.done=true;

          setStorage({[CURRENT_SIM_KEY]:JSON.stringify(sim)});

          resolve(code);

        }

      }catch(e){}

    },4000);

  });
}


// =====================================================
// HANDLERS
// =====================================================

async function handleFillPhoneClick(){

  const {[API_KEY_STORE]:apiKey,[CURRENT_SIM_KEY]:currentRaw}
  =await getStorage([API_KEY_STORE,CURRENT_SIM_KEY]);

  const type=detectType(apiKey);

  if(!apiKey||!type){
    showToast("❌ API key lỗi","error");
    return;
  }

  let currentSim=null;

  try{currentSim=JSON.parse(currentRaw||"null");}catch(e){}

  if(currentSim && !currentSim.done){

    await cancelSim(currentSim,apiKey);
  }

  const res=await rentNewSim(apiKey,type);

  if(!res) return;

  setStorage({

    [CURRENT_SIM_KEY]:JSON.stringify(res.simObj)

  });

  showToast(`✅ ${res.phone}`,"success");

  setTimeout(()=>fillInput(findPhoneInput(),stripZero(res.phone)),300);
}


async function handleOtpClick(){

  const {[CURRENT_SIM_KEY]:raw,[API_KEY_STORE]:apiKey}
  =await getStorage([CURRENT_SIM_KEY,API_KEY_STORE]);

  let sim=null;

  try{sim=JSON.parse(raw||"null");}catch(e){}

  if(!sim){
    showToast("❌ Chưa có SIM","error");
    return;
  }

  const btn=document.getElementById("okvip-btn-otp");

  btn.textContent="⏳ Đang chờ";

  btn.style.background="#6c757d";

  await pollOtp(sim,apiKey,btn);
}


// =====================================================
// BUTTON INJECT
// =====================================================

function injectBtn(inputEl,id,label,color,handler){

  if(document.getElementById(id)) return;

  const parent=inputEl.parentElement;

  if(getComputedStyle(parent).position==="static")
    parent.style.position="relative";

  const btn=document.createElement("button");

  btn.id=id;

  btn.type="button";

  btn.textContent=label;

  btn.style.cssText=`
    position:absolute;
    right:8px;
    top:50%;
    transform:translateY(-50%);
    z-index:9999;
    padding:4px 10px;
    background:${color};
    color:#fff;
    border:none;
    border-radius:6px;
    font-size:12px;
    font-weight:bold;
    cursor:pointer;
  `;

  btn.onclick=handler;

  parent.appendChild(btn);
}


// =====================================================
// TOAST
// =====================================================

function showToast(msg,type){

  document.getElementById("okvip-toast")?.remove();

  const colors={
    success:"#28a745",
    error:"#dc3545",
    info:"#007bff"
  };

  const t=document.createElement("div");

  t.id="okvip-toast";

  t.textContent=msg;

  t.style.cssText=`
    position:fixed;
    bottom:24px;
    left:50%;
    transform:translateX(-50%);
    z-index:99999;
    padding:10px 20px;
    border-radius:8px;
    font-size:13px;
    font-weight:bold;
    color:#fff;
    background:${colors[type]||"#333"};
  `;

  document.body.appendChild(t);

  setTimeout(()=>t.remove(),2500);
}


// =====================================================
// INIT
// =====================================================

function tryInject(){

  const phone=findPhoneInput();

  if(phone)
    injectBtn(phone,"okvip-btn-phone","📲 Điền SĐT","#ff6b00",handleFillPhoneClick);

  const otp=findOtpInput();

  if(otp)
    injectBtn(otp,"okvip-btn-otp","📨 Lấy OTP","#28a745",handleOtpClick);
}


tryInject();

new MutationObserver(tryInject).observe(document.body,{
  childList:true,
  subtree:true
});
