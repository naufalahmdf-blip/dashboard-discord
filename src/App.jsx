import { useState, useEffect, useMemo } from "react";
import AdminTab from "./AdminTab";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, AreaChart, Area, Cell, Legend, Line
} from "recharts";

// ---- Helper Components ----
const St = ({ label, value, sub, trend, color = "#2A62FF" }) => (
  <div className="stat-card">
    <div className="stat-label">{label}</div>
    <div className="stat-value" style={{ color }}>{value}</div>
    {sub && <div className="stat-sub">{sub}</div>}
    {trend && <div className={`stat-trend ${trend.startsWith("+") ? "up" : "down"}`}>{trend}</div>}
  </div>
);

const Ti = ({ children, sub }) => (
  <div className="section-title">
    <h2>{children}</h2>
    {sub && <p className="mono-xs">{sub}</p>}
  </div>
);

const TT = ({ active, payload, label }) => {
  if (!active || !payload) return null;
  return (
    <div className="chart-tooltip">
      <div style={{ color: "#f1f5f9", fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || p.stroke || p.fill, margin: "2px 0" }}>
          {p.name}: {typeof p.value === "number" ? (p.value < 10 ? p.value.toFixed(2) : p.value.toLocaleString()) : p.value}{p.unit || ""}
        </div>
      ))}
    </div>
  );
};

const Btn2 = ({ on, children, onClick }) => (
  <button onClick={onClick} className={`btn-secondary ${on ? "active" : ""}`}>{children}</button>
);

const allTabs = ["Overview", "Sentiment", "Complaints", "Topics", "Shadow Project", "Admin"];

export default function App({ token, role, onLogout }) {
  const tabs = role === 'admin' ? allTabs : allTabs.filter(t => t !== 'Admin');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [tab, setTab] = useState(() =>
    window.location.pathname === "/admin" ? "Admin" : "Overview"
  );
  const [openCat, setOpenCat] = useState(null);
  const [toast, setToast] = useState('');
  const [showPwModal, setShowPwModal] = useState(false);
  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // Top Chatters: search + pagination
  const [chatSearch, setChatSearch] = useState('');
  const [chatPage, setChatPage] = useState(1);
  const chatPerPage = 100;

  // Chart granularity: 'daily', 'weekly', 'monthly'
  const [chartGran, setChartGran] = useState('daily');

  // Global date range filter
  const [periodMode, setPeriodMode] = useState('all'); // 'all', 'today', '7d', '28d', 'custom'
  const [gFromDate, setGFromDate] = useState(''); // YYYY-MM-DD
  const [gToDate, setGToDate] = useState(''); // YYYY-MM-DD

  // Compute effective date range from periodMode
  const { gFrom, gTo, gFromDay, gToDay } = useMemo(() => {
    if (periodMode === 'all') return { gFrom: '', gTo: '', gFromDay: '', gToDay: '' };
    const today = new Date();
    const fmt = d => d.toISOString().slice(0, 10);
    const fmtM = d => d.toISOString().slice(0, 7);
    let from, to;
    if (periodMode === 'today') {
      from = to = today;
    } else if (periodMode === '7d') {
      to = today;
      from = new Date(today); from.setDate(from.getDate() - 6);
    } else if (periodMode === '28d') {
      to = today;
      from = new Date(today); from.setDate(from.getDate() - 27);
    } else { // custom
      return {
        gFrom: gFromDate ? gFromDate.slice(0, 7) : '',
        gTo: gToDate ? gToDate.slice(0, 7) : '',
        gFromDay: gFromDate,
        gToDay: gToDate,
      };
    }
    return { gFrom: fmtM(from), gTo: fmtM(to), gFromDay: fmt(from), gToDay: fmt(to) };
  }, [periodMode, gFromDate, gToDate]);

  // Reset complaint expansion + auto-set chart granularity when period changes
  useEffect(() => {
    setOpenCat(null);
    if (periodMode === 'today') setChartGran('daily');
    else if (periodMode === '7d') setChartGran('daily');
    else if (periodMode === '28d') setChartGran('daily');
    else if (periodMode === 'all') setChartGran('weekly');
  }, [periodMode, gFromDate, gToDate]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  }

  const authHeaders = { Authorization: `Bearer ${token}` };

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwMsg(''); setPwLoading(true);
    try {
      const res = await fetch('/api/account/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ currentPassword: pwOld, newPassword: pwNew }),
      });
      const j = await res.json();
      if (res.ok) { setPwMsg('Password berhasil diubah!'); setPwOld(''); setPwNew(''); setTimeout(() => setShowPwModal(false), 1500); }
      else setPwMsg(j.error || 'Gagal');
    } catch { setPwMsg('Gagal terhubung ke server'); }
    finally { setPwLoading(false); }
  }

  function silentRefresh() {
    fetch("/api/data", { headers: authHeaders })
      .then((res) => { if (res.status === 401) { onLogout(); return; } if (!res.ok) throw new Error(); return res.json(); })
      .then((d) => { if (d) { setData(d); showToast('✓ Dashboard diperbarui'); } })
      .catch(() => showToast('⚠ Gagal refresh data'));
  }

  // ---- Fetch data from backend API ----
  useEffect(() => {
    fetch("/api/data", { headers: authHeaders })
      .then((res) => { if (res.status === 401) { onLogout(); return; } if (!res.ok) throw new Error("Failed to load"); return res.json(); })
      .then((d) => { if (d) { setData(d); setLoading(false); } })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, []);

  // ---- Filtered range data (direct from chat_messages via API) ----
  const [rangeData, setRangeData] = useState(null);
  const [loadingRange, setLoadingRange] = useState(false);

  const isFilteredEarly = !!(periodMode !== 'all');
  const gFromDayEarly = useMemo(() => {
    if (periodMode === 'all') return '';
    const today = new Date();
    const fmt = d => d.toISOString().slice(0, 10);
    if (periodMode === 'today') return fmt(today);
    if (periodMode === '7d') { const d = new Date(today); d.setDate(d.getDate() - 6); return fmt(d); }
    if (periodMode === '28d') { const d = new Date(today); d.setDate(d.getDate() - 27); return fmt(d); }
    return gFromDate || '';
  }, [periodMode, gFromDate]);
  const gToDayEarly = useMemo(() => {
    if (periodMode === 'all') return '';
    if (periodMode === 'custom') return gToDate || '';
    return new Date().toISOString().slice(0, 10);
  }, [periodMode, gToDate]);

  useEffect(() => {
    if (!isFilteredEarly || !gFromDayEarly || !gToDayEarly || !token) {
      setRangeData(null);
      return;
    }
    setLoadingRange(true);
    fetch(`/api/range-data?from=${gFromDayEarly}&to=${gToDayEarly}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d && !d.error) setRangeData(d); })
      .catch(() => {})
      .finally(() => setLoadingRange(false));
  }, [gFromDayEarly, gToDayEarly, isFilteredEarly, token]);

  if (loading) return <div className="loading-screen">Loading dashboard...</div>;
  if (error) return <div className="loading-screen error">Error: {error}</div>;

  const { dailyStats: mvDailyStats, suliDaily: mvSuliDaily, jonDaily: mvJonDaily, allTimeUsers, complaintCats, complaintMsgs, dailyTopics: mvDailyTopics, storyArc, rootCauses, shadowAccounts } = data;

  // ---- Helpers ----
  const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmtDay = (d) => { const [y, m, dd] = d.split('-'); return `${parseInt(dd)} ${MN[parseInt(m) - 1]} ${y}`; };

  // ---- Global date filter ----
  const isFiltered = !!(gFrom || gTo);
  const requestedDays = (isFiltered && gFromDay && gToDay)
    ? Math.round((new Date(gToDay + 'T00:00:00') - new Date(gFromDay + 'T00:00:00')) / 86400000) + 1
    : 0;
  const isDailyView = isFiltered && requestedDays > 0 && requestedDays <= 90;

  // Use FRESH data from chat_messages (via /api/range-data) when filtered
  // Fall back to materialized view data (via /api/data) for All Time
  const dailyStats = isFiltered && rangeData ? rangeData.dailyStats : mvDailyStats;
  const suliDaily = isFiltered && rangeData ? rangeData.suliDaily : mvSuliDaily;
  const jonDaily = isFiltered && rangeData ? rangeData.jonDaily : mvJonDaily;
  const customChatters = isFiltered && rangeData ? rangeData.topChatters : null;
  const dailyTopics = isFiltered && rangeData ? rangeData.dailyTopics : (mvDailyTopics || []);


  // ---- Aggregation helpers (daily → weekly/monthly) ----
  const getWeekKey = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7)); // Monday
    return mon.toISOString().slice(0, 10);
  };
  const getMonthKey = (dateStr) => dateStr.slice(0, 7);
  const fmtWeek = (wk) => { const [y, m, d] = wk.split('-'); return `${parseInt(d)} ${MN[parseInt(m) - 1]} ${y}`; };
  const fmtMonth = (mk) => { const [y, m] = mk.split('-'); return `${MN[parseInt(m) - 1]} ${y}`; };

  const aggregateStats = (daily, gran) => {
    if (gran === 'daily') return daily;
    const grouped = {};
    const keyFn = gran === 'weekly' ? getWeekKey : getMonthKey;
    const lblFn = gran === 'weekly' ? fmtWeek : fmtMonth;
    daily.forEach(d => {
      const k = keyFn(d.stat_date);
      if (!grouped[k]) grouped[k] = { key: k, label: lblFn(k), messages: 0, users: 0, pos: 0, neg: 0, _days: 0 };
      grouped[k].messages += d.messages;
      grouped[k].users += d.users;
      grouped[k].pos += (d.pos || 0);
      grouped[k].neg += (d.neg || 0);
      grouped[k]._days++;
    });
    return Object.values(grouped).sort((a, b) => a.key.localeCompare(b.key)).map(g => ({
      ...g, pos: g._days > 0 ? +(g.pos / g._days).toFixed(2) : 0, neg: g._days > 0 ? +(g.neg / g._days).toFixed(2) : 0,
    }));
  };

  const aggregateMsgs = (daily, gran) => {
    if (gran === 'daily') return daily;
    const grouped = {};
    const keyFn = gran === 'weekly' ? getWeekKey : getMonthKey;
    const lblFn = gran === 'weekly' ? fmtWeek : fmtMonth;
    daily.forEach(d => {
      const k = keyFn(d.stat_date);
      if (!grouped[k]) grouped[k] = { key: k, label: lblFn(k), msgs: 0 };
      grouped[k].msgs += d.msgs;
    });
    return Object.values(grouped).sort((a, b) => a.key.localeCompare(b.key));
  };

  // ---- Raw daily data ----
  const rawDaily = (dailyStats || []).map(d => ({ label: fmtDay(d.stat_date), key: d.stat_date, stat_date: d.stat_date, messages: d.messages, users: d.users, pos: d.pos || 0, neg: d.neg || 0 }));
  const rawSuliDaily = (suliDaily || []).map(d => ({ label: fmtDay(d.stat_date), key: d.stat_date, stat_date: d.stat_date, msgs: d.msgs }));
  const rawJonDaily = (jonDaily || []).map(d => ({ label: fmtDay(d.stat_date), key: d.stat_date, stat_date: d.stat_date, msgs: d.msgs }));

  // ---- Aggregated chart data ----
  const S = aggregateStats(rawDaily, chartGran);
  const SU = aggregateMsgs(rawSuliDaily, chartGran);
  const JN = aggregateMsgs(rawJonDaily, chartGran);

  // ---- Top chatters: from range API when filtered, else all-time ----
  const topChatters = isFiltered ? (customChatters || []) : allTimeUsers;

  // ---- Sentiment data ----
  const SM = rawDaily;

  // ---- Dynamic calculations ----
  const totalMsgs = S.reduce((s, d) => s + d.messages, 0);
  const emptyRow = { label: '—', key: '', messages: 0, users: 0 };
  const peakRow = S.length > 0 ? S.reduce((a, b) => (b.users > a.users ? b : a), S[0]) : emptyRow;
  const lastRow = S.length > 0 ? S[S.length - 1] : emptyRow;

  // Compare current vs peak
  const pC = peakRow.users > 0 ? (((lastRow.users - peakRow.users) / peakRow.users) * 100).toFixed(1) : '0.0';

  // Sentiment averages (from daily data with pos/neg)
  const sentimentDays = SM.filter(d => (d.pos || 0) > 0 || (d.neg || 0) > 0);
  const sLen = sentimentDays.length || 1;
  const avgPos = (sentimentDays.reduce((s, d) => s + (d.pos || 0), 0) / sLen).toFixed(2);
  const avgNeg = (sentimentDays.reduce((s, d) => s + (d.neg || 0), 0) / sLen).toFixed(2);
  const avgNeu = (100 - parseFloat(avgPos) - parseFloat(avgNeg)).toFixed(2);
  const lastDay = SM.length >= 2 ? SM[SM.length - 2] : SM[SM.length - 1] || { pos: 0, neg: 0, stat_date: '—' };
  const lastDayLabel = lastDay.stat_date && lastDay.stat_date !== '—' ? fmtDay(lastDay.stat_date) : '—';
  const curPos = (lastDay.pos || 0).toFixed(2);
  const curNeg = (lastDay.neg || 0).toFixed(2);
  const curNeu = (100 - parseFloat(curPos) - parseFloat(curNeg)).toFixed(2);
  const sentimentFlipped = parseFloat(curNeg) > parseFloat(curPos);

  // Complaint counts — use global date filter
  function getComplaintCount(catId) {
    return complaintMsgs.filter(m =>
      m.category_id === catId &&
      (!gFromDay || m.msg_date >= gFromDay) &&
      (!gToDay || m.msg_date <= gToDay)
    ).length;
  }
  const compTotal = complaintCats.reduce((s, c) => s + getComplaintCount(c.id), 0);

  const firstDate = (dailyStats || [])[0]?.stat_date;
  const lastDate = (dailyStats || []).length > 0 ? dailyStats[dailyStats.length - 1].stat_date : '';
  const rangeLabel = isFiltered
    ? (gFromDay && gToDay ? `${gFromDay} → ${gToDay}` : `${gFrom} → ${gTo}`)
    : (firstDate && lastDate ? `${firstDate} – ${lastDate}` : '—');

  return (
    <div className="dashboard">
      {/* Toast */}
      {toast && <div className="toast">{toast}</div>}

      {/* Change Password Modal */}
      {showPwModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999 }} onClick={() => setShowPwModal(false)}>
          <div style={{ background: '#111116', border: '1px solid #1e1e28', borderRadius: 12, padding: 28, width: 360 }} onClick={e => e.stopPropagation()}>
            <h3 style={{ color: '#f1f5f9', fontSize: 16, marginBottom: 16 }}>Ganti Password</h3>
            <form onSubmit={handleChangePassword}>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Password Lama</label>
                <input type="password" value={pwOld} onChange={e => setPwOld(e.target.value)} required style={{ width: '100%', padding: '8px 12px', background: '#09090b', border: '1px solid #2a2a3a', borderRadius: 6, color: '#f1f5f9', fontSize: 13 }} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 4, textTransform: 'uppercase', fontWeight: 600 }}>Password Baru</label>
                <input type="password" value={pwNew} onChange={e => setPwNew(e.target.value)} required minLength={6} style={{ width: '100%', padding: '8px 12px', background: '#09090b', border: '1px solid #2a2a3a', borderRadius: 6, color: '#f1f5f9', fontSize: 13 }} />
              </div>
              {pwMsg && <div style={{ color: pwMsg.includes('berhasil') ? '#4ade80' : '#f87171', fontSize: 13, marginBottom: 8 }}>{pwMsg}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" onClick={() => setShowPwModal(false)} style={{ padding: '8px 16px', background: '#374151', color: '#9ca3af', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}>Batal</button>
                <button type="submit" disabled={pwLoading} style={{ padding: '8px 16px', background: '#2A62FF', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>{pwLoading ? 'Saving...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="header">
        <div className="header-inner">
          <div className="header-left">
            <img src="/icon-tws.png" alt="TWS" className="header-logo" />
            <div>
              <div className="header-tag">Discord Analytics</div>
              <h1 className="header-title">Member Sentiment Report</h1>
              <div className="header-sub">{totalMsgs.toLocaleString()} messages · {rangeLabel}</div>
            </div>
          </div>
          <div className="header-right">
            <span className="mono-xs">{localStorage.getItem('email')}</span>
            <button className="logout-btn" onClick={() => { setShowPwModal(true); setPwMsg(''); setPwOld(''); setPwNew(''); }}>Ganti Password</button>
            <button className="logout-btn" onClick={onLogout}>Logout</button>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <nav className="tabs">
        <div className="tabs-inner">
          {tabs.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`tab-btn ${tab === t ? "active" : ""}`}>{t}</button>
          ))}
        </div>
      </nav>

      {/* Global Date Filter Bar */}
      {tab !== "Admin" && (
        <div className="filter-bar">
          <div className="filter-bar-inner">
            <span className="mono-xs" style={{ letterSpacing: 1.5, fontWeight: 600 }}>PERIOD</span>
            {[
              { key: 'all', label: 'All Time' },
              { key: 'today', label: 'Hari ini' },
              { key: '7d', label: '7 hari' },
              { key: '28d', label: '28 hari' },
              { key: 'custom', label: 'Custom' },
            ].map(p => (
              <button
                key={p.key}
                className={`btn-secondary ${periodMode === p.key ? 'active' : ''}`}
                onClick={() => setPeriodMode(p.key)}
              >{p.label}</button>
            ))}
            {periodMode === 'custom' && (<>
              <input
                type="date"
                value={gFromDate}
                onChange={e => setGFromDate(e.target.value)}
                className="date-input"
              />
              <span className="mono-xs">→</span>
              <input
                type="date"
                value={gToDate}
                onChange={e => setGToDate(e.target.value)}
                className="date-input"
              />
            </>)}
            {isFiltered && (
              <span className="mono-xs" style={{ color: '#2A62FF', marginLeft: 4 }}>
                {requestedDays > 0 ? `${requestedDays} days` : `${(dailyStats || []).length} days`} · {totalMsgs.toLocaleString()} msgs
              </span>
            )}
            <span style={{ width: 1, height: 20, background: '#1e293b', margin: '0 4px' }} />
            <span className="mono-xs" style={{ letterSpacing: 1.5, fontWeight: 600 }}>CHART</span>
            {[
              { key: 'daily', label: 'Harian' },
              { key: 'weekly', label: 'Mingguan' },
              { key: 'monthly', label: 'Bulanan' },
            ].map(g => (
              <button
                key={g.key}
                className={`btn-secondary ${chartGran === g.key ? 'active' : ''}`}
                onClick={() => setChartGran(g.key)}
              >{g.label}</button>
            ))}
          </div>
        </div>
      )}

      {/* Content */}
      <main className="content">

        {/* ============ OVERVIEW ============ */}
        {tab === "Overview" && (<>
          <div className="stats-grid">
            <St label={`Peak Users / ${chartGran === 'daily' ? 'Day' : chartGran === 'weekly' ? 'Week' : 'Month'}`} value={peakRow.users.toLocaleString()} sub={peakRow.label} />
            <St label="Current Users" value={lastRow.users.toLocaleString()} sub={lastRow.label} trend={`${pC}% from peak`} color="#ef4444" />
            <St label="Neg Sentiment Rate" value={`${curNeg}%`} sub={`${lastDayLabel} — was ${sentimentDays.length > 0 ? sentimentDays.reduce((min, d) => (d.neg || 0) < (min.neg || 0) ? d : min, sentimentDays[0]).neg.toFixed(2) : '0.00'}% at lowest`} color="#f97316" />
          </div>

          <Ti sub={`Messages per ${chartGran === 'daily' ? 'day' : chartGran === 'weekly' ? 'week' : 'month'} (${rangeLabel})`}>Chat Volume</Ti>
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={isDailyView ? S : S.filter((d) => d.label !== "May 25")}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e28" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                <Tooltip content={<TT />} />
                <Bar dataKey="messages" radius={[4, 4, 0, 0]} name="Messages">
                  {(isDailyView ? S : S.filter((d) => d.label !== "May 25")).map((d, i) => (
                    <Cell key={i} fill={isDailyView ? "#2A62FF" : (d.users < 300 ? "#ef4444" : d.users < 600 ? "#f97316" : "#2A62FF")} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <Ti sub={`Unique chatters per ${chartGran === 'daily' ? 'day' : chartGran === 'weekly' ? 'week' : 'month'}`}>Active Users</Ti>
          <div className="chart-box">
            <ResponsiveContainer>
              <AreaChart data={S}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e28" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                <Tooltip content={<TT />} />
                <Area type="monotone" dataKey="users" stroke="#2A62FF" fill="#2A62FF" fillOpacity={0.15} strokeWidth={2} name="Active Users" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <Ti sub={isFiltered ? `Top chatters dalam periode ${rangeLabel}${loadingRange ? ' (loading...)' : ''}` : "Most active chatters by total message count"}>Top Chatters</Ti>

          {/* Search */}
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Search username..."
              value={chatSearch}
              onChange={e => { setChatSearch(e.target.value); setChatPage(1); }}
              style={{ background: '#111116', border: '1px solid #1e1e28', color: '#f1f5f9', padding: '8px 14px', borderRadius: 8, fontSize: 13, width: 260, outline: 'none' }}
            />
            {chatSearch && <span className="mono-xs">{(() => { const f = topChatters.filter(u => u.username.toLowerCase().includes(chatSearch.toLowerCase())); return `${f.length} results`; })()}</span>}
          </div>

          {(() => {
            const filtered = chatSearch
              ? topChatters.filter(u => u.username.toLowerCase().includes(chatSearch.toLowerCase()))
              : topChatters;
            const totalPages = Math.max(1, Math.ceil(filtered.length / chatPerPage));
            const safePage = Math.min(chatPage, totalPages);
            const start = (safePage - 1) * chatPerPage;
            const pageData = filtered.slice(start, start + chatPerPage);

            return (<>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {(isFiltered ? ["#", "Username", "Messages"] : ["#", "Username", "Messages", "Active Period", "Months", "Status"]).map((h) => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {pageData.map((u, i) => (
                      <tr key={u.username}>
                        <td className="td-rank">{start + i + 1}</td>
                        <td className="td-user">{u.username}</td>
                        <td className="td-msgs">{u.msgs.toLocaleString()}</td>
                        {!isFiltered && <>
                          <td className="td-period">{u.period || '-'}</td>
                          <td className="td-months">{u.months || '-'}</td>
                          <td><span className={`badge ${u.active ? "badge-active" : "badge-churned"}`}>{u.active ? "ACTIVE" : "CHURNED"}</span></td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <button onClick={() => setChatPage(p => Math.max(1, p - 1))} disabled={safePage <= 1} style={{ background: '#111116', border: '1px solid #1e1e28', color: safePage <= 1 ? '#374151' : '#f1f5f9', padding: '6px 12px', borderRadius: 6, cursor: safePage <= 1 ? 'default' : 'pointer', fontSize: 13 }}>←</button>
                <span className="mono-xs" style={{ color: '#9ca3af' }}>Page <strong style={{ color: '#f1f5f9' }}>{safePage}</strong> of <strong style={{ color: '#f1f5f9' }}>{totalPages}</strong></span>
                <button onClick={() => setChatPage(p => Math.min(totalPages, p + 1))} disabled={safePage >= totalPages} style={{ background: '#111116', border: '1px solid #1e1e28', color: safePage >= totalPages ? '#374151' : '#f1f5f9', padding: '6px 12px', borderRadius: 6, cursor: safePage >= totalPages ? 'default' : 'pointer', fontSize: 13 }}>→</button>
                <span className="mono-xs" style={{ color: '#6b7280' }}>{chatPerPage} rows · {filtered.length} records</span>
              </div>
            </>);
          })()}
        </>)}

        {/* ============ SENTIMENT ============ */}
        {tab === "Sentiment" && (<>
          <Ti sub="Only counts messages directly about TWS/Suli — all market chat = neutral">TWS-Directed Sentiment</Ti>
          <div className="sentiment-grid">
            {[
              { title: isFiltered ? `Average (${rangeLabel})` : "Average (All Time)", sub: isFiltered ? `${requestedDays} days` : `${rangeLabel}`, neu: parseFloat(avgNeu), pos: parseFloat(avgPos), neg: parseFloat(avgNeg), flip: false },
              { title: `Latest (${lastDayLabel})`, sub: "Last analyzed day in range", neu: parseFloat(curNeu), pos: parseFloat(curPos), neg: parseFloat(curNeg), flip: sentimentFlipped },
            ].map((d, i) => (
              <div key={i} className="sentiment-card">
                <h3>{d.title}</h3>
                <div className="sub">{d.sub}</div>
                <div className="sentiment-values">
                  {[{ l: "Neutral", v: d.neu, c: "#475569" }, { l: "Positive", v: d.pos, c: "#22c55e" }, { l: "Negative", v: d.neg, c: "#ef4444" }].map((s, j) => (
                    <div key={j} className="sentiment-val">
                      <div className="num" style={{ color: s.c }}>{s.v}%</div>
                      <div className="lbl">{s.l}</div>
                    </div>
                  ))}
                </div>
                <div className="sentiment-bar-label">Positive vs Negative (zoomed)</div>
                <div className="sentiment-bar">
                  <div className="sentiment-bar-pos" style={{ width: `${(d.pos + d.neg) > 0 ? (d.pos / (d.pos + d.neg)) * 100 : 50}%` }}><span>{d.pos}%</span></div>
                  <div className="sentiment-bar-neg"><span>{d.neg}%</span></div>
                </div>
                {d.flip && <div className="sentiment-flip">FLIPPED — negative now exceeds positive</div>}
              </div>
            ))}
          </div>

          <Ti sub="Daily sentiment terhadap TWS/Suli (AI-analyzed)">Sentiment Trend</Ti>
          {isDailyView && S.every(d => d.pos === 0 && d.neg === 0) && (
            <div className="warning-box" style={{ marginBottom: 12 }}>
              ⚠ Daily sentiment belum dianalisis untuk periode ini. Jalankan "Run Daily Sentiment" di tab Admin.
            </div>
          )}
          <div className="chart-box">
            <ResponsiveContainer>
              <ComposedChart data={S}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e28" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} unit="%" domain={[0, 'auto']} />
                <Tooltip content={<TT />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="pos" stroke="#22c55e" strokeWidth={2} name="Positive %" unit="%" dot={{ r: 3 }} />
                <Line type="monotone" dataKey="neg" stroke="#ef4444" strokeWidth={2} name="Negative %" unit="%" dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            const cross = S.find((d) => d.neg > d.pos && (d.pos > 0 || d.neg > 0));
            return cross ? (
              <div className="mono-xs" style={{ marginTop: 6 }}>Negative crossed above positive on {cross.label} ({cross.neg.toFixed(2)}% vs {cross.pos.toFixed(2)}%).</div>
            ) : null;
          })()}

          <Ti sub="Messages from @notsuli in Diskusi Member channel">Suli's Chat Activity</Ti>
          {(() => {
            const suliTotal = SU.reduce((s, d) => s + d.msgs, 0);
            const suliPeak = SU.length > 0 ? SU.reduce((a, b) => b.msgs > a.msgs ? b : a, SU[0]) : { msgs: 0, label: '-' };
            const suliZero = SU.filter((d) => d.msgs === 0);
            const suliLast3 = SU.slice(-3);
            const suliLast3Total = suliLast3.reduce((s, d) => s + d.msgs, 0);
            return (<>
              <div className="stats-grid" style={{ marginBottom: 12 }}>
                <St label="Total Messages" value={suliTotal.toLocaleString()} sub={rangeLabel} />
                <St label="Peak Activity" value={suliPeak.msgs.toLocaleString()} sub={suliPeak.label} />
                <St label="Last 3 Days" value={suliLast3Total.toLocaleString()} sub={suliLast3.map((d) => d.label).join(", ")} color={suliLast3Total === 0 ? "#ef4444" : "#f97316"} />
              </div>
              <div className="warning-box">
                ⚠ Data hanya mencakup channel #diskusi-member. Suli mungkin aktif di channel lain (live voice, announcement, dll) yang tidak ter-export.
              </div>
            </>);
          })()}
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={SU}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e28" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                <Tooltip content={<TT />} />
                <Bar dataKey="msgs" radius={[4, 4, 0, 0]} name="@notsuli messages">
                  {SU.map((d, i) => (
                    <Cell key={i} fill={d.msgs === 0 ? "#ef4444" : d.msgs < (isDailyView ? 5 : 100) ? "#f97316" : "#2A62FF"} fillOpacity={d.msgs === 0 ? 0.3 : 0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {(JN.length > 0 || (jonDaily && jonDaily.length > 0)) && (<>
          <Ti sub="Messages from @analyst.a in Diskusi Member channel">Jonathan's Chat Activity</Ti>
          {(() => {
            const jonTotal = JN.reduce((s, d) => s + d.msgs, 0);
            const jonPeak = JN.length > 0 ? JN.reduce((a, b) => b.msgs > a.msgs ? b : a, JN[0]) : { msgs: 0, label: '-' };
            const jonZero = JN.filter((d) => d.msgs === 0);
            const jonLast3 = JN.slice(-3);
            const jonLast3Total = jonLast3.reduce((s, d) => s + d.msgs, 0);
            return (<>
              <div className="stats-grid" style={{ marginBottom: 12 }}>
                <St label="Total Posts" value={jonTotal.toLocaleString()} sub={rangeLabel} />
                <St label="Peak Activity" value={jonPeak.msgs.toLocaleString()} sub={jonPeak.label} />
                <St label="Last 3 Days" value={jonLast3Total.toLocaleString()} sub={jonLast3.map((d) => d.label).join(", ")} color={jonLast3Total === 0 ? "#ef4444" : "#10b981"} />
              </div>
              {jonZero.length > 0 && (
                <div className="warning-box">
                  ⚠ {jonZero.length} hari tanpa post.
                </div>
              )}
            </>);
          })()}
          <div className="chart-box">
            <ResponsiveContainer>
              <BarChart data={JN}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e1e28" />
                <XAxis dataKey="label" tick={{ fill: "#6b7280", fontSize: 9 }} />
                <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                <Tooltip content={<TT />} />
                <Bar dataKey="msgs" radius={[4, 4, 0, 0]} name="@analyst.a posts">
                  {JN.map((d, i) => (
                    <Cell key={i} fill={d.msgs === 0 ? "#ef4444" : d.msgs < (isDailyView ? 2 : 10) ? "#f97316" : "#10b981"} fillOpacity={d.msgs === 0 ? 0.3 : 0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          </>)}
        </>)}

        {/* ============ COMPLAINTS ============ */}
        {tab === "Complaints" && (<>
          <Ti sub={isFiltered ? `Keluhan dalam periode ${rangeLabel} · ${compTotal} keluhan` : `Klik kategori untuk lihat pesan · ${compTotal} keluhan total`}>Complaint Categories</Ti>

          <div className="table-wrap">
            {complaintCats.map((c) => {
              const count = getComplaintCount(c.id);
              const total = compTotal;
              const pct = total > 0 ? (count / total * 100).toFixed(1) : "0.0";
              const isOpen = openCat === c.id;
              const msgs = complaintMsgs.filter((m) =>
                m.category_id === c.id &&
                (!gFromDay || m.msg_date >= gFromDay) &&
                (!gToDay || m.msg_date <= gToDay)
              );
              const maxBar = total * 0.35;

              return (
                <div key={c.id}>
                  <div className={`complaint-row ${isOpen ? "open" : ""}`} onClick={() => setOpenCat(isOpen ? null : c.id)}>
                    <div className="complaint-left">
                      <div className="complaint-dot" style={{ background: c.color }} />
                      <span className="complaint-name">{c.theme}</span>
                      <div className="complaint-bar-outer">
                        <div className="complaint-bar-inner" style={{ width: `${maxBar > 0 ? Math.min((count / maxBar) * 100, 100) : 0}%`, background: c.color }} />
                      </div>
                    </div>
                    <div className="complaint-right">
                      <span className="complaint-count">{count}</span>
                      <span className="complaint-pct">({pct}%)</span>
                      <span className={`complaint-arrow ${isOpen ? "open" : ""}`}>▼</span>
                    </div>
                  </div>
                  {isOpen && msgs.length > 0 && (
                    <div className="complaint-messages">
                      <div className="complaint-messages-header">
                        <span className="mono-xs">Showing {msgs.length} messages in range</span>
                      </div>
                      {msgs.map((m, j) => (
                        <div key={j} className="complaint-msg">
                          <div className="complaint-msg-meta">
                            <span className="complaint-msg-date">{m.msg_date}</span>
                            <span className="complaint-msg-user" style={{ color: c.color }}>@{m.username}</span>
                          </div>
                          <div className="complaint-msg-text">{m.content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card" style={{ marginTop: 24 }}>
            <div className="card-title">Root Cause Analysis</div>
            {rootCauses.map((r, i) => (
              <div key={i} className={`root-item ${i < rootCauses.length - 1 ? "" : "last"}`}>
                <div className="root-header">
                  <span>{r.cause}</span>
                  <span className="root-pct">{r.percentage}%</span>
                </div>
                <div className="root-desc">{r.description}</div>
              </div>
            ))}
          </div>
        </>)}

        {/* ============ TOPICS ============ */}
        {tab === "Topics" && (<>
          <Ti sub={isFiltered ? `Topics dalam periode ${rangeLabel}` : "What members talk about most"}>Topic Trends</Ti>
          {dailyTopics.length === 0 && (
            <div className="warning-box">Belum ada data topics untuk periode ini. Jalankan "Run AI Analysis" di tab Admin.</div>
          )}
          <div className="table-wrap">
            <table>
              <thead><tr><th style={{ width: 90 }}>Date</th><th>Top Topics</th></tr></thead>
              <tbody>
                {dailyTopics.map((row, i) => {
                  let topics;
                  try { topics = typeof row.topics === "string" ? JSON.parse(row.topics) : row.topics; } catch { topics = []; }
                  if (!Array.isArray(topics) || topics.length === 0) return null;
                  return (
                    <tr key={i}>
                      <td className="td-period" style={{ fontWeight: 600 }}>{fmtDay(row.stat_date)}</td>
                      <td>
                        {topics.map((t, j) => {
                          const isN = typeof t === 'string' && (t.includes("Rugi") || t.includes("Refund") || t.includes("Keluhan"));
                          const isS = typeof t === 'string' && t.includes("Suli");
                          return <span key={j} className={`topic-tag ${isN ? "negative" : isS ? "suli" : "market"}`}>{t}</span>;
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mono-xs" style={{ marginTop: 6 }}>
            <span style={{ color: "#ef4444" }}>■</span> Negative &nbsp;
            <span style={{ color: "#f97316" }}>■</span> Suli &nbsp;
            <span style={{ color: "#93c5fd" }}>■</span> Market
          </div>

          <Ti sub="Community evolution phases">Topic Story Arc</Ti>
          <div className="card">
            {storyArc.map((p, i) => (
              <div key={i} className={`arc-item ${i < storyArc.length - 1 ? "" : "last"}`}>
                <div className="arc-bar" style={{ background: p.color }} />
                <div>
                  <div className="arc-phase" style={{ color: p.color }}>{p.phase}</div>
                  <div className="arc-desc">{p.description}</div>
                </div>
              </div>
            ))}
          </div>
        </>)}

        {/* ============ SHADOW PROJECT ============ */}
        {tab === "Shadow Project" && (() => {
          // Only Adrian's accounts
          const adrianAccounts = shadowAccounts.filter(a => (a.pic || '').toLowerCase() === 'adrian');
          // Compute shadow msgs from customChatters (filtered) or allTimeUsers (all time)
          const shadowUsernames = new Set(adrianAccounts.map(a => a.username.toLowerCase()));
          const shadowMsgMap = {};
          const source = isFiltered ? (customChatters || []) : allTimeUsers;
          source.forEach(r => {
            const u = (r.username || '').toLowerCase();
            if (shadowUsernames.has(u)) {
              shadowMsgMap[u] = r.msgs;
            }
          });
          const enriched = adrianAccounts.map(a => ({
            ...a,
            liveMsgs: shadowMsgMap[a.username.toLowerCase()] || 0,
          }));
          const shadowTotal = enriched.reduce((s, a) => s + a.liveMsgs, 0);
          const ratio = totalMsgs > 0 ? ((shadowTotal / totalMsgs) * 100).toFixed(2) : "0.00";
          const smartAccounts = enriched.filter((a) => a.role === "smart");
          const supportAccounts = enriched.filter((a) => a.role === "support");

          return (<>
            <Ti sub="Akun-akun shadow yang dioperasikan oleh Adrian">Shadow Project Accounts</Ti>

            <div className="stats-grid">
              <St label="Total Akun" value={enriched.length} sub={`${smartAccounts.length} smart · ${supportAccounts.length} support`} />
              <St label="Total Messages" value={shadowTotal.toLocaleString()} sub={`dari ${totalMsgs.toLocaleString()} total`} color={shadowTotal === 0 ? "#6b7280" : "#ef4444"} />
              <St label="Rasio Shadow / Total" value={`${ratio}%`} sub={`${shadowTotal.toLocaleString()} / ${totalMsgs.toLocaleString()}`} color={shadowTotal === 0 ? "#6b7280" : "#f97316"} />
            </div>

            <Ti sub="Detail semua akun shadow project">Daftar Akun</Ti>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Username</th><th>Display</th><th>Role</th><th>Messages</th><th>Karakter</th></tr></thead>
                <tbody>
                  {enriched.map((a, i) => (
                    <tr key={a.username}>
                      <td className="td-rank">{i + 1}</td>
                      <td className="td-user">{a.username}</td>
                      <td className="td-period">{a.display_name}</td>
                      <td><span className={`badge ${a.role === "smart" ? "badge-active" : "badge-churned"}`}>{(a.role || 'support').toUpperCase()}</span></td>
                      <td className="td-msgs">{a.liveMsgs.toLocaleString()}</td>
                      <td style={{ fontSize: 11, color: "#9ca3af", maxWidth: 300 }}>{a.character_desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>);
        })()}

        {/* ============ ADMIN ============ */}
        {tab === "Admin" && <AdminTab onSaved={silentRefresh} token={token} />}
      </main>
    </div>
  );
}
