const express = require('express');
const Datastore = require('@seald-io/nedb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'magalu_xassida_yi_paris_2026_secret';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// En production (Railway), les données sont dans /data monté en volume persistant
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve uploaded files (logo) from the persistent data dir
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── DATABASE ─────────────────────────────────────────────────────────────

const usersDb = new Datastore({ filename: path.join(DATA_DIR, 'users.db'), autoload: true });
const ordersDb = new Datastore({ filename: path.join(DATA_DIR, 'orders.db'), autoload: true });
const counterDb = new Datastore({ filename: path.join(DATA_DIR, 'counter.db'), autoload: true });

usersDb.ensureIndex({ fieldName: 'username', unique: true });

// Get next order number
async function nextOrderNum() {
  let doc = await counterDb.findOneAsync({ _id: 'orders' });
  if (!doc) {
    await counterDb.insertAsync({ _id: 'orders', seq: 1 });
    return 1;
  }
  const updated = await counterDb.updateAsync({ _id: 'orders' }, { $inc: { seq: 1 } }, { returnUpdatedDocs: true });
  return updated.seq;
}

// Format nedb doc to API shape (rename _id → id)
function formatUser(doc) {
  if (!doc) return null;
  const { _id, password, ...rest } = doc;
  return { id: _id, ...rest };
}

function formatOrder(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

// Seed admin account on first run
(async () => {
  const admin = await usersDb.findOneAsync({ role: 'admin' });
  if (!admin) {
    const hash = await bcrypt.hash('admin2026', 10);
    await usersDb.insertAsync({ username: 'admin', password: hash, role: 'admin', created_at: new Date().toISOString() });
    console.log('✅ Compte admin créé → identifiant: admin | mot de passe: admin2026');
    console.log('⚠️  Changez le mot de passe après la première connexion!');
  }
})();

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────

const authenticate = (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Non autorisé' });
  }
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée, veuillez vous reconnecter' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  next();
};

// ─── MULTER LOGO UPLOAD ───────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'logo' + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Format non supporté. Utilisez JPG, PNG, GIF, SVG ou WebP.'));
    }
  }
});

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }
  try {
    const user = await usersDb.findOneAsync({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
    }
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, role: user.role, username: user.username });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── ORDER ROUTES ─────────────────────────────────────────────────────────

// Public: submit an order
app.post('/api/orders', async (req, res) => {
  const { name, phone, message } = req.body;
  if (!name?.trim() || !phone?.trim() || !message?.trim()) {
    return res.status(400).json({ error: 'Tous les champs sont obligatoires' });
  }
  if (phone.trim().length < 8) {
    return res.status(400).json({ error: 'Numéro de téléphone invalide' });
  }
  try {
    const num = await nextOrderNum();
    const doc = await ordersDb.insertAsync({
      num,
      name: name.trim(),
      phone: phone.trim(),
      message: message.trim(),
      status: 'en_charge',
      created_at: new Date().toISOString()
    });
    res.json({ id: doc._id, num, success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur lors de l\'enregistrement' });
  }
});

// Authenticated: get all orders
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const orders = await ordersDb.findAsync({}).sort({ created_at: -1 });
    res.json(orders.map(formatOrder));
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Authenticated: update order status
app.patch('/api/orders/:id/status', authenticate, async (req, res) => {
  const { status } = req.body;
  const valid = ['en_charge', 'en_cours', 'traitee'];
  if (!valid.includes(status)) {
    return res.status(400).json({ error: 'Statut invalide' });
  }
  try {
    const count = await ordersDb.updateAsync({ _id: req.params.id }, { $set: { status } });
    if (count === 0) return res.status(404).json({ error: 'Commande introuvable' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Admin: delete an order
app.delete('/api/orders/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await ordersDb.removeAsync({ _id: req.params.id }, {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── USER ROUTES (admin only) ─────────────────────────────────────────────

app.get('/api/users', authenticate, adminOnly, async (req, res) => {
  try {
    const users = await usersDb.findAsync({ role: 'cook' }).sort({ created_at: -1 });
    res.json(users.map(formatUser));
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.post('/api/users', authenticate, adminOnly, async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
  }
  try {
    const hash = await bcrypt.hash(password, 10);
    const doc = await usersDb.insertAsync({
      username: username.trim(),
      password: hash,
      role: 'cook',
      created_at: new Date().toISOString()
    });
    res.json({ id: doc._id, username: doc.username, role: 'cook' });
  } catch (e) {
    if (e.errorType === 'uniqueViolated') {
      return res.status(400).json({ error: 'Cet identifiant est déjà utilisé' });
    }
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

app.delete('/api/users/:id', authenticate, adminOnly, async (req, res) => {
  try {
    await usersDb.removeAsync({ _id: req.params.id, role: 'cook' }, {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── LOGO ROUTES ──────────────────────────────────────────────────────────

app.post('/api/upload/logo', authenticate, adminOnly, upload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });
  const exts = ['.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp'];
  exts.forEach(ext => {
    const old = path.join(UPLOADS_DIR, 'logo' + ext);
    if (old !== req.file.path && fs.existsSync(old)) fs.unlinkSync(old);
  });
  res.json({ path: '/uploads/' + req.file.filename + '?t=' + Date.now() });
});

app.get('/api/logo', (req, res) => {
  const exts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp'];
  for (const ext of exts) {
    if (fs.existsSync(path.join(UPLOADS_DIR, 'logo' + ext))) {
      return res.json({ path: '/uploads/logo' + ext });
    }
  }
  res.json({ path: null });
});

// ─── STATS ────────────────────────────────────────────────────────────────

app.get('/api/stats', authenticate, adminOnly, async (req, res) => {
  try {
    const total = await ordersDb.countAsync({});
    const en_charge = await ordersDb.countAsync({ status: 'en_charge' });
    const en_cours = await ordersDb.countAsync({ status: 'en_cours' });
    const traitee = await ordersDb.countAsync({ status: 'traitee' });
    res.json({ total, en_charge, en_cours, traitee });
  } catch (e) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── START ────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🌙 Magalu Xassida Yi Paris 2026`);
  console.log(`🚀 Serveur démarré → http://localhost:${PORT}\n`);
});
