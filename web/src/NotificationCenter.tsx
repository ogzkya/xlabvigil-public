import { useState } from "react";
import type { FormEvent } from "react";
import {
  Bell,
  Check,
  CheckCheck,
  Info,
  Mail,
  MessageSquare,
  Save,
  Settings2,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  Modal,
  PageNavigation,
  SuccessNotice,
} from "./components";
import { demoInbox } from "./demoFixtures";
import {
  contains,
  severityLabels,
  severityTone,
  timestamp,
  useOperationRefresh,
} from "./operations";
import type { OperationsProps, Severity } from "./operations";
import { useListSearch } from "./listSearch";
import { useAlive, useResource } from "./resource";
import { isNotificationPageResponse, isNotificationSettingsResponse } from "./responseShape";

type Notification = {
  id: string;
  title: string;
  body: string;
  severity: Severity;
  eventId: string;
  createdAt: string;
  readAt: string | null;
};
type Inbox = { items: Notification[]; nextCursor: string; unreadCount: number };
type Settings = {
  provider: "none" | "smtp" | "graph";
  host: string;
  port: number;
  fromAddress: string;
  recipient: string;
  secretRef: string;
  version: number;
  status: "delivery_disabled";
};
const emptySettings: Settings = {
  provider: "none",
  host: "",
  port: 0,
  fromAddress: "",
  recipient: "",
  secretRef: "",
  version: 1,
  status: "delivery_disabled",
};
export default function NotificationCenter({
  user,
  demo,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
}: OperationsProps) {
  const alive = useAlive();
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const resetPaging = () => {
    setCursor("");
    setHistory([]);
  };
  const {
    submittedSearch,
    tooShort: searchTooShort,
    invalid: searchInvalid,
    pending: searchPending,
  } = useListSearch(query, demo, resetPaging);
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  if (!demo && submittedSearch) params.set("q", submittedSearch);
  if (!demo && filter === "unread") params.set("unread", "true");
  const inbox = useResource<Inbox>(
    `/notifications?${params}`,
    demo,
    demoInbox,
    onSessionExpired,
    isNotificationPageResponse,
  );
  const settings = useResource<Settings>(
    "/notification-settings",
    demo,
    emptySettings,
    onSessionExpired,
    isNotificationSettingsResponse,
  );
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    inbox.matchesRequest &&
      settings.matchesRequest &&
      !inbox.loading &&
      !settings.loading,
    [inbox.refresh, settings.refresh],
  );
  const [editing, setEditing] = useState<Settings | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Notification | null>(null);
  const items = demo
    ? inbox.data?.items.filter(
        (n) =>
          (filter !== "unread" || !n.readAt) &&
          contains(query, n.title, n.body),
      ) || []
    : inbox.data?.items || [];
  async function markRead(id: string) {
    if (demo || busy) return;
    setBusy(id);
    setActionError("");
    try {
      await api(`/notifications/${id}/read`, "POST", {});
      if (alive.current) {
        await inbox.refresh();
        if (alive.current) setDetail(null);
      }
    } catch (err) {
      if (alive.current) {
        setActionError((err as Error).message);
        if (err instanceof ApiError && err.status === 401) onSessionExpired();
      }
    } finally {
      if (alive.current) setBusy("");
    }
  }
  return (
    <div className="operations-page">
      <div className="notification-channels">
        <section className="panel channel-card">
          <span className="channel-icon">
            <MessageSquare size={23} />
          </span>
          <div>
            <h2>Uygulama içi mesajlar</h2>
            <p>Yüksek ve kritik olaylardan oluşan inceleme bildirimleri.</p>
            <Badge tone="teal">Etkin · kullanıcıya özel okundu durumu</Badge>
          </div>
        </section>
        <section className="panel channel-card">
          <span className="channel-icon mail">
            <Mail size={23} />
          </span>
          <div>
            <h2>E-posta kanalı</h2>
            <p>
              {settings.loading
                ? "Kanal bilgisi yükleniyor…"
                : settings.error
                  ? "Kanal bilgisi alınamadı"
                  : settings.data?.provider === "none"
                    ? "SMTP veya Microsoft Graph ile gönderim profili hazırlayın."
                    : `${settings.data?.provider === "smtp" ? "SMTP" : "Microsoft Graph"} profili kaydedildi.`}
            </p>
            {settings.loading ? (
              <Badge>Durum yükleniyor</Badge>
            ) : settings.error ? (
              <Badge>Durum alınamadı</Badge>
            ) : settings.data?.status === "delivery_disabled" ? (
              <Badge tone="yellow">Gönderim kapalı</Badge>
            ) : (
              <Badge>Durum belirtilmedi</Badge>
            )}
          </div>
          {user.role === "admin" && !demo && (
            <button
              className="icon-btn"
              aria-label="E-posta kanalını yapılandır"
              disabled={settings.loading || !!settings.error}
              onClick={() => {
                if (settings.data) setEditing(settings.data);
              }}
            >
              <Settings2 size={18} />
            </button>
          )}
        </section>
      </div>
      {settings.error && (
        <LoadError
          message={settings.error}
          onRetry={() => void settings.refresh()}
        />
      )}
      <div className="info-strip">
        <Info size={18} />
        <p>
          Bu alan güvenlik olaylarına ilişkin sistem bildirimlerini gösterir.
          E-posta ayarları kaydedilebilir; SMTP/Graph gönderim hizmeti ve harici
          mesaj kanalları henüz devrede değildir. Üst arama alanı {demo
            ? "önizleme kayıtlarında arar."
            : "tüm bildirimlerde arar (3–120 karakter)."}
        </p>
      </div>
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {actionError && <FormError>{actionError}</FormError>}
      <section className="panel inbox-panel">
        <div className="inbox-heading">
          <div>
            <Bell size={19} />
            <h2>Bildirim kutusu</h2>
            {inbox.data &&
              inbox.matchesRequest &&
              !inbox.error &&
              !inbox.loading && (
                <Badge tone="teal">
                  {inbox.data.unreadCount} toplam okunmamış
                </Badge>
              )}
          </div>
          <div className="segmented-control" role="group" aria-label="Bildirim filtresi">
            <button
              aria-pressed={filter === "all"}
              className={filter === "all" ? "selected" : ""}
              onClick={() => {
                if (filter !== "all") {
                  setFilter("all");
                  resetPaging();
                }
              }}
            >
              Tümü
            </button>
            <button
              aria-pressed={filter === "unread"}
              className={filter === "unread" ? "selected" : ""}
              onClick={() => {
                if (filter !== "unread") {
                  setFilter("unread");
                  resetPaging();
                }
              }}
            >
              Okunmamış
            </button>
          </div>
        </div>
        {searchInvalid ? (
          <Empty
            title={
              searchTooShort
                ? "Arama için en az 3 karakter yazın"
                : "Arama çok uzun"
            }
          >
            {searchTooShort
              ? "Aramayı sürdürün veya temizleyerek tüm bildirimleri gösterin."
              : "Arama ifadesini 120 karaktere kısaltın."}
          </Empty>
        ) : searchPending ? (
          <Loading label="Arama hazırlanıyor…" />
        ) : inbox.loading || !inbox.matchesRequest ? (
          <Loading label="Bildirimler yükleniyor…" />
        ) : inbox.error ? (
          <LoadError
            message={inbox.error}
            onRetry={() => void inbox.refresh()}
          />
        ) : items.length ? (
          <div className="notification-list">
            {items.map((n) => (
              <article
                className={`notification-row ${n.readAt ? "read" : "unread"}`}
                key={n.id}
              >
                <span
                  className={`notification-dot ${n.readAt ? "read" : ""}`}
                  aria-hidden="true"
                />
                <span className="sr-only">{n.readAt ? "Okundu" : "Okunmadı"}</span>
                <div className="notification-copy">
                  <div>
                    <Badge tone={severityTone[n.severity]}>
                      {severityLabels[n.severity]}
                    </Badge>
                    <time dateTime={n.createdAt}>{timestamp(n.createdAt)}</time>
                  </div>
                  <button
                    className="table-link"
                    onClick={() => {
                      setDetail(n);
                      setActionError("");
                    }}
                  >
                    {n.title}
                  </button>
                  <p>{n.body}</p>
                </div>
                <div className="notification-actions">
                  {n.readAt ? (
                    <span className="read-label">
                      <CheckCheck size={15} /> Okundu
                    </span>
                  ) : (
                    <button
                      className="btn secondary"
                      disabled={demo || !!busy}
                      onClick={() => void markRead(n.id)}
                    >
                      <Check size={15} />
                      {busy === n.id ? "Kaydediliyor…" : "Okundu işaretle"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title={
              query.trim() || filter === "unread"
                ? "Filtrelerle eşleşen bildirim yok"
                : "Henüz bildirim oluşturulmadı"
            }
          >
            {query.trim() || filter === "unread"
              ? "Aramayı veya filtreyi değiştirin."
              : "Yüksek ve kritik önem dereceli olaylar içe aktarıldığında bu kutuda görünür."}
          </Empty>
        )}
        {!searchInvalid &&
          !searchPending &&
          !inbox.loading &&
          inbox.matchesRequest &&
          !inbox.error && (
            <PageNavigation
              page={history.length + 1}
              count={items.length}
              caption={
                demo
                  ? "Sayı yalnız bu önizleme sayfasındaki eşleşmeleri gösterir."
                  : "Arama ve filtreler tüm bildirimlere uygulanır; sayı yalnız bu sayfadaki eşleşmelerdir, toplam değildir."
              }
              previousDisabled={!history.length || !!busy}
              nextDisabled={!inbox.data?.nextCursor || demo || !!busy}
              onPrevious={() => {
                setCursor(history.at(-1) || "");
                setHistory((values) => values.slice(0, -1));
              }}
              onNext={() => {
                setHistory((values) => [...values, cursor]);
                setCursor(inbox.data!.nextCursor);
              }}
            />
          )}
      </section>
      {editing && (
        <NotificationSettings
          initial={editing}
          onSessionExpired={onSessionExpired}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setNotice(
              "E-posta profili kaydedildi. Gönderim hizmeti etkin değil.",
            );
            void settings.refresh();
          }}
        />
      )}
      {detail && (
        <Modal
          title="Bildirim ayrıntısı"
          subtitle={timestamp(detail.createdAt)}
          onClose={() => {
            if (!busy) setDetail(null);
          }}
        >
          <div className="event-detail-body">
            <Badge tone={severityTone[detail.severity]}>
              {severityLabels[detail.severity]}
            </Badge>
            <h3 className="notification-detail-title">{detail.title}</h3>
            <p>{detail.body}</p>
            <dl className="event-facts">
              <div>
                <dt>İlgili olay kimliği</dt>
                <dd>{detail.eventId || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Okunma durumu</dt>
                <dd>
                  {detail.readAt ? timestamp(detail.readAt) : "Henüz okunmadı"}
                </dd>
              </div>
            </dl>
            {actionError && <FormError>{actionError}</FormError>}
            <div className="modal-actions">
              <button
                className="btn secondary"
                disabled={!!busy}
                onClick={() => setDetail(null)}
              >
                Kapat
              </button>
              {!detail.readAt && !demo && (
                <button
                  className="btn primary"
                  disabled={!!busy}
                  onClick={() => void markRead(detail.id)}
                >
                  <Check size={16} />
                  {busy ? "Kaydediliyor…" : "Okundu işaretle"}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function NotificationSettings({
  initial,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  initial: Settings;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}) {
  const alive = useAlive();
  const [baseline, setBaseline] = useState(initial);
  const [latest, setLatest] = useState<Settings | null>(null);
  const [conflict, setConflict] = useState(false);
  const [provider, setProvider] = useState(initial.provider);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port || 587);
  const [fromAddress, setFromAddress] = useState(initial.fromAddress);
  const [recipient, setRecipient] = useState(initial.recipient);
  const [secretRef, setSecretRef] = useState(initial.secretRef);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function reloadCurrent() {
    if (busy || !conflict) return;
    setBusy(true);
    setError("");
    try {
      const current = await api<Settings>(
        "/notification-settings",
        "GET",
        undefined,
        isNotificationSettingsResponse,
      );
      if (!current || !Number.isInteger(current.version) || current.version <= baseline.version) {
        throw new Error("Güncel kanal ayarı doğrulanamadı. Taslağınız korundu; yeniden yüklemeyi deneyin.");
      }
      if (alive.current) setLatest(current);
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        if (err instanceof ApiError && err.status === 401) onSessionExpired();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || conflict) return;
    setBusy(true);
    setError("");
    try {
      await api("/notification-settings", "PUT", {
        provider,
        host: provider === "smtp" ? host.trim() : "",
        port: provider === "smtp" ? port : 0,
        fromAddress: provider === "none" ? "" : fromAddress.trim(),
        recipient: provider === "none" ? "" : recipient.trim(),
        secretRef: provider === "none" ? "" : secretRef.trim(),
        expectedVersion: baseline.version,
      });
      if (alive.current) onSaved();
    } catch (err) {
      if (alive.current) {
        if (err instanceof ApiError && err.status === 409 && err.code === "stale_write") {
          setConflict(true);
          setLatest(null);
          setError("Kanal ayarı değişti. Taslağınız korundu. Güncel kaydı yükleyip değişiklikleri inceleyin.");
        } else {
          setError((err as Error).message);
        }
        if (err instanceof ApiError && err.status === 401) onSessionExpired();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      title="E-posta kanalını yapılandır"
      subtitle="Profil kaydedilir; dışarıya e-posta gönderilmez"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="editor-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Gönderim sağlayıcısı
            <select
              value={provider}
              onChange={(e) =>
                setProvider(e.target.value as Settings["provider"])
              }
            >
              <option value="none">Yapılandırılmadı</option>
              <option value="smtp">SMTP</option>
              <option value="graph">Microsoft Graph</option>
            </select>
          </label>
          {provider === "smtp" && (
            <div className="form-grid">
              <label>
                SMTP sunucusu
                <input
                  name="host"
                  value={host}
                  onChange={(event) => setHost(event.target.value)}
                  placeholder="smtp.kurum.example"
                  maxLength={253}
                  required
                />
                <span className="field-help">
                  Yalnızca sunucu adı veya IP; URL kullanmayın.
                </span>
              </label>
              <label>
                TLS portu
                <select name="port" value={port} onChange={(event) => setPort(Number(event.target.value))}>
                  <option value={587}>587 · STARTTLS</option>
                  <option value={465}>465 · TLS</option>
                </select>
              </label>
            </div>
          )}
          {provider !== "none" && (
            <>
              <label>
                Gönderen posta kutusu
                <input
                  name="fromAddress"
                  type="email"
                  value={fromAddress}
                  onChange={(event) => setFromAddress(event.target.value)}
                  placeholder="vigil@kurum.example"
                  maxLength={254}
                  required
                />
              </label>
              <label>
                Alıcı posta kutusu
                <input
                  name="recipient"
                  type="email"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="guvenlik@kurum.example"
                  maxLength={254}
                  required
                />
                <span className="field-help">
                  Tek bir adres. Kurumsal dağıtım grubu adresi kullanılabilir.
                </span>
              </label>
              <label>
                Kimlik bilgisi referansı
                <input
                  name="secretRef"
                  value={secretRef}
                  onChange={(event) => setSecretRef(event.target.value)}
                  pattern="env:[A-Z][A-Z0-9_]{2,95}"
                  placeholder="env:VIGIL_MAIL_SECRET"
                  required
                />
                <span className="field-help">
                  Parola veya erişim anahtarı yazmayın; env:DEGISKEN_ADI
                  biçimini kullanın.
                </span>
              </label>
            </>
          )}
          <div className="info-strip">
            <Info size={18} />
            <p>
              {provider === "none"
                ? "Bu seçimi kaydetmek önceki gönderim profili alanlarını temizler. Uygulama içi bildirimler devam eder."
                : "Bu ayarlar gönderim hazırlığı içindir. Bağlantı doğrulaması, teslimat ve yeniden deneme hizmeti henüz uygulanmadı."}
            </p>
          </div>
          {conflict && !latest && (
            <div className="info-strip" role="status">
              <Info size={18} />
              <div>
                <p>Bu taslak eski bir sürüme dayanıyor. Güncel ayarı yükleyip karşılaştırmadan kaydedemezsiniz.</p>
                <button className="btn secondary" type="button" onClick={() => void reloadCurrent()}>
                  {busy ? "Yükleniyor…" : "Güncel ayarı yükle"}
                </button>
              </div>
            </div>
          )}
          {conflict && latest && (
            <div className="panel" role="status">
              <h3>Sunucudaki güncel ayar · sürüm {latest.version}</h3>
              <p>Yukarıdaki alanlar taslağınızdır. Aşağıdaki değerlerle karşılaştırıp gerekiyorsa taslağı düzenleyin.</p>
              <dl className="event-facts">
                <div><dt>Sağlayıcı</dt><dd>{latest.provider === "smtp" ? "SMTP" : latest.provider === "graph" ? "Microsoft Graph" : "Yapılandırılmadı"}</dd></div>
                {latest.provider === "smtp" && (
                  <>
                    <div><dt>SMTP sunucusu</dt><dd>{latest.host}</dd></div>
                    <div><dt>TLS portu</dt><dd>{latest.port}</dd></div>
                  </>
                )}
                {latest.provider !== "none" && (
                  <>
                    <div><dt>Gönderen posta kutusu</dt><dd>{latest.fromAddress}</dd></div>
                    <div><dt>Alıcı posta kutusu</dt><dd>{latest.recipient}</dd></div>
                    <div><dt>Kimlik bilgisi referansı</dt><dd>{latest.secretRef}</dd></div>
                  </>
                )}
              </dl>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  setBaseline(latest);
                  setLatest(null);
                  setConflict(false);
                  setError("");
                }}
              >
                Güncel ayarı inceledim
              </button>
            </div>
          )}
          {error && <FormError>{error}</FormError>}
        </fieldset>
        <div className="modal-actions">
          <button
            className="btn secondary"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Vazgeç
          </button>
          <button className="btn primary" disabled={busy || conflict} type="submit">
            <Save size={16} />
            {busy ? "Kaydediliyor…" : "Profili kaydet"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
