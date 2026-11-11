(function() {
  const KB = window.KB;
  if (!KB) { console.error("KB tidak ada"); return; }

  // Helper ambil ID Organisasi
  async function getMyOrg() {
    const { data: { session } } = await KB.supabase.auth.getSession();
    if (!session) return null;
    const { data: org } = await KB.supabase.from('organizations').select('id, type').eq('created_by', session.user.id).maybeSingle();
    return org;
  }

  // ==== GARMENT: BUAT SURAT JALAN ====
  KB.createWorkOrder = async function(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const org = await getMyOrg();
    
    if (!org) return KB.showToast('Gagal: Organisasi tidak ditemukan', 'error');

    KB.setLoading(btn, true, 'Mengirim...');
    
    const { data: wo, error } = await KB.supabase.from('work_orders').insert({
      org_id: org.id, 
      title: form.title.value, 
      description: form.items.value, // pakai description buat bahan
      target_quantity: parseInt(form.target_quantity.value), 
      deadline: form.deadline.value || null
    }).select().single();

    if (error) { 
      KB.setLoading(btn, false, 'Terbitkan Surat Jalan'); 
      return KB.showToast(error.message, 'error'); 
    }
    
    // Simpan item (opsional, buat record)
    await KB.supabase.from('work_order_items').insert({ work_order_id: wo.id, name: form.items.value });

    KB.showToast('Surat Jalan berhasil diterbitkan!', 'success');
    form.reset();
    KB.setLoading(btn, false, 'Terbitkan Surat Jalan');
    loadGarmentList(org.id);
  };

  async function loadGarmentList(orgId) {
    const listEl = document.getElementById('garmentWorkList');
    if (!listEl) return;
    
    const { data: wos } = await KB.supabase.from('work_orders')
      .select('*, work_order_items(*), work_order_applications(*, organizations(name))')
      .eq('org_id', orgId).order('created_at', { ascending: false });
      
    const { data: surveys } = await KB.supabase.from('partner_surveys').select('konveksi_org_id').eq('garment_org_id', orgId);
    const surveyed = surveys?.map(s => s.konveksi_org_id) || [];

    if (!wos || wos.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Belum ada Surat Jalan.</div>';
      return;
    }

    listEl.innerHTML = wos.map(wo => {
      const apps = wo.work_order_applications || [];
      let appsHtml = apps.map(a => {
        let btnHtml = '';
        if (wo.status === 'open' && a.status === 'pending') {
          const isRepeat = surveyed.includes(a.org_id);
          btnHtml = `<button class="btn btn-primary btn-sm" onclick="KB.acceptApp('${a.id}')">${isRepeat ? 'Terima (Repeat)' : 'Terima & Survei'}</button>`;
        } else {
          btnHtml = `<span class="small muted">${a.status}</span>`;
        }
        return `<div class="applicant-item">
          <span class="applicant-name">${a.organizations.name}</span>
          ${btnHtml}
        </div>`;
      }).join('');

      return `<div class="wo-card">
        <div class="wo-card-header">
          <div class="wo-card-title">${wo.title} (${wo.target_quantity} pcs)</div>
          <span class="badge ${wo.status==='open'?'':'badge-approved'}">${wo.status.toUpperCase()}</span>
        </div>
        <div class="wo-card-meta">Deadline: ${wo.deadline || '-'}</div>
        <div class="wo-card-items">Bahan: ${wo.description || '-'}</div>
        ${apps.length > 0 ? `<div class="applicant-list"><strong>Pelamar:</strong>${appsHtml}</div>` : ''}
      </div>`;
    }).join('');
  }

  KB.acceptApp = async function(appId) {
    if (!confirm('Terima konveksi ini? Konveksi lain otomatis ditolak.')) return;
    const { error } = await KB.supabase.rpc('accept_application', { p_app_id: appId });
    if (error) return KB.showToast(error.message, 'error');
    KB.showToast('Konveksi diterima!', 'success');
    const org = await getMyOrg();
    loadGarmentList(org.id);
  };

  // ==== KONVEKSI: LIHAT LIST ====
  async function loadKonveksiList() {
    const listEl = document.getElementById('konveksiWorkList');
    if (!listEl) return;
    const org = await getMyOrg();
    if (!org) return;

    const { data: wos } = await KB.supabase.from('work_orders')
      .select('*, work_order_items(*), organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open').order('created_at', { ascending: false });
      
    if (!wos || wos.length === 0) { 
      listEl.innerHTML = '<div class="empty-state">Belum ada Surat Jalan masuk.</div>'; 
      return; 
    }

    listEl.innerHTML = wos.map(wo => `
      <div class="wo-card">
        <div class="wo-card-header">
          <div class="wo-card-title">${wo.title}</div>
          <span class="badge">${wo.target_quantity} pcs</span>
        </div>
        <div class="wo-card-meta">Dari: <b>${wo.organizations.name}</b> | Deadline: ${wo.deadline || '-'}</div>
        <div class="wo-card-items">Bahan: ${wo.description || '-'}</div>
        <button class="btn btn-primary btn-block" style="margin-top:1rem" onclick="KB.applyJob('${wo.id}', '${org.id}')">Ajukan Kesediaan (Ambil Semua)</button>
      </div>
    `).join('');
  }

  KB.applyJob = async function(woId, orgId) {
    if (!confirm('Anda menyatakan sanggup mengerjakan SELURUH pesanan ini?')) return;
    const { error } = await KB.supabase.from('work_order_applications').insert({ work_order_id: woId, org_id: orgId });
    if (error) return KB.showToast(error.code === '23505' ? 'Kamu sudah mengajukan ini.' : error.message, 'error');
    KB.showToast('Berhasil diajukan! Tunggu konfirmasi.', 'success');
  };

  // ==== INIT ROUTER ====
  window.initDashboardData = async function(type) {
    const org = await getMyOrg();
    if (!org) return;

    // Render info profil
    if (document.getElementById('orgName')) document.getElementById('orgName').textContent = org.name || 'Usaha';
    if (document.getElementById('orgType')) document.getElementById('orgType').textContent = type === 'garment' ? 'Garment' : 'Konveksi';
    
    // Cek verifikasi
    const { data: verif } = await KB.supabase.from('organization_verifications').select('status').eq('org_id', org.id).maybeSingle();
    if (document.getElementById('verifBadge')) {
      document.getElementById('verifBadge').textContent = verif?.status ? verif.status.toUpperCase() : 'Belum Diajukan';
      document.getElementById('verifBadge').className = 'badge ' + (verif?.status === 'approved' ? 'badge-approved' : '');
    }

    if (type === 'garment') {
      loadGarmentList(org.id);
      const form = document.getElementById('createWorkForm');
      if (form) form.addEventListener('submit', KB.createWorkOrder);
    } else if (type === 'konveksi') {
      loadKonveksiList();
    }
  };
})();
