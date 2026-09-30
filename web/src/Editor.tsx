import { useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle, Save, Trash2, Info } from "lucide-react";
import { api, ApiError } from "./api";
import { FormError, Modal } from "./components";
import { useAlive } from "./resource";
import { isEntityCollection, isGroupCollection, isMembershipRecord } from "./responseShape";
import WorkspaceRefreshNotice from "./WorkspaceRefreshNotice";
import { colorLabels, entityLabels, utcToday } from "./types";
import type { EditorState, Entity, EntityKind, Group, Membership, Workspace } from "./types";

type CurrentRecord = Entity | Group | Membership;

function currentRecordFields(record: CurrentRecord): [string, string][] {
  if ("kind" in record) return [
    ["Tür", entityLabels[record.kind]],
    ["Ad", record.name],
    ["Birim", record.department],
    ["Tanımlayıcı", record.identifier],
    ["İlişkili personel", record.personId],
    ["Açıklama", record.description],
  ];
  if ("color" in record) return [
    ["Ad", record.name],
    ["Öncelik", colorLabels[record.color]],
    ["Kapsam", record.description],
  ];
  return [
    ["Gerekçe", record.reason],
    ["Sorumlu", record.responsible],
    ["Başlangıç", record.startsOn],
    ["Bitiş", record.endsOn],
    ["Gözden geçirme", record.reviewOn],
    ["Durum", record.status === "closed" ? "Kapatıldı" : "Açık"],
  ];
}

export default function Editor({
  editor,
  workspace,
  onClose,
  onSaved,
  onSessionExpired,
  workspaceRefresh,
  writeBlocked = false,
}: {
  editor: EditorState;
  workspace: Workspace;
  onClose: () => void;
  onSaved: () => void;
  onSessionExpired: () => void;
  workspaceRefresh: { loading: boolean; error: string; onRetry: () => void };
  writeBlocked?: boolean;
}) {
  const alive = useAlive();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [expectedVersion, setExpectedVersion] = useState(editor.value?.version ?? 0);
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [currentRecord, setCurrentRecord] = useState<CurrentRecord | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [entityKind, setEntityKind] = useState<EntityKind>(
    editor.kind === "entity" ? editor.value?.kind || "person" : "person",
  );
  const [startsOn, setStartsOn] = useState(
    editor.kind === "membership"
      ? editor.value?.startsOn || utcToday()
      : utcToday(),
  );
  const [endsOn, setEndsOn] = useState(
    editor.kind === "membership" ? editor.value?.endsOn || "" : "",
  );
  const [memberStatus, setMemberStatus] = useState(
    editor.kind === "membership" ? editor.value?.status || "active" : "active",
  );
  const title = {
    entity: "Varlık",
    group: "İzleme grubu",
    membership: "Grup üyeliği",
  }[editor.kind];
  const path = {
    entity: "/entities",
    group: "/groups",
    membership: "/memberships",
  }[editor.kind];
  const close = () => {
    if (!busy && !reloading) onClose();
  };
  async function reloadCurrentRecord() {
    if (!editor.value || reloading) return;
    setReloading(true);
    setError("");
    setCurrentRecord(null);
    try {
      let current: CurrentRecord | undefined;
      if (editor.kind === "membership") {
        current = await api<Membership>(`${path}/${encodeURIComponent(editor.value.id)}`, "GET", undefined, isMembershipRecord);
      } else if (editor.kind === "entity") {
        current = (await api<Entity[]>(path, "GET", undefined, isEntityCollection)).find((item) => item.id === editor.value?.id);
      } else {
        current = (await api<Group[]>(path, "GET", undefined, isGroupCollection)).find((item) => item.id === editor.value?.id);
      }
      if (!alive.current) return;
      if (!current) {
        setError("Kayıt güncel listede bulunamadı. Taslağınız korundu; kaydetmeden önce listeyi yenileyin.");
        return;
      }
      if (!Number.isSafeInteger(current.version) || current.version < 1) {
        setError("Güncel kayıt sürümü doğrulanamadı. Taslağınız korundu; yeniden yüklemeyi deneyin.");
        return;
      }
      setCurrentRecord(current);
    } catch (failure) {
      if (!alive.current) return;
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        onSessionExpired();
        return;
      }
      setError((failure as Error).message || "Güncel kayıt yüklenemedi. Taslağınız korundu.");
    } finally {
      if (alive.current) setReloading(false);
    }
  }
  function acceptCurrentRecord() {
    if (!currentRecord || reloading) return;
    setExpectedVersion(currentRecord.version);
    setCurrentRecord(null);
    setConflict(false);
    setConfirmDelete(false);
    setError("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || writeBlocked || conflict || reloading) return;
    const form = new FormData(event.currentTarget);
    const get = (key: string) => String(form.get(key) || "").trim();
    let body: Record<string, unknown>;
    if (editor.kind === "entity")
      body = {
        kind: get("kind"),
        name: get("name"),
        department: get("department"),
        description: get("description"),
        identifier: get("identifier"),
        personId:
          entityKind === "account" || entityKind === "device"
            ? get("personId")
            : "",
      };
    else if (editor.kind === "group")
      body = {
        name: get("name"),
        description: get("description"),
        color: get("color"),
      };
    else
      body = {
        entityId: editor.value?.entityId || get("entityId"),
        groupId: editor.value?.groupId || get("groupId"),
        reason: get("reason"),
        responsible: get("responsible"),
        startsOn: get("startsOn"),
        endsOn: get("endsOn"),
        reviewOn: get("reviewOn"),
        status: get("status"),
      };
    if (editor.value) body.expectedVersion = expectedVersion;
    setBusy(true);
    setError("");
    try {
      await api(
        `${path}${editor.value ? `/${editor.value.id}` : ""}`,
        editor.value ? "PATCH" : "POST",
        body,
      );
      if (alive.current) onSaved();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 401) {
        onSessionExpired();
        return;
      }
      if (e instanceof ApiError && (e.code === "stale_write" || e.code === "concurrent_write")) {
        setConflict(true);
        setCurrentRecord(null);
        setConfirmDelete(false);
        setError(`${e.message} Taslağınız korundu. Güncel kaydı yükleyip değişiklikleri inceleyin.`);
        return;
      }
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function remove() {
    if (!editor.value || busy || writeBlocked || conflict || reloading) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(`${path}/${editor.value.id}`, "DELETE", {
        expectedVersion,
      });
      if (alive.current) onSaved();
    } catch (e) {
      if (!alive.current) return;
      if (e instanceof ApiError && e.status === 401) {
        onSessionExpired();
        return;
      }
      if (e instanceof ApiError && (e.code === "stale_write" || e.code === "concurrent_write")) {
        setConflict(true);
        setCurrentRecord(null);
        setConfirmDelete(false);
        setError(`${e.message} Güncel kaydı yükleyip silme kararını yeniden inceleyin.`);
        return;
      }
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  const value = editor.value;
  return (
    <Modal
      title={`${title} ${value ? "düzenle" : "ekle"}`}
      subtitle={
        editor.kind === "membership"
          ? "Gerekçeli, sorumlusu ve süresi belirli inceleme üyeliği."
          : "Manuel kayıt · Kaynak doğrulaması yapılmadı"
      }
      onClose={close}
    >
      <form className="editor-form" onSubmit={submit}>
        <WorkspaceRefreshNotice {...workspaceRefresh} />
        <fieldset disabled={busy}>
          {editor.kind === "entity" && (
            <>
              <div className="form-grid">
                <label>
                  Varlık türü
                  <select
                    name="kind"
                    value={entityKind}
                    onChange={(e) =>
                      setEntityKind(e.target.value as EntityKind)
                    }
                  >
                    {Object.entries(entityLabels).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {entityKind === "person" ? "Ad soyad" : "Ad"}
                  <input
                    name="name"
                    defaultValue={editor.value?.name}
                    required
                    minLength={2}
                    maxLength={160}
                    autoComplete="off"
                    placeholder={
                      entityKind === "person"
                        ? "Personelin adı ve soyadı"
                        : "Varlığın görünen adı"
                    }
                  />
                </label>
              </div>
              <label>
                Birim
                <input
                  name="department"
                  defaultValue={editor.value?.department}
                  maxLength={160}
                  placeholder="Örn. Bilgi Teknolojileri"
                />
              </label>
              <label>
                Kimlik / kaynak tanımlayıcısı
                <input
                  name="identifier"
                  defaultValue={editor.value?.identifier}
                  maxLength={512}
                  spellCheck={false}
                  placeholder="Örn. kurum\\kullanici, cihaz veya personel kodu"
                />
              </label>
              <p className="field-help">
                Bu değer manuel bir aday eşleşmedir. AD kimliği ve hesap
                sahipliği henüz doğrulanmaz.
              </p>
              {(entityKind === "account" || entityKind === "device") && (
                <label>
                  İlişkili personel
                  <select
                    name="personId"
                    defaultValue={editor.value?.personId || ""}
                  >
                    <option value="">
                      İlişkilendirilmedi / paylaşılan varlık
                    </option>
                    {workspace.entities
                      .filter((e) => e.kind === "person")
                      .map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                  </select>
                  <span className="field-help">
                    İlişki, olayın kesin olarak bu kişi tarafından
                    gerçekleştirildiğini kanıtlamaz.
                  </span>
                </label>
              )}
              <label>
                Açıklama
                <textarea
                  name="description"
                  defaultValue={editor.value?.description}
                  maxLength={4000}
                  rows={4}
                  placeholder="Kayıt ve ilişkilendirme hakkında açıklama"
                />
              </label>
            </>
          )}
          {editor.kind === "group" && (
            <>
              <label>
                Grup adı
                <input
                  name="name"
                  defaultValue={editor.value?.name}
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="Örn. Sarı liste veya ayrıcalıklı hesaplar"
                />
              </label>
              <label>
                Renk / inceleme önceliği
                <select
                  name="color"
                  defaultValue={editor.value?.color || "yellow"}
                >
                  {Object.entries(colorLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="info-strip">
                <Info size={17} />
                <p>
                  Renk, inceleme önceliğini ifade eder. Bir kişinin veya hesabın
                  tehdit olduğuna ilişkin otomatik bir karar değildir.
                </p>
              </div>
              <label>
                Kapsam ve ölçütler
                <textarea
                  name="description"
                  defaultValue={editor.value?.description}
                  rows={4}
                  maxLength={4000}
                  placeholder="Bu gruba kimler, hangi gerekçelerle eklenir?"
                />
              </label>
            </>
          )}
          {editor.kind === "membership" && (
            <>
              <div className="form-grid">
                <label>
                  Varlık
                  <select
                    name="entityId"
                    defaultValue={
                      editor.value?.entityId || editor.entityId || ""
                    }
                    disabled={!!editor.value}
                    required
                  >
                    <option value="" disabled>
                      Varlık seçin
                    </option>
                    {workspace.entities.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {entityLabels[e.kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  İzleme grubu
                  <select
                    name="groupId"
                    defaultValue={editor.value?.groupId || editor.groupId || ""}
                    disabled={!!editor.value}
                    required
                  >
                    <option value="" disabled>
                      Grup seçin
                    </option>
                    {workspace.groups.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Gerekçe
                <textarea
                  name="reason"
                  defaultValue={editor.value?.reason}
                  required
                  minLength={10}
                  maxLength={4000}
                  rows={4}
                  placeholder="İnceleme gerekçesini ve varsa kaynak referansını açıkça yazın."
                />
              </label>
              <label>
                İnceleme sorumlusu
                <input
                  name="responsible"
                  defaultValue={editor.value?.responsible}
                  required
                  minLength={2}
                  maxLength={160}
                  placeholder="Ad soyad / sorumlu ekip"
                />
                <span className="field-help">
                  Sorumlu adı kayıt amaçlıdır; kullanıcıya erişim yetkisi
                  vermez.
                </span>
              </label>
              <div className="form-grid">
                <label>
                  Başlangıç
                  <input
                    type="date"
                    name="startsOn"
                    required
                    value={startsOn}
                    onChange={(e) => setStartsOn(e.target.value)}
                  />
                </label>
                <label>
                  Bitiş
                  <input
                    type="date"
                    name="endsOn"
                    required
                    min={
                      memberStatus === "active" && utcToday() > startsOn
                        ? utcToday()
                        : startsOn
                    }
                    value={endsOn}
                    onChange={(e) => setEndsOn(e.target.value)}
                  />
                </label>
                <label>
                  Gözden geçirme
                  <input
                    type="date"
                    name="reviewOn"
                    required
                    min={startsOn}
                    max={endsOn || undefined}
                    defaultValue={editor.value?.reviewOn}
                  />
                </label>
                <label>
                  Durum
                  <select
                    name="status"
                    value={memberStatus}
                    onChange={(e) =>
                      setMemberStatus(e.target.value as "active" | "closed")
                    }
                  >
                    <option value="active">Açık</option>
                    <option value="closed">Kapatıldı</option>
                  </select>
                </label>
              </div>
              <p className="field-help">
                Tarihler UTC gününe göre değerlendirilir; bitiş günü dahildir.
                En fazla 366 gün. Kapatılan üyelik ve değişiklik geçmişi
                saklanır.
              </p>
              {editor.value && (
                <p className="field-help">
                  Gözden geçirme kararınızı ayrı gerekçesiyle kaydetmek için
                  üyelik ayrıntısındaki “Gözden geçirmeyi kaydet” işlemini kullanın.
                </p>
              )}
            </>
          )}
          {confirmDelete && (
            <FormError>
              Bu kaydı silmek istediğinizden emin olun. Üyeliği veya ilişkisi
              bulunan kayıtlar silinemez. Onaylamak için “Silmeyi onayla”
              düğmesine basın.
            </FormError>
          )}
          {error && <FormError>{error}</FormError>}
          {conflict && (
            <div className="info-strip" role="status">
              <div>
                {currentRecord ? (
                  <>
                    <strong>Sunucudaki güncel kayıt · sürüm {currentRecord.version}</strong>
                    <p>Yazdığınız alanlar korunuyor. Güncel değerleri inceleyip taslağınızla devam etmeyi açıkça seçin.</p>
                    <dl className="event-facts">
                      {currentRecordFields(currentRecord).map(([label, value]) => (
                        <div key={label}><dt>{label}</dt><dd>{value || "Belirtilmedi"}</dd></div>
                      ))}
                    </dl>
                    <button className="btn secondary" type="button" onClick={acceptCurrentRecord}>
                      Güncel sürümle devam et
                    </button>
                  </>
                ) : (
                  <button className="btn secondary" type="button" disabled={reloading} onClick={() => void reloadCurrentRecord()}>
                    {reloading ? "Güncel kayıt yükleniyor…" : "Güncel kaydı yükle"}
                  </button>
                )}
              </div>
            </div>
          )}
        </fieldset>
        <footer className="modal-actions">
          {value && editor.kind !== "membership" && (
            <button
              type="button"
              className="btn text-danger"
              disabled={busy || writeBlocked || conflict || reloading}
              onClick={remove}
            >
              <Trash2 size={16} />
              {confirmDelete ? "Silmeyi onayla" : "Sil"}
            </button>
          )}
          <span className="action-spacer" />
          <button
            type="button"
            className="btn secondary"
            disabled={busy || reloading}
            onClick={close}
          >
            Vazgeç
          </button>
          <button className="btn primary" disabled={busy || writeBlocked || conflict || reloading}>
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <Save size={16} />
            )}
            Kaydet
          </button>
        </footer>
      </form>
    </Modal>
  );
}
