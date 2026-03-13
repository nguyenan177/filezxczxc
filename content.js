// content.js — v6.7 — FIX SC88 / OKVIP phone detect

const SIM_KEY="okvip_sims";
const CURRENT_SIM_KEY="okvip_current_sim";
const API_KEY_STORE="okvip_api_key";

const WORKER="https://api.dblgamingg.workers.dev";
const SV2_BASE="https://noisy-darkness-b3aa.dblgamingg.workers.dev/api";

const FIXED_SVC=49;
const APP_ID=1200;


// =============================
// FIND PHONE INPUT
// =============================

function findPhoneInput(){

  const inputs=[...document.querySelectorAll("input")];

  const KW=/phone|mobile|sdt|sđt|điện|dien|tel/i;

  let found=inputs.find(el=>{
    const text=
      (el.placeholder||"")+
      (el.name||"")+
      (el.id||"")+
      (el.getAttribute("data-input-name")||"")+
      (el.getAttribute("aria-label")||"");
    return KW.test(text.toLowerCase());
  });

  if(found) return found;

  // fallback: input gần +84
  const country=[...document.querySelectorAll("*")]
  .find(e=>e.textContent.trim()==="+84");

  if(country){
    const input=country.closest("div")?.querySelector("input");
    if(input) return input;
  }

  // fallback: input thứ 4 (thường là SĐT)
  if(inputs.length>=4) return inputs[3];

  return null;
}


// =============================
// FIND OTP INPUT
// =============================

function findOtpInput(){

  const KW=/otp|mã|code|captcha|sms|verify/i;

  const inputs=[...document.querySelectorAll("input")];

  return inputs.find(el=>{
    const text=
      (el.placeholder||"")+
      (el.name||"")+
      (el.id||"")+
      (el.getAttribute("data-input-name")||"")+
      (el.getAttribute("aria-label")||"");

    return KW.test(text.toLowerCase());
  })||null;

}


// =============================
// UTILS
// =============================

const stripZero=p=>p.startsWith("0")?p.slice(1):p;

function fillInput(el,val){

  if(!el) return false;

  try{
    const setter=Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,'value'
    )?.set;

    if(setter) setter.call(el,val);
    else el.value=val;

  }catch(e){el.value=val;}

  ["input","change"].forEach(ev=>
    el.dispatchEvent(new Event(ev,{bubbles:true}))
  );

  el.dispatchEvent(new KeyboardEvent("keyup",{bubbles:true}));

  return true;
}


const getStorage=(keys)=>Promise.resolve(
Object.fromEntries(keys.map(k=>[k,localStorage.getItem(k)]))
);

const setStorage=obj=>{
Object.entries(obj).forEach(([k,v])=>localStorage.setItem(k,v));
return Promise.resolve();
};


// =============================
// API TYPE
// =============================

function detectType(key){

 if(!key) return null;

 if(key.startsWith("eyJ") && key.split(".").length===3)
 return "okvip";

 if(/^[a-f0-9]{32}$/i.test(key))
 return "sv2";

 return null;
}


// =============================
// API
// =============================

async function callOkvip(path){
 return (await fetch(WORKER+path)).json();
}

async function callSv2(apiKey,params){
 return (await fetch(
 SV2_BASE+"?"+new URLSearchParams({apik:apiKey,...params})
 )).json();
}


async function rentNewSim(apiKey,type){

 showToast("⏳ Đang thuê SIM...","info");

 if(type==="okvip"){

   const d=await callOkvip(
   `/get-sim?api_key=${apiKey}&service_id=${FIXED_SVC}`
   );

   if(d?.status!==200){
     showToast("❌ Không thuê được SIM","error");
     return null;
   }

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

 }

 else{

   const d=await callSv2(apiKey,{act:"number",appId:APP_ID});

   if(d?.ResponseCode!==0){
     showToast("❌ Kho số hết","error");
     return null;
   }

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

}


// =============================
// OTP POLL
// =============================

async function pollOtp(sim,apiKey,btn){

 const setBtn=(t,c)=>{
   if(!btn)return;
   btn.textContent=t;
   btn.style.background=c;
 };

 let count=0;

 const timer=setInterval(async()=>{

   count++;

   if(count>30){
     clearInterval(timer);
     setBtn("⏰ Timeout","#dc3545");
     return;
   }

   let code=null;

   try{

   if(sim.source==="okvip"){

     const d=await callOkvip(
     `/get-otp?api_key=${apiKey}&otp_id=${sim.otpId}`
     );

     const content=d?.data?.content||"";

     const m=content.match(/\b\d{4,8}\b/);

     if(m) code=m[0];

   }

   else{

     const d=await callSv2(apiKey,{act:"code",id:sim.otpId});

     if(d?.ResponseCode===0)
     code=d.Result.Code;

   }

   if(code){

     clearInterval(timer);

     setBtn("OTP: "+code,"#28a745");

     fillInput(findOtpInput(),code);

   }

   }catch(e){}

 },4000);

}


// =============================
// BUTTON
// =============================

function injectBtn(input,id,label,color,handler){

 if(document.getElementById(id)) return;

 const parent=input.parentElement;

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


// =============================
// HANDLERS
// =============================

async function handleFillPhoneClick(){

 const {[API_KEY_STORE]:apiKey}=await getStorage([API_KEY_STORE]);

 const type=detectType(apiKey);

 if(!apiKey){
   showToast("❌ Chưa có API key","error");
   return;
 }

 const res=await rentNewSim(apiKey,type);

 if(!res) return;

 await setStorage({
   [CURRENT_SIM_KEY]:JSON.stringify(res.simObj)
 });

 fillInput(findPhoneInput(),stripZero(res.phone));

 showToast("📲 "+res.phone,"success");

}


async function handleOtpClick(){

 const {[CURRENT_SIM_KEY]:raw,[API_KEY_STORE]:apiKey}
 =await getStorage([CURRENT_SIM_KEY,API_KEY_STORE]);

 const sim=JSON.parse(raw||"null");

 if(!sim){
   showToast("❌ Chưa có SIM","error");
   return;
 }

 const btn=document.getElementById("okvip-btn-otp");

 pollOtp(sim,apiKey,btn);

}


// =============================
// TOAST
// =============================

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


// =============================
// INIT
// =============================

function tryInject(){

 const phone=findPhoneInput();

 if(phone && !document.getElementById("okvip-btn-phone")){
   injectBtn(phone,"okvip-btn-phone","📲 Điền SĐT","#ff6b00",handleFillPhoneClick);
 }

 const otp=findOtpInput();

 if(otp && !document.getElementById("okvip-btn-otp")){
   injectBtn(otp,"okvip-btn-otp","📨 OTP","#28a745",handleOtpClick);
 }

}


// delay vì SC88 load React
setTimeout(tryInject,1200);

new MutationObserver(tryInject)
.observe(document.body,{childList:true,subtree:true});
