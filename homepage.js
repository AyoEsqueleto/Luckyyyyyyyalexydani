const navToggle = document.getElementById('navToggle');
const mainNav = document.getElementById('mainNav');
function closeMenu() { mainNav.classList.remove('is-open'); navToggle.setAttribute('aria-expanded', 'false'); navToggle.setAttribute('aria-label', 'Abrir menú'); }
navToggle.addEventListener('click', () => { const open = mainNav.classList.toggle('is-open'); navToggle.setAttribute('aria-expanded', String(open)); navToggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú'); });
mainNav.querySelectorAll('a').forEach(a => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', e => { if(e.key === 'Escape') { closeMenu(); if(mainNav.contains(document.activeElement)) navToggle.focus(); } });
document.addEventListener('click', e => { if(!e.target.closest('.site-header')) closeMenu(); });
window.matchMedia('(min-width: 901px)').addEventListener('change', e => { if(e.matches) closeMenu(); });
if ('IntersectionObserver' in window) {
 const links = [...mainNav.querySelectorAll('a[href^="#"]')];
 const observer = new IntersectionObserver(entries => { entries.forEach(entry => { if(entry.isIntersecting) { links.forEach(a => { const active = a.hash === '#' + entry.target.id; a.classList.toggle('is-active', active); if(active) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current'); }); } }); }, {rootMargin:'-15% 0px -55% 0px'});
 document.querySelectorAll('main section[id]').forEach(s => observer.observe(s));
}
const contactForm=document.getElementById("contactForm")
const formStatus=document.getElementById("formStatus")
const termsCheckbox=document.querySelector('input[name="terms"]')
const messageInput=document.getElementById("contactMessage")
const serviceSelect=document.getElementById("contactService")
const appBriefFields=document.getElementById("appBriefFields")
const appBriefInputs=appBriefFields?appBriefFields.querySelectorAll("select"):null
const CONTACT_API_URL="https://script.google.com/macros/s/AKfycbxZeMApnIjxoF4aAPxNhcLbUb09JluFb4E7jP67bINuODTv08q9xDFtzC5updMnV_Gi/exec"
const contactQuery=new URLSearchParams(window.location.search)
const serviceLabelMap={
apps:"Creación y Desarrollo de Apps",
web:"LuckyWeb (Páginas Web)",
automatizaciones:"LuckyAuto (Automatizaciones)",
branding:"Branding / Diseño",
otro:"Otro"
}

function toggleAppBriefFields(){
if(!serviceSelect||!appBriefFields||!appBriefInputs) return
const isApps=serviceSelect.value==="apps"
appBriefFields.classList.toggle("is-visible",isApps)
appBriefFields.setAttribute("aria-hidden",isApps?"false":"true")
appBriefInputs.forEach((input)=>{
input.required=false
if(!isApps){
input.value=""
}
})
}

if(serviceSelect){
const queryService=contactQuery.get("servicio")
const hasServiceOption=Array.from(serviceSelect.options).some((option)=>option.value===queryService)
if(queryService&&hasServiceOption){
serviceSelect.value=queryService
}else if(contactQuery.get("plan")==="custom"&&contactQuery.get("servicio")){
serviceSelect.value=contactQuery.get("servicio")
}
toggleAppBriefFields()
serviceSelect.addEventListener("change",toggleAppBriefFields)
}

if(messageInput){
  const messageParts=[]
  const presetMessage=String(contactQuery.get("mensaje")||"").trim()
  const planName=String(contactQuery.get("plan")||"").trim()
  const planType=String(contactQuery.get("tipo")||"").trim()
  const planExtras=String(contactQuery.get("extras")||"").trim()
  const planBudget=String(contactQuery.get("presupuesto")||"").trim()

  if(presetMessage){
    messageInput.value=presetMessage
  }else if(planName==="custom"||planType||planExtras||planBudget){
    messageParts.push("Hola, me interesa un plan personalizado.")
    if(planType){ messageParts.push(`Base seleccionada: ${planType}`) }
    if(planExtras){ messageParts.push(`Extras: ${planExtras}`) }
    if(planBudget){ messageParts.push(`Precio aproximado: ${planBudget}`) }
    messageParts.push("")
    messageParts.push("Quiero que reviséis esta propuesta y me ayudéis a cerrarla.")
    messageInput.value=messageParts.join("\n")
  }
}

if(termsCheckbox){
termsCheckbox.addEventListener("invalid",()=>{
termsCheckbox.setCustomValidity("Acepta los términos y condiciones")
})

termsCheckbox.addEventListener("change",()=>{
termsCheckbox.setCustomValidity("")
})
}

if(contactForm){
contactForm.addEventListener("submit",async(event)=>{
event.preventDefault()

const submitBtn=contactForm.querySelector('button[type="submit"]')
if(submitBtn){ submitBtn.disabled=true; submitBtn.textContent="Enviando..." }

const data=new FormData(contactForm)
const serviceValue=String(data.get("servicio")||"").trim()
const appType=String(data.get("app_tipo")||"").trim()
const appTimeline=String(data.get("app_plazo")||"").trim()
const appBudget=String(data.get("app_presupuesto")||"").trim()
const serviceLabel=serviceLabelMap[serviceValue]||"Sin especificar"
const baseMessage=String(data.get("mensaje")||"").trim()
let formattedMessage=baseMessage

if(serviceValue){
formattedMessage=`[Servicio] ${serviceLabel}\n\n${formattedMessage}`
}

if(serviceValue==="apps"){
const appBrief=[
`- Tipo de app: ${appType||"No definido"}`,
`- Plazo deseado: ${appTimeline||"No definido"}`,
`- Presupuesto: ${appBudget||"No definido"}`
].join("\n")
formattedMessage=`${formattedMessage}\n\n[Brief App]\n${appBrief}`
}

const payload={
action:"contact",
nombre:String(data.get("nombre")||"").trim(),
email:String(data.get("email")||"").trim(),
mensaje:formattedMessage,
terms:data.get("terms")?"true":"false",
company:String(data.get("company")||"").trim(),
originUrl:window.location.href
}
const showFormStatus=(message,type)=>{
formStatus.textContent=message
formStatus.className=`form-status show ${type}`
}

try{
const response=await fetch(CONTACT_API_URL,{
method:"POST",
mode:"cors",
cache:"no-store",
headers:{"Content-Type":"text/plain;charset=utf-8"},
body:JSON.stringify(payload)
})

if(!response.ok){
throw new Error("HTTP_"+response.status)
}

let result={}
try{
result=await response.json()
}catch(parseError){
result={}
}

if(result && result.success){
contactForm.reset()
toggleAppBriefFields()
showFormStatus("Mensaje enviado correctamente. Te responderemos pronto.","success")
}else{
showFormStatus((result && result.message) ? result.message : "No se pudo enviar. Inténtalo de nuevo.","error")
}
}catch(error){
showFormStatus("Error de conexión. Inténtalo de nuevo.","error")
}finally{
if(submitBtn){ submitBtn.disabled=false; submitBtn.textContent="Enviar mensaje" }
}
})
}

