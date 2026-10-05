import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Command,
  FileClock,
  Fingerprint,
  FolderKanban,
  Info,
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  MonitorCog,
  Moon,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Shield,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
  Sun,
  UserCog,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import Auth from "./Auth";
import { PRODUCT_VERSION } from "./productInfo";
import AccountCenter from "./AccountCenter";
import CandidateEvents from "./CandidateEvents";
import EvidencePanel from "./EvidencePanel";
import MembershipActivity from "./MembershipActivity";
import MembershipReview from "./MembershipReview";
import { ReviewQueueFilters, ReviewScheduleBadge } from "./ReviewQueue";
import {
  classifyMembershipReview,
  compareMembershipReview,
  matchesReviewQueue,
  reviewNeedsAttention,
} from "./reviewSchedule";
import type { ReviewQueueFilter } from "./reviewSchedule";
import WorkspaceRefreshNotice from "./WorkspaceRefreshNotice";
import type { WorkspaceRefreshState } from "./WorkspaceRefreshNotice";
import Editor from "./Editor";
import SourceManager from "./SourceManager";
import EventCenter from "./EventCenter";
import NotificationCenter from "./NotificationCenter";
import UserManager from "./UserManager";
import AuditCenter from "./AuditCenter";
import CaseCenter from "./CaseCenter";
import WorkingGuide from "./WorkingGuide";
import WatchlistCenter from "./WatchlistCenter";
import Dashboard from "./Dashboard";
import CommandPalette from "./CommandPalette";
import type { PaletteServerSearch } from "./CommandPalette";
import ExportButton from "./ExportButton";
import type { ExportResult } from "./ExportButton";
import { nextThemePreference, themeLabels, useTheme } from "./theme";
import HeaderWarnings from "./HeaderWarnings";
import type { ReviewAlertFilter, WatchlistEntry } from "./watchlists";
import { nextWatchlistEntryIntent } from "./watchlistNavigation";
import type { WatchlistEntryIntent } from "./watchlistNavigation";
import {
  Avatar,
  Badge,
  Brand,
  dateLabel,
  Empty,
  LoadError,
  Loading,
  Modal,
} from "./components";
import { demoUser, demoWorkspace } from "./demo";
import { MAX_LIST_SEARCH_LENGTH } from "./listSearch";
import {
  colorLabels,
  entityLabels,
  membershipLabels,
  membershipState,
  roleLabels,
  utcToday,
} from "./types";
import type {
  EditorState,
  Entity,
  EntityKind,
  Group,
  Membership,
  Page,
  Status,
  User,
  Workspace,
} from "./types";
import { isEntityCollection, isGroupCollection, isMembershipCollection, isSessionResponse, isStatusResponse } from "./responseShape";

const pages: Record<
  Page,
  { title: string; subtitle: string; icon: typeof Shield }
> = {
  home: {
    title: "Pano",
    subtitle: "İnceleme önceliği, takvim ve olay özeti tek bakışta.",
    icon: LayoutDashboard,
  },
  watchlists: {
    title: "Listeler ve uyarılar",
    subtitle: "Kırmızı ve sarı listeler, gerekçeler ve inceleme uyarıları.",
    icon: ShieldAlert,
  },
  entities: {
    title: "Varlıklar",
    subtitle: "Personel, hesap, cihaz, servis ve uygulama kayıtları.",
    icon: Users,
  },
  groups: {
    title: "İzleme grupları",
    subtitle: "İnceleme önceliği ve kapsamı belirli gruplar.",
    icon: Layers,
  },
  memberships: {
    title: "İnceleme üyelikleri",
    subtitle: "Gerekçe, sorumlu, süre ve geçmişiyle grup üyelikleri.",
    icon: ClipboardList,
  },
  cases: {
    title: "İnceleme dosyaları",
    subtitle: "Olay referansları, notlar ve gerekçeli kararlar.",
    icon: FolderKanban,
  },
  sources: {
    title: "Veri kaynakları",
    subtitle: "LDAP/AD, Windows, Palo Alto, Logsign ve Trend Micro profilleri.",
    icon: Network,
  },
  events: {
    title: "Güvenlik olayları",
    subtitle: "Aktarılmış olaylar; kaynak, önem ve kimlik bağlamıyla.",
    icon: Siren,
  },
  notifications: {
    title: "Bildirimler",
    subtitle: "Yüksek ve kritik olay bildirimleri, e-posta profili.",
    icon: Bell,
  },
  audit: {
    title: "İşlem günlüğü",
    subtitle: "Vigil içinde yapılan yönetim işlemleri.",
    icon: FileClock,
  },
  users: {
    title: "Kullanıcılar",
    subtitle: "Yerel hesaplar, roller ve oturumlar.",
    icon: UserCog,
  },
  account: {
    title: "Hesabım",
    subtitle: "Parola ve oturum güvenliği.",
    icon: Fingerprint,
  },
  settings: {
    title: "Çalışma rehberi",
    subtitle: "Çalışma sırası, roller ve veri akışı.",
    icon: Settings,
  },
};
const navSections: { label: string; pages: Page[] }[] = [
  { label: "İzleme", pages: ["home", "watchlists", "memberships", "cases"] },
  { label: "Kayıtlar", pages: ["entities", "groups"] },
  { label: "Operasyon", pages: ["events", "sources", "notifications"] },
  { label: "Yönetim", pages: ["audit", "users", "account", "settings"] },
];
const paletteSearchTargets: { page: PaletteServerSearch; label: string }[] = [
  { page: "events", label: "Olaylarda ara" },
  { page: "cases", label: "Dosyalarda ara" },
  { page: "notifications", label: "Bildirimlerde ara" },
  { page: "audit", label: "İşlem günlüğünde ara" },
];
const kindIcons = {
  person: UserRound,
  account: Fingerprint,
  device: Monitor,
  service: Server,
  application: FolderKanban,
};
const navPages = Object.keys(pages) as Page[];
function initialPage(): Page {
  const p = window.location.hash.slice(1) as Page;
  return navPages.includes(p) ? p : "home";
}
function matches(query: string, ...values: string[]) {
  return values
    .join(" ")
    .toLocaleLowerCase("tr")
    .includes(query.toLocaleLowerCase("tr").trim());
}
function membershipIsActive(m: Membership) {
  return m.active && membershipState(m) === "active";
}
function EntitySymbol({ kind }: { kind: EntityKind }) {
  const Icon = kindIcons[kind];
  return (
    <span className={`entity-symbol ${kind}`}>
      <Icon size={20} />
    </span>
  );
}
function MembershipBadge({ membership }: { membership: Membership }) {
  const state = membershipState(membership);
  return (
    <Badge
      tone={
        state === "active" ? "teal" : state === "expired" ? "orange" : "slate"
      }
    >
      {membershipLabels[state]}
    </Badge>
  );
}

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState("");
  const [demo, setDemo] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeTone, setNoticeTone] = useState<"success" | "error">("success");
  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setNoticeTone(tone);
    setNotice(message);
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const theme = useTheme();
  const [page, setPage] = useState<Page>(initialPage);
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [membershipFilter, setMembershipFilter] = useState("active");
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("attention");
  const [groupFilter, setGroupFilter] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [entityDetail, setEntityDetail] = useState<Entity | null>(null);
  const [memberDetail, setMemberDetail] = useState<Membership | null>(null);
  const [memberDetailContext, setMemberDetailContext] = useState<Workspace | null>(null);
  const [watchlistRevision, setWatchlistRevision] = useState(0);
  const [watchlistEntryIntent, setWatchlistEntryIntent] =
    useState<WatchlistEntryIntent | null>(null);
  const warningsChanged = useCallback(() => {
    setWatchlistRevision((value) => value + 1);
  }, []);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [operationsRefresh, setOperationsRefresh] = useState(0);
  const [operationsRefreshing, setOperationsRefreshing] = useState(false);
  const operationsRefreshSerial = useRef(0);
  const pendingOperationsRefresh = useRef<{
    token: number;
    page: Page;
    userId: string;
    demo: boolean;
  } | null>(null);
  const refreshIdentity = useRef({ page, userId: user?.id, demo });
  refreshIdentity.current = { page, userId: user?.id, demo };
  const [loggingOut, setLoggingOut] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const mobileFocusReturnPending = useRef(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const pageHeadingId = useId();
  const requestGeneration = useRef(0);
  const pendingEntryScroll = useRef(false);
  const allowed = !!user && (user.role === "admin" || user.role === "analyst");
  const operationsPage =
    page === "watchlists" ||
    page === "cases" ||
    page === "sources" ||
    page === "events" ||
    page === "notifications" ||
    page === "users" ||
    page === "audit";
  const pendingRefresh = pendingOperationsRefresh.current;
  const operationsRefreshToken =
    pendingRefresh?.page === page &&
    pendingRefresh.userId === user?.id &&
    pendingRefresh.demo === demo
      ? operationsRefresh
      : 0;
  const serverSearchPage =
    page === "cases" || page === "events" || page === "notifications" || page === "audit";
  // HTML maxLength counts UTF-16 units; the shared search limit counts code points.
  const searchPrompt =
    page === "cases"
      ? "Tüm inceleme dosyalarında ara"
      : page === "events"
      ? "Tüm olaylarda ara"
      : page === "notifications"
        ? "Tüm bildirimlerde ara"
        : page === "audit"
          ? "Tüm işlemlerde ara"
          : operationsPage
            ? "Bu sayfadaki kayıtlarda ara"
            : "Varlık, grup veya gerekçe ara";
  const sessionExpired = useCallback(() => {
    requestGeneration.current++;
    pendingOperationsRefresh.current = null;
    setOperationsRefreshing(false);
    setUser(null);
    setWorkspace(null);
    setEditor(null);
    setEntityDetail(null);
    setMemberDetail(null);
    setMemberDetailContext(null);
    setWatchlistEntryIntent(null);
    setLoading(false);
    setError("");
    setMobileOpen(false);
    setPaletteOpen(false);
    notify("Oturumunuz sona erdi. Yeniden giriş yapın.", "error");
  }, [notify]);
  const operationsRefreshComplete = useCallback((token: number) => {
    const pending = pendingOperationsRefresh.current;
    const current = refreshIdentity.current;
    if (
      pending?.token !== token ||
      pending.page !== current.page ||
      pending.userId !== current.userId ||
      pending.demo !== current.demo
    ) return;
    pendingOperationsRefresh.current = null;
    setOperationsRefreshing(false);
  }, []);
  useEffect(() => {
    const pending = pendingOperationsRefresh.current;
    if (
      pending &&
      (pending.page !== page || pending.userId !== user?.id || pending.demo !== demo)
    ) {
      pendingOperationsRefresh.current = null;
      setOperationsRefreshing(false);
    }
  }, [page, user?.id, demo]);

  useLayoutEffect(() => {
    if (
      !pendingEntryScroll.current ||
      !user ||
      booting ||
      loading ||
      (allowed && !workspace && !error)
    )
      return;
    pendingEntryScroll.current = false;
    // Reset only when entering from authentication, after the loaded shell is
    // committed. Ordinary refreshes and hash navigation retain their position.
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [user, booting, loading, allowed, workspace, error]);

  const boot = useCallback(async () => {
    setBooting(true);
    setBootError("");
    const results = await Promise.allSettled([
      api<Status>("/status", "GET", undefined, isStatusResponse),
      api<{ user: User }>("/session", "GET", undefined, isSessionResponse),
    ]);
    if (results[0].status === "rejected")
      setBootError((results[0].reason as Error).message);
    else setStatus(results[0].value);
    if (results[1].status === "fulfilled") setUser(results[1].value.user);
    else if (!(
      results[1].reason instanceof ApiError && results[1].reason.status === 401
    ))
      setBootError((results[1].reason as Error).message);
    setBooting(false);
  }, []);
  useEffect(() => {
    void boot();
  }, [boot]);

  const refresh = useCallback(async () => {
    if (!user || demo || !allowed) return;
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError("");
    try {
      const results = await Promise.allSettled([
        api<Entity[]>("/entities", "GET", undefined, isEntityCollection),
        api<Group[]>("/groups", "GET", undefined, isGroupCollection),
        api<Membership[]>("/memberships", "GET", undefined, isMembershipCollection),
      ]);
      if (generation !== requestGeneration.current) return;
      // Inspect every response: a faster collection failure must not hide an
      // expired session or a revoked permission from another request.
      if (results.some((result) => result.status === "rejected" &&
        result.reason instanceof ApiError &&
        (result.reason.status === 401 || result.reason.status === 403))) {
        sessionExpired();
        return;
      }
      const [entities, groups, memberships] = results;
      if (entities.status === "rejected") throw entities.reason;
      if (groups.status === "rejected") throw groups.reason;
      if (memberships.status === "rejected") throw memberships.reason;
      setWorkspace({
        entities: entities.value, groups: groups.value,
        memberships: memberships.value, audit: [],
      });
      setMemberDetail((current) => {
        const latest = memberships.value.find((item) => item.id === current?.id);
        return latest && current && latest.version >= current.version ? latest : current;
      });
      setEntityDetail((current) => {
        const latest = entities.value.find((item) => item.id === current?.id);
        return latest && current && latest.version >= current.version ? latest : current;
      });
    } catch (e) {
      if (generation === requestGeneration.current) {
        // Retain the last snapshot to keep open forms mounted. Main content
        // shows the error; modal feedback blocks writes until a full reload.
        setError((e as Error).message);
      }
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [user, demo, allowed, sessionExpired]);
  useEffect(() => {
    void refresh();
    return () => {
      requestGeneration.current++;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user || !allowed) return;
    // The server's active flag is authoritative for each loaded snapshot.
    // Reload at a UTC date boundary and when returning from a background tab.
    const renew = () => {
      if (demo) setWorkspace(demoWorkspace());
      else void refresh();
    };
    const now = new Date();
    const nextDay = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    );
    const timer = window.setTimeout(renew, nextDay - now.getTime() + 1000);
    const visible = () => {
      if (document.visibilityState === "visible") renew();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [user, allowed, demo, refresh, workspace]);
  useEffect(() => {
    const change = () => {
      const next = initialPage();
      setPage(next);
      if (next !== "watchlists") setWatchlistEntryIntent(null);
      setQuery("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key.toLocaleLowerCase("en") !== "k" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (!user) return;
      const dialogOpen = !!document.querySelector(".modal-backdrop");
      if (dialogOpen && !paletteOpen) return;
      event.preventDefault();
      if (!mobileOpen) setPaletteOpen((open) => !open);
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [user, paletteOpen, mobileOpen]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useLayoutEffect(() => {
    if (!mobileOpen) {
      if (!mobileFocusReturnPending.current) return;
      mobileFocusReturnPending.current = false;
      let disposed = false;
      const restoreMenuFocus = () => {
        const menu = menuRef.current;
        const active = document.activeElement;
        if (!menu || disposed || !menu.isConnected || menu.closest("[inert]"))
          return;
        const bounds = menu.getBoundingClientRect();
        if (
          bounds.width > 0 && bounds.height > 0 &&
          window.getComputedStyle(menu).visibility === "visible" &&
          (active === null || active === document.body || sidebarRef.current?.contains(active))
        ) menu.focus({ preventScroll: true });
      };
      // Restore after the closed DOM has removed inert, then cover focus fixup
      // when a rapid close interrupts the drawer's visibility transition.
      restoreMenuFocus();
      const returnFrame = window.requestAnimationFrame(restoreMenuFocus);
      const returnTimer = window.setTimeout(restoreMenuFocus, 250);
      return () => {
        disposed = true;
        window.cancelAnimationFrame(returnFrame);
        window.clearTimeout(returnTimer);
      };
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let disposed = false;
    const sidebar = sidebarRef.current;
    const focusables = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ) || [],
      ).filter((el) => {
        const bounds = el.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 &&
          window.getComputedStyle(el).visibility === "visible" &&
          !el.closest("[inert]");
      });
    const focusFirst = () => {
      if (!disposed && !sidebarRef.current?.contains(document.activeElement))
        focusables()[0]?.focus({ preventScroll: true });
    };
    focusFirst();
    let initialFocusFrame = window.requestAnimationFrame(() => {
      focusFirst();
      // Retry only when the opening commit still has no focus in the drawer.
      if (!sidebarRef.current?.contains(document.activeElement))
        initialFocusFrame = window.requestAnimationFrame(focusFirst);
    });
    const settled = (event: TransitionEvent) => {
      if (
        !disposed && event.target === sidebar &&
        (event.propertyName === "transform" || event.propertyName === "visibility")
      ) {
        window.cancelAnimationFrame(initialFocusFrame);
        initialFocusFrame = window.requestAnimationFrame(focusFirst);
      }
    };
    sidebar?.addEventListener("transitionend", settled);
    const settledFocusTimer = window.setTimeout(focusFirst, 250);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab") {
        const list = focusables(),
          first = list[0],
          last = list.at(-1);
        if (!first || !last) {
          e.preventDefault();
        } else if (!list.includes(document.activeElement as HTMLButtonElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    const resize = () => {
      if (window.innerWidth > 760) setMobileOpen(false);
    };
    document.addEventListener("keydown", key);
    window.addEventListener("resize", resize);
    return () => {
      mobileFocusReturnPending.current = true;
      disposed = true;
      window.cancelAnimationFrame(initialFocusFrame);
      window.clearTimeout(settledFocusTimer);
      sidebar?.removeEventListener("transitionend", settled);
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
    };
  }, [mobileOpen]);

  function navigate(next: Page) {
    if (next !== page) {
      pendingOperationsRefresh.current = null;
      setOperationsRefreshing(false);
    }
    setPage(next);
    if (next !== "watchlists") setWatchlistEntryIntent(null);
    setQuery("");
    setMobileOpen(false);
    window.history.replaceState(null, "", `#${next}`);
  }
  function skipToContent(event: ReactMouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    const target = mainContentRef.current;
    if (!target || target.closest("[inert]")) return;
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "start", behavior: "instant" });
  }
  function openReviewAlerts(alertKind: ReviewAlertFilter) {
    if (!allowed) return;
    setWatchlistEntryIntent((current) =>
      nextWatchlistEntryIntent(current, alertKind),
    );
    navigate("watchlists");
  }
  function startDemo() {
    pendingEntryScroll.current = true;
    requestGeneration.current++;
    pendingOperationsRefresh.current = null;
    setOperationsRefreshing(false);
    setDemo(true);
    setUser(demoUser);
    setWorkspace(demoWorkspace());
    setError("");
    setLoading(false);
    navigate("home");
  }
  async function logout() {
    if (loggingOut) return;
    if (!demo) {
      setLoggingOut(true);
      try {
        await api("/logout", "POST", {});
      } catch (e) {
        notify((e as Error).message, "error");
        setLoggingOut(false);
        return;
      }
    }
    requestGeneration.current++;
    pendingOperationsRefresh.current = null;
    setOperationsRefreshing(false);
    setDemo(false);
    setUser(null);
    setWorkspace(null);
    setEditor(null);
    setEntityDetail(null);
    setMemberDetail(null);
    setLoggingOut(false);
    setMemberDetailContext(null);
    navigate("home");
    void boot();
  }
  function saved() {
    setEditor(null);
    setEntityDetail(null);
    setMemberDetail(null);
    setMemberDetailContext(null);
    setWatchlistRevision((value) => value + 1);
    notify("Değişiklik kaydedildi.");
    void refresh();
  }
  function membershipChanged(updated: Membership) {
    // The write/reload response is authoritative. An earlier workspace request
    // must not restore a membership snapshot from before this response.
    requestGeneration.current++;
    setWorkspace((current) => current ? {
      ...current,
      memberships: current.memberships.map((item) =>
        item.id === updated.id && item.version <= updated.version
          ? updated
          : item,
      ),
    } : current);
    setMemberDetail((current) =>
      current?.id === updated.id && current.version <= updated.version
        ? updated
        : current,
    );
    setMemberDetailContext((current) => current ? {
      ...current,
      memberships: current.memberships.map((item) => item.id === updated.id ? updated : item),
    } : current);
    setWatchlistRevision((value) => value + 1);
    // A targeted membership read cannot certify the rest of the workspace.
    // Reload every collection while keeping the modal and its drafts mounted.
    void refresh();
  }
  function openWatchlistMembership(entry: WatchlistEntry) {
    setMemberDetailContext({
      entities: [entry.entity], groups: [entry.group],
      memberships: [entry.membership], audit: [],
    });
    setMemberDetail(entry.membership);
  }
  function openGroup(group: Group) {
    setGroupFilter(group.id);
    setMembershipFilter("all");
    navigate("memberships");
  }
  function openReviewQueue(filter: ReviewQueueFilter = "attention") {
    setMembershipFilter("review");
    setReviewFilter(filter);
    setGroupFilter("");
    navigate("memberships");
  }
  const editable = allowed && !demo && !loading && !error;
  const detailWorkspace = memberDetailContext?.memberships.some((item) => item.id === memberDetail?.id)
    ? memberDetailContext
    : workspace;
  const newButton = (kind: EditorState["kind"], label: string) =>
    editable ? (
      <button
        className="btn primary"
        onClick={() =>
          setEditor(
            kind === "membership" ? { kind, groupId: groupFilter } : { kind },
          )
        }
      >
        <Plus size={17} />
        {label}
      </button>
    ) : null;

  if (booting)
    return (
      <div className="startup">
        <Brand />
        <Loading label="Uygulama durumu yükleniyor…" />
      </div>
    );
  if (bootError && !demo)
    return (
      <div className="startup">
        <Brand />
        <LoadError
          title="Veriler alınamadı"
          message={bootError}
          onRetry={() => void boot()}
        />
        <button className="btn secondary" onClick={startDemo}>
          Kurgusal örneği incele
        </button>
      </div>
    );
  if (!user)
    return (
      <>
        <Auth
          initialized={status?.initialized ?? false}
          onLogin={(u) => {
            pendingEntryScroll.current = true;
            setUser(u);
            setStatus((s) => (s ? { ...s, initialized: true } : s));
          }}
          onDemo={startDemo}
        />
        {notice && (
          <div className={`toast ${noticeTone}`} role="status">
            {notice}
          </div>
        )}
      </>
    );

  const heading = pages[page];
  const visiblePage = (p: Page) =>
    (allowed || p === "account" || p === "settings") &&
    (p !== "audit" || user.role === "admin") &&
    (p !== "users" || (!demo && user.role === "admin"));
  const exportResult = (result: ExportResult) =>
    result.ok
      ? notify(`${result.fileName} indirildi; işlem günlüğüne kaydedildi.`)
      : notify(result.message, "error");
  const today = utcToday();
  const workspaceRefresh: WorkspaceRefreshState = {
    loading,
    error,
    onRetry: () => void refresh(),
  };
  const activeMemberships =
    workspace?.memberships.filter(membershipIsActive) || [];
  const dueMemberships = (workspace?.memberships || []).filter(
    (m) => reviewNeedsAttention(classifyMembershipReview(m, today)),
  ).sort(compareMembershipReview);
  const entities =
    workspace?.entities.filter(
      (e) =>
        (entityFilter === "all" || e.kind === entityFilter) &&
        matches(query, e.name, e.department, e.identifier, e.description),
    ) || [];
  const groups =
    workspace?.groups.filter((g) =>
      matches(query, g.name, g.description, colorLabels[g.color]),
    ) || [];
  const membershipScope =
    workspace?.memberships.filter(
      (m) =>
        (!groupFilter || m.groupId === groupFilter) &&
        matches(
          query,
          workspace.entities.find((e) => e.id === m.entityId)?.name || "",
          workspace.groups.find((g) => g.id === m.groupId)?.name || "",
          m.reason,
          m.responsible,
        ),
    ) || [];
  const memberships = membershipScope.filter((m) =>
    membershipFilter === "all" ||
    (membershipFilter === "review"
      ? matchesReviewQueue(classifyMembershipReview(m, today), reviewFilter)
      : membershipState(m) === membershipFilter),
  );
  if (membershipFilter === "review") memberships.sort(compareMembershipReview);

  function membershipEmptyState() {
    if (!workspace) return null;
    if (!workspace.memberships.length) {
      const missingEntities = !workspace.entities.length;
      const missingGroups = !workspace.groups.length;
      return (
        <Empty
          title="Henüz inceleme üyeliği yok"
          action={
            missingEntities || missingGroups ? (
              <button
                className="btn secondary"
                type="button"
                onClick={() => navigate(missingEntities ? "entities" : "groups")}
              >
                {missingEntities ? "Varlıkları aç" : "Grupları aç"}
              </button>
            ) : newButton("membership", "Üyelik ekle")
          }
        >
          {missingEntities || missingGroups
            ? "İnceleme üyeliği için önce bir varlık ve izleme grubu gerekir."
            : "İlk üyeliği gerekçesi, sorumlusu ve inceleme tarihiyle kaydedin."}
        </Empty>
      );
    }
    if (!membershipScope.length) {
      return (
        <Empty
          title="Arama veya grup filtresine uyan üyelik yok"
          action={
            <button
              className="btn secondary"
              type="button"
              onClick={() => { setQuery(""); setGroupFilter(""); }}
            >
              Arama ve grup filtresini temizle
            </button>
          }
        >
          Kayıtlar mevcut. Arama metnini veya seçili grubu değiştirerek yeniden bakın.
        </Empty>
      );
    }
    return (
      <Empty
        title={membershipFilter === "review"
          ? "Seçili inceleme döneminde üyelik yok"
          : "Seçili durumda üyelik yok"}
        action={
          <button className="btn secondary" type="button" onClick={() => setMembershipFilter("all")}>
            Tüm üyelikleri göster
          </button>
        }
      >
        {membershipFilter === "review"
          ? "Bu dönemde incelenecek kayıt görünmüyor. Diğer dönemler için inceleme filtresini değiştirin."
          : "Diğer durumdaki kayıtları görmek için tüm üyelikleri açın."}
      </Empty>
    );
  }

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link" onClick={skipToContent}>
        İçeriğe geç
      </a>
      {mobileOpen && (
        <div
          className="nav-scrim"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={`sidebar ${mobileOpen ? "open" : ""}`}
        ref={sidebarRef}
        aria-label="Ana gezinme"
        id="main-navigation"
      >
        <div className="sidebar-brand">
          <Brand />
          <button
            className="icon-btn mobile-menu"
            aria-label="Menüyü kapat"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="palette-nav-trigger"
          type="button"
          onClick={() => {
            setMobileOpen(false);
            setPaletteOpen(true);
          }}
        >
          <Search size={15} />
          <span>Ara veya git…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav aria-label="Modüller">
          {navSections.map((section) => {
            const items = section.pages.filter(visiblePage);
            if (!items.length) return null;
            return (
              <div className="nav-section" key={section.label}>
                <p className="nav-label">{section.label}</p>
                {items.map((p) => {
                  const Icon = pages[p].icon;
                  return (
                    <button
                      key={p}
                      className={`nav-item ${page === p ? "active" : ""}`}
                      aria-current={page === p ? "page" : undefined}
                      onClick={() => navigate(p)}
                    >
                      <Icon size={17} />
                      {pages[p].title}
                      {p === "memberships" && !loading && !error && !!dueMemberships.length && (
                        <span className="nav-count" aria-label={`${dueMemberships.length} işlem bekleyen inceleme`}>
                          {dueMemberships.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <p className="sidebar-meta">
            <span aria-hidden="true" />
            {demo ? "Kurgusal örnek" : "Yerel çalışma alanı"} · {PRODUCT_VERSION} · Canlı toplama kapalı
          </p>
          <div className="sidebar-user">
            <Avatar name={user.name} small />
            <div>
              <strong>{user.name}</strong>
              <small>
                {demo ? "Salt okunur örnek" : roleLabels[user.role]}
              </small>
            </div>
            <button
              className="icon-btn"
              aria-label={demo ? "Örnekten çık" : "Çıkış yap"}
              disabled={loggingOut}
              onClick={() => void logout()}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div
        className="main-shell"
        inert={mobileOpen || !!editor || !!entityDetail || !!memberDetail}
      >
        <header className="topbar">
          <button
            ref={menuRef}
            className="icon-btn mobile-menu"
            aria-label="Menüyü aç"
            aria-expanded={mobileOpen}
            aria-controls="main-navigation"
            onClick={() => setMobileOpen(true)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            XLab Vigil
            <ChevronRight size={14} />
            <strong>{heading.title}</strong>
          </div>
          {page !== "settings" && page !== "watchlists" && page !== "home" && page !== "account" ? (
            <label className="global-search">
              <Search size={16} />
              <span className="sr-only">{searchPrompt}</span>
              <input
                aria-label={searchPrompt}
                value={query}
                maxLength={
                  serverSearchPage ? MAX_LIST_SEARCH_LENGTH * 2 : undefined
                }
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPrompt}
                disabled={!allowed}
              />
              {query && (
                <button
                  className="icon-btn"
                  onClick={() => setQuery("")}
                  aria-label="Aramayı temizle"
                >
                  <X size={14} />
                </button>
              )}
            </label>
          ) : (
            <span className="topbar-spacer" />
          )}
          <div className="topbar-tools">
            <button
              className="palette-trigger"
              type="button"
              aria-label="Komut paletini aç (Ctrl+K)"
              onClick={() => setPaletteOpen(true)}
            >
              <Command size={15} />
              <span className="palette-trigger-text">Komutlar</span>
              <kbd>Ctrl K</kbd>
            </button>
            {allowed && (
              <HeaderWarnings
                key={`${user.id}-${demo}`}
                demo={demo}
                demoWorkspace={demo ? workspace ?? demoWorkspace() : { entities: [], groups: [], memberships: [], audit: [] }}
                revision={watchlistRevision}
                onNavigate={navigate}
                onOpenReviewAlerts={openReviewAlerts}
                onSessionExpired={sessionExpired}
              />
            )}
            <button
              className="icon-btn theme-toggle"
              type="button"
              aria-label={`${themeLabels[theme.preference]} etkin. ${themeLabels[nextThemePreference(theme.preference)]} seçmek için tıklayın.`}
              title={themeLabels[theme.preference]}
              onClick={() => theme.choose(nextThemePreference(theme.preference))}
            >
              {theme.preference === "dark" ? <Moon size={16} /> : theme.preference === "light" ? <Sun size={16} /> : <MonitorCog size={16} />}
            </button>
          </div>
        </header>
        {demo && (
          <div className="demo-banner">
            <span>
              <Info size={16} />
              <strong>Kurgusal örnek</strong>
              <span className="demo-detail">
                Tüm kayıtlar örnektir; değişiklik yapılamaz.
              </span>
            </span>
            <button onClick={() => void logout()}>
              Örnekten çık
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        <main
          className="main-content"
          id="main-content"
          tabIndex={-1}
          ref={mainContentRef}
          aria-labelledby={pageHeadingId}
        >
          <div className="page-heading">
            <div>
              <span className="page-meta">
                {new Date().toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                  timeZone: "UTC",
                })} · UTC
              </span>
              <h1 id={pageHeadingId}>{heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            <div className="page-actions">
            {allowed && (page === "entities" || page === "memberships") && (
              <ExportButton
                path={page === "entities" ? "/entities/export" : "/memberships/export"}
                demo={demo}
                disabled={!workspace || loading || !!error}
                onSessionExpired={sessionExpired}
                onResult={exportResult}
              />
            )}
            {page === "entities" ? (
              newButton("entity", "Varlık ekle")
            ) : page === "groups" ? (
              newButton("group", "Grup oluştur")
            ) : page === "memberships" &&
              workspace?.entities.length &&
              workspace?.groups.length ? (
              newButton("membership", "Üyelik ekle")
            ) : allowed && !demo && page !== "account" && page !== "settings" ? (
              <button
                className="btn secondary"
                disabled={operationsPage ? operationsRefreshing : loading}
                aria-busy={operationsPage ? operationsRefreshing : loading}
                onClick={() => {
                  if (operationsPage) {
                    const token = ++operationsRefreshSerial.current;
                    pendingOperationsRefresh.current = {
                      token,
                      page,
                      userId: user.id,
                      demo,
                    };
                    setOperationsRefreshing(true);
                    setOperationsRefresh(token);
                  } else void refresh();
                }}
              >
                <RefreshCw
                  size={16}
                  className={
                    (operationsPage ? operationsRefreshing : loading)
                      ? "spin"
                      : ""
                  }
                />
                {(operationsPage ? operationsRefreshing : loading)
                  ? "Yenileniyor…"
                  : "Yenile"}
              </button>
            ) : null}
            </div>
          </div>
          {page === "account" ? (
            <AccountCenter
              user={user}
              demo={demo}
              onSessionExpired={sessionExpired}
            />
          ) : page === "settings" ? (
            <WorkingGuide user={user} demo={demo} status={status} onNavigate={navigate} />
          ) : !allowed ? (
            <Empty title="Bu alan için erişiminiz yok">
              Vigil inceleme verilerine yalnızca yönetici ve analist rolleri
              erişebilir. Oturum rolünüz: {roleLabels[user.role]}.
            </Empty>
          ) : page === "watchlists" ? (
            <WatchlistCenter
              key={`${user.id}-${demo}`}
              demo={demo}
              demoWorkspace={demo ? workspace ?? demoWorkspace() : { entities: [], groups: [], memberships: [], audit: [] }}
              onOpenMembership={openWatchlistMembership}
              onNavigate={navigate}
              onSessionExpired={sessionExpired}
              refreshToken={operationsRefreshToken}
              onRefreshComplete={operationsRefreshComplete}
              revision={watchlistRevision}
              entryIntent={watchlistEntryIntent}
            />
          ) : page === "cases" ? (
            <CaseCenter
              key={`${user.id}-${demo}`}
              demo={demo}
              query={query}
              onSessionExpired={sessionExpired}
              refreshToken={operationsRefreshToken}
              onRefreshComplete={operationsRefreshComplete}
                onExportResult={exportResult}
            />
          ) : page === "sources" ? (
            <SourceManager
              key={`${user.id}-${demo}`}
              user={user}
              demo={demo}
              query={query}
              onSessionExpired={sessionExpired}
              refreshToken={operationsRefreshToken}
              onRefreshComplete={operationsRefreshComplete}
            />
          ) : page === "events" ? (
            <EventCenter
              key={`${user.id}-${demo}`}
              user={user}
              demo={demo}
              query={query}
              onSessionExpired={sessionExpired}
              refreshToken={operationsRefreshToken}
              onRefreshComplete={operationsRefreshComplete}
                onExportResult={exportResult}
              onDataChanged={warningsChanged}
            />
          ) : page === "notifications" ? (
            <NotificationCenter
              key={`${user.id}-${demo}`}
              user={user}
              demo={demo}
              query={query}
              onSessionExpired={sessionExpired}
              refreshToken={operationsRefreshToken}
              onRefreshComplete={operationsRefreshComplete}
              onDataChanged={warningsChanged}
            />
          ) : page === "audit" ? (
            user.role === "admin" ? (
              <AuditCenter
                key={`${user.id}-${demo}`}
                demo={demo}
                query={query}
                onSessionExpired={sessionExpired}
                refreshToken={operationsRefreshToken}
                onRefreshComplete={operationsRefreshComplete}
                onExportResult={exportResult}
              />
            ) : (
              <Empty title="Yönetici yetkisi gerekir">
                İşlem günlüğünü yalnızca yöneticiler görüntüleyebilir.
              </Empty>
            )
          ) : page === "users" ? (
            !demo && user.role === "admin" ? (
              <UserManager
                key={user.id}
                currentUser={user}
                query={query}
                onSessionExpired={sessionExpired}
                refreshToken={operationsRefreshToken}
                onRefreshComplete={operationsRefreshComplete}
              />
            ) : (
              <Empty title="Yönetici yetkisi gerekir">
                Yerel kullanıcı ve rol yönetimini yalnızca yöneticiler açabilir.
              </Empty>
            )
          ) : loading ? (
            <Loading label="Çalışma alanı verileri yükleniyor…" />
          ) : error ? (
            <LoadError
              title="Veriler alınamadı"
              message={error}
              onRetry={() => void refresh()}
            />
          ) : workspace ? (
            <>
              {page === "home" && (
                <Dashboard
                  key={`${user.id}-${demo}`}
                  workspace={workspace}
                  demo={demo}
                  today={today}
                  onNavigate={navigate}
                  onOpenReviewQueue={openReviewQueue}
                  onOpenActiveMemberships={() => {
                    setMembershipFilter("active");
                    setGroupFilter("");
                    navigate("memberships");
                  }}
                  onOpenMembership={setMemberDetail}
                  onOpenGroup={openGroup}
                  onSessionExpired={sessionExpired}
                  createAction={newButton}
                />
              )}
              {page === "entities" && (
                <>
                  <div className="collection-toolbar">
                    <div className="tabs" role="group" aria-label="Varlık türü">
                      <button
                        className={entityFilter === "all" ? "selected" : ""}
                        aria-pressed={entityFilter === "all"}
                        onClick={() => setEntityFilter("all")}
                      >
                        Tümü <span>{workspace.entities.length}</span>
                      </button>
                      {Object.entries(entityLabels).map(([kind, label]) => (
                        <button
                          key={kind}
                          className={entityFilter === kind ? "selected" : ""}
                          aria-pressed={entityFilter === kind}
                          onClick={() => setEntityFilter(kind)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <span className="muted">{entities.length} kayıt</span>
                  </div>
                  <div className="info-strip">
                    <Fingerprint size={18} />
                    <p>
                      Kimlikler ve personel ilişkileri manuel aday kayıtlardır.
                      Kaynak doğrulaması ve otomatik olay eşleştirmesi henüz
                      yapılmaz.
                    </p>
                  </div>
                  {entities.length ? (
                    <div className="entity-grid">
                      {entities.map((e) => (
                        <EntityCard
                          key={e.id}
                          entity={e}
                          workspace={workspace}
                          onOpen={() => setEntityDetail(e)}
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={
                        workspace.entities.length
                          ? "Eşleşen varlık bulunamadı"
                          : "Henüz varlık eklenmedi"
                      }
                      action={workspace.entities.length ? (
                        <button className="btn secondary" type="button" onClick={() => { setQuery(""); setEntityFilter("all"); }}>
                          Filtreleri temizle
                        </button>
                      ) : newButton("entity", "Varlık ekle")}
                    >
                      {workspace.entities.length
                        ? "Aramayı veya tür filtresini değiştirin."
                        : "Personelleri ve kurumsal hesap, cihaz, servis veya uygulamaları kaydederek başlayın."}
                    </Empty>
                  )}
                </>
              )}
              {page === "groups" && (
                <>
                  <div className="info-strip">
                    <Info size={18} />
                    <p>
                      Renkler inceleme önceliğidir. Bir varlık birden fazla
                      gruba eklenebilir; her üyeliğin gerekçesi, sorumlusu ve
                      süresi ayrı tutulur.
                    </p>
                  </div>
                  {groups.length ? (
                    <div className="group-grid">
                      {groups.map((g) => (
                        <GroupCard
                          key={g.id}
                          group={g}
                          count={
                            activeMemberships.filter((m) => m.groupId === g.id)
                              .length
                          }
                          onOpen={() => openGroup(g)}
                          onEdit={
                            editable
                              ? () => setEditor({ kind: "group", value: g })
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title={
                        workspace.groups.length
                          ? "Eşleşen grup bulunamadı"
                          : "İlk izleme grubunuzu oluşturun"
                      }
                      action={workspace.groups.length ? (
                        <button className="btn secondary" type="button" onClick={() => setQuery("")}>
                          Aramayı temizle
                        </button>
                      ) : newButton("group", "Grup oluştur")}
                    >
                      {workspace.groups.length
                        ? "Kayıtlı gruplar mevcut. Arama metnini değiştirerek yeniden bakın."
                        : "Gruplar boş başlar. Kurumunuzun inceleme kapsamına uygun bir ad ve renk seçin."}
                    </Empty>
                  )}
                </>
              )}
              {page === "memberships" && (
                <>
                  <div className="collection-toolbar memberships-toolbar">
                    <div className="tabs" role="group" aria-label="Üyelik durumu">
                      {[
                        ["active", "Etkin"],
                        ["review", "Gözden geçirme"],
                        ["scheduled", "Planlandı"],
                        ["expired", "Süresi doldu"],
                        ["closed", "Kapatıldı"],
                        ["all", "Tümü"],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={
                            membershipFilter === value ? "selected" : ""
                          }
                          aria-pressed={membershipFilter === value}
                          onClick={() => setMembershipFilter(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="filter-select">
                      <SlidersHorizontal size={16} />
                      <span className="sr-only">Gruba göre filtrele</span>
                      <select
                        value={groupFilter}
                        onChange={(e) => setGroupFilter(e.target.value)}
                      >
                        <option value="">Tüm gruplar</option>
                        {workspace.groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {membershipFilter === "review" && (
                    <ReviewQueueFilters
                      memberships={membershipScope}
                      today={today}
                      value={reviewFilter}
                      onChange={setReviewFilter}
                    />
                  )}
                  <div className="collection-caption">
                    <span>{memberships.length} gösterilen üyelik</span>
                    <span>
                      {membershipFilter === "review" ? "İnceleme tarihi sırasıyla · " : ""}
                      Gün sınırı: UTC · Bitiş günü dahil
                    </span>
                  </div>
                  {memberships.length ? (
                    <div className="membership-list">
                      {memberships.map((m) => (
                        <MembershipCard
                          key={m.id}
                          membership={m}
                          workspace={workspace}
                          today={today}
                          onOpen={() => setMemberDetail(m)}
                        />
                      ))}
                    </div>
                  ) : membershipEmptyState()}
                </>
              )}
            </>
          ) : (
            <Loading label="Sayfa verileri yükleniyor…" />
          )}
        </main>
      </div>
      {editor && workspace && (
        <Editor
          editor={editor}
          workspace={workspace}
          onClose={() => setEditor(null)}
          onSaved={saved}
          onSessionExpired={sessionExpired}
          workspaceRefresh={workspaceRefresh}
          writeBlocked={loading || !!error}
        />
      )}
      {entityDetail && workspace && (
        <EntityDetail
          entity={entityDetail}
          workspace={workspace}
          demo={demo}
          onSessionExpired={sessionExpired}
          workspaceRefresh={workspaceRefresh}
          onClose={() => setEntityDetail(null)}
          onEdit={
            editable
              ? () => {
                  setEditor({ kind: "entity", value: entityDetail });
                  setEntityDetail(null);
                }
              : undefined
          }
          onAddMembership={
            editable && workspace.groups.length
              ? () => {
                  setEditor({ kind: "membership", entityId: entityDetail.id });
                  setEntityDetail(null);
                }
              : undefined
          }
          onOpenMember={(m) => {
            setEntityDetail(null);
            setMemberDetail(m);
          }}
        />
      )}
      {memberDetail && detailWorkspace && (
        <MembershipDetail
          key={`${demo}:${memberDetail.id}`}
          membership={memberDetail}
          workspace={detailWorkspace}
          demo={demo}
          onSessionExpired={sessionExpired}
          onMembershipChanged={membershipChanged}
          workspaceRefresh={workspaceRefresh}
          onClose={() => { setMemberDetail(null); setMemberDetailContext(null); }}
          onEdit={
            editable && workspace
              ? () => {
                  setEditor({ kind: "membership", value: memberDetail });
                  setMemberDetail(null);
                  setMemberDetailContext(null);
                }
              : undefined
          }
        />
      )}
      {paletteOpen && (
        <CommandPalette
          pages={navSections.flatMap((section) => section.pages).filter(visiblePage).map((p) => {
            const Icon = pages[p].icon;
            return { page: p, title: pages[p].title, icon: <Icon size={16} /> };
          })}
          workspace={allowed ? workspace : null}
          searchTargets={allowed && !demo ? paletteSearchTargets.filter((target) => target.page !== "audit" || user.role === "admin") : []}
          canCreate={{
            entity: editable,
            group: editable,
            membership: editable && !!workspace?.entities.length && !!workspace?.groups.length,
          }}
          theme={theme.preference}
          onClose={() => setPaletteOpen(false)}
          onNavigate={navigate}
          onServerSearch={(target: PaletteServerSearch, value: string) => {
            navigate(target);
            setQuery(value);
          }}
          onOpenEntity={setEntityDetail}
          onOpenMembership={setMemberDetail}
          onOpenGroup={openGroup}
          onCreate={(kind) => setEditor(kind === "membership" ? { kind, groupId: groupFilter } : { kind })}
          onOpenReviewQueue={() => openReviewQueue()}
          onTheme={theme.choose}
        />
      )}
      {notice && (
        <div className={`toast ${noticeTone}`} role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  count,
  onOpen,
  onEdit,
}: {
  group: Group;
  count: number;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <article className={`group-card ${group.color}`}>
      <div className="group-card-top">
        <span className={`group-symbol ${group.color}`}>
          <Shield size={21} />
        </span>
        <Badge tone={group.color}>{colorLabels[group.color]}</Badge>
        {onEdit && (
          <button
            className="icon-btn"
            aria-label={`${group.name} grubunu düzenle`}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
        )}
      </div>
      <button className="card-title" onClick={onOpen}>
        <h3>{group.name}</h3>
      </button>
      <p>{group.description || "Grup açıklaması eklenmedi."}</p>
      <footer>
        <span>
          <strong>{count}</strong> etkin üyelik
        </span>
        <button className="link-btn" onClick={onOpen}>
          İncele
          <ArrowRight size={15} />
        </button>
      </footer>
    </article>
  );
}
function EntityCard({
  entity,
  workspace,
  onOpen,
}: {
  entity: Entity;
  workspace: Workspace;
  onOpen: () => void;
}) {
  const memberships = workspace.memberships.filter(
    (m) => m.entityId === entity.id && membershipIsActive(m),
  );
  const person = workspace.entities.find((e) => e.id === entity.personId);
  return (
    <button className="entity-card" onClick={onOpen}>
      <div className="entity-card-top">
        <EntitySymbol kind={entity.kind} />
        <Badge>{entityLabels[entity.kind]}</Badge>
      </div>
      <h3>{entity.name}</h3>
      <p>{entity.department || "Birim belirtilmedi"}</p>
      <div className="entity-identifier">
        <Fingerprint size={14} />
        <span>{entity.identifier || "Tanımlayıcı girilmedi"}</span>
      </div>
      {person && (
        <div className="entity-person">
          <UserRound size={14} />
          <span>{person.name}</span>
          <small>Aday ilişki</small>
        </div>
      )}
      <div className="entity-groups">
        {memberships.length ? (
          memberships.map((m) => {
            const g = workspace.groups.find((g) => g.id === m.groupId);
            return (
              <Badge key={m.id} tone={g?.color}>
                {g?.name || "Grup"}
              </Badge>
            );
          })
        ) : (
          <span className="muted">Etkin grup üyeliği yok</span>
        )}
      </div>
      <footer>
        <span className="candidate-dot" />
        Manuel · Doğrulanmadı
        <ChevronRight size={16} />
      </footer>
    </button>
  );
}
function MembershipCard({
  membership: m,
  workspace,
  today,
  onOpen,
}: {
  membership: Membership;
  workspace: Workspace;
  today: string;
  onOpen: () => void;
}) {
  const entity = workspace.entities.find((e) => e.id === m.entityId),
    group = workspace.groups.find((g) => g.id === m.groupId);
  return (
    <button
      className={`membership-card ${group?.color || "slate"}`}
      onClick={onOpen}
    >
      <div className="membership-primary">
        <div className="membership-title">
          <h3>{entity?.name || "Varlık"}</h3>
          <Badge tone={group?.color}>{group?.name || "Grup"}</Badge>
          <MembershipBadge membership={m} />
        </div>
        <p>{m.reason}</p>
        <div className="membership-meta">
          <span>
            <UserRound size={14} />
            {m.responsible}
          </span>
          <span>{entity ? entityLabels[entity.kind] : "Kayıt"}</span>
          <span>
            {dateLabel(m.startsOn)} – {dateLabel(m.endsOn)}
          </span>
        </div>
      </div>
      <div className="membership-review">
        <CalendarClock size={18} />
        <div>
          <span>Gözden geçirme</span>
          <strong>{dateLabel(m.reviewOn, true)}</strong>
          <ReviewScheduleBadge membership={m} today={today} />
        </div>
        <ChevronRight size={17} />
      </div>
    </button>
  );
}
function EntityDetail({
  entity,
  workspace,
  demo,
  onSessionExpired,
  workspaceRefresh,
  onClose,
  onEdit,
  onAddMembership,
  onOpenMember,
}: {
  entity: Entity;
  workspace: Workspace;
  demo: boolean;
  onSessionExpired: () => void;
  workspaceRefresh: WorkspaceRefreshState;
  onClose: () => void;
  onEdit?: () => void;
  onAddMembership?: () => void;
  onOpenMember: (m: Membership) => void;
}) {
  const related = workspace.entities.filter((e) => e.personId === entity.id),
    person = workspace.entities.find((e) => e.id === entity.personId);
  const memberships = workspace.memberships.filter(
    (m) => m.entityId === entity.id,
  );
  return (
    <Modal
      title={entity.name}
      subtitle={`${entityLabels[entity.kind]} · Manuel aday kayıt`}
      onClose={onClose}
      wide
    >
      <div className="detail-body">
        <WorkspaceRefreshNotice {...workspaceRefresh} />
        <div className="detail-top">
          <EntitySymbol kind={entity.kind} />
          <Badge tone="yellow">Kimlik doğrulanmadı</Badge>
          <span className="muted">Sürüm {entity.version}</span>
        </div>
        <dl className="detail-facts">
          <div>
            <dt>Birim</dt>
            <dd>{entity.department || "Belirtilmedi"}</dd>
          </div>
          <div>
            <dt>Tanımlayıcı</dt>
            <dd>{entity.identifier || "Belirtilmedi"}</dd>
          </div>
          <div>
            <dt>Oluşturulma</dt>
            <dd>{dateLabel(entity.createdAt, true)}</dd>
          </div>
          <div>
            <dt>Son güncelleme</dt>
            <dd>{dateLabel(entity.updatedAt, true)}</dd>
          </div>
        </dl>
        {entity.description && (
          <p className="detail-description">{entity.description}</p>
        )}
        {person && (
          <div className="info-strip">
            <UserRound size={18} />
            <p>
              İlişkili personel: <strong>{person.name}</strong>. Bu ilişki
              manuel kaydedilmiştir; kaynak doğrulaması bekleniyor.
            </p>
          </div>
        )}
        {entity.kind === "person" && (
          <section className="detail-section">
            <h3>İlişkili hesap ve cihazlar</h3>
            {related.length ? (
              <ul className="related-list">
                {related.map((e) => (
                  <li key={e.id}>
                    <EntitySymbol kind={e.kind} />
                    <div>
                      <strong>{e.name}</strong>
                      <small>{e.identifier || entityLabels[e.kind]}</small>
                    </div>
                    <Badge>Aday ilişki</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">
                Henüz hesap veya cihaz ilişkilendirilmedi.
              </p>
            )}
          </section>
        )}
        <section className="detail-section">
          <div className="section-heading">
            <h3>Grup üyelikleri ve geçmiş</h3>
            {onAddMembership && (
              <button className="link-btn" onClick={onAddMembership}>
                <Plus size={15} />
                Üyelik ekle
              </button>
            )}
          </div>
          {memberships.length ? (
            <div className="detail-memberships">
              {memberships.map((m) => (
                <button key={m.id} onClick={() => onOpenMember(m)}>
                  <Badge
                    tone={
                      workspace.groups.find((g) => g.id === m.groupId)?.color
                    }
                  >
                    {workspace.groups.find((g) => g.id === m.groupId)?.name ||
                      "Grup"}
                  </Badge>
                  <MembershipBadge membership={m} />
                  <span>{dateLabel(m.endsOn)}</span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">Bu varlığın grup üyeliği bulunmuyor.</p>
          )}
        </section>
        <CandidateEvents
          entityId={entity.id}
          demo={demo}
          onSessionExpired={onSessionExpired}
        />
      </div>
      <footer className="modal-actions">
        <button className="btn secondary" onClick={onClose}>
          Kapat
        </button>
        {onEdit && (
          <button className="btn primary" onClick={onEdit}>
            <Pencil size={16} />
            Düzenle
          </button>
        )}
      </footer>
    </Modal>
  );
}
function MembershipDetail({
  membership: m,
  workspace,
  demo,
  onSessionExpired,
  onMembershipChanged,
  workspaceRefresh,
  onClose,
  onEdit,
}: {
  membership: Membership;
  workspace: Workspace;
  demo: boolean;
  onSessionExpired: () => void;
  onMembershipChanged: (updated: Membership) => void;
  workspaceRefresh: WorkspaceRefreshState;
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [activityRevision, setActivityRevision] = useState(0);
  const [reviewPending, setReviewPending] = useState(false);
  const [reviewHasDraft, setReviewHasDraft] = useState(false);
  const [discardIntent, setDiscardIntent] = useState<"close" | "edit" | null>(null);
  const discardTitleId = useId();
  const discardCancelRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (discardIntent) discardCancelRef.current?.focus();
  }, [discardIntent]);

  function cancelDiscard() {
    const returnTarget = discardIntent === "edit" ? editButtonRef.current : closeButtonRef.current;
    setDiscardIntent(null);
    requestAnimationFrame(() => returnTarget?.focus());
  }

  function requestTransition(intent: "close" | "edit") {
    if (reviewPending || (intent === "edit" && !onEdit)) return;
    if (discardIntent) {
      if (intent === "close") cancelDiscard();
      return;
    }
    if (reviewHasDraft) {
      setDiscardIntent(intent);
      return;
    }
    if (intent === "edit") onEdit?.();
    else onClose();
  }

  function discardAndContinue() {
    if (!discardIntent || reviewPending) return;
    if (discardIntent === "edit") onEdit?.();
    else onClose();
  }
  const entity = workspace.entities.find((e) => e.id === m.entityId),
    group = workspace.groups.find((g) => g.id === m.groupId);
  return (
    <Modal
      title={entity?.name || "İnceleme üyeliği"}
      subtitle="Grup üyeliği, olay ilişkileri ve inceleme etkinliği"
      onClose={() => requestTransition("close")}
      closeDisabled={reviewPending}
      wide
    >
      <div className="detail-body">
        <WorkspaceRefreshNotice {...workspaceRefresh} />
        <div className="detail-top">
          <Badge tone={group?.color}>{group?.name || "Grup"}</Badge>
          <MembershipBadge membership={m} />
          <span className="muted">Sürüm {m.version}</span>
        </div>
        <h3 className="small-heading">İnceleme gerekçesi</h3>
        <p className="detail-description">{m.reason}</p>
        <dl className="detail-facts">
          <div>
            <dt>İnceleme sorumlusu</dt>
            <dd>{m.responsible}</dd>
          </div>
          <div>
            <dt>Gözden geçirme</dt>
            <dd>{dateLabel(m.reviewOn, true)}</dd>
          </div>
          <div>
            <dt>Başlangıç (UTC)</dt>
            <dd>{m.startsOn}</dd>
          </div>
          <div>
            <dt>Bitiş (UTC, dahil)</dt>
            <dd>{m.endsOn}</dd>
          </div>
        </dl>
        <div className="info-strip">
          <Info size={18} />
          <p>
            Manuel inceleme kaydıdır. Otomatik tespit, doğrulanmış tehdit veya
            hesap engelleme işlemi içermez.
          </p>
        </div>
        <MembershipReview
          membership={m}
          demo={demo}
          onSessionExpired={onSessionExpired}
          onMembershipChanged={onMembershipChanged}
          onPendingChange={setReviewPending}
          onDraftChange={setReviewHasDraft}
          writeBlocked={workspaceRefresh.loading || !!workspaceRefresh.error}
        />
        <EvidencePanel
          membershipId={m.id}
          entityId={m.entityId}
          demo={demo}
          onSessionExpired={onSessionExpired}
          onChanged={() => setActivityRevision((value) => value + 1)}
          writeBlocked={workspaceRefresh.loading || !!workspaceRefresh.error}
        />
        <MembershipActivity
          membership={m}
          demo={demo}
          refreshRevision={activityRevision}
          onSessionExpired={onSessionExpired}
        />
      </div>
      {discardIntent && (
        <div className="info-strip" role="alert" aria-labelledby={discardTitleId}>
          <div>
            <strong id={discardTitleId}>Kaydedilmemiş gözden geçirme taslağı</strong>
            <p>Devam ederseniz karar, gerekçe ve tarih taslağı silinecek.</p>
            <div className="inline-actions">
              <button className="btn secondary" type="button" ref={discardCancelRef} onClick={cancelDiscard}>Taslağı koru</button>
              <button className="btn text-danger" type="button" onClick={discardAndContinue}>
                {discardIntent === "edit" ? "Taslağı sil ve düzenle" : "Taslağı sil ve kapat"}
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="modal-actions">
        <button className="btn secondary" type="button" ref={closeButtonRef} onClick={() => requestTransition("close")} disabled={reviewPending || !!discardIntent}>
          Kapat
        </button>
        {onEdit && (
          <button className="btn primary" type="button" ref={editButtonRef} onClick={() => requestTransition("edit")} disabled={reviewPending || !!discardIntent}>
            <Pencil size={16} />
            Üyelik bilgilerini düzenle
          </button>
        )}
      </footer>
    </Modal>
  );
}
