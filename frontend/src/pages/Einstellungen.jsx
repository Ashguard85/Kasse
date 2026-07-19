import React, { useEffect, useRef, useState } from "react";
import styles from "./Einstellungen.module.css";
import {
  apiFetch, getApiBase, setApiBase, getCloudflareAccessConfig, setCloudflareAccessConfig,
  getDataMode, setDataMode, exportLocalData, importLocalData, resetLocalData,
} from "../lib/api";
import { DEFAULT_THEME } from "../lib/localDb";
import { useProfile } from "../ProfileContext";
import { useCart } from "../CartContext";

const PAY_METHODS = [
  { id:"nfc",icon:"📡",label:"NFC",desc:"Web NFC direkt am Gerät" },
  { id:"qr",icon:"📷",label:"QR-Code",desc:"Kamera scannt den QR-Code" },
  { id:"bleNfc",icon:"🔵",label:"NFC-Box",desc:"Externe ESP32-Bluetooth-Box" },
  { id:"manual",icon:"✏️",label:"Name",desc:"Kundenname von Hand eingeben" },
];
const THEME_FIELDS = [
  ["primaryColor","Hauptfarbe"],["primaryDark","Dunkle Hauptfarbe"],["accentColor","Akzentfarbe"],
  ["pageBackground","Seitenhintergrund"],["registerBackground","Kassenhintergrund"],
  ["bannerBackground","Bannerfarbe"],["bannerTextColor","Banner-Textfarbe"],
];

export default function Einstellungen() {
  const { profiles, activeProfile, refreshProfiles, switchProfile } = useProfile();
  const { cart, clearCart } = useCart();
  const [enabled,setEnabled]=useState({nfc:true,qr:true,bleNfc:true,manual:true});
  const [defaultMode,setDefaultMode]=useState("nfc");
  const [loading,setLoading]=useState(true);
  const [msg,setMsg]=useState({text:"",type:""});
  const [serverUrl,setServerUrl]=useState(getApiBase());
  const [dataMode,setDataModeState]=useState(getDataMode());
  const initialAccess=getCloudflareAccessConfig();
  const [cfClientId,setCfClientId]=useState(initialAccess.clientId);
  const [cfClientSecret,setCfClientSecret]=useState(initialAccess.clientSecret);
  const [cfSecretHidden,setCfSecretHidden]=useState(Boolean(initialAccess.clientSecret));
  const [newProfileName,setNewProfileName]=useState("");
  const [profileName,setProfileName]=useState("");
  const [theme,setTheme]=useState(DEFAULT_THEME);
  const msgTimerRef=useRef(null); const importFileRef=useRef(null); const bannerFileRef=useRef(null);

  const showMsg=(text,type="ok")=>{if(msgTimerRef.current)clearTimeout(msgTimerRef.current);setMsg({text,type});msgTimerRef.current=setTimeout(()=>setMsg({text:"",type:""}),3800);};
  const loadPaymentSettings=async()=>{setLoading(true);try{const res=await apiFetch("/api/settings/payment");if(!res.ok)throw new Error();const data=await res.json();setEnabled(data.enabled);setDefaultMode(data.default);try{localStorage.setItem("kasseBleNfcEnabled",data.enabled?.bleNfc?"1":"0");}catch{}window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated",{detail:data}));}catch{showMsg("Einstellungen konnten nicht geladen werden","err");}finally{setLoading(false);}};

  useEffect(()=>{if(activeProfile){setProfileName(activeProfile.name);setTheme({...DEFAULT_THEME,...(activeProfile.theme||{})});loadPaymentSettings();}},[activeProfile?.id]);
  useEffect(()=>()=>{if(msgTimerRef.current)clearTimeout(msgTimerRef.current);},[]);

  const selectProfile=async(id)=>{if(Number(id)===Number(activeProfile?.id))return;if(cart.length&&!confirm("Beim Profilwechsel wird der aktuelle Warenkorb geleert. Profil wechseln?"))return;clearCart();await switchProfile(Number(id));showMsg("Profil gewechselt ✓");};
  const createProfile=async()=>{const name=newProfileName.trim();if(!name)return showMsg("Bitte einen Profilnamen eingeben","err");try{const res=await apiFetch("/api/profiles",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name,theme:{...DEFAULT_THEME,bannerText:name}})});const data=await res.json();if(!res.ok)return showMsg(data.error||"Profil konnte nicht erstellt werden","err");setNewProfileName("");await refreshProfiles();clearCart();await switchProfile(data.id);showMsg(`Profil „${data.name}“ erstellt ✓`);}catch{showMsg("Profil konnte nicht erstellt werden","err");}};
  const saveProfile=async()=>{if(!activeProfile)return;try{const res=await apiFetch(`/api/profiles/${activeProfile.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:profileName,theme})});const data=await res.json();if(!res.ok)return showMsg(data.error||"Profil konnte nicht gespeichert werden","err");await refreshProfiles();window.dispatchEvent(new CustomEvent("kasse:profiles-updated"));showMsg("Profil und Design gespeichert ✓");}catch{showMsg("Profil konnte nicht gespeichert werden","err");}};
  const setProfileActive=async(profile,active)=>{if(!active&&Number(profile.id)===Number(activeProfile?.id)&&!confirm("Aktives Profil archivieren? Danach wird auf ein anderes Profil gewechselt."))return;try{const res=await apiFetch(`/api/profiles/${profile.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({active})});const data=await res.json();if(!res.ok)return showMsg(data.error||"Änderung fehlgeschlagen","err");const rows=await refreshProfiles();if(!active&&Number(profile.id)===Number(activeProfile?.id)){const next=rows.find((p)=>p.active&&Number(p.id)!==Number(profile.id));if(next){clearCart();await switchProfile(next.id);}}showMsg(active?"Profil reaktiviert ✓":"Profil archiviert ✓");}catch{showMsg("Änderung fehlgeschlagen","err");}};
  const loadBanner=async(e)=>{const file=e.target.files?.[0];if(!file)return;try{const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});setTheme((t)=>({...t,bannerImageDataUrl:data}));}catch{showMsg("Bannerbild konnte nicht geladen werden","err");}finally{e.target.value="";}};

  const toggleMethod=(id)=>setEnabled((prev)=>{const next={...prev,[id]:!prev[id]};if(!next[id]&&defaultMode===id){const first=PAY_METHODS.map((m)=>m.id).find((m)=>next[m]);if(first)setDefaultMode(first);}return next;});
  const activeCount=Object.values(enabled).filter(Boolean).length;
  const savePayments=async()=>{if(!activeCount||!enabled[defaultMode])return showMsg("Mindestens eine aktive Methode mit aktivem Standard ist nötig","err");try{const res=await apiFetch("/api/settings/payment",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled,default:defaultMode})});const data=await res.json();if(!res.ok)return showMsg(data.error||"Speichern fehlgeschlagen","err");setEnabled(data.enabled);setDefaultMode(data.default);window.dispatchEvent(new CustomEvent("kasse:payment-settings-updated",{detail:data}));showMsg("Zahlungsmethoden gespeichert ✓");}catch{showMsg("Speichern fehlgeschlagen","err");}};
  const changeDataMode=async(mode)=>{const next=setDataMode(mode);setDataModeState(next);await refreshProfiles().catch(()=>{});showMsg(next==="local"?"Lokaler Datenmodus aktiv":"Servermodus aktiv");};
  const exportBackup=()=>{try{const blob=new Blob([exportLocalData()],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`kasse-backup-${new Date().toISOString().slice(0,10)}.json`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);showMsg("Backup exportiert ✓");}catch{showMsg("Backup konnte nicht exportiert werden","err");}};
  const importBackup=async(e)=>{const file=e.target.files?.[0];if(!file)return;try{importLocalData(await file.text());await refreshProfiles();await loadPaymentSettings();showMsg("Backup importiert ✓");}catch{showMsg("Backup konnte nicht importiert werden","err");}finally{e.target.value="";}};
  const resetLocalBackup=async()=>{if(!confirm("Lokale Daten wirklich zurücksetzen?"))return;resetLocalData();await refreshProfiles();await loadPaymentSettings();showMsg("Lokale Daten zurückgesetzt");};
  const saveCloudflareAccess=()=>{setCloudflareAccessConfig({clientId:cfClientId,clientSecret:cfClientSecret});setCfSecretHidden(Boolean(cfClientSecret));showMsg("Cloudflare-Daten gespeichert");};
  const testConnection=async()=>{try{const res=await apiFetch("/api/status");if(!res.ok)throw new Error(`HTTP ${res.status}`);const data=await res.json();showMsg(`Verbindung funktioniert – ${data.profile?.name||"Profil"} ✓`);}catch(e){showMsg(`Server nicht erreichbar: ${e.message||"Verbindungsfehler"}`,"err");}};
  const cfSecretDisplayValue=cfSecretHidden&&cfClientSecret?"••••••••••••••••":cfClientSecret;

  return <div className={styles.page}><div className={styles.card}>
    <h1 className={styles.title}>⚙️ Einstellungen</h1>
    <p className={styles.intro}>Profilwechsel, Design, Zahlungsmethoden und Verbindungseinstellungen.</p>

    <h2 className={styles.sectionTitle}>🏪 Aktives Profil</h2>
    <div className={styles.serverBox}>
      <div className={styles.profileSwitchRow}><label>Profil<select value={activeProfile?.id||""} onChange={(e)=>selectProfile(e.target.value)}>{profiles.filter((p)=>p.active).map((p)=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><span>Der Profilwechsel ist nur hier möglich.</span></div>
      <div className={styles.profileCreateRow}><input value={newProfileName} onChange={(e)=>setNewProfileName(e.target.value)} placeholder="Neues Profil, z.B. Nagelstudio"/><button onClick={createProfile}>+ Profil erstellen</button></div>
      {profiles.some((p)=>!p.active)&&<div className={styles.archiveList}>{profiles.filter((p)=>!p.active).map((p)=><div key={p.id}><span>{p.name}</span><button className={styles.secondaryBtn} onClick={()=>setProfileActive(p,true)}>Reaktivieren</button></div>)}</div>}
    </div>

    {activeProfile&&<><h2 className={styles.sectionTitle}>🎨 Profil und App-Design</h2><div className={styles.serverBox}>
      <label className={styles.profileNameField}>Profilname<input value={profileName} onChange={(e)=>setProfileName(e.target.value)} /></label>
      <label className={styles.profileNameField}>Bannertext<input value={theme.bannerText||""} onChange={(e)=>setTheme({...theme,bannerText:e.target.value})} placeholder="Willkommen im Einkaufsladen"/></label>
      <div className={styles.colorGrid}>{THEME_FIELDS.map(([key,label])=><label key={key}>{label}<span><input type="color" value={theme[key]||DEFAULT_THEME[key]} onChange={(e)=>setTheme({...theme,[key]:e.target.value})}/><code>{theme[key]}</code></span></label>)}</div>
      <div className={styles.bannerEditor}><div className={styles.bannerPreview} style={{backgroundColor:theme.bannerBackground,color:theme.bannerTextColor,backgroundImage:theme.bannerImageDataUrl?`linear-gradient(rgba(0,0,0,.18),rgba(0,0,0,.18)),url(${theme.bannerImageDataUrl})`:"none"}}><strong>{profileName||activeProfile.name}</strong><span>{theme.bannerText}</span></div><div className={styles.serverActions}><button onClick={()=>bannerFileRef.current?.click()}>Bannerbild wählen</button><button className={styles.secondaryBtn} onClick={()=>setTheme({...theme,bannerImageDataUrl:""})}>Bannerbild entfernen</button></div><input ref={bannerFileRef} type="file" accept="image/*" hidden onChange={loadBanner}/></div>
      <div className={styles.serverActions}><button onClick={saveProfile}>Profil und Design speichern</button><button className={styles.secondaryBtn} onClick={()=>setTheme({...DEFAULT_THEME,bannerText:profileName||activeProfile.name})}>Standardfarben</button>{profiles.filter((p)=>p.active).length>1&&<button className={styles.dangerBtn} onClick={()=>setProfileActive(activeProfile,false)}>Profil archivieren</button>}</div>
    </div></>}

    <div className={styles.settingsDivider}/><h2 className={styles.sectionTitle}>💳 Zahlungsmethoden dieses Profils</h2>
    <div className={styles.methodList}>{PAY_METHODS.map((m)=><div key={m.id} className={`${styles.methodRow} ${enabled[m.id]?"":styles.methodOff}`}><div className={styles.methodIcon}>{m.icon}</div><div className={styles.methodInfo}><div className={styles.methodLabel}>{m.label}</div><div className={styles.methodDesc}>{m.desc}</div></div><div className={styles.methodControls}><button className={`${styles.defaultBtn} ${defaultMode===m.id?styles.defaultActive:""}`} onClick={()=>enabled[m.id]&&setDefaultMode(m.id)} disabled={!enabled[m.id]}>{defaultMode===m.id?"★ Standard":"Standard"}</button><button className={`${styles.toggle} ${enabled[m.id]?styles.toggleOn:styles.toggleOff}`} onClick={()=>toggleMethod(m.id)}><span className={styles.toggleKnob}/></button></div></div>)}</div>
    <button className={styles.saveBtn} onClick={savePayments} disabled={!activeCount||loading}>Zahlungsmethoden speichern</button>

    <div className={styles.settingsDivider}/><h2 className={styles.sectionTitle}>💾 Daten speichern</h2><div className={styles.serverBox}><h2>{dataMode==="local"?"📱 Lokal auf diesem Tablet":"🌐 Server / Docker"}</h2><p>Auch im Lokalmodus sind Profile, Produkte, Bons und Guthaben getrennt.</p><div className={styles.modeChoice}><button className={`${styles.modeChoiceBtn} ${dataMode==="local"?styles.modeChoiceActive:""}`} onClick={()=>changeDataMode("local")}>📱 Lokal speichern<span>offline ohne Server</span></button><button className={`${styles.modeChoiceBtn} ${dataMode==="server"?styles.modeChoiceActive:""}`} onClick={()=>changeDataMode("server")}>🌐 Server verwenden<span>Docker/NAS/Cloudflare</span></button></div>{dataMode==="local"&&<div className={styles.localTools}><div className={styles.serverActions}><button onClick={exportBackup}>Backup exportieren</button><button className={styles.secondaryBtn} onClick={()=>importFileRef.current?.click()}>Backup importieren</button><button className={styles.dangerBtn} onClick={resetLocalBackup}>Lokal zurücksetzen</button></div><input ref={importFileRef} type="file" accept="application/json,.json" hidden onChange={importBackup}/></div>}</div>

    {dataMode==="server"&&<><div className={styles.settingsDivider}/><h2 className={styles.sectionTitle}>🔧 Server</h2><div className={styles.serverBox}><h2>🔗 Server-Verbindung</h2><div className={styles.serverRow}><input value={serverUrl} onChange={(e)=>setServerUrl(e.target.value)} placeholder="https://kasse.example.ch oder http://192.168.1.50:3800"/><button onClick={()=>{setApiBase(serverUrl);showMsg("Server-Adresse gespeichert")}}>Speichern</button><button onClick={testConnection}>Test</button></div></div><div className={styles.serverBox}><h2>☁️ Cloudflare Access</h2><div className={styles.tokenGrid}><label>Client ID<input value={cfClientId} onChange={(e)=>setCfClientId(e.target.value)}/></label><label>Client Secret<input value={cfSecretDisplayValue} onFocus={()=>{if(cfSecretHidden){setCfClientSecret("");setCfSecretHidden(false);}}} onChange={(e)=>setCfClientSecret(e.target.value)} type="text"/></label></div><div className={styles.serverActions}><button onClick={saveCloudflareAccess}>Cloudflare-Daten speichern</button><button className={styles.secondaryBtn} onClick={()=>{setCfClientId("");setCfClientSecret("");setCfSecretHidden(false);setCloudflareAccessConfig({});}}>Löschen</button></div></div></>}
    {msg.text&&<div className={`${styles.msg} ${msg.type==="err"?styles.msgErr:styles.msgOk}`}>{msg.text}</div>}
  </div></div>;
}
