(function() {
  const KB = window.KB;
  if (!KB) {
    console.error("[KO-BRAS] KB tidak ada. auth.js gagal load?");
    return;
  }

  const $ = (id) => document.getElementById(id);

  async function getMyOrg() {
    const { data: { session } } = await KB.supabase.auth.getSession();
    if (!session) return null;
    const { data: org } = await KB.supabase
      .from('organizations')
      .select('id, name, type, city, province')
      .eq('created_by', session.user.id)
      .maybeSingle();
    if (org) org.userId = session.user.id; // ← Tambahan penting!
    return org;
  }

  async function fillHeader() {
    const { data: { user } } = await KB.supabase.auth.getUser();
    if (user && $("userName")) $("userName").textContent = user.email;
    const org = await getMyOrg();
    if (org) {
      if ($("orgName")) $("orgName").textContent = org.name;
      if ($("orgCity")) $("orgCity").textContent = [org.city, org.province].filter(Boolean).join(", ") || "—";
      if ($("orgType")) $("orgType").textContent = org.type === "garment" ? "Garment" : "Konveksi";
    } else {
      if ($("orgName")) $("orgName").textContent = "Organisasi tidak ditemukan";
    }
    // Badge verifikasi - coba ambil, tapi kalo error jangan nge-hang
    try {
      if (org) {
        const { data: verif } = await KB.supabase
          .from('organization_verifications')
          .select('status')
          .eq('org_id', org.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const map = { pending: "Menunggu", in_review: "Diperiksa", approved: "Terverifikasi", rejected: "Ditolak", expired: "Kedaluwarsa" };
        if ($("verifBadge")) {
          $("verifBadge").textContent = verif ? (map[verif.status] || verif.status) : "Belum diajukan";
          $("verifBadge").className = "badge " + (verif?.status === "approved" ? "badge-approved" : "");
        }
      } else {
        if ($("verifBadge")) $("verifBadge").textContent = "—";
      }
    } catch (e) {
      if ($("verifBadge")) $("verifBadge").textContent = "—";
    }
    return org;
  }

  // ============ GARMENT ============
  async function loadGarment(orgId) {
    const listEl = $("garmentWorkList");
    if (!listEl) return;

    const { data: wos, error } = await KB.supabase
      .from('work_orders')
      .select('*, work_order_items(name), work_order_applications(id, status, org_id, organizations(name))')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error("[KO-BRAS] loadGarment error:", error);
      listEl.innerHTML = `<div class="empty-state" style="color:var(--err)">Error: ${error.message}</div>`;
      return;
    }
    if (!wos || wos.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Belum ada Surat Jalan. Buat yang pertama di form kiri.</div>`;
      return;
    }

    const { data: surveys } = await KB.supabase.from('partner_surveys').select('konveksi_org_id').eq('garment_org_id', orgId);
    const surveyed = surveys?.map(s => s.konveksi_org_id) || [];

    listEl.innerHTML = wos.map(wo => {
      const apps = wo.work_order_applications || [];
      const pending = apps.filter(a => a.status === 'pending');
      const accepted = apps.find(a => a.status === 'accepted');

      let appsHtml = '';
      if (wo.status === 'open' && pending.length > 0) {
        appsHtml = `<div class="applicant-list">
          <div class="small" style="margin-bottom:.5rem; color:var(--muted)">Pelamar (${pending.length}):</div>
          ${pending.map(a => `
            <div class="applicant-item">
              <span class="applicant-name">${a.organizations?.name || 'Konveksi'}</span>
              <button class="btn btn-primary btn-sm" onclick="KB.acceptApp('${a.id}')">${surveyed.includes(a.org_id) ? '✓ Terima' : 'Terima & Survei'}</button>
            </div>
          `).join('')}
        </div>`;
      } else if (wo.status === 'closed' && accepted) {
        appsHtml = `<div class="applicant-list"><div class="small" style="color:var(--ok)">✓ Dikerjakan oleh: <b>${accepted.organizations?.name}</b></div></div>`;
      }

      return `<div class="wo-card">
        <div class="wo-card-header">
          <div class="wo-card-title">${wo.title}</div>
          <span class="badge ${wo.status==='open'?'':'badge-approved'}">${wo.status.toUpperCase()}</span>
        </div>
        <div class="wo-card-meta">
          ${wo.target_quantity} pcs · Deadline: ${wo.deadline || '-'}
        </div>
        <div class="wo-card-items">${(wo.work_order_items||[]).map(i=>i.name).join(', ') || '-'}</div>
        ${appsHtml}
      </div>`;
    }).join('');
  }

  KB.acceptApp = async function(appId) {
    if (!confirm('Terima konveksi ini? Konveksi lain otomatis ditolak.')) return;
    const { error } = await KB.supabase.rpc('accept_application', { p_app_id: appId });
    if (error) return KB.showToast(error.message, 'error');
    KB.showToast('Konveksi diterima!', 'success');
    const org = await getMyOrg();
    loadGarment(org.id);
  };

  // ============ KONVEKSI ============
  async function loadKonveksi() {
    const listEl = $("konveksiWorkList");
    if (!listEl) return;
    const org = await getMyOrg();
    if (!org) { listEl.innerHTML = `<div class="empty-state" style="color:var(--err)">Organisasi tidak ditemukan</div>`; return; }

    const { data: wos, error } = await KB.supabase
      .from('work_orders')
      .select('*, work_order_items(name), organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (error) {
      listEl.innerHTML = `<div class="empty-state" style="color:var(--err)">Error: ${error.message}</div>`;
      return;
    }
    if (!wos || wos.length === 0) {
      listEl.innerHTML = `<div class="empty-state">Belum ada Surat Jalan tersedia. Cek lagi nanti.</div>`;
      return;
    }

    listEl.innerHTML = wos.map(wo => `
      <div class="wo-card">
        <div class="wo-card-header">
          <div class="wo-card-title">${wo.title}</div>
          <span class="badge">${wo.target_quantity} pcs</span>
        </div>
        <div class="wo-card-meta">Dari: ${wo.organizations?.name || '-'} · Deadline: ${wo.deadline || '-'}</div>
        <div class="wo-card-items">${(wo.work_order_items||[]).map(i=>i.name).join(', ') || '-'}</div>
        <div style="margin-top:1rem">
          <button class="btn btn-outline btn-block" onclick="KB.applyJob('${wo.id}', '${org.id}')">Ajukan Kesediaan</button>
        </div>
      </div>
    `).join('');
  }

  KB.applyJob = async function(woId, orgId) {
    if (!confirm('Anda menyatakan sanggup mengerjakan SELURUH pesanan ini?')) return;
    const { error } = await KB.supabase.from('work_order_applications').insert({ work_order_id: woId, org_id: orgId });
    if (error) {
      if (error.code === '23505') return KB.showToast('Kamu sudah mengajukan ini.', 'error');
      return KB.showToast(error.message, 'error');
    }
    KB.showToast('Berhasil diajukan! Tunggu konfirmasi Garment.', 'success');
    loadKonveksi();
  };

  // ============ ROUTER ============
  window.initDashboardData = async function(type) {
    try {
      const org = await fillHeader();
      if (!org) return;

      if (type === 'garment') {
        await loadGarment(org.id);
        const form = $("createWorkForm");
        if (form) {
          form.addEventListener('submit', KB.createWorkOrder);
          console.log("[KO-BRAS] Form listener attached.");
          form.dataset.attached = "yes";
          if (form.querySelector("button[type=submit]")) form.querySelector("button[type=submit]").textContent = "✓ Terbitkan Surat Jalan";
        } else {
          console.error("[KO-BRAS] createWorkForm tidak ditemukan di HTML!");
        }
      } else if (type === 'konveksi') {
        await loadKonveksi();
      }
    } catch (e) {
      console.error("[KO-BRAS] initDashboardData error:", e);
      if ($("garmentWorkList")) $("garmentWorkList").innerHTML = `<div class="empty-state" style="color:var(--err)">Error: ${e.message}</div>`;
    }
  };

  // ============ CREATE WORK ORDER ============
  KB.createWorkOrder = async function(e) {
    e.preventDefault();
    console.log("[KO-BRAS] createWorkOrder triggered");
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const org = await getMyOrg();
    if (!org) return KB.showToast('Organisasi tidak ditemukan', 'error');

    if (!form.title.value.trim()) return KB.showToast('Judul wajib diisi', 'error');
    if (!form.target_quantity.value) return KB.showToast('Target Qty wajib diisi', 'error');
    if (!form.items.value.trim()) return KB.showToast('Detail barang wajib diisi', 'error');

    KB.setLoading(btn, true, 'Membuat...');
    const { data: wo, error } = await KB.supabase.from('work_orders').insert({
      org_id: org.id,
      created_by: org.userId, /* ← INI YANG KURANG TADI */
      title: form.title.value.trim(),
      target_quantity: parseInt(form.target_quantity.value),
      deadline: form.deadline.value || null
    }).select().single();

    if (error) {
      console.error("[KO-BRAS] insert work_order error:", error);
      KB.setLoading(btn, false, 'Terbitkan Surat Jalan');
      return KB.showToast(error.message, 'error');
    }

    const { error: itemErr } = await KB.supabase.from('work_order_items').insert({
      work_order_id: wo.id,
      name: form.items.value.trim()
    });
    if (itemErr) console.error("[KO-BRAS] insert item error:", itemErr);

    KB.showToast('Surat Jalan diterbitkan!', 'success');
    form.reset();
    KB.setLoading(btn, false, 'Terbitkan Surat Jalan');
    loadGarment(org.id);
  };
})();
