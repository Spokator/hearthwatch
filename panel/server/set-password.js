// Récupération d'accès : (re)définit un compte propriétaire actif du panel.
// Docker : docker exec -it hearthwatch node /opt/hearthwatch/panel/server/set-password.js <utilisateur>
// VPS    : sudo -u valheim node /opt/valheim-panel/server/set-password.js <utilisateur>
// Le mot de passe est généré et affiché, sauf si NEW_PASSWORD est fourni. Le panel relit le fichier tout seul.
import path from 'node:path';
import { DATA_DIR } from './runtime.js';
import { UserStore, randomPassword } from './users.js';

const store = new UserStore(path.join(DATA_DIR, 'panel-users.json'), path.join(DATA_DIR, 'panel.env'));
await store.load();

const username = process.argv[2] || 'admin';
const password = process.env.NEW_PASSWORD || randomPassword();
try {
  const user = await store.recover(username, password);
  console.log(`Compte : ${user.username} (propriétaire, actif)`);
  if (!process.env.NEW_PASSWORD) console.log(`Mot de passe : ${password}`);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
