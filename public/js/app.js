// Guest order form logic

document.addEventListener('DOMContentLoaded', () => {
  loadLogo();
  // Redirect if already logged in
  const token = localStorage.getItem('token');
  if (token) window.location.href = '/dashboard.html';
});

async function loadLogo() {
  try {
    const res = await fetch('/api/logo');
    const data = await res.json();
    if (data.path) {
      const img = document.getElementById('logoImg');
      const def = document.getElementById('logoDefault');
      img.src = data.path;
      img.style.display = 'block';
      if (def) def.style.display = 'none';
    }
  } catch (_) {}
}

const form = document.getElementById('orderForm');
const submitBtn = document.getElementById('submitBtn');
const formAlert = document.getElementById('formAlert');
const formContainer = document.getElementById('formContainer');
const successContainer = document.getElementById('successContainer');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading(true);
  hideAlert();

  const name = document.getElementById('name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const message = document.getElementById('message').value.trim();

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, message })
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert('error', data.error || 'Une erreur est survenue.');
    } else {
      formContainer.style.display = 'none';
      successContainer.classList.add('show');
    }
  } catch (_) {
    showAlert('error', 'Impossible de contacter le serveur. Vérifiez votre connexion.');
  } finally {
    setLoading(false);
  }
});

function resetForm() {
  form.reset();
  hideAlert();
  successContainer.classList.remove('show');
  formContainer.style.display = 'block';
}

function setLoading(loading) {
  submitBtn.disabled = loading;
  submitBtn.classList.toggle('loading', loading);
  submitBtn.innerHTML = loading
    ? '<span class="spinner"></span> Envoi en cours...'
    : '<i class="fas fa-paper-plane"></i> Envoyer ma commande';
}

function showAlert(type, message) {
  formAlert.className = `alert alert-${type} show`;
  formAlert.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i> ${message}`;
}

function hideAlert() {
  formAlert.className = 'alert';
  formAlert.textContent = '';
}
