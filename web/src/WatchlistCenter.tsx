import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Bell,
  ChevronRight,
  ListChecks,
  Search,
} from "lucide-react";
import {
  Badge,
  Empty,
  FormError,
  LoadError,
  Loading,
  PageNavigation,
} from "./components";
import { formatDateUTC, formatTimestampUTC } from "./dateTime";
import { demoInbox } from "./demoFixtures";
import { useOperationRefresh } from "./operations";
import { useResource } from "./resource";
import { entityLabels, membershipLabels, utcToday } from "./types";
import type { Page, Workspace } from "./types";
import type { WatchlistEntryIntent } from "./watchlistNavigation";
import { isWatchlistOverviewForRequest } from "./watchlistResponses";
import {
  demoWatchlistOverview,
  reviewAlertKinds,
  reviewAlertLabels,
  reviewAlertTone,
  watchlistMembershipState,
  validWatchlistQuery,
  watchlistEntityKinds,
  watchlistEntityKindLabels,
} from "./watchlists";
import type {
  ReviewAlertFilter,
  WatchlistEntry,
  WatchlistOverview,
  WatchlistPage,
  WatchlistEntityKind,
  WatchlistSelection,
} from "./watchlists";

export type WatchlistCenterProps = {
  demo: boolean;
  demoWorkspace: Workspace;
  onOpenMembership: (entry: WatchlistEntry) => void;
  onNavigate: (page: Page) => void;
  onSessionExpired: () => void;
  refreshToken: number;
  onRefreshComplete: (token: number) => void;
  revision: number;
  entryIntent: WatchlistEntryIntent | null;
};
type Paging = { cursor: string; history: string[] };
const firstPage = (): Paging => ({ cursor: "", history: [] });

function WatchlistRow({
  entry,
  asOf,
  onOpenMembership,
}: {
  entry: WatchlistEntry;
  asOf: string;
  onOpenMembership: (entry: WatchlistEntry) => void;
}) {
  const { membership, entity, group } = entry;
  const state = watchlistMembershipState(membership, asOf);
  return (
    <div className="watchlist-record">
      <div className="watchlist-record-heading">
        <button
          className="table-link"
          type="button"
          onClick={() => onOpenMembership(entry)}
        >
          {entity.name}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <Badge
          tone={
            state === "expired"
              ? "orange"
              : state === "scheduled"
                ? "slate"
                : "neutral"
          }
        >
          {membershipLabels[state]}
        </Badge>
      </div>
      <p className="watchlist-record-context">
        {entityLabels[entity.kind]} · {group.name}
        {entity.department && <> · {entity.department}</>}
        {!entity.identifier.trim() && <> · Aday kimlik</>}
      </p>
      {entity.identifier.trim() && (
        <p className="watchlist-record-context">
          Aday kimlik: {entity.identifier}
        </p>
      )}
      <p className="watchlist-reason">{membership.reason}</p>
      <dl className="watchlist-record-facts">
        <div>
          <dt>Sorumlu</dt>
          <dd>{membership.responsible}</dd>
        </div>
        <div>
          <dt>Üyelik aralığı</dt>
          <dd>
            {formatDateUTC(membership.startsOn, true)} –{" "}
            {formatDateUTC(membership.endsOn, true)}
          </dd>
        </div>
        <div>
          <dt>İnceleme tarihi</dt>
          <dd>{formatDateUTC(membership.reviewOn, true)}</dd>
        </div>
      </dl>
    </div>
  );
}

function WatchlistPanel({
  color,
  page,
  paging,
  busy,
  asOf,
  onPrevious,
  onNext,
  onOpenMembership,
  selection,
  onClearFilters,
}: {
  color: "red" | "yellow";
  page: WatchlistPage;
  paging: Paging;
  busy: boolean;
  asOf: string;
  onPrevious: () => void;
  onNext: () => void;
  onOpenMembership: (entry: WatchlistEntry) => void;
  selection: WatchlistSelection;
  onClearFilters: () => void;
}) {
  const headingId = useId();
  const filtered = !!selection.q || selection.entityKind !== "all";
  return (
    <section className="panel watchlist-panel" aria-labelledby={headingId}>
      <div className="watchlist-panel-heading">
        <h2 id={headingId}>
          {color === "red" ? "Kırmızı liste" : "Sarı liste"}
        </h2>
        <Badge tone={color}>{page.total} açık üyelik</Badge>
      </div>
      <p className="watchlist-panel-scope">
        {page.activeCount} etkin üyelik · Sayılar uygulanan arama ve tür
        kapsamındadır. Süresi dolmuş ve planlanmış açık üyelikler de listelenir.
      </p>
      {page.items.length ? (
        <ul
          className="watchlist-records"
          tabIndex={0}
          aria-label={`${color === "red" ? "Kırmızı" : "Sarı"} liste üyelik kayıtları`}
        >
          {page.items.map((entry) => (
            <li key={entry.membership.id}>
              <WatchlistRow
                entry={entry}
                asOf={asOf}
                onOpenMembership={onOpenMembership}
              />
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          title={
            page.total === 0
              ? filtered
                ? "Filtrelerle eşleşen açık üyelik yok"
                : "Bu listede açık üyelik yok"
              : "Bu sayfada üyelik kalmadı"
          }
          action={
            filtered ? (
              <button
                className="btn secondary"
                type="button"
                onClick={onClearFilters}
              >
                Filtreleri temizle
              </button>
            ) : undefined
          }
        >
          {page.total === 0
            ? filtered
              ? "Aramayı veya varlık türünü değiştirebilir, filtreleri temizleyebilirsiniz. Bu sonuç bir tehdit değerlendirmesi değildir."
              : "Bu renk önceliğindeki gruplarda açık üyelik bulunmuyor. Bu bilgi bir tehdit değerlendirmesi değildir."
            : "Kayıtlar değişmiş olabilir. Önceki sayfaya dönün veya listeleri baştan yükleyin."}
        </Empty>
      )}
      <PageNavigation
        page={paging.history.length + 1}
        count={page.items.length}
        caption="Sayı üyelik kayıtlarıdır; benzersiz kişi sayısı değildir."
        previousDisabled={busy || !paging.history.length}
        nextDisabled={busy || !page.nextCursor}
        onPrevious={onPrevious}
        onNext={onNext}
      />
    </section>
  );
}

export default function WatchlistCenter({
  demo,
  demoWorkspace,
  onOpenMembership,
  onNavigate,
  onSessionExpired,
  refreshToken,
  onRefreshComplete,
  revision,
  entryIntent,
}: WatchlistCenterProps) {
  const [red, setRed] = useState<Paging>(firstPage);
  const [yellow, setYellow] = useState<Paging>(firstPage);
  const [alerts, setAlerts] = useState<Paging>(firstPage);
  const [alertKind, setAlertKind] = useState<ReviewAlertFilter>(
    () => entryIntent?.alertKind ?? "all",
  );
  const [selection, setSelection] = useState<WatchlistSelection>({
    q: "",
    entityKind: "all",
  });
  const [draftQ, setDraftQ] = useState("");
  const [draftKind, setDraftKind] = useState<WatchlistEntityKind>("all");
  const [selectionError, setSelectionError] = useState("");
  const [clockDay, setClockDay] = useState(utcToday);
  const dayRef = useRef(clockDay);
  const displayedDay = useRef(clockDay);
  const priorRevision = useRef(revision);
  const headingId = useId();
  const alertHeadingRef = useRef<HTMLHeadingElement>(null);
  const appliedEntrySerial = useRef(entryIntent?.serial ?? null);
  const pendingEntryFocus = useRef<{
    serial: number;
    alertKind: ReviewAlertFilter;
    requiresRefresh: boolean;
    freshReady: boolean;
    scheduled: boolean;
    cancelled: boolean;
  } | null>(
    entryIntent
      ? {
          ...entryIntent,
          requiresRefresh: false,
          freshReady: true,
          scheduled: false,
          cancelled: false,
        }
      : null,
  );
  const [entryCompletion, setEntryCompletion] = useState<number | null>(null);
  useEffect(() => {
    const mainFocus = (event: FocusEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.id === "main-content"
      ) {
        const entry = pendingEntryFocus.current;
        if (entry) entry.cancelled = true;
      }
    };
    document.addEventListener("focusin", mainFocus);
    return () => document.removeEventListener("focusin", mainFocus);
  }, []);
  const request = useMemo(
    () => ({
      limit: 20,
      alertKind,
      redCursor: red.cursor,
      yellowCursor: yellow.cursor,
      alertCursor: alerts.cursor,
      q: selection.q,
      entityKind: selection.entityKind,
    }),
    [alertKind, red.cursor, yellow.cursor, alerts.cursor, selection],
  );
  const params = new URLSearchParams({ limit: "20", alertKind });
  if (selection.q) params.set("q", selection.q);
  if (selection.entityKind !== "all")
    params.set("entityKind", selection.entityKind);
  if (red.cursor) params.set("redCursor", red.cursor);
  if (yellow.cursor) params.set("yellowCursor", yellow.cursor);
  if (alerts.cursor) params.set("alertCursor", alerts.cursor);
  const fixture = useMemo(
    () =>
      demoWatchlistOverview(
        demoWorkspace,
        demoInbox.unreadCount,
        request,
        clockDay,
      ),
    [demoWorkspace, request, clockDay],
  );
  const resource = useResource<WatchlistOverview>(
    `/watchlist-overview?${params}`,
    demo,
    fixture,
    onSessionExpired,
    (value) => isWatchlistOverviewForRequest(value, request),
  );
  useEffect(() => {
    if (!entryIntent || appliedEntrySerial.current === entryIntent.serial)
      return;
    appliedEntrySerial.current = entryIntent.serial;
    const sameRequest =
      !selection.q &&
      selection.entityKind === "all" &&
      alertKind === entryIntent.alertKind &&
      !red.cursor &&
      !yellow.cursor &&
      !alerts.cursor;
    pendingEntryFocus.current = {
      ...entryIntent,
      requiresRefresh: sameRequest,
      freshReady: !sameRequest,
      scheduled: false,
      cancelled: false,
    };
    setSelection({ q: "", entityKind: "all" });
    setDraftQ("");
    setDraftKind("all");
    setSelectionError("");
    setAlertKind(entryIntent.alertKind);
    setRed(firstPage());
    setYellow(firstPage());
    setAlerts(firstPage());
  }, [
    entryIntent,
    selection,
    alertKind,
    red.cursor,
    yellow.cursor,
    alerts.cursor,
  ]);

  useEffect(() => {
    const entry = pendingEntryFocus.current;
    if (
      !entry?.requiresRefresh ||
      resource.loading ||
      selection.q ||
      selection.entityKind !== "all" ||
      alertKind !== entry.alertKind ||
      red.cursor ||
      yellow.cursor ||
      alerts.cursor
    )
      return;
    entry.requiresRefresh = false;
    void resource.refresh().then(() => {
      if (pendingEntryFocus.current !== entry) return;
      entry.freshReady = true;
      setEntryCompletion(entry.serial);
    });
  }, [
    entryIntent,
    resource.loading,
    resource.refresh,
    selection,
    alertKind,
    red.cursor,
    yellow.cursor,
    alerts.cursor,
  ]);

  useEffect(() => {
    const entry = pendingEntryFocus.current;
    const data = resource.matchesRequest ? resource.data : null;
    if (
      !entry ||
      !entry.freshReady ||
      entry.scheduled ||
      entry.cancelled ||
      resource.loading ||
      resource.error ||
      !data ||
      selection.q ||
      selection.entityKind !== "all" ||
      alertKind !== entry.alertKind ||
      data.alerts.filter !== entry.alertKind ||
      data.selection.q ||
      data.selection.entityKind !== "all" ||
      red.cursor ||
      yellow.cursor ||
      alerts.cursor ||
      data.asOf !== clockDay
    )
      return;
    entry.scheduled = true;
    const frame = window.requestAnimationFrame(() => {
      if (pendingEntryFocus.current !== entry || entry.cancelled) return;
      pendingEntryFocus.current = null;
      const heading = alertHeadingRef.current;
      if (
        !heading ||
        heading.closest("[inert]") ||
        document.activeElement?.id === "main-content"
      )
        return;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ block: "start", behavior: "instant" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (pendingEntryFocus.current === entry) entry.scheduled = false;
    };
  }, [
    entryIntent,
    entryCompletion,
    resource.matchesRequest,
    resource.data,
    resource.loading,
    resource.error,
    selection,
    alertKind,
    red.cursor,
    yellow.cursor,
    alerts.cursor,
    clockDay,
  ]);

  function openMembership(entry: WatchlistEntry) {
    pendingEntryFocus.current = null;
    onOpenMembership(entry);
  }
  const resetAndRefresh = useCallback(async () => {
    const alreadyFirst = !red.cursor && !yellow.cursor && !alerts.cursor;
    setRed(firstPage());
    setYellow(firstPage());
    setAlerts(firstPage());
    if (alreadyFirst) await resource.refresh();
  }, [red.cursor, yellow.cursor, alerts.cursor, resource.refresh]);
  useOperationRefresh(
    refreshToken,
    onRefreshComplete,
    resource.matchesRequest && !resource.loading,
    [resetAndRefresh],
  );
  useEffect(() => {
    if (priorRevision.current === revision) return;
    priorRevision.current = revision;
    void resetAndRefresh();
  }, [revision, resetAndRefresh]);
  useEffect(() => {
    if (displayedDay.current === clockDay) return;
    displayedDay.current = clockDay;
    void resetAndRefresh();
  }, [clockDay, resetAndRefresh]);

  const updateRef = useRef(() => {});
  updateRef.current = () => {
    if (document.visibilityState !== "visible") return;
    const day = utcToday();
    if (day !== dayRef.current) {
      dayRef.current = day;
      setClockDay(day);
    } else if (!resource.loading) void resource.refresh();
  };
  useEffect(() => {
    const interval = window.setInterval(() => updateRef.current(), 30_000);
    const visible = () => {
      if (document.visibilityState === "visible") updateRef.current();
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
          updateRef.current();
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
  const data = resource.matchesRequest ? resource.data : null;
  const hasFilters = !!selection.q || selection.entityKind !== "all";
  const pendingSelection =
    draftQ !== selection.q || draftKind !== selection.entityKind;
  function applySelection(next: WatchlistSelection) {
    pendingEntryFocus.current = null;
    const same =
      selection.q === next.q && selection.entityKind === next.entityKind;
    const alreadyFirst = !red.cursor && !yellow.cursor && !alerts.cursor;
    setSelection(next);
    setDraftQ(next.q);
    setDraftKind(next.entityKind);
    setSelectionError("");
    setRed(firstPage());
    setYellow(firstPage());
    setAlerts(firstPage());
    if (same && alreadyFirst) void resource.refresh();
  }
  function submitSelection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validWatchlistQuery(draftQ)) {
      setSelectionError(
        "Arama için 3–120 karakter kullanın veya alanı boş bırakın.",
      );
      return;
    }
    applySelection({ q: draftQ.trim(), entityKind: draftKind });
  }
  const clearFilters = () => applySelection({ q: "", entityKind: "all" });
  function previous(set: (update: (paging: Paging) => Paging) => void) {
    pendingEntryFocus.current = null;
    set((paging) => ({
      cursor: paging.history.at(-1) || "",
      history: paging.history.slice(0, -1),
    }));
  }
  function next(
    set: (update: (paging: Paging) => Paging) => void,
    cursor: string,
  ) {
    pendingEntryFocus.current = null;
    set((paging) => ({ cursor, history: [...paging.history, paging.cursor] }));
  }
  function cancelPendingEntryFocus() {
    const entry = pendingEntryFocus.current;
    if (entry) entry.cancelled = true;
  }
  function retryOverview() {
    const entry = pendingEntryFocus.current;
    if (entry) {
      entry.cancelled = false;
      entry.scheduled = false;
    }
    void resetAndRefresh();
  }
  return (
    <div
      className="operations-page watchlist-center"
      onFocusCapture={cancelPendingEntryFocus}
      onPointerDownCapture={cancelPendingEntryFocus}
      onKeyDownCapture={cancelPendingEntryFocus}
    >
      <div className="watchlist-intro">
        <ListChecks size={23} aria-hidden="true" />
        <p>
          Açık üyelikleri ve tarih temelli inceleme uyarılarını birlikte
          izleyin. Renkler inceleme önceliğidir; tehdit veya erişim kararı
          değildir.
        </p>
        {demo && <Badge>Salt okunur örnek</Badge>}
      </div>
      {demo && (
        <p className="field-help">
          Bu görünüm kurgusal çalışma alanındaki üyeliklerden türetilir;
          inceleme kararları kaydedilemez.
        </p>
      )}
      <section
        className="panel watchlist-search"
        aria-label="İzleme panosu filtreleri"
      >
        <form
          className="watchlist-search-form"
          onSubmit={submitSelection}
          noValidate
        >
          <div className="watchlist-search-field">
            <label htmlFor={`${headingId}-q`}>Listelerde ara</label>
            <input
              id={`${headingId}-q`}
              name="q"
              type="search"
              value={draftQ}
              maxLength={240}
              placeholder="Ad, kimlik, bölüm, grup, gerekçe veya sorumlu"
              autoComplete="off"
              aria-invalid={!!selectionError}
              aria-describedby={`${headingId}-search-help${selectionError ? ` ${headingId}-search-error` : ""}`}
              onChange={(event) => {
                pendingEntryFocus.current = null;
                setDraftQ(event.target.value);
                setSelectionError("");
              }}
            />
          </div>
          <div className="watchlist-search-field">
            <label htmlFor={`${headingId}-kind`}>Varlık türü</label>
            <select
              id={`${headingId}-kind`}
              name="entityKind"
              value={draftKind}
              onChange={(event) => {
                pendingEntryFocus.current = null;
                setDraftKind(event.target.value as WatchlistEntityKind);
              }}
            >
              {watchlistEntityKinds.map((kind) => (
                <option value={kind} key={kind}>
                  {watchlistEntityKindLabels[kind]}
                </option>
              ))}
            </select>
          </div>
          <div className="watchlist-search-actions">
            <button className="btn primary" type="submit">
              <Search size={14} aria-hidden="true" /> Ara
            </button>
            <button
              className="btn secondary"
              type="button"
              onClick={clearFilters}
            >
              Filtreleri temizle
            </button>
          </div>
          <p className="watchlist-search-help" id={`${headingId}-search-help`}>
            3–120 karakter kullanın veya aramayı boş bırakın. Arama ve varlık
            türü yalnız Ara ile uygulanır; kırmızı/sarı listeler ve üyelik
            uyarıları birlikte daralır.
          </p>
          {selectionError && (
            <div
              className="watchlist-search-error"
              id={`${headingId}-search-error`}
            >
              <FormError>{selectionError}</FormError>
            </div>
          )}
        </form>
        <p className="watchlist-applied-scope">
          Uygulanan kapsam: {watchlistEntityKindLabels[selection.entityKind]} ·{" "}
          {selection.q ? `Arama: “${selection.q}”` : "Arama yok"}. Sayaçlar bu
          kapsamdaki üyelikleri gösterir.
        </p>
        {pendingSelection && (
          <p className="watchlist-pending-selection" role="status">
            Yeni filtreler uygulanmadı. Görünen sonuçlar ve otomatik yenileme
            uygulanan kapsamı kullanır.
          </p>
        )}
      </section>
      {resource.error ? (
        <LoadError
          title="İzleme panosu alınamadı"
          message={resource.error}
          retryLabel="Listeleri baştan yükle"
          onRetry={retryOverview}
        />
      ) : !data ? (
        <Loading label="İzleme listeleri ve uyarılar yükleniyor…" />
      ) : (
        <>
          <div className="watchlist-snapshot">
            <span>
              Üyelik günü: {formatDateUTC(data.asOf, true)} UTC · Son görüntü:{" "}
              {formatTimestampUTC(data.generatedAt)}
            </span>
            {resource.loading && <span role="status">Yenileniyor…</span>}
            <button
              className="link-btn"
              type="button"
              disabled={resource.loading}
              onClick={() => void resetAndRefresh()}
            >
              Listeleri baştan yükle
            </button>
          </div>
          <div className="watchlist-columns">
            <WatchlistPanel
              color="red"
              page={data.red}
              paging={red}
              busy={resource.loading}
              asOf={data.asOf}
              onPrevious={() => previous(setRed)}
              onNext={() => next(setRed, data.red.nextCursor)}
              onOpenMembership={openMembership}
              selection={selection}
              onClearFilters={clearFilters}
            />
            <WatchlistPanel
              color="yellow"
              page={data.yellow}
              paging={yellow}
              busy={resource.loading}
              asOf={data.asOf}
              onPrevious={() => previous(setYellow)}
              onNext={() => next(setYellow, data.yellow.nextCursor)}
              onOpenMembership={openMembership}
              selection={selection}
              onClearFilters={clearFilters}
            />
          </div>
          <section
            className="panel watchlist-alert-panel"
            aria-labelledby={headingId}
          >
            <div className="watchlist-panel-heading">
              <h2
                id={headingId}
                className="watchlist-alert-heading"
                ref={alertHeadingRef}
                tabIndex={-1}
              >
                İnceleme uyarıları
              </h2>
              <Badge tone={data.alerts.total ? "yellow" : "neutral"}>
                {data.alerts.total} üyelik uyarısı
              </Badge>
            </div>
            <p className="watchlist-panel-scope">
              Başlamış açık üyelikler değerlendirilir; kapalı ve gelecekte
              başlayacak üyelikler uyarı üretmez. Her üyelik için yalnız bir
              öncelikli uyarı gösterilir. Sayaçlar uygulanan arama ve varlık
              türü kapsamındadır.
            </p>
            <div
              className="watchlist-alert-filters"
              role="group"
              aria-label="Uyarı türü"
            >
              {(["all", ...reviewAlertKinds] as ReviewAlertFilter[]).map(
                (kind) => (
                  <button
                    className="btn secondary filter-btn"
                    key={kind}
                    type="button"
                    aria-pressed={alertKind === kind}
                    disabled={resource.loading}
                    onClick={() => {
                      pendingEntryFocus.current = null;
                      if (kind !== alertKind) {
                        setAlertKind(kind);
                        setAlerts(firstPage());
                      }
                    }}
                  >
                    {reviewAlertLabels[kind]}{" "}
                    <span>
                      {kind === "all"
                        ? reviewAlertKinds.reduce(
                            (sum, key) => sum + data.alerts.counts[key],
                            0,
                          )
                        : data.alerts.counts[kind]}
                      <span className="sr-only"> üyelik</span>
                    </span>
                  </button>
                ),
              )}
            </div>
            <p className="watchlist-alert-rule">
              Öncelik sırası: süresi dolmuş → inceleme tarihi gelmiş → etkin
              kırmızı öncelik → sonraki 7 günde inceleme. Gün sınırı UTC; bitiş
              günü dahildir.
            </p>
            {data.alerts.items.length ? (
              <ul
                className="watchlist-alert-records"
                tabIndex={0}
                aria-label="İnceleme uyarısı kayıtları"
              >
                {data.alerts.items.map((alert) => (
                  <li key={alert.record.membership.id}>
                    <Badge tone={reviewAlertTone[alert.kind]}>
                      {reviewAlertLabels[alert.kind]}
                    </Badge>
                    <WatchlistRow
                      entry={alert.record}
                      asOf={data.asOf}
                      onOpenMembership={openMembership}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty
                title={
                  data.alerts.total === 0
                    ? hasFilters
                      ? "Filtrelerle eşleşen üyelik uyarısı yok"
                      : "Bu kapsamda üyelik uyarısı yok"
                    : "Bu sayfada uyarı kalmadı"
                }
                action={
                  hasFilters ? (
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={clearFilters}
                    >
                      Filtreleri temizle
                    </button>
                  ) : undefined
                }
              >
                {data.alerts.total === 0
                  ? "Diğer uyarı türlerini kontrol edebilirsiniz. Bu durum kurumda tehdit bulunmadığı anlamına gelmez."
                  : "Üyelikler değişmiş olabilir. Önceki sayfaya dönün veya listeleri baştan yükleyin."}
              </Empty>
            )}
            <PageNavigation
              page={alerts.history.length + 1}
              count={data.alerts.items.length}
              caption="Uyarı sayaçları üyelik kayıtlarıdır; aynı varlığın birden fazla üyeliği olabilir."
              previousDisabled={resource.loading || !alerts.history.length}
              nextDisabled={resource.loading || !data.alerts.nextCursor}
              onPrevious={() => previous(setAlerts)}
              onNext={() => next(setAlerts, data.alerts.nextCursor)}
            />
          </section>
          <section
            className="panel watchlist-source-notifications"
            aria-label="Kaynak olay bildirimleri"
          >
            <Bell size={22} aria-hidden="true" />
            <div>
              <h2>Kaynak olay bildirimleri</h2>
              <p>
                {data.sourceNotifications.unreadCount} okunmamış uygulama içi
                bildirim · Yalnız bu kullanıcı için; arama ve varlık türü
                filtresinden bağımsız.
              </p>
              <p>
                Üyelik uyarılarından ayrıdır; dış mesaj veya e-posta teslimatını
                göstermez.
              </p>
            </div>
            <button
              className="btn secondary"
              type="button"
              onClick={() => onNavigate("notifications")}
            >
              Bildirimleri aç <ArrowRight size={14} aria-hidden="true" />
            </button>
          </section>
          <p className="field-help">
            Görünürken 30 saniyede bir ve bu sekmeye dönünce yenilenir. UTC günü
            veya bir üyelik değiştiğinde listeler ilk sayfaya döner; açık
            inceleme taslağı korunur.
          </p>
        </>
      )}
    </div>
  );
}
