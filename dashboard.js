(function() {
  const KB = window.KB;
  if (!KB) return;
  const $ = (id) => document.getElementById(id);

  function formatRp(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
  }
  
  function pricePerPcs(wo) {
    const qty = Number(wo.target_quantity) || 0;
    const total = Number(wo.total_price) || 0;
    return qty > 0 ? total / qty : 0;
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
    document.querySelectorAll('.bottom-nav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.nav === tab);
    });
    const titles = {
      overview: 'Overview',
      'surat-jalan': 'Surat Jalan',
      dikerjakan: 'Sedang Dikerjakan',
      riwayat: 'Riwayat', 'detail-sj': 'Detail Surat Jalan',
      'your-room': 'Your Room',
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
    if ($("greetingName")) $("greetingName").textContent = org.name || 'Pengguna';
    if ($("greetingType")) $("greetingType").textContent = org.type === 'garment' ? 'Pemilik Modal' : 'Konveksi';
    if ($("greetingCity")) $("greetingCity").textContent = org.city || '—';
    if ($("logoutEmail")) $("logoutEmail").textContent = org.email || '—';
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
      .select('*, work_order_items(name), work_order_applications(id, status, org_id)')
      .eq('org_id', org.id).order('created_at', { ascending: false });

    // Ambil nama konveksi pelamar via RPC public
    if (wos && wos.length > 0) {
      const appOrgIds = [...new Set(wos.flatMap(w => (w.work_order_applications || []).map(a => a.org_id)).filter(Boolean))];
      if (appOrgIds.length > 0) {
        const { data: orgs } = await KB.supabase.rpc('get_orgs_public', { p_ids: appOrgIds });
        const orgMap = {};
        (orgs || []).forEach(o => orgMap[o.id] = o);
        wos.forEach(w => {
          (w.work_order_applications || []).forEach(a => {
            a.organizations = orgMap[a.org_id] || null;
          });
        });
      }
    }
    const all = wos || [];
    const open = all.filter(w => w.status === 'open');
    const closed = all.filter(w => w.status === 'closed');

    if ($("statActive")) $("statActive").textContent = open.length;
    if ($("statDone")) $("statDone").textContent = closed.length;
    if ($("statQty")) $("statQty").textContent = all.reduce((s, w) => s + (w.target_quantity || 0), 0).toLocaleString('id-ID');
    if ($("statNilai")) {
      const totalNilai = all.reduce((s, w) => s + (Number(w.total_price) || 0), 0);
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
        const konveksiName = accepted.organizations?.name || 'Konveksi (data tidak tersedia)';
        actionHtml = `<div class="small" style="color:var(--ok); margin-top:.5rem">✓ Dikerjakan oleh: <b>${konveksiName}</b></div>`;
      }
      const total = Number(wo.total_price) || 0;
      const perPcs = pricePerPcs(wo);
      const priceLine = total > 0
        ? `<div style="font-size:.85rem; margin:.35rem 0; color:var(--brand)">
             💰 <b>${formatRp(total)}</b> (Borongan) · Setara ${formatRp(perPcs)}/pcs
           </div>`
        : `<div style="font-size:.85rem; margin:.35rem 0; color:var(--err)">⚠️ Harga belum disepakati</div>`;
      const negoLine = wo.negotiable_note
        ? `<div style="font-size:.8rem; font-style:italic; color:var(--muted); margin-bottom:.35rem">💬 ${wo.negotiable_note}</div>`
        : '';

      return `<div class="sj-card" style="cursor:pointer" onclick="window.openSJDetailGarment('${wo.id}')">
        <div class="sj-card-header"><div class="sj-card-title">${wo.title}</div>
          <span class="badge ${wo.status === 'closed' ? 'badge-approved' : ''}">${wo.status.toUpperCase()}</span></div>
        <div class="sj-card-meta">${wo.target_quantity} pcs · Deadline: ${wo.deadline || '-'}</div>
        <div class="sj-card-items">${items || '-'}</div>
        ${priceLine}
        ${negoLine}
      </div>`;
    };

    if ($("garmentWorkList")) {
      $("garmentWorkList").innerHTML = open.length ? open.map(renderCard).join('') : '<div class="empty-state">Belum ada Surat Jalan aktif.</div>';
    }
    if ($("overviewList")) {
      $("overviewList").innerHTML = all.length ? all.slice(0, 5).map(wo => {
        const total = Number(wo.total_price) || 0;
        return `<div class="activity-item">
          <div class="activity-info">
            <div class="activity-title">${wo.title}</div>
            <div class="activity-meta">${wo.target_quantity} pcs · ${formatRp(total)}</div>
          </div>
          <span class="activity-status ${wo.status}">${wo.status}</span>
        </div>`;
      }).join('') : '<div class="empty-state">Belum ada aktivitas.</div>';
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
    // 1. Ambil WO open (buat tab Masuk)
    const { data: openRaw } = await KB.supabase.from('work_orders')
      .select('id, title, target_quantity, total_price, organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open').order('created_at', { ascending: false });

    // 2. Ambil WO yang udah dimenangkan (status accepted)
    // JANGAN join organizations, pakai RPC
    const { data: myApps, error: myAppsError } = await KB.supabase
      .from('work_order_applications')
      .select('work_order_id, work_orders(id, title, target_quantity, total_price, status, org_id)')
      .eq('org_id', org.id).eq('status', 'accepted');

    if (myAppsError) {
      console.error('[KO-BRAS] myApps error:', myAppsError);
    }

    const open = openRaw || [];
    let wonList = (myApps || []).map(a => a.work_orders).filter(Boolean);

    // Inject nama Garment via RPC
    if (wonList.length > 0) {
      const garmentIds = [...new Set(wonList.map(w => w.org_id).filter(Boolean))];
      if (garmentIds.length > 0) {
        const { data: garmentOrgs } = await KB.supabase.rpc('get_orgs_public', { p_ids: garmentIds });
        const garmentMap = {};
        (garmentOrgs || []).forEach(o => garmentMap[o.id] = o);
        wonList = wonList.map(w => ({ ...w, organizations: garmentMap[w.org_id] || null }));
      }
    }

    // Update Stats
    if ($("statAvailable")) $("statAvailable").textContent = open.length;
    if ($("statActive")) $("statActive").textContent = wonList.length;
    if ($("statDone")) $("statDone").textContent = 0;

    // Render tab "Masuk" (Daftar Surat Jalan Open)
    if ($("konveksiWorkList")) {
      $("konveksiWorkList").innerHTML = open.length ? open.map(wo => `
        <div class="activity-item" style="cursor:pointer" onclick="window.openSJDetail('${wo.id}')">
          <div class="activity-info">
            <div class="activity-title">${wo.title}</div>
            <div class="activity-meta">${wo.target_quantity} pcs · Dari: ${wo.organizations?.name || '-'}</div>
          </div>
          <div style="color:var(--muted); font-size:1.2rem">›</div>
        </div>
      `).join('') : '<div class="empty-state">Belum ada Surat Jalan tersedia.</div>';
    }

    // Render tab "Kerja" (Dikerjakan) -> INI YANG HILANG KEMARIN
    if ($("inProgressList")) {
      $("inProgressList").innerHTML = wonList.length ? wonList.map(wo => `
        <div class="activity-item" style="cursor:pointer; border-left:3px solid var(--ok); background:#ecfdf5;" onclick="window.openSJDetail('${wo.id}')">
          <div class="activity-info">
            <div class="activity-title">${wo.title}</div>
            <div class="activity-meta">${wo.target_quantity} pcs · Dari: ${wo.organizations?.name || '-'}</div>
          </div>
          <div style="color:var(--ok); font-size:1.2rem">›</div>
        </div>
      `).join('') : '<div class="empty-state">Belum ada pekerjaan aktif. Selesaikan lamaran di tab Masuk dulu.</div>';
    }

    // Render tab "Riwayat" (placeholder)
    if ($("riwayatList")) {
      $("riwayatList").innerHTML = '<div class="empty-state">Belum ada riwayat pekerjaan selesai.</div>';
    }

    // Render Overview (Beranda)
    if ($("overviewList")) {
      const combined = [...wonList, ...open];
      $("overviewList").innerHTML = combined.slice(0, 3).map(wo => {
        const isWon = wonList.some(w => w.id === wo.id);
        return `
          <div class="activity-item" onclick="window.openSJDetail('${wo.id}')" style="cursor:pointer; ${isWon ? 'background:#ecfdf5;' : ''}">
            <div class="activity-info">
              <div class="activity-title">${wo.title}</div>
              <div class="activity-meta">${wo.target_quantity} pcs</div>
            </div>
            <span class="activity-status ${isWon ? 'closed' : 'open'}">${isWon ? 'MENANG' : 'OPEN'}</span>
          </div>
        `;
      }).join('') || '<div class="empty-state">Belum ada aktivitas.</div>';
    }
  }

  // ============ YOUR ROOM (GARMENT) ============
  window.openYourRoom = async function(workOrderId) {
    const container = document.getElementById("yourRoomContent");
    if (!container) return;
    container.innerHTML = '<div class="empty-state">Memuat Room...</div>';

    // Query work order lengkap
    const { data: wo, error } = await KB.supabase.from('work_orders')
      .select('*, work_order_applications(status, org_id, message)')
      .eq('id', workOrderId).single();

    if (error || !wo) { container.innerHTML = '<div class="empty-state" style="color:var(--err)">Room tidak ditemukan.</div>'; return; }

    const acceptedApp = (wo.work_order_applications || []).find(a => a.status === 'accepted');
    if (!acceptedApp) { container.innerHTML = '<div class="empty-state">Belum ada konveksi yang diterima di room ini.</div>'; return; }

    // Ambil nama konveksi via RPC
    const { data: orgs } = await KB.supabase.rpc('get_orgs_public', { p_ids: [acceptedApp.org_id] });
    const konveksiName = orgs?.[0]?.name || 'Konveksi';

    container.innerHTML = `
      <div style="text-align:center; margin-bottom:2rem;">
        <div style="font-size:2.5rem; margin-bottom:.5rem">🎉</div>
        <h2 style="margin:0 0 .5rem">Kerja Sama Terjalin!</h2>
        <p class="muted">Anda telah memilih <b>${konveksiName}</b> untuk mengerjakan proyek ini.</p>
      </div>

      <div style="background:var(--surface-2); border:1px solid var(--border); border-radius:var(--radius); padding:1.5rem; margin-bottom:1.5rem;">
        <h3 style="margin:0 0 1rem; font-size:1rem; color:var(--brand);">📦 ${wo.title}</h3>
        <div style="display:flex; justify-content:space-between; margin-bottom:.5rem; font-size:.9rem;">
          <span>Qty Target:</span><strong>${wo.target_quantity} pcs</strong>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:.5rem; font-size:.9rem;">
          <span>Harga Borongan:</span><strong>${formatRp(wo.total_price)}</strong>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:.9rem;">
          <span>Mitra:</span><strong>${konveksiName}</strong>
        </div>
      </div>

      <div style="background:#fffbeb; border:1px solid #fcd34d; border-radius:var(--radius); padding:1.25rem; text-align:center;">
        <div style="font-size:1.5rem; margin-bottom:.5rem">⏳</div>
        <h3 style="font-size:1rem; margin:0 0 .5rem; color:#92400e;">Menunggu Konveksi Membuka Room</h3>
        <p class="small" style="margin:0; color:#92400e;">
          Konveksi <b>${konveksiName}</b> akan menerima notifikasi untuk membayar biaya Room (Rp 30.000). 
          Setelah dibayar, Anda dapat memantau progres produksi di halaman ini.
        </p>
      </div>
    `;

    document.getElementById("backToGarmentListRoom").onclick = () => switchTab('surat-jalan');
  };


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
