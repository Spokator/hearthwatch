import { useState } from 'react';
import { Ban, Crown, Gift, HeartPulse, History, MapPin, Plus, ShieldCheck, Swords, Trash2, UserCheck, UserX, Users } from 'lucide-react';
import { api, useApi } from '../api.js';
import { useCan } from '../auth.jsx';
import { GiveItemModal, HistoryList, PlatformBadge, PositionPicker, formatPos, positionBody } from '../components.jsx';
import { useT } from '../i18n.jsx';
import { OfflineNotice, PageHeader } from '../status.jsx';
import { Badge, Button, Card, Empty, Field, Input, Meter, Modal, Spinner, useAction, useFeedback } from '../ui.jsx';

export default function Players() {
  const t = useT();
  const players = useApi('/players', { interval: 5000 });
  const lists = useApi('/lists');
  const [run, busy] = useAction();
  const { confirm } = useFeedback();
  const [modal, setModal] = useState(null);
  const can = useCan();
  const moderate = can('players.moderate');
  const cheat = can('players.cheat');

  const online = players.data?.players || [];
  const admins = lists.data?.admin || [];
  const close = () => setModal(null);

  const act = async (action, player, extra, success) => {
    const r = await run(`${action}:${player.id}`, () => api('/players/action', { method: 'POST', body: { action, target: player.id, ...extra } }), success);
    if (r) {
      players.reload();
      lists.reload();
    }
    return r;
  };

  const kick = async (p) => {
    const ok = await confirm({
      title: t('Expulser {name} ?', { name: p.name }),
      message: t('Le joueur est déconnecté mais pourra revenir.'),
      confirmLabel: t('Expulser'),
      danger: true,
    });
    if (ok) act('kick', p, {}, t('{name} a été expulsé', { name: p.name }));
  };

  const ban = async (p) => {
    const ok = await confirm({
      title: t('Bannir {name} ?', { name: p.name }),
      message: t('Le joueur est déconnecté et ne pourra plus revenir (identifiant {id}). Tu pourras le débannir dans la liste « Bannis ».', { id: p.id }),
      confirmLabel: t('Bannir'),
      danger: true,
    });
    if (ok) act('ban', p, {}, t('{name} a été banni', { name: p.name }));
  };

  const toggleAdmin = async (p) => {
    const isAdmin = admins.includes(p.id);
    const r = await run(
      `admin:${p.id}`,
      () => (isAdmin ? api(`/lists/admin/${encodeURIComponent(p.id)}`, { method: 'DELETE' }) : api('/lists/admin', { method: 'POST', body: { id: p.id } })),
      t(isAdmin ? "{name} n'est plus admin" : '{name} est maintenant admin', { name: p.name }),
    );
    if (r) lists.reload();
  };

  return (
    <>
      <PageHeader title={t('Joueurs')} description={t("Joueurs connectés, actions en direct, listes d'accès et historique des connexions.")} />
      <OfflineNotice />

      <Card title={t('En ligne ({n})', { n: online.length })} icon={Users} padded={false}>
        {players.loading && !players.data ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : online.length ? (
          <ul className="divide-y divide-ink-800">
            {online.map((p) => (
              <li key={p.id} className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-ink-100">{p.name}</span>
                    <PlatformBadge platform={p.platform} />
                    {admins.includes(p.id) && (
                      <Badge tone="ember">
                        <Crown className="size-3" />
                        Admin
                      </Badge>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                    <span className="font-mono">{p.id}</span>
                    <span>{t('Position {pos}', { pos: formatPos(p.position) })}</span>
                  </div>
                  {p.maxHp ? (
                    <div className="mt-2 flex max-w-xs items-center gap-2">
                      <Meter value={p.hp} max={p.maxHp} tone={p.hp / p.maxHp < 0.3 ? 'bg-blood-500' : 'bg-moss-500'} className="flex-1" />
                      <span className="shrink-0 text-xs tabular-nums text-ink-400">
                        {Math.round(p.hp)} / {Math.round(p.maxHp)} {t('PV')}
                      </span>
                    </div>
                  ) : null}
                </div>
                {(cheat || moderate) && (
                  <div className="flex flex-wrap gap-2">
                    {cheat && (
                      <>
                        <Button size="sm" icon={Gift} onClick={() => setModal({ type: 'give', player: p })}>{t('Donner')}</Button>
                        <Button size="sm" icon={HeartPulse} onClick={() => setModal({ type: 'heal', player: p })}>{t('Soigner')}</Button>
                        <Button size="sm" icon={Swords} onClick={() => setModal({ type: 'damage', player: p })}>{t('Blesser')}</Button>
                        <Button size="sm" icon={MapPin} onClick={() => setModal({ type: 'teleport', player: p })}>{t('Téléporter')}</Button>
                      </>
                    )}
                    {moderate && (
                      <>
                        <Button size="sm" icon={ShieldCheck} loading={busy === `admin:${p.id}`} onClick={() => toggleAdmin(p)}>
                          {t(admins.includes(p.id) ? 'Retirer admin' : 'Rendre admin')}
                        </Button>
                        <Button size="sm" variant="danger" icon={UserX} loading={busy === `kick:${p.id}`} onClick={() => kick(p)}>{t('Expulser')}</Button>
                        <Button size="sm" variant="danger" icon={Ban} loading={busy === `ban:${p.id}`} onClick={() => ban(p)}>{t('Bannir')}</Button>
                      </>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty icon={Users} title={t('Aucun joueur connecté')}>
            {t(players.data?.error ? 'Le serveur de jeu ne répond pas encore.' : 'Les joueurs apparaîtront ici dès leur connexion.')}
          </Empty>
        )}
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <AccessList
          title={t('Administrateurs')}
          icon={Crown}
          list="admin"
          items={lists.data?.admin}
          onChange={lists.reload}
          editable={moderate}
          description={t('Peuvent utiliser les commandes admin dans la console du jeu (F5).')}
        />
        <AccessList title={t('Bannis')} icon={Ban} list="banned" items={lists.data?.banned} onChange={lists.reload} editable={moderate} description={t('Ne peuvent plus rejoindre le serveur.')} />
        <AccessList
          title={t('Liste blanche')}
          icon={UserCheck}
          list="permitted"
          items={lists.data?.permitted}
          onChange={lists.reload}
          editable={moderate}
          description={t('Si elle contient au moins un identifiant, seuls ces joueurs peuvent se connecter.')}
          warning
        />
      </div>

      <Card title={t('Historique des connexions')} icon={History} className="mt-6">
        <HistoryList events={players.data?.history} limit={80} />
      </Card>

      {cheat && (
        <>
          <GiveItemModal open={modal?.type === 'give'} player={modal?.player} players={online} onClose={close} />
          <HealthModal state={modal?.type === 'heal' || modal?.type === 'damage' ? modal : null} onClose={close} act={act} busy={busy} />
          <TeleportModal player={modal?.type === 'teleport' ? modal.player : null} players={online} onClose={close} act={act} busy={busy} />
        </>
      )}
    </>
  );
}

function AccessList({ title, icon, list, items, onChange, editable, description, warning }) {
  const t = useT();
  const [id, setId] = useState('');
  const [run, busy] = useAction();

  const add = async (e) => {
    e.preventDefault();
    const r = await run('add', () => api(`/lists/${list}`, { method: 'POST', body: { id: id.trim() } }), t('Identifiant ajouté'));
    if (r) {
      setId('');
      onChange();
    }
  };
  const remove = async (value) => {
    const r = await run(value, () => api(`/lists/${list}/${encodeURIComponent(value)}`, { method: 'DELETE' }), t('Identifiant retiré'));
    if (r) onChange();
  };

  return (
    <Card title={title} icon={icon}>
      <p className="mb-3 text-xs text-ink-500">{description}</p>
      {warning && items?.length > 0 && (
        <p className="mb-3 rounded-lg border border-ember-500/30 bg-ember-500/10 px-3 py-2 text-xs text-ember-300">
          {t('Liste blanche active : les joueurs absents de cette liste sont refusés.')}
        </p>
      )}
      <ul className="mb-4 space-y-1.5">
        {items?.length ? (
          items.map((v) => (
            <li key={v} className="flex min-h-9 items-center justify-between gap-2 rounded-lg bg-ink-850 py-1 pl-3 pr-1">
              <span className="truncate font-mono text-xs text-ink-200">{v}</span>
              {editable && <Button size="sm" variant="ghost" icon={Trash2} loading={busy === v} onClick={() => remove(v)} aria-label={t('Retirer')} />}
            </li>
          ))
        ) : (
          <li className="text-sm text-ink-500">{t('Liste vide')}</li>
        )}
      </ul>
      {editable && (
        <form onSubmit={add} className="flex gap-2">
          <Input value={id} onChange={(e) => setId(e.target.value)} placeholder={t('Identifiant (SteamID…)')} className="font-mono text-xs" />
          <Button type="submit" icon={Plus} loading={busy === 'add'} disabled={!id.trim()} aria-label={t('Ajouter')} />
        </form>
      )}
    </Card>
  );
}

function HealthModal({ state, onClose, act, busy }) {
  const t = useT();
  const [amount, setAmount] = useState(50);
  const p = state?.player;
  const heal = state?.type === 'heal';
  const submit = async (value) => {
    const n = Math.round(value);
    const r = await act(heal ? 'heal' : 'damage', p, { amount: n }, heal ? t('{name} soigné', { name: p.name }) : t('{name} a subi {n} dégâts', { name: p.name, n }));
    if (r) onClose();
  };
  return (
    <Modal
      open={!!p}
      onClose={onClose}
      title={p ? t(heal ? 'Soigner {name}' : 'Blesser {name}', { name: p.name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Annuler')}</Button>
          <Button variant={heal ? 'success' : 'danger'} icon={heal ? HeartPulse : Swords} loading={busy?.startsWith(heal ? 'heal' : 'damage')} onClick={() => submit(amount)}>
            {t(heal ? 'Soigner' : 'Infliger')}
          </Button>
        </>
      }
    >
      {p && (
        <div className="space-y-4">
          {p.maxHp ? <p className="text-sm text-ink-400">{t('Santé actuelle : {hp} / {max} PV', { hp: Math.round(p.hp), max: Math.round(p.maxHp) })}</p> : null}
          <Field label={t(heal ? 'Points de vie à rendre' : 'Dégâts à infliger')}>
            <Input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          </Field>
          <div className="flex flex-wrap gap-2">
            {(heal ? [25, 50, 100] : [10, 25, 50]).map((v) => (
              <Button key={v} size="sm" onClick={() => setAmount(v)}>{v}</Button>
            ))}
            {heal && p.maxHp ? <Button size="sm" variant="success" onClick={() => submit(p.maxHp)}>{t('Soin complet')}</Button> : null}
          </div>
          {!heal && <p className="text-xs text-blood-400">{t('Attention : des dégâts supérieurs à sa santé tuent le joueur.')}</p>}
        </div>
      )}
    </Modal>
  );
}

function TeleportModal({ player, players, onClose, act, busy }) {
  const t = useT();
  const others = players.filter((x) => x.id !== player?.id);
  const [where, setWhere] = useState({ mode: 'player', player: '', x: '', y: '', z: '' });
  const effective = others.length ? where : { ...where, mode: 'coords' };
  const submit = async () => {
    const r = await act('teleport', player, { to: positionBody(effective) }, t('{name} téléporté', { name: player.name }));
    if (r) onClose();
  };
  return (
    <Modal
      open={!!player}
      onClose={onClose}
      title={player ? t('Téléporter {name}', { name: player.name }) : ''}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('Annuler')}</Button>
          <Button variant="primary" icon={MapPin} loading={busy?.startsWith('teleport')} onClick={submit}>{t('Téléporter')}</Button>
        </>
      }
    >
      {player && (
        <div className="space-y-4">
          <p className="text-sm text-ink-400">{t('Position actuelle : {pos}', { pos: formatPos(player.position) })}</p>
          <Field label={t('Destination')}>
            <PositionPicker players={others} value={effective} onChange={setWhere} />
          </Field>
          <p className="text-xs text-ink-500">{t('Astuce : la hauteur (Y) du sol est souvent entre 30 et 100. Téléporter vers un joueur est plus sûr.')}</p>
        </div>
      )}
    </Modal>
  );
}
