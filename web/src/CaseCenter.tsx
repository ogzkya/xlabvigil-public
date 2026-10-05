import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { FolderKanban, Pencil, Plus, Save } from "lucide-react";
import { api } from "./api";
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
import FormModal from "./FormModal";
import ExportButton from "./ExportButton";
import type { ExportResult } from "./ExportButton";
import CaseActivity, { CaseDraftFeedback } from "./CaseActivity";
import CaseEvidence from "./CaseEvidence";
import { useResource } from "./resource";
import { useListSearch } from "./listSearch";
import { contains, useOperationRefresh } from "./operations";
import { formatTimestampUTC } from "./dateTime";
import {
  isCaseActionWriteResult,
  isCasePageResponse,
  isCaseRecord,
  isCaseWriteRecord,
} from "./caseResponses";
import {
  caseActionLabels,
  caseStatusLabels,
  demoCases,
  useCaseDraft,
  validCaseText,
} from "./cases";
import type {
  CaseAction,
  CaseActionResult,
  CasePage,
  ReviewCase,
} from "./cases";

export type CaseCenterProps = {
  demo: boolean;
  query: string;
  onSessionExpired: () => void;
  refreshToken: number;
  onRefreshComplete: (token: number) => void;
  onExportResult?: (result: ExportResult) => void;
};
export default function CaseCenter({
  demo,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
  onExportResult,
}: CaseCenterProps) {
  const [status, setStatus] = useState<"all" | "open" | "closed">("open");
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ReviewCase | null>(null);
  const [notice, setNotice] = useState("");
  const search = useListSearch(query, demo, () => {
    setCursor("");
    setHistory([]);
  });
  const params = new URLSearchParams({ status, limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (!demo && search.submittedSearch) params.set("q", search.submittedSearch);
  const exportParams = new URLSearchParams({ status });
  if (search.submittedSearch) exportParams.set("q", search.submittedSearch);
  const resource = useResource<CasePage<ReviewCase>>(
    `/cases?${params}`,
    demo,
    { items: demoCases, nextCursor: "" },
    onSessionExpired,
    isCasePageResponse,
  );
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    resource.matchesRequest && !resource.loading,
    [resource.refresh],
  );
  useEffect(() => {
    if (!resource.matchesRequest || resource.loading || resource.error) return;
    setSelected((current) => {
      const latest = resource.data?.items.find(
        (item) => item.id === current?.id,
      );
      return current && latest && latest.version >= current.version
        ? latest
        : current;
    });
  }, [
    resource.data,
    resource.matchesRequest,
    resource.loading,
    resource.error,
  ]);
  const items = (resource.data?.items || []).filter(
    (item) =>
      !demo ||
      ((status === "all" || item.status === status) &&
        contains(query, item.title, item.summary, item.responsible)),
  );
  const ready =
    resource.matchesRequest &&
    !resource.loading &&
    !resource.error &&
    !search.invalid &&
    !search.pending;
  function changed(value: ReviewCase) {
    setSelected((current) =>
      current?.id === value.id && current.version <= value.version
        ? value
        : current,
    );
    // Starting a new generation discards GETs begun before the write response.
    void resource.refresh();
  }
  return (
    <div className="operations-page case-center">
      <div className="event-context">
        <div>
          <FolderKanban size={22} aria-hidden="true" />
          <div>
            <strong>Gerekçeli inceleme dosyaları</strong>
            <p>
              Özet, sorumlu, kaynak olayları ve işlem geçmişini aynı dosyada
              tutun.
            </p>
          </div>
        </div>
        <div className="page-actions">
          <ExportButton
            path={`/cases/export?${exportParams}`}
            demo={demo}
            disabled={search.invalid || search.pending}
            onSessionExpired={onSessionExpired}
            onResult={(result) => onExportResult?.(result)}
          />
        {!demo && (
          <button
            className="btn primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            <Plus size={16} aria-hidden="true" /> Dosya oluştur
          </button>
        )}
        </div>
      </div>
      <div className="info-strip">
        <p>
          Dosyalar insan değerlendirmesini kaydeder. Sorumlu alanı erişim
          yetkisi vermez; kapatma ve yeniden açma hesap, grup veya ağ erişimini
          değiştirmez.
        </p>
      </div>
      {demo && (
        <p className="field-help">
          Kurgusal önizleme salt okunurdur; dosya, not veya olay ilişkisi
          kaydedilmez.
        </p>
      )}
      {notice && <SuccessNotice>{notice}</SuccessNotice>}
      <section className="panel case-list-panel">
        <div className="case-filters" role="group" aria-label="Dosya durumu">
          {(["open", "closed", "all"] as const).map((value) => (
            <button
              className={`filter-btn ${status === value ? "selected" : ""}`}
              type="button"
              aria-pressed={status === value}
              key={value}
              onClick={() => {
                setStatus(value);
                setCursor("");
                setHistory([]);
              }}
            >
              {value === "all" ? "Tümü" : caseStatusLabels[value]}
            </button>
          ))}
        </div>
        {search.invalid ? (
          <Empty title="Arama ifadesini düzenleyin">
            Tüm dosyalarda arama için 3–120 karakter kullanın.
          </Empty>
        ) : search.pending ? (
          <Loading label="Dosya araması hazırlanıyor…" />
        ) : resource.loading || !resource.matchesRequest ? (
          <Loading label="İnceleme dosyaları yükleniyor…" />
        ) : resource.error ? (
          <LoadError
            title="İnceleme dosyaları alınamadı"
            message={resource.error}
            onRetry={() => void resource.refresh()}
          />
        ) : items.length ? (
          <ul className="case-list">
            {items.map((item) => (
              <li key={item.id}>
                <div className="case-section-heading">
                  <button
                    className="table-link"
                    type="button"
                    onClick={() => setSelected(item)}
                  >
                    {item.title}
                  </button>
                  <Badge tone={item.status === "open" ? "neutral" : "teal"}>
                    {caseStatusLabels[item.status]}
                  </Badge>
                </div>
                <p>{item.summary}</p>
                <div className="case-meta">
                  <span>Sorumlu: {item.responsible}</span>
                  <span>Son işlem: {formatTimestampUTC(item.updatedAt)}</span>
                </div>
                {demo && <Badge tone="neutral">Kurgusal örnek</Badge>}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Bu kapsamda inceleme dosyası yok">
            {demo
              ? "Durum filtresini veya aramayı değiştirerek kurgusal dosyayı inceleyebilirsiniz. Demo salt okunurdur."
              : "Durum filtresini veya aramayı değiştirin; yeni bir inceleme için dosya oluşturun."}
          </Empty>
        )}
        {ready && (
          <PageNavigation
            page={history.length + 1}
            count={items.length}
            caption="Yalnız dönen sayfa gösterilir; sayı tüm dosyaların toplamı değildir."
            previousDisabled={!history.length}
            nextDisabled={demo || !resource.data?.nextCursor}
            onPrevious={() => {
              setCursor(history.at(-1) || "");
              setHistory((values) => values.slice(0, -1));
            }}
            onNext={() => {
              setHistory((values) => [...values, cursor]);
              setCursor(resource.data!.nextCursor);
            }}
          />
        )}
      </section>
      {creating && (
        <CaseEditor
          demo={demo}
          onSessionExpired={onSessionExpired}
          onChanged={changed}
          onClose={() => setCreating(false)}
          onSaved={(value) => {
            setCreating(false);
            setSelected(value);
            setNotice("İnceleme dosyası oluşturuldu.");
          }}
        />
      )}
      {selected && (
        <CaseDetail
          key={`${demo}:${selected.id}`}
          record={selected}
          demo={demo}
          onSessionExpired={onSessionExpired}
          refreshToken={refreshToken}
          onChanged={changed}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CaseDetail({
  record,
  demo,
  onSessionExpired,
  refreshToken,
  onChanged,
  onClose,
}: {
  record: ReviewCase;
  demo: boolean;
  onSessionExpired: () => void;
  refreshToken: number;
  onChanged: (value: ReviewCase) => void;
  onClose: () => void;
}) {
  const [displayed, setDisplayed] = useState(record);
  const [editing, setEditing] = useState(false);
  const [action, setAction] = useState<CaseAction | null>(null);
  const [notice, setNotice] = useState("");
  const detail = useResource<ReviewCase>(
    `/cases/${encodeURIComponent(record.id)}`,
    demo,
    record,
    onSessionExpired,
    (value) => isCaseRecord(value) && value.id === record.id,
  );
  const identity = useRef(refreshToken);
  useEffect(() => {
    if (identity.current !== refreshToken) {
      identity.current = refreshToken;
      void detail.refresh();
    }
  }, [refreshToken, detail.refresh]);
  useEffect(() => {
    setDisplayed((current) =>
      record.version >= current.version ? record : current,
    );
  }, [record]);
  useEffect(() => {
    if (detail.matchesRequest && detail.data)
      setDisplayed((current) =>
        detail.data!.version >= current.version ? detail.data! : current,
      );
  }, [detail.data, detail.matchesRequest]);
  const blocked = !detail.matchesRequest || detail.loading || !!detail.error;
  function changed(value: ReviewCase) {
    setDisplayed((current) =>
      value.version >= current.version ? value : current,
    );
    onChanged(value);
    void detail.refresh();
  }
  return (
    <>
      <Modal
        title={displayed.title}
        subtitle="İnsan incelemesi · Kaynak ve kimlik doğrulaması içermez"
        onClose={onClose}
        wide
      >
        <div className="detail-body case-detail">
          <div className="case-section-heading">
            <Badge tone={displayed.status === "open" ? "neutral" : "teal"}>
              {caseStatusLabels[displayed.status]}
            </Badge>
            <span className="case-meta">Sürüm {displayed.version}</span>
          </div>
          {detail.loading || !detail.matchesRequest ? (
            <Loading label="Güncel dosya bilgileri yükleniyor…" />
          ) : (
            detail.error && (
              <InlineError
                message="Güncel dosya alınamadı; yazma işlemleri durduruldu."
                detail={detail.error}
                onRetry={() => void detail.refresh()}
              />
            )
          )}
          <h3>İnceleme özeti</h3>
          <p className="case-reason">{displayed.summary}</p>
          <dl className="case-facts">
            <div>
              <dt>Sorumlu</dt>
              <dd>{displayed.responsible}</dd>
            </div>
            <div>
              <dt>Oluşturan</dt>
              <dd>{displayed.createdBy}</dd>
            </div>
            <div>
              <dt>Oluşturulma (UTC)</dt>
              <dd>{formatTimestampUTC(displayed.createdAt)}</dd>
            </div>
            <div>
              <dt>Son işlem (UTC)</dt>
              <dd>{formatTimestampUTC(displayed.updatedAt)}</dd>
            </div>
          </dl>
          {displayed.status === "closed" && (
            <div className="case-snapshot">
              <strong>
                Kapatma gerekçesi · {formatTimestampUTC(displayed.closedAt!)}
              </strong>
              <p className="case-reason">{displayed.closureReason}</p>
            </div>
          )}
          {notice && <SuccessNotice>{notice}</SuccessNotice>}
          {!demo && (
            <div className="case-detail-actions">
              {displayed.status === "open" ? (
                <>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={blocked}
                    onClick={() => setEditing(true)}
                  >
                    <Pencil size={16} aria-hidden="true" /> Bilgileri düzenle
                  </button>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={blocked}
                    onClick={() => setAction("note")}
                  >
                    İnceleme notu ekle
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={blocked}
                    onClick={() => setAction("close")}
                  >
                    Dosyayı kapat
                  </button>
                </>
              ) : (
                <button
                  className="btn secondary"
                  type="button"
                  disabled={blocked}
                  onClick={() => setAction("reopen")}
                >
                  Gerekçeyle yeniden aç
                </button>
              )}
            </div>
          )}
          {demo && (
            <p className="field-help">
              Salt okunur kurgusal dosya; kararlar kaydedilemez.
            </p>
          )}
          <CaseEvidence
            record={displayed}
            demo={demo}
            onSessionExpired={onSessionExpired}
            refreshToken={refreshToken}
            onChanged={changed}
            writeBlocked={blocked}
          />
          <CaseActivity
            record={displayed}
            demo={demo}
            onSessionExpired={onSessionExpired}
            refreshToken={refreshToken}
          />
        </div>
        <footer className="modal-actions">
          <button className="btn secondary" type="button" onClick={onClose}>
            Kapat
          </button>
        </footer>
      </Modal>
      {editing && (
        <CaseEditor
          record={displayed}
          demo={demo}
          onSessionExpired={onSessionExpired}
          onChanged={changed}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice("Dosya bilgileri kaydedildi.");
          }}
          writeBlocked={blocked}
        />
      )}
      {action && (
        <CaseActionForm
          action={action}
          record={displayed}
          demo={demo}
          onSessionExpired={onSessionExpired}
          onChanged={changed}
          onClose={() => setAction(null)}
          writeBlocked={blocked}
          onSaved={() => {
            setAction(null);
            setNotice(
              action === "close"
                ? "Dosya gerekçeyle kapatıldı."
                : action === "reopen"
                  ? "Dosya gerekçeyle yeniden açıldı."
                  : "İnceleme notu kaydedildi.",
            );
          }}
        />
      )}
    </>
  );
}

function CaseEditor({
  record,
  demo,
  onSessionExpired,
  onChanged,
  onClose,
  onSaved,
  writeBlocked = false,
}: {
  record?: ReviewCase;
  demo: boolean;
  onSessionExpired: () => void;
  onChanged: (value: ReviewCase) => void;
  onClose: () => void;
  onSaved: (value: ReviewCase) => void;
  writeBlocked?: boolean;
}) {
  const [draftId] = useState(() => record?.id || crypto.randomUUID());
  const [initial] = useState<ReviewCase>(
    () =>
      record || {
        id: draftId,
        title: "",
        summary: "",
        responsible: "",
        status: "open",
        version: 0,
        createdAt: "",
        updatedAt: "",
        createdById: "",
        createdBy: "",
        closedAt: null,
        closureReason: "",
      },
  );
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [responsible, setResponsible] = useState(initial.responsible);
  const draft = useCaseDraft(
    record || initial,
    demo,
    onSessionExpired,
    onChanged,
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      writeBlocked ||
      draft.baseline.status === "closed" ||
      (!record && draft.baseline.version > 0)
    )
      return;
    if (
      !validCaseText(title, 3, 160) ||
      !validCaseText(summary, 10, 2000) ||
      !validCaseText(responsible, 2, 100)
    ) {
      draft.setError(
        "Başlık 3–160, özet 10–2000 ve sorumlu 2–100 karakter olmalıdır.",
      );
      return;
    }
    let saved: ReviewCase | null = null;
    const success = await draft.run(async (baseline) => {
      saved = await api<ReviewCase>(
        record ? `/cases/${encodeURIComponent(draftId)}` : "/cases",
        record ? "PATCH" : "POST",
        {
          title: title.trim(),
          summary: summary.trim(),
          responsible: responsible.trim(),
          ...(record ? { expectedVersion: baseline.version } : { id: draftId }),
        },
        (value) =>
          record
            ? isCaseWriteRecord(value, draftId, baseline.version)
            : isCaseRecord(value) && value.id === draftId,
      );
      return saved;
    });
    if (success && saved) onSaved(saved);
  }
  return (
    <FormModal
      title={record ? "Dosya bilgilerini düzenle" : "İnceleme dosyası oluştur"}
      subtitle={
        record
          ? `Esas alınan sürüm ${draft.baseline.version}`
          : "Özet ve sorumluyla gerekçeli inceleme başlatın."
      }
      onClose={onClose}
      closeDisabled={draft.pending}
    >
      {(requestClose) => (
        <form
          className="editor-form"
          onSubmit={(event) => void submit(event)}
          aria-busy={draft.pending}
        >
          <fieldset disabled={draft.pending}>
            <label>
              Başlık
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                minLength={3}
                maxLength={320}
              />
              <span className="field-help">
                3–160 karakter · {Array.from(title.trim()).length} karakter.
              </span>
            </label>
            <label>
              İnceleme özeti
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                required
                minLength={10}
                maxLength={4000}
                rows={4}
              />
              <span className="field-help">
                10–2000 karakter · {Array.from(summary.trim()).length} karakter.
              </span>
            </label>
            <label>
              Sorumlu
              <input
                value={responsible}
                onChange={(event) => setResponsible(event.target.value)}
                required
                minLength={2}
                maxLength={200}
              />
              <span className="field-help">
                2–100 karakter. Kayıt amaçlı kişi veya ekip adıdır; erişim
                yetkisi vermez.
              </span>
            </label>
            {writeBlocked && (
              <FormError>
                Güncel dosya yüklenene kadar kaydetme durduruldu. Alanlarınız
                korunuyor.
              </FormError>
            )}
            {draft.baseline.status === "closed" && (
              <FormError>
                Dosya kapalı. Düzenleme taslağı korunuyor; bilgileri
                değiştirmeden önce dosya gerekçeyle yeniden açılmalıdır.
              </FormError>
            )}
            <CaseDraftFeedback draft={draft} />
            {!record && draft.baseline.version > 0 && (
              <p className="field-help">
                Bu oluşturma isteğinin kimliğiyle bir dosya bulunuyor. Taslağı
                kapatıp listedeki mevcut dosyayı inceleyin; yeniden oluşturma
                durduruldu.
              </p>
            )}
          </fieldset>
          <footer className="modal-actions">
            <button
              className="btn secondary"
              type="button"
              disabled={draft.pending}
              onClick={requestClose}
            >
              Vazgeç
            </button>
            <button
              className="btn primary"
              type="submit"
              disabled={
                demo ||
                writeBlocked ||
                draft.pending ||
                draft.needsReload ||
                draft.baseline.status === "closed" ||
                (!record && draft.baseline.version > 0)
              }
            >
              <Save size={16} aria-hidden="true" />
              {draft.pending
                ? "Kaydediliyor…"
                : record
                  ? "Bilgileri kaydet"
                  : "Dosyayı oluştur"}
            </button>
          </footer>
        </form>
      )}
    </FormModal>
  );
}

function CaseActionForm({
  action,
  record,
  demo,
  onSessionExpired,
  onChanged,
  onClose,
  onSaved,
  writeBlocked,
}: {
  action: CaseAction;
  record: ReviewCase;
  demo: boolean;
  onSessionExpired: () => void;
  onChanged: (value: ReviewCase) => void;
  onClose: () => void;
  onSaved: () => void;
  writeBlocked: boolean;
}) {
  const [reason, setReason] = useState("");
  const draft = useCaseDraft(record, demo, onSessionExpired, onChanged);
  const statusAllowsAction =
    action === "reopen"
      ? draft.baseline.status === "closed"
      : draft.baseline.status === "open";
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (writeBlocked || !statusAllowsAction) return;
    if (!validCaseText(reason, 10, 2000)) {
      draft.setError("Gerekçe 10–2000 karakter olmalıdır.");
      return;
    }
    const success = await draft.run(async (baseline) => {
      const result = await api<CaseActionResult>(
        `/cases/${encodeURIComponent(baseline.id)}/actions`,
        "POST",
        { action, reason: reason.trim(), expectedVersion: baseline.version },
        (value) =>
          isCaseActionWriteResult(value, baseline.id, baseline.version) &&
          value.activity.action ===
            ({ note: "noted", close: "closed", reopen: "reopened" } as const)[
              action
            ],
      );
      return result.case;
    });
    if (success) onSaved();
  }
  return (
    <FormModal
      title={caseActionLabels[action]}
      subtitle={`Esas alınan dosya · Sürüm ${draft.baseline.version}`}
      onClose={onClose}
      closeDisabled={draft.pending}
    >
      {(requestClose) => (
        <form
          className="editor-form"
          onSubmit={(event) => void submit(event)}
          aria-busy={draft.pending}
        >
          <fieldset disabled={draft.pending}>
            <label>
              {action === "note" ? "İnceleme notu" : "Kararın gerekçesi"}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={10}
                maxLength={4000}
                rows={5}
              />
              <span className="field-help">
                10–2000 karakter. Notlar ve karar gerekçeleri işlem geçmişinde
                saklanır.
              </span>
            </label>
            <p className="field-help">
              {action === "close"
                ? "Dosya kapatılır ve salt okunur hale gelir. Gerekçe ve olay ilişkileri saklanır."
                : action === "reopen"
                  ? "Dosya yeni gerekçeyle tekrar incelemeye açılır; geçmiş kapatma kararı korunur."
                  : "Bu not dosyanın durumunu değiştirmez."}{" "}
              Hesap, grup veya ağ erişimi değişmez.
            </p>
            {writeBlocked && (
              <FormError>
                Güncel dosya alınana kadar gönderme durduruldu; taslak
                korunuyor.
              </FormError>
            )}
            {!statusAllowsAction && (
              <FormError>
                Güncel dosya durumu bu işleme izin vermiyor. Gerekçeniz
                korunuyor.
              </FormError>
            )}
            <CaseDraftFeedback draft={draft} />
          </fieldset>
          <footer className="modal-actions">
            <button
              className="btn secondary"
              type="button"
              disabled={draft.pending}
              onClick={requestClose}
            >
              Vazgeç
            </button>
            <button
              className="btn primary"
              type="submit"
              disabled={
                demo ||
                writeBlocked ||
                draft.pending ||
                draft.needsReload ||
                !statusAllowsAction
              }
            >
              {draft.pending ? "Kaydediliyor…" : caseActionLabels[action]}
            </button>
          </footer>
        </form>
      )}
    </FormModal>
  );
}
