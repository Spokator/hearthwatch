// Client RCON (protocole Source) pour ValheimRcon.
// Une seule connexion persistante, commandes envoyées une par une.
import net from 'node:net';

const TYPE_AUTH = 3;
const TYPE_EXEC = 2;
const TYPE_AUTH_RESPONSE = 2;
const TYPE_RESPONSE = 0;

export class RconError extends Error {}

export class RconClient {
  constructor({ host = '127.0.0.1', port, password, timeout = 10000 }) {
    Object.assign(this, { host, port, password, timeout });
    this.socket = null;
    this.ready = null;
    this.buffer = Buffer.alloc(0);
    this.nextId = 1;
    this.waiter = null;
    this.chain = Promise.resolve();
  }

  // Exécute une commande et renvoie la réponse texte.
  exec(command) {
    const run = () => this.#exec(command);
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => {});
    return result;
  }

  close() {
    this.socket?.destroy();
    this.#reset();
  }

  async #exec(command) {
    await this.#connect();
    const id = this.#id();
    const done = this.#wait(id, TYPE_RESPONSE);
    this.#send(id, TYPE_EXEC, command);
    return done;
  }

  #id() {
    this.nextId = this.nextId >= 0x7fffffff ? 1 : this.nextId + 1;
    return this.nextId;
  }

  #connect() {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      const timer = setTimeout(() => socket.destroy(new RconError('Serveur RCON injoignable (délai dépassé)')), this.timeout);
      socket.once('error', (err) => {
        clearTimeout(timer);
        this.#reset();
        reject(err instanceof RconError ? err : new RconError(`Serveur RCON injoignable : ${err.code || err.message}`));
      });
      socket.once('connect', async () => {
        clearTimeout(timer);
        socket.setKeepAlive(true, 30000);
        this.socket = socket;
        socket.on('data', (chunk) => this.#onData(chunk));
        socket.on('close', () => this.#reset(new RconError('Connexion RCON fermée')));
        try {
          const id = this.#id();
          const auth = this.#wait(id, TYPE_AUTH_RESPONSE);
          this.#send(id, TYPE_AUTH, this.password);
          await auth;
          resolve();
        } catch (err) {
          socket.destroy();
          reject(err);
        }
      });
    });
    return this.ready;
  }

  #reset(err) {
    this.socket = null;
    this.ready = null;
    this.buffer = Buffer.alloc(0);
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w.finish(err || new RconError('Connexion RCON fermée'));
    }
  }

  #send(id, type, body) {
    const payload = Buffer.from(body, 'utf8');
    const packet = Buffer.alloc(14 + payload.length);
    packet.writeInt32LE(10 + payload.length, 0);
    packet.writeInt32LE(id, 4);
    packet.writeInt32LE(type, 8);
    payload.copy(packet, 12);
    this.socket.write(packet);
  }

  // Attend la réponse à `id`. Les réponses longues peuvent arriver en plusieurs
  // paquets : on les regroupe jusqu'à un court silence.
  #wait(id, type) {
    return new Promise((resolve, reject) => {
      const parts = [];
      let quiet = null;
      const timer = setTimeout(() => finish(new RconError('Pas de réponse du serveur RCON')), this.timeout);
      const finish = (err) => {
        clearTimeout(timer);
        clearTimeout(quiet);
        if (this.waiter === waiter) this.waiter = null;
        err ? reject(err) : resolve(parts.join(''));
      };
      const waiter = {
        finish,
        onPacket: (pid, ptype, body) => {
          if (type === TYPE_AUTH_RESPONSE) {
            if (pid === -1) return finish(new RconError('Mot de passe RCON refusé'));
            if (ptype === TYPE_AUTH_RESPONSE && pid === id) return finish();
            return;
          }
          if (pid !== id) return;
          parts.push(body);
          clearTimeout(quiet);
          quiet = setTimeout(() => finish(), 120);
        },
      };
      this.waiter = waiter;
    });
  }

  #onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (size < 10 || size > 1024 * 1024) {
        this.socket?.destroy();
        return this.#reset(new RconError('Paquet RCON invalide'));
      }
      if (this.buffer.length < 4 + size) return;
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.toString('utf8', 12, 4 + size - 2);
      this.buffer = this.buffer.subarray(4 + size);
      this.waiter?.onPacket(id, type, body);
    }
  }
}
