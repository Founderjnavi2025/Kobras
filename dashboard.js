(function() {
  const KB = window.KB;
  if (!KB) return;

  async function getMyOrg() {
    const { data: { session } } = await KB.supabase.auth.getSession();
    if (!session) return null;
    const { data: org } = await KB.supabase.from('organizations').select('id, type').eq('created_by', session.user.id).maybeSingle();
    return org;
  }

  // --- GARMENT ---
  KB.createWorkOrder = async function(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const org = await getMyOrg();
    if (!org) return KB.showToast('Organisasi tidak ditemukan', 'error');

    KB.setLoading(btn, true, 'Membuat...');
    const { data: wo, error } = await KB.supabase.from('work_orders').insert({
      org_id: org.id, title: form.title.value, description: form.description.value, target_quantity: parseInt(form.target_quantity.value), deadline: form.deadline.value || null
    }).select().single();

    if (error) { KB.setLoading(btn, false, 'Buat Surat Jalan'); return KB.showToast(error.message, 'error'); }
    if (form.items.value) await KB.supabase.from('work_order_items').insert({ work_order_id: wo.id, name: form.items.value });

    KB.showToast('Surat Jalan dibuat!', 'success');
    form.reset();
    KB.setLoading(btn, false, 'Buat Surat Jalan');
    loadGarment(org.id);
  };

  async function loadGarment(orgId) {
    const listEl = document.getElementById('garmentWorkList');
    if (!listEl) return;
    const { data: wos } = await KB.supabase.from('work_orders').select('*, work_order_items(*), work_order_applications(*, organizations(name))').eq('org_id', orgId).order('created_at', { ascending: false });
    const { data: surveys } = await KB.supabase.from('partner_surveys').select('konveksi_org_id').eq('garment_org_id', orgId);
    const surveyed = surveys?.map(s => s.konveksi_org_id) || [];

    if (!wos?.length) return;
    listEl.innerHTML = wos.map(wo => {
      const apps = wo.work_order_applications || [];
      let appsHtml = apps.map(a => {
        let action = '';
        if (wo.status === 'open' && a.status === 'pending') {
          action = `<button class="btn btn-primary btn-sm" onclick="KB.acceptApp('${a.id}')">${surveyed.includes(a.org_id) ? 'Terima (Repeat)' : 'Terima & Survei'}</button>`;
        } else {
          action = `<span class="small muted">${a.status}</span>`;
        }
        return `<div style="display:flex; justify-content:space-between; margin-top:.5rem; border-top:1px solid var(--border); padding-top:.5rem">
          <span class="small">${a.organizations.name}</span>${action}
        </div>`;
      }).join('');

      return `<div class="dash-panel" style="margin-bottom:1rem; padding:1rem;">
        <div style="display:flex; justify-content:space-between;">
          <strong>${wo.title} (${wo.target_quantity} pcs)</strong> 
          <span class="badge ${wo.status==='open'?'':'badge-approved'}">${wo.status.toUpperCase()}</span>
        </div>
        <p class="small muted" style="margin:.25rem 0">Barang: ${wo.work_order_items.map(i=>i.name).join(', ')}</p>
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

  // --- KONVEKSI ---
  async function loadKonveksi() {
    const listEl = document.getElementById('konveksiWorkList');
    if (!listEl) return;
    const org = await getMyOrg();
    if (!org) return;

    const { data: wos } = await KB.supabase.from('work_orders').select('*, work_order_items(*), organizations!work_orders_org_id_fkey(name)').eq('status', 'open');
    if (!wos?.length) { listEl.innerHTML = '<div class="empty-state">Belum ada Surat Jalan tersedia.</div>'; return; }

    listEl.innerHTML = wos.map(wo => {
      return `<div class="dash-panel" style="margin-bottom:1rem; padding:1rem;">
        <strong>${wo.title} (${wo.target_quantity} pcs)</strong>
        <p class="small muted">Dari: ${wo.organizations.name} | Deadline: ${wo.deadline || '-'}</p>
        <p class="small">Barang: ${wo.work_order_items.map(i=>i.name).join(', ')}</p>
        <button class="btn btn-outline btn-sm" onclick="KB.applyJob('${wo.id}', '${org.id}')">Ajukan Kesediaan</button>
      </div>`;
    }).join('');
  }

  KB.applyJob = async function(woId, orgId) {
    if (!confirm('Anda menyatakan sanggup mengerjakan SELURUH pesanan ini?')) return;
    const { error } = await KB.supabase.from('work_order_applications').insert({ work_order_id: woId, org_id: orgId });
    if (error) return KB.showToast(error.code === '23505' ? 'Kamu sudah mengajukan ini.' : error.message, 'error');
    KB.showToast('Berhasil diajukan! Tunggu konfirmasi Garment.', 'success');
  };

  window.initDashboardData = async function(type) {
    const org = await getMyOrg();
    if (type === 'garment') {
      loadGarment(org.id);
      document.getElementById('createWorkForm')?.addEventListener('submit', KB.createWorkOrder);
    } else if (type === 'konveksi') {
      loadKonveksi();
    }
  };
})();
