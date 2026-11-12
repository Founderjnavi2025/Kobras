
(function () {
  const KB = window.KB;
  if (!KB || !KB.supabase) return;

  const $ = id => document.getElementById(id);

  let currentOrg = null;
  let garmentCache = [];

  function formatRp(n) {
    return 'Rp ' + Number(n || 0).toLocaleString('id-ID', {
      maximumFractionDigits: 0
    });
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  }

  function statusLabel(status) {
    const labels = {
      open: 'TERBUKA',
      matched: 'MITRA DIPILIH',
      in_progress: 'SEDANG DIKERJAKAN',
      completed: 'SELESAI',
      cancelled: 'DIBATALKAN'
    };
    return labels[status] || String(status || '-').toUpperCase();
  }

  function formatDate(date) {
    if (!date) return '-';
    return new Date(date + 'T00:00:00').toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });
  }

  function showError(error, fallback) {
    console.error('[KO-BRAS]', error);
    KB.showToast(error?.message || fallback, 'error');
  }

  window.switchTab = function (tab) {
    document.querySelectorAll('.tab-section').forEach(section => {
      section.hidden = true;
    });

    const target = $(`tab-${tab}`);
    if (target) target.hidden = false;

    document.querySelectorAll('.dash-nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });

    document.querySelectorAll('.bottom-nav-item').forEach(button => {
      button.classList.toggle('active', button.dataset.nav === tab);
    });

    const titles = {
      overview: 'Overview',
      'surat-jalan': 'Surat Jalan',
      dikerjakan: 'Sedang Dikerjakan',
      riwayat: 'Riwayat',
      'detail-sj': 'Detail Surat Jalan',
      'your-room': 'Your Room',
      profil: 'Profil Usaha',
      pengaturan: 'Pengaturan'
    };

    if ($('pageTitle')) $('pageTitle').textContent = titles[tab] || tab;

    $('dashSidebar')?.classList.remove('open');
    $('dashOverlay')?.classList.remove('open');
  };

  async function getMyOrg() {
    const { data: { session }, error: sessionError } =
      await KB.supabase.auth.getSession();

    if (sessionError) throw sessionError;
    if (!session) return null;

    const { data: org, error } = await KB.supabase
      .from('organizations')
      .select('id, name, type, city, province')
      .eq('created_by', session.user.id)
      .maybeSingle();

    if (error) throw error;
    if (!org) return null;

    org.userId = session.user.id;
    org.email = session.user.email;

    return org;
  }

  async function fillHeader(org) {
    if ($('sidebarEmail')) $('sidebarEmail').textContent = org.email || '—';
    if ($('greetingName')) $('greetingName').textContent = org.name || 'Pengguna';
    if ($('greetingType')) {
      $('greetingType').textContent =
        org.type === 'garment' ? 'Pemilik Modal' : 'Konveksi';
    }
    if ($('greetingCity')) $('greetingCity').textContent = org.city || '—';
    if ($('logoutEmail')) $('logoutEmail').textContent = org.email || '—';
    if ($('settingEmail')) $('settingEmail').textContent = org.email || '—';

    const { data: verif, error } = await KB.supabase
      .from('organization_verifications')
      .select('status')
      .eq('org_id', org.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) console.warn('Verifikasi:', error.message);

    const map = {
      pending: 'Menunggu',
      in_review: 'Diperiksa',
      approved: 'Terverifikasi',
      rejected: 'Ditolak',
      expired: 'Kedaluwarsa'
    };

    if ($('settingVerif')) {
      $('settingVerif').textContent =
        verif ? (map[verif.status] || verif.status) : 'Belum diajukan';

      if (verif?.status === 'approved') {
        $('settingVerif').className = 'badge badge-approved';
      }
    }
  }

  async function fillProfileForm(org) {
    const form = $('orgProfileForm');
    if (!form) return;

    form.name.value = org.name || '';
    form.city.value = org.city || '';
    form.province.value = org.province || '';

    form.onsubmit = async e => {
      e.preventDefault();

      const { error } = await KB.supabase
        .from('organizations')
        .update({
          name: form.name.value.trim(),
          city: form.city.value.trim() || null,
          province: form.province.value.trim() || null
        })
        .eq('id', org.id);

      if (error) return showError(error, 'Gagal memperbarui profil.');

      org.name = form.name.value.trim();
      org.city = form.city.value.trim();
      org.province = form.province.value.trim();

      await fillHeader(org);
      KB.showToast('Profil diperbarui!', 'success');
    };
  }

  // ==========================================
  // GARMENT: TERBITKAN SURAT JALAN
  // ==========================================

  async function createGarmentWorkOrder(event) {
    event.preventDefault();

    const form = $('createWorkForm');
    if (!form || !currentOrg) return;

    const button = form.querySelector('[type="submit"]');
    const originalText = button?.textContent || 'Terbitkan Surat Jalan';

    const title = form.elements.title.value.trim();
    const description = form.elements.description.value.trim();
    const quantity = Number(form.elements.target_quantity.value);
    const deadline = form.elements.deadline.value || null;
    const itemsRaw = form.elements.items.value.trim();
    const address = form.elements.address.value.trim();
    const picName = form.elements.pic_name.value.trim();
    const picPhone = form.elements.pic_phone.value.trim();
    const totalPrice = Number(form.elements.total_price.value);
    const negotiableNote = form.elements.negotiable_note.value.trim();

    if (!title || !itemsRaw || !address || !picName || !picPhone) {
      return KB.showToast('Lengkapi semua data wajib.', 'error');
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return KB.showToast('Jumlah pcs tidak valid.', 'error');
    }

    if (!Number.isFinite(totalPrice) || totalPrice < 1000) {
      return KB.showToast('Total harga tidak valid.', 'error');
    }

    const items = itemsRaw
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    if (!items.length) {
      return KB.showToast('Detail bahan wajib diisi.', 'error');
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'Menerbitkan...';
    }

    try {
      const payload = {
        org_id: currentOrg.id,
        created_by: currentOrg.userId,
        title,
        description: description || null,
        target_quantity: quantity,
        deadline,
        address,
        pic_name: picName,
        pic_phone: picPhone,
        total_price: totalPrice,
        negotiable_note: negotiableNote || null,
        status: 'open'
      };

      // 1. Simpan surat jalan
      const { data: wo, error: woError } = await KB.supabase
        .from('work_orders')
        .insert(payload)
        .select('id')
        .single();

      if (woError) throw woError;

      // 2. Simpan detail bahan
      const itemPayload = items.map(name => ({
        work_order_id: wo.id,
        name
      }));

      const { error: itemError } = await KB.supabase
        .from('work_order_items')
        .insert(itemPayload);

      if (itemError) {
        console.error('Detail bahan gagal disimpan:', itemError);
        KB.showToast(
          'SJ berhasil dibuat, tetapi detail bahan gagal disimpan: ' + itemError.message,
          'error'
        );
      } else {
        KB.showToast('Surat Jalan berhasil diterbitkan!', 'success');
      }

      form.reset();

      // 3. Refresh daftar dari Supabase
      await loadGarment(currentOrg);

      // 4. Tampilkan daftar SJ
      switchTab('surat-jalan');

      $('garmentWorkList')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });

    } catch (error) {
      showError(error, 'Gagal menerbitkan Surat Jalan.');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  // ==========================================
  // GARMENT: DAFTAR SURAT JALAN
  // ==========================================

  async function loadGarment(org) {
    const list = $('garmentWorkList');
    if (list) list.innerHTML = '<div class="empty-state">Memuat Surat Jalan...</div>';

    const { data: wos, error } = await KB.supabase
      .from('work_orders')
      .select(`
        *,
        work_order_items(name),
        work_order_applications(id, status, org_id)
      `)
      .eq('org_id', org.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('loadGarment:', error);
      if (list) {
        list.innerHTML = `
          <div class="empty-state" style="color:var(--err)">
            Gagal memuat Surat Jalan: ${esc(error.message)}
          </div>`;
      }
      return;
    }

    const all = wos || [];
    garmentCache = all;

    // Ambil nama konveksi pelamar
    const appOrgIds = [
      ...new Set(
        all.flatMap(w =>
          (w.work_order_applications || []).map(a => a.org_id)
        ).filter(Boolean)
      )
    ];

    if (appOrgIds.length) {
      const { data: orgs, error: orgError } = await KB.supabase
        .rpc('get_orgs_public', { p_ids: appOrgIds });

      if (orgError) console.warn('Nama konveksi:', orgError.message);

      const orgMap = {};
      (orgs || []).forEach(o => {
        orgMap[o.id] = o;
      });

      all.forEach(w => {
        (w.work_order_applications || []).forEach(a => {
          a.organizations = orgMap[a.org_id] || null;
        });
      });
    }

    const active = all.filter(w =>
      ['open', 'matched', 'in_progress'].includes(w.status)
    );

    const history = all.filter(w =>
      ['completed', 'cancelled'].includes(w.status)
    );

    const done = all.filter(w => w.status === 'completed');

    if ($('statActive')) $('statActive').textContent = active.length;
    if ($('statDone')) $('statDone').textContent = done.length;

    if ($('statNilai')) {
      const total = all.reduce(
        (sum, w) => sum + Number(w.total_price || 0), 0
      );
      $('statNilai').textContent = formatRp(total);
    }

    function renderCard(wo) {
      const items = (wo.work_order_items || [])
        .map(i => esc(i.name))
        .join(', ');

      const pendingApps = (wo.work_order_applications || [])
        .filter(a => a.status === 'pending');

      const accepted = (wo.work_order_applications || [])
        .find(a => a.status === 'accepted');

      let actionHtml = '';

      if (wo.status === 'open' && pendingApps.length) {
        actionHtml = `
          <div style="margin-top:.65rem">
            <strong class="small">Pelamar (${pendingApps.length}):</strong>
            ${pendingApps.map(a => `
              <div class="applicant-item">
                <span class="small">
                  ${esc(a.organizations?.name || 'Konveksi')}
                </span>
                <button class="btn btn-primary btn-sm"
                  onclick="event.stopPropagation(); KB.acceptApp('${a.id}')">
                  Terima
                </button>
              </div>
            `).join('')}
          </div>`;
      }

      if (accepted) {
        actionHtml += `
          <div class="small" style="color:var(--ok); margin-top:.5rem">
            ✓ Mitra: <b>${esc(accepted.organizations?.name || 'Konveksi')}</b>
          </div>`;
      }

      const total = Number(wo.total_price || 0);
      const perPcs = wo.target_quantity > 0
        ? total / wo.target_quantity
        : 0;

      return `
        <div class="sj-card" style="cursor:pointer"
          onclick="window.openSJDetailGarment('${wo.id}')">

          <div class="sj-card-header">
            <div class="sj-card-title">${esc(wo.title)}</div>
            <span class="badge ${wo.status === 'completed' ? 'badge-approved' : ''}">
              ${statusLabel(wo.status)}
            </span>
          </div>

          <div class="sj-card-meta">
            ${Number(wo.target_quantity).toLocaleString('id-ID')} pcs
            · Deadline: ${formatDate(wo.deadline)}
          </div>

          <div class="sj-card-items">${items || '-'}</div>

          <div style="font-size:.85rem; margin:.4rem 0; color:var(--brand)">
            💰 <b>${formatRp(total)}</b> borongan
            · ${formatRp(perPcs)}/pcs
          </div>

          ${wo.negotiable_note ? `
            <div class="small" style="color:var(--muted)">
              💬 ${esc(wo.negotiable_note)}
            </div>` : ''}

          ${actionHtml}
        </div>`;
    }

    if (list) {
      list.innerHTML = active.length
        ? active.map(renderCard).join('')
        : '<div class="empty-state">Belum ada Surat Jalan aktif. Terbitkan SJ pertama Anda.</div>';
    }

    if ($('overviewList')) {
      $('overviewList').innerHTML = all.length
        ? all.slice(0, 5).map(wo => `
          <div class="activity-item"
            style="cursor:pointer"
            onclick="window.openSJDetailGarment('${wo.id}')">
            <div class="activity-info">
              <div class="activity-title">${esc(wo.title)}</div>
              <div class="activity-meta">
                ${Number(wo.target_quantity).toLocaleString('id-ID')} pcs
                · ${formatRp(wo.total_price)}
              </div>
            </div>
            <span class="activity-status ${esc(wo.status)}">
              ${statusLabel(wo.status)}
            </span>
          </div>
        `).join('')
        : '<div class="empty-state">Belum ada aktivitas.</div>';
    }

    if ($('riwayatList')) {
      $('riwayatList').innerHTML = history.length
        ? history.map(renderCard).join('')
        : '<div class="empty-state">Belum ada riwayat pekerjaan selesai.</div>';
    }
  }

  // ==========================================
  // DETAIL SURAT JALAN
  // ==========================================

  window.openSJDetailGarment = function (id) {
    const wo = garmentCache.find(item => item.id === id);
    if (!wo) return;

    const container = $('sjDetailGarment');
    if (!container) return;

    const items = (wo.work_order_items || [])
      .map(i => `<li>${esc(i.name)}</li>`)
      .join('');

    container.innerHTML = `
      <h2>${esc(wo.title)}</h2>
      <span class="badge">${statusLabel(wo.status)}</span>

      <div style="margin-top:1rem">
        <p><b>Jumlah:</b> ${wo.target_quantity} pcs</p>
        <p><b>Deadline:</b> ${formatDate(wo.deadline)}</p>
        <p><b>Total borongan:</b> ${formatRp(wo.total_price)}</p>
        <p><b>Alamat:</b> ${esc(wo.address || '-')}</p>
        <p><b>PIC:</b> ${esc(wo.pic_name || '-')}</p>
        <p><b>Telepon:</b> ${esc(wo.pic_phone || '-')}</p>
        <p><b>Deskripsi:</b> ${esc(wo.description || '-')}</p>
        <p><b>Catatan nego:</b> ${esc(wo.negotiable_note || '-')}</p>

        <h3>Detail Bahan</h3>
        <ul>${items || '<li>-</li>'}</ul>
      </div>
    `;

    switchTab('detail-sj');
  };

  $('backToGarmentList')?.addEventListener('click', () => {
    switchTab('surat-jalan');
  });

  // ==========================================
  // TERIMA LAMARAN KONVEKSI
  // ==========================================

  KB.acceptApp = async function (appId) {
    if (!confirm('Terima konveksi ini? Konveksi lain otomatis ditolak.')) {
      return;
    }

    const { error } = await KB.supabase.rpc('accept_application', {
      p_app_id: appId
    });

    if (error) return showError(error, 'Gagal menerima konveksi.');

    KB.showToast('Konveksi diterima!', 'success');
    await loadGarment(currentOrg);
  };

  // ==========================================
  // YOUR ROOM
  // ==========================================

  window.openYourRoom = async function (workOrderId) {
    const container = $('yourRoomContent');
    if (!container) return;

    container.innerHTML = '<div class="empty-state">Memuat Room...</div>';

    const { data: wo, error } = await KB.supabase
      .from('work_orders')
      .select('*, work_order_applications(status, org_id, message)')
      .eq('id', workOrderId)
      .single();

    if (error || !wo) {
      container.innerHTML = `
        <div class="empty-state" style="color:var(--err)">
          Room tidak ditemukan.
        </div>`;
      return;
    }

    const accepted = (wo.work_order_applications || [])
      .find(a => a.status === 'accepted');

    if (!accepted) {
      container.innerHTML = `
        <div class="empty-state">
          Belum ada konveksi yang diterima di room ini.
        </div>`;
      return;
    }

    const { data: orgs } = await KB.supabase.rpc('get_orgs_public', {
      p_ids: [accepted.org_id]
    });

    const konveksiName = orgs?.[0]?.name || 'Konveksi';

    const roomMessage = wo.status === 'in_progress'
      ? 'Pekerjaan sedang berjalan. Anda dapat memantau progres produksi.'
      : wo.status === 'completed'
        ? 'Pekerjaan telah selesai.'
        : 'Menunggu proses selanjutnya dari mitra konveksi.';

    container.innerHTML = `
      <div style="text-align:center; margin-bottom:2rem">
        <div style="font-size:2.5rem">📦</div>
        <h2>${esc(wo.title)}</h2>
        <p class="muted">${esc(roomMessage)}</p>
      </div>

      <div style="background:var(--surface-2); padding:1.5rem; border-radius:var(--radius)">
        <p><b>Status:</b> ${statusLabel(wo.status)}</p>
        <p><b>Jumlah:</b> ${wo.target_quantity} pcs</p>
        <p><b>Harga borongan:</b> ${formatRp(wo.total_price)}</p>
        <p><b>Mitra:</b> ${esc(konveksiName)}</p>
      </div>
    `;

    $('backToGarmentListRoom')?.addEventListener('click', () => {
      switchTab('surat-jalan');
    }, { once: true });
  };

  // ==========================================
  // KONVEKSI
  // ==========================================

  async function loadKonveksi(org) {
    const { data: openRaw, error: openError } = await KB.supabase
      .from('work_orders')
      .select('id, title, target_quantity, total_price, org_id, organizations!work_orders_org_id_fkey(name)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    if (openError) console.error('openRaw:', openError);

    const { data: myApps, error: appError } = await KB.supabase
      .from('work_order_applications')
      .select('work_order_id, work_orders(id, title, target_quantity, total_price, status, org_id)')
      .eq('org_id', org.id)
      .eq('status', 'accepted');

    if (appError) console.error('myApps:', appError);

    let wonList = (myApps || [])
      .map(a => a.work_orders)
      .filter(Boolean);

    if (wonList.length) {
      const ids = [...new Set(wonList.map(w => w.org_id).filter(Boolean))];

      if (ids.length) {
        const { data: orgs } = await KB.supabase.rpc('get_orgs_public', {
          p_ids: ids
        });

        const map = {};
        (orgs || []).forEach(o => map[o.id] = o);

        wonList = wonList.map(w => ({
          ...w,
          organizations: map[w.org_id] || null
        }));
      }
    }

    const open = openRaw || [];

    if ($('statAvailable')) $('statAvailable').textContent = open.length;
    if ($('statActive')) {
      $('statActive').textContent = wonList.filter(w =>
        ['matched', 'in_progress'].includes(w.status)
      ).length;
    }
    if ($('statDone')) {
      $('statDone').textContent = wonList.filter(w =>
        w.status === 'completed'
      ).length;
    }

    if ($('konveksiWorkList')) {
      $('konveksiWorkList').innerHTML = open.length
        ? open.map(wo => `
          <div class="activity-item" style="cursor:pointer"
            onclick="window.openSJDetail('${wo.id}')">
            <div class="activity-info">
              <div class="activity-title">${esc(wo.title)}</div>
              <div class="activity-meta">
                ${wo.target_quantity} pcs · Dari: ${esc(wo.organizations?.name || '-')}
              </div>
            </div>
            <div>›</div>
          </div>
        `).join('')
        : '<div class="empty-state">Belum ada Surat Jalan tersedia.</div>';
    }

    if ($('inProgressList')) {
      const active = wonList.filter(w =>
        ['matched', 'in_progress'].includes(w.status)
      );

      $('inProgressList').innerHTML = active.length
        ? active.map(wo => `
          <div class="activity-item" style="cursor:pointer"
            onclick="window.openSJDetail('${wo.id}')">
            <div class="activity-info">
              <div class="activity-title">${esc(wo.title)}</div>
              <div class="activity-meta">${wo.target_quantity} pcs</div>
            </div>
            <span>${statusLabel(wo.status)}</span>
          </div>
        `).join('')
        : '<div class="empty-state">Belum ada pekerjaan aktif.</div>';
    }

    if ($('riwayatList')) {
      const history = wonList.filter(w =>
        ['completed', 'cancelled'].includes(w.status)
      );

      $('riwayatList').innerHTML = history.length
        ? history.map(wo => `
          <div class="activity-item">
            <div class="activity-info">
              <div class="activity-title">${esc(wo.title)}</div>
              <div class="activity-meta">${wo.target_quantity} pcs</div>
            </div>
            <span>${statusLabel(wo.status)}</span>
          </div>
        `).join('')
        : '<div class="empty-state">Belum ada riwayat pekerjaan.</div>';
    }

    if ($('overviewList')) {
      const combined = [...wonList, ...open]
        .filter((wo, index, arr) =>
          arr.findIndex(x => x.id === wo.id) === index
        );

      $('overviewList').innerHTML = combined.length
        ? combined.slice(0, 5).map(wo => `
          <div class="activity-item">
            <div class="activity-info">
              <div class="activity-title">${esc(wo.title)}</div>
              <div class="activity-meta">${wo.target_quantity} pcs</div>
            </div>
            <span>${statusLabel(wo.status)}</span>
          </div>
        `).join('')
        : '<div class="empty-state">Belum ada aktivitas.</div>';
    }
  }

  // ==========================================
  // INITIALIZATION
  // ==========================================

  window.initDashboardData = async function (type) {
    try {
      const org = await getMyOrg();

      if (!org) {
        KB.showToast('Organisasi tidak ditemukan.', 'error');
        return;
      }

      currentOrg = org;

      await fillHeader(org);
      await fillProfileForm(org);

      if (type === 'garment') {
        await loadGarment(org);

        const form = $('createWorkForm');
        if (form) {
          form.onsubmit = createGarmentWorkOrder;
        }
      } else {
        await loadKonveksi(org);
      }

    } catch (error) {
      showError(error, 'Gagal memuat dashboard.');
    }
  };
})();
