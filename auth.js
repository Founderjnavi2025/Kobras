// KO-BRAS · auth.js — versi final (bersih)
window.KB_ERROR = null;
try {
  (function () {
    const cfg = window.KOBRAS_CONFIG || {};
    if (typeof window.supabase === "undefined") throw new Error("Supabase CDN gagal load");
    
    const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const KB = { supabase, cfg };
    const $ = (id) => document.getElementById(id);

    // --- FUNGSI PROFILE SETUP ---
    function initProfileSetup() {
      const form = $("profileForm");
      if (!form) return;

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("submitBtn");
        const errEl = $("formError");
        
        if (errEl) errEl.hidden = true;
        btn.disabled = true; btn.textContent = "Menyimpan...";

        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) throw new Error("Sesi habis. Silakan login ulang.");

          const type = user.user_metadata?.account_type === "konveksi" ? "konveksi" : "garment";
          const name = form.name.value.trim();
          const city = form.city.value.trim() || null;
          const province = form.province.value.trim() || null;

          if (name.length < 3) throw new Error("Nama usaha minimal 3 karakter.");

          const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "usaha";
          const slug = base + "-" + user.id.slice(0, 6);

          const { error } = await supabase
            .from("organizations")
            .insert({ name, slug, type, city, province, created_by: user.id })
            .select()
            .single();

          if (error) throw error;

          window.location.href = type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html";
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message || "Terjadi kesalahan sistem.";
            errEl.hidden = false;
          }
          btn.disabled = false; btn.textContent = "Simpan & Lanjut";
        }
      });
    }

    // --- FUNGSI AUTH LAINNYA ---
    KB.requireAnon = async function (page) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: org } = await supabase.from("organizations").select("type").eq("created_by", session.user.id).maybeSingle();
        return (location.href = org ? (org.type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html") : "profile-setup.html");
      }
      if (page === "login") $("loginForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Memproses...";
        const { error } = await supabase.auth.signInWithPassword({ email: e.target.email.value, password: e.target.password.value });
        if (error) { $("formError").textContent = error.message; $("formError").hidden = false; btn.disabled = false; btn.textContent = "Masuk"; }
        else location.reload();
      });
      if (page === "register") {
        const picker = document.querySelectorAll(".picker-btn");
        const typeInput = $("accountType");
        picker.forEach((b) => b.addEventListener("click", () => {
          typeInput.value = b.dataset.type;
          picker.forEach((x) => x.classList.toggle("active", x.dataset.type === b.dataset.type));
        }));
        $("registerForm").addEventListener("submit", async (e) => {
          e.preventDefault();
          const btn = $("submitBtn"); btn.disabled = true; btn.textContent = "Mendaftar...";
          const type = $("accountType").value;
          if (!type) { $("formError").textContent = "Pilih Garment atau Konveksi"; $("formError").hidden = false; btn.disabled = false; btn.textContent = "Daftar"; return; }
          const { data, error } = await supabase.auth.signUp({
            email: e.target.email.value, password: e.target.password.value,
            options: { data: { full_name: e.target.full_name.value, account_type: type, phone: e.target.phone.value } },
          });
          if (error) { $("formError").textContent = error.message; $("formError").hidden = false; btn.disabled = false; btn.textContent = "Daftar"; }
          else if (data.session) location.href = "profile-setup.html";
          else { $("formSuccess").textContent = "Cek email untuk verifikasi."; $("formSuccess").hidden = false; btn.disabled = false; btn.textContent = "Daftar"; }
        });
      }
    };

    KB.requireAuth = async function (page) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return (location.href = "login.html");
      if (page === "profile-setup") {
        const { data: org } = await supabase.from("organizations").select("type").eq("created_by", session.user.id).maybeSingle();
        if (org) return (location.href = org.type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html");
        initProfileSetup();
      }
    };

    window.KB = KB;
    console.log("[KO-BRAS] auth.js OK");
  })();
} catch (err) {
  window.KB_ERROR = err;
  console.error("[KO-BRAS] FATAL:", err);
}
