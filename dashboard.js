(function() {
  const KB = window.KB;
  if (!KB) return;
  const $ = (id) => document.getElementById(id);

  function formatRp(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }
  function estimateTotal(wo) {
    const qty = Number(wo.target_quantity) || 0;
    const price = Number(wo.price_per_dozen) || 0;
    return (qty / 12) * price;
  }


  window.switchTab = function(tab) {
    document.querySelectorAll('.tab-section').forEach(s => s.hidden = true);
    const target = $(`tab-${tab}`);
    if (target) target.hidden = false;
    document.querySelectorAll('.dash-nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const titles = {
      overview: 'Overview',
      'surat-jalan': 'Surat Jalan',
      dikerjakan: 'Sedang Dikerjakan',
      riwayat: 'Riwayat',
      profil: 'Profil Usaha',
      pengaturan: 'Pengaturan'
    };
    if ($("pageTitle")) $("pageTitle").textContent = titles[tab] || tab;
    if ($("dashSidebar")) $("dashSidebar").classList.remove('open');
    if ($("dashOverlay")) $("dashOverlay").classList.remove('open');
  };

  async function getMyOrg() {
    const { data: { session } } = await KB.supabase.auth.getSession();
    if (!session) return null;
    const { data: org } = await KB.supabase.from('organizations')
      .select('id, name, type, city, province').eq('created_by', session.user.id).maybeSingle();
    if (org) org.userId = session.user.id;
    if (org) org.email = session.user.email;
    return org;
  }

  async function fillHeader(org) {
    if ($("sidebarEmail")) $("sidebarEmail").textContent = org.email || '—';
    if ($("settingEmail")) $("settingEmail").textContent = org.email || '—';
    const { data: verif } = await KB.supabase.from('organization_verifications')
      .select('status').eq('org_id', org.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const map = { pending: "Menunggu", in_review: "Diperiksa", approved: "Terverifikasi", rejected: "Ditolak", expired: "Kedaluwarsa" };
    if ($("settingVerif")) {
      $("settingVerif").textContent = verif ? (map[verif.status] || verif.status) : "Belum diajukan";
      if (verif?.status === 'approved') $("settingVerif").className = "badge badge-approved";
    }
  }

  async function fillProfileForm(org) {
    const form = $("orgProfileForm");
    if (!form) return;
    form.name.value = org.name || '';
    form.city.value = org.city || '';
    form.province.value = org.province || '';
    form.onsubmit = async (e) => {
      e.preventDefault();
      const { error } = await KB.supabase.from('organizations').update({
        name: form.name.value.trim(),
        city: form.city.value.trim() || null,
        province: form.province.value.trim() || null
      }).eq('id', org.id);
      if (error) return KB.showToast(error.message, 'error');
      KB.showToast('Profil diperbarui!', 'success');
    };
  }

  // ============ GARMENT ============
  async function loadGarment(org) {
    const { data: wos } = await KB.supabase.from('work_orders')
      .select('*, work_order_items(name), work_order_applications(id, status, org_id, organizations(name))')
      .eq('org_id', org.id).order('created_at', { ascending: false });
    const all = wos || [];
    const open = all.filter(w => w.status === 'open');
    const closed = all.filter(w => w.status === 'closed');

    if ($("statActive")) $("statActive").textContent = open.length;
    if ($("statDone")) $("statDone").textContent = closed.length;
    if ($("statQty")) $("statQty").textContent = all.reduce((s, w) => s + (w.target_quantity || 0), 0).toLocaleString('id-ID');
    if ($("statNilai")) {
      const totalNilai = all.reduce((s, w) => s + estimateTotal(w), 0);
      $("statNilai").textContent = formatRp(totalNilai);
    }

    const renderCard = (wo) => {
      const items = (wo.work_order_items || []).map(i => i.name).join(', ');
      const pendingApps = (wo.work_order_applications || []).filter(a => a.status === 'pending');
      const accepted = (wo.work_order_applications || []).find(a => a.status === 'accepted');
      let actionHtml = '';
      if (wo.status === 'open' && pendingApps.length > 0) {
        actionHtml = `<div style="margin-top:.5rem"><strong class="small">Pelamar (${pendingApps.length}):</strong>
          ${pendingApps.map(a => `<div class="applicant-item"><span class="small">${a.organizations?.name || 'Konveksi'}</span>
          <button class="btn btn-primary btn-sm" onclick="KB.acceptApp('${a.id}')">Terima</button></div>`).join('')}</div>`;
      } else if (wo.status === 'closed' && accepted) {
        actionHtml = `<div class="small" style="color:var(--ok); margin-top:.5rem">✓ Dikerjakan oleh: <b>${accepted.organizations?.name}</b></div>`;
      }
      const price = Number(wo.price_per_dozen) || 0;
      const est = estimateTotal(wo);
      const priceLine = price > 0
        ? `<div style="font-size:.85rem; margin:.35rem 0; color:var(--brand)">💰 ${formatRp(price)} / lusin · Estimasi: <b>${formatRp(est)}</b></div>`
        : `<div style="font-size:.85rem; margin:.35rem 0; color:var(--err)">⚠️ Harga belum disepakati</div>`;
      const negoLine = wo.negotiable_note
        ? `<div style="font-size:.8rem; font-style:italic; color:var(--muted); margin-bottom:.35rem">💬 ${wo.negotiable_note}</div>`
        : '';

      return `<div class="sj-card">
        <div class="sj-card-header"><div class="sj-card-title">${wo.title}</div>
          <span class="badge ${wo.status === 'closed' ? 'badge-approved' : ''}">${wo.status.toUpperCase()}</span></div>
        <div class="sj-card-meta">${wo.target_quantity} pcs · Deadline: ${wo.deadline || '-'}</div>
        <div class="sj-card-items">${items || '-'}</div>
        ${priceLine}
        ${negoLine}
        ${actionHtml}
      </div>`;
    };

    if ($("garmentWorkList")) {
      $("garmentWorkList").innerHTML = open.length ? open.map(renderCard).join('') : '<div class="empty-state">Belum ada Surat Jalan aktif.</div>';
    }
    if ($("overviewList")) {
      $("overviewList").innerHTML = all.length ? all.slice(0, 3).map(renderCard).join('') : '<div class="empty-state">Belum ada aktivitas.</div>';
    }
    if ($("riwayatList")) {
      $("riwayatList").innerHTML = closed.length ? closed.map(renderCard).join('') : '<div class="empty-state">Belum ada riwayat.</div>';
    }
  }

  KB.acceptApp = async function(appId) {
    if (!confirm('Terima konveksi ini? Konveksi lain otomatis ditolak.')) return;
    const { error } = await KB.supabase.rpc('accept_application', { p_app_id: appId });
    if (error) return KB.showToast(error.message, 'error');
    KB.showToast('Konveksi diterima!', 'success');
    const org = await getMyOrg();
    loadGarment(org);
  };

  // ============ KONVEKSI ============
  async function loadKonveksi(org) {
    const { data: open } = await KB.supabase.from('work_orders')
      .select('*, work_order_items(name), organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open').order('created_at', { ascending: false });

    const { data: mine } = await KB.supabase.from('work_order_applications')
      .select('work_order_id, status, work_orders(*, work_order_items(name), organizations!work_orders_org_id_fkey(name))')
      .eq('org_id', org.id);

    const accepted = (mine || []).filter(a => a.status === 'accepted').map(a => a.work_orders).filter(Boolean);
    const pending = (mine || []).filter(a => a.status === 'pending').length;

    if ($("statAvailable")) $("statAvailable").textContent = (open || []).length;
    if ($("statActive")) $("statActive").textContent = accepted.filter(w => w.status === 'closed').length;
    if ($("statDone")) $("statDone").textContent = 0;
    if ($("statSurvey")) $("statSurvey").textContent = pending;

    const renderCard = (wo, showApply) => {
      const items = (wo.work_order_items || []).map(i => i.name).join(', ');
      const price = Number(wo.price_per_dozen) || 0;
      const est = estimateTotal(wo);
      const priceLine = price > 0
        ? `<div style="font-size:.85rem; margin:.35rem 0; color:var(--brand-2)">💰 ${formatRp(price)} / lusin · Estimasi: <b>${formatRp(est)}</b></div>`
        : `<div style="font-size:.85rem; margin:.35rem 0; color:var(--err)">⚠️ Harga belum disepakati</div>`;
      const negoLine = wo.negotiable_note
        ? `<div style="font-size:.8rem; font-style:italic; color:var(--muted); margin-bottom:.35rem">💬 ${wo.negotiable_note}</div>`
        : '';

      return `<div class="sj-card">
        <div class="sj-card-header"><div class="sj-card-title">${wo.title}</div>
          <span class="badge">${wo.target_quantity} pcs</span></div>
        <div class="sj-card-meta">Dari: ${wo.organizations?.name || '-'} · Deadline: ${wo.deadline || '-'}</div>
        <div class="sj-card-items">${items || '-'}</div>
        ${priceLine}
        ${negoLine}
        ${showApply ? `<button class="btn btn-outline btn-sm" style="margin-top:.5rem" onclick="KB.applyJob('${wo.id}', '${org.id}')">Ajukan Kesediaan</button>` : ''}
      </div>`;
    };

    if ($("konveksiWorkList")) {
      $("konveksiWorkList").innerHTML = (open || []).length ? open.map(w => renderCard(w, true)).join('') : '<div class="empty-state">Belum ada Surat Jalan.</div>';
    }
    if ($("inProgressList")) {
      $("inProgressList").innerHTML = accepted.length ? accepted.map(w => renderCard(w, false)).join('') : '<div class="empty-state">Belum ada pekerjaan aktif.</div>';
    }
    if ($("overviewList")) {
      $("overviewList").innerHTML = (open || []).slice(0, 3).map(w => renderCard(w, true)).join('') || '<div class="empty-state">Belum ada aktivitas.</div>';
    }
    if ($("riwayatList")) {
      $("riwayatList").innerHTML = accepted.filter(w => w.status === 'closed').map(w => renderCard(w, false)).join('') || '<div class="empty-state">Belum ada riwayat.</div>';
    }
  }

  KB.applyJob = async function(woId, orgId) {
    if (!confirm('Sanggup mengerjakan SELURUH pesanan ini?')) return;
    const { error } = await KB.supabase.from('work_order_applications').insert({ work_order_id: woId, org_id: orgId });
    if (error) return KB.showToast(error.code === '23505' ? 'Sudah melamar.' : error.message, 'error');
    KB.showToast('Lamaran terkirim!', 'success');
    const org = await getMyOrg();
    loadKonveksi(org);
  };

  // ============ CREATE ============
  KB.createWorkOrder = async function(e) {
    e.preventDefault();
    const form = e.target;
    const btn = form.querySelector('button[type="submit"]');
    const org = await getMyOrg();
    if (!org) return KB.showToast('Organisasi tidak ditemukan', 'error');
    if (!form.title.value.trim()) return KB.showToast('Judul wajib', 'error');
    if (!form.target_quantity.value) return KB.showToast('Qty wajib', 'error');
    if (!form.items.value.trim()) return KB.showToast('Bahan wajib', 'error');
    KB.setLoading(btn, true, 'Membuat...');
    const price = parseFloat(form.price_per_dozen.value) || 0;
    if (price <= 0) return KB.showToast('Harga per lusin wajib diisi', 'error');

    const { data: wo, error } = await KB.supabase.from('work_orders').insert({
      org_id: org.id, created_by: org.userId, title: form.title.value.trim(),
      target_quantity: parseInt(form.target_quantity.value),
      deadline: form.deadline.value || null,
      price_per_dozen: price,
      negotiable_note: form.negotiable_note.value.trim() || null
    }).select().single();
    if (error) { KB.setLoading(btn, false, 'Terbitkan'); return KB.showToast(error.message, 'error'); }
    await KB.supabase.from('work_order_items').insert({ work_order_id: wo.id, name: form.items.value.trim() });
    KB.showToast('Surat Jalan diterbitkan!', 'success');
    form.reset();
    KB.setLoading(btn, false, 'Terbitkan Surat Jalan');
    loadGarment(org);
  };

  // ============ INIT ============
  window.initDashboardData = async function(type) {
    const org = await getMyOrg();
    if (!org) return;
    await fillHeader(org);
    await fillProfileForm(org);
    if (type === 'garment') {
      await loadGarment(org);
      $("createWorkForm")?.addEventListener('submit', KB.createWorkOrder);
    } else {
      await loadKonveksi(org);
    }
  };
})();
