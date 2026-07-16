"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ORDER, STATUS, PERMKEYS, ADV_LABELS, ADV_PERM } from "@/lib/constants";

const fmt = (n) => "฿" + Math.round(n).toLocaleString("en-US");
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (ts) => { const d = new Date(ts); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };
const initials = (name) => (name || "").replace(/[^A-Za-zก-๙ ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const AV = ["linear-gradient(135deg,#f0378a,#b71e60)", "linear-gradient(135deg,#a855f7,#6d28d9)", "linear-gradient(135deg,#3fd8a4,#0f9d6b)", "linear-gradient(135deg,#f5b544,#d97706)", "linear-gradient(135deg,#60a5fa,#2563eb)"];

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "ph-squares-four", perm: "dashboard" },
  { key: "requests", label: "Reimbursements", icon: "ph-receipt", perm: "requests" },
  { key: "categories", label: "Expense Categories", icon: "ph-tag", perm: "dashboard" },
  { key: "accounts", label: "Accounts", icon: "ph-bank", perm: "accounts" },
  { key: "notifs", label: "Notifications", icon: "ph-bell", perm: "notifications" },
  { key: "users", label: "Users & Roles", icon: "ph-users-three", perm: "*" },
  { key: "docmenu", label: "Document Menu", icon: "ph-files", perm: "*" },
  { key: "audit", label: "Audit Trail", icon: "ph-shield-check", perm: "*" },
  { key: "settings", label: "Settings", icon: "ph-gear", perm: "dashboard" },
];

async function post(url, body) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return r.json();
}

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = loading
  const [data, setData] = useState(null);
  const [screen, setScreen] = useState("dashboard");
  const [detailId, setDetailId] = useState(null);
  const [catId, setCatId] = useState(null);
  const [modal, setModal] = useState(null); // {type, ...}
  const [form, setForm] = useState({});
  const [lang, setLang] = useState("en");
  const [toast, setToast] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [reqFilter, setReqFilter] = useState("all");

  const showToast = useCallback((msg) => { setToast(msg); setTimeout(() => setToast(null), 2800); }, []);

  const refresh = useCallback(async () => {
    const d = await fetch("/api/data").then((r) => r.json());
    if (d.error) { setMe(null); setData(null); return; }
    setMe(d.me); setData(d);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.me) { setMe(d.me); refresh(); } else setMe(null);
    });
  }, [refresh]);

  const perms = me?.role?.perms || [];
  const admin = perms.includes("*");
  const can = (k) => admin || perms.includes(k);

  const rpc = useCallback(async (action, payload, okMsg) => {
    const r = await post("/api/rpc", { action, ...payload });
    if (r.error) { showToast("⚠ " + r.error); return false; }
    await refresh();
    if (okMsg) showToast(okMsg);
    return r;
  }, [refresh, showToast]);

  const go = (s, extra = {}) => { setScreen(s); setDetailId(extra.detailId || null); setCatId(extra.catId || null); setNavOpen(false); };
  const catName = (c) => (lang === "th" ? c.nameTh || c.name : c.name);
  const catAlt = (c) => (lang === "th" ? c.name : c.nameTh);

  if (me === undefined) return <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--dim)" }}>Loading…</div>;
  if (!me) return <Login onLoggedIn={(u) => { setMe(u); refresh(); }} />;
  if (!data) return <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--dim)" }}>Loading…</div>;

  const unread = data.notifs.filter((n) => !n.read).length;
  const navItems = NAV.filter((n) => (n.perm === "*" ? admin : can(n.perm)));
  const titleMap = { dashboard: "Dashboard", requests: "Reimbursements", detail: "Request detail", categories: "Expense Categories", catedit: "Edit category", accounts: "Accounts", users: "Users & Roles", docmenu: "Document Menu", audit: "Audit Trail", notifs: "Notifications", settings: "Settings" };

  const ctx = { me, data, admin, can, lang, catName, catAlt, go, rpc, setModal, setForm, showToast, reqFilter, setReqFilter, detailId, catId, refresh };

  return (
    <div className="app">
      <div className="shell">
        {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
        <aside className={"sidebar" + (navOpen ? " open" : "")}>
          <div className="brand">
            <div className="brand-logo grad"><i className="ph-fill ph-chart-pie-slice" /></div>
            <div><div className="dsp" style={{ fontSize: 17, fontWeight: 800, whiteSpace: "nowrap" }}>WC&#8202;Finance</div><div className="dim" style={{ fontSize: 11, fontWeight: 600 }}>Project Finance</div></div>
          </div>
          <nav className="nav">
            {navItems.map((n) => {
              const badge = n.key === "notifs" ? unread || null : n.key === "requests" ? data.requests.filter((r) => r.status !== "closed").length || null : null;
              const active = screen === n.key || (n.key === "requests" && screen === "detail") || (n.key === "categories" && screen === "catedit");
              return (
                <div key={n.key} className={"navitem" + (active ? " active" : "")} onClick={() => go(n.key)}>
                  <i className={"ph " + n.icon} /><span>{n.label}</span>
                  {badge ? <span className="navbadge">{badge}</span> : null}
                </div>
              );
            })}
          </nav>
          <div className="side-foot">
            <div className="navitem" onClick={async () => { await post("/api/auth/logout"); setMe(null); setData(null); }}><i className="ph ph-sign-out" /><span>Log out</span></div>
          </div>
        </aside>
        <div className="main">
          <header className="topbar">
            <div className="iconbtn menubtn" onClick={() => setNavOpen(true)}><i className="ph ph-list" /></div>
            <div className="crumb"><i className="ph ph-house" /><span>Home</span><i className="ph ph-caret-right" style={{ fontSize: 11 }} /><span style={{ color: "var(--txt)" }}>{titleMap[screen]}</span></div>
            <div style={{ marginLeft: "auto" }} className="fx ac gap12">
              <div className="langtog"><button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button><button className={lang === "th" ? "on" : ""} onClick={() => setLang("th")}>ไทย</button></div>
              <div className="iconbtn" onClick={() => go("notifs")}><i className="ph ph-bell" />{unread > 0 && <span className="dot" />}</div>
              <div className="fx ac gap10" style={{ paddingLeft: 6 }}>
                <div className="avatar grad">{initials(me.name)}</div>
                <div className="userinfo"><div style={{ fontWeight: 800, fontSize: 13.5 }}>{me.name}</div><div className="dim" style={{ fontSize: 11.5, fontWeight: 600 }}>{me.role.name}</div></div>
              </div>
            </div>
          </header>
          <div className="content">
            {screen === "dashboard" && <Dashboard {...ctx} />}
            {screen === "requests" && <Requests {...ctx} />}
            {screen === "detail" && <Detail {...ctx} />}
            {screen === "categories" && <Categories {...ctx} />}
            {screen === "catedit" && <CatEdit {...ctx} />}
            {screen === "accounts" && <Accounts {...ctx} />}
            {screen === "users" && <Users {...ctx} />}
            {screen === "docmenu" && <DocMenu {...ctx} />}
            {screen === "audit" && <AuditTrail {...ctx} />}
            {screen === "notifs" && <Notifs {...ctx} />}
            {screen === "settings" && <Settings {...ctx} />}
          </div>
        </div>
      </div>
      {modal && <Modal ctx={ctx} modal={modal} form={form} setForm={setForm} close={() => { setModal(null); setForm({}); }} />}
      {toast && <div className="toast"><i className="ph ph-check-circle" style={{ color: "var(--green)", fontSize: 20 }} /> {toast}</div>}
    </div>
  );
}

/* ---------- Login ---------- */
function Login({ onLoggedIn }) {
  const [u, setU] = useState(""); const [p, setP] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return; setBusy(true); setError("");
    const r = await post("/api/auth/login", { username: u, password: p });
    setBusy(false);
    if (r.error) setError(r.error); else onLoggedIn(r.me);
  };
  return (
    <div className="app"><div className="login">
      <div className="login-art">
        <div className="brand"><div className="brand-logo grad"><i className="ph-fill ph-chart-pie-slice" /></div><div><div className="dsp" style={{ fontSize: 19, fontWeight: 800 }}>WC&#8202;Finance</div><div className="dim" style={{ fontSize: 12, fontWeight: 600 }}>Project Finance Management</div></div></div>
        <div>
          <div className="tag" style={{ display: "inline-block", marginBottom: 18 }}>คณะเภสัชศาสตร์ · IPSF World Congress 2026</div>
          <h1 className="dsp" style={{ fontSize: 46, fontWeight: 800, margin: 0, lineHeight: 1.05 }}>Track every baht,<br /><span className="gradt">from request to disbursement.</span></h1>
          <p className="muted" style={{ fontSize: 15.5, maxWidth: 440, marginTop: 18, lineHeight: 1.6 }}>Role-based reimbursement, expense categories with document checklists, live account balances and a full audit trail.</p>
        </div>
        <div className="dim" style={{ fontSize: 12.5, fontWeight: 600 }}>Departments → Project Finance → Faculty Finance → Disbursement</div>
      </div>
      <div className="login-form"><div className="login-card">
        <div className="brand" style={{ marginBottom: 26 }}><div className="brand-logo grad"><i className="ph-fill ph-chart-pie-slice" /></div><div className="dsp" style={{ fontSize: 19, fontWeight: 800 }}>WC&#8202;Finance</div></div>
        <h2 className="dsp" style={{ fontSize: 26, fontWeight: 800, margin: "0 0 6px" }}>Sign in</h2>
        <p className="muted" style={{ fontSize: 14, margin: "0 0 24px" }}>Accounts are created by your administrator.</p>
        <div className="field"><label className="label">Username</label><input className="input" value={u} onChange={(e) => setU(e.target.value)} autoCapitalize="none" /></div>
        <div className="field"><label className="label">Password</label><input className="input" type="password" value={p} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
        {error && <div className="err" style={{ marginBottom: 14 }}><i className="ph ph-warning-circle" /> {error}</div>}
        <button className="btn btn-primary grad" style={{ width: "100%" }} onClick={submit} disabled={busy}><i className="ph ph-sign-in" /> {busy ? "Signing in…" : "Sign in"}</button>
      </div></div>
    </div></div>
  );
}

/* ---------- Dashboard ---------- */
function Dashboard({ me, data, can, admin, lang, catName, go, setModal, setForm }) {
  const accts = data.accounts;
  const activeAccts = accts.filter((a) => a.active);
  const totalBal = activeAccts.reduce((s, a) => s + a.balance, 0);
  const inflow = data.txns.filter((t) => t.type === "in").reduce((s, t) => s + t.amount, 0);
  const outflow = data.txns.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const pending = data.requests.filter((r) => r.status !== "closed");
  const showBanks = accts.length > 0;
  const fac = accts.find((a) => a.id === "faculty"), prj = accts.find((a) => a.id === "project");
  const io = (id, type) => data.txns.filter((t) => t.acctId === id && t.type === type).reduce((s, t) => s + t.amount, 0);
  const spend = {};
  data.requests.filter((r) => ["disbursed", "purchase_complete", "closed"].includes(r.status)).forEach((r) => { spend[r.categoryId] = (spend[r.categoryId] || 0) + r.amount; });
  const palette = ["#f0378a", "#a855f7", "#3fd8a4", "#f5b544", "#60a5fa", "#e11d48", "#22d3ee"];
  const ents = Object.entries(spend).map(([cid, amt]) => ({ label: (data.categories.find((c) => c.id === cid) && catName(data.categories.find((c) => c.id === cid))) || cid, amount: amt })).sort((a, b) => b.amount - a.amount);
  const totalSpend = ents.reduce((s, e) => s + e.amount, 0) || 1;

  const bank = (a, proj) => (
    <div className={"bankcard" + (proj ? " proj" : "")} onClick={() => go("accounts")}>
      <div className="bank-top"><div className="bank-ic" style={{ background: proj ? "linear-gradient(135deg,#a855f7,#6d28d9)" : "linear-gradient(135deg,#f0378a,#b71e60)" }}><i className={"ph " + a.icon} /></div><div><div className="bank-l">{a.name}</div><div className="dim th" style={{ fontSize: 12 }}>{a.nameTh}</div></div></div>
      <div><div className="bank-cap">Available balance</div><div className="bank-bal">{fmt(a.balance)}</div></div>
      <div className="bank-io"><div><div className="k">IN</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 14 }}>{fmt(io(a.id, "in"))}</div></div><div><div className="k">OUT</div><div className="mono neg" style={{ fontWeight: 800, fontSize: 14 }}>{fmt(io(a.id, "out"))}</div></div></div>
    </div>
  );

  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Financial <span className="gradt">Overview</span></h1><p className="sub">Money across accounts, reimbursement progress, and disbursement activity.</p></div>
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: data.categories.find((c) => c.active !== false)?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New reimbursement</button>}
    </div>
    {showBanks && fac && prj && (
      <div className="bankgrid">
        {bank(fac, false)}
        <div className="flowarrow"><div className="ring"><i className="ph ph-arrow-right" /></div><span>Advances transferred to project</span></div>
        {bank(prj, true)}
      </div>
    )}
    <div className="stats">
      {showBanks && <div className="stat"><div className="stat-ic" style={{ background: "var(--soft)", color: "var(--accent2)" }}><i className="ph ph-vault" /></div><div className="stat-v mono">{fmt(totalBal)}</div><div className="stat-l">Total available balance</div><div className="stat-s dim">{activeAccts.length} accounts</div></div>}
      {showBanks && <div className="stat"><div className="stat-ic" style={{ background: "rgba(15,157,107,.14)", color: "var(--green)" }}><i className="ph ph-arrow-down-left" /></div><div className="stat-v mono">{fmt(inflow)}</div><div className="stat-l">Total inflow</div><div className="stat-s pos">↑ received</div></div>}
      {showBanks && <div className="stat"><div className="stat-ic" style={{ background: "rgba(225,29,72,.12)", color: "#e11d48" }}><i className="ph ph-arrow-up-right" /></div><div className="stat-v mono">{fmt(outflow)}</div><div className="stat-l">Total outflow</div><div className="stat-s neg">↓ disbursed</div></div>}
      <div className="stat"><div className="stat-ic" style={{ background: "rgba(245,181,68,.14)", color: "var(--amber)" }}><i className="ph ph-hourglass-medium" /></div><div className="stat-v mono">{pending.length}</div><div className="stat-l">Pending reimbursements</div><div className="stat-s dim">{fmt(pending.reduce((s, r) => s + r.amount, 0))} in progress</div></div>
    </div>
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 16 }}><h3 className="panel-t">Reimbursement pipeline</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{data.requests.length} requests</span></div>
        <div className="pipe">{ORDER.map((k) => <div key={k} className="pipe-cell"><div className="pipe-n" style={{ color: k === "disbursed" ? "var(--accent2)" : k === "closed" ? "var(--mut)" : "var(--txt)" }}>{data.requests.filter((r) => r.status === k).length}</div><div className="pipe-l">{lang === "th" ? STATUS[k].th : STATUS[k].label}</div></div>)}</div>
      </div>
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 4 }}>Spending by category</h3>
        <p className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>Disbursed & completed reimbursements</p>
        {ents.length === 0 ? <div className="empty" style={{ padding: 30 }}><i className="ph ph-chart-donut" />No disbursed spending yet.</div> :
          ents.map((e, i) => (
            <div key={e.label} className="fx ac gap10" style={{ padding: "7px 0", fontSize: 13 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: palette[i % palette.length], flex: "0 0 auto" }} />
              <span className="th" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{e.label}</span>
              <span className="mono" style={{ fontWeight: 700 }}>{fmt(e.amount)}</span>
              <span className="dim mono" style={{ width: 38, textAlign: "right" }}>{Math.round((e.amount / totalSpend) * 100)}%</span>
            </div>
          ))}
      </div>
    </div>
    {(data.txns.length > 0) && (
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 8 }}>Recent transactions</h3>
        {data.txns.slice(0, 6).map((t) => <TxnRow key={t.id} t={t} accounts={data.accounts} />)}
      </div>
    )}
  </>);
}

function TxnRow({ t, accounts }) {
  const acc = accounts.find((a) => a.id === t.acctId);
  const isIn = t.type === "in";
  return (
    <div className="fx ac gap12" style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <div className="acct-ic" style={{ width: 34, height: 34, fontSize: 15, background: isIn ? "rgba(15,157,107,.14)" : "rgba(225,29,72,.12)", color: isIn ? "var(--green)" : "#e11d48" }}><i className={"ph " + (isIn ? "ph-arrow-down-left" : "ph-arrow-up-right")} /></div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</div><div className="dim" style={{ fontSize: 11 }}>{acc ? acc.name : t.acctId} · {fmtDate(t.date)}</div></div>
      <div className={"mono " + (isIn ? "pos" : "neg")} style={{ fontWeight: 800, fontSize: 13.5 }}>{(isIn ? "+" : "−") + fmt(t.amount)}</div>
    </div>
  );
}

/* ---------- Requests ---------- */
function Requests({ data, can, lang, catName, catAlt, go, setModal, setForm, reqFilter, setReqFilter }) {
  const list = data.requests.filter((r) => reqFilter === "all" ? true : reqFilter === "active" ? r.status !== "closed" : r.status === reqFilter);
  const filters = [{ k: "all", l: "All" }, { k: "active", l: "In progress" }, { k: "disbursed", l: "Disbursed" }, { k: "closed", l: "Closed" }];
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Reimbursements</h1><p className="sub">Track each request from document submission to fund disbursement.</p></div>
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: data.categories.find((c) => c.active !== false)?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New request</button>}
    </div>
    <div className="seg">{filters.map((f) => <button key={f.k} className={reqFilter === f.k ? "on" : ""} onClick={() => setReqFilter(f.k)}>{f.l}</button>)}</div>
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      {list.length === 0 ? <div className="empty"><i className="ph ph-tray" />No reimbursement requests.</div> : (
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Request</th><th>Category</th><th>Amount</th><th>Status</th><th /></tr></thead><tbody>
          {list.map((r) => {
            const c = data.categories.find((x) => x.id === r.categoryId);
            const st = STATUS[r.status];
            const flagged = (r.docs || []).some((d) => d.disc && d.disc.open);
            return (
              <tr key={r.id} className="trow rowlink" onClick={() => go("detail", { detailId: r.id })}>
                <td><div className="tt">{r.title} {flagged && <i className="ph-fill ph-warning" style={{ color: "var(--amber)", fontSize: 14 }} title="Open discrepancy" />}</div><div className="tsub">{fmtDate(r.createdAt)} · {r.requesterName} · {r.dept}</div></td>
                <td><div style={{ fontWeight: 600 }}>{c ? catName(c) : "—"}</div><div className="tsub th">{c ? catAlt(c) : ""}</div></td>
                <td className="mono" style={{ fontWeight: 800 }}>{fmt(r.amount)}</td>
                <td><span className={"badge st-" + r.status}>{lang === "th" ? st.th : st.label}</span></td>
                <td><i className="ph ph-caret-right dim" /></td>
              </tr>
            );
          })}
        </tbody></table></div>
      )}
    </div>
  </>);
}

/* ---------- Detail ---------- */
function Detail({ me, data, admin, can, lang, catName, catAlt, go, rpc, setModal, setForm, detailId }) {
  const r = data.requests.find((x) => x.id === detailId);
  if (!r) return <div className="empty"><i className="ph ph-tray" />Request not found.</div>;
  const c = data.categories.find((x) => x.id === r.categoryId);
  const st = STATUS[r.status];
  const ci = ORDER.indexOf(r.status);
  const nextKey = ORDER[ci + 1];
  const canAdv = nextKey && (admin || can(ADV_PERM[nextKey]));
  const submitted = r.docs.filter((d) => d.submitted).length;
  const isRequester = r.requesterId === me.id;
  const canOfficer = admin || can("verify");
  const openDisc = r.docs.filter((d) => d.disc && d.disc.open).length;

  return (<>
    <div className="fx ac gap12" style={{ flexWrap: "wrap" }}>
      <button className="iconbtn" onClick={() => go("requests")}><i className="ph ph-arrow-left" /></button>
      <div><h1 className="h1 dsp" style={{ fontSize: 27 }}>{r.title}</h1><div className="dim" style={{ fontSize: 13, marginTop: 4 }}>{r.id} · event {fmtDate(r.eventDate)} · created {fmtDate(r.createdAt)}</div></div>
      <span className={"badge st-" + r.status} style={{ marginLeft: "auto", fontSize: 13, padding: "8px 15px" }}>{lang === "th" ? st.th : st.label}</span>
    </div>
    <div className="panel"><div className="steps">{ORDER.map((k, i) => <div key={k} className={"step" + (i < ci ? " done" : i === ci ? " cur" : "")}><div className="step-d"><i className={"ph " + STATUS[k].icon} /></div><div className="step-l">{lang === "th" ? STATUS[k].th : STATUS[k].label}</div></div>)}</div></div>
    {openDisc > 0 && <div className="attn" style={{ marginBottom: 0 }}><i className="ph-fill ph-warning" style={{ color: "var(--amber)" }} /><span>{openDisc} document{openDisc > 1 ? "s" : ""} flagged with a discrepancy — revision needed.</span></div>}
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 14 }}><h3 className="panel-t">Required documents</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{submitted}/{r.docs.length} submitted</span></div>
        {r.driveFolder && <a className="drive-banner" href={r.driveFolder} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", marginBottom: 14, display: "flex" }}><i className="ph ph-google-drive-logo" /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12.5 }}>Google Drive folder connected</div><div className="dim" style={{ fontSize: 11.5 }}>Submitted documents are stored here</div></div><span className="drive-open">Open folder ↗</span></a>}
        {r.docs.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-files" />No document checklist for this category.</div> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {r.docs.map((d, i) => {
              const disc = d.disc;
              return (
                <div key={i} className={"doc" + (d.submitted ? " on" : "") + (disc && disc.open ? " flagged" : "")}>
                  <div className="chk"><i className="ph ph-check" /></div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <span style={{ fontSize: 13.5 }}>{d.name}</span>
                    {d.fileName && <div className="dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fileName}</div>}
                  </div>
                  <div className="doc-actions">
                    {disc && disc.open && <span className={"disc-tag " + (disc.fixed ? "fixed" : "open")}><i className={"ph " + (disc.fixed ? "ph-arrows-clockwise" : "ph-warning")} />{disc.fixed ? "Revised — recheck" : "Discrepancy"}</span>}
                    {d.submitted && d.link && <a className="doc-view" href={d.link} target="_blank" rel="noreferrer"><i className="ph ph-google-drive-logo" /> View</a>}
                    {!d.submitted && (isRequester || can("create") || admin) && <button className="doc-attach" onClick={() => { setForm({ link: "", fileName: "" }); setModal({ type: "attach", reqId: r.id, idx: i, name: d.name }); }}><i className="ph ph-paperclip" /> Attach</button>}
                    {d.submitted && (isRequester || can("create") || admin) && !(disc && disc.open) && <i className="ph ph-x doc-x" title="Remove" onClick={() => rpc("detachDoc", { id: r.id, idx: i })} />}
                    {canOfficer && d.submitted && !(disc && disc.open) && <button className="doc-attach warn" onClick={() => { setForm({ note: "" }); setModal({ type: "flagDisc", reqId: r.id, idx: i, name: d.name }); }}><i className="ph ph-flag" /> Flag issue</button>}
                  </div>
                  {disc && disc.open && (
                    <div className={"disc-box" + (disc.fixed ? " fixed" : "")}>
                      <div style={{ fontWeight: 800, marginBottom: 3 }}><i className="ph ph-warning" /> Discrepancy — flagged by {disc.by} · {fmtTime(disc.ts)}</div>
                      <div className="muted th">{disc.note || "Please revise this document."}</div>
                      {disc.fixed && <div style={{ marginTop: 6, color: "#0e7490", fontWeight: 700 }}><i className="ph ph-arrows-clockwise" /> Marked as revised{disc.fixedNote ? ": " + disc.fixedNote : ""} — awaiting officer re-check.</div>}
                      <div className="fx gap8" style={{ marginTop: 9, flexWrap: "wrap" }}>
                        {(isRequester || can("create")) && !disc.fixed && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ note: "" }); setModal({ type: "markFixed", reqId: r.id, idx: i, name: d.name }); }}><i className="ph ph-arrows-clockwise" /> I changed the document</button>}
                        {canOfficer && <button className="btn btn-primary grad btn-sm" onClick={() => rpc("resolveDiscrepancy", { id: r.id, idx: i }, "Discrepancy marked solved.")}><i className="ph ph-check" /> Case solved</button>}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 className="panel-t">Details</h3>
        <div><div className="label" style={{ marginBottom: 5 }}>Category</div><div style={{ fontWeight: 700 }}>{c ? catName(c) : "—"}</div><div className="dim th" style={{ fontSize: 13 }}>{c ? catAlt(c) : ""}</div></div>
        <div className="fx gap16">
          <div style={{ flex: 1 }}><div className="label" style={{ marginBottom: 5 }}>Amount</div><div className="mono" style={{ fontWeight: 800, fontSize: 22 }}>{fmt(r.amount)}</div></div>
          <div style={{ flex: 1 }}><div className="label" style={{ marginBottom: 5 }}>Department</div><div style={{ fontWeight: 700 }}>{r.dept}</div></div>
        </div>
        <div><div className="label" style={{ marginBottom: 5 }}>Description</div><div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{r.desc || "Reimbursement request submitted by " + r.requesterName + "."}</div></div>
        {c && c.notes && <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--soft)", border: "1px solid rgba(240,55,138,.2)" }}><div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent2)", marginBottom: 5 }}><i className="ph ph-info" /> Category note</div><div className="muted th" style={{ fontSize: 13, lineHeight: 1.5 }}>{c.notes}</div></div>}
        {r.acctId && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-bank" /> Disbursed from</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{data.accounts.find((a) => a.id === r.acctId)?.name || r.acctId}</div>
            {r.disburseProofLink && <a href={r.disburseProofLink} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "#7cb3ff" }}>View transfer proof ↗</a>}
          </div>
        )}
        {canAdv && nextKey !== "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => rpc("advanceRequest", { id: r.id }, "Status updated.")}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
        {canAdv && nextKey === "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => { const defAcct = data.accounts.find((a) => a.id === c?.defaultAcctId && a.active); setForm({ acctId: defAcct ? defAcct.id : "", proofLink: "" }); setModal({ type: "disburse", reqId: r.id }); }}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
        {!canAdv && nextKey && <div className="dim" style={{ fontSize: 12.5, textAlign: "center", padding: 10, border: "1px dashed var(--line2)", borderRadius: 11, marginTop: "auto" }}>Next step ({ADV_LABELS[nextKey]}) is handled by another role.</div>}
      </div>
    </div>
  </>);
}

/* ---------- Categories ---------- */
function Categories({ data, admin, catName, catAlt, go, setModal, setForm, rpc }) {
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Expense <span className="gradt">Categories</span></h1><p className="sub">Each category defines the required documents for reimbursement.{admin ? " Tap a category to edit its checklist." : ""}</p></div>
      {admin && <button className="btn btn-primary grad" onClick={() => { setForm({}); setModal({ type: "newCategory" }); }}><i className="ph ph-plus" /> New category</button>}
    </div>
    <div className="grid3">
      {data.categories.map((c) => (
        <div key={c.id} className="catcard" style={c.active === false ? { opacity: 0.55 } : {}} onClick={() => admin && go("catedit", { catId: c.id })}>
          <div className="fx ac jb"><div className="acct-ic grad" style={{ width: 40, height: 40, fontSize: 19 }}><i className={"ph " + c.icon} /></div><span className="tag">{c.docs.length} docs</span></div>
          <div><div style={{ fontWeight: 800, fontSize: 15.5 }}>{catName(c)}{c.active === false && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>(closed)</span>}</div><div className="dim th" style={{ fontSize: 13, marginTop: 2 }}>{catAlt(c)}</div></div>
          {c.notes && <div className="dim th" style={{ fontSize: 12, lineHeight: 1.4, borderTop: "1px solid var(--line)", paddingTop: 10 }}><i className="ph ph-info" style={{ color: "var(--accent2)" }} /> {c.notes}</div>}
          {admin && c.active !== false && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); rpc("closeCategory", { id: c.id }, "Category closed."); }}><i className="ph ph-x" /> Close</button>}
        </div>
      ))}
    </div>
  </>);
}

function CatEdit({ data, go, rpc, catId }) {
  const c = data.categories.find((x) => x.id === catId);
  const [note, setNote] = useState(c ? c.notes : "");
  const [draft, setDraft] = useState("");
  if (!c) return null;
  return (<>
    <div className="fx ac gap12"><button className="iconbtn" onClick={() => go("categories")}><i className="ph ph-arrow-left" /></button><div><h1 className="h1 dsp" style={{ fontSize: 27 }}>{c.name}</h1><div className="dim th" style={{ fontSize: 14, marginTop: 3 }}>{c.nameTh}</div></div></div>
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 16 }}><h3 className="panel-t">Required documents</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{c.docs.length} items</span></div>
        {c.docs.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-files" />No documents required yet.</div> :
          <div className="chipwrap">{c.docs.map((d) => <div key={d} className="doc-chip"><span className="th">{d}</span><i className="ph ph-x" onClick={() => rpc("toggleCatDoc", { id: c.id, name: d })} /></div>)}</div>}
        <div style={{ marginTop: 20 }}>
          <label className="label">Category note (thresholds, vendor rules, deadlines…)</label>
          <textarea className="input th" style={{ minHeight: 80, resize: "vertical" }} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => rpc("updateCategoryNotes", { id: c.id, notes: note })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="label">Default source account</label>
          <select className="input" value={c.defaultAcctId || ""} onChange={(e) => rpc("updateCategoryAccount", { id: c.id, defaultAcctId: e.target.value || null })}>
            <option value="">No default — officer picks at disbursement</option>
            {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 6 }}>Add from document menu</h3>
        <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>Master list maintained by admin. Toggle to add or remove.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.masterDocs.map((m) => (
            <div key={m.id} className={"doc clickable" + (c.docs.includes(m.name) ? " on" : "")} onClick={() => rpc("toggleCatDoc", { id: c.id, name: m.name })}>
              <div className="chk"><i className="ph ph-check" /></div><span className="th" style={{ fontSize: 13.5 }}>{m.name}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input className="input" placeholder="Add a custom document…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={async () => { if (await rpc("addCatDoc", { id: c.id, name: draft })) setDraft(""); }}><i className="ph ph-plus" /></button>
        </div>
      </div>
    </div>
  </>);
}

/* ---------- Accounts ---------- */
function Accounts({ data, admin, rpc, setModal, setForm }) {
  const totalSpent = data.txns.filter((t) => t.type === "out").reduce((s, t) => s + t.amount, 0);
  const totalRemaining = data.accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Accounts</h1><p className="sub">Cash inflows and outflows by account, with current available balances.</p></div>
      {admin && <button className="btn btn-primary grad" onClick={() => { setForm({ name: "", nameTh: "", icon: "ph-bank" }); setModal({ type: "newAccount" }); }}><i className="ph ph-plus" /> New account</button>}
    </div>
    <div className="stats">
      <div className="stat"><div className="stat-ic" style={{ background: "rgba(255,107,154,.14)", color: "#ff6b9a" }}><i className="ph ph-arrow-up-right" /></div><div className="stat-v mono">{fmt(totalSpent)}</div><div className="stat-l">Total spent</div><div className="stat-s dim">disbursed reimbursements</div></div>
      <div className="stat"><div className="stat-ic" style={{ background: "var(--soft)", color: "#ff8bb5" }}><i className="ph ph-vault" /></div><div className="stat-v mono">{fmt(totalRemaining)}</div><div className="stat-l">Total remaining</div><div className="stat-s dim">across active accounts</div></div>
    </div>
    <div className="grid2">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.accounts.map((a) => {
          const inf = data.txns.filter((t) => t.acctId === a.id && t.type === "in").reduce((s, t) => s + t.amount, 0);
          const outf = data.txns.filter((t) => t.acctId === a.id && t.type === "out").reduce((s, t) => s + t.amount, 0);
          return (
            <div key={a.id} className="panel" style={a.active ? {} : { opacity: 0.55 }}>
              <div className="fx ac gap14">
                <div className="acct-ic grad" style={{ width: 48, height: 48, fontSize: 23 }}><i className={"ph " + a.icon} /></div>
                <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{a.name}{!a.active && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>(closed)</span>}</div><div className="dim th" style={{ fontSize: 12.5 }}>{a.nameTh}</div></div>
                {admin && a.active && (
                  <div className="fx gap8">
                    <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ acctId: a.id, amount: "", desc: "" }); setModal({ type: "addFunds", acctId: a.id, acctName: a.name }); }}><i className="ph ph-plus" /> Add funds</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rpc("closeAccount", { id: a.id }, "Account closed.")}><i className="ph ph-x" /> Close</button>
                  </div>
                )}
              </div>
              <div className="fx" style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>BALANCE</div><div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{fmt(a.balance)}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>IN</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(inf)}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>OUT</div><div className="mono neg" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(outf)}</div></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="panel"><h3 className="panel-t" style={{ marginBottom: 14 }}>Transactions</h3><div style={{ display: "flex", flexDirection: "column" }}>{data.txns.map((t) => <TxnRow key={t.id} t={t} accounts={data.accounts} />)}</div></div>
    </div>
  </>);
}

/* ---------- Users & Roles ---------- */
function Users({ me, data, rpc, setModal, setForm }) {
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Users &amp; <span className="gradt">Roles</span></h1><p className="sub">Configure access permissions, add or remove roles, and assign a designated contact person to each role.</p></div>
      <div className="fx gap12"><button className="btn btn-ghost" onClick={() => { setForm({ perms: ["dashboard"] }); setModal({ type: "newRole" }); }}><i className="ph ph-plus" /> Add role</button><button className="btn btn-primary grad" onClick={() => { setForm({ roleId: data.roles.find((r) => !(r.perms || []).includes("*"))?.id }); setModal({ type: "newUser" }); }}><i className="ph ph-plus" /> Add user</button></div>
    </div>
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>User</th><th>Role</th><th>Department</th><th>Email notify</th><th /></tr></thead><tbody>
        {data.users.map((u) => (
          <tr key={u.id} className="trow">
            <td><div className="fx ac gap12"><div className="avatar grad" style={{ width: 34, height: 34, fontSize: 12 }}>{initials(u.name)}</div><div><div className="tt">{u.name}</div><div className="tsub">@{u.username}</div></div></div></td>
            <td>{u.role?.name || "—"}</td>
            <td className="muted">{u.dept}</td>
            <td className="muted" style={{ fontSize: 12.5 }}>{u.emailNotify && u.email ? u.email : "off"}</td>
            <td>{u.id !== me.id && <i className="ph ph-trash dim rowlink" style={{ fontSize: 17 }} onClick={() => rpc("deleteUser", { id: u.id }, "User removed.")} />}</td>
          </tr>
        ))}
      </tbody></table></div>
    </div>
    <h3 className="panel-t" style={{ marginTop: 6 }}>Roles</h3>
    <div className="grid3">
      {data.roles.map((r) => (
        <div key={r.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="fx ac jb"><div style={{ fontWeight: 800, fontSize: 15 }}>{r.name}</div>{!r.system && <i className="ph ph-trash dim rowlink" onClick={() => rpc("deleteRole", { id: r.id }, "Role removed.")} />}</div>
          <div className="dim th" style={{ fontSize: 12.5 }}>{r.nameTh}</div>
          <div className="chipwrap">{((r.perms || []).includes("*") ? ["full access"] : r.perms).map((p) => <span key={p} className="doc-chip" style={{ padding: "4px 9px", fontSize: 11.5 }}>{p}</span>)}</div>
          <div className="dim" style={{ fontSize: 12, borderTop: "1px solid var(--line)", paddingTop: 9 }}><i className="ph ph-user-circle" /> Contact: <span style={{ color: "var(--txt)", fontWeight: 600 }}>{r.contact || "—"}</span></div>
        </div>
      ))}
    </div>
  </>);
}

/* ---------- Document menu ---------- */
function DocMenu({ data, rpc }) {
  const [draft, setDraft] = useState("");
  return (<>
    <div className="pagehead"><div><h1 className="h1 dsp">Document <span className="gradt">Menu</span></h1><p className="sub">The master list of required documents — available to attach to any expense category.</p></div></div>
    <div className="panel">
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Add a document to the master menu…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button className="btn btn-primary grad" onClick={async () => { if (await rpc("addMasterDoc", { name: draft }, "Added to document menu.")) setDraft(""); }}><i className="ph ph-plus" /> Add</button>
      </div>
      <div className="chipwrap">{data.masterDocs.map((m) => <div key={m.id} className="doc-chip" style={{ padding: "9px 13px" }}><span className="th">{m.name}</span><i className="ph ph-x" onClick={() => rpc("removeMasterDoc", { name: m.name })} /></div>)}</div>
    </div>
  </>);
}

/* ---------- Audit ---------- */
function AuditTrail({ data }) {
  return (<>
    <div className="pagehead"><div><h1 className="h1 dsp">Audit <span className="gradt">Trail</span></h1><p className="sub">A record of user activity by role. Visible to administrators only.</p></div></div>
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th></tr></thead><tbody>
        {data.audit.map((a) => <tr key={a.id} className="trow"><td className="dim mono" style={{ fontSize: 12.5 }}>{fmtTime(a.ts)}</td><td className="tt">{a.user}</td><td className="muted">{a.role}</td><td className="th">{a.action}</td></tr>)}
      </tbody></table></div>
    </div>
  </>);
}

/* ---------- Notifications ---------- */
function Notifs({ data, rpc }) {
  const meta = {
    notified: { i: "ph-megaphone", c: "var(--amber)", bg: "rgba(245,181,68,.16)" },
    docs_submitted: { i: "ph-files", c: "#0e7490", bg: "rgba(8,145,178,.14)" },
    verified: { i: "ph-seal-check", c: "#7c3aed", bg: "rgba(124,58,237,.14)" },
    disbursed: { i: "ph-hand-coins", c: "var(--accent2)", bg: "var(--soft)" },
    purchase_complete: { i: "ph-shopping-bag", c: "var(--green)", bg: "rgba(15,157,107,.14)" },
    closed: { i: "ph-check-circle", c: "var(--green)", bg: "rgba(15,157,107,.14)" },
    discrepancy: { i: "ph-warning", c: "var(--amber)", bg: "rgba(245,181,68,.16)" },
    fixed: { i: "ph-arrows-clockwise", c: "#0e7490", bg: "rgba(8,145,178,.14)" },
    solved: { i: "ph-check-circle", c: "var(--green)", bg: "rgba(15,157,107,.14)" },
  };
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Notifications</h1><p className="sub">Payment, document and discrepancy status updates.</p></div>
      <button className="btn btn-ghost" onClick={() => rpc("markAllRead", {})}><i className="ph ph-check" /> Mark all read</button>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {data.notifs.length === 0 && <div className="empty"><i className="ph ph-bell" />No notifications yet.</div>}
      {data.notifs.map((n) => {
        const m = meta[n.type] || meta.notified;
        return (
          <div key={n.id} className={"notif" + (n.read ? "" : " unread")}>
            <div className="notif-ic" style={{ background: m.bg, color: m.c }}><i className={"ph " + m.i} /></div>
            <div style={{ flex: 1 }}><div className="th" style={{ fontWeight: 600, fontSize: 14 }}>{n.text}</div><div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{fmtTime(n.ts)}</div></div>
          </div>
        );
      })}
    </div>
  </>);
}

/* ---------- Settings ---------- */
function Settings({ me, data, admin, rpc }) {
  const [email, setEmail] = useState(me.email || "");
  const [notify, setNotify] = useState(!!me.emailNotify);
  const [lastSync, setLastSync] = useState(null);
  const save = (nextNotify, nextEmail) => rpc("updateSettings", { email: nextEmail ?? email, emailNotify: nextNotify ?? notify }, "Settings saved.");
  const runBackup = async () => {
    const r = await rpc("backupToSheets", {}, "Backup synced to Google Sheets.");
    if (r && r.syncedAt) setLastSync(r.syncedAt);
  };
  return (<>
    <div className="pagehead"><div><h1 className="h1 dsp">Settings</h1><p className="sub">Personal preferences for your account.</p></div></div>
    <div className="panel" style={{ maxWidth: 560 }}>
      <h3 className="panel-t" style={{ marginBottom: 16 }}>Email notifications</h3>
      <div className="fx ac jb" style={{ marginBottom: 16 }}>
        <div><div style={{ fontWeight: 700, fontSize: 14 }}>Send me email updates</div><div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>Status changes, discrepancy flags and disbursements for my requests.</div></div>
        <div className={"switch" + (notify ? " on" : "")} onClick={() => { const v = !notify; setNotify(v); save(v); }} />
      </div>
      <div className="field"><label className="label">Email address</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save(undefined, email)} placeholder="you@example.com" /></div>
      <div className="dim" style={{ fontSize: 12 }}>Emails are sent only when the server has SMTP configured; in-app notifications always work.</div>
    </div>
    {admin && (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h3 className="panel-t" style={{ marginBottom: 10 }}>Google Sheets backup</h3>
        <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>Mirrors requests, documents, accounts, transactions and the audit trail into a Google Sheet as a human-readable backup.</p>
        <button className="btn btn-ghost" onClick={runBackup}><i className="ph ph-cloud-arrow-up" /> Backup now</button>
        {lastSync && <div className="dim" style={{ fontSize: 12, marginTop: 10 }}>Last synced: {new Date(lastSync).toLocaleString()}</div>}
      </div>
    )}
    {admin && data.requests.length === 0 && (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h3 className="panel-t" style={{ marginBottom: 10 }}>Demo data</h3>
        <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>Load the sample dataset (demo users, requests, transactions) to explore the system. Only available while the database has no requests.</p>
        <button className="btn btn-ghost" onClick={() => rpc("loadDemoData", {}, "Demo data loaded.")}><i className="ph ph-database" /> Load demo data</button>
      </div>
    )}
  </>);
}

/* ---------- Modal ---------- */
function Modal({ ctx, modal, form, setForm, close }) {
  const { data, rpc, catName } = ctx;
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const titles = { newRequest: "New reimbursement request", newUser: "Add user", newRole: "Add role", newCategory: "New expense category", attach: "Submit document (Google Drive link)", flagDisc: "Flag discrepancy", markFixed: "Document changed", disburse: "Disburse funds", newAccount: "New account", addFunds: "Add funds" };
  const selCat = data.categories.find((c) => c.id === form.categoryId);

  const submit = async () => {
    let ok = false;
    if (modal.type === "newRequest") ok = await rpc("createRequest", form, "Reimbursement submitted.");
    else if (modal.type === "newUser") ok = await rpc("createUser", form, "User added.");
    else if (modal.type === "newRole") ok = await rpc("createRole", form, "Role created.");
    else if (modal.type === "newCategory") ok = await rpc("createCategory", form, "Category created.");
    else if (modal.type === "attach") ok = await rpc("attachDoc", { id: modal.reqId, idx: modal.idx, link: form.link, fileName: form.fileName }, "Document submitted.");
    else if (modal.type === "flagDisc") ok = await rpc("flagDiscrepancy", { id: modal.reqId, idx: modal.idx, note: form.note }, "Discrepancy flagged — requester notified.");
    else if (modal.type === "markFixed") ok = await rpc("markFixed", { id: modal.reqId, idx: modal.idx, note: form.note }, "Officer notified of the change.");
    else if (modal.type === "disburse") ok = await rpc("advanceRequest", { id: modal.reqId, acctId: form.acctId, proofLink: form.proofLink }, "Funds disbursed.");
    else if (modal.type === "newAccount") ok = await rpc("createAccount", form, "Account created.");
    else if (modal.type === "addFunds") ok = await rpc("addFunds", { acctId: modal.acctId, amount: form.amount, desc: form.desc }, "Funds added.");
    if (ok) close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx ac jb" style={{ marginBottom: 20 }}><h3 className="dsp" style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>{titles[modal.type]}</h3><div className="iconbtn" onClick={close}><i className="ph ph-x" /></div></div>

        {modal.type === "newRequest" && (<>
          <div className="field"><label className="label">Title</label><input className="input" value={form.title || ""} onChange={set("title")} placeholder="e.g. Snacks for opening ceremony" /></div>
          <div className="field"><label className="label">Expense category</label><select className="input" value={form.categoryId || ""} onChange={set("categoryId")}>{data.categories.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Event date (when the expense actually happened)</label><input className="input" type="date" value={form.eventDate || ""} onChange={set("eventDate")} /></div>
          <div className="field"><label className="label">Description</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.desc || ""} onChange={set("desc")} placeholder="Purpose of this expense…" /></div>
          {selCat && selCat.docs.length > 0 && <div className="field"><label className="label">Documents required for this category</label><div className="chipwrap">{selCat.docs.map((d) => <span key={d} className="doc-chip th" style={{ padding: "5px 10px", fontSize: 12 }}>{d}</span>)}</div></div>}
        </>)}

        {modal.type === "newUser" && (<>
          <div className="field"><label className="label">Full name</label><input className="input" value={form.name || ""} onChange={set("name")} /></div>
          <div className="fx gap12" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}><label className="label">Username</label><input className="input" value={form.username || ""} onChange={set("username")} autoCapitalize="none" /></div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}><label className="label">Password</label><input className="input" value={form.password || ""} onChange={set("password")} /></div>
          </div>
          <div className="field"><label className="label">Department</label><input className="input" value={form.dept || ""} onChange={set("dept")} /></div>
          <div className="field"><label className="label">Email (optional)</label><input className="input" type="email" value={form.email || ""} onChange={set("email")} /></div>
          <div className="field"><label className="label">Role</label><select className="input" value={form.roleId || ""} onChange={set("roleId")}>{data.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        </>)}

        {modal.type === "newRole" && (<>
          <div className="fx gap12" style={{ flexWrap: "wrap" }}>
            <div className="field" style={{ flex: 1, minWidth: 140 }}><label className="label">Role name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} /></div>
            <div className="field" style={{ flex: 1, minWidth: 140 }}><label className="label">ชื่อบทบาท (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
          </div>
          <div className="field"><label className="label">Designated contact person</label><input className="input" value={form.contact || ""} onChange={set("contact")} /></div>
          <div className="field"><label className="label">Access permissions</label><div className="chipwrap">
            {PERMKEYS.map((k) => {
              const on = (form.perms || []).includes(k);
              return <div key={k} className={"pill-check" + (on ? " on" : "")} onClick={() => setForm({ ...form, perms: on ? form.perms.filter((x) => x !== k) : [...(form.perms || []), k] })}><i className="ph ph-check" style={{ fontSize: 13 }} /> {k}</div>;
            })}
          </div></div>
        </>)}

        {modal.type === "newCategory" && (<>
          <div className="field"><label className="label">Category name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Equipment rental" /></div>
          <div className="field"><label className="label">ชื่อหมวด (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
          <div className="field"><label className="label">Note (optional)</label><textarea className="input th" style={{ minHeight: 60, resize: "vertical" }} value={form.notes || ""} onChange={set("notes")} /></div>
        </>)}

        {modal.type === "attach" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-google-drive-logo" /><span className="th">Submitting — <b>{modal.name}</b></span></div>
          <div className="field"><label className="label">Google Drive link</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://drive.google.com/file/d/…" /></div>
          <div className="field"><label className="label">File name (optional)</label><input className="input" value={form.fileName || ""} onChange={set("fileName")} placeholder="receipt-2026-07.pdf" /></div>
        </>)}

        {modal.type === "flagDisc" && (<>
          <div className="attn"><i className="ph-fill ph-warning" style={{ color: "var(--amber)" }} /><span className="th">{modal.name}</span></div>
          <div className="field"><label className="label">What needs to change?</label><textarea className="input th" style={{ minHeight: 90, resize: "vertical" }} value={form.note || ""} onChange={set("note")} placeholder="e.g. Customer name on the receipt must be the Faculty, not an individual…" /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>The requester will be notified and asked to revise the document.</div>
        </>)}

        {modal.type === "markFixed" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-arrows-clockwise" /><span className="th">Document — <b>{modal.name}</b></span></div>
          <div className="field"><label className="label">What did you change? (optional)</label><textarea className="input th" style={{ minHeight: 70, resize: "vertical" }} value={form.note || ""} onChange={set("note")} placeholder="e.g. Re-issued receipt with the correct customer name." /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>The officer who flagged this will be notified to re-check.</div>
        </>)}

        {modal.type === "disburse" && (<>
          <div className="field"><label className="label">Source account</label><select className="input" value={form.acctId || ""} onChange={set("acctId")}>
            <option value="" disabled>Select an account…</option>
            {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></div>
          <div className="field"><label className="label">Transfer proof link</label><input className="input" value={form.proofLink || ""} onChange={set("proofLink")} placeholder="https://… (bank transfer slip / statement)" /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Funds will be deducted from this account immediately.</div>
        </>)}

        {modal.type === "newAccount" && (<>
          <div className="field"><label className="label">Account name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Department Petty Cash" /></div>
          <div className="field"><label className="label">ชื่อบัญชี (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
        </>)}

        {modal.type === "addFunds" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-bank" /><span>Adding funds to — <b>{modal.acctName}</b></span></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Description</label><input className="input" value={form.desc || ""} onChange={set("desc")} placeholder="e.g. Faculty budget allocation" /></div>
        </>)}

        <button className="btn btn-primary grad" style={{ width: "100%", marginTop: 6 }} onClick={submit} disabled={modal.type === "disburse" && !(form.acctId && (form.proofLink || "").trim())}><i className="ph ph-check" /> {modal.type === "flagDisc" ? "Flag & notify requester" : modal.type === "markFixed" ? "Notify officer" : modal.type === "disburse" ? "Confirm disbursement" : "Submit"}</button>
      </div>
    </div>
  );
}
