import { useState, useEffect, useRef } from "react";

// ---- CSV Parser (handles quoted fields, multiline, etc.) ----
function parseCSV(rawText) {
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let i = 0, n = text.length;
  while (i < n) {
    const row = [];
    while (i < n && text[i] !== '\n') {
      if (text[i] === '"') {
        let cell = '', j = i + 1;
        while (j < n) {
          if (text[j] === '"' && text[j + 1] === '"') { cell += '"'; j += 2; }
          else if (text[j] === '"') { j++; break; }
          else { cell += text[j++]; }
        }
        row.push(cell);
        i = j;
        if (i < n && text[i] === ',') i++;
      } else {
        let start = i;
        while (i < n && text[i] !== ',' && text[i] !== '\n') i++;
        row.push(text.slice(start, i));
        if (i < n && text[i] === ',') i++;
      }
    }
    if (i < n && text[i] === '\n') i++;
    if (row.length > 1 || (row.length === 1 && row[0] !== '')) rows.push(row);
  }
  return rows;
}

// ---- Detect which CSV format this is ----
// Format A (Data Chat1.csv): col0=username, col1=date (YYYY/MM/DD or M/D/YYYY), col2=content
// Format B (Data Chat2.csv): col0=username, col4=date, col1=content
// Format Suli: col0=username, col4=date, col1=content  (same as B)
function detectFormat(headers) {
  const h = headers.map(s => s.trim().toLowerCase());
  // heuristic: if header[1] looks like 'date' or 'timestamp' → format A
  // if header[4] looks like 'date' → format B
  if (h[1] && (h[1].includes('date') || h[1].includes('time'))) return 'A';
  if (h[4] && (h[4].includes('date') || h[4].includes('time'))) return 'B';
  return 'A'; // default
}

function parseDate(raw) {
  const s = String(raw || '').trim();
  let dateStr = null;
  let timeStr = null;

  // Try to extract date part
  // YYYY/MM/DD or YYYY-MM-DD
  let m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) dateStr = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // M/D/YYYY or MM/DD/YYYY
  if (!dateStr) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) dateStr = `${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // M/D/YY or MM/DD/YY (2-digit year → 20xx)
  if (!dateStr) {
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s|$)/);
    if (m) dateStr = `20${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  }
  // DD-Mon-YYYY
  if (!dateStr) {
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    m = s.match(/^(\d{1,2})[\/\-]([A-Za-z]{3})[\/\-](\d{4})/);
    if (m) dateStr = `${m[3]}-${months[m[2].toLowerCase()] || '01'}-${m[1].padStart(2,'0')}`;
  }
  if (!dateStr) return null;

  // Try to extract time part: "5:51:41 PM" or "17:51:41" or "5:51 PM"
  const timeMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (timeMatch) {
    let h = parseInt(timeMatch[1]);
    const min = timeMatch[2];
    const sec = timeMatch[3] || '00';
    const ampm = (timeMatch[4] || '').toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    timeStr = `${String(h).padStart(2,'0')}:${min}:${sec}`;
  }

  return { date: dateStr, time: timeStr };
}

// ---- Parse one CSV text into raw messages for chat_messages table ----
function parseOneCsv(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return null;

  const headers = rows[0];
  const fmt = detectFormat(headers);
  const dateCol = fmt === 'A' ? 1 : 4;
  const contentCol = fmt === 'A' ? 2 : 1;

  const rawRows = []; // {username, msg_datetime, content}
  let counter = 0; // sub-millisecond counter for rows with same timestamp
  let skippedNoUser = 0, skippedNoDate = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const username = (row[0] || '').trim();
    if (!username) { skippedNoUser++; continue; }
    const parsed = parseDate(row[dateCol]);
    if (!parsed) { skippedNoDate++; continue; }
    const content = (row[contentCol] || '').trim() || 'EMPTY';

    // Use real time if available, else generate unique timestamp
    const time = parsed.time || `00:00:${String(Math.floor(counter / 1000) % 60).padStart(2, '0')}`;
    const ms = String(counter % 1000).padStart(3, '0');
    const ts = `${parsed.date}T${time}.${ms}+00:00`;
    counter++;
    if (counter >= 60000) counter = 0;

    rawRows.push({ username, msg_datetime: ts, content });
  }

  const info = { rawRows, totalCsvRows: rows.length - 1, skippedNoUser, skippedNoDate };
  return rawRows.length > 0 ? info : null;
}

// ---- Merge multiple parsed results (just concatenate rawRows) ----
function mergeResults(results) {
  let allRawRows = [];
  for (const r of results) {
    if (!r || !r.rawRows) continue;
    allRawRows = allRawRows.concat(r.rawRows);
  }
  return { rawRows: allRawRows };
}

// ---- Shared input style ----
const F = {
  inp: { background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#f1f5f9', padding: '6px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box', outline: 'none' },
  inpSm: { background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#f1f5f9', padding: '6px 10px', fontSize: 13, width: 72, boxSizing: 'border-box', outline: 'none' },
  del: { color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px', flexShrink: 0 },
  edit: { color: '#94a3b8', background: 'none', border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', fontSize: 11, padding: '3px 10px' },
  label: { fontSize: 11, color: '#64748b', marginBottom: 4, display: 'block' },
};

// ---- ManualDataSection ----
function ManualDataSection({ onSaved, token }) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const [panel, setPanel] = useState('root_causes');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [rcRows, setRcRows] = useState([]);
  const [arcRows, setArcRows] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [shadowRows, setShadowRows] = useState([]);
  const [openMsgCat, setOpenMsgCat] = useState(null);
  const [complaintFiles, setComplaintFiles] = useState([]);
  const complaintRef = useRef();
  const [analyzingComplaints, setAnalyzingComplaints] = useState(false);
  const [complaintLog, setComplaintLog] = useState([]);

  useEffect(() => {
    fetch('/api/admin/manual', { headers: authHeaders })
      .then(r => r.json())
      .then(d => {
        setRcRows(d.rootCauses || []);
        setArcRows(d.storyArc || []);
        setShadowRows((d.shadowAccounts || []).filter(a => (a.pic || '').toLowerCase() === 'adrian'));
        const msgsMap = {};
        (d.complaintMsgs || []).forEach(m => {
          if (!msgsMap[m.category_id]) msgsMap[m.category_id] = [];
          msgsMap[m.category_id].push(m);
        });
        setCatRows((d.complaintCats || []).map(c => ({
          ...c,
          all_time_count: (msgsMap[c.id] || []).length,
          recent_count: 0,
          messages: msgsMap[c.id] || [],
        })));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  async function save(type, rows) {
    setSaving(true); setSaveMsg('');
    try {
      const r = await fetch('/api/admin/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ type, rows }),
      });
      const j = await r.json();
      setSaveMsg(j.ok ? `✓ Tersimpan (${j.saved} baris)` : `✗ ${j.error}`);
      if (j.ok) onSaved?.();
    } catch (e) { setSaveMsg(`✗ ${e.message}`); }
    setSaving(false);
    setTimeout(() => setSaveMsg(''), 3000);
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'utf-8');
    });
  }

  const DEFAULT_KEYWORDS = 'rugi, loss, kecewa, bohong, tipu, scam, keluar, exit, marah, nyesel, kapok, zonk, boros, mahal, sia-sia, percuma, menyesal, refund, mundur, resign, berhenti, ditipu, buang uang, ga worth, gak worth, tidak worth, overpriced, kecele, komplain, complaint, complain, jelek, payah, gak berguna, mengecewakan, menipu, penipuan, ngedumel, ngeluh, nyalahin';
  const [keywordsText, setKeywordsText] = useState(() => {
    try { return localStorage.getItem('complaint_keywords') || DEFAULT_KEYWORDS; } catch { return DEFAULT_KEYWORDS; }
  });
  const COMPLAINT_KEYWORDS = keywordsText.split(',').map(k => k.trim().toLowerCase()).filter(Boolean);

  async function runComplaintAnalysis() {
    if (!catRows.length) { setComplaintLog(['⚠ Tambah kategori dulu sebelum analisis.']); return; }
    setAnalyzingComplaints(true);
    setComplaintLog(['Filtering by keywords (server-side)...']);

    try {
      const categories = catRows.map(c => ({ theme: c.theme, color: c.color || '#6366f1' }));

      const res = await fetch('/api/admin/analyze-complaints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ categories, keywords: COMPLAINT_KEYWORDS }),
      });
      const json = await res.json();

      if (!res.ok || !json.ok) {
        setComplaintLog(prev => [...prev, `✗ Error: ${json.error}`]);
        setAnalyzingComplaints(false);
        return;
      }

      setComplaintLog(prev => [...prev, `${json.filtered || 0} pesan dikirim ke AI.`]);

      const aiMap = {};
      json.categories.forEach(c => { aiMap[c.theme] = c; });
      const updatedCats = catRows.map(c => {
        const ai = aiMap[c.theme];
        if (!ai) return c;
        const newMsgs = (ai.messages || []).map(m => ({
          msg_date: m.date || '',
          username: m.username || '',
          content: m.content || '',
          is_recent: false,
        }));
        return { ...c, all_time_count: newMsgs.length, recent_count: 0, messages: newMsgs };
      });
      setCatRows(updatedCats);

      setComplaintLog(prev => [...prev, '✓ Analisis selesai! Menyimpan ke database...']);
      await save('complaint_categories', updatedCats);
      const totalComp = updatedCats.reduce((s, c) => s + (c.messages?.length || 0), 0);
      setComplaintLog(prev => [...prev, `✓ ${totalComp} keluhan tersimpan!`]);
      onSaved?.();
    } catch (err) {
      setComplaintLog(prev => [...prev, `✗ ${err.message}`]);
    }
    setAnalyzingComplaints(false);
  }

  const tabBtn = (key, label) => (
    <button onClick={() => setPanel(key)} style={{
      padding: '7px 18px', fontSize: 12, fontWeight: panel === key ? 700 : 400, cursor: 'pointer',
      background: panel === key ? '#2A62FF' : '#1e293b',
      color: panel === key ? '#fff' : '#94a3b8',
      border: '1px solid ' + (panel === key ? '#2A62FF' : '#334155'),
      borderRadius: 6,
    }}>{label}</button>
  );

  if (!loaded) return <div style={{ marginTop: 40, color: '#64748b', fontSize: 13 }}>Loading...</div>;

  return (
    <div style={{ marginTop: 40 }}>
      <div className="section-title">
        <h2>Manual Data</h2>
        <p className="mono-xs">Edit data yang tidak bisa dihitung otomatis dari CSV</p>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabBtn('root_causes', 'Root Causes')}
        {tabBtn('story_arc', 'Story Arc')}
        {tabBtn('complaints', 'Complaints')}
        {tabBtn('shadow_accounts', 'Shadow Accounts')}
      </div>

      {/* ======== ROOT CAUSES ======== */}
      {panel === 'root_causes' && (
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {rcRows.length === 0 && (
              <div style={{ padding: '20px 24px', color: '#475569', fontSize: 13 }}>Belum ada data. Klik "+ Tambah" untuk mulai.</div>
            )}
            {rcRows.map((r, i) => (
              <div key={i} style={{ padding: '16px 20px', borderBottom: i < rcRows.length - 1 ? '1px solid #1e293b' : 'none' }}>
                <div style={{ display: 'flex', gap: 12 }}>
                  {/* Left: fields */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <div style={{ flex: 1 }}>
                        <span style={F.label}>Cause</span>
                        <input style={F.inp} placeholder="e.g. Content delivery stopped" value={r.cause || ''}
                          onChange={e => setRcRows(prev => prev.map((x, idx) => idx === i ? { ...x, cause: e.target.value } : x))} />
                      </div>
                      <div style={{ width: 80 }}>
                        <span style={F.label}>Percentage %</span>
                        <input style={F.inpSm} type="number" min="0" max="100" placeholder="40" value={r.percentage ?? ''}
                          onChange={e => setRcRows(prev => prev.map((x, idx) => idx === i ? { ...x, percentage: e.target.value } : x))} />
                      </div>
                    </div>
                    <div>
                      <span style={F.label}>Description</span>
                      <input style={F.inp} placeholder="e.g. Suli disengaged 2-3 months. Morning calls inconsistent." value={r.description || ''}
                        onChange={e => setRcRows(prev => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                    </div>
                  </div>
                  {/* Right: preview + delete */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'space-between', minWidth: 80 }}>
                    <button style={F.del} title="Hapus" onClick={() => setRcRows(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                    <span style={{ fontSize: 22, fontWeight: 800, color: '#ef4444' }}>{r.percentage || 0}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => setRcRows(prev => [...prev, { cause: '', percentage: 0, description: '' }])}>+ Tambah</button>
            <button className="btn-action" onClick={() => save('root_causes', rcRows)} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
          </div>
        </div>
      )}

      {/* ======== STORY ARC ======== */}
      {panel === 'story_arc' && (
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {arcRows.length === 0 && (
              <div style={{ padding: '20px 24px', color: '#475569', fontSize: 13 }}>Belum ada data.</div>
            )}
            {arcRows.map((r, i) => (
              <div key={i} style={{ padding: '16px 20px', borderBottom: i < arcRows.length - 1 ? '1px solid #1e293b' : 'none', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {/* Color bar preview */}
                <div style={{ width: 4, borderRadius: 4, background: r.color || '#6366f1', alignSelf: 'stretch', flexShrink: 0 }} />
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <div style={{ flex: 1 }}>
                      <span style={F.label}>Phase Name</span>
                      <input style={F.inp} placeholder="e.g. Honeymoon Phase" value={r.phase || ''}
                        onChange={e => setArcRows(prev => prev.map((x, idx) => idx === i ? { ...x, phase: e.target.value } : x))} />
                    </div>
                    <div>
                      <span style={F.label}>Warna</span>
                      <input type="color" value={r.color || '#6366f1'}
                        onChange={e => setArcRows(prev => prev.map((x, idx) => idx === i ? { ...x, color: e.target.value } : x))}
                        style={{ width: 40, height: 34, border: '1px solid #334155', borderRadius: 5, cursor: 'pointer', background: 'none', padding: 2 }} />
                    </div>
                  </div>
                  <div>
                    <span style={F.label}>Description</span>
                    <input style={F.inp} placeholder="e.g. Members excited, high engagement, low complaints" value={r.description || ''}
                      onChange={e => setArcRows(prev => prev.map((x, idx) => idx === i ? { ...x, description: e.target.value } : x))} />
                  </div>
                </div>
                <button style={{ ...F.del, marginTop: 18 }} onClick={() => setArcRows(prev => prev.filter((_, idx) => idx !== i))}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => setArcRows(prev => [...prev, { phase: '', description: '', color: '#6366f1' }])}>+ Tambah</button>
            <button className="btn-action" onClick={() => save('story_arc', arcRows)} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
          </div>
        </div>
      )}

      {/* ======== COMPLAINT CATEGORIES ======== */}
      {panel === 'complaints' && (
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {catRows.length === 0 && (
              <div style={{ padding: '16px 18px', color: '#475569', fontSize: 13 }}>Belum ada kategori. Klik "+ Tambah Kategori" untuk mulai.</div>
            )}
            {catRows.map((c, ci) => (
              <div key={ci} style={{ padding: '10px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: '1px solid #1e293b' }}>
                <input type="color" value={c.color || '#6366f1'}
                  onChange={e => setCatRows(prev => prev.map((x, idx) => idx === ci ? { ...x, color: e.target.value } : x))}
                  style={{ width: 28, height: 28, border: '1px solid #334155', borderRadius: 4, cursor: 'pointer', background: 'none', padding: 1, flexShrink: 0 }} />
                <input style={{ ...F.inp, fontWeight: 600, flex: 1 }} placeholder="Nama kategori" value={c.theme || ''}
                  onChange={e => setCatRows(prev => prev.map((x, idx) => idx === ci ? { ...x, theme: e.target.value } : x))} />
                <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace', minWidth: 40, textAlign: 'right' }}>{c.messages?.length || 0} msg</span>
                <button style={{ ...F.del }} onClick={() => { setCatRows(prev => prev.filter((_, idx) => idx !== ci)); setOpenMsgCat(null); }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => setCatRows(prev => [...prev, { theme: '', color: '#ef4444', all_time_count: 0, recent_count: 0, messages: [] }])}>+ Tambah Kategori</button>
            <button className="btn-action" onClick={() => save('complaint_categories', catRows)} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
          </div>
        </div>
      )}

      {/* ======== SHADOW ACCOUNTS ======== */}
      {panel === 'shadow_accounts' && (
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {shadowRows.length === 0 && (
              <div style={{ padding: '20px 24px', color: '#475569', fontSize: 13 }}>Belum ada akun shadow. Klik "+ Tambah Akun" untuk mulai.</div>
            )}
            {shadowRows.map((a, i) => (
              <div key={i} style={{ borderBottom: '1px solid #1e293b', padding: '12px 18px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ color: '#475569', fontSize: 12, fontWeight: 600, minWidth: 24, textAlign: 'right', marginTop: 20 }}>{i + 1}</div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <span style={F.label}>Username</span>
                      <input style={F.inp} placeholder="discord_username" value={a.username || ''}
                        onChange={e => setShadowRows(prev => prev.map((x, idx) => idx === i ? { ...x, username: e.target.value } : x))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <span style={F.label}>Display Name</span>
                      <input style={F.inp} placeholder="Nama tampilan" value={a.display_name || ''}
                        onChange={e => setShadowRows(prev => prev.map((x, idx) => idx === i ? { ...x, display_name: e.target.value } : x))} />
                    </div>
                    <div style={{ width: 100 }}>
                      <span style={F.label}>Role</span>
                      <select style={{ ...F.inp, cursor: 'pointer' }} value={a.role || 'support'}
                        onChange={e => setShadowRows(prev => prev.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x))}>
                        <option value="smart">Smart</option>
                        <option value="support">Support</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <span style={F.label}>Deskripsi Karakter</span>
                    <input style={F.inp} placeholder="Umur, sifat, ciri khas..." value={a.character_desc || ''}
                      onChange={e => setShadowRows(prev => prev.map((x, idx) => idx === i ? { ...x, character_desc: e.target.value } : x))} />
                  </div>
                </div>
                <button style={{ ...F.del, marginTop: 18 }} onClick={() => setShadowRows(prev => prev.filter((_, idx) => idx !== i))}>×</button>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn-secondary" onClick={() => setShadowRows(prev => [...prev, { username: '', display_name: '', pic: 'Adrian', character_desc: '', role: 'support' }])}>+ Tambah Akun</button>
            <button className="btn-action" onClick={() => save('shadow_accounts', shadowRows)} disabled={saving}>
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
            {saveMsg && <span style={{ fontSize: 12, color: saveMsg.startsWith('✓') ? '#4ade80' : '#f87171' }}>{saveMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Main AdminTab component ----
export default function AdminTab({ onSaved, token }) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState('idle'); // idle | parsing | uploading | analyzing | analyzing | done | error
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [dailySentFrom, setDailySentFrom] = useState('');
  const [dailySentTo, setDailySentTo] = useState('');
  const inputRef = useRef();

  function addLog(msg) {
    setLog(prev => [...prev, msg]);
  }

  async function handleRun() {
    if (files.length === 0) return;
    setLog([]);
    setStatus('parsing');

    try {
      // 1. Parse all CSVs into raw messages
      addLog(`Parsing ${files.length} file(s)...`);
      const parsedResults = [];
      const allFiles = [...files];
      for (const file of allFiles) {
        addLog(`  Reading ${file.name}...`);
        const text = await readFile(file);
        const result = parseOneCsv(text);
        if (result) {
          parsedResults.push(result);
          addLog(`  ✓ ${file.name}: ${result.rawRows.length} messages (CSV rows: ${result.totalCsvRows}, skipped: ${result.skippedNoUser} no user, ${result.skippedNoDate} no date)`);
        } else {
          addLog(`  ⚠ ${file.name}: no data found`);
        }
      }

      if (parsedResults.length === 0) {
        addLog('No data parsed. Check CSV format.');
        setStatus('error');
        return;
      }

      // 2. Merge
      addLog('Merging data...');
      const merged = mergeResults(parsedResults);
      addLog(`  Total: ${merged.rawRows.length} raw messages`);

      // 3. Upload to backend in chunks (to handle 600K+ rows)
      setStatus('uploading');
      const allRows = merged.rawRows;
      const CHUNK = 10000;
      const totalChunks = Math.ceil(allRows.length / CHUNK);
      addLog(`Uploading ${allRows.length.toLocaleString()} messages in ${totalChunks} chunks...`);

      // First chunk sends isFirst=true to trigger date-range cleanup
      // Last chunk sends isLast=true to trigger MV refresh
      for (let c = 0; c < totalChunks; c++) {
        const chunk = allRows.slice(c * CHUNK, (c + 1) * CHUNK);
        setProgress({ current: c + 1, total: totalChunks });
        addLog(`  Chunk ${c + 1}/${totalChunks} (${chunk.length} rows)...`);

        const uploadRes = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ rows: chunk, isFirst: c === 0, isLast: c === totalChunks - 1 }),
        });
        let uploadJson;
        try {
          uploadJson = await uploadRes.json();
        } catch {
          addLog(`Upload failed: server returned invalid response (status ${uploadRes.status}).`);
          setStatus('error');
          return;
        }
        if (!uploadRes.ok || !uploadJson.ok) {
          addLog(`Upload failed: ${uploadJson.error}`);
          setStatus('error');
          return;
        }
        (uploadJson.log || []).forEach(l => addLog(`    ${l}`));
      }

      addLog('');
      addLog(`✓ Upload selesai! ${allRows.length.toLocaleString()} messages tersimpan.`);
      setStatus('done');
      onSaved?.();
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus('error');
    }
  }

  // ---- Helper: run AI analysis in batches with progress ----
  async function runAnalysisBatched(fromDate, toDate) {
    const BATCH_DAYS = 7;
    // Generate all dates
    const days = [];
    let cur = new Date(fromDate + 'T00:00:00Z');
    const end = new Date(toDate + 'T00:00:00Z');
    while (cur <= end) {
      days.push(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    const totalDays = days.length;
    const totalBatches = Math.ceil(totalDays / BATCH_DAYS);
    let analyzed = 0;

    addLog(`Total: ${totalDays} hari, ${totalBatches} batch`);
    addLog('');

    for (let b = 0; b < totalBatches; b++) {
      const batchStart = days[b * BATCH_DAYS];
      const batchEnd = days[Math.min((b + 1) * BATCH_DAYS - 1, totalDays - 1)];
      const pct = Math.round(((b + 1) / totalBatches) * 100);
      setProgress({ current: b + 1, total: totalBatches });

      addLog(`[${b + 1}/${totalBatches}] ${batchStart} → ${batchEnd} (${pct}%)...`);

      const res = await fetch('/api/admin/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ dateFrom: batchStart, dateTo: batchEnd, batchSize: BATCH_DAYS }),
      });

      let json;
      try { json = await res.json(); } catch {
        addLog(`  ⚠ Batch ${b + 1} failed: invalid response`);
        continue;
      }
      if (!res.ok || !json.ok) {
        addLog(`  ⚠ Batch ${b + 1} failed: ${json.error || 'Unknown'}`);
        continue;
      }
      analyzed += json.analyzed || 0;
      (json.log || []).forEach(l => addLog(`  ${l}`));
    }

    addLog('');
    addLog(`✓ Sentiment + Topics: ${analyzed}/${totalDays} hari.`);
    return analyzed;
  }

  // ---- Refresh All AI: auto-detect date range from chat_messages ----
  async function handleRefreshAll() {
    setLog([]);
    setStatus('analyzing');
    try {
      addLog('Detecting date range from chat_messages...');
      const rangeRes = await fetch('/api/admin/chat-data?action=date-range', { headers: authHeaders });
      const rangeJson = await rangeRes.json();
      if (!rangeRes.ok || !rangeJson.minDate || !rangeJson.maxDate) {
        addLog(`⚠ ${rangeJson.error || 'Tidak ada data di chat_messages. Upload dulu.'}`);
        setStatus('error');
        return;
      }
      const fromDate = rangeJson.minDate;
      const toDate = rangeJson.maxDate;
      setDailySentFrom(fromDate);
      setDailySentTo(toDate);
      addLog(`Date range: ${fromDate} → ${toDate} (${rangeJson.totalMsgs.toLocaleString()} messages)`);
      addLog('');
      addLog('=== Step 1: Sentiment + Topics ===');

      await runAnalysisBatched(fromDate, toDate);

      // Step 2: Complaint analysis (server-side filtering)
      if (catRows.length > 0 && COMPLAINT_KEYWORDS.length > 0) {
        addLog('');
        addLog('=== Step 2: Complaint Analysis ===');
        addLog(`Filtering by ${COMPLAINT_KEYWORDS.length} keywords (server-side)...`);

        const categories = catRows.map(c => ({ theme: c.theme, color: c.color || '#6366f1' }));

        const compRes = await fetch('/api/admin/analyze-complaints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ categories, keywords: COMPLAINT_KEYWORDS }),
        });
        const compJson = await compRes.json();

        if (compRes.ok && compJson.ok) {
          addLog(`${compJson.filtered || 0} pesan dikirim ke AI untuk klasifikasi.`);
          const aiMap = {};
          compJson.categories.forEach(c => { aiMap[c.theme] = c; });
          const updatedCats = catRows.map(c => {
            const ai = aiMap[c.theme];
            if (!ai) return c;
            const newMsgs = (ai.messages || []).map(m => ({
              msg_date: m.date || '', username: m.username || '', content: m.content || '', is_recent: false,
            }));
            return { ...c, all_time_count: newMsgs.length, recent_count: 0, messages: newMsgs };
          });
          setCatRows(updatedCats);
          await save('complaint_categories', updatedCats);

          const totalComp = updatedCats.reduce((s, c) => s + (c.messages?.length || 0), 0);
          addLog(`✓ ${totalComp} keluhan diklasifikasi ke ${updatedCats.length} kategori.`);
        } else {
          addLog(`⚠ Complaint analysis error: ${compJson.error || 'Unknown'}`);
        }
      } else {
        addLog('⏭ Complaint analysis dilewati (belum ada kategori/keywords).');
      }

      addLog('');
      addLog('✓ Semua AI analysis selesai!');
      setStatus('done');
      onSaved?.();
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus('error');
    }
  }

  // ---- AI Sentiment + Topics Analysis (custom date range) ----
  async function handleAnalyze() {
    if (!dailySentFrom || !dailySentTo) {
      setLog(['⚠ Pilih date range dulu (From → To)']);
      return;
    }
    setLog([]);
    setStatus('analyzing');
    try {
      addLog(`AI Analysis: ${dailySentFrom} → ${dailySentTo}`);
      await runAnalysisBatched(dailySentFrom, dailySentTo);
      addLog('');
      addLog('✓ Selesai!');
      setStatus('done');
      onSaved?.();
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus('error');
    }
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file, 'utf-8');
    });
  }

  const isRunning = status === 'parsing' || status === 'uploading' || status === 'analyzing' || status === 'analyzing';

  const FileCard = ({ inputRef: ref, label, sub, files: f, setFiles: setF, icon }) => (
    <div
      onClick={() => !isRunning && ref.current.click()}
      style={{
        flex: 1, minWidth: 0, background: f.length > 0 ? '#0c1a2e' : '#111116',
        border: `1px solid ${f.length > 0 ? '#2A62FF44' : '#1e1e28'}`,
        borderRadius: 10, padding: '14px 16px', cursor: isRunning ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s', position: 'relative', overflow: 'hidden',
      }}
      onMouseEnter={e => { if (!isRunning) e.currentTarget.style.borderColor = '#2A62FF66'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = f.length > 0 ? '#2A62FF44' : '#1e1e28'; }}
    >
      <input ref={ref} type="file" accept=".csv" multiple style={{ display: 'none' }}
        onChange={e => setF(Array.from(e.target.files))} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{icon}</span>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{label}</span>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>{sub}</div>
      {f.length > 0 ? (
        <div style={{ fontSize: 11, color: '#60a5fa' }}>
          {f.map(x => <div key={x.name}>{x.name} {x.size > 1024 * 1024 ? `(${(x.size / 1024 / 1024).toFixed(1)} MB)` : ''}</div>)}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>Klik untuk pilih file...</div>
      )}
      {f.length > 0 && <div style={{ position: 'absolute', top: 10, right: 12, width: 8, height: 8, borderRadius: '50%', background: '#2A62FF' }} />}
    </div>
  );

  return (
    <div>
      {/* ===== UPLOAD SECTION ===== */}
      <div className="section-title" style={{ marginTop: 8 }}>
        <h2>Upload Chat Data</h2>
        <p className="mono-xs">Upload CSV ke database, lalu jalankan AI analysis terpisah</p>
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <FileCard inputRef={inputRef} label="Chat CSV" sub="Semua data chat Discord" files={files} setFiles={setFiles} icon="💬" />
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn-action"
          style={{ padding: '10px 28px', fontSize: 14 }}
          onClick={handleRun}
          disabled={isRunning || files.length === 0}
        >
          {status === 'parsing' ? '⏳ Parsing...' :
           status === 'uploading' ? '⏳ Uploading...' :
           '▶ Upload Data ke Database'}
        </button>
        {status === 'done' && <span style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Selesai!</span>}
      </div>

      {/* AI Analysis (Sentiment + Topics — daily) */}
      <div style={{ marginTop: 16, background: '#0a1020', border: '1px solid #1e3a5f', borderRadius: 10, padding: '14px 16px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#60a5fa', marginBottom: 2 }}>🤖 AI Analysis (Sentiment + Topics + Complaints)</div>
        <div style={{ fontSize: 10, color: '#475569', marginBottom: 10 }}>
          Analisis per hari dari chat_messages. Pilih mode: custom date, hari ini, atau refresh semua.
        </div>

        {/* Quick buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button className="btn-action" style={{ padding: '8px 20px', fontSize: 12, background: '#059669', borderColor: '#059669' }}
            onClick={() => { const t = new Date().toISOString().slice(0, 10); setDailySentFrom(t); setDailySentTo(t); }}
            disabled={isRunning}>
            📅 Set Hari Ini
          </button>
          <button className="btn-action" style={{ padding: '8px 20px', fontSize: 12, background: '#2563eb', borderColor: '#2563eb' }}
            onClick={() => { const t = new Date(); const f = new Date(t); f.setDate(f.getDate() - 6); setDailySentFrom(f.toISOString().slice(0, 10)); setDailySentTo(t.toISOString().slice(0, 10)); }}
            disabled={isRunning}>
            📅 Set 7 Hari
          </button>
        </div>

        {/* Date pickers + action buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={dailySentFrom} onChange={e => setDailySentFrom(e.target.value)} className="date-input" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#f1f5f9', padding: '6px 10px', fontSize: 12 }} />
          <span style={{ color: '#475569', fontSize: 11 }}>→</span>
          <input type="date" value={dailySentTo} onChange={e => setDailySentTo(e.target.value)} className="date-input" style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 5, color: '#f1f5f9', padding: '6px 10px', fontSize: 12 }} />
          <button className="btn-action" style={{ padding: '8px 20px', fontSize: 12, background: '#7c3aed', borderColor: '#7c3aed' }} onClick={handleAnalyze} disabled={isRunning || !dailySentFrom || !dailySentTo}>
            {status === 'analyzing' ? `⏳ ${progress.current}/${progress.total} batch...` : '🤖 Run Custom Date'}
          </button>
        </div>

        {/* Refresh All */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn-action" style={{ padding: '8px 20px', fontSize: 12, background: '#dc2626', borderColor: '#dc2626' }} onClick={handleRefreshAll} disabled={isRunning}>
            {status === 'analyzing' ? `⏳ ${progress.current}/${progress.total} batch...` : '🔄 Refresh All AI (semua tanggal)'}
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 10, color: '#f59e0b', lineHeight: 1.5 }}>
          ⚠ Refresh All AI hanya bisa dijalankan di server langsung (localhost). Akan timeout jika dijalankan dari Vercel. Hubungi General Ops.
        </div>
      </div>

      {log.length > 0 && (
        <div style={{
          marginTop: 12, background: '#0a0f1a', border: '1px solid #1e293b', borderRadius: 8,
          padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: '#94a3b8',
          maxHeight: 240, overflowY: 'auto', lineHeight: 1.7,
        }}>
          {log.map((l, i) => (
            <div key={i} style={{ color: l.startsWith('  ✓') ? '#4ade80' : l.startsWith('  ⚠') ? '#fbbf24' : l.startsWith('Error') ? '#f87171' : '#94a3b8' }}>
              {l || '\u00a0'}
            </div>
          ))}
        </div>
      )}

      {/* ===== MANUAL DATA SECTION ===== */}
      <ManualDataSection onSaved={onSaved} token={token} />

      {/* ===== USER MANAGEMENT ===== */}
      <UserManagement token={token} />
    </div>
  );
}

// ---- User Management Component ----
function UserManagement({ token }) {
  const authHeaders = { Authorization: `Bearer ${token}` };
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newPass, setNewPass] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [msg, setMsg] = useState('');
  const [editId, setEditId] = useState(null);
  const [editPass, setEditPass] = useState('');
  const [editRole, setEditRole] = useState('');

  async function loadUsers() {
    const res = await fetch('/api/admin/users', { headers: authHeaders });
    if (res.ok) setUsers(await res.json());
    setLoading(false);
  }

  useEffect(() => { loadUsers(); }, []);

  async function addUser(e) {
    e.preventDefault();
    setMsg('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ email: newEmail, password: newPass, role: newRole }),
    });
    const j = await res.json();
    if (res.ok) { setMsg('User ditambahkan'); setNewEmail(''); setNewPass(''); setNewRole('user'); loadUsers(); }
    else setMsg(j.error || 'Gagal');
  }

  async function updateUser(id) {
    const body = {};
    if (editPass) body.password = editPass;
    if (editRole) body.role = editRole;
    const res = await fetch('/api/admin/users', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify({ id, ...body }),
    });
    if (res.ok) { setEditId(null); setEditPass(''); setEditRole(''); loadUsers(); setMsg('User diupdate'); }
    else { const j = await res.json(); setMsg(j.error || 'Gagal'); }
  }

  async function deleteUser(id, email) {
    if (!confirm(`Hapus user ${email}?`)) return;
    const res = await fetch('/api/admin/users', { method: 'DELETE', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ id }) });
    if (res.ok) { loadUsers(); setMsg('User dihapus'); }
    else { const j = await res.json(); setMsg(j.error || 'Gagal'); }
  }

  const sectionStyle = { marginTop: 32, background: '#111116', borderRadius: 12, border: '1px solid #1e1e28', padding: 20 };
  const inputStyle = { padding: '8px 12px', background: '#09090b', border: '1px solid #2a2a3a', borderRadius: 6, color: '#f1f5f9', fontSize: 13 };
  const btnStyle = { padding: '8px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 };

  return (
    <div style={sectionStyle}>
      <h3 style={{ color: '#f1f5f9', fontSize: 16, marginBottom: 16 }}>User Management</h3>
      {msg && <div style={{ color: msg.includes('Gagal') || msg.includes('error') ? '#f87171' : '#4ade80', fontSize: 13, marginBottom: 12 }}>{msg}</div>}

      {/* Add user form */}
      <form onSubmit={addUser} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'end' }}>
        <div>
          <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 4, textTransform: 'uppercase' }}>Email</label>
          <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@example.com" required style={{ ...inputStyle, width: 220 }} />
        </div>
        <div>
          <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 4, textTransform: 'uppercase' }}>Password</label>
          <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Password" required style={{ ...inputStyle, width: 160 }} />
        </div>
        <div>
          <label style={{ display: 'block', color: '#6b7280', fontSize: 10, marginBottom: 4, textTransform: 'uppercase' }}>Role</label>
          <select value={newRole} onChange={e => setNewRole(e.target.value)} style={{ ...inputStyle, width: 100 }}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <button type="submit" style={{ ...btnStyle, background: '#2A62FF', color: '#fff' }}>Tambah User</button>
      </form>

      {/* User list */}
      {loading ? <div style={{ color: '#6b7280' }}>Loading...</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #1e1e28' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Email</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Role</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Created</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280', fontSize: 10, textTransform: 'uppercase' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(30,30,40,0.4)' }}>
                  <td style={{ padding: '8px 12px', color: '#f1f5f9' }}>{u.email}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {editId === u.id ? (
                      <select value={editRole || u.role} onChange={e => setEditRole(e.target.value)} style={{ ...inputStyle, width: 90, padding: '4px 8px' }}>
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    ) : (
                      <span style={{ color: u.role === 'admin' ? '#f59e0b' : '#6b7280', fontWeight: 600, fontSize: 12 }}>{u.role.toUpperCase()}</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', color: '#6b7280', fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString('id-ID')}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    {editId === u.id ? (
                      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                        <input type="password" value={editPass} onChange={e => setEditPass(e.target.value)} placeholder="New password (kosong = tidak ganti)" style={{ ...inputStyle, width: 200, padding: '4px 8px', fontSize: 12 }} />
                        <button onClick={() => updateUser(u.id)} style={{ ...btnStyle, background: '#4ade80', color: '#000', padding: '4px 12px' }}>Save</button>
                        <button onClick={() => { setEditId(null); setEditPass(''); setEditRole(''); }} style={{ ...btnStyle, background: '#374151', color: '#9ca3af', padding: '4px 12px' }}>Cancel</button>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => { setEditId(u.id); setEditRole(u.role); }} style={{ ...btnStyle, background: '#1e293b', color: '#94a3b8', padding: '4px 12px' }}>Edit</button>
                        <button onClick={() => deleteUser(u.id, u.email)} style={{ ...btnStyle, background: '#1e293b', color: '#f87171', padding: '4px 12px' }}>Hapus</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
