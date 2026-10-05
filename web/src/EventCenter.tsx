import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Clock3,
  FileJson,
  Info,
  Search,
  Upload,
} from "lucide-react";
import { api, ApiError } from "./api";
import FormModal from "./FormModal";
import ExportButton from "./ExportButton";
import {
  Badge,
  Empty,
  FormError,
  InlineError,
  LoadError,
  Loading,
  Modal,
  PageNavigation,
  SuccessNotice,
} from "./components";
import { demoConnections, demoEvents } from "./demoFixtures";
import {
  categoryLabels,
  contains,
  severityLabels,
  severityTone,
  timestamp,
  useOperationRefresh,
} from "./operations";
import type { Connection, OperationsProps, SecurityEvent } from "./operations";
import { useListSearch } from "./listSearch";
import { useAlive, useResource } from "./resource";
import { isConnectionCollection, isEventPageResponse } from "./responseShape";

type EventPage = { items: SecurityEvent[]; nextCursor: string };
export default function EventCenter({
  user,
  demo,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
  onDataChanged,
  onExportResult,
}: OperationsProps) {
  const [severity, setSeverity] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [importing, setImporting] = useState<Connection[] | null>(null);
  const [detail, setDetail] = useState<SecurityEvent | null>(null);
  const [notice, setNotice] = useState("");
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
  const sources = useResource<Connection[]>(
    "/connections",
    demo,
    demoConnections,
    onSessionExpired,
    isConnectionCollection,
  );
  const params = new URLSearchParams({
    limit: "50",
    severity,
    connectionId,
  });
  if (cursor) params.set("cursor", cursor);
  if (!demo && submittedSearch) params.set("q", submittedSearch);
  const eventPath = `/events?${params}`;
  const exportParams = new URLSearchParams();
  if (severity) exportParams.set("severity", severity);
  if (connectionId) exportParams.set("connectionId", connectionId);
  if (submittedSearch) exportParams.set("q", submittedSearch);
  const events = useResource<EventPage>(
    eventPath,
    demo,
    { items: demoEvents, nextCursor: "" },
    onSessionExpired,
    isEventPageResponse,
  );
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    sources.matchesRequest &&
      events.matchesRequest &&
      !sources.loading &&
      !events.loading,
    [sources.refresh, events.refresh],
  );
  const filtered =
    events.data?.items.filter(
      (e) =>
        !demo ||
        ((!severity || e.severity === severity) &&
          (!connectionId || e.connectionId === connectionId) &&
          contains(
            query,
            e.title,
            e.summary,
            e.subject,
            e.device,
            e.sourceIp,
            e.originProduct,
            e.externalId,
            e.originEventId,
          )),
    ) || [];
  const importConnections =
    sources.data?.filter(
      (c) => c.transport === "manual_json" && c.status === "configured",
    ) || [];
  return (
    <div className="operations-page">
      <div className="event-context">
        <div>
          <FileJson size={22} />
          <div>
            <strong>Kaynak olayları</strong>
            <p>
              Kimlik, ağ ve uç nokta olaylarını kaynak bilgisiyle inceleyin.
            </p>
          </div>
        </div>
        <div className="page-actions">
          <ExportButton
            path={`/events/export${exportParams.size ? `?${exportParams}` : ""}`}
            demo={demo}
            disabled={searchInvalid || searchPending}
            onSessionExpired={onSessionExpired}
            onResult={(result) => onExportResult?.(result)}
          />
          {user.role === "admin" && !demo && (
            <button
              className="btn primary"
              disabled={sources.loading || !!sources.error}
              onClick={() => setImporting(importConnections)}
            >
              <Upload size={16} /> JSON içe aktar
            </button>
          )}
        </div>
      </div>
      <div className="info-strip">
        <Info size={18} />
        <p>
          Bu sürümde yalnızca manuel aktarılan kayıtlar gösterilir. Olay önem
          derecesi kişi hakkında tehdit kararı vermez; varlık ilişkileri
          doğrulama bekler. Kaynaktan canlı toplama etkin değil.
        </p>
      </div>
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      <section className="panel event-panel">
        <div className="event-filters">
          <label>
            Önem derecesi
            <select
              value={severity}
              onChange={(e) => {
                setSeverity(e.target.value);
                resetPaging();
              }}
            >
              <option value="">Tüm dereceler</option>
              {Object.entries(severityLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Veri kaynağı
            <select
              value={connectionId}
              disabled={sources.loading || !!sources.error}
              onChange={(e) => {
                setConnectionId(e.target.value);
                resetPaging();
              }}
            >
              <option value="">Tüm bağlantılar</option>
              {sources.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="event-filter-caption">
            <Search size={16} />
            <span>
              {demo
                ? "Üst arama alanı önizleme kayıtlarında arar."
                : "Üst arama alanı tüm aktarılmış olaylarda arar (3–120 karakter)."}
            </span>
          </div>
        </div>
        {sources.error && (
          <InlineError
            message="Kaynak filtresi yüklenemedi."
            detail={sources.error}
            onRetry={() => void sources.refresh()}
          />
        )}
        {searchInvalid ? (
          <Empty
            title={
              searchTooShort ? "Arama için en az 3 karakter yazın" : "Arama çok uzun"
            }
          >
            {searchTooShort
              ? "Aramayı sürdürün veya temizleyerek tüm olayları gösterin."
              : "Arama ifadesini 120 karaktere kısaltın."}
          </Empty>
        ) : searchPending ? (
          <Loading label="Arama hazırlanıyor…" />
        ) : events.loading || !events.matchesRequest ? (
          <Loading label="Olaylar yükleniyor…" />
        ) : events.error ? (
          <LoadError
            message={events.error}
            onRetry={() => void events.refresh()}
          />
        ) : filtered.length ? (
          <div className="event-table-scroll">
            <table className="event-table">
              <thead>
                <tr>
                  <th scope="col">Önem / olay</th>
                  <th scope="col">Hesap ve cihaz</th>
                  <th scope="col">Kaynak</th>
                  <th scope="col">Olay zamanı</th>
                  <th scope="col">
                    <span className="sr-only">Ayrıntılar</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="event-title">
                        <Badge tone={severityTone[e.severity]}>
                          {severityLabels[e.severity]}
                        </Badge>
                        <button
                          className="table-link"
                          onClick={() => setDetail(e)}
                        >
                          {e.title}
                        </button>
                        <small>{categoryLabels[e.category]}</small>
                      </div>
                    </td>
                    <td>
                      <strong>{e.subject || "Hesap belirtilmedi"}</strong>
                      <small>{e.device || "Cihaz belirtilmedi"}</small>
                    </td>
                    <td>
                      <strong>
                        {sources.data?.find((c) => c.id === e.connectionId)
                          ?.name || e.connectionId}
                      </strong>
                      <small>
                        {e.originProduct || "Özgün ürün belirtilmedi"}
                      </small>
                    </td>
                    <td>
                      <time dateTime={e.occurredAt}>
                        {timestamp(e.occurredAt)}
                      </time>
                      <small>Manuel aktarım</small>
                    </td>
                    <td>
                      <button
                        className="icon-btn"
                        aria-label={`${e.title} ayrıntılarını aç`}
                        onClick={() => setDetail(e)}
                      >
                        <ArrowRight size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              severity || connectionId || query.trim()
                ? "Filtrelerle eşleşen olay yok"
                : "Henüz olay aktarılmadı"
            }
          >
            {severity || connectionId || query.trim()
              ? "Filtreleri veya arama ifadesini değiştirin."
              : "Önce manuel JSON taşıma yöntemiyle bir bağlantı profili oluşturun; ardından normalize edilmiş kayıtları içe aktarın. Boş liste kurumda tehdit olmadığı anlamına gelmez."}
          </Empty>
        )}
        {!searchInvalid &&
          !searchPending &&
          !events.loading &&
          events.matchesRequest &&
          !events.error && (
            <PageNavigation
              page={history.length + 1}
              count={filtered.length}
              caption={
                demo
                  ? "Sayı yalnız bu önizleme sayfasındaki eşleşmeleri gösterir."
                  : "Arama ve filtreler tüm aktarılmış olaylara uygulanır; sayı yalnız bu sayfadaki eşleşmelerdir, toplam değildir."
              }
              previousDisabled={!history.length}
              nextDisabled={!events.data?.nextCursor || demo}
              onPrevious={() => {
                setCursor(history.at(-1) || "");
                setHistory((values) => values.slice(0, -1));
              }}
              onNext={() => {
                setHistory((values) => [...values, cursor]);
                setCursor(events.data!.nextCursor);
              }}
            />
          )}
      </section>
      {detail && (
        <Modal
          title="Olay ayrıntıları"
          subtitle="Kaynak bağlamı ve aktarım bilgileri"
          onClose={() => setDetail(null)}
          wide
        >
          <div className="event-detail-body">
            <div className="event-detail-title">
              <Badge tone={severityTone[detail.severity]}>
                {severityLabels[detail.severity]}
              </Badge>
              <h3>{detail.title}</h3>
              <p>{detail.summary || "Özet bulunmuyor."}</p>
            </div>
            <dl className="event-facts">
              <div>
                <dt>Kategori</dt>
                <dd>{categoryLabels[detail.category]}</dd>
              </div>
              <div>
                <dt>Olay zamanı</dt>
                <dd>{timestamp(detail.occurredAt)}</dd>
              </div>
              <div>
                <dt>Alınma zamanı</dt>
                <dd>{timestamp(detail.receivedAt)}</dd>
              </div>
              <div>
                <dt>Bağlantı</dt>
                <dd>
                  {sources.data?.find((c) => c.id === detail.connectionId)
                    ?.name || detail.connectionId}
                </dd>
              </div>
              <div>
                <dt>Hesap / özne</dt>
                <dd>{detail.subject || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Cihaz</dt>
                <dd>{detail.device || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Kaynak IP</dt>
                <dd>{detail.sourceIp || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Özgün ürün</dt>
                <dd>{detail.originProduct || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Özgün olay kimliği</dt>
                <dd>{detail.originEventId || "Belirtilmedi"}</dd>
              </div>
              <div>
                <dt>Aktarım kayıt kimliği</dt>
                <dd>{detail.externalId}</dd>
              </div>
              <div>
                <dt>Varlık ilişkisi</dt>
                <dd>
                  {detail.identityState === "candidate"
                    ? `Aday eşleşme · ${detail.entityId}`
                    : "Varlıkla ilişkilendirilmedi"}
                </dd>
              </div>
              <div>
                <dt>Veri kökeni</dt>
                <dd>Manuel içe aktarım</dd>
              </div>
            </dl>
            <div className="info-strip">
              <Clock3 size={18} />
              <p>
                Bu kayıt gerçek zamanlı kaynak bağlantısını veya doğrulanmış
                personel eşleşmesini kanıtlamaz. İnceleme üyelikleri ayrıca
                gerekçe ve sorumlu belirtilerek yönetilir.
              </p>
            </div>
          </div>
        </Modal>
      )}
      {importing && !demo && (
        <ImportEvents
          demo={demo}
          connections={importing}
          onSessionExpired={onSessionExpired}
          onClose={() => setImporting(null)}
          onSaved={(accepted, duplicates) => {
            onDataChanged?.();
            setImporting(null);
            setNotice(
              `${accepted} olay eklendi, ${duplicates} yinelenen kayıt atlandı.`,
            );
            if (!cursor) void events.refresh();
            resetPaging();
            void sources.refresh();
          }}
        />
      )}
    </div>
  );
}

function ImportEvents({
  demo,
  connections,
  onClose,
  onSaved,
  onSessionExpired,
}: {
  demo: boolean;
  connections: Connection[];
  onClose: () => void;
  onSaved: (accepted: number, duplicates: number) => void;
  onSessionExpired: () => void;
}) {
  const alive = useAlive();
  const [json, setJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (demo || busy) return;
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
      if (!Array.isArray(parsed) || !parsed.length || parsed.length > 100)
        throw new Error(
          "Bir ile 100 arasında olay içeren bir JSON dizisi girin.",
        );
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? "JSON biçimi geçersiz. Tırnakları ve virgülleri kontrol edin."
          : (err as Error).message,
      );
      return;
    }
    const connectionId = new FormData(event.currentTarget).get("connectionId");
    setBusy(true);
    try {
      const result = await api<{ accepted: number; duplicates: number }>(
        "/events/import",
        "POST",
        { connectionId, events: parsed },
      );
      if (alive.current) onSaved(result.accepted, result.duplicates);
    } catch (err) {
      if (alive.current) {
        setError((err as Error).message);
        if (err instanceof ApiError && err.status === 401) onSessionExpired();
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <FormModal
      title="Olayları JSON ile içe aktar"
      subtitle="Normalize edilmiş olaylar · En fazla 100 kayıt"
      onClose={onClose}
      closeDisabled={busy}
      wide
    >
      {(requestClose) => (
      <>
      {connections.length ? (
        <form className="editor-form" onSubmit={submit}>
          <fieldset disabled={busy || demo}>
            <label>
              Hedef bağlantı
              <select name="connectionId" required>
                {connections.map((c) => (
                  <option value={c.id} key={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="import-help">
              <p>
                Gerekli alanlar: <code>externalId</code>,{" "}
                <code>occurredAt</code> (ISO tarih), <code>category</code>,{" "}
                <code>severity</code>, <code>title</code>. E-posta/mesaj içeriği
                veya ham log eklemeyin. Yalnızca kaynağınızdan alınmış olayları
                içe aktarın.
              </p>
            </div>
            <label>
              Olay dizisi
              <textarea
                className="json-input"
                value={json}
                onChange={(e) => setJson(e.target.value)}
                rows={12}
                required
                spellCheck={false}
                placeholder="Kaynağınızdan alınmış olayları JSON dizisi olarak yapıştırın"
              />
            </label>
            <p className="field-help">
              Aynı bağlantıdaki aynı externalId yeniden eklenmez. Varlık kimliği
              verirseniz ilişki aday olarak tutulur. Yüksek/kritik olaylar
              uygulama içi bildirim oluşturur.
            </p>
            {error && <FormError>{error}</FormError>}
          </fieldset>
          <div className="modal-actions">
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={requestClose}
            >
              Vazgeç
            </button>
            <button
              className="btn primary"
              disabled={busy || demo || !json.trim()}
              type="submit"
            >
              <Upload size={16} />
              {busy ? "Aktarılıyor…" : "Kayıtları içe aktar"}
            </button>
          </div>
        </form>
      ) : (
        <div className="event-detail-body">
          <Empty title="Manuel aktarım bağlantısı gerekli">
            Veri kaynakları sayfasında taşıma yöntemi “Manuel JSON aktarımı”
            olan etkin bir profil oluşturun. Duraklatılmış profiller içe aktarım
            kabul etmez.
          </Empty>
          <div className="modal-actions">
            <button className="btn secondary" onClick={requestClose}>
              Kapat
            </button>
          </div>
        </div>
      )}
      </>
      )}
    </FormModal>
  );
}
