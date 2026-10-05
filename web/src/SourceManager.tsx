import { useState } from "react";
import type { FormEvent } from "react";
import {
  ChevronRight,
  Info,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Unplug,
} from "lucide-react";
import { api, ApiError } from "./api";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  SuccessNotice,
} from "./components";
import { demoConnections } from "./demoFixtures";
import {
  contains,
  connectionStatusLabels,
  connectionStatusTone,
  providers,
  providerCollectionStatus,
  timestamp,
  transportLabels,
  useOperationRefresh,
} from "./operations";
import type { Connection, OperationsProps } from "./operations";
import { useAlive, useResource } from "./resource";
import FormModal from "./FormModal";
import { isConnectionCollection } from "./responseShape";

export default function SourceManager({
  user,
  demo,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
}: OperationsProps) {
  const resource = useResource<Connection[]>(
    "/connections",
    demo,
    demoConnections,
    onSessionExpired,
    isConnectionCollection,
  );
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    resource.matchesRequest && !resource.loading,
    [resource.refresh],
  );
  const [editor, setEditor] = useState<{
    provider: string;
    value?: Connection;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const canEdit = user.role === "admin" && !demo;
  const connections =
    resource.data?.filter((c) =>
      contains(query, c.name, c.provider, c.scope),
    ) || [];
  const catalogue = providers.filter((p) =>
    contains(query, p.name, p.category, p.description),
  );
  return (
    <div className="operations-page">
      <section className="integration-intro">
        <div className="integration-intro-icon">
          <Network size={28} />
        </div>
        <div>
          <span className="eyebrow">KURUMUNUZUN VERİ KAYNAKLARI</span>
          <h2>Kimlik, ağ ve uç nokta aynı çalışma alanında</h2>
          <p>
            Bağlantı kapsamını kaydedin, olayları ortak biçimde inceleyin. Canlı
            toplayıcılar henüz devrede değil; mevcut aktarım yolu manuel JSON.
          </p>
        </div>
        <Badge tone="yellow">Canlı toplama kapalı</Badge>
      </section>
      <div className="operations-section-heading">
        <div>
          <h2>Bağlantı profilleri</h2>
          <p>Kaydedilen yapılandırmalar ve alınan olayların durumu.</p>
        </div>
        <div className="inline-actions">
          <button
            className="btn secondary"
            disabled={resource.loading}
            onClick={() => void resource.refresh()}
          >
            <RefreshCw size={16} className={resource.loading ? "spin" : ""} />{" "}
            Yenile
          </button>
          {canEdit && (
            <button
              className="btn primary"
              onClick={() => setEditor({ provider: "custom" })}
            >
              <Plus size={16} /> Bağlantı ekle
            </button>
          )}
        </div>
      </div>
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      {resource.loading ? (
        <Loading label="Kaynaklar yükleniyor…" />
      ) : resource.error ? (
        <LoadError
          message={resource.error}
          onRetry={() => void resource.refresh()}
        />
      ) : connections.length ? (
        <div className="connection-list">
          {connections.map((c) => (
            <article className="panel connection-row" key={c.id}>
              <span className={`vendor-mark vendor-${c.provider}`}>
                {providers.find((p) => p.id === c.provider)?.initials || "{}"}
              </span>
              <div className="connection-summary">
                <h3>{c.name}</h3>
                <p>
                  {providers.find((p) => p.id === c.provider)?.name ||
                    c.provider}{" "}
                  <span>·</span> {transportLabels[c.transport] || c.transport}
                </p>
                <small>{c.scope || "Kapsam belirtilmedi"}</small>
              </div>
              <div className="connection-state">
                <Badge tone={connectionStatusTone[c.status]}>
                  {connectionStatusLabels[c.status]}
                </Badge>
                <small>
                  {c.transport === "manual_json"
                    ? "Manuel aktarım"
                    : "Canlı toplayıcı bekliyor"}
                </small>
              </div>
              <div className="connection-metric">
                <strong>{c.eventCount} olay</strong>
                <small>{timestamp(c.lastReceivedAt || "")}</small>
              </div>
              {canEdit && (
                <button
                  className="icon-btn"
                  aria-label={`${c.name} bağlantısını düzenle`}
                  onClick={() => setEditor({ provider: c.provider, value: c })}
                >
                  <Pencil size={17} />
                </button>
              )}
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={
            query
              ? "Aramayla eşleşen bağlantı yok"
              : "İlk bağlantı profilinizi ekleyin"
          }
        >
          {query
            ? "Başka bir ad veya sağlayıcı arayabilirsiniz."
            : "Aşağıdaki ürünlerden birini seçin. Profil kaydetmek kaynak sistemine bağlanmaz veya veri çekmez."}
        </Empty>
      )}
      <div className="operations-section-heading">
        <div>
          <h2>Bağlantı kataloğu</h2>
          <p>Ürününüze uygun taşıma yöntemini ve yetki kapsamını belirleyin.</p>
        </div>
        <span className="collection-caption">
          {catalogue.length} kaynak türü
        </span>
      </div>
      <div className="vendor-grid">
        {catalogue.map((p) => (
          <article className="panel vendor-card" key={p.id}>
            <div className="vendor-card-top">
              <span className={`vendor-mark vendor-${p.id}`}>{p.initials}</span>
              <span className="eyebrow">{p.category}</span>
            </div>
            <h3>{p.name}</h3>
            <p>{p.description}</p>
            <div className="transport-chips">
              {p.transports.map((t) => (
                <span key={t}>{transportLabels[t]}</span>
              ))}
            </div>
            <footer>
              <span>
                <Unplug size={14} /> {providerCollectionStatus(p.transports)}
              </span>
              {canEdit && (
                <button
                  className="link-btn"
                  onClick={() => setEditor({ provider: p.id })}
                >
                  Yapılandır <ChevronRight size={16} />
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>
      {!catalogue.length && (
        <Empty title="Kaynak türü bulunamadı">
          Arama ifadesini değiştirin.
        </Empty>
      )}
      <div className="info-strip">
        <Info size={18} />
        <p>
          Ürün adı tek başına bağlantı uyumluluğunu doğrulamaz. Sürüm, lisans,
          izinler ve gerçek ürün olaylarıyla kabul doğrulaması gerekir. Parola
          veya API anahtarı yerine ortam değişkeni referansı kaydedilir.
        </p>
      </div>
      {editor && (
        <ConnectionEditor
          initial={editor}
          onSessionExpired={onSessionExpired}
          onClose={() => setEditor(null)}
          onSaved={() => {
            setEditor(null);
            setNotice(
              "Bağlantı profili kaydedildi. Canlı veri toplama başlatılmadı.",
            );
            void resource.refresh();
          }}
        />
      )}
    </div>
  );
}

function ConnectionEditor({
  initial,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  initial: { provider: string; value?: Connection };
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
}) {
  const alive = useAlive();
  const { value } = initial;
  const [baseline, setBaseline] = useState(value);
  const [latest, setLatest] = useState<Connection | null>(null);
  const [conflict, setConflict] = useState(false);
  const [provider, setProvider] = useState(initial.provider);
  const initialTransport =
    value?.transport ||
      providers.find((p) => p.id === initial.provider)!.transports[0];
  const [transport, setTransport] = useState(initialTransport);
  // Endpoint and secret references belong to a specific provider/transport pair.
  const [connectionDrafts, setConnectionDrafts] = useState<Record<string, {
    endpoint: string;
    secretRef: string;
  }>>({
    [`${initial.provider}:${initialTransport}`]: {
      endpoint: value?.endpoint || "",
      secretRef: value?.secretRef || "",
    },
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = providers.find((p) => p.id === provider)!;
  const draftKey = `${provider}:${transport}`;
  const connectionDraft = connectionDrafts[draftKey] ?? { endpoint: "", secretRef: "" };
  function updateConnectionDraft(field: "endpoint" | "secretRef", next: string) {
    setConnectionDrafts((drafts) => ({
      ...drafts,
      [draftKey]: {
        ...(drafts[draftKey] ?? { endpoint: "", secretRef: "" }),
        [field]: next,
      },
    }));
  }
  async function reloadCurrent() {
    if (!value || busy || !conflict) return;
    setBusy(true);
    setError("");
    try {
      const connections = await api<Connection[]>("/connections", "GET", undefined, isConnectionCollection);
      const current = Array.isArray(connections)
        ? connections.find((connection) => connection.id === value.id)
        : undefined;
      if (!current) {
        throw new Error("Güncel bağlantı profili bulunamadı. Taslağınız korundu; kaydı yeniden incelemeden gönderemezsiniz.");
      }
      if (!Number.isInteger(current.version) || current.version <= (baseline?.version || 0)) {
        throw new Error("Güncel bağlantı sürümü doğrulanamadı. Taslağınız korundu; yeniden yüklemeyi deneyin.");
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
    const form = new FormData(event.currentTarget);
    const read = (name: string) => String(form.get(name) || "").trim();
    setBusy(true);
    setError("");
    try {
      await api(
        `/connections${value ? `/${value.id}` : ""}`,
        value ? "PATCH" : "POST",
        {
          name: read("name"),
          provider,
          transport,
          endpoint: transport === "manual_json" ? "" : connectionDraft.endpoint.trim(),
          productVersion: read("productVersion"),
          scope: read("scope"),
          secretRef: transport === "manual_json" ? "" : connectionDraft.secretRef.trim(),
          status: read("status"),
          ...(baseline ? { expectedVersion: baseline.version } : {}),
        },
      );
      if (alive.current) onSaved();
    } catch (err) {
      if (alive.current) {
        if (value && err instanceof ApiError && err.status === 409 && err.code === "stale_write") {
          setConflict(true);
          setLatest(null);
          setError("Bağlantı profili değişti. Taslağınız korundu. Güncel kaydı yükleyip değişiklikleri inceleyin.");
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
    <FormModal
      title={value ? "Bağlantı profilini düzenle" : "Bağlantı profili ekle"}
      subtitle="Yapılandırma kaydı · Canlı bağlantı veya otomatik veri alımı başlatılmaz"
      onClose={onClose}
      closeDisabled={busy}
      hasUnsavedChanges={Object.entries(connectionDrafts).some(([key, draft]) => {
        const initialDraft = key === `${initial.provider}:${initialTransport}`;
        return draft.endpoint !== (initialDraft ? value?.endpoint || "" : "") ||
          draft.secretRef !== (initialDraft ? value?.secretRef || "" : "");
      })}
    >
      {(requestClose) => (
      <form className="editor-form" onSubmit={submit}>
        <fieldset disabled={busy}>
          <label>
            Bağlantı adı
            <input
              name="name"
              defaultValue={value?.name}
              placeholder="Örn. Merkez Logsign SIEM"
              required
              minLength={2}
              maxLength={160}
            />
          </label>
          <div className="form-grid">
            <label>
              Sağlayıcı
              <select
                value={provider}
                disabled={!!baseline?.eventCount && provider === baseline.provider && transport === baseline.transport}
                onChange={(e) => {
                  const next = providers.find((p) => p.id === e.target.value)!;
                  setProvider(next.id);
                  setTransport(next.transports[0]);
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Taşıma yöntemi
              <select
                value={transport}
                disabled={!!baseline?.eventCount && provider === baseline.provider && transport === baseline.transport}
                onChange={(e) => setTransport(e.target.value)}
              >
                {selected.transports.map((t) => (
                  <option key={t} value={t}>
                    {transportLabels[t]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {!!baseline?.eventCount && (
            <p className="field-help">
              Olay alınmış bağlantılarda kaynak geçmişini korumak için sağlayıcı
              ve taşıma yöntemi değiştirilemez. Yeni yöntem için yeni profil
              oluşturun.
            </p>
          )}
          {transport === "manual_json" ? (
            <div className="info-strip">
              <Info size={18} />
              <p>
                Olaylar sayfasından en fazla 100 normalize edilmiş olayı tek
                seferde içe aktarabilirsiniz. Dış sisteme bağlantı kurulmaz.
              </p>
            </div>
          ) : (
            <>
              <label>
                Kaynak adresi
                <input
                  name="endpoint"
                  value={connectionDraft.endpoint}
                  onChange={(event) => updateConnectionDraft("endpoint", event.target.value)}
                  maxLength={500}
                  placeholder={
                    transport === "ldaps"
                      ? "ldaps://dc.kurum.example:636"
                      : transport === "syslog_tls"
                        ? "tls://collector.kurum.example:6514"
                        : "https://kaynak.kurum.example"
                  }
                />
                <span className="field-help">
                  İlgili protokolü kullanın. Kullanıcı adı, parola, sorgu veya
                  erişim anahtarı içeren adres kaydetmeyin.
                </span>
              </label>
              <label>
                Gizli bilgi referansı
                <input
                  name="secretRef"
                  value={connectionDraft.secretRef}
                  onChange={(event) => updateConnectionDraft("secretRef", event.target.value)}
                  pattern="env:[A-Z_][A-Z0-9_]*"
                  placeholder="env:VIGIL_SOURCE_TOKEN"
                  maxLength={160}
                />
                <span className="field-help">
                  İsteğe bağlı env:DEGISKEN_ADI. Gizli bilginin kendisini
                  yazmayın.
                </span>
              </label>
            </>
          )}
          <div className="form-grid">
            <label>
              Ürün sürümü
              <input
                name="productVersion"
                defaultValue={value?.productVersion}
                placeholder="Örn. Kurumda kullanılan sürüm"
                maxLength={120}
              />
            </label>
            <label>
              Profil durumu
              <select
                name="status"
                defaultValue={value?.status || "configured"}
              >
                <option value="configured">Yapılandırıldı</option>
                <option value="paused">Duraklatıldı</option>
              </select>
            </label>
          </div>
          <label>
            Veri kapsamı
            <textarea
              name="scope"
              defaultValue={value?.scope}
              rows={3}
              maxLength={2000}
              placeholder="Toplanacak olaylar, kurum birimi ve izin kapsamı"
            />
          </label>
          {conflict && !latest && (
            <div className="info-strip" role="status">
              <Info size={18} />
              <div>
                <p>Bu taslak eski bir sürüme dayanıyor. Güncel kaydı yükleyip karşılaştırmadan kaydedemezsiniz.</p>
                <button className="btn secondary" type="button" onClick={() => void reloadCurrent()}>
                  <RefreshCw size={16} /> {busy ? "Yükleniyor…" : "Güncel profili yükle"}
                </button>
              </div>
            </div>
          )}
          {conflict && latest && (
            <div className="panel" role="status">
              <h3>Sunucudaki güncel profil · sürüm {latest.version}</h3>
              <p>Yukarıdaki alanlar taslağınızdır. Aşağıdaki değerlerle karşılaştırıp gerekiyorsa taslağı düzenleyin.</p>
              <dl className="event-facts">
                <div><dt>Bağlantı adı</dt><dd>{latest.name}</dd></div>
                <div><dt>Sağlayıcı</dt><dd>{providers.find((item) => item.id === latest.provider)?.name || latest.provider}</dd></div>
                <div><dt>Taşıma yöntemi</dt><dd>{transportLabels[latest.transport] || latest.transport}</dd></div>
                <div><dt>Kaynak adresi</dt><dd>{latest.endpoint || "Belirtilmedi"}</dd></div>
                <div><dt>Ürün sürümü</dt><dd>{latest.productVersion || "Belirtilmedi"}</dd></div>
                <div><dt>Profil durumu</dt><dd>{connectionStatusLabels[latest.status] || latest.status}</dd></div>
                <div><dt>Veri kapsamı</dt><dd>{latest.scope || "Belirtilmedi"}</dd></div>
                <div><dt>Gizli bilgi referansı</dt><dd>{latest.secretRef || "Belirtilmedi"}</dd></div>
                <div><dt>Alınan olay</dt><dd>{latest.eventCount}</dd></div>
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
                Güncel profili inceledim
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
            onClick={requestClose}
          >
            Vazgeç
          </button>
          <button className="btn primary" disabled={busy || conflict} type="submit">
            <Save size={16} />
            {busy ? "Kaydediliyor…" : "Profili kaydet"}
          </button>
        </div>
      </form>
      )}
    </FormModal>
  );
}
