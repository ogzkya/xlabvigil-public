import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { LogOut, Plus, ShieldCheck, UserRound } from "lucide-react";
import { api, ApiError } from "./api";
import {
  Avatar,
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  Modal,
  SuccessNotice,
} from "./components";
import { formatDateUTC } from "./dateTime";
import FormModal from "./FormModal";
import { accountSessionStatusTone } from "./design";
import { useOperationRefresh } from "./operations";
import { useAlive, useResource } from "./resource";
import { isManagedUserCollection } from "./responseShape";
import { roleLabels } from "./types";
import type { User } from "./types";

type ManagedUser = User & {
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};
type Draft = { mode: "create" } | { mode: "edit"; user: ManagedUser };
const emptyUsers: ManagedUser[] = [];

export default function UserManager({
  currentUser,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
}: {
  currentUser: User;
  query: string;
  onSessionExpired: () => void;
  refreshToken: number;
  onRefreshComplete: (token: number) => void;
}) {
  const resource = useResource<ManagedUser[]>(
    "/users",
    false,
    emptyUsers,
    onSessionExpired,
    isManagedUserCollection,
  );
  const { loading, error, refresh } = resource;
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    resource.matchesRequest && !loading,
    [refresh],
  );
  const users = resource.data ?? emptyUsers;
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ManagedUser | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("tr");
    if (!needle) return users;
    return users.filter((user) =>
      [user.name, user.username, roleLabels[user.role], user.active ? "etkin" : "kapalı"]
        .join(" ")
        .toLocaleLowerCase("tr")
        .includes(needle),
    );
  }, [query, users]);

  return (
    <div className="operations-page">
      <div className="operations-section-heading">
        <div>
          <h2>Kullanıcı ve roller</h2>
          <p>
            Vigil hesapları yerel olarak yönetilir. Rol veya etkinlik değişince
            oturumlar iptal edilir; yöneticiler başka bir hesabın oturumlarını
            ayrıca kapatabilir.
          </p>
        </div>
        <div className="inline-actions">
          <button className="btn primary" onClick={() => setDraft({ mode: "create" })}>
            <Plus size={16} /> Kullanıcı ekle
          </button>
          <button className="btn secondary" onClick={() => void refresh()} disabled={loading}>
            Yenile
          </button>
        </div>
      </div>
      <div className="info-strip">
        <ShieldCheck size={18} />
        <p>
          Son etkin yönetici korunur. Yönetici, analist, üye ve görüntüleyici
          rolleri yerel uygulama kapsamındadır; SSO veya çok faktörlü giriş
          yapılandırması değildir.
        </p>
      </div>
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {error ? (
        <LoadError
          title="Kullanıcı listesi yüklenemedi"
          message={error}
          onRetry={() => void refresh()}
        />
      ) : loading ? (
        <Loading label="Kullanıcılar yükleniyor…" />
      ) : visible.length ? (
        <div className="panel table-wrap">
          <table className="user-table">
            <thead>
              <tr>
                <th>Kullanıcı</th>
                <th>Rol</th>
                <th>Durum</th>
                <th>Oluşturulma</th>
                <th><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <Avatar name={user.name} small />
                      <div>
                        <strong>{user.name}</strong>
                        <small>{user.username}</small>
                      </div>
                    </div>
                  </td>
                  <td>{roleLabels[user.role]}</td>
                  <td>
                    <Badge
                      tone={
                        user.active
                          ? accountSessionStatusTone.active
                          : accountSessionStatusTone.warning
                      }
                    >
                      {user.active ? "Etkin" : "Kapalı"}
                    </Badge>
                  </td>
                  <td>{formatDateUTC(user.createdAt, true)} UTC</td>
                  <td>
                    <div className="inline-actions user-actions">
                      <button
                        className="btn secondary"
                        onClick={() => {
                          setNotice("");
                          setDraft({ mode: "edit", user });
                        }}
                      >
                        Düzenle
                      </button>
                      {user.active && user.id !== currentUser.id && (
                        <button
                          className="btn secondary text-danger"
                          onClick={() => setRevokeTarget(user)}
                        >
                          <LogOut size={14} /> Oturumları kapat
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={query ? "Eşleşen kullanıcı yok" : "Henüz kullanıcı yok"}>
          {query ? "Arama ifadesini değiştirin." : "İlk yönetici kurulumu tamamlandığında burada görünür."}
        </Empty>
      )}
      {draft && (
        <UserDialog
          key={draft.mode === "create" ? "new-user" : draft.user.id}
          draft={draft}
          currentUser={currentUser}
          onClose={() => setDraft(null)}
          onSaved={async (message) => {
            setDraft(null);
            setNotice(message);
            await refresh();
          }}
          onSessionExpired={onSessionExpired}
        />
      )}
      {revokeTarget && (
        <RevokeSessionsDialog
          user={revokeTarget}
          onClose={() => setRevokeTarget(null)}
          onSaved={async (message) => {
            setRevokeTarget(null);
            setNotice(message);
            await refresh();
          }}
          onSessionExpired={onSessionExpired}
        />
      )}
    </div>
  );
}

function RevokeSessionsDialog({
  user,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  user: ManagedUser;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ revoked: number }>(
        `/users/${user.id}/sessions/revoke`,
        "POST",
        {},
      );
      if (!alive.current) return;
      const message = result.revoked
        ? `${user.name} için ${result.revoked} oturum kapatıldı.`
        : `${user.name} için açık oturum kaydı bulunmadı.`;
      await onSaved(message);
    } catch (err) {
      if (!alive.current) return;
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <Modal
      title="Kullanıcı oturumlarını kapat"
      subtitle={user.username}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeDisabled={busy}
    >
      <div className="detail-body">
        <p>
          {user.name} hesabının etkin oturumları iptal edilecek. Kullanıcı,
          sonraki isteğinde yeniden giriş yapmalıdır. Hesap durumu ve rol değişmez.
        </p>
        {error && <FormError>{error}</FormError>}
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose} disabled={busy}>
          Vazgeç
        </button>
        <button
          className="btn secondary text-danger"
          onClick={() => void revoke()}
          disabled={busy}
        >
          <LogOut size={15} /> {busy ? "Kapatılıyor…" : "Oturumları kapat"}
        </button>
      </div>
    </Modal>
  );
}

function UserDialog({
  draft,
  currentUser,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  draft: Draft;
  currentUser: User;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
  onSessionExpired: () => void;
}) {
  const existing = draft.mode === "edit" ? draft.user : undefined;
  const [username, setUsername] = useState(existing?.username || "");
  const [name, setName] = useState(existing?.name || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<User["role"]>(existing?.role || "analyst");
  const [active, setActive] = useState(existing?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(existing?.version ?? 0);
  const [baselineRecord, setBaselineRecord] = useState(existing);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<ManagedUser | null>(null);
  const alive = useAlive();

  async function reloadCurrentUser() {
    if (!existing || reloading) return;
    setReloading(true);
    setError("");
    setCurrentRecord(null);
    try {
      const users = await api<ManagedUser[]>("/users", "GET", undefined, isManagedUserCollection);
      if (!alive.current) return;
      const current = users.find((user) => user.id === existing.id);
      if (!current) {
        setError("Kullanıcı güncel listede bulunamadı. Taslağınız korundu; kaydetmeden önce listeyi yenileyin.");
        return;
      }
      if (!Number.isSafeInteger(current.version) || current.version < 1) {
        setError("Güncel kullanıcı sürümü doğrulanamadı. Taslağınız korundu; yeniden yüklemeyi deneyin.");
        return;
      }
      setCurrentRecord(current);
    } catch (failure) {
      if (!alive.current) return;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        onSessionExpired();
        return;
      }
      setError((failure as Error).message || "Güncel kullanıcı yüklenemedi. Taslağınız korundu.");
    } finally {
      if (alive.current) setReloading(false);
    }
  }

  function acceptCurrentUser() {
    if (!currentRecord || reloading) return;
    setExpectedVersion(currentRecord.version);
    setBaselineRecord(currentRecord);
    setCurrentRecord(null);
    setConflict(false);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict || reloading) return;
    setBusy(true);
    setError("");
    try {
      if (draft.mode === "create") {
        await api<ManagedUser>("/users", "POST", { username, name, password, role });
        if (!alive.current) return;
        await onSaved("Kullanıcı oluşturuldu.");
      } else {
        const updated = await api<ManagedUser>(`/users/${draft.user.id}`, "PATCH", {
          name,
          role,
          active,
          expectedVersion,
        });
        if (!alive.current) return;
        const previous = baselineRecord ?? draft.user;
        const accessChanged = updated.role !== previous.role || updated.active !== previous.active;
        await onSaved(accessChanged ? "Kullanıcı güncellendi; açık oturumları iptal edildi." : "Kullanıcı bilgileri güncellendi.");
      }
    } catch (err) {
      if (!alive.current) return;
      if (err instanceof ApiError && err.code === "stale_write") {
        setConflict(true);
        setCurrentRecord(null);
        setError(`${err.message} Yazdığınız alanlar korundu. Güncel kullanıcıyı yükleyip değişiklikleri inceleyin.`);
        return;
      }
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <FormModal
      title={existing ? "Kullanıcıyı düzenle" : "Kullanıcı oluştur"}
      subtitle={existing ? `${existing.username} · sürüm ${expectedVersion}` : "Yeni yerel Vigil hesabı"}
      onClose={onClose}
      closeDisabled={busy || reloading}
    >
      {(requestClose) => (
      <form className="editor-form" onSubmit={(event) => void submit(event)}>
        <fieldset disabled={busy}>
          {draft.mode === "create" && (
            <label>
              Kullanıcı adı
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value.toLowerCase())}
                autoComplete="username"
                minLength={3}
                maxLength={64}
                pattern="[a-z0-9][a-z0-9._-]{2,63}"
                required
              />
              <small className="field-help">Küçük harf, sayı, nokta, tire veya alt çizgi.</small>
            </label>
          )}
          <label>
            Görünen ad
            <input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={100} required />
          </label>
          {draft.mode === "create" && (
            <label>
              İlk parola
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
              />
              <small className="field-help">12–128 bayt. Parola yalnızca doğrulanmış özet olarak saklanır.</small>
            </label>
          )}
          <label>
            Rol
            <select
              value={role}
              onChange={(event) => setRole(event.target.value as User["role"])}
              disabled={existing?.id === currentUser.id}
            >
              <option value="admin">Yönetici</option>
              <option value="analyst">Analist</option>
              <option value="member">Üye</option>
              <option value="viewer">Görüntüleyici</option>
            </select>
          </label>
          {draft.mode === "edit" && (
            <label>
              Hesap durumu
              <select
                value={active ? "active" : "inactive"}
                onChange={(event) => setActive(event.target.value === "active")}
                disabled={existing?.id === currentUser.id}
              >
                <option value="active">Etkin</option>
                <option value="inactive">Kapalı</option>
              </select>
              {existing?.id === currentUser.id && (
                <small className="field-help">
                  Kendi rolünüzü veya hesap durumunuzu değiştiremezsiniz.
                </small>
              )}
            </label>
          )}
          {error && <FormError>{error}</FormError>}
          {conflict && (
            <div className="info-strip" role="status">
              <div>
                {currentRecord ? (
                  <>
                    <strong>Sunucudaki güncel kullanıcı · sürüm {currentRecord.version}</strong>
                    <p>Formdaki taslağınız korunuyor. Güncel değerleri inceleyip devam etmeyi seçin.</p>
                    <dl className="event-facts">
                      <div><dt>Kullanıcı adı</dt><dd>{currentRecord.username}</dd></div>
                      <div><dt>Görünen ad</dt><dd>{currentRecord.name}</dd></div>
                      <div><dt>Rol</dt><dd>{roleLabels[currentRecord.role]}</dd></div>
                      <div><dt>Durum</dt><dd>{currentRecord.active ? "Etkin" : "Kapalı"}</dd></div>
                    </dl>
                    <button className="btn secondary" type="button" onClick={acceptCurrentUser}>
                      Güncel sürümle devam et
                    </button>
                  </>
                ) : (
                  <button className="btn secondary" type="button" disabled={reloading} onClick={() => void reloadCurrentUser()}>
                    {reloading ? "Güncel kullanıcı yükleniyor…" : "Güncel kullanıcıyı yükle"}
                  </button>
                )}
              </div>
            </div>
          )}
        </fieldset>
        <div className="modal-actions">
          <button className="btn secondary" type="button" onClick={requestClose} disabled={busy || reloading}>Vazgeç</button>
          <button className="btn primary" type="submit" disabled={busy || conflict || reloading}>
            <UserRound size={16} /> {busy ? "Kaydediliyor…" : existing ? "Değişiklikleri kaydet" : "Kullanıcı oluştur"}
          </button>
        </div>
      </form>
      )}
    </FormModal>
  );
}
