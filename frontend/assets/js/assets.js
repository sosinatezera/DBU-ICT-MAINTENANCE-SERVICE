/* ============================================================
   assets.js  —  ICT Asset Management (Admin/Manager)
    Smart Computer Maintenance Service Request and Tracking System
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {
  if (!requireRole('ICT Admin')) return;
  await initAssets();
});

let allAssets = [];

async function initAssets() {
  try {
    const { data } = await apiRequest('/assets');
    allAssets = data;
    renderAssetsTable(data);
  } catch (err) {
    console.error('Load assets failed:', err);
    showToast(err.message, 'danger');
    /* Never leave the loader hanging — show the real error + a Retry action. */
    const tbody = document.getElementById('assetsTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="9" class="text-center py-4">
        <i class="bi bi-exclamation-triangle text-danger d-block mb-2 fs-3"></i>
        <p class="text-danger mb-2">Failed to load assets: ${escHtml(err.message)}</p>
        <button class="btn btn-sm btn-outline-primary" onclick="initAssets()">
          <i class="bi bi-arrow-clockwise me-1"></i>Retry
        </button>
      </td></tr>`;
    }
  }

  // Search/filter
  const doFilter = () => {
    const q  = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const ct = document.getElementById('categoryFilter')?.value || '';
    const st = document.getElementById('statusFilter')?.value || '';
    renderAssetsTable(allAssets.filter(a =>
      (!q  || a.asset_name.toLowerCase().includes(q) || a.asset_tag.toLowerCase().includes(q)) &&
      (!ct || a.category === ct) &&
      (!st || a.status === st)
    ));
  };

  document.getElementById('searchBtn')?.addEventListener('click', doFilter);
  document.getElementById('searchInput')?.addEventListener('keydown', e => { if (e.key==='Enter') doFilter(); });

  // Add button — reset form
  document.getElementById('addAssetBtn')?.addEventListener('click', () => {
    document.getElementById('assetForm').reset();
    document.getElementById('assetId').value = '';
    document.getElementById('assetModalLabel').textContent = 'Add New Asset';
  });

  document.getElementById('saveAssetBtn')?.addEventListener('click', saveAsset);
}

function renderAssetsTable(assets) {
  const tbody = document.getElementById('assetsTableBody');
  if (!tbody) return;

  if (!assets.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="text-center py-5">
      <i class="bi bi-pc-display fs-1 text-muted d-block mb-2"></i><p class="text-muted">No assets found.</p>
    </div></td></tr>`;
    return;
  }

  tbody.innerHTML = assets.map((a, i) => `
    <tr>
      <td>${i + 1}</td>
      <td><strong>${escHtml(a.asset_name)}</strong></td>
      <td><code class="text-primary">${escHtml(a.asset_tag)}</code></td>
      <td>${escHtml(a.category || '—')}</td>
      <td>${escHtml(a.department || '—')}</td>
      <td>${escHtml(a.location || '—')}</td>
      <td>${assetStatusBadge(a.status)}</td>
      <td>${warrantyBadge(a.warranty_expiry)}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary me-1 py-0 px-2"
                onclick="editAsset('${a._id}')"
                data-bs-toggle="modal" data-bs-target="#assetModal">
          <i class="bi bi-pencil"></i>
        </button>
        <button class="btn btn-sm btn-outline-danger py-0 px-2"
                onclick="deleteAsset('${a._id}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>`).join('');
}

function editAsset(id) {
  const a = allAssets.find(x => x._id === id);
  if (!a) return;
  document.getElementById('assetId').value         = id;
  document.getElementById('assetName').value        = a.asset_name;
  document.getElementById('assetTag').value         = a.asset_tag;
  document.getElementById('assetCategory').value    = a.category || '';
  document.getElementById('assetStatus').value      = a.status || 'active';
  document.getElementById('assetDepartment').value  = a.department || '';
  document.getElementById('assetLocation').value    = a.location || '';
  document.getElementById('purchaseDate').value     = a.purchase_date ? a.purchase_date.split('T')[0] : '';
  document.getElementById('warrantyExpiry').value   = a.warranty_expiry ? a.warranty_expiry.split('T')[0] : '';
  document.getElementById('assetModalLabel').textContent = 'Edit Asset';
}

async function saveAsset() {
  const id   = document.getElementById('assetId').value;
  const name = document.getElementById('assetName').value.trim();
  const tag  = document.getElementById('assetTag').value.trim();

  if (!name || !tag) {
    showAlert('assetModalAlert', 'Asset name and tag are required.', 'warning');
    return;
  }

  const body = {
    asset_name:      name,
    asset_tag:       tag,
    category:        document.getElementById('assetCategory').value,
    status:          document.getElementById('assetStatus').value,
    department:      document.getElementById('assetDepartment').value.trim(),
    location:        document.getElementById('assetLocation').value.trim(),
    purchase_date:   document.getElementById('purchaseDate').value || null,
    warranty_expiry: document.getElementById('warrantyExpiry').value || null,
  };

  setLoading('saveAssetBtn', 'saveAssetSpinner', true);
  try {
    if (id) await apiRequest(`/assets/${id}`, { method: 'PUT', body });
    else     await apiRequest('/assets', { method: 'POST', body });
    showToast(id ? 'Asset updated.' : 'Asset added.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('assetModal'))?.hide();
    setTimeout(() => window.location.reload(), 1000);
  } catch (err) {
    let msg = err?.message || 'Failed to save asset.';
    if (err?.data?.errors) {
      msg = Object.values(err.data.errors).join(' · ');
    }
    showAlert('assetModalAlert', msg, 'danger');
  } finally {
    setLoading('saveAssetBtn', 'saveAssetSpinner', false);
  }
}

async function deleteAsset(id) {
  const found = allAssets.find(x => x._id === id);
  const name  = found ? found.asset_name : id;
  if (!confirm(`Delete asset "${name}"? This cannot be undone.`)) return;
  try {
    await apiRequest(`/assets/${id}`, { method: 'DELETE' });
    showToast('Asset deleted.', 'success');
    allAssets = allAssets.filter(a => a._id !== id);
    renderAssetsTable(allAssets);
  } catch (err) { showToast(err.message, 'danger'); }
}

/* ── Helpers ──────────────────────────────────────────────── */
function assetStatusBadge(status) {
  const map = {
    active:            { cls: 'bg-success',                label: 'Active' },
    under_maintenance: { cls: 'bg-warning text-dark',      label: 'Under Maintenance' },
    decommissioned:    { cls: 'bg-secondary',              label: 'Decommissioned' },
  };
  const { cls, label } = map[status] || { cls: 'bg-light text-dark border', label: status };
  return `<span class="badge ${cls}">${label}</span>`;
}

function warrantyBadge(expiry) {
  if (!expiry) return '<span class="text-muted small">—</span>';
  const days = Math.ceil((new Date(expiry) - new Date()) / 86400000);
  if (days < 0)   return `<span class="badge bg-danger">Expired</span>`;
  if (days < 30)  return `<span class="badge bg-warning text-dark">${days}d left</span>`;
  if (days < 90)  return `<span class="badge bg-info text-dark">${days}d left</span>`;
  return `<span class="badge bg-success">${formatDate(expiry)}</span>`;
}
