import React, { useState, useEffect, useRef } from "react";
import styles from "./Admin.module.css";
import { apiFetch, assetUrl, loadAssetUrl } from "../lib/api";

function priceStr(n) {
  return Number(n).toFixed(2) + " CHF";
}

function AuthImage({ src, alt }) {
  const [resolved, setResolved] = useState(src ? assetUrl(src) : null);

  useEffect(() => {
    let cancelled = false;
    if (!src) {
      setResolved(null);
      return undefined;
    }
    setResolved(assetUrl(src));
    loadAssetUrl(src)
      .then((url) => { if (!cancelled) setResolved(url); })
      .catch(() => { if (!cancelled) setResolved(assetUrl(src)); });
    return () => { cancelled = true; };
  }, [src]);

  if (!resolved) return null;
  return <img src={resolved} alt={alt} />;
}

export default function Admin() {
  const [articles, setArticles] = useState([]);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [editId, setEditId] = useState(null);
  const [msg, setMsg] = useState({ text: "", type: "" });
  const [filter, setFilter] = useState("");
  const fileRef = useRef();
  const msgTimerRef = useRef(null); // Fix #5 (Review 4): verhindert Race Condition bei schnell aufeinanderfolgenden Meldungen

  const fetchArticles = async () => {
    try {
      const res = await apiFetch(`/api/articles?includeHidden=1`);
      if (!res.ok) throw new Error("Server-Fehler");
      setArticles(await res.json());
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  useEffect(() => { fetchArticles(); }, []);
  useEffect(() => () => { if (msgTimerRef.current) clearTimeout(msgTimerRef.current); }, []);

  const showMsg = (text, type = "ok") => {
    if (msgTimerRef.current) clearTimeout(msgTimerRef.current);
    setMsg({ text, type });
    msgTimerRef.current = setTimeout(() => setMsg({ text: "", type: "" }), 3000);
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImage(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!name || !price) return showMsg("Name und Preis sind Pflichtfelder", "err");
    const fd = new FormData();
    fd.append("name", name);
    fd.append("price", price);
    if (image) fd.append("image", image);

    const url = editId ? `/api/articles/${editId}` : `/api/articles`;
    const method = editId ? "PUT" : "POST";
    try {
      const res = await apiFetch(url, { method, body: fd });
      if (res.ok) {
        showMsg(editId ? "Artikel aktualisiert ✓" : "Artikel erstellt ✓");
        resetForm();
        fetchArticles();
      } else {
        const d = await res.json().catch(() => ({}));
        showMsg(d.error || "Fehler beim Speichern", "err");
      }
    } catch (e) {
      showMsg("Server nicht erreichbar", "err");
    }
  };

  const editArticle = (a) => {
    setEditId(a.id);
    setName(a.name);
    setPrice(String(a.price));
    setPreview(a.image ? assetUrl(a.image) : null);
    setImage(null);
  };

  const deleteArticle = async (id) => {
    if (!confirm("Artikel löschen?")) return;
    try {
      const res = await apiFetch(`/api/articles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      fetchArticles();
      if (editId === id) resetForm();
    } catch (e) {
      showMsg("Löschen fehlgeschlagen — Server nicht erreichbar", "err");
    }
  };

  const toggleVisibility = async (article) => {
    try {
      const res = await apiFetch(`/api/articles/${article.id}/visibility`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: article.hidden ? 0 : 1 }),
      });
      if (!res.ok) throw new Error("Server-Fehler");
      showMsg(article.hidden ? "Artikel eingeblendet ✓" : "Artikel ausgeblendet");
      fetchArticles();
    } catch (e) {
      showMsg("Konnte Sichtbarkeit nicht ändern", "err");
    }
  };

  const resetForm = () => {
    setEditId(null);
    setName(""); setPrice(""); setImage(null); setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const filtered = articles.filter((a) =>
    a.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className={styles.page}>
      {/* Form */}
      <div className={styles.formPanel}>
        <h3>{editId ? "Artikel bearbeiten" : "Neuer Artikel"}</h3>

        <div className={styles.imageUpload} onClick={() => fileRef.current.click()}>
          {preview
            ? <img src={preview} alt="Vorschau" />
            : <div className={styles.imagePlaceholder}>📷<span>Bild wählen</span></div>}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} hidden />
        </div>

        <div className={styles.field}>
          <label>Artikelname</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Apfel" />
        </div>

        <div className={styles.field}>
          <label>Preis (CHF)</label>
          <input type="number" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.10" min="0.10" step="0.10" />
        </div>

        <div className={styles.btnRow}>
          <button className={styles.primaryBtn} onClick={save}>
            {editId ? "Speichern" : "Artikel hinzufügen"}
          </button>
          {editId && <button className={styles.cancelBtn} onClick={resetForm}>Abbrechen</button>}
        </div>

        {msg.text && (
          <div className={`${styles.msg} ${msg.type === "err" ? styles.msgErr : styles.msgOk}`}>
            {msg.text}
          </div>
        )}
      </div>

      {/* Article list */}
      <div className={styles.listPanel}>
        <div className={styles.listHeader}>
          <h3>Artikel ({articles.length})</h3>
          <input
            className={styles.search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="🔍 Suchen …"
          />
        </div>
        <div className={styles.list}>
          {filtered.map((a) => (
            <div key={a.id} className={`${styles.row} ${editId === a.id ? styles.rowActive : ""} ${a.hidden ? styles.rowHidden : ""}`}>
              <div className={styles.rowImg}>
                {a.image
                  ? <AuthImage src={a.image} alt={a.name} />
                  : <span>{a.emoji || "🛍️"}</span>}
              </div>
              <div className={styles.rowName}>
                {a.name}
                {a.hidden ? <span className={styles.hiddenTag}>ausgeblendet</span> : null}
              </div>
              <div className={styles.rowPrice}>{priceStr(a.price)}</div>
              <button
                className={styles.eyeBtn}
                onClick={() => toggleVisibility(a)}
                title={a.hidden ? "In der Kasse einblenden" : "In der Kasse ausblenden"}
              >{a.hidden ? "🙈" : "👁️"}</button>
              <button className={styles.editBtn} onClick={() => editArticle(a)}>✏️</button>
              <button className={styles.delBtn} onClick={() => deleteArticle(a.id)}>🗑️</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
