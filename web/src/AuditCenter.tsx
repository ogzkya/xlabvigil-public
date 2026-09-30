import { useState } from "react";
import { History } from "lucide-react";
import { Empty, LoadError, Loading, PageNavigation } from "./components";
import { demoWorkspace } from "./demo";
import { useListSearch } from "./listSearch";
import { contains, timestamp, useOperationRefresh } from "./operations";
import { useResource } from "./resource";
import { isAuditPageResponse } from "./responseShape";
import type { Audit } from "./types";

type AuditPage = { items: Audit[]; nextCursor: string };
type AuditCenterProps = {
  demo: boolean;
  query: string;
  onSessionExpired: () => void;
  refreshToken: number;
  onRefreshComplete: (token: number) => void;
};
const demoAuditPage: AuditPage = {
  items: demoWorkspace().audit,
  nextCursor: "",
};

const auditLabels: Record<string, string> = {
  "connection.created": "Bağlantı profili oluşturuldu",
  "connection.updated": "Bağlantı profili güncellendi",
  "events.imported": "Güvenlik olayları içe aktarıldı",
  "notification.read": "Bildirim okundu işaretlendi",
  "notification_settings.updated": "E-posta profili güncellendi",
  "session.password_changed": "Parola değiştirildi",
  "user.created": "Kullanıcı oluşturuldu",
  "user.updated": "Kullanıcı güncellendi",
  "user.sessions_revoked": "Kullanıcı oturumları kapatıldı",
  "entity.created": "Varlık oluşturuldu",
  "entity.updated": "Varlık güncellendi",
  "entity.deleted": "Varlık silindi",
  "group.created": "İzleme grubu oluşturuldu",
  "group.updated": "İzleme grubu güncellendi",
  "group.deleted": "İzleme grubu silindi",
  "membership.created": "İnceleme üyeliği oluşturuldu",
  "membership.updated": "İnceleme üyeliği güncellendi",
  "membership.reviewed": "Gözden geçirme kararı kaydedildi",
  "membership.deleted": "İnceleme üyeliği silindi",
  "membership_evidence.attached": "Olay incelemeye iliştirildi",
  "membership_evidence.retracted": "Olay bağlantısı gerekçeyle geri alındı",
};

export default function AuditCenter({
  demo,
  query,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
}: AuditCenterProps) {
  const [cursor, setCursor] = useState("");
  const [history, setHistory] = useState<string[]>([]);
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
  if (!demo && submittedSearch) {
    params.set("q", submittedSearch);
    for (const [action, label] of Object.entries(auditLabels)) {
      if (contains(submittedSearch, label)) params.append("labelAction", action);
    }
  }
  const audit = useResource<AuditPage>(
    `/audit/page?${params}`,
    demo,
    demoAuditPage,
    onSessionExpired,
    isAuditPageResponse,
  );
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    audit.matchesRequest && !audit.loading,
    [audit.refresh],
  );
  const filtered =
    audit.data?.items.filter(
      (item) =>
        !demo ||
        contains(
          query,
          item.actor,
          item.action,
          auditLabels[item.action] || "",
          item.kind,
        ),
    ) || [];

  return (
    <div className="operations-page">
      <div className="info-strip">
        <History size={18} />
        <p>
          Bu liste uygulama işlemleridir; kaynaklardan gelen güvenlik olayları
          değildir. Bağımsız, değiştirilemez arşiv henüz bağlı değil.
        </p>
      </div>
      <section className="panel" aria-label="İşlem kayıtları">
        {searchInvalid ? (
          <Empty
            title={
              searchTooShort ? "Arama için en az 3 karakter yazın" : "Arama çok uzun"
            }
          >
            {searchTooShort
              ? "Aramayı sürdürün veya temizleyerek tüm işlemleri gösterin."
              : "Arama ifadesini 120 karaktere kısaltın."}
          </Empty>
        ) : searchPending ? (
          <Loading label="Arama hazırlanıyor…" />
        ) : audit.loading || !audit.matchesRequest ? (
          <Loading label="İşlem kayıtları yükleniyor…" />
        ) : audit.error ? (
          <LoadError
            title="Veriler alınamadı"
            message={audit.error}
            onRetry={() => void audit.refresh()}
          />
        ) : filtered.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Zaman</th>
                  <th scope="col">İşlemi yapan</th>
                  <th scope="col">İşlem</th>
                  <th scope="col">Kayıt türü</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <time dateTime={item.createdAt}>
                        {timestamp(item.createdAt)}
                      </time>
                    </td>
                    <td>{item.actor}</td>
                    <td>
                      <span title={item.action}>
                        {auditLabels[item.action] || item.action}
                      </span>
                    </td>
                    <td>{item.kind || "Oturum"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title={
              query.trim()
                ? demo
                  ? "Bu önizlemede eşleşen işlem yok"
                  : "Eşleşen işlem yok"
                : cursor
                  ? "Bu sayfada işlem kaydı yok"
                  : "İşlem kaydı bulunamadı"
            }
          >
            {query.trim()
              ? "Arama ifadesini değiştirin veya temizleyin."
              : cursor
                ? "Önceki sayfaya dönün veya ilk sayfayı yenileyin."
                : "Kaydedilen işlemler burada görünür."}
          </Empty>
        )}
        {!searchInvalid &&
          !searchPending &&
          !audit.loading &&
          audit.matchesRequest &&
          !audit.error && (
            <PageNavigation
              page={history.length + 1}
              count={filtered.length}
              caption={
                demo
                  ? "Arama yalnız bu önizleme sayfasını kapsar; sayı toplam değildir."
                  : "Arama tüm işlem kayıtlarına uygulanır; sayı yalnız bu sayfadaki eşleşmelerdir, toplam değildir."
              }
              previousDisabled={!history.length}
              nextDisabled={!audit.data?.nextCursor || demo}
              onPrevious={() => {
                setCursor(history.at(-1) || "");
                setHistory((values) => values.slice(0, -1));
              }}
              onNext={() => {
                setHistory((values) => [...values, cursor]);
                setCursor(audit.data!.nextCursor);
              }}
            />
          )}
      </section>
    </div>
  );
}
