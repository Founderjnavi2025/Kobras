// KO-BRAS · auth.js — client + flow auth (v2, defensif)
window.KB_ERROR = null;
try {
  (function () {
    const cfg = window.KOBRAS_CONFIG || {};

    if (typeof window.supabase === "undefined" || !window.supabase.createClient) {
      throw new Error("window.supabase tidak tersedia — CDN belum load.");
    }
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error("config.js kosong — SUPABASE_URL atau SUPABASE_ANON_KEY belum diisi.");
    }
    if (cfg.SUPABASE_URL.includes("YOUR-PROJECT")) {
      throw new Error("SUPABASE_URL masih placeholder.");
    }

    const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });

    const KB = { supabase, cfg };
    const $ = (id) => document.getElementById(id);
    const showErr = (el, m) => { if (el) { el.textContent = m; el.hidden = false; } };
    const hide = (el) => { if (el) el.hidden = true; };
    const showOk = (el, m) => { if (el) { el.textContent = m; el.hidden = false; } };

    function terjemahkanError(msg) {
      const m = (msg || "").toLowerCase();
      if (m.includes("invalid login credentials")) return "Email atau password salah.";
      if (m.includes("user already registered")) return "Email sudah terdaftar.";
      if (m.includes("password should be")) return "Password minimal 8 karakter.";
      if (m.includes("unable to validate email")) return "Format email tidak valid.";
      if (m.includes("duplicate key") && m.includes("slug")) return "Nama usaha terlalu mirip.";
      return msg || "Terjadi kesalahan.";
    }

    async function getMyOrganization(userId) {
      const { data, error } = await supabase
        .from("organizations")
        .select("id, name, slug, type, status, city, province, country, created_at")
        .eq("created_by", userId)
        .maybeSingle();
      if (error) throw error;
      return data;
    }

    async function routeAfterAuth() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return (location.href = "login.html");
      const org = await getMyOrganization(user.id);
      if (!org) return (location.href = "profile-setup.html");
      return (location.href = org.type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html");
    }

    KB.requireAnon = async function (page) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) return routeAfterAuth();
      if (page === "login") $("loginForm").addEventListener("submit", onLogin);
      if (page === "register") initRegister();
    };

    KB.requireAuth = async function (page) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return (location.href = "login.html");
      if (page === "profile-setup") {
        const org = await getMyOrganization(session.user.id);
        if (org) return routeAfterAuth();
        return initProfileSetup();
      }
      if (page === "dashboard-garment") return initDashboard("garment");
      if (page === "dashboard-konveksi") return initDashboard("konveksi");
    };

    async function onLogin(e) {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = $("submitBtn"), errEl = $("formError");
      hide(errEl);
      btn.disabled = true; btn.textContent = "Memproses...";
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email.value.trim(),
        password: form.password.value,
      });
      if (error) {
        showErr(errEl, terjemahkanError(error.message));
        btn.disabled = false; btn.textContent = "Masuk";
        return;
      }
      await routeAfterAuth();
    }

    function initRegister() {
      const picker = document.querySelectorAll(".picker-btn");
      const typeInput = $("accountType");
      const preset = new URLSearchParams(location.search).get("type");
      const selectType = (t) => {
        typeInput.value = t;
        picker.forEach((b) => b.classList.toggle("active", b.dataset.type === t));
      };
      picker.forEach((b) => b.addEventListener("click", () => selectType(b.dataset.type)));
      if (preset === "garment" || preset === "konveksi") selectType(preset);
      $("registerForm").addEventListener("submit", onRegister);
    }

    async function onRegister(e) {
      e.preventDefault();
      const form = e.currentTarget;
      const btn = $("submitBtn"), errEl = $("formError"), okEl = $("formSuccess");
      hide(errEl); hide(okEl);
      const type = $("accountType").value;
      if (!type) return showErr(errEl, "Pilih jenis akun: Garment atau Konveksi.");
      const full_name = form.full_name.value.trim();
      const email = form.email.value.trim();
      const phone = form.phone.value.trim();
      const password = form.password.value;
      if (full_name.length < 2) return showErr(errEl, "Nama minimal 2 karakter.");
      if (!email) return showErr(errEl, "Email wajib diisi.");
      if (!phone) return showErr(errEl, "Nomor telepon wajib diisi.");
      if (password.length < 8) return showErr(errEl, "Password minimal 8 karakter.");

      btn.disabled = true; btn.textContent = "Mendaftar...";
      const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name, account_type: type, phone } },
      });
      if (error) {
        showErr(errEl, terjemahkanError(error.message));
        btn.disabled = false; btn.textContent = "Daftar";
        return;
      }
      if (!data.session) {
        showOk(okEl, "Pendaftaran berhasil. Cek email Anda untuk verifikasi, lalu masuk.");
        btn.disabled = false; btn.textContent = "Daftar";
        return;
      }
      location.href = "profile-setup.html";
    }

    function initProfileSetup() {
      $("profileForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = $("submitBtn"), errEl = $("formError");
        hide(errEl);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return (location.href = "login.html");
        const type = user.user_metadata?.account_type === "konveksi" ? "konveksi" : "garment";
        const form = e.currentTarget;
        const name = form.name.value.trim();
        const city = form.city.value.trim() || null;
        const province = form.province.value.trim() || null;
        if (name.length < 3) return showErr(errEl, "Nama usaha minimal 3 karakter.");
        const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "usaha";
        const slug = base + "-" + user.id.slice(0, 6);
        btn.disabled = true; btn.textContent = "Menyimpan...";
        const { error } = await supabase
          .from("organizations")
          .insert({ name, slug, type, city, province, created_by: user.id })
          .select().single();
        if (error) {
          showErr(errEl, terjemahkanError(error.message));
          btn.disabled = false; btn.textContent = "Simpan & Lanjut";
          return;
        }
        location.href = type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html";
      });
    }

    async function initDashboard(expectedType) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return (location.href = "login.html");
      const org = await getMyOrganization(user.id);
      if (!org) return (location.href = "profile-setup.html");
      if (org.type !== expectedType) {
        return (location.href = org.type === "garment" ? "dashboard-garment.html" : "dashboard-konveksi.html");
      }
      const { data: profile } = await supabase
        .from("profiles_public").select("id, full_name, avatar_url").eq("id", user.id).maybeSingle();
      const { data: verif } = await supabase
        .from("organization_verifications")
        .select("id, status, submitted_at, decided_at, notes")
        .eq("org_id", org.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();

      renderDashboard({ user, org, profile, verif, expectedType });
      setupProfileEdit(org);
    }

    function renderDashboard({ user, org, profile, verif, expectedType }) {
      if ($("orgName")) $("orgName").textContent = org.name;
      if ($("orgCity")) $("orgCity").textContent = [org.city, org.province].filter(Boolean).join(", ") || "—";
      if ($("orgType")) $("orgType").textContent = expectedType === "garment" ? "Garment" : "Konveksi";
      if ($("userName")) $("userName").textContent = profile?.full_name || user.email;
      const map = {
        draft: "Belum diajukan", pending: "Menunggu pemeriksaan", in_review: "Sedang diperiksa",
        approved: "Terverifikasi", rejected: "Ditolak", expired: "Kedaluwarsa",
      };
      const status = verif?.status || "draft";
      if ($("verifBadge")) {
        $("verifBadge").textContent = map[status] || status;
        $("verifBadge").className = "badge badge-" + status;
      }
      if ($("verifNote")) $("verifNote").textContent = verif?.notes || "Belum ada catatan.";
    }

    function setupProfileEdit(org) {
      const form = $("orgProfileForm");
      if (!form) return;
      form.name.value = org.name || "";
      form.city.value = org.city || "";
      form.province.value = org.province || "";
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const errEl = $("profileError"), okEl = $("profileSuccess");
        hide(errEl); hide(okEl);
        const name = form.name.value.trim();
        const city = form.city.value.trim() || null;
        const province = form.province.value.trim() || null;
        if (name.length < 3) return showErr(errEl, "Nama minimal 3 karakter.");
        const { error } = await supabase
          .from("organizations").update({ name, city, province }).eq("id", org.id);
        if (error) return showErr(errEl, terjemahkanError(error.message));
        showOk(okEl, "Profil diperbarui.");
        if ($("orgName")) $("orgName").textContent = name;
        if ($("orgCity")) $("orgCity").textContent = [city, province].filter(Boolean).join(", ") || "—";
      });
    }

    KB.getMyOrganization = getMyOrganization;
    KB.routeAfterAuth = routeAfterAuth;
    KB.terjemahkanError = terjemahkanError;
    window.KB = KB;
    console.log("[KO-BRAS] auth.js OK — window.KB siap");
  })();
} catch (err) {
  window.KB_ERROR = {
    message: String(err && err.message || err),
    stack: String(err && err.stack || ""),
  };
  console.error("[KO-BRAS] auth.js FATAL:", err);
}
