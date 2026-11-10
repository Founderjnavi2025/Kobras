
// ==========================================
// KO-BRAS CONFIG
// ==========================================

const SUPABASE_URL = "https://qvcsnvnupamizeevsdzc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF2Y3Nudm51cGFtaXplZXZzZHpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzMTU1ODksImV4cCI6MjEwOTg5MTU4OX0.G6L_uqWCeZCr7yxXTELESJSEHjsUQJKBAWNInqzUIBA";

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

let authMode = "register";

const $ = (id) => document.getElementById(id);


// ==========================================
// AUTH UI
// ==========================================

function showAuth(mode = "register", type = "") {
  authMode = mode;

  $("authModal").classList.add("active");
  $("registerFields").hidden = mode !== "register";
  $("loginFields").hidden = mode !== "login";
  $("memberPanel").hidden = true;
  $("authSwitch").hidden = false;

  $("authTitle").textContent =
    mode === "register" ? "Bergabung dengan Ko-Bras" : "Masuk ke Ko-Bras";

  $("authDescription").textContent =
    mode === "register"
      ? "Daftarkan akun dan organisasi usahamu."
      : "Masuk menggunakan akun Ko-Bras.";

  $("switchText").textContent =
    mode === "register" ? "Sudah punya akun?" : "Belum punya akun?";

  $("authSwitch").querySelector("button").textContent =
    mode === "register" ? "Masuk" : "Daftar";

  clearMessage();

  if (type) $("orgType").value = type;
}

function closeAuth() {
  $("authModal").classList.remove("active");
}

function toggleAuth() {
  showAuth(authMode === "register" ? "login" : "register");
}

function showMessage(message, type = "success") {
  const box = $("authMessage");
  box.textContent = message;
  box.className = "message show " + type;
}

function clearMessage() {
  const box = $("authMessage");
  box.textContent = "";
  box.className = "message";
}


// ==========================================
// ORGANIZATION REGISTRATION
// ==========================================

function makeSlug(name) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 45);

  return base + "-" + crypto.randomUUID().slice(0, 8);
}

function savePendingOrganization(data) {
  localStorage.setItem("kobras_pending_org", JSON.stringify(data));
}

async function createOrganization(user) {
  const raw = localStorage.getItem("kobras_pending_org");

  if (!raw) {
    showMessage("Belum ada data usaha yang menunggu.");
    return;
  }

  const { data: sessionData, error: sessionError } =
    await db.auth.getSession();

  if (sessionError) throw sessionError;

  const session = sessionData.session;

  if (!session) {
    showMessage("Session tidak ditemukan. Silakan login kembali.", "error");
    return;
  }

  const activeUser = session.user;

  if (user && user.id !== activeUser.id) {
    showMessage("Identitas akun tidak cocok. Silakan login ulang.", "error");
    return;
  }

  const data = JSON.parse(raw);

  const organization = {
    name: data.name,
    slug: data.slug,
    type: data.type,
    city: data.city || null,
    province: data.province || null,
    country: "ID",
    created_by: activeUser.id
  };

  const { data: result, error } = await db
    .from("organizations")
    .insert(organization)
    .select("id,name,type,status")
    .single();

  if (error) {
    console.error("Organization registration:", error);

    showMessage(
      error.message +
      (error.details ? " | " + error.details : "") +
      (error.hint ? " | " + error.hint : "") +
      (error.code ? " | Code: " + error.code : ""),
      "error"
    );
    return;
  }

  localStorage.removeItem("kobras_pending_org");

  showMessage(
    "Berhasil! Organisasi " + result.name +
    " terdaftar dengan status " + result.status + "."
  );

  $("memberStatus").textContent =
    "Organisasi " + result.name + " berhasil didaftarkan.";
}

async function finishPendingOrganization() {
  const { data, error } = await db.auth.getUser();

  if (error || !data.user) {
    showMessage("Silakan login kembali.", "error");
    return;
  }

  await createOrganization(data.user);
}


// ==========================================
// REGISTER
// ==========================================

$("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const fullName = $("fullName").value.trim();
  const email = $("regEmail").value.trim();
  const phone = $("phone").value.trim();
  const password = $("regPassword").value;
  const orgName = $("orgName").value.trim();

  const orgData = {
    name: orgName,
    slug: makeSlug(orgName),
    type: $("orgType").value,
    city: $("city").value.trim(),
    province: $("province").value.trim()
  };

  if (password.length < 8) {
    showMessage("Password minimal 8 karakter.", "error");
    return;
  }

  savePendingOrganization(orgData);

  const submit = $("registerForm").querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Mendaftarkan...";

  try {
    const { data, error } = await db.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          phone: phone || null
        }
      }
    });

    if (error) throw error;

    if (data.session && data.user) {
      await createOrganization(data.user);
      $("memberPanel").hidden = false;
      $("registerFields").hidden = true;
      $("authSwitch").hidden = true;
      $("memberEmail").textContent = data.user.email;
    } else {
      showMessage(
        "Akun berhasil dibuat. Periksa email untuk konfirmasi. Setelah itu login untuk menyelesaikan pendaftaran organisasi."
      );
    }

  } catch (error) {
    console.error(error);
    showMessage(error.message || "Registrasi gagal.", "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Buat Akun & Daftarkan Usaha →";
  }
});


// ==========================================
// LOGIN
// ==========================================

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  clearMessage();

  const email = $("loginEmail").value.trim();
  const password = $("loginPassword").value;

  const submit = $("loginForm").querySelector("button[type=submit]");
  submit.disabled = true;
  submit.textContent = "Memeriksa akun...";

  try {
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    $("loginFields").hidden = true;
    $("registerFields").hidden = true;
    $("memberPanel").hidden = false;
    $("authSwitch").hidden = true;

    $("memberEmail").textContent = data.user.email;
    showMessage("Login berhasil. Selamat datang kembali!");

    if (localStorage.getItem("kobras_pending_org")) {
      await createOrganization(data.user);
    }

  } catch (error) {
    showMessage(error.message || "Login gagal.", "error");
  } finally {
    submit.disabled = false;
    submit.textContent = "Masuk ke Ko-Bras →";
  }
});


// ==========================================
// SESSION
// ==========================================

async function logout() {
  const { error } = await db.auth.signOut();

  if (error) {
    showMessage(error.message, "error");
    return;
  }

  closeAuth();
  showAuth("login");
}

async function checkSession() {
  const { data } = await db.auth.getSession();

  if (data.session) {
    console.log("Ko-Bras session aktif:", data.session.user.email);
  }
}

db.auth.onAuthStateChange((event, session) => {
  console.log("Auth event:", event);

  if (event === "SIGNED_OUT") {
    console.log("Pengguna keluar.");
  }
});

checkSession();


// ==========================================
// MODAL CLICK OUTSIDE
// ==========================================

$("authModal").addEventListener("click", (event) => {
  if (event.target === $("authModal")) closeAuth();
});
