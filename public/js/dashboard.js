// Dashboard logic — cooks + admin

let token = null;
let role = null;
let username = null;
let refreshInterval = null;
let pendingDeleteId = null;
let selectedLogoFile = null;
let lastOrderCount = 0;

// ─── INIT ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  token = localStorage.getItem('token');
  role = localStorage.getItem('role');
  username = localStorage.getItem('username');

  if (!token) {
    window.location.href = '/login.html';
    return;
  }

  // Set user avatar
  const avatar = document.getElementById('userAvatar');
  avatar.textContent = (username || '?').charAt(0).toUpperCase();

  // Show admin tab if admin
  if (role === 'admin') {
    document.getElementById('tabAdmin').style.display = 'inline-flex';
  }

  loadLogo();
  loadOrders();

  // Auto-refresh every 10 seconds
  refreshInterval = setInterval(loadOrders, 10000);

  setupLogoUpload();
});

// ─── LOGO ─────────────────────────────────────────────────────────────────

async function loadLogo() {
  try {
    const res = await fetch('/api/logo');
    const data = await res.json();
    if (data.path) {
      const navImg = document.getElementById('navLogoImg');
      const navDef = document.getElementById('navLogoDefault');
      navImg.src = data.path + '?t=' + Date.now();
      navImg.style.display = 'block';
      if (navDef) navDef.style.display = 'none';
    }
  } catch (_) {}
}

// ─── TABS ─────────────────────────────────────────────────────────────────

function showTab(tab) {
  const ordersSection = document.getElementById('ordersSection');
  const adminSection = document.getElementById('adminSection');
  const tabOrders = document.getElementById('tabOrders');
  const tabAdmin = document.getElementById('tabAdmin');

  if (tab === 'orders') {
    ordersSection.style.display = 'block';
    adminSection.classList.remove('visible');
    tabOrders.classList.add('active');
    tabAdmin.classList.remove('active');
  } else {
    ordersSection.style.display = 'none';
    adminSection.classList.add('visible');
    tabOrders.classList.remove('active');
    tabAdmin.classList.add('active');
    loadCooks();
    loadAdminStats();
  }
}

// ─── ORDERS ───────────────────────────────────────────────────────────────

async function loadOrders() {
  try {
    const res = await fetch('/api/orders', {
      headers: { Authorization: 'Bearer ' + token }
    });

    if (res.status === 401) { logout(); return; }

    const orders = await res.json();

    // Notify if new orders arrived
    if (orders.length > lastOrderCount && lastOrderCount > 0) {
      const newCount = orders.length - lastOrderCount;
      showToast('info', `🔔 ${newCount} nouvelle${newCount > 1 ? 's' : ''} commande${newCount > 1 ? 's' : ''} reçue${newCount > 1 ? 's' : ''} !`);
    }
    lastOrderCount = orders.length;

    renderKanban(orders);
    updateStats(orders);
  } catch (_) {}
}

function renderKanban(orders) {
  const columns = {
    en_charge: document.getElementById('colEnCharge'),
    en_cours: document.getElementById('colEnCours'),
    traitee: document.getElementById('colTraitee')
  };

  const counts = { en_charge: 0, en_cours: 0, traitee: 0 };
  const fragments = { en_charge: [], en_cours: [], traitee: [] };

  orders.forEach(order => {
    if (counts[order.status] !== undefined) {
      counts[order.status]++;
      fragments[order.status].push(buildOrderCard(order));
    }
  });

  document.getElementById('countEnCharge').textContent = counts.en_charge;
  document.getElementById('countEnCours').textContent = counts.en_cours;
  document.getElementById('countTraitee').textContent = counts.traitee;

  const empties = {
    en_charge: '<div class="empty-state"><div class="empty-icon">📭</div>Aucune commande en attente</div>',
    en_cours: '<div class="empty-state"><div class="empty-icon">🍳</div>Aucune commande en préparation</div>',
    traitee: '<div class="empty-state"><div class="empty-icon">🎉</div>Aucune commande traitée</div>'
  };

  Object.entries(columns).forEach(([status, col]) => {
    col.innerHTML = fragments[status].length
      ? fragments[status].join('')
      : empties[status];
  });
}

function buildOrderCard(order) {
  const time = formatTime(order.created_at);
  const isAdmin = role === 'admin';

  const actionButtons = buildActionButtons(order);

  return `
    <div class="order-card ${order.status}" id="card-${order.id}">
      <div class="order-header">
        <span class="order-number">#${String(order.num || '?').padStart(3, '0')}</span>
        <span class="order-time"><i class="fas fa-clock"></i> ${time}</span>
      </div>
      <div class="order-name"><i class="fas fa-user" style="color:var(--primary); margin-right:6px;"></i>${escapeHtml(order.name)}</div>
      <div class="order-phone"><i class="fas fa-phone"></i> ${escapeHtml(order.phone)}</div>
      <div class="order-message">${escapeHtml(order.message)}</div>
      <div class="order-actions">
        ${actionButtons}
        ${isAdmin ? `<button class="btn btn-sm btn-danger" onclick="confirmDelete('${order.id}')" title="Supprimer"><i class="fas fa-trash"></i></button>` : ''}
      </div>
    </div>
  `;
}

function buildActionButtons(order) {
  const { id, status } = order;
  const buttons = [];

  if (status === 'en_charge') {
    buttons.push(`<button class="btn btn-sm btn-warning" onclick="updateStatus('${id}', 'en_cours')"><i class="fas fa-fire"></i> En cours</button>`);
    buttons.push(`<button class="btn btn-sm btn-success" onclick="updateStatus('${id}', 'traitee')"><i class="fas fa-check"></i> Traitée</button>`);
  } else if (status === 'en_cours') {
    buttons.push(`<button class="btn btn-sm btn-info" onclick="updateStatus('${id}', 'en_charge')"><i class="fas fa-undo"></i> Retour</button>`);
    buttons.push(`<button class="btn btn-sm btn-success" onclick="updateStatus('${id}', 'traitee')"><i class="fas fa-check"></i> Traitée</button>`);
  } else if (status === 'traitee') {
    buttons.push(`<button class="btn btn-sm btn-info" onclick="updateStatus('${id}', 'en_charge')"><i class="fas fa-redo"></i> Réouvrir</button>`);
  }

  return buttons.join('');
}

async function updateStatus(id, newStatus) {
  try {
    const res = await fetch(`/api/orders/${id}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ status: newStatus })
    });

    if (res.status === 401) { logout(); return; }

    if (res.ok) {
      const labels = { en_charge: 'En charge', en_cours: 'En cours', traitee: 'Traitée' };
      showToast('success', `Commande déplacée → ${labels[newStatus]}`);
      loadOrders();
    } else {
      showToast('error', 'Erreur lors de la mise à jour.');
    }
  } catch (_) {
    showToast('error', 'Erreur de connexion.');
  }
}

function updateStats(orders) {
  const total = orders.length;
  const pending = orders.filter(o => o.status === 'en_charge').length;
  const inProgress = orders.filter(o => o.status === 'en_cours').length;
  const done = orders.filter(o => o.status === 'traitee').length;

  document.getElementById('statTotal').textContent = total;
  document.getElementById('statPending').textContent = pending;
  document.getElementById('statInProgress').textContent = inProgress;
  document.getElementById('statDone').textContent = done;
}

// ─── DELETE ───────────────────────────────────────────────────────────────

function confirmDelete(id) {
  pendingDeleteId = id;
  document.getElementById('deleteModal').classList.add('open');
  document.getElementById('confirmDeleteBtn').onclick = () => doDelete(id);
}

function closeDeleteModal() {
  document.getElementById('deleteModal').classList.remove('open');
  pendingDeleteId = null;
}

async function doDelete(id) {
  closeDeleteModal();
  try {
    const res = await fetch(`/api/orders/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
    if (res.ok) {
      showToast('success', 'Commande supprimée.');
      loadOrders();
    }
  } catch (_) {
    showToast('error', 'Erreur lors de la suppression.');
  }
}

// ─── ADMIN — COOKS ────────────────────────────────────────────────────────

async function loadCooks() {
  try {
    const res = await fetch('/api/users', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const cooks = await res.json();
    renderCooks(cooks);
  } catch (_) {}
}

function renderCooks(cooks) {
  const container = document.getElementById('cookList');
  if (!cooks.length) {
    container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px; font-size:0.875rem;">Aucun cuisinier ajouté</div>';
    return;
  }
  container.innerHTML = `<div class="cook-list">${cooks.map(cook => `
    <div class="cook-item" id="cook-${cook.id}">
      <div class="cook-info">
        <div class="cook-avatar">${cook.username.charAt(0).toUpperCase()}</div>
        <div>
          <div class="cook-name">${escapeHtml(cook.username)}</div>
          <div class="cook-date">Ajouté le ${formatDate(cook.created_at)}</div>
        </div>
      </div>
      <button class="btn btn-sm btn-danger" onclick="deleteCook(${cook.id}, '${escapeHtml(cook.username)}')">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('')}</div>`;
}

document.getElementById('addCookForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('cookUsername').value.trim();
  const password = document.getElementById('cookPassword').value;
  const alert = document.getElementById('addCookAlert');

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token
      },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      alert.className = 'alert alert-error show';
      alert.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${data.error}`;
    } else {
      alert.className = 'alert alert-success show';
      alert.innerHTML = `<i class="fas fa-check-circle"></i> Cuisinier "${username}" ajouté !`;
      document.getElementById('addCookForm').reset();
      showToast('success', `Cuisinier "${username}" créé avec succès.`);
      loadCooks();
      setTimeout(() => { alert.className = 'alert'; }, 3000);
    }
  } catch (_) {
    alert.className = 'alert alert-error show';
    alert.innerHTML = '<i class="fas fa-exclamation-circle"></i> Erreur de connexion.';
  }
});

async function deleteCook(id, name) {
  if (!confirm(`Supprimer le compte de "${name}" ?`)) return;
  try {
    await fetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + token }
    });
    showToast('success', `Compte "${name}" supprimé.`);
    loadCooks();
  } catch (_) {
    showToast('error', 'Erreur lors de la suppression.');
  }
}

// ─── ADMIN — STATS ────────────────────────────────────────────────────────

async function loadAdminStats() {
  try {
    const res = await fetch('/api/stats', {
      headers: { Authorization: 'Bearer ' + token }
    });
    const stats = await res.json();
    renderAdminStats(stats);
  } catch (_) {}
}

function renderAdminStats(stats) {
  const container = document.getElementById('adminStatsBody');
  const pct = (n) => stats.total > 0 ? Math.round((n / stats.total) * 100) : 0;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:16px;">
      <div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="font-size:0.85rem; font-weight:600; color:#1e40af;"><i class="fas fa-inbox"></i> En charge</span>
          <span style="font-size:0.85rem; font-weight:700;">${stats.en_charge}</span>
        </div>
        <div style="background:#e8f0f8; border-radius:10px; height:8px; overflow:hidden;">
          <div style="background:var(--status-en-charge); height:100%; width:${pct(stats.en_charge)}%; border-radius:10px; transition:width 0.8s;"></div>
        </div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="font-size:0.85rem; font-weight:600; color:#92400e;"><i class="fas fa-fire"></i> En cours</span>
          <span style="font-size:0.85rem; font-weight:700;">${stats.en_cours}</span>
        </div>
        <div style="background:#e8f0f8; border-radius:10px; height:8px; overflow:hidden;">
          <div style="background:var(--status-en-cours); height:100%; width:${pct(stats.en_cours)}%; border-radius:10px; transition:width 0.8s;"></div>
        </div>
      </div>
      <div>
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <span style="font-size:0.85rem; font-weight:600; color:#065f46;"><i class="fas fa-check-circle"></i> Traitées</span>
          <span style="font-size:0.85rem; font-weight:700;">${stats.traitee}</span>
        </div>
        <div style="background:#e8f0f8; border-radius:10px; height:8px; overflow:hidden;">
          <div style="background:var(--status-traitee); height:100%; width:${pct(stats.traitee)}%; border-radius:10px; transition:width 0.8s;"></div>
        </div>
      </div>
      <div class="divider"></div>
      <div style="text-align:center;">
        <div style="font-size:2.5rem; font-weight:800; color:var(--primary);">${stats.total}</div>
        <div style="font-size:0.8rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px;">commandes totales</div>
      </div>
    </div>
  `;
}

// ─── LOGO UPLOAD ──────────────────────────────────────────────────────────

function setupLogoUpload() {
  const dropArea = document.getElementById('logoDropArea');
  const fileInput = document.getElementById('logoFileInput');

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) handleLogoFile(e.target.files[0]);
  });

  dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropArea.classList.add('drag-over');
  });

  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropArea.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleLogoFile(e.dataTransfer.files[0]);
  });
}

function handleLogoFile(file) {
  selectedLogoFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('logoPreviewImg');
    preview.src = e.target.result;
    preview.style.display = 'block';
  };
  reader.readAsDataURL(file);
  document.getElementById('uploadLogoBtn').style.display = 'flex';
}

async function uploadLogo() {
  if (!selectedLogoFile) return;

  const alertEl = document.getElementById('logoUploadAlert');
  const btn = document.getElementById('uploadLogoBtn');
  btn.innerHTML = '<span class="spinner"></span> Envoi...';
  btn.disabled = true;

  const formData = new FormData();
  formData.append('logo', selectedLogoFile);

  try {
    const res = await fetch('/api/upload/logo', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: formData
    });
    const data = await res.json();

    if (res.ok) {
      alertEl.className = 'alert alert-success show';
      alertEl.innerHTML = '<i class="fas fa-check-circle"></i> Logo mis à jour avec succès !';
      showToast('success', 'Logo de l\'événement mis à jour.');
      loadLogo();
      setTimeout(() => { alertEl.className = 'alert'; }, 3000);
    } else {
      alertEl.className = 'alert alert-error show';
      alertEl.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${data.error}`;
    }
  } catch (_) {
    alertEl.className = 'alert alert-error show';
    alertEl.innerHTML = '<i class="fas fa-exclamation-circle"></i> Erreur de connexion.';
  } finally {
    btn.innerHTML = '<i class="fas fa-upload"></i> Mettre à jour le logo';
    btn.disabled = false;
  }
}

// ─── LOGOUT ───────────────────────────────────────────────────────────────

function logout() {
  clearInterval(refreshInterval);
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  window.location.href = '/login.html';
}

// ─── TOAST ────────────────────────────────────────────────────────────────

function showToast(type, message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle' };
  toast.innerHTML = `<i class="fas fa-${icons[type] || 'info-circle'}"></i> ${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(40px)';
    toast.style.transition = 'all 0.4s ease';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ─── UTILS ────────────────────────────────────────────────────────────────

function formatTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
