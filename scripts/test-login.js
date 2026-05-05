// Test endpoint /api/auth langsung ke server (skip browser/Vite proxy).
// Pakai: node scripts/test-login.js

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}/api/auth`;

const body = { email: 'discord@orovagroup.id', password: 'discord123234' };

console.log(`\nPOST ${URL}`);
console.log('Body:', JSON.stringify(body));
console.log();

try {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log('Status:', res.status, res.statusText);
  console.log('Body  :', text);
  if (res.ok) {
    console.log('\n✓ LOGIN BERHASIL DARI SCRIPT.');
    console.log('  Kalau di browser masih gagal: cache/localStorage/proxy issue.');
  } else if (res.status === 401) {
    console.log('\n❌ Server return 401 — DB/env yang dipakai server BERBEDA dari yang dipakai diag-login.');
    console.log('  Server kemungkinan dimulai SEBELUM .env di-update.');
    console.log('  Solusi: kill semua process node, restart npm run dev.');
  } else {
    console.log(`\n❌ Status ${res.status} — cek log server.`);
  }
} catch (err) {
  console.log('❌ FETCH ERROR:', err.message);
  console.log('  Server tidak jalan di port', PORT, '. Jalankan: npm run dev');
}
