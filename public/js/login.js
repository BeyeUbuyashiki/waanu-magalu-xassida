// Login page logic

document.addEventListener('DOMContentLoaded', () => {
  // Redirect if already logged in
  const token = localStorage.getItem('token');
  if (token) window.location.href = '/dashboard.html';

  loadLogo();

  // Toggle password visibility
  document.getElementById('togglePwd').addEventListener('click', () => {
    const input = document.getElementById('password');
    const icon = document.getElementById('eyeIcon');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'fas fa-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'fas fa-eye';
    }
  });
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

const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginAlert = document.getElementById('loginAlert');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading(true);
  hideAlert();

  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) {
      showAlert('error', data.error || 'Identifiants incorrects.');
    } else {
      localStorage.setItem('token', data.token);
      localStorage.setItem('role', data.role);
      localStorage.setItem('username', data.username);
      window.location.href = '/dashboard.html';
    }
  } catch (_) {
    showAlert('error', 'Impossible de contacter le serveur. Vérifiez votre connexion.');
  } finally {
    setLoading(false);
  }
});

function setLoading(loading) {
  loginBtn.disabled = loading;
  loginBtn.innerHTML = loading
    ? '<span class="spinner"></span> Connexion...'
    : '<i class="fas fa-sign-in-alt"></i> Se connecter';
}

function showAlert(type, msg) {
  loginAlert.className = `alert alert-${type} show`;
  loginAlert.innerHTML = `<i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
}

function hideAlert() {
  loginAlert.className = 'alert';
  loginAlert.textContent = '';
}
