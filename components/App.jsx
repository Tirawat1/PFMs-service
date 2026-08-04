"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ORDER, STATUS, PERMKEYS, ADV_LABELS, ADV_PERM } from "@/lib/constants";
import { isDocEditable } from "@/lib/doc-phase.mjs";
import { parseNotificationRef } from "@/lib/notification-ref.mjs";
import { auditCategory } from "@/lib/audit-category.mjs";

const fmt = (n) => "฿" + Math.round(n).toLocaleString("en-US");
const fmtDate = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const fmtTime = (ts) => { const d = new Date(ts); return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };
const initials = (name) => (name || "").replace(/[^A-Za-zก-๙ ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
const AV = ["linear-gradient(135deg,#f0378a,#b71e60)", "linear-gradient(135deg,#a855f7,#6d28d9)", "linear-gradient(135deg,#3fd8a4,#0f9d6b)", "linear-gradient(135deg,#f5b544,#d97706)", "linear-gradient(135deg,#60a5fa,#2563eb)"];

const NAV = [
  { key: "dashboard", label: "Dashboard", icon: "ph-squares-four", perm: "dashboard" },
  { key: "requests", label: "Reimbursements", icon: "ph-receipt", perm: "requests" },
  { key: "projections", label: "Projected Expenses", icon: "ph-chart-line-up", perm: "requests" },
  { key: "categories", label: "Expense Categories", icon: "ph-tag", perm: "dashboard" },
  { key: "accounts", label: "Accounts", icon: "ph-bank", perm: "accounts" },
  { key: "revenue", label: "Revenue", icon: "ph-trend-up", perm: "accounts" },
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

  const showToast = useCallback((msg, isError) => { setToast({ msg, isError: !!isError }); setTimeout(() => setToast(null), isError ? 5000 : 2800); }, []);

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

  const [busy, setBusy] = useState(false);
  const rpcBusy = useRef(false);

  // Synchronous ref-lock, checked before any await — blocks a second click that
  // lands before the first request's response (and re-render) come back.
  const rpc = useCallback(async (action, payload, okMsg) => {
    if (rpcBusy.current) return false;
    rpcBusy.current = true;
    setBusy(true);
    try {
      const r = await post("/api/rpc", { action, ...payload });
      if (r.error) { showToast(r.error, true); return false; }
      await refresh();
      if (okMsg) showToast(okMsg);
      return r;
    } finally {
      rpcBusy.current = false;
      setBusy(false);
    }
  }, [refresh, showToast]);

  const go = (s, extra = {}) => { setScreen(s); setDetailId(extra.detailId || null); setCatId(extra.catId || null); setNavOpen(false); };
  const catName = (c) => (lang === "th" ? c.nameTh || c.name : c.name);
  const catAlt = (c) => (lang === "th" ? c.name : c.nameTh);

  if (me === undefined) return <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--dim)" }}>Loading…</div>;
  if (!me) return <Login onLoggedIn={(u) => { setMe(u); refresh(); }} />;
  if (!data) return <div className="app" style={{ display: "grid", placeItems: "center", minHeight: "100vh", color: "var(--dim)" }}>Loading…</div>;

  const unread = data.notifs.filter((n) => !n.read).length;
  const navItems = NAV.filter((n) => n.key === "projections"
    ? (admin || can(n.perm) || me.role?.canSeeAdvances)
    : (n.perm === "*" ? admin : can(n.perm)));
  const titleMap = { dashboard: "Dashboard", requests: "Reimbursements", detail: "Request detail", projections: "Projected Expenses", categories: "Expense Categories", catedit: "Edit category", accounts: "Accounts", revenue: "Revenue", users: "Users & Roles", docmenu: "Document Menu", audit: "Audit Trail", notifs: "Notifications", settings: "Settings" };

  const ctx = { me, data, admin, can, lang, catName, catAlt, go, rpc, setModal, setForm, showToast, reqFilter, setReqFilter, detailId, catId, refresh, busy };

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
            {me.role.isMigrationOperator && (
              <div className="mig-banner">
                <i className="ph ph-database" />
                <span>Data-migration mode. This account has full access to every screen and can edit any figure or status directly. Records you create or change here are tagged Migrated.</span>
              </div>
            )}
            {data.undo && (
              <div className="drive-banner" style={{ marginBottom: 14 }}>
                <i className="ph ph-arrow-counter-clockwise" />
                <span style={{ flex: 1 }}>Your last action — {data.undo.action} · <a href="#" onClick={(e) => { e.preventDefault(); rpc("undoLast", {}, "Last action undone."); }} style={{ color: "var(--link)", fontWeight: 700 }}>Undo</a> / <a href="#" onClick={(e) => { e.preventDefault(); rpc("dismissUndo", {}); }} style={{ color: "var(--mut)" }}>Dismiss</a></span>
              </div>
            )}
            {screen === "dashboard" && <Dashboard {...ctx} />}
            {screen === "requests" && <Requests {...ctx} />}
            {screen === "projections" && <Projections {...ctx} />}
            {screen === "detail" && <Detail {...ctx} />}
            {screen === "categories" && <Categories {...ctx} />}
            {screen === "catedit" && <CatEdit {...ctx} />}
            {screen === "accounts" && <Accounts {...ctx} />}
            {screen === "revenue" && <Revenue {...ctx} />}
            {screen === "users" && <Users {...ctx} />}
            {screen === "docmenu" && <DocMenu {...ctx} />}
            {screen === "audit" && <AuditTrail {...ctx} />}
            {screen === "notifs" && <Notifs {...ctx} />}
            {screen === "settings" && <Settings {...ctx} />}
          </div>
        </div>
      </div>
      {modal && <Modal ctx={ctx} modal={modal} form={form} setForm={setForm} close={() => { setModal(null); setForm({}); }} />}
      {toast && <div className="toast">{toast.isError ? <i className="ph ph-warning-circle" style={{ color: "var(--red, #e11d48)", fontSize: 20 }} /> : <i className="ph ph-check-circle" style={{ color: "var(--green)", fontSize: 20 }} />} {toast.msg}</div>}
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
function Dashboard(props) {
  const { me, admin, can } = props;
  const isDeptUser = !admin && !can("verify") && !can("disburse") && !can("accounts");
  return isDeptUser ? <DeptDashboard {...props} /> : <FinDashboard {...props} />;
}

function DeptDashboard({ me, data, can, catName, go, setModal, setForm }) {
  const myProjections = (data.projections || []).filter((p) => p.requesterId === me.id || p.dept === me.dept);
  const myRequests = data.requests.filter((r) => r.requesterId === me.id || r.dept === me.dept);
  const inProgress = myRequests.filter((r) => r.status !== "closed");
  const openProjectedTotal = myProjections.filter((p) => p.status !== "settled").reduce((s, p) => s + p.amount, 0);
  const docsToSubmit = myRequests.reduce((s, r) => s + r.docs.filter((d) => !d.submitted && isDocEditable({ phase: d.phase || "pre", status: r.status })).length, 0);
  const flaggedCount = myRequests.reduce((s, r) => s + r.docs.filter((d) => d.disc && d.disc.open).length, 0);
  const attention = flaggedCount > 0
    ? { icon: "ph-warning", text: flaggedCount + " document" + (flaggedCount > 1 ? "s" : "") + " flagged with a discrepancy — check your reimbursements." }
    : docsToSubmit > 0
    ? { icon: "ph-files", text: "You have " + docsToSubmit + " document" + (docsToSubmit > 1 ? "s" : "") + " to submit." }
    : { icon: "ph-check-circle", text: "You're all caught up — nothing needs action right now." };

  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">My <span className="gradt">Overview</span></h1><p className="sub">Your projected expenses and reimbursements, {me.dept}.</p></div>
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: (data.categories.find((c) => c.active !== false && c.allowDirect) || data.categories.find((c) => c.active !== false))?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New reimbursement</button>}
    </div>
    <div className="attn"><i className={"ph-fill " + attention.icon} style={{ color: flaggedCount > 0 ? "var(--amber)" : "var(--accent2)" }} /><span>{attention.text}</span></div>
    <div className="stats">
      <div className="stat"><div className="stat-ic" style={{ background: "rgba(124,58,237,.14)", color: "#7c3aed" }}><i className="ph ph-chart-line-up" /></div><div className="stat-v mono">{fmt(openProjectedTotal)}</div><div className="stat-l">Projected expenses</div><div className="stat-s dim">{myProjections.length} submitted</div></div>
      <div className="stat"><div className="stat-ic" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}><i className="ph ph-hourglass-medium" /></div><div className="stat-v mono">{fmt(inProgress.reduce((s, r) => s + r.amount, 0))}</div><div className="stat-l">Reimbursements in progress</div><div className="stat-s dim">{inProgress.length} requests</div></div>
      <div className="stat"><div className="stat-ic" style={{ background: "var(--cyan-soft)", color: "var(--cyan)" }}><i className="ph ph-files" /></div><div className="stat-v mono">{docsToSubmit}</div><div className="stat-l">Documents to submit now</div><div className="stat-s dim">across all your requests</div></div>
    </div>
    <div className="panel">
      <div className="fx ac jb" style={{ marginBottom: 14 }}><h3 className="panel-t">My projected expenses</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{myProjections.length}</span></div>
      {myProjections.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-chart-line-up" />No projected expenses yet.</div> : (
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Title</th><th>Amount</th><th>Expected date</th><th>Status</th></tr></thead><tbody>
          {myProjections.map((p) => (
            <tr key={p.id} className="trow"><td><div className="tt">{p.title}</div><div className="tsub">{p.id}</div></td><td className="mono" style={{ fontWeight: 800 }}>{fmt(p.amount)}</td><td className="muted">{fmtDate(p.expectedDate)}</td><td><span className={"badge st-" + p.status}>{PJ_LABEL[p.status] || p.status}</span>{p.status === "rejected" && p.rejectReason && <div className="tsub" style={{ color: "var(--red-deep)", marginTop: 3 }}>{p.rejectReason}</div>}</td></tr>
          ))}
        </tbody></table></div>
      )}
    </div>
    <div className="panel">
      <div className="fx ac jb" style={{ marginBottom: 14 }}><h3 className="panel-t">My reimbursements</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{myRequests.length}</span></div>
      {myRequests.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-tray" />No reimbursement requests yet.</div> : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {myRequests.map((r) => {
            const c = data.categories.find((x) => x.id === r.categoryId);
            const ci = ORDER.indexOf(r.status);
            const pct = Math.round(((ci + 1) / ORDER.length) * 100);
            const pre = r.docs.filter((d) => (d.phase || "pre") === "pre");
            const post = r.docs.filter((d) => d.phase === "post");
            const prePct = pre.length ? Math.round((pre.filter((d) => d.submitted).length / pre.length) * 100) : 100;
            const postPct = post.length ? Math.round((post.filter((d) => d.submitted).length / post.length) * 100) : 100;
            return (
              <div key={r.id} className="panel" style={{ padding: "13px 15px", cursor: "pointer" }} onClick={() => go("detail", { detailId: r.id })}>
                <div className="fx ac jb"><div className="tt">{r.title}</div><span className={"badge st-" + r.status}>{STATUS[r.status].label}</span></div>
                <div className="dim" style={{ fontSize: 12, margin: "3px 0 10px" }}>{r.id} · {fmt(r.amount)}{c ? " · " + catName(c) : ""}</div>
                <div className="dim" style={{ fontSize: 10.5, fontWeight: 800, marginBottom: 3 }}>PIPELINE</div>
                <div style={{ height: 6, borderRadius: 4, background: "var(--line2)", overflow: "hidden", marginBottom: 8 }}><div style={{ width: pct + "%", height: "100%", background: "var(--accent2)" }} /></div>
                <div className="fx gap16">
                  <div style={{ flex: 1 }}><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, marginBottom: 3 }}>DOCS P1</div><div style={{ height: 6, borderRadius: 4, background: "var(--line2)", overflow: "hidden" }}><div style={{ width: prePct + "%", height: "100%", background: "#0e7490" }} /></div></div>
                  <div style={{ flex: 1 }}><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, marginBottom: 3 }}>DOCS P2</div><div style={{ height: 6, borderRadius: 4, background: "var(--line2)", overflow: "hidden" }}><div style={{ width: postPct + "%", height: "100%", background: "var(--green)" }} /></div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  </>);
}

function FinDashboard({ me, data, can, admin, lang, catName, go, setModal, setForm, setReqFilter }) {
  const [dept, setDept] = useState("");
  const accts = data.accounts;
  const activeAccts = accts.filter((a) => a.active);
  const totalBal = activeAccts.reduce((s, a) => s + a.balance, 0);

  const inflow = data.txns.filter((t) => t.type === "in" && !t.internal).reduce((s, t) => s + t.amount, 0);
  const outflow = data.txns.filter((t) => t.type === "out" && !t.internal).reduce((s, t) => s + t.amount, 0);
  const depts = [...new Set(data.requests.map((r) => r.dept).filter(Boolean))].sort();
  const scoped = dept ? data.requests.filter((r) => r.dept === dept) : data.requests;
  const pending = scoped.filter((r) => !["disbursed", "purchase_complete", "closed"].includes(r.status));
  const needsVerify = can("verify") ? data.requests.filter((r) => r.status === "docs_submitted").length : 0;
  const needsDisburse = can("disburse") ? data.requests.filter((r) => r.status === "verified").length : 0;
  const openDiscTotal = data.requests.reduce((s, r) => s + r.docs.filter((d) => d.disc && d.disc.open).length, 0);
  const officerAttention = openDiscTotal > 0
    ? { icon: "ph-warning", text: openDiscTotal + " document" + (openDiscTotal > 1 ? "s" : "") + " flagged with an open discrepancy." }
    : needsVerify + needsDisburse > 0
    ? { icon: "ph-hourglass-medium", text: [needsVerify > 0 && needsVerify + " waiting on verification", needsDisburse > 0 && needsDisburse + " waiting on disbursement"].filter(Boolean).join(" · ") }
    : { icon: "ph-check-circle", text: "You're all caught up — nothing needs action right now." };
  const showBanks = accts.length > 0;
  const fac = accts.find((a) => a.id === "faculty"), prj = accts.find((a) => a.id === "project");
  const io = (id, type) => data.txns.filter((t) => t.acctId === id && t.type === type).reduce((s, t) => s + t.amount, 0);
  const paidAmount = (r) => (r.actualAmount != null ? r.actualAmount : r.amount);
  const spend = {};
  scoped.filter((r) => ["disbursed", "purchase_complete", "closed"].includes(r.status)).forEach((r) => { spend[r.categoryId] = (spend[r.categoryId] || 0) + paidAmount(r); });
  const palette = ["#f0378a", "#a855f7", "#3fd8a4", "#f5b544", "#60a5fa", "#e11d48", "#22d3ee"];
  const ents = Object.entries(spend).map(([cid, amt]) => ({ label: (data.categories.find((c) => c.id === cid) && catName(data.categories.find((c) => c.id === cid))) || cid, amount: amt })).sort((a, b) => b.amount - a.amount);
  const totalSpend = ents.reduce((s, e) => s + e.amount, 0) || 1;
  const purses = (data.streams || []).filter((s) => s.active);
  const pursesTotal = purses.reduce((s, p) => s + p.balance, 0);

  const committed = pending.reduce((s, r) => s + r.amount, 0);
  const spent = data.requests.filter((r) => ["disbursed", "purchase_complete", "closed"].includes(r.status)).reduce((s, r) => s + paidAmount(r), 0);
  const coverageTotal = totalBal + committed + spent || 1;

  const deptSpend = {};
  data.requests.filter((r) => ["disbursed", "purchase_complete", "closed"].includes(r.status)).forEach((r) => { deptSpend[r.dept] = (deptSpend[r.dept] || 0) + paidAmount(r); });
  const deptEnts = Object.entries(deptSpend).map(([d, amt]) => ({ dept: d, amount: amt, count: data.requests.filter((r) => r.dept === d).length })).sort((a, b) => b.amount - a.amount);
  const deptTotal = deptEnts.reduce((s, e) => s + e.amount, 0) || 1;

  const monthKey = (ts) => new Date(ts).toISOString().slice(0, 7);
  const months = [];
  for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i); months.push(d.toISOString().slice(0, 7)); }
  const monthly = {};
  data.txns.filter((t) => t.type === "out").forEach((t) => { const k = monthKey(t.date); monthly[k] = (monthly[k] || 0) + t.amount; });
  const monthlyMax = Math.max(1, ...months.map((m) => monthly[m] || 0));

  const recentActivity = (data.audit || []).slice(0, 8);

  const bank = (a, proj) => (
    <div className={"bankcard" + (proj ? " proj" : "")} onClick={() => go("accounts")}>
      <div className="bank-top"><div className="bank-ic" style={{ background: proj ? "linear-gradient(135deg,var(--purple),var(--purple-deep))" : "linear-gradient(135deg,#f0378a,#b71e60)" }}><i className={"ph " + a.icon} /></div><div><div className="bank-l">{a.name}</div><div className="dim th" style={{ fontSize: 12 }}>{a.nameTh}</div></div></div>
      <div><div className="bank-cap">Available balance</div><div className="bank-bal">{fmt(a.balance)}</div></div>
      <div className="bank-io"><div><div className="k">IN</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 14 }}>{fmt(io(a.id, "in"))}</div></div><div><div className="k">OUT</div><div className="mono neg" style={{ fontWeight: 800, fontSize: 14 }}>{fmt(io(a.id, "out"))}</div></div></div>
    </div>
  );

  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Financial <span className="gradt">Overview</span></h1><p className="sub">Money across accounts, reimbursement progress, and disbursement activity.</p></div>
      <div className="fx ac gap12">
        {depts.length > 1 && <select className="input" style={{ width: "auto" }} value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select>}
        {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: (data.categories.find((c) => c.active !== false && c.allowDirect) || data.categories.find((c) => c.active !== false))?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New reimbursement</button>}
      </div>
    </div>
    {(can("verify") || can("disburse")) && (
      <div className="attn pointer" onClick={() => go("requests")}><i className={"ph-fill " + officerAttention.icon} style={{ color: openDiscTotal > 0 ? "var(--amber)" : "var(--accent2)" }} /><span>{officerAttention.text}</span></div>
    )}
    {showBanks && fac && prj && (
      <div className="bankgrid">
        {bank(fac, false)}
        <div className="flowarrow"><div className="ring"><i className="ph ph-arrow-right" /></div><span>Advances transferred to project</span></div>
        {bank(prj, true)}
      </div>
    )}
    <div className="stats">
      {showBanks && <div className="stat"><div className="stat-ic" style={{ background: "var(--soft)", color: "var(--accent2)" }}><i className="ph ph-vault" /></div><div className="stat-v mono">{fmt(totalBal)}</div><div className="stat-l">Total available balance</div><div className="stat-s dim">{activeAccts.length} accounts</div></div>}
      {showBanks && <div className="stat" style={{ cursor: "pointer" }} onClick={() => go(can("accounts") ? "revenue" : "accounts")}><div className="stat-ic" style={{ background: "rgba(15,157,107,.14)", color: "var(--green)" }}><i className="ph ph-arrow-down-left" /></div><div className="stat-v mono">{fmt(inflow)}</div><div className="stat-l">Total inflow</div><div className="stat-s pos">↑ received</div></div>}
      {showBanks && <div className="stat"><div className="stat-ic" style={{ background: "rgba(225,29,72,.12)", color: "#e11d48" }}><i className="ph ph-arrow-up-right" /></div><div className="stat-v mono">{fmt(outflow)}</div><div className="stat-l">Total outflow</div><div className="stat-s neg">↓ disbursed</div></div>}
      <div className="stat"><div className="stat-ic" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}><i className="ph ph-hourglass-medium" /></div><div className="stat-v mono">{pending.length}</div><div className="stat-l">Pending reimbursements</div><div className="stat-s dim">{fmt(pending.reduce((s, r) => s + r.amount, 0))} in progress</div></div>
    </div>
    {purses.length > 0 && (
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 12 }}>Purses</h3>
        <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 14 }}>
          {purses.map((s, i) => <div key={s.id} style={{ width: (s.balance / (pursesTotal || 1)) * 100 + "%", background: palette[i % palette.length] }} title={s.name} />)}
        </div>
        <div className="fx gap16" style={{ flexWrap: "wrap" }}>
          {purses.map((s, i) => (
            <div key={s.id} className="fx ac gap8" style={{ fontSize: 13 }}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: palette[i % palette.length] }} />
              <span className="th">{s.name}</span><span className="mono dim">{fmt(s.balance)}</span>
            </div>
          ))}
        </div>
      </div>
    )}
    {showBanks && (
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 12 }}>Budget coverage</h3>
        <div style={{ display: "flex", height: 10, borderRadius: 6, overflow: "hidden", marginBottom: 14 }}>
          <div style={{ width: (totalBal / coverageTotal) * 100 + "%", background: "var(--teal)" }} title="Available" />
          <div style={{ width: (committed / coverageTotal) * 100 + "%", background: "var(--gold)" }} title="Committed" />
          <div style={{ width: (spent / coverageTotal) * 100 + "%", background: "#e11d48" }} title="Spent" />
        </div>
        <div className="fx gap16" style={{ flexWrap: "wrap" }}>
          <div className="fx ac gap8" style={{ fontSize: 13 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--teal)" }} /><span className="th">Available</span><span className="mono dim">{fmt(totalBal)}</span></div>
          <div className="fx ac gap8" style={{ fontSize: 13 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--gold)" }} /><span className="th">Committed (pending)</span><span className="mono dim">{fmt(committed)}</span></div>
          <div className="fx ac gap8" style={{ fontSize: 13 }}><span style={{ width: 11, height: 11, borderRadius: 3, background: "#e11d48" }} /><span className="th">Spent</span><span className="mono dim">{fmt(spent)}</span></div>
        </div>
      </div>
    )}
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 16 }}><h3 className="panel-t">Reimbursement pipeline</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{scoped.length} requests</span></div>
        <div className="pipe">{ORDER.map((k) => <div key={k} className="pipe-cell" style={{ cursor: "pointer" }} onClick={() => { setReqFilter(k); go("requests"); }}><div className="pipe-n" style={{ color: k === "disbursed" ? "var(--accent2)" : k === "closed" ? "var(--mut)" : "var(--txt)" }}>{scoped.filter((r) => r.status === k).length}</div><div className="pipe-l">{lang === "th" ? STATUS[k].th : STATUS[k].label}</div></div>)}</div>
      </div>
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 4 }}>Spending by category</h3>
        <p className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>Disbursed & completed reimbursements</p>
        {ents.length === 0 ? <div className="empty" style={{ padding: 30 }}><i className="ph ph-chart-donut" />No disbursed spending yet.</div> :
          ents.map((e, i) => (
            <div key={e.label} className="fx ac gap10" style={{ padding: "7px 0", fontSize: 13, cursor: "pointer" }} onClick={() => go(admin ? "categories" : "requests")}>
              <span style={{ width: 11, height: 11, borderRadius: 3, background: palette[i % palette.length], flex: "0 0 auto" }} />
              <span className="th" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{e.label}</span>
              <span className="mono" style={{ fontWeight: 700 }}>{fmt(e.amount)}</span>
              <span className="dim mono" style={{ width: 38, textAlign: "right" }}>{Math.round((e.amount / totalSpend) * 100)}%</span>
            </div>
          ))}
      </div>
    </div>
    <div className="grid2">
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 4 }}>Spending by department</h3>
        <p className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>Disbursed & completed reimbursements</p>
        {deptEnts.length === 0 ? <div className="empty" style={{ padding: 30 }}><i className="ph ph-buildings" />No disbursed spending yet.</div> : deptEnts.map((e) => (
          <div key={e.dept} style={{ padding: "8px 0" }}>
            <div className="fx ac jb" style={{ fontSize: 13, marginBottom: 4 }}><span className="th">{e.dept}</span><span className="mono" style={{ fontWeight: 700 }}>{fmt(e.amount)}</span></div>
            <div style={{ height: 6, borderRadius: 4, background: "var(--line2)", overflow: "hidden" }}><div style={{ width: (e.amount / deptTotal) * 100 + "%", height: "100%", background: "var(--accent2)" }} /></div>
          </div>
        ))}
      </div>
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 4 }}>Monthly disbursement</h3>
        <p className="dim" style={{ fontSize: 12.5, margin: "0 0 14px" }}>Outflow across all accounts, last 6 months</p>
        <div className="fx" style={{ alignItems: "flex-end", gap: 10, height: 110 }}>
          {months.map((m) => (
            <div key={m} className="fx" style={{ flex: 1, flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div className="mono dim" style={{ fontSize: 10.5 }}>{(monthly[m] || 0) > 0 ? fmt(monthly[m]) : ""}</div>
              <div style={{ width: "100%", height: Math.max(3, ((monthly[m] || 0) / monthlyMax) * 80), borderRadius: 4, background: "var(--accent2)" }} />
              <div className="dim" style={{ fontSize: 10.5 }}>{m.slice(5)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
    {(data.txns.length > 0) && (
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 8 }}>Recent transactions</h3>
        {data.txns.slice(0, 6).map((t) => {
          const ref = parseNotificationRef(t.desc);
          return <div key={t.id} onClick={ref && ref.kind === "request" ? () => go("detail", { detailId: ref.id }) : undefined} style={ref && ref.kind === "request" ? { cursor: "pointer" } : undefined}><TxnRow t={t} accounts={data.accounts} /></div>;
        })}
      </div>
    )}
    {admin && recentActivity.length > 0 && (
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 8 }}>Activity feed</h3>
        {recentActivity.map((a) => (
          <div key={a.id} className="fx ac gap10" style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
            <span className="tag">{auditCategory(a.action)}</span>
            <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.action}</div><div className="dim" style={{ fontSize: 11 }}>{a.user} · {a.role}</div></div>
            <div className="dim mono" style={{ fontSize: 11 }}>{fmtTime(a.ts)}</div>
          </div>
        ))}
      </div>
    )}
  </>);
}

function TxnRow({ t, accounts, onEdit, onDelete }) {
  const acc = accounts.find((a) => a.id === t.acctId);
  const isIn = t.type === "in";
  return (
    <div className="fx ac gap12" style={{ padding: "11px 0", borderTop: "1px solid var(--line)" }}>
      <div className="acct-ic" style={{ width: 34, height: 34, fontSize: 15, background: isIn ? "rgba(15,157,107,.14)" : "rgba(225,29,72,.12)", color: isIn ? "var(--green)" : "#e11d48" }}><i className={"ph " + (isIn ? "ph-arrow-down-left" : "ph-arrow-up-right")} /></div>
      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</div><div className="dim" style={{ fontSize: 11 }}>{acc ? acc.name : t.acctId} · {fmtDate(t.date)}</div></div>
      <div className={"mono " + (isIn ? "pos" : "neg")} style={{ fontWeight: 800, fontSize: 13.5 }}>{(isIn ? "+" : "−") + fmt(t.amount)}</div>
      {onEdit && <button className="btn btn-ghost btn-sm" title="Correct amount" onClick={() => onEdit(t)}><i className="ph ph-pencil-simple" /> Correct</button>}
      {onDelete && <button className="btn btn-ghost btn-sm" title="Delete transaction" onClick={() => onDelete(t)}><i className="ph ph-trash" /> Delete</button>}
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
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: (data.categories.find((c) => c.active !== false && c.allowDirect) || data.categories.find((c) => c.active !== false))?.id, amount: "", eventDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newRequest" }); }}><i className="ph ph-plus" /> New request</button>}
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

/* ---------- Projections ---------- */
const PJ_LABEL = { submitted: "Submitted", advanced: "Advance issued", linked: "Linked to request", settled: "Settled", rejected: "Rejected" };
function Projections({ data, me, admin, can, catName, setModal, setForm, rpc }) {
  const [dept, setDept] = useState("");
  const all = data.projections || [];
  const depts = [...new Set(all.map((p) => p.dept).filter(Boolean))].sort();
  const list = dept ? all.filter((p) => p.dept === dept) : all;
  const canVerify = admin || can("verify");
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Projected <span className="gradt">Expenses</span></h1><p className="sub">Submit an expected cost before spending, and get an advance from Faculty to Project once approved.</p></div>
      {can("create") && <button className="btn btn-primary grad" onClick={() => { setForm({ categoryId: (data.categories.find((c) => c.active !== false && c.allowDirect) || data.categories.find((c) => c.active !== false))?.id, amount: "", expectedDate: new Date().toISOString().slice(0, 10) }); setModal({ type: "newProjection" }); }}><i className="ph ph-plus" /> Submit projection</button>}
    </div>
    {depts.length > 1 && <div className="field" style={{ maxWidth: 260 }}><label className="label">Department</label><select className="input" value={dept} onChange={(e) => setDept(e.target.value)}><option value="">All departments</option>{depts.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>}
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      {list.length === 0 ? <div className="empty"><i className="ph ph-chart-line-up" />No projected expenses yet.</div> : (
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Title</th><th>Department</th><th>Amount</th><th>Expected date</th><th>Status</th><th /></tr></thead><tbody>
          {list.map((p) => {
            const c = data.categories.find((x) => x.id === p.categoryId);
            return (
              <tr key={p.id} className="trow">
                <td><div className="tt">{p.title}</div><div className="tsub">{p.id} · {c ? catName(c) : "—"}</div></td>
                <td className="muted">{p.dept}</td>
                <td className="mono" style={{ fontWeight: 800 }}>{fmt(p.amount)}{admin && <button type="button" className="numedit" title="Correct amount" onClick={() => { setForm({ newValue: p.amount, reason: "" }); setModal({ type: "editNumber", kind: "projection", id: p.id, field: "amount", label: "Amount — " + p.id, orig: p.amount }); }}><i className="ph ph-pencil-simple" /></button>}</td>
                <td className="muted">{fmtDate(p.expectedDate)}</td>
                <td><span className={"badge st-" + p.status}>{PJ_LABEL[p.status] || p.status}</span>{p.status === "rejected" && p.rejectReason && <div className="tsub" style={{ color: "var(--red-deep)", marginTop: 3 }}>{p.rejectReason}</div>}</td>
                <td>
                  {p.status === "submitted" && canVerify && (
                    <div className="fx gap8" style={{ flexWrap: "wrap" }}>
                      <button className="btn btn-primary grad btn-sm" onClick={() => { setForm({ vendorRequired: c?.vendorRequired ?? false }); setModal({ type: "approveAdvance", id: p.id }); }}><i className="ph ph-check" /> Issue advance</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ reason: "" }); setModal({ type: "rejectProjection", id: p.id }); }}><i className="ph ph-x" /> Reject</button>
                    </div>
                  )}
                  {me.role.isMigrationOperator && <select className="input" style={{ marginTop: 6 }} value={p.status} onChange={(e) => rpc("setRecordStatus", { kind: "projection", id: p.id, status: e.target.value }, "Status updated.")}>
                    {["submitted", "advanced", "linked", "settled", "rejected"].map((s) => <option key={s} value={s}>{PJ_LABEL[s]}</option>)}
                  </select>}
                </td>
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
  const [vendor, setVendor] = useState(r ? r.vendor : "");
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
  const proj = r.projectionId ? (data.projections || []).find((p) => p.id === r.projectionId) : null;
  const depositStream = r.depositStreamId ? (data.streams || []).find((s) => s.id === r.depositStreamId) : null;

  return (<>
    <div className="fx ac gap12" style={{ flexWrap: "wrap" }}>
      <button className="iconbtn" onClick={() => go("requests")}><i className="ph ph-arrow-left" /></button>
      <div><h1 className="h1 dsp" style={{ fontSize: 27 }}>{r.title}</h1><div className="dim" style={{ fontSize: 13, marginTop: 4 }}>{r.id} · event {fmtDate(r.eventDate)} · created {fmtDate(r.createdAt)}</div></div>
      {r.directClaim && <span className="mig-tag"><i className="ph ph-lightning" /> Direct claim</span>}
      <span className={"badge st-" + r.status} style={{ marginLeft: "auto", fontSize: 13, padding: "8px 15px" }}>{lang === "th" ? st.th : st.label}</span>
    </div>
    <div className="panel"><div className="steps">{ORDER.map((k, i) => <div key={k} className={"step" + (i < ci ? " done" : i === ci ? " cur" : "")}><div className="step-d"><i className={"ph " + STATUS[k].icon} /></div><div className="step-l">{lang === "th" ? STATUS[k].th : STATUS[k].label}</div></div>)}</div></div>
    {openDisc > 0 && <div className="attn" style={{ marginBottom: 0 }}><i className="ph-fill ph-warning" style={{ color: "var(--amber)" }} /><span>{openDisc} document{openDisc > 1 ? "s" : ""} flagged with a discrepancy — revision needed.</span></div>}
    {r.issueReason && <div className="issue-box" style={{ marginBottom: 0 }}><div className="issue-title"><i className="ph ph-warning-circle" /> Returned for correction</div><div className="muted th" style={{ fontSize: 13, lineHeight: 1.5 }}>{r.issueReason}</div></div>}
    {me.role.isMigrationOperator && (
      <div className="mig-banner">
        <i className="ph ph-database" />
        <div style={{ flex: 1 }}>
          <div>Data-migration override{r.migrated ? " — this record was migrated" : ""}</div>
          <select className="input" style={{ marginTop: 8 }} value={r.status} onChange={(e) => rpc("setRecordStatus", { kind: "request", id: r.id, status: e.target.value }, "Status updated.")}>
            {ORDER.map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}
          </select>
        </div>
      </div>
    )}
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 14 }}><h3 className="panel-t">Required documents</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{submitted}/{r.docs.length} submitted</span></div>
        {r.driveFolder && <a className="drive-banner" href={r.driveFolder} target="_blank" rel="noreferrer" style={{ textDecoration: "none", color: "inherit", marginBottom: 14, display: "flex" }}><i className="ph ph-google-drive-logo" /><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 700, fontSize: 12.5 }}>Google Drive folder connected</div><div className="dim" style={{ fontSize: 11.5 }}>Submitted documents are stored here</div></div><span className="drive-open">Open folder ↗</span></a>}
        {r.docs.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-files" />No document checklist for this category.</div> : (<>
          {[{ phase: "pre", label: "Pre-reimbursement documents", lockHint: "Locked after verification" }, { phase: "post", label: "Closing documents", lockHint: "Available once funds are disbursed" }].map(({ phase, label, lockHint }) => {
            const rows = r.docs.map((d, i) => ({ d, i })).filter(({ d }) => (d.phase || "pre") === phase);
            if (rows.length === 0) return null;
            const locked = !isDocEditable({ phase, status: r.status, admin });
            return (
              <div key={phase} style={{ marginBottom: 16 }}>
                <div className="fx ac gap8" style={{ marginBottom: 9 }}>
                  <span className="label" style={{ margin: 0 }}>{label}</span>
                  {locked && <span className="dim" style={{ fontSize: 11 }}><i className="ph ph-lock-simple" /> {lockHint}</span>}
                  {(admin || can("verify")) && <i className="ph ph-plus-circle chip-act" title="Add a required document" onClick={() => { setForm({ name: "" }); setModal({ type: "addReqDoc", reqId: r.id, phase }); }} />}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {rows.map(({ d, i }) => {
                    const disc = d.disc;
                    const example = c && c.docExamples && c.docExamples[d.name];
                    const editable = isDocEditable({ phase: d.phase || "pre", status: r.status, admin });
                    return (
                      <div key={i} className={"doc" + (d.submitted ? " on" : "") + (disc && disc.open ? " flagged" : "")}>
                        <div className="chk"><i className="ph ph-check" /></div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <span style={{ fontSize: 13.5 }}>{d.name}</span>
                          {d.fileName && <div className="dim" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.fileName}</div>}
                        </div>
                        <div className="doc-actions">
                          {example && <a className="doc-view" href={example.link} target="_blank" rel="noreferrer"><i className="ph ph-lightbulb" /> Example</a>}
                          {disc && disc.open && <span className={"disc-tag " + (disc.fixed ? "fixed" : "open")}><i className={"ph " + (disc.fixed ? "ph-arrows-clockwise" : "ph-warning")} />{disc.fixed ? "Revised — recheck" : "Discrepancy"}</span>}
                          {d.submitted && d.link && <a className="doc-view" href={d.link} target="_blank" rel="noreferrer"><i className="ph ph-google-drive-logo" /> View</a>}
                          {!d.submitted && editable && (isRequester || can("create") || admin) && <button className="doc-attach" onClick={() => { setForm({ link: "", fileName: "" }); setModal({ type: "attach", reqId: r.id, idx: i, name: d.name, driveFolderId: r.driveFolderId }); }}><i className="ph ph-paperclip" /> Attach</button>}
                          {d.submitted && editable && (isRequester || can("create") || admin) && !(disc && disc.open) && <button type="button" className="icon-act doc-x" title="Remove" onClick={() => { if (window.confirm("Remove this submitted document? You'll need to resubmit it.")) rpc("detachDoc", { id: r.id, idx: i }); }}><i className="ph ph-x" /></button>}
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
              </div>
            );
          })}
        </>)}
      </div>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h3 className="panel-t">Details</h3>
        <div><div className="label" style={{ marginBottom: 5 }}>Category</div><div style={{ fontWeight: 700 }}>{c ? catName(c) : "—"}</div><div className="dim th" style={{ fontSize: 13 }}>{c ? catAlt(c) : ""}</div></div>
        <div className="fx gap16">
          <div style={{ flex: 1 }}><div className="label" style={{ marginBottom: 5 }}>Amount</div><div className="mono" style={{ fontWeight: 800, fontSize: 22 }}>{fmt(r.amount)}{admin && <button type="button" className="numedit" title="Correct amount" onClick={() => { setForm({ newValue: r.amount, reason: "" }); setModal({ type: "editNumber", kind: "request", id: r.id, field: "amount", label: "Amount — " + r.id, orig: r.amount }); }}><i className="ph ph-pencil-simple" /></button>}</div></div>
          <div style={{ flex: 1 }}><div className="label" style={{ marginBottom: 5 }}>Department</div><div style={{ fontWeight: 700 }}>{r.dept}</div></div>
        </div>
        <div className="fx gap16">
          <div style={{ flex: 1 }}><div className="label" style={{ marginBottom: 5 }}>Paid via</div><div style={{ fontWeight: 700 }}>{{ finance: "Faculty Finance Officer", purchasing: "Faculty Purchasing Officer", psat: "PSAT" }[r.paidVia] || r.paidVia}</div></div>
        </div>
        <div><div className="label" style={{ marginBottom: 5 }}>Description</div><div className="muted" style={{ fontSize: 14, lineHeight: 1.5 }}>{r.desc || "Reimbursement request submitted by " + r.requesterName + "."}</div></div>
        {c && c.notes && <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--soft)", border: "1px solid rgba(240,55,138,.2)" }}><div style={{ fontSize: 12, fontWeight: 800, color: "var(--accent2)", marginBottom: 5 }}><i className="ph ph-info" /> Category note</div><div className="muted th" style={{ fontSize: 13, lineHeight: 1.5 }}>{c.notes}</div></div>}
        {c && (c.samples || []).length > 0 && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 7 }}><i className="ph ph-lightbulb" /> Sample documents for this category</div>
            {c.samples.map((s, i) => <a key={i} href={s.link} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: 12.5, color: "var(--link)", marginTop: 3 }}>{s.name} ↗</a>)}
          </div>
        )}
        {(isRequester || admin) && r.vendorExists == null && c?.vendorRequired && (
          <div className="issue-box">
            <div className="issue-title">Is the supplier an already-registered vendor?</div>
            <div className="field" style={{ marginBottom: 10 }}><input className="input" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Supplier / vendor name" /></div>
            <div className="fx gap8" style={{ flexWrap: "wrap" }}>
              <button className="btn btn-primary grad btn-sm" onClick={() => rpc("reportVendor", { id: r.id, exists: true, vendor }, "Vendor confirmed.")}><i className="ph ph-check" /> Yes, existing vendor</button>
              <button className="btn btn-ghost btn-sm" onClick={() => rpc("reportVendor", { id: r.id, exists: false, vendor }, "Vendor-registration documents added.")}><i className="ph ph-plus" /> No — register new vendor</button>
            </div>
          </div>
        )}
        {r.vendorExists != null && (
          <div className="dim" style={{ fontSize: 12.5 }}><i className="ph ph-storefront" /> {r.vendorExists ? "Existing registered vendor" : "New vendor — registration documents added to the checklist"}</div>
        )}
        {r.bank && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-bank" /> Receiving account</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.bank.holder} — {r.bank.bank} {r.bank.acctNo}{r.bank.branch ? " (" + r.bank.branch + ")" : ""}</div>
            {r.bank.promptpay && <div className="dim" style={{ fontSize: 12.5 }}>PromptPay: {r.bank.promptpay}</div>}
            {r.bank.note && <div className="dim" style={{ fontSize: 12.5 }}>{r.bank.note}</div>}
          </div>
        )}
        {(isRequester || admin) && r.status !== "closed" && (
          <div className="fx gap8" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ title: r.title, categoryId: r.categoryId, amount: String(r.amount), eventDate: new Date(r.eventDate).toISOString().slice(0, 10), paidVia: r.paidVia, vendor: r.vendor || "", desc: r.desc || "" }); setModal({ type: "editRequest", reqId: r.id }); }}><i className="ph ph-pencil-simple" /> Edit request</button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ holder: r.bank?.holder || "", bank: r.bank?.bank || "", acctNo: r.bank?.acctNo || "", branch: r.bank?.branch || "", promptpay: r.bank?.promptpay || "", note: r.bank?.note || "" }); setModal({ type: "bankInfo", reqId: r.id }); }}><i className="ph ph-bank" /> {r.bank ? "Edit bank info" : "Add bank info"}</button>
          </div>
        )}
        {(admin || can("disburse")) && !r.bank && r.status !== "closed" && (
          <button className="btn btn-ghost btn-sm" onClick={() => rpc("requestBankInfo", { id: r.id }, "Requester notified.")}><i className="ph ph-bell" /> Request bank info</button>
        )}
        {r.acctId && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-bank" /> Disbursed from</div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{data.accounts.find((a) => a.id === r.acctId)?.name || r.acctId}{r.streamId && <span className="dim" style={{ fontWeight: 500 }}> — {data.streams?.find((s) => s.id === r.streamId)?.name || r.streamId}</span>}</div>
            <div className="dim" style={{ fontSize: 12.5 }}>{{ direct: "Direct to supplier", advance: "Settled from advance", selfpay: "Self-pay" + (r.payee ? " — " + r.payee : "") }[r.payRoute] || r.payRoute}{r.actualAmount != null && r.actualAmount !== r.amount && " · Actual paid " + fmt(r.actualAmount)}</div>
            {r.disburseProofLink && <a href={r.disburseProofLink} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: "var(--link)" }}>View transfer proof ↗</a>}
          </div>
        )}
        {(admin || can("disburse")) && (
          <div className="fx gap8" style={{ flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ vendor: r.vendor || "", amount: String(r.amount), link: "", note: "" }); setModal({ type: "issuePO", reqId: r.id }); }}><i className="ph ph-file-text" /> {r.po ? "Re-issue PO" : "Issue PO"}</button>
            {r.payProof ? (
              <a className="btn btn-ghost btn-sm" href={r.payProof.link} target="_blank" rel="noreferrer"><i className="ph ph-receipt" /> View proof of payment</a>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ link: "", ref: "", date: new Date().toISOString().slice(0, 10), note: "" }); setModal({ type: "proofPay", reqId: r.id }); }}><i className="ph ph-receipt" /> Attach proof of payment</button>
            )}
            {!r.depositPaid && r.status !== "closed" && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ amount: "", streamId: data.streams?.[0]?.id || "" }); setModal({ type: "payDeposit", reqId: r.id }); }}><i className="ph ph-coins" /> Pay deposit</button>}
          </div>
        )}
        {admin && r.status === "verified" && !r.fundRoute && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ streamId: data.streams?.[0]?.id || "" }); setModal({ type: "routeFunds", reqId: r.id, reqAmount: r.amount }); }}><i className="ph ph-arrows-left-right" /> Route funds to a purse</button>
        )}
        {r.fundRoute && (
          <div className="dim" style={{ fontSize: 12.5 }}><i className="ph ph-arrows-left-right" /> {fmt(r.fundRoute.amount)} routed to {data.streams?.find((s) => s.id === r.fundRoute.streamId)?.name || r.fundRoute.streamId} by {r.fundRoute.by}</div>
        )}
        {proj && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)", border: "1px solid var(--line2)" }}>
            <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 9 }}><i className="ph ph-chart-line-up" /> Advance — {proj.id}</div>
            <div className="fx" style={{ gap: 16, flexWrap: "wrap" }}>
              <div><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em" }}>PROJECTED</div><div className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{fmt(proj.amount)}</div></div>
              <div><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em" }}>ACTUAL PAID</div><div className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{fmt(r.amount)}</div></div>
              {r.depositPaid && <div><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em" }}>DEPOSIT PAID</div><div className="mono" style={{ fontWeight: 800, fontSize: 15 }}>{fmt(r.depositAmount)}</div>{depositStream && <div className="dim" style={{ fontSize: 11 }}>{depositStream.name}</div>}</div>}
              {r.refundAmount > 0 && <div><div className="dim" style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: ".04em" }}>RETURNED TO FACULTY</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 15 }}>{fmt(r.refundAmount)}</div></div>}
            </div>
          </div>
        )}
        {!r.po && r.status === "verified" && <div className="drive-banner"><i className="ph ph-hourglass-medium" /><span>Verified — the Faculty Purchasing Officer will issue the purchase order and send it to the requester.</span></div>}
        {r.po && (
          <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)" }}>
            <div className="fx ac jb" style={{ marginBottom: 5 }}><div style={{ fontSize: 12, fontWeight: 800 }}><i className="ph ph-file-text" /> Purchase order {r.po.number}</div>{r.po.deliveredToId === me.id && <span className="tag">Issued to you</span>}</div>
            <div style={{ fontSize: 13 }}>{r.po.vendor} — {fmt(r.po.amount)}</div>
            {r.po.link && <a href={r.po.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>View PO ↗</a>}
          </div>
        )}
        {r.payProof && <div style={{ padding: "13px 15px", borderRadius: 12, background: "var(--panel2)" }}><div style={{ fontSize: 12, fontWeight: 800, marginBottom: 5 }}><i className="ph ph-receipt" /> Proof of payment</div><div style={{ fontSize: 13 }}>{r.payProof.ref} — {r.payProof.date}</div><a href={r.payProof.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>View slip ↗</a></div>}
        {r.depositPaid && <div className="drive-banner"><i className="ph ph-coins" /><span>Deposit of {fmt(r.depositAmount)} already paid — only the remaining balance will be deducted at disbursement.</span></div>}
        {canAdv && nextKey !== "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => rpc("advanceRequest", { id: r.id }, "Status updated.")}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
        {canAdv && nextKey === "disbursed" && <button className="btn btn-primary grad" style={{ marginTop: "auto" }} onClick={() => { const defAcct = data.accounts.find((a) => a.id === c?.defaultAcctId && a.active); setForm({ acctId: defAcct ? defAcct.id : "", proofLink: "", route: "direct", payee: "", payNote: "", actualAmount: String(r.amount), streamId: "" }); setModal({ type: "disburse", reqId: r.id, depositPaid: r.depositPaid, depositAmount: r.depositAmount, reqAmount: r.amount, bank: r.bank, driveFolderId: r.driveFolderId }); }}><i className="ph ph-arrow-right" /> {ADV_LABELS[nextKey]}</button>}
        {!canAdv && nextKey && <div className="dim" style={{ fontSize: 12.5, textAlign: "center", padding: 10, border: "1px dashed var(--line2)", borderRadius: 11, marginTop: "auto" }}>Next step ({ADV_LABELS[nextKey]}) is handled by another role.</div>}
        {(admin || can("verify")) && ["docs_submitted", "verified"].includes(r.status) && <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { setForm({ reason: "" }); setModal({ type: "correction", reqId: r.id }); }}><i className="ph ph-arrow-u-up-left" /> Return for correction</button>}
        {ci > 0 && (admin || can(ADV_PERM[r.status])) && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ reason: "" }); setModal({ type: "reverseStep", reqId: r.id, fromLabel: st.label, toLabel: STATUS[ORDER[ci - 1]].label, willRefund: r.status === "disbursed" }); }}><i className="ph ph-arrow-counter-clockwise" /> Reverse to previous step</button>}
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
          <div className="fx ac jb"><div className="acct-ic grad" style={{ width: 40, height: 40, fontSize: 19 }}><i className={"ph " + c.icon} /></div><span className="tag">{c.docsPre.length + c.docsPost.length} docs</span></div>
          <div><div style={{ fontWeight: 800, fontSize: 15.5 }}>{catName(c)}{c.active === false && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>(closed)</span>}</div><div className="dim th" style={{ fontSize: 13, marginTop: 2 }}>{catAlt(c)}</div></div>
          {c.notes && <div className="dim th" style={{ fontSize: 12, lineHeight: 1.4, borderTop: "1px solid var(--line)", paddingTop: 10 }}><i className="ph ph-info" style={{ color: "var(--accent2)" }} /> {c.notes}</div>}
          {admin && c.active !== false && <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); rpc("closeCategory", { id: c.id }, "Category closed."); }}><i className="ph ph-x" /> Close</button>}
          {admin && c.active === false && (
            <div className="fx gap8">
              <button className="btn btn-ghost btn-sm" onClick={(e) => { e.stopPropagation(); rpc("reopenCategory", { id: c.id }, "Category reopened."); }}><i className="ph ph-arrow-counter-clockwise" /> Reopen</button>
              <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); if (window.confirm("Permanently delete \"" + c.name + "\"? This can't be undone.")) rpc("deleteCategory", { id: c.id }, "Category deleted."); }}><i className="ph ph-trash" /> Delete</button>
            </div>
          )}
        </div>
      ))}
    </div>
  </>);
}

function CatEdit({ data, go, rpc, catId }) {
  const c = data.categories.find((x) => x.id === catId);
  const [note, setNote] = useState(c ? c.notes : "");
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState("pre");
  const [exampleDraft, setExampleDraft] = useState({});
  const [sampleName, setSampleName] = useState("");
  const [sampleLink, setSampleLink] = useState("");
  if (!c) return null;
  const list = phase === "post" ? c.docsPost : c.docsPre;
  const examples = c.docExamples || {};
  return (<>
    <div className="fx ac gap12"><button className="iconbtn" onClick={() => go("categories")}><i className="ph ph-arrow-left" /></button><div><h1 className="h1 dsp" style={{ fontSize: 27 }}>{c.name}</h1><div className="dim th" style={{ fontSize: 14, marginTop: 3 }}>{c.nameTh}</div></div></div>
    <div className="grid2">
      <div className="panel">
        <div className="fx ac jb" style={{ marginBottom: 16 }}><h3 className="panel-t">Required documents</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{c.docsPre.length + c.docsPost.length} items</span></div>
        <div className="seg" style={{ marginBottom: 14 }}>
          <button className={phase === "pre" ? "on" : ""} onClick={() => setPhase("pre")}>Pre-reimbursement</button>
          <button className={phase === "post" ? "on" : ""} onClick={() => setPhase("post")}>Closing</button>
        </div>
        {list.length === 0 ? <div className="empty" style={{ padding: 26 }}><i className="ph ph-files" />No documents required yet.</div> :
          <div className="chipwrap">{list.map((d) => (
            <div key={d} className={"doc-chip" + (examples[d] ? " has-ex" : "")}>
              <span className="th">{d}</span>
              {examples[d]
                ? <a className="chip-ex" href={examples[d].link} target="_blank" rel="noreferrer" title={examples[d].name || ""}><i className="ph ph-lightbulb" /> Example</a>
                : <i className="ph ph-lightbulb chip-act" title="Add an example for this document" onClick={() => setExampleDraft({ ...exampleDraft, [d]: exampleDraft[d] === undefined ? "" : undefined })} />}
              {examples[d] && <button type="button" className="icon-act chip-act" title="Remove example" onClick={() => { if (window.confirm("Remove this example for \"" + d + "\"?")) rpc("clearCatDocExample", { id: c.id, name: d }); }}><i className="ph ph-trash" /></button>}
              <button type="button" className="icon-act chip-act" title="Remove document" onClick={() => { if (window.confirm("Remove \"" + d + "\" from this checklist?")) rpc("toggleCatDoc", { id: c.id, name: d, phase }); }}><i className="ph ph-x" /></button>
            </div>
          ))}</div>}
        {Object.keys(exampleDraft).filter((d) => exampleDraft[d] !== undefined && list.includes(d)).map((d) => (
          <div key={d} className="fx gap8" style={{ marginTop: 10 }}>
            <input className="input" placeholder={"Drive link for example — " + d} value={exampleDraft[d] || ""} onChange={(e) => setExampleDraft({ ...exampleDraft, [d]: e.target.value })} />
            <button className="btn btn-ghost btn-sm" onClick={async () => { if (await rpc("setCatDocExample", { id: c.id, name: d, link: exampleDraft[d] })) setExampleDraft({ ...exampleDraft, [d]: undefined }); }}><i className="ph ph-check" /></button>
          </div>
        ))}
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
        <div className="fx ac jb" style={{ marginTop: 16 }}>
          <div><div style={{ fontWeight: 700, fontSize: 14 }}>Allow direct reimbursement</div><div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>Departments may submit this category without a projected expense.</div></div>
          <div className={"switch" + (c.allowDirect ? " on" : "")} onClick={() => rpc("toggleCategoryDirect", { id: c.id })} />
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="label">Default paid via</label>
          <select className="input" value={c.defaultPaidVia} onChange={(e) => rpc("updateCategoryPaymentRouting", { id: c.id, defaultPaidVia: e.target.value, approverRole: c.approverRole })}>
            <option value="finance">Faculty Finance Officer</option>
            <option value="purchasing">Faculty Purchasing Officer</option>
            <option value="psat">PSAT</option>
          </select>
        </div>
        <div style={{ marginTop: 16 }}>
          <label className="label">Approver track</label>
          <select className="input" value={c.approverRole} onChange={(e) => rpc("updateCategoryPaymentRouting", { id: c.id, defaultPaidVia: c.defaultPaidVia, approverRole: e.target.value })}>
            <option value="faculty_finance">Faculty Finance</option>
            <option value="faculty_purchasing">Faculty Purchasing</option>
          </select>
        </div>
        <div className="fx ac jb" style={{ marginTop: 16 }}>
          <div><div style={{ fontWeight: 700, fontSize: 14 }}>Vendor required</div><div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>This category always involves an external supplier — vendor name must be given at submission.</div></div>
          <div className={"switch" + (c.vendorRequired ? " on" : "")} onClick={() => rpc("toggleCategoryVendorRequired", { id: c.id })} />
        </div>
        <div style={{ marginTop: 20 }}>
          <div className="fx ac jb" style={{ marginBottom: 10 }}><label className="label" style={{ margin: 0 }}>Sample documents</label><span className="dim" style={{ fontSize: 12 }}>{(c.samples || []).length}</span></div>
          <p className="dim" style={{ fontSize: 12.5, margin: "0 0 10px" }}>Reference files shown on every request in this category — "here's what a correct submission looks like."</p>
          {(c.samples || []).map((s, i) => (
            <div key={i} className="fx ac gap8" style={{ padding: "6px 0" }}>
              <a href={s.link} target="_blank" rel="noreferrer" className="th" style={{ flex: 1, fontSize: 13, color: "var(--link)" }}>{s.name}</a>
              <button type="button" className="icon-act chip-act" title="Remove sample" onClick={() => { if (window.confirm("Remove this sample document?")) rpc("removeCategorySample", { id: c.id, idx: i }); }}><i className="ph ph-trash" /></button>
            </div>
          ))}
          <div className="fx gap8" style={{ marginTop: 8 }}>
            <input className="input" placeholder="Sample name" value={sampleName} onChange={(e) => setSampleName(e.target.value)} style={{ flex: 1 }} />
            <input className="input" placeholder="Drive link" value={sampleLink} onChange={(e) => setSampleLink(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={async () => { if (await rpc("addCategorySample", { id: c.id, name: sampleName, link: sampleLink })) { setSampleName(""); setSampleLink(""); } }}><i className="ph ph-plus" /></button>
          </div>
        </div>
      </div>
      <div className="panel">
        <h3 className="panel-t" style={{ marginBottom: 6 }}>Add from document menu</h3>
        <p className="dim" style={{ fontSize: 13, margin: "0 0 14px" }}>Master list maintained by admin. Toggle to add or remove — applies to the "{phase === "post" ? "Closing" : "Pre-reimbursement"}" phase selected on the left.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.masterDocs.map((m) => (
            <div key={m.id} className={"doc clickable" + (list.includes(m.name) ? " on" : "")} onClick={() => rpc("toggleCatDoc", { id: c.id, name: m.name, phase })}>
              <div className="chk"><i className="ph ph-check" /></div><span className="th" style={{ fontSize: 13.5 }}>{m.name}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <input className="input" placeholder="Add a custom document…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-ghost btn-sm" onClick={async () => { if (await rpc("addCatDoc", { id: c.id, name: draft, phase })) setDraft(""); }}><i className="ph ph-plus" /></button>
        </div>
      </div>
    </div>
  </>);
}

/* ---------- Accounts ---------- */
function Accounts({ data, admin, rpc, setModal, setForm }) {
  const [txnSearch, setTxnSearch] = useState("");
  const totalSpent = data.txns.filter((t) => t.type === "out" && !t.internal).reduce((s, t) => s + t.amount, 0);
  const totalRemaining = data.accounts.filter((a) => a.active).reduce((s, a) => s + a.balance, 0);
  const matchesSearch = (t) => {
    const q = txnSearch.trim().toLowerCase();
    if (!q) return true;
    const acc = data.accounts.find((a) => a.id === t.acctId);
    return t.desc.toLowerCase().includes(q) || (acc && acc.name.toLowerCase().includes(q));
  };
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Accounts</h1><p className="sub">Cash inflows and outflows by account, with current available balances.</p></div>
      {admin && <button className="btn btn-primary grad" onClick={() => { setForm({ name: "", nameTh: "", icon: "ph-bank" }); setModal({ type: "newAccount" }); }}><i className="ph ph-plus" /> New account</button>}
    </div>
    <div className="stats">
      <div className="stat"><div className="stat-ic" style={{ background: "var(--rose-soft)", color: "var(--rose)" }}><i className="ph ph-arrow-up-right" /></div><div className="stat-v mono">{fmt(totalSpent)}</div><div className="stat-l">Total spent</div><div className="stat-s dim">disbursed reimbursements</div></div>
      <div className="stat"><div className="stat-ic" style={{ background: "var(--soft)", color: "var(--rose-light)" }}><i className="ph ph-vault" /></div><div className="stat-v mono">{fmt(totalRemaining)}</div><div className="stat-l">Total remaining</div><div className="stat-s dim">across active accounts</div></div>
    </div>
    <div className="grid2">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {data.accounts.map((a) => {
          const inf = data.txns.filter((t) => t.acctId === a.id && t.type === "in").reduce((s, t) => s + t.amount, 0);
          const outf = data.txns.filter((t) => t.acctId === a.id && t.type === "out").reduce((s, t) => s + t.amount, 0);
          return (
            <div key={a.id} className="panel" style={a.active ? {} : { opacity: 0.55 }}>
              <div className="fx ac gap14" style={{ flexWrap: "wrap" }}>
                <div className="acct-ic grad" style={{ width: 48, height: 48, fontSize: 23 }}><i className={"ph " + a.icon} /></div>
                <div style={{ flex: 1, minWidth: 140 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{a.name}{!a.active && <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>(closed)</span>}</div><div className="dim th" style={{ fontSize: 12.5 }}>{a.nameTh}</div></div>
                {admin && a.active && (
                  <div className="fx gap8" style={{ flexWrap: "wrap" }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ acctId: a.id, amount: "", desc: "" }); setModal({ type: "addFunds", acctId: a.id, acctName: a.name }); }}><i className="ph ph-plus" /> Add funds</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ acctId: a.id, amount: "", desc: "" }); setModal({ type: "withdrawFunds", acctId: a.id, acctName: a.name }); }}><i className="ph ph-minus" /> Withdraw funds</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => rpc("closeAccount", { id: a.id }, "Account closed.")}><i className="ph ph-x" /> Close</button>
                  </div>
                )}
                {admin && !a.active && (
                  <div className="fx gap8">
                    <button className="btn btn-ghost btn-sm" onClick={() => rpc("reopenAccount", { id: a.id }, "Account reopened.")}><i className="ph ph-arrow-counter-clockwise" /> Reopen</button>
                  </div>
                )}
              </div>
              <div className="fx" style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 120, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>BALANCE</div><div className="mono" style={{ fontWeight: 800, fontSize: 20 }}>{fmt(a.balance)}{admin && <button type="button" className="numedit" title="Correct balance" onClick={() => { setForm({ newValue: a.balance, reason: "" }); setModal({ type: "editNumber", kind: "account", id: a.id, field: "balance", label: "Balance — " + a.name, orig: a.balance }); }}><i className="ph ph-pencil-simple" /></button>}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>IN</div><div className="mono pos" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(inf)}</div></div>
                <div style={{ flex: 1, minWidth: 100, background: "var(--panel2)", borderRadius: 12, padding: "12px 14px" }}><div className="dim" style={{ fontSize: 11.5, fontWeight: 700 }}>OUT</div><div className="mono neg" style={{ fontWeight: 800, fontSize: 16 }}>{fmt(outf)}</div></div>
              </div>
              {(() => {
                const purses = data.streams.filter((s) => s.acctId === a.id);
                if (!admin && purses.length === 0) return null;
                return (
                  <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
                    <div className="fx ac jb" style={{ marginBottom: 10 }}>
                      <div className="fx ac gap8"><span className="label" style={{ margin: 0 }}>Purses</span>{purses.length > 0 && <span className="dim" style={{ fontSize: 12, fontWeight: 700 }}>{purses.length}</span>}</div>
                      {admin && <button className="btn btn-ghost btn-sm" onClick={() => { setForm({ name: "", nameTh: "", color: "#f0378a", acctId: a.id }); setModal({ type: "newPurse" }); }}><i className="ph ph-plus" /> New purse</button>}
                    </div>
                    {purses.length > 0 ? (
                      <div className="fx gap8" style={{ flexWrap: "wrap" }}>
                        {purses.map((s) => (
                          <div key={s.id} className="purse">
                            <span className="purse-dot" style={{ background: s.color }} />
                            <span style={{ fontWeight: 700 }}>{s.name}</span>
                            <span className="mono dim" style={{ fontWeight: 800 }}>{fmt(s.balance)}{admin && <button type="button" className="numedit" title="Correct balance" onClick={() => { setForm({ newValue: s.balance, reason: "" }); setModal({ type: "editNumber", kind: "stream", id: s.id, field: "balance", label: "Purse — " + s.name, orig: s.balance }); }}><i className="ph ph-pencil-simple" /></button>}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="dim" style={{ fontSize: 12.5 }}>No purses yet.</div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="field" style={{ margin: 0 }}>
          <input className="input" value={txnSearch} onChange={(e) => setTxnSearch(e.target.value)} placeholder="Search by description or account…" />
        </div>
        {[{ label: "Deposits", type: "in" }, { label: "Withdrawals", type: "out" }].map(({ label, type }) => {
          const rows = data.txns.filter((t) => t.type === type && matchesSearch(t));
          return (
            <div key={type} className="panel">
              <div className="fx ac jb" style={{ marginBottom: 14 }}><h3 className="panel-t">{label}</h3><span className="dim" style={{ fontSize: 12.5, fontWeight: 700 }}>{rows.length}</span></div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {rows.length === 0 ? <div className="empty" style={{ padding: 20 }}><i className={"ph " + (type === "in" ? "ph-arrow-down-left" : "ph-arrow-up-right")} />No {label.toLowerCase()}{txnSearch.trim() ? " match your search." : " yet."}</div> :
                  rows.map((t) => <TxnRow key={t.id} t={t} accounts={data.accounts} onEdit={admin ? (txn) => { setForm({ amount: txn.amount, reason: "" }); setModal({ type: "editTxn", txnId: txn.id, txnDesc: txn.desc, oldAmount: txn.amount }); } : null} onDelete={admin ? (txn) => { setForm({ reason: "" }); setModal({ type: "deleteTxn", txnId: txn.id, txnDesc: txn.desc, txnAmount: txn.amount }); } : null} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  </>);
}

/* ---------- Revenue ---------- */
const RV_LABEL = { projected: "Projected", received: "Received" };
function Revenue({ data, me, admin, can, setModal, setForm, rpc }) {
  const list = data.revenues || [];
  const canManage = admin || can("accounts");
  const streamName = (id) => (data.streams || []).find((s) => s.id === id)?.name || "—";
  return (<>
    <div className="pagehead">
      <div><h1 className="h1 dsp">Projected <span className="gradt">Revenue</span></h1><p className="sub">Who is paying us, how much, when — and which purse each payment goes into.</p></div>
      {canManage && <button className="btn btn-primary grad" onClick={() => { setForm({ title: "", source: "", amount: "", expectedDate: new Date().toISOString().slice(0, 10), streamId: data.streams?.[0]?.id || "" }); setModal({ type: "newRevenue" }); }}><i className="ph ph-plus" /> Projected revenue</button>}
    </div>
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      {list.length === 0 ? <div className="empty"><i className="ph ph-trend-up" />No projected revenue yet.</div> : (
        <div className="tblwrap"><table className="tbl"><thead><tr><th>Title</th><th>Source</th><th>Purse</th><th>Amount</th><th>Expected date</th><th>Status</th><th /></tr></thead><tbody>
          {list.map((rv) => (
            <tr key={rv.id} className="trow">
              <td><div className="tt">{rv.title}</div><div className="tsub">{rv.id}</div></td>
              <td className="muted">{rv.source || "—"}</td>
              <td className="muted">{rv.streamId ? streamName(rv.streamId) : "—"}</td>
              <td className="mono" style={{ fontWeight: 800 }}>{fmt(rv.amount)}{admin && <button type="button" className="numedit" title="Correct amount" onClick={() => { setForm({ newValue: rv.amount, reason: "" }); setModal({ type: "editNumber", kind: "revenue", id: rv.id, field: "amount", label: "Amount — " + rv.id, orig: rv.amount }); }}><i className="ph ph-pencil-simple" /></button>}</td>
              <td className="muted">{fmtDate(rv.expectedDate)}</td>
              <td><span className={"badge " + (rv.status === "received" ? "st-closed" : "st-notified")}>{RV_LABEL[rv.status] || rv.status}</span></td>
              <td>
                {rv.status === "projected" && canManage && <button className="btn btn-primary grad btn-sm" onClick={() => rpc("receiveRevenue", { id: rv.id }, "Revenue received.")}><i className="ph ph-check" /> Mark received</button>}
                {me.role.isMigrationOperator && <select className="input" style={{ marginTop: 6 }} value={rv.status} onChange={(e) => rpc("setRecordStatus", { kind: "revenue", id: rv.id, status: e.target.value }, "Status updated.")}>
                  {["projected", "received"].map((s) => <option key={s} value={s}>{RV_LABEL[s]}</option>)}
                </select>}
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </div>
  </>);
}

/* ---------- Users & Roles ---------- */
function Users({ me, admin, data, rpc, setModal, setForm }) {
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
            <td>{u.id !== me.id && <button type="button" className="icon-act dim" style={{ fontSize: 17 }} title="Remove user" onClick={() => { if (window.confirm("Remove user \"" + u.name + "\"? They will lose access immediately.")) rpc("deleteUser", { id: u.id }, "User removed."); }}><i className="ph ph-trash" /></button>}</td>
          </tr>
        ))}
      </tbody></table></div>
    </div>
    <h3 className="panel-t" style={{ marginTop: 6 }}>Roles</h3>
    <div className="grid3">
      {data.roles.map((r) => (
        <div key={r.id} className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="fx ac jb"><div style={{ fontWeight: 800, fontSize: 15 }}>{r.name}</div>{!r.system && <button type="button" className="icon-act dim" title="Remove role" onClick={() => { if (window.confirm("Remove role \"" + r.name + "\"? Anyone assigned it will lose these permissions.")) rpc("deleteRole", { id: r.id }, "Role removed."); }}><i className="ph ph-trash" /></button>}</div>
          <div className="dim th" style={{ fontSize: 12.5 }}>{r.nameTh}</div>
          <div className="chipwrap">{((r.perms || []).includes("*") ? ["full access"] : r.perms).map((p) => <span key={p} className="doc-chip" style={{ padding: "4px 9px", fontSize: 11.5 }}>{p}</span>)}</div>
          <span className="mig-chip pointer" style={admin ? {} : { opacity: 0.6, cursor: "default" }} onClick={() => admin && rpc("toggleRoleAdvDash", { id: r.id })}><i className={r.canSeeAdvances ? "ph-fill ph-chart-line-up" : "ph ph-chart-line-up"} /> Sees Projected Expenses: {r.canSeeAdvances ? "on" : "off"}</span>
          {admin
            ? <select className="input" style={{ padding: "6px 10px", fontSize: 12.5 }} value={r.approverKey || ""} onChange={(e) => rpc("updateRoleApproverKey", { id: r.id, approverKey: e.target.value || null })}>
                <option value="">No approver track</option>
                <option value="faculty_finance">Faculty Finance approver</option>
                <option value="faculty_purchasing">Faculty Purchasing approver</option>
              </select>
            : <span className="dim" style={{ fontSize: 11.5 }}>{r.approverKey ? "Approver: " + r.approverKey : "No approver track"}</span>}
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
      <div className="chipwrap">{data.masterDocs.map((m) => (
        <div key={m.id} className={"doc-chip" + (m.vendorDoc ? " has-ex" : "")} style={{ padding: "9px 13px" }}>
          <span className="th">{m.name}</span>
          <span className="chip-act" title="Vendor doc" onClick={() => rpc("toggleMasterDocVendor", { id: m.id })}><i className={m.vendorDoc ? "ph-fill ph-storefront" : "ph ph-storefront"} /></span>
          <button type="button" className="icon-act" title="Remove from master list" onClick={() => { if (window.confirm("Remove \"" + m.name + "\" from the master document list? Categories already using it keep it on their checklist.")) rpc("removeMasterDoc", { name: m.name }); }}><i className="ph ph-x" /></button>
        </div>
      ))}</div>
    </div>
  </>);
}

/* ---------- Audit ---------- */
function AuditTrail({ data }) {
  const [user, setUser] = useState("");
  const [role, setRole] = useState("");
  const [cat, setCat] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const tagged = useMemo(() => data.audit.map((a) => ({ ...a, cat: auditCategory(a.action) })), [data.audit]);
  const users = useMemo(() => [...new Set(data.audit.map((a) => a.user))].sort(), [data.audit]);
  const roles = useMemo(() => [...new Set(data.audit.map((a) => a.role))].sort(), [data.audit]);
  const cats = useMemo(() => [...new Set(tagged.map((a) => a.cat))].sort(), [tagged]);
  const filtered = tagged.filter((a) => {
    if (user && a.user !== user) return false;
    if (role && a.role !== role) return false;
    if (cat && a.cat !== cat) return false;
    const ts = new Date(a.ts).getTime();
    if (from && ts < new Date(from).getTime()) return false;
    if (to && ts > new Date(to).getTime() + 86400000) return false;
    return true;
  });
  const hasFilters = user || role || cat || from || to;
  return (<>
    <div className="pagehead"><div><h1 className="h1 dsp">Audit <span className="gradt">Trail</span></h1><p className="sub">A record of user activity by role. Visible to administrators only.</p></div></div>
    <div className="panel" style={{ padding: "14px 16px", marginBottom: 14 }}>
      <div className="fx gap12" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 140, marginBottom: 0 }}><label className="label">User</label><select className="input" value={user} onChange={(e) => setUser(e.target.value)}><option value="">All users</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</select></div>
        <div className="field" style={{ minWidth: 140, marginBottom: 0 }}><label className="label">Role</label><select className="input" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
        <div className="field" style={{ minWidth: 160, marginBottom: 0 }}><label className="label">Category</label><select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label">From</label><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
        <div className="field" style={{ marginBottom: 0 }}><label className="label">To</label><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        {hasFilters && <button className="btn btn-ghost btn-sm" onClick={() => { setUser(""); setRole(""); setCat(""); setFrom(""); setTo(""); }}><i className="ph ph-x" /> Clear filters</button>}
      </div>
      <div className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>{filtered.length} of {data.audit.length} entries shown</div>
    </div>
    <div className="panel" style={{ padding: "8px 8px 4px" }}>
      <div className="tblwrap"><table className="tbl"><thead><tr><th>Time</th><th>User</th><th>Role</th><th>Category</th><th>Action</th></tr></thead><tbody>
        {filtered.map((a) => <tr key={a.id} className="trow"><td className="dim mono" style={{ fontSize: 12.5 }}>{fmtTime(a.ts)}</td><td className="tt">{a.user}</td><td className="muted">{a.role}</td><td><span className="tag">{a.cat}</span></td><td className="th">{a.action}</td></tr>)}
      </tbody></table></div>
    </div>
  </>);
}

/* ---------- Notifications ---------- */
function Notifs({ data, rpc, go }) {
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
        const ref = parseNotificationRef(n.text);
        const openRef = () => {
          if (!n.read) rpc("markNotifRead", { id: n.id });
          if (!ref) return;
          if (ref.kind === "request") go("detail", { detailId: ref.id });
          else if (ref.kind === "projection") go("projections");
          else if (ref.kind === "revenue") go("revenue");
        };
        return (
          <div key={n.id} className={"notif" + (n.read ? "" : " unread")} style={ref ? { cursor: "pointer" } : undefined} onClick={ref ? openRef : undefined}>
            <div className="notif-ic" style={{ background: m.bg, color: m.c }}><i className={"ph " + m.i} /></div>
            <div style={{ flex: 1 }}><div className="th" style={{ fontWeight: 600, fontSize: 14 }}>{n.text}</div><div className="dim" style={{ fontSize: 12, marginTop: 3 }}>{fmtTime(n.ts)}</div></div>
            {ref && <i className="ph ph-arrow-right dim" style={{ fontSize: 15 }} />}
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
  const { data, rpc, catName, refresh, showToast, busy } = ctx;
  const [uploading, setUploading] = useState(false);
  const [uploadFallback, setUploadFallback] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("id", modal.reqId);
      fd.append("idx", String(modal.idx));
      fd.append("file", file);
      const res = await fetch("/api/drive/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (json.error === "FALLBACK_TO_LINK") { setUploadFallback(true); return; }
      if (json.error) { showToast(json.error, true); return; }
      await refresh();
      showToast("Document uploaded.");
      close();
    } finally {
      setUploading(false);
    }
  };

  const uploadProofFile = async (file) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "disburseProof");
      fd.append("id", modal.reqId);
      fd.append("file", file);
      const res = await fetch("/api/drive/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (json.error === "FALLBACK_TO_LINK") { setUploadFallback(true); return; }
      if (json.error) { showToast(json.error, true); return; }
      setForm({ ...form, proofLink: json.link });
      showToast("Transfer proof uploaded.");
    } finally {
      setUploading(false);
    }
  };
  const titles = { newRequest: "New reimbursement request", editRequest: "Edit request", newProjection: "Submit projected expense", newUser: "Add user", newRole: "Add role", newCategory: "New expense category", attach: "Submit document (Google Drive link)", flagDisc: "Flag discrepancy", markFixed: "Document changed", disburse: "Disburse funds", newAccount: "New account", newPurse: "New purse", addFunds: "Add funds", withdrawFunds: "Withdraw funds", editTxn: "Correct transaction amount", newRevenue: "Projected revenue", issuePO: "Issue purchase order", proofPay: "Attach proof of payment", payDeposit: "Pay deposit", correction: "Return for correction", editNumber: "Correct a figure", deleteTxn: "Delete transaction", bankInfo: "Receiving bank account", reverseStep: "Reverse to previous step", routeFunds: "Route funds to a purse", approveAdvance: "Issue advance", rejectProjection: "Reject projected expense", addReqDoc: "Add a required document" };
  const selCat = data.categories.find((c) => c.id === form.categoryId);

  const submit = async () => {
    let ok = false;
    if (modal.type === "newRequest") ok = await rpc("createRequest", form, "Reimbursement submitted.");
    else if (modal.type === "editRequest") ok = await rpc("editRequest", { ...form, id: modal.reqId }, "Request updated.");
    else if (modal.type === "bankInfo") ok = await rpc("setBankInfo", { id: modal.reqId, holder: form.holder, bank: form.bank, acctNo: form.acctNo, branch: form.branch, promptpay: form.promptpay, note: form.note }, "Bank account details saved.");
    else if (modal.type === "newProjection") ok = await rpc("createProjection", form, "Projection submitted.");
    else if (modal.type === "newUser") ok = await rpc("createUser", form, "User added.");
    else if (modal.type === "newRole") ok = await rpc("createRole", form, "Role created.");
    else if (modal.type === "newCategory") ok = await rpc("createCategory", form, "Category created.");
    else if (modal.type === "attach") ok = await rpc("attachDoc", { id: modal.reqId, idx: modal.idx, link: form.link, fileName: form.fileName }, "Document submitted.");
    else if (modal.type === "flagDisc") ok = await rpc("flagDiscrepancy", { id: modal.reqId, idx: modal.idx, note: form.note }, "Discrepancy flagged — requester notified.");
    else if (modal.type === "markFixed") ok = await rpc("markFixed", { id: modal.reqId, idx: modal.idx, note: form.note }, "Officer notified of the change.");
    else if (modal.type === "disburse") ok = await rpc("advanceRequest", { id: modal.reqId, acctId: form.acctId, proofLink: form.proofLink, route: form.route, payee: form.payee, payNote: form.payNote, actualAmount: form.actualAmount, streamId: form.streamId || undefined }, "Funds disbursed.");
    else if (modal.type === "newAccount") ok = await rpc("createAccount", form, "Account created.");
    else if (modal.type === "newPurse") ok = await rpc("createStream", form, "Purse created.");
    else if (modal.type === "addFunds") ok = await rpc("addFunds", { acctId: modal.acctId, amount: form.amount, desc: form.desc }, "Funds added.");
    else if (modal.type === "withdrawFunds") ok = await rpc("withdrawFunds", { acctId: modal.acctId, amount: form.amount, desc: form.desc }, "Funds withdrawn.");
    else if (modal.type === "editTxn") ok = await rpc("editTransaction", { id: modal.txnId, amount: form.amount, reason: form.reason }, "Transaction corrected.");
    else if (modal.type === "newRevenue") ok = await rpc("createRevenue", form, "Revenue projected.");
    else if (modal.type === "issuePO") ok = await rpc("issuePurchaseOrder", { id: modal.reqId, vendor: form.vendor, amount: form.amount, link: form.link, note: form.note }, "Purchase order issued.");
    else if (modal.type === "proofPay") ok = await rpc("attachProofOfPayment", { id: modal.reqId, link: form.link, ref: form.ref, date: form.date, note: form.note }, "Proof of payment attached.");
    else if (modal.type === "payDeposit") ok = await rpc("payDeposit", { id: modal.reqId, amount: form.amount, streamId: form.streamId }, "Deposit paid.");
    else if (modal.type === "correction") ok = await rpc("returnForCorrection", { id: modal.reqId, reason: form.reason }, "Request returned for correction.");
    else if (modal.type === "editNumber") ok = await rpc("editRecordAmount", { kind: modal.kind, id: modal.id, field: modal.field, newValue: form.newValue, reason: form.reason }, "Correction saved.");
    else if (modal.type === "deleteTxn") ok = await rpc("deleteTransaction", { id: modal.txnId, reason: form.reason }, "Transaction deleted.");
    else if (modal.type === "reverseStep") ok = await rpc("reverseRequest", { id: modal.reqId, reason: form.reason }, "Request reversed to the previous step.");
    else if (modal.type === "routeFunds") ok = await rpc("routeFunds", { id: modal.reqId, streamId: form.streamId }, "Funds routed.");
    else if (modal.type === "approveAdvance") ok = await rpc("approveProjection", { id: modal.id, acctId: form.acctId, vendorRequired: !!form.vendorRequired }, "Advance issued.");
    else if (modal.type === "rejectProjection") ok = await rpc("rejectProjection", { id: modal.id, reason: form.reason }, "Projected expense rejected.");
    else if (modal.type === "addReqDoc") ok = await rpc("addReqDoc", { id: modal.reqId, name: form.name, phase: modal.phase }, "Document added to checklist.");
    if (ok) close();
  };

  return (
    <div className="overlay" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="fx ac jb" style={{ marginBottom: 20 }}><h3 className="dsp" style={{ fontSize: 21, fontWeight: 800, margin: 0 }}>{titles[modal.type]}</h3><div className="iconbtn" onClick={close}><i className="ph ph-x" /></div></div>

        {(modal.type === "newRequest" || modal.type === "editRequest") && (<>
          {modal.type === "newRequest" && (() => {
            const advanced = (data.projections || []).filter((p) => p.status === "advanced");
            if (advanced.length === 0) return null;
            return (
              <div className="field">
                <label className="label">Approved projected expense (optional)</label>
                <select className="input" value={form.projectionId || ""} onChange={(e) => {
                  const pid = e.target.value;
                  const p = advanced.find((x) => x.id === pid);
                  setForm(p
                    ? { ...form, projectionId: pid, categoryId: p.categoryId, title: form.title || p.title, amount: form.amount || String(p.amount) }
                    : { ...form, projectionId: "" });
                }}>
                  <option value="">None — direct claim</option>
                  {advanced.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.title} ({fmt(p.amount)})</option>)}
                </select>
                <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Reimbursements draw on the advance issued for a projection — category, title and amount are prefilled from it.</div>
              </div>
            );
          })()}
          <div className="field"><label className="label">Title</label><input className="input" value={form.title || ""} onChange={set("title")} placeholder="e.g. Snacks for opening ceremony" /></div>
          <div className="field"><label className="label">Expense category</label><select className="input" value={form.categoryId || ""} onChange={set("categoryId")} disabled={modal.type === "newRequest" && !!form.projectionId}>{data.categories.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></div>
          {modal.type === "editRequest" && (() => {
            const matchingAdvanced = (data.projections || []).filter((p) => p.status === "advanced" && p.categoryId === form.categoryId);
            const required = selCat && !selCat.allowDirect;
            if (matchingAdvanced.length > 0) {
              return (
                <div className="field"><label className="label">Against a projected expense{required ? " (required for this category)" : " (optional)"}</label><select className="input" value={form.projectionId || ""} onChange={set("projectionId")}>
                  {!required && <option value="">None — direct claim</option>}
                  {required && !form.projectionId && <option value="">Select a projected expense…</option>}
                  {matchingAdvanced.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.title} ({fmt(p.amount)})</option>)}
                </select></div>
              );
            }
            if (required) {
              return <div className="field"><div className="dim" style={{ fontSize: 12.5 }}>This category requires linking to a projected expense with an issued advance. Submit one under "Projected Expenses" and have it approved first, then it'll appear here.</div></div>;
            }
            return null;
          })()}
          {modal.type === "newRequest" && selCat && !selCat.allowDirect && !form.projectionId && (
            <div className="field"><div className="dim" style={{ fontSize: 12.5 }}>This category requires linking to a projected expense with an issued advance. Pick one above, or submit one under "Projected Expenses" and have it approved first.</div></div>
          )}
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Event date (when the expense actually happened)</label><input className="input" type="date" value={form.eventDate || ""} onChange={set("eventDate")} /></div>
          <div className="field"><label className="label">Paid via</label><select className="input" value={form.paidVia || selCat?.defaultPaidVia || "finance"} onChange={set("paidVia")}>
            <option value="finance">Faculty Finance Officer</option>
            <option value="purchasing">Faculty Purchasing Officer</option>
            <option value="psat">PSAT</option>
          </select></div>
          <div className="field"><label className="label">Description</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.desc || ""} onChange={set("desc")} placeholder="Purpose of this expense…" /></div>
          {selCat && selCat.vendorRequired && (
            <div className="field"><label className="label">Vendor / supplier name (required for this category)</label><input className="input" value={form.vendor || ""} onChange={set("vendor")} placeholder="e.g. Acme Catering Co." /></div>
          )}
          {selCat && (selCat.docsPre.length + selCat.docsPost.length) > 0 && <div className="field"><label className="label">Documents required for this category</label><div className="chipwrap">{[...selCat.docsPre, ...selCat.docsPost].map((d) => <span key={d} className="doc-chip th" style={{ padding: "5px 10px", fontSize: 12 }}>{d}</span>)}</div></div>}
        </>)}

        {modal.type === "newProjection" && (<>
          <div className="field"><label className="label">Item title</label><input className="input" value={form.title || ""} onChange={set("title")} placeholder="e.g. Venue rental" /></div>
          <div className="field"><label className="label">Expense category</label><select className="input" value={form.categoryId || ""} onChange={set("categoryId")}>{data.categories.filter((c) => c.active !== false).map((c) => <option key={c.id} value={c.id}>{catName(c)}</option>)}</select></div>
          <div className="field"><label className="label">Projected amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Expected date</label><input className="input" type="date" value={form.expectedDate || ""} onChange={set("expectedDate")} /></div>
        </>)}

        {modal.type === "editTxn" && (<>
          <div className="field"><label className="label">Description</label><div className="muted" style={{ fontSize: 14 }}>{modal.txnDesc}</div></div>
          <div className="field"><label className="label">Current amount</label><div className="mono" style={{ fontWeight: 800, fontSize: 18 }}>{fmt(modal.oldAmount)}</div></div>
          <div className="field"><label className="label">Corrected amount (THB)</label><input className="input mono" type="number" value={form.amount ?? ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Reason for correction</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} placeholder="e.g. Extra zero entered by mistake" /></div>
        </>)}

        {modal.type === "newRevenue" && (<>
          <div className="field"><label className="label">Title</label><input className="input" value={form.title || ""} onChange={set("title")} placeholder="e.g. Sponsorship — Acme Co." /></div>
          <div className="field"><label className="label">Source (optional)</label><input className="input" value={form.source || ""} onChange={set("source")} /></div>
          <div className="field"><label className="label">Purse</label><select className="input" value={form.streamId || ""} onChange={set("streamId")}>
            <option value="">No purse</option>
            {(data.streams || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Expected date</label><input className="input" type="date" value={form.expectedDate || ""} onChange={set("expectedDate")} /></div>
        </>)}

        {modal.type === "issuePO" && (<>
          <div className="field"><label className="label">Vendor</label><input className="input" value={form.vendor || ""} onChange={set("vendor")} /></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} /></div>
          <div className="field"><label className="label">Drive link to the signed purchase order</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://drive.google.com/file/d/…" /></div>
          <div className="field"><label className="label">Note (optional)</label><textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={form.note || ""} onChange={set("note")} /></div>
        </>)}

        {modal.type === "proofPay" && (<>
          <div className="field"><label className="label">Transfer slip link</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://… (bank slip / statement)" /></div>
          <div className="field"><label className="label">Transfer reference</label><input className="input" value={form.ref || ""} onChange={set("ref")} placeholder="TRF-88213" /></div>
          <div className="field"><label className="label">Date</label><input className="input" type="date" value={form.date || ""} onChange={set("date")} /></div>
          <div className="field"><label className="label">Note (optional)</label><textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={form.note || ""} onChange={set("note")} /></div>
        </>)}

        {modal.type === "payDeposit" && (<>
          {modal.depositPaid && <div className="drive-banner" style={{ marginBottom: 16 }}><i className="ph ph-coins" /><span>Deposit of {fmt(modal.depositAmount)} already paid — only the remaining balance will be deducted.</span></div>}
          <div className="field"><label className="label">Purse</label><select className="input" value={form.streamId || ""} onChange={set("streamId")}>{(data.streams || []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} ({fmt(s.balance)})</option>)}</select></div>
          <div className="field"><label className="label">Deposit amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
        </>)}

        {modal.type === "correction" && (<>
          <div className="issue-box" style={{ marginBottom: 16 }}><div className="issue-title"><i className="ph ph-warning-circle" /> Send back to requester</div><div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>The request will return to the Notified stage. Existing attachments remain available for correction.</div></div>
          <div className="field"><label className="label">Reason for the change (required)</label><textarea className="input th" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} placeholder="e.g. Wrong category selected — should be Hotel Accommodation, not Venue Rental." /></div>
        </>)}

        {modal.type === "editNumber" && (<>
          <div className="field"><label className="label">{modal.label}</label><div className="muted" style={{ fontSize: 14 }}>Current: {fmt(modal.orig)}</div></div>
          <div className="field"><label className="label">Corrected amount</label><input className="input mono" type="number" value={form.newValue ?? ""} onChange={set("newValue")} /></div>
          <div className="field"><label className="label">Reason for the change</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} /></div>
        </>)}

        {modal.type === "deleteTxn" && (<>
          <div className="issue-box" style={{ marginBottom: 16 }}><div className="issue-title"><i className="ph ph-warning-circle" /> Delete this transaction?</div><div className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{modal.txnDesc} — {fmt(modal.txnAmount)}. The account balance will be reversed.</div></div>
          <div className="field"><label className="label">Reason for deletion</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} /></div>
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

        {modal.type === "newCategory" && (() => {
          const catPhase = form.catDocPhase || "pre";
          const listKey = catPhase === "post" ? "docsPost" : "docsPre";
          const list = form[listKey] || [];
          const toggleDoc = (name) => setForm({ ...form, [listKey]: list.includes(name) ? list.filter((d) => d !== name) : [...list, name] });
          return (<>
            <div className="field"><label className="label">Category name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Equipment rental" /></div>
            <div className="field"><label className="label">ชื่อหมวด (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
            <div className="field"><label className="label">Note (optional)</label><textarea className="input th" style={{ minHeight: 60, resize: "vertical" }} value={form.notes || ""} onChange={set("notes")} /></div>
            <div className="field">
              <label className="label">Required documents</label>
              <div className="seg" style={{ marginBottom: 10 }}>
                <button type="button" className={catPhase === "pre" ? "on" : ""} onClick={() => setForm({ ...form, catDocPhase: "pre" })}>Pre-reimbursement</button>
                <button type="button" className={catPhase === "post" ? "on" : ""} onClick={() => setForm({ ...form, catDocPhase: "post" })}>Closing</button>
              </div>
              <input className="input" style={{ marginBottom: 10 }} value={form.catDocSearch || ""} onChange={set("catDocSearch")} placeholder="Search documents…" />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 220, overflowY: "auto" }}>
                {data.masterDocs.filter((m) => m.name.toLowerCase().includes((form.catDocSearch || "").toLowerCase())).map((m) => (
                  <div key={m.id} className={"doc clickable" + (list.includes(m.name) ? " on" : "")} onClick={() => toggleDoc(m.name)}>
                    <div className="chk"><i className="ph ph-check" /></div><span className="th" style={{ fontSize: 13.5 }}>{m.name}</span>
                  </div>
                ))}
                {data.masterDocs.filter((m) => m.name.toLowerCase().includes((form.catDocSearch || "").toLowerCase())).length === 0 && (
                  <div className="dim" style={{ fontSize: 12.5, padding: "8px 0" }}>No documents match "{form.catDocSearch}".</div>
                )}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>{(form.docsPre || []).length + (form.docsPost || []).length} document(s) selected — more can be added or removed after creating the category.</div>
            </div>
            <div className="field">
              <label className="label">Approval clearance</label>
              <select className="input" value={form.approverRole || "faculty_finance"} onChange={set("approverRole")}>
                <option value="faculty_finance">Faculty Finance Officer</option>
                <option value="faculty_purchasing">Faculty Purchasing Officer</option>
              </select>
              <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>Who can approve requests in this category. Project Finance can always approve.</div>
            </div>
          </>);
        })()}

        {modal.type === "attach" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-google-drive-logo" /><span className="th">Submitting — <b>{modal.name}</b></span></div>
          {modal.driveFolderId && !uploadFallback && (
            <div className="field">
              <label className="label">Upload a file</label>
              <input className="input" type="file" disabled={uploading} onChange={(e) => e.target.files[0] && uploadFile(e.target.files[0])} />
              {uploading && <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}><i className="ph ph-spinner" /> Uploading to Google Drive…</div>}
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Or <a href="#" onClick={(e) => { e.preventDefault(); setUploadFallback(true); }} style={{ color: "var(--link)" }}>paste a link instead</a>.</div>
            </div>
          )}
          {(!modal.driveFolderId || uploadFallback) && (<>
            {uploadFallback && <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Upload didn't go through — paste a Drive link instead.</div>}
            <div className="field"><label className="label">Google Drive link</label><input className="input" value={form.link || ""} onChange={set("link")} placeholder="https://drive.google.com/file/d/…" /></div>
            <div className="field"><label className="label">File name (optional)</label><input className="input" value={form.fileName || ""} onChange={set("fileName")} placeholder="receipt-2026-07.pdf" /></div>
          </>)}
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
          {modal.depositPaid && <div className="drive-banner" style={{ marginBottom: 16 }}><i className="ph ph-coins" /><span>Deposit of {fmt(modal.depositAmount)} already paid — only the remaining balance will be deducted now.</span></div>}
          {modal.bank ? (
            <div style={{ padding: "11px 13px", borderRadius: 10, background: "var(--panel2)", border: "1px solid var(--line2)", marginBottom: 16, fontSize: 13 }}>
              <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 5 }}><i className="ph ph-bank" /> Receiving account</div>
              <div>{modal.bank.holder} — {modal.bank.bank} {modal.bank.acctNo}{modal.bank.branch ? " (" + modal.bank.branch + ")" : ""}</div>
              {modal.bank.promptpay && <div className="dim">PromptPay: {modal.bank.promptpay}</div>}
              {modal.bank.note && <div className="dim">{modal.bank.note}</div>}
            </div>
          ) : (
            <div className="drive-banner" style={{ marginBottom: 16 }}><i className="ph ph-warning" /><span>No receiving bank account on file — confirm details with the department or record them in the proof note.</span></div>
          )}
          <div className="field"><label className="label">Payment route</label><select className="input" value={form.route || "direct"} onChange={set("route")}>
            <option value="direct">Direct to supplier</option>
            <option value="advance">Settled from advance</option>
            <option value="selfpay">Self-pay — transfer to a department member</option>
          </select></div>
          {form.route === "selfpay" && (<>
            <div className="field"><label className="label">Payee</label><input className="input" value={form.payee || ""} onChange={set("payee")} placeholder="Name of the department member receiving funds" /></div>
            <div className="field"><label className="label">Note</label><textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={form.payNote || ""} onChange={set("payNote")} placeholder="Required — explain the self-pay arrangement" /></div>
          </>)}
          <div className="field"><label className="label">Source account</label><select className="input" value={form.acctId || ""} onChange={set("acctId")}>
            <option value="" disabled>Select an account…</option>
            {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {!form.acctId && <div className="err" style={{ marginTop: 6 }}><i className="ph ph-warning-circle" /> Select a source account before disbursing.</div>}
          </div>
          {(data.streams || []).filter((s) => s.active && s.acctId === form.acctId).length > 0 && (
            <div className="field"><label className="label">Purse</label><select className="input" value={form.streamId || ""} onChange={set("streamId")}>
              <option value="">No purse — debit account directly</option>
              {(data.streams || []).filter((s) => s.active && s.acctId === form.acctId).map((s) => <option key={s.id} value={s.id}>{s.name} ({fmt(s.balance)})</option>)}
            </select></div>
          )}
          <div className="field"><label className="label">Actual amount paid</label><input className="input mono" type="number" value={form.actualAmount ?? ""} onChange={set("actualAmount")} placeholder={String(modal.reqAmount || 0)} /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 6 }}>Requested {fmt(modal.reqAmount)}. If the actual invoice came in lower, enter the lower figure — the difference is returned to the Faculty account.</div>
          {!(Number(form.actualAmount) > 0) && <div className="err" style={{ marginBottom: 10 }}><i className="ph ph-warning-circle" /> Enter a valid amount paid.</div>}
          {Number(form.actualAmount) > 0 && Number(form.actualAmount) > (modal.reqAmount || 0) && <div className="err" style={{ marginBottom: 10 }}><i className="ph ph-warning-circle" /> Actual amount can't exceed the requested {fmt(modal.reqAmount)}.</div>}
          {form.route === "selfpay" && !((form.payee || "").trim() && (form.payNote || "").trim()) && <div className="err" style={{ marginBottom: 10 }}><i className="ph ph-warning-circle" /> Payee and note are both required for a self-pay disbursement.</div>}
          <div className="field">
            <label className="label">Transfer proof</label>
            {modal.driveFolderId && !uploadFallback ? (<>
              {form.proofLink ? (
                <div className="fx ac gap8"><a href={form.proofLink} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: "var(--link)" }}>View uploaded proof ↗</a><i className="ph ph-x chip-act" onClick={() => setForm({ ...form, proofLink: "" })} /></div>
              ) : (<>
                <input className="input" type="file" disabled={uploading} onChange={(e) => e.target.files[0] && uploadProofFile(e.target.files[0])} />
                {uploading && <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}><i className="ph ph-spinner" /> Uploading to Google Drive…</div>}
              </>)}
              <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>Uploads into the same Drive folder as this request's documents. Or <a href="#" onClick={(e) => { e.preventDefault(); setUploadFallback(true); }} style={{ color: "var(--link)" }}>paste a link instead</a>.</div>
            </>) : (
              <input className="input" value={form.proofLink || ""} onChange={set("proofLink")} placeholder="https://… (bank transfer slip / statement)" />
            )}
            {!(form.proofLink || "").trim() && <div className="err" style={{ marginTop: 6 }}><i className="ph ph-warning-circle" /> Attach transfer proof before disbursing.</div>}
          </div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Funds will be deducted from this account immediately.</div>
        </>)}

        {modal.type === "reverseStep" && (<>
          <div className="attn"><i className="ph-fill ph-warning" style={{ color: "var(--amber)" }} /><span>Reversing {modal.reqId} from <b>{modal.fromLabel}</b> back to <b>{modal.toLabel}</b>{modal.willRefund ? " — the disbursed funds (and any advance refund) will be returned." : "."}</span></div>
          <div className="field"><label className="label">Reason (optional)</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} placeholder="Why is this being reversed?" /></div>
        </>)}

        {modal.type === "approveAdvance" && (<>
          <div className="field">
            <label className="label">Funding account</label>
            <select className="input" value={form.acctId || "faculty"} onChange={set("acctId")}>
              {data.accounts.filter((a) => a.active).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>The advance will be funded from this account, and any later refund will return to it.</div>
          </div>
          <div className="fx ac jb" style={{ marginTop: 4, marginBottom: 4 }}>
            <div><div style={{ fontWeight: 700, fontSize: 14 }}>Is a vendor required for this expense?</div><div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>Overrides the category default for the request eventually linked to this advance.</div></div>
            <div className={"switch" + (form.vendorRequired ? " on" : "")} onClick={() => setForm({ ...form, vendorRequired: !form.vendorRequired })} />
          </div>
        </>)}

        {modal.type === "addReqDoc" && (<>
          <div className="field"><label className="label">Document name</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Additional receipt for venue rental" /></div>
          <div className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>Added to this request's checklist only ({modal.phase === "post" ? "closing" : "pre-reimbursement"} documents) — the requester will be notified.</div>
        </>)}

        {modal.type === "rejectProjection" && (<>
          <div className="field"><label className="label">Reason (optional)</label><textarea className="input" style={{ minHeight: 70, resize: "vertical" }} value={form.reason || ""} onChange={set("reason")} placeholder="Why is this being rejected?" /></div>
        </>)}

        {modal.type === "routeFunds" && (<>
          <div className="attn"><i className="ph-fill ph-info" /><span>Transfers {fmt(modal.reqAmount)} from the Faculty account into the chosen purse — independent of the advance/projection flow.</span></div>
          <div className="field"><label className="label">Purse</label><select className="input" value={form.streamId || ""} onChange={set("streamId")}>{(data.streams || []).filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name} ({fmt(s.balance)})</option>)}</select></div>
        </>)}

        {modal.type === "bankInfo" && (<>
          <div className="field"><label className="label">Account holder</label><input className="input" value={form.holder || ""} onChange={set("holder")} placeholder="Name on the receiving account" /></div>
          <div className="field"><label className="label">Bank</label><input className="input" value={form.bank || ""} onChange={set("bank")} placeholder="e.g. Kasikornbank" /></div>
          <div className="field"><label className="label">Account number</label><input className="input" value={form.acctNo || ""} onChange={set("acctNo")} placeholder="xxx-x-xxxxx-x" /></div>
          <div className="field"><label className="label">Branch (optional)</label><input className="input" value={form.branch || ""} onChange={set("branch")} /></div>
          <div className="field"><label className="label">PromptPay (optional)</label><input className="input" value={form.promptpay || ""} onChange={set("promptpay")} /></div>
          <div className="field"><label className="label">Note (optional)</label><input className="input" value={form.note || ""} onChange={set("note")} /></div>
        </>)}

        {modal.type === "newAccount" && (<>
          <div className="field"><label className="label">Account name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Department Petty Cash" /></div>
          <div className="field"><label className="label">ชื่อบัญชี (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
        </>)}

        {modal.type === "newPurse" && (<>
          <div className="field"><label className="label">Purse name (EN)</label><input className="input" value={form.name || ""} onChange={set("name")} placeholder="e.g. Sponsorships" /></div>
          <div className="field"><label className="label">ชื่อ purse (TH)</label><input className="input th" value={form.nameTh || ""} onChange={set("nameTh")} /></div>
          <div className="field">
            <label className="label">Color</label>
            <div className="fx gap8" style={{ flexWrap: "wrap" }}>
              {["#f0378a", "#a855f7", "#3fd8a4", "#f5b544", "#60a5fa", "#e11d48", "#22d3ee"].map((c) => (
                <div key={c} onClick={() => setForm({ ...form, color: c })} style={{ width: 28, height: 28, borderRadius: "50%", background: c, cursor: "pointer", border: form.color === c ? "3px solid var(--txt)" : "3px solid transparent" }} />
              ))}
            </div>
          </div>
        </>)}

        {modal.type === "addFunds" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-bank" /><span>Adding funds to — <b>{modal.acctName}</b></span></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Description</label><input className="input" value={form.desc || ""} onChange={set("desc")} placeholder="e.g. Faculty budget allocation" /></div>
        </>)}

        {modal.type === "withdrawFunds" && (<>
          <div className="drive-banner" style={{ marginBottom: 18 }}><i className="ph ph-bank" /><span>Withdrawing funds from — <b>{modal.acctName}</b></span></div>
          <div className="field"><label className="label">Amount (THB)</label><input className="input mono" type="number" value={form.amount || ""} onChange={set("amount")} placeholder="0" /></div>
          <div className="field"><label className="label">Description</label><input className="input" value={form.desc || ""} onChange={set("desc")} placeholder="e.g. Returned to university treasury" /></div>
        </>)}

        {!(modal.type === "attach" && modal.driveFolderId && !uploadFallback) && <button className="btn btn-primary grad" style={{ width: "100%", marginTop: 6 }} onClick={submit} disabled={busy || (modal.type === "disburse" && !(form.acctId && (form.proofLink || "").trim() && Number(form.actualAmount) > 0 && Number(form.actualAmount) <= (modal.reqAmount || 0) && (form.route !== "selfpay" || ((form.payee || "").trim() && (form.payNote || "").trim())))) || ((modal.type === "newRequest" || modal.type === "editRequest") && selCat?.vendorRequired && !(form.vendor || "").trim()) || ((modal.type === "newRequest" || modal.type === "editRequest") && selCat && !selCat.allowDirect && !form.projectionId) || (modal.type === "bankInfo" && !((form.holder || "").trim() && (form.bank || "").trim() && (form.acctNo || "").trim())) || (modal.type === "routeFunds" && !form.streamId) || (modal.type === "addReqDoc" && !(form.name || "").trim())}><i className="ph ph-check" /> {modal.type === "flagDisc" ? "Flag & notify requester" : modal.type === "markFixed" ? "Notify officer" : modal.type === "disburse" ? "Confirm disbursement" : "Submit"}</button>}
      </div>
    </div>
  );
}
