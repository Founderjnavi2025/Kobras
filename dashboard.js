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
    const { data: openRaw } = await KB.supabase.from('work_orders')
      .select('id, title, target_quantity, total_price, organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open').order('created_at', { ascending: false });

    const open = openRaw || [];

    if ($("statAvailable")) $("statAvailable").textContent = open.length;
    // Stat lainnya (Dikerjakan, Selesai) di-update nanti aja di fase Logistik
    
    if ($("konveksiWorkList")) {
      $("konveksiWorkList").innerHTML = open.length ? open.map(wo => `
        <div class="activity-item" style="cursor:pointer" onclick="window.openSJDetail('${wo.id}')">
          <div class="activity-info">
            <div class="activity-title">${wo.title}</div>
            <div class="activity-meta">${wo.target_quantity} pcs · Dari: ${wo.organizations?.name || '-'}</div>
          </div>
          <div style="color:var(--muted); font-size:1.2rem">›</div>
        </div>
      `).join('') : '<div class="empty-state">Belum ada Surat Jalan.</div>';
    }

    if ($("overviewList")) {
      $("overviewList").innerHTML = open.slice(0, 3).map(wo => `
        <div class="activity-item" onclick="window.openSJDetail('${wo.id}')" style="cursor:pointer">
          <div class="activity-info">
            <div class="activity-title">${wo.title}</div>
            <div class="activity-meta">${wo.target_quantity} pcs</div>
          </div>
          <span class="activity-status open">OPEN</span>
        </div>
      `).join('') || '<div class="empty-state">Belum ada aktivitas.</div>';
    }
  }

  // --- B. Fungsi buka Detail SJ ---
  window.openSJDetail = async function(woId) {
    switchTab('detail-sj');
    const container = document.getElementById("sjDetailContent");
    container.innerHTML = '<div class="empty-state">Memuat detail...</div>';

    const org = await getMyOrg();
    if (!org) return;

    // Ambil data WO lengkap + item + lamaran (komentar)
    const { data: wo, error } = await KB.supabase.from('work_orders')
      .select('*, work_order_items(name), work_order_applications(id, status, org_id, message, applied_at)')
      .eq('id', woId).single();

    // Ambil nama Garment via RPC (karena RLS blok join langsung)
    if (wo && wo.org_id) {
      const { data: garmentOrgs } = await KB.supabase.rpc('get_orgs_public', { p_ids: [wo.org_id] });
      wo.organizations = (garmentOrgs && garmentOrgs[0]) || null;
    }

    if (error) { container.innerHTML = `<div class="empty-state" style="color:var(--err)">Error: ${error.message}</div>`; return; }

    // Ambil nama-nama pelamar (buat komentar)
    const appOrgIds = (wo.work_order_applications || []).map(a => a.org_id);
    let orgMap = {};
    if (appOrgIds.length > 0) {
      const { data: orgs } = await KB.supabase.rpc('get_orgs_public', { p_ids: appOrgIds });
      (orgs || []).forEach(o => orgMap[o.id] = o);
    }

    // Cek status lamaran gue
    const myApp = (wo.work_order_applications || []).find(a => a.org_id === org.id);
    
    // Format tanggal
    const fmtDate = (d) => d ? new Date(d).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric' }) : '-';
    const fmtTime = (d) => d ? new Date(d).toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }) : '';

    // Render Komentar
    const commentsHtml = (wo.work_order_applications || []).map(a => {
      const isMe = a.org_id === org.id;
      const name = orgMap[a.org_id]?.name || 'Konveksi';
      return `
        <div style="background: ${isMe ? 'var(--brand-light)' : '#fff'}; padding:.85rem; border-radius:8px; border:1px solid var(--border); margin-bottom:.65rem;">
          <div style="display:flex; justify-content:space-between; margin-bottom:.35rem;">
            <strong style="font-size:.85rem; color:${isMe ? 'var(--brand)' : 'var(--text)'}">${name} ${isMe ? '(Anda)' : ''}</strong>
            <span class="small muted">${fmtDate(a.applied_at)} ${fmtTime(a.applied_at)}</span>
          </div>
          <p style="margin:0; font-size:.9rem;">${a.message || '(Tidak ada pesan)'}</p>
          ${a.status === 'accepted' ? '<span class="small" style="color:var(--ok); font-weight:700; display:block; margin-top:.35rem">✓ Diterima</span>' : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="margin-bottom:1.5rem;">
        <h2 style="margin:0 0 .5rem">${wo.title}</h2>
        <p class="muted small">Dari: <b>${wo.organizations?.name || '-'}</b> · Deadline: ${fmtDate(wo.deadline)}</p>
      </div>

      <div style="background:var(--surface-2); padding:1rem; border-radius:8px; margin-bottom:1.5rem; border:1px solid var(--border);">
        <h3 style="font-size:.9rem; margin:0 0 .75rem; color:var(--muted); text-transform:uppercase; letter-spacing:.05em;">Detail Pekerjaan</h3>
        <p style="margin:0 0 .5rem; font-size:.95rem;">${wo.description || 'Tidak ada deskripsi.'}</p>
        
        <div style="display:flex; justify-content:space-between; font-size:.9rem; margin-top:1rem; padding-top:1rem; border-top:1px dashed var(--border);">
          <span>Target: <b>${wo.target_quantity} pcs</b></span>
          <span>Bahan: <b>${(wo.work_order_items||[]).map(i=>i.name).join(', ') || '-'}</b></span>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:.9rem; margin-top:.5rem;">
          <span>Harga: <b style="color:var(--brand)">${formatRp(wo.total_price)}</b> (Borongan)</span>
          <span>Setara <b>${formatRp((wo.total_price||0)/wo.target_quantity)}/pcs</b></span>
        </div>
        ${wo.negotiable_note ? `<div class="small" style="margin-top:.5rem; font-style:italic; color:var(--muted)">💬 ${wo.negotiable_note}</div>` : ''}
        
        <!-- INFO TAMBAHAN (SCOPE) -->
        <div style="margin-top:1rem; padding-top:1rem; border-top:1px dashed var(--border);">
          <div style="font-size:.85rem; margin-bottom:.5rem;">
            <span style="color:var(--muted)">Alamat Jemput/Kirim:</span><br>
            <b>${wo.address || '-'}</b>
          </div>
          <div style="font-size:.85rem;">
            <span style="color:var(--muted)">PIC:</span><br>
            <b>${wo.pic_name || '-'}</b> · <a href="https://wa.me/${wo.pic_phone?.replace(/^0/, '62')}" target="_blank" style="color:var(--brand); text-decoration:underline">${wo.pic_phone || '-'}</a>
          </div>
        </div>
      </div>

      <div style="margin-bottom:1.5rem;">
        <h3 style="font-size:1rem; margin-bottom:1rem;">Ajuan & Komentar (${(wo.work_order_applications||[]).length})</h3>
        <div style="max-height:300px; overflow-y:auto; padding-right:.5rem;">
          ${commentsHtml || '<div class="empty-state small">Belum ada ajuan. Jadilah yang pertama!</div>'}
        </div>
      </div>

      ${!myApp ? `
        <div style="position:sticky; bottom:0; background:var(--surface); padding-top:1rem; border-top:1px solid var(--border);">
          <textarea id="applyMessage" placeholder="Tulis kesediaan Anda (Cth: Sanggup bos, 1000pcs 4jt, minggu depan jalan)" rows="3" style="width:100%; padding:.75rem; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; color:var(--text); font-family:inherit; resize:none; margin-bottom:.5rem;"></textarea>
          <button class="btn btn-primary btn-block" onclick="window.submitApplication('${wo.id}', '${org.id}')">Kirim Ajuan Kesediaan</button>
        </div>
      ` : `<div class="empty-state small" style="background:var(--surface-2); border-radius:8px; padding:1rem; border:1px solid var(--border)">Anda sudah mengajukan kesediaan.</div>`}
    `;

    // Listener back button
    document.getElementById("backToSJList").onclick = () => switchTab('surat-jalan');
  };

  // --- C. Fungsi kirim lamaran + komentar ---
  window.submitApplication = async function(woId, orgId) {
    const msg = document.getElementById("applyMessage").value.trim();
    if (!msg) return KB.showToast("Tulis pesan kesediaan dulu", "error");

    const btn = event.target;
    KB.setLoading(btn, true, "Mengirim...");

    const { error } = await KB.supabase.from('work_order_applications').insert({
      work_order_id: woId, org_id: orgId, message: msg
    });

    if (error) {
      KB.setLoading(btn, false, "Kirim Ajuan Kesediaan");
      return KB.showToast(error.code === '23505' ? 'Anda sudah mengajukan ini.' : error.message, 'error');
    }

    KB.showToast("Ajuan berhasil dikirim!", "success");
    window.openSJDetail(woId); // Refresh halaman detail
  };
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

    // Validasi
    if (!form.title.value.trim()) return KB.showToast('Judul wajib diisi', 'error');
    if (!form.target_quantity.value) return KB.showToast('Target Qty wajib diisi', 'error');
    if (!form.items.value.trim()) return KB.showToast('Bahan wajib diisi', 'error');
    if (!form.address.value.trim()) return KB.showToast('Alamat wajib diisi', 'error');
    if (!form.pic_name.value.trim()) return KB.showToast('Nama PIC wajib diisi', 'error');
    if (!form.pic_phone.value.trim()) return KB.showToast('No WA PIC wajib diisi', 'error');
    if (!form.total_price.value) return KB.showToast('Total harga wajib diisi', 'error');

    KB.setLoading(btn, true, 'Menerbitkan...');

    const { data: wo, error } = await KB.supabase.from('work_orders').insert({
      org_id: org.id, 
      created_by: org.userId, 
      title: form.title.value.trim(),
      description: form.description.value.trim() || null,
      target_quantity: parseInt(form.target_quantity.value),
      deadline: form.deadline.value || null,
      address: form.address.value.trim(),
      pic_name: form.pic_name.value.trim(),
      pic_phone: form.pic_phone.value.trim(),
      total_price: parseFloat(form.total_price.value),
      negotiable_note: form.negotiable_note.value.trim() || null
    }).select().single();

    if (error) { 
      KB.setLoading(btn, false, 'Terbitkan Surat Jalan'); 
      return KB.showToast(error.message, 'error'); 
    }

    // Simpan item bahan
    await KB.supabase.from('work_order_items').insert({ 
      work_order_id: wo.id, 
      name: form.items.value.trim() 
    });

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
