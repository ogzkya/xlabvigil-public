import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, LoaderCircle, RefreshCw } from "lucide-react";
import { Badge, LoadError, Loading, Modal } from "./components";
import { formatDateUTC, formatTimestampUTC } from "./dateTime";
import { demoInbox } from "./demoFixtures";
import { useResource } from "./resource";
import { utcToday } from "./types";
import type { Page, Workspace } from "./types";
import { demoWarningSummary, isWarningSummary } from "./warningSummary";
import type { WarningSummary } from "./warningSummary";
import {
  reviewAlertKinds,
  reviewAlertLabels,
  reviewAlertTone,
} from "./watchlists";
import type { ReviewAlertFilter } from "./watchlists";

export type HeaderWarningsProps = {
  demo: boolean;
  demoWorkspace: Workspace;
  revision: number;
  onNavigate: (page: Page) => void;
  onOpenReviewAlerts: (kind: ReviewAlertFilter) => void;
  onSessionExpired: () => void;
};

type SuccessfulSummary = {
  value: WarningSummary;
  revision: number;
  demo: boolean;
};
const numberLabel = new Intl.NumberFormat("tr-TR");

export function HeaderWarnings({
  demo,
  demoWorkspace,
  revision,
  onNavigate,
  onOpenReviewAlerts,
  onSessionExpired,
}: HeaderWarningsProps) {
  const [open, setOpen] = useState(false);
  const [clockDay, setClockDay] = useState(utcToday);
  const [lastSuccessful, setLastSuccessful] =
    useState<SuccessfulSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const fixture = useMemo(
    () => demoWarningSummary(demoWorkspace, demoInbox.unreadCount, clockDay),
    [demoWorkspace, clockDay],
  );
  const resource = useResource<WarningSummary>(
    "/watchlist-summary",
    demo,
    fixture,
    onSessionExpired,
    isWarningSummary,
  );
  const currentScope = useRef({ revision, clockDay, demo });
  currentScope.current = { revision, clockDay, demo };
  const requestScope = useRef(currentScope.current);
  const inFlight = useRef(resource.loading);
  inFlight.current = resource.loading;
  const pending = useRef(false);
  const permissionDenied = useRef(false);
  if (resource.errorStatus === 401 || resource.errorStatus === 403)
    permissionDenied.current = true;

  const refresh = useCallback(() => {
    const day = utcToday();
    if (day !== currentScope.current.clockDay) {
      pending.current = true;
      setClockDay(day);
      return;
    }
    if (inFlight.current) {
      pending.current = true;
      return;
    }
    inFlight.current = true;
    pending.current = false;
    requestScope.current = currentScope.current;
    void resource.refresh();
  }, [resource.refresh]);

  // Retain only validated responses for this identity's current demo/revision.
  // A failed retry never makes an earlier snapshot look fresh again.
  useEffect(() => {
    if (resource.loading || !resource.matchesRequest) return;
    if (resource.error) {
      setFailed(true);
      if (resource.errorStatus === 401 || resource.errorStatus === 403)
        setLastSuccessful(null);
    } else if (
      resource.data &&
      requestScope.current.revision === revision &&
      requestScope.current.demo === demo
    ) {
      permissionDenied.current = false;
      setLastSuccessful({ value: resource.data, revision, demo });
      setFailed(false);
    }
    if (pending.current && document.visibilityState === "visible") refresh();
  }, [
    resource.loading,
    resource.matchesRequest,
    resource.data,
    resource.error,
    resource.errorStatus,
    revision,
    demo,
    refresh,
  ]);

  const previousScope = useRef({
    revision,
    clockDay,
    workspace: demoWorkspace,
    demo,
  });
  useEffect(() => {
    const previous = previousScope.current;
    previousScope.current = {
      revision,
      clockDay,
      workspace: demoWorkspace,
      demo,
    };
    if (
      previous.revision === revision &&
      previous.clockDay === clockDay &&
      previous.demo === demo &&
      (!demo || previous.workspace === demoWorkspace)
    )
      return;
    pending.current = true;
    if (document.visibilityState === "visible") refresh();
  }, [revision, clockDay, demoWorkspace, demo, refresh]);

  const update = useRef(() => {});
  update.current = () => {
    if (document.visibilityState !== "visible") return;
    const day = utcToday();
    if (day !== currentScope.current.clockDay) {
      setClockDay(day);
    } else if (!inFlight.current) refresh();
  };
  useEffect(() => {
    const interval = window.setInterval(() => update.current(), 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") update.current();
    };
    document.addEventListener("visibilitychange", visible);
    let boundary = 0;
    const scheduleBoundary = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      boundary = window.setTimeout(
        () => {
          update.current();
          scheduleBoundary();
        },
        next - now.getTime() + 50,
      );
    };
    scheduleBoundary();
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(boundary);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const snapshot =
    !permissionDenied.current && lastSuccessful?.demo === demo
      ? lastSuccessful.value
      : null;
  const stale =
    !!snapshot &&
    (failed ||
      !!resource.error ||
      lastSuccessful?.revision !== revision ||
      snapshot.asOf !== clockDay);
  const unavailable =
    !snapshot && (!!resource.error || failed || permissionDenied.current);
  const reviewTotal = snapshot ? numberLabel.format(snapshot.alerts.total) : "";
  const unreadTotal = snapshot
    ? numberLabel.format(snapshot.sourceNotifications.unreadCount)
    : "";
  const accessibleLabel = stale
    ? "Uyarı özeti güncel değil. Son başarılı görüntüyü aç."
    : unavailable
      ? "Uyarı özeti alınamadı. Yeniden denemek için aç."
      : snapshot
        ? `Uyarılar: ${reviewTotal} üyelik uyarısı, ${unreadTotal} okunmamış kaynak bildirimi.${resource.loading ? " Özet yenileniyor." : ""}`
        : "Uyarı özeti yükleniyor.";
  const navigate = (page: Page) => {
    setOpen(false);
    onNavigate(page);
  };
  const openReviewAlerts = (kind: ReviewAlertFilter) => {
    setOpen(false);
    onOpenReviewAlerts(kind);
  };

  return (
    <>
      <button
        className="btn secondary header-warnings-button"
        type="button"
        aria-label={accessibleLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={accessibleLabel}
        onClick={() => setOpen(true)}
      >
        <Bell size={16} aria-hidden="true" />
        <span className="header-warnings-label">Uyarılar</span>
        {stale || unavailable ? (
          <Badge tone="yellow">!</Badge>
        ) : snapshot ? (
          <Badge>{snapshot.alerts.total > 99 ? "99+" : reviewTotal}</Badge>
        ) : (
          <LoaderCircle className="spin" size={14} aria-hidden="true" />
        )}
      </button>
      {open && (
        <Modal
          title="Uyarı özeti"
          subtitle="Genel inceleme uyarıları ve kişisel kaynak bildirimleri"
          onClose={() => setOpen(false)}
        >
          <div className="warning-summary-body">
            {demo && (
              <p className="warning-summary-demo">
                Örnek görünüm. Sayılar kurgusal kayıtlardan türetilir; kayıtlar
                değiştirilemez.
              </p>
            )}
            <p className="warning-summary-scope">
              Özet, liste aramasından ve filtrelerden bağımsızdır. Sayılar
              üyelik kayıtlarını gösterir; benzersiz kişi sayısı değildir.
            </p>
            {stale && (
              <div className="warning-summary-stale" role="status">
                <strong>Güncel değil</strong>
                <p>
                  Son başarılı görüntü:{" "}
                  {formatTimestampUTC(snapshot!.generatedAt)}.
                </p>
                <p>
                  Bu sayılar değişmiş olabilir. Güncel özeti yüklemek için
                  yeniden deneyin.
                </p>
              </div>
            )}
            {resource.error ? (
              <LoadError
                title="Uyarı özeti alınamadı"
                message={resource.error}
                onRetry={refresh}
              />
            ) : resource.loading && !snapshot ? (
              <Loading label="Uyarı özeti yükleniyor…" />
            ) : null}
            {snapshot && (
              <>
                {!stale && (
                  <p className="warning-summary-snapshot">
                    Görüntü: {formatTimestampUTC(snapshot.generatedAt)}.
                  </p>
                )}
                <p className="warning-summary-snapshot">
                  Değerlendirme günü: {formatDateUTC(snapshot.asOf, true)} UTC.
                  {resource.loading && " Özet yenileniyor…"}
                </p>
                <section
                  className="warning-summary-section"
                  aria-label="İnceleme uyarıları"
                >
                  <div className="warning-summary-heading">
                    <h3>İnceleme uyarıları</h3>
                    <Badge>{reviewTotal} üyelik</Badge>
                  </div>
                  <ul className="warning-summary-counts">
                    {reviewAlertKinds.map((kind) => (
                      <li key={kind}>
                        <button
                          className="btn secondary warning-summary-reason"
                          type="button"
                          aria-label={`${reviewAlertLabels[kind]}: ${numberLabel.format(snapshot.alerts.counts[kind])} üyelik, kayıtlarını aç`}
                          onClick={() => openReviewAlerts(kind)}
                        >
                          <span>{reviewAlertLabels[kind]}</span>
                          <Badge tone={reviewAlertTone[kind]}>
                            {numberLabel.format(snapshot.alerts.counts[kind])}
                          </Badge>
                          <ArrowRight size={14} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="warning-summary-help">
                    Her açık üyelik en fazla bir inceleme uyarısında sayılır.
                    Bunlar manuel inceleme öncelikleridir; tehdit kararı veya
                    erişim engeli oluşturmaz.
                  </p>
                </section>
                <section
                  className="warning-summary-section"
                  aria-label="Kişisel kaynak bildirimleri"
                >
                  <h3>Kişisel kaynak bildirimleri</h3>
                  <p className="warning-summary-unread">
                    <strong>{unreadTotal}</strong> okunmamış kaynak bildirimi
                  </p>
                  <p className="warning-summary-help">
                    Oturumunuza aittir. Üyelik uyarılarının toplamına eklenmez.
                  </p>
                </section>
              </>
            )}
            <p className="warning-summary-help">
              Uyarı bağlantıları tüm kayıtlardaki seçili uyarıyı açar. Liste
              araması, varlık türü, önceki uyarı seçimi ve uygulanmamış filtre
              taslağı temizlenir.
            </p>
            <div className="warning-summary-actions">
              <button
                className="btn primary"
                type="button"
                onClick={() => openReviewAlerts("all")}
              >
                Listeleri ve uyarıları aç
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => navigate("notifications")}
              >
                Bildirimleri aç
              </button>
            </div>
            <div className="warning-summary-refresh">
              <p>
                Sayfa görünürken 30 saniyede bir ve sayfaya döndüğünüzde
                yenilenir.
              </p>
              <button
                className="btn secondary"
                type="button"
                disabled={resource.loading}
                onClick={() => update.current()}
              >
                <RefreshCw size={14} aria-hidden="true" /> Özeti yenile
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export default HeaderWarnings;
