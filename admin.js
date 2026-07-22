(() => {
  const defaults = structuredClone(window.ARUS_CONTENT);
  const config = window.ARUS_SUPABASE || {};
  const key = "arus-content-v1";
  const configured = Boolean(config.url && config.publishableKey && window.supabase);
  const client = configured ? window.supabase.createClient(config.url, config.publishableKey) : null;
  let remoteMode = false;
  let state = loadLocal() || defaults;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const esc = (v="") => String(v).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
  const slug = (v="item") => v.toLowerCase().trim().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"") || `item-${Date.now()}`;
  const initials = (name="") => name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();

  function loadLocal(){ try{ const raw=localStorage.getItem(key); return raw?JSON.parse(raw):null; }catch{return null} }
  function saveLocal(){ localStorage.setItem(key, JSON.stringify(state)); }
  function toast(message, error=false){ const el=$("#toast"); el.textContent=message; el.className=`toast show${error?" error":""}`; clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.className="toast",2800); }
  function activeModeLabel(){
    const badge=$("#modeBadge");
    if(remoteMode){ badge.innerHTML="Live publishing<span>Supabase database connected</span>"; }
    else if(configured){ badge.innerHTML="Sign in required<span>Supabase is configured</span>"; }
    else{ badge.innerHTML="Local preview<span>Changes stay in this browser</span>"; }
  }

  async function loadRemote(){
    const [members,advisors,partners,announcements,settings]=await Promise.all([
      client.from("members").select("*").order("display_order"),
      client.from("advisors").select("*").order("display_order"),
      client.from("partners").select("*").order("display_order"),
      client.from("announcements").select("*").order("published_at",{ascending:false}),
      client.from("site_settings").select("content").eq("id","main").maybeSingle()
    ]);
    const error=[members,advisors,partners,announcements,settings].map(x=>x.error).find(Boolean);
    if(error) throw error;
    state={site:settings.data?.content||defaults.site,members:members.data||[],advisors:advisors.data||defaults.advisors,partners:partners.data||[],announcements:announcements.data||[]};
  }

  function renderAll(){ renderMembers(); renderPartners(); renderNews(); fillSettings(); activeModeLabel(); }
  function thumb(url,name){ return url?`<img src="${esc(url)}" alt="">`:esc(initials(name)); }
  function empty(text){ return `<div class="empty">${esc(text)}</div>`; }

  function renderMembers(){
    const rows=[...(state.members||[])].sort((a,b)=>(a.display_order??999)-(b.display_order??999));
    $("#memberList").innerHTML=rows.length?rows.map(x=>`<article class="item"><div class="item-thumb">${thumb(x.image_url,x.name)}</div><div><h3>${esc(x.name)}</h3><p>${esc(x.role)}</p><span class="item-meta">${esc(x.department||"Team")} · ${x.active===false?"Hidden":"Visible"}</span></div><div class="item-actions"><button class="icon-btn" data-edit-member="${esc(x.id)}">Edit</button><button class="icon-btn delete" data-delete-member="${esc(x.id)}">Delete</button></div></article>`).join(""):empty("No team members yet.");
  }
  function renderPartners(){
    const rows=[...(state.partners||[])].sort((a,b)=>(a.display_order??999)-(b.display_order??999));
    $("#partnerAdminList").innerHTML=rows.length?rows.map(x=>`<article class="item"><div class="item-thumb">${thumb(x.logo_url,x.name)}</div><div><h3>${esc(x.name)}</h3><p>${esc(x.description||"")}</p><span class="item-meta">${esc(x.tier)} · ${x.active===false?"Hidden":"Visible"}</span></div><div class="item-actions"><button class="icon-btn" data-edit-partner="${esc(x.id)}">Edit</button><button class="icon-btn delete" data-delete-partner="${esc(x.id)}">Delete</button></div></article>`).join(""):empty("No partners yet.");
  }
  function renderNews(){
    const rows=[...(state.announcements||[])].sort((a,b)=>new Date(b.published_at)-new Date(a.published_at));
    $("#newsAdminList").innerHTML=rows.length?rows.map(x=>`<article class="item"><div class="item-thumb">NEWS</div><div><h3>${esc(x.title)}</h3><p>${esc(x.summary)}</p><span class="item-meta">${esc(x.published_at)} · ${x.active===false?"Hidden":"Visible"}</span></div><div class="item-actions"><button class="icon-btn" data-edit-news="${esc(x.id)}">Edit</button><button class="icon-btn delete" data-delete-news="${esc(x.id)}">Delete</button></div></article>`).join(""):empty("No announcements yet.");
  }
  function fillSettings(){ const f=$("#settingsForm"); Object.entries(state.site||{}).forEach(([k,v])=>{ if(f.elements[k])f.elements[k].value=v??""; }); }
  function formData(form){ return Object.fromEntries(new FormData(form).entries()); }
  function setForm(formId,data){ const f=$(formId); Object.entries(data).forEach(([k,v])=>{ if(!f.elements[k])return; if(f.elements[k].type==="checkbox")f.elements[k].checked=v!==false; else if(f.elements[k].type!=="file")f.elements[k].value=v??""; }); f.scrollIntoView({behavior:"smooth",block:"start"}); }
  function resetForm(id){ const f=document.getElementById(id); f.reset(); if(f.elements.active)f.elements.active.checked=true; if(f.elements.display_order)f.elements.display_order.value=10; if(f.elements.id)f.elements.id.value=""; if(id==="newsForm")f.elements.published_at.value=new Date().toISOString().slice(0,10); }

  async function imageValue(fileInput,urlValue,folder){
    const file=fileInput?.files?.[0];
    if(!file)return urlValue||"";
    if(remoteMode){
      const extension=file.name.split(".").pop().toLowerCase();
      const path=`${folder}/${Date.now()}-${slug(file.name.replace(/\.[^.]+$/, ""))}.${extension}`;
      const upload=await client.storage.from("media").upload(path,file,{upsert:false,contentType:file.type});
      if(upload.error)throw upload.error;
      return client.storage.from("media").getPublicUrl(path).data.publicUrl;
    }
    if(file.size>1_500_000)throw new Error("For local preview, use an image smaller than 1.5 MB.");
    return await new Promise((resolve,reject)=>{ const reader=new FileReader(); reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(file); });
  }

  async function upsert(table,row){
    if(remoteMode){ const result=await client.from(table).upsert(row,{onConflict:"id"}).select().single(); if(result.error)throw result.error; return result.data; }
    const list=state[table]; const i=list.findIndex(x=>x.id===row.id); if(i>=0)list[i]=row; else list.push(row); saveLocal(); return row;
  }
  async function remove(table,id){
    if(remoteMode){
      const result=await client.from(table).delete().eq("id",id);
      if(result.error)throw result.error;
      state[table]=state[table].filter(x=>x.id!==id);
    } else {
      state[table]=state[table].filter(x=>x.id!==id);
      saveLocal();
    }
  }

  $("#memberForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=e.currentTarget; const data=formData(f); const id=data.id||slug(data.name);
    try{
      const row={id,name:data.name.trim(),role:data.role.trim(),department:data.department.trim(),bio:data.bio.trim(),image_url:await imageValue(f.elements.image_file,data.image_url,"members"),linkedin_url:data.linkedin_url.trim(),display_order:Number(data.display_order)||10,active:f.elements.active.checked};
      await upsert("members",row); const i=state.members.findIndex(x=>x.id===id); if(remoteMode){if(i>=0)state.members[i]=row;else state.members.push(row)} resetForm("memberForm"); renderMembers(); toast("Team member saved.");
    }catch(err){toast(err.message||"Could not save member.",true)}
  });
  $("#partnerForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=e.currentTarget; const data=formData(f); const id=data.id||slug(data.name);
    try{
      const row={id,name:data.name.trim(),tier:data.tier,description:data.description.trim(),logo_url:await imageValue(f.elements.logo_file,data.logo_url,"partners"),website_url:data.website_url.trim(),display_order:Number(data.display_order)||10,active:f.elements.active.checked};
      await upsert("partners",row); const i=state.partners.findIndex(x=>x.id===id); if(remoteMode){if(i>=0)state.partners[i]=row;else state.partners.push(row)} resetForm("partnerForm"); renderPartners(); toast("Partner saved.");
    }catch(err){toast(err.message||"Could not save partner.",true)}
  });
  $("#newsForm").addEventListener("submit",async e=>{
    e.preventDefault(); const f=e.currentTarget; const data=formData(f); const id=data.id||`${data.published_at}-${slug(data.title)}`;
    try{
      const row={id,title:data.title.trim(),summary:data.summary.trim(),published_at:data.published_at,link_url:data.link_url.trim(),active:f.elements.active.checked};
      await upsert("announcements",row); const i=state.announcements.findIndex(x=>x.id===id); if(remoteMode){if(i>=0)state.announcements[i]=row;else state.announcements.push(row)} resetForm("newsForm"); renderNews(); toast("Announcement saved.");
    }catch(err){toast(err.message||"Could not save announcement.",true)}
  });
  $("#settingsForm").addEventListener("submit",async e=>{
    e.preventDefault(); const data=formData(e.currentTarget); const content={...state.site,...data,updatedAt:new Date().toISOString().slice(0,10)};
    try{
      if(remoteMode){ const result=await client.from("site_settings").upsert({id:"main",content},{onConflict:"id"}); if(result.error)throw result.error; }
      state.site=content; if(!remoteMode)saveLocal(); fillSettings(); toast("Project details saved.");
    }catch(err){toast(err.message||"Could not save project details.",true)}
  });

  document.addEventListener("click",async e=>{
    const reset=e.target.closest("[data-reset]"); if(reset){resetForm(reset.dataset.reset);return}
    const em=e.target.closest("[data-edit-member]"); if(em){const x=state.members.find(v=>v.id===em.dataset.editMember);if(x)setForm("#memberForm",x);return}
    const ep=e.target.closest("[data-edit-partner]"); if(ep){const x=state.partners.find(v=>v.id===ep.dataset.editPartner);if(x)setForm("#partnerForm",x);return}
    const en=e.target.closest("[data-edit-news]"); if(en){const x=state.announcements.find(v=>v.id===en.dataset.editNews);if(x)setForm("#newsForm",x);return}
    const del=e.target.closest("[data-delete-member],[data-delete-partner],[data-delete-news]");
    if(del){
      const [table,id]=del.dataset.deleteMember?["members",del.dataset.deleteMember]:del.dataset.deletePartner?["partners",del.dataset.deletePartner]:["announcements",del.dataset.deleteNews];
      if(confirm("Delete this item?")){try{await remove(table,id);renderAll();toast("Item deleted.")}catch(err){toast(err.message||"Could not delete item.",true)}}
    }
  });

  $$(".tab").forEach(tab=>tab.addEventListener("click",()=>{ $$(".tab").forEach(t=>t.classList.remove("active")); $$(".panel").forEach(p=>p.classList.remove("active")); tab.classList.add("active"); document.getElementById(tab.dataset.panel).classList.add("active"); }));
  $("#exportButton").addEventListener("click",()=>{ const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"}); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`arus-content-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); });
  $("#importButton").addEventListener("click",()=>$("#importFile").click());
  $("#importFile").addEventListener("change",async e=>{ const file=e.target.files[0]; if(!file)return; try{ const imported=JSON.parse(await file.text()); if(!imported.site||!Array.isArray(imported.members))throw new Error("This is not a valid ARUS content backup."); state=imported; if(!remoteMode)saveLocal(); renderAll(); toast("Backup imported."); }catch(err){toast(err.message,true)} e.target.value=""; });

  function previewFile(input,previewId){ input.addEventListener("change",()=>{ const file=input.files[0]; const box=$(previewId); if(!file){box.classList.add("hidden");box.innerHTML="";return} const url=URL.createObjectURL(file); box.innerHTML=`<img src="${url}" alt="Preview"><span>${esc(file.name)}</span>`; box.classList.remove("hidden"); }); }
  previewFile($("#memberForm").elements.image_file,"#memberPreview"); previewFile($("#partnerForm").elements.logo_file,"#partnerPreview");

  async function authInit(){
    $("#configUrl").value=config.url||"Not configured"; $("#configKey").value=config.publishableKey?"Configured":"Not configured";
    if(!configured){ remoteMode=false; renderAll(); return; }
    $("#loginPanel").classList.add("show");
    const {data}=await client.auth.getSession();
    remoteMode=Boolean(data.session);
    if(remoteMode){ await loadRemote(); $("#loginPanel").classList.remove("show"); $("#signOutButton").classList.remove("hidden"); }
    renderAll();
  }
  $("#loginButton").addEventListener("click",async()=>{ try{ const email=$("#loginEmail").value.trim(); const password=$("#loginPassword").value; const result=await client.auth.signInWithPassword({email,password}); if(result.error)throw result.error; remoteMode=true; await loadRemote(); $("#loginPanel").classList.remove("show"); $("#signOutButton").classList.remove("hidden"); renderAll(); toast("Signed in. Changes now publish live."); }catch(err){toast(err.message||"Sign-in failed.",true)} });
  $("#signOutButton").addEventListener("click",async()=>{ await client.auth.signOut(); remoteMode=false; state=loadLocal()||defaults; $("#loginPanel").classList.add("show"); $("#signOutButton").classList.add("hidden"); renderAll(); toast("Signed out. Local preview mode restored."); });

  resetForm("newsForm"); authInit();
})();
