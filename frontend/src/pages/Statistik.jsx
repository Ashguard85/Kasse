import React, { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/api";
import styles from "./Statistik.module.css";

function money(value) {
  return `${Number(value || 0).toFixed(2)} CHF`;
}

function dateTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("de-CH", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

function itemLabel(item) {
  const qty = Number(item.quantity || 0);
  const name = item.article_name || "Artikel";
  const total = Number(item.total || 0);
  return `${qty}× ${name}${total > 0 ? ` (${money(total)})` : ""}`;
}

export default function Statistik() {
  const [days, setDays] = useState("30");
  const [data, setData] = useState({ totals: {}, summary: [], sales: [] });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const periodLabel = useMemo(() => {
    if (days === "0") return "alle gespeicherten Verkäufe";
    if (days === "1") return "heute / letzte 24 Stunden";
    return `letzte ${days} Tage`;
  }, [days]);

  const loadStats = async () => {
    setLoading(true);
    setMsg("");
    try {
      const res = await apiFetch(`/api/statistics/sales?days=${encodeURIComponent(days)}`);
      if (!res.ok) throw new Error("Statistik konnte nicht geladen werden");
      setData(await res.json());
    } catch (e) {
      setMsg(e?.message || "Statistik konnte nicht geladen werden");
      setData({ totals: {}, summary: [], sales: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadStats(); }, [days]);

  const totals = data.totals || {};
  const summary = data.summary || [];
  const sales = data.sales || [];

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div>
            <h1>📊 Statistik</h1>
            <p>Welche Artikel wurden in welchen Mengen verkauft — und wann.</p>
          </div>
          <div className={styles.periodBox}>
            <span>Zeitraum</span>
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              <option value="1">Heute / 24h</option>
              <option value="7">7 Tage</option>
              <option value="30">30 Tage</option>
              <option value="90">90 Tage</option>
              <option value="0">Alle</option>
            </select>
          </div>
        </header>

        {msg && <div className={styles.error}>{msg}</div>}

        <section className={styles.kpiGrid}>
          <div className={styles.kpi}><span>Verkäufe</span><strong>{totals.sales_count || 0}</strong></div>
          <div className={styles.kpi}><span>Artikelmenge</span><strong>{totals.article_quantity || 0}</strong></div>
          <div className={styles.kpi}><span>Umsatz</span><strong>{money(totals.revenue)}</strong></div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Artikel nach Menge</h2>
            <p>{periodLabel}</p>
          </div>
          {loading && <div className={styles.empty}>Lade Statistik …</div>}
          {!loading && summary.length === 0 && <div className={styles.empty}>Noch keine Verkäufe in diesem Zeitraum.</div>}
          {!loading && summary.length > 0 && (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Artikel</th>
                    <th>Menge</th>
                    <th>Umsatz</th>
                    <th>Verkäufe</th>
                    <th>Zuletzt verkauft</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row) => (
                    <tr key={`${row.article_id || row.article_name}`}>
                      <td><strong>{row.article_name}</strong></td>
                      <td>{row.quantity}</td>
                      <td>{Number(row.total_amount || 0) > 0 ? money(row.total_amount) : "—"}</td>
                      <td>{row.sales_count}</td>
                      <td>{dateTime(row.last_sold_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2>Verkaufsverlauf</h2>
            <p>Neueste Verkäufe zuerst.</p>
          </div>
          <div className={styles.salesList}>
            {!loading && sales.length === 0 && <div className={styles.empty}>Noch kein Verkaufsverlauf.</div>}
            {sales.map((sale) => (
              <article key={sale.id} className={styles.saleCard}>
                <div className={styles.saleTop}>
                  <div>
                    <strong>{dateTime(sale.created_at)}</strong>
                    <span>{sale.customer_name || "Gelöschter Kunde"}</span>
                  </div>
                  <strong className={styles.saleAmount}>{money(sale.amount)}</strong>
                </div>
                <div className={styles.itemList}>
                  {(sale.items || []).length === 0
                    ? <span>Keine Artikeldetails vorhanden</span>
                    : sale.items.map((item, idx) => <span key={idx}>{itemLabel(item)}</span>)}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
