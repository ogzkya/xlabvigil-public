import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Bell,
  CalendarClock,
  ChevronRight,
  ClipboardList,
  Database,
  FileClock,
  Fingerprint,
  FolderKanban,
  Info,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
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
  UserRound,
  Users,
  X,
} from "lucide-react";
import { api, ApiError } from "./api";
import Auth from "./Auth";
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
import { accountSessionStatusTone } from "./design";
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
    title: "Genel görünüm",
    subtitle: "Kurumsal varlıklar ve gerekçeli incelemeler için ortak görünüm.",
    icon: LayoutDashboard,
  },
  entities: {
    title: "Varlıklar ve ilişkiler",
    subtitle:
      "Personel, hesap, cihaz, servis ve uygulamaları bir araya getirin.",
    icon: Users,
  },
  groups: {
    title: "İzleme grupları",
    subtitle: "Kapsamı belirli gruplarla inceleme önceliklerini düzenleyin.",
    icon: ShieldAlert,
  },
  memberships: {
    title: "İnceleme üyelikleri",
    subtitle: "Gerekçe, sorumlu, süre ve geçmişiyle tüm grup üyelikleri.",
    icon: ClipboardList,
  },
  sources: {
    title: "Veri kaynakları",
    subtitle: "LDAP, Palo Alto, Logsign ve Trend Micro bağlantılarını yönetin.",
    icon: Network,
  },
  events: {
    title: "Güvenlik olayları",
    subtitle:
      "Kaynak, önem derecesi ve kimlik bağlamıyla kurumsal olayları inceleyin.",
    icon: Siren,
  },
  notifications: {
    title: "Bildirimler ve mesajlar",
    subtitle: "İnceleme bildirimleri ve e-posta gönderim yapılandırması.",
    icon: Bell,
  },
  audit: {
    title: "İşlem günlüğü",
    subtitle: "Vigil içerisinde gerçekleştirilen yönetim işlemleri.",
    icon: FileClock,
  },
  users: {
    title: "Kullanıcı yönetimi",
    subtitle: "Yerel hesapların rollerini ve etkinliğini yönetin.",
    icon: Users,
  },
  account: {
    title: "Hesabım",
    subtitle: "Yerel hesap bilgilerinizi ve oturum güvenliğini yönetin.",
    icon: Fingerprint,
  },
  settings: {
    title: "Çalışma alanı",
    subtitle: "Ürün kapsamı, erişim ve bağlantı durumu.",
    icon: Settings,
  },
};
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
  const [page, setPage] = useState<Page>(initialPage);
  const [query, setQuery] = useState("");
  const [entityFilter, setEntityFilter] = useState("all");
  const [membershipFilter, setMembershipFilter] = useState("active");
  const [reviewFilter, setReviewFilter] = useState<ReviewQueueFilter>("attention");
  const [groupFilter, setGroupFilter] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [entityDetail, setEntityDetail] = useState<Entity | null>(null);
  const [memberDetail, setMemberDetail] = useState<Membership | null>(null);
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
  const requestGeneration = useRef(0);
  const pendingEntryScroll = useRef(false);
  const allowed = !!user && (user.role === "admin" || user.role === "analyst");
  const operationsPage =
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
    page === "events" || page === "notifications" || page === "audit";
  // HTML maxLength counts UTF-16 units; the shared search limit counts code points.
  const searchPrompt =
    page === "events"
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
    setLoading(false);
    setError("");
    setMobileOpen(false);
    setNotice("Oturumunuz sona erdi. Yeniden giriş yapın.");
  }, []);
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
      setPage(initialPage());
      setQuery("");
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!mobileOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])",
        ) || [],
      ).filter((el) => el.offsetParent !== null);
    focusables()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
      if (e.key === "Tab") {
        const list = focusables(),
          first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
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
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", resize);
      menuRef.current?.focus();
    };
  }, [mobileOpen]);

  function navigate(next: Page) {
    if (next !== page) {
      pendingOperationsRefresh.current = null;
      setOperationsRefreshing(false);
    }
    setPage(next);
    setQuery("");
    setMobileOpen(false);
    window.history.replaceState(null, "", `#${next}`);
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
        setNotice((e as Error).message);
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
    navigate("home");
    void boot();
  }
  function saved() {
    setEditor(null);
    setEntityDetail(null);
    setMemberDetail(null);
    setNotice("Değişiklik kaydedildi.");
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
    // A targeted membership read cannot certify the rest of the workspace.
    // Reload every collection while keeping the modal and its drafts mounted.
    void refresh();
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
          <div className="toast" role="status">
            {notice}
          </div>
        )}
      </>
    );

  const heading = pages[page];
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
  const upcomingMemberships = (workspace?.memberships || []).filter(
    (m) => classifyMembershipReview(m, today) === "upcoming",
  );
  const highPriority = activeMemberships.filter(
    (m) => workspace?.groups.find((g) => g.id === m.groupId)?.color === "red",
  );
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
      <a href="#main-content" className="skip-link">
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
        <div className="workspace-chip">
          <Shield size={17} />
          <div>
            <strong>Kurum güvenliği</strong>
            <small>
              {demo ? "Kurgusal örnek alan" : "Yerel çalışma alanı"}
            </small>
          </div>
          <span className="version-chip">0.4</span>
        </div>
        <nav aria-label="Modüller">
          <p className="nav-label">GÜVENLİK ÇALIŞMA ALANI</p>
          {navPages
            .filter(
              (p) =>
                (p !== "audit" || user.role === "admin") &&
                (p !== "users" || (!demo && user.role === "admin")),
            )
            .map((p) => {
              const Icon = pages[p].icon;
              return (
                <button
                  key={p}
                  className={`nav-item ${page === p ? "active" : ""}`}
                  aria-current={page === p ? "page" : undefined}
                  onClick={() => navigate(p)}
                >
                  <Icon size={19} />
                  {p === "entities" ? "Varlıklar ve ilişkiler" : pages[p].title}
                  {p === "memberships" &&
                    !loading && !error && !!dueMemberships.length &&
                    !error &&
                    !loading && (
                      <span className="nav-count">{dueMemberships.length}</span>
                    )}
                </button>
              );
            })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-security">
            <Network size={18} />
            <div>
              <strong>Canlı toplama kapalı</strong>
              <span>Yapılandırma ve manuel olay aktarımı</span>
            </div>
          </div>
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
          <label className="global-search">
            <Search size={17} />
            <span className="sr-only">{searchPrompt}</span>
            <input
              value={query}
              maxLength={
                serverSearchPage ? MAX_LIST_SEARCH_LENGTH * 2 : undefined
              }
              onChange={(e) => {
                setQuery(e.target.value);
                if (page === "home") {
                  setPage("entities");
                  window.history.replaceState(null, "", "#entities");
                }
              }}
              placeholder={searchPrompt}
              disabled={page === "settings" || !allowed}
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
          <span className="top-mode">
            <span />
            Yerel sürüm
          </span>
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
        <main className="main-content" id="main-content" tabIndex={-1}>
          <div className="date-line">
            <span>KURUMSAL TEHDİT VE RİSK İNCELEMESİ</span>
            <span>
              {new Date().toLocaleDateString("tr-TR", {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "UTC",
              })} · UTC
            </span>
          </div>
          <div className="page-heading">
            <div>
              <h1>{heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            {page === "entities" ? (
              newButton("entity", "Varlık ekle")
            ) : page === "groups" ? (
              newButton("group", "Grup oluştur")
            ) : page === "memberships" &&
              workspace?.entities.length &&
              workspace?.groups.length ? (
              newButton("membership", "Üyelik ekle")
            ) : allowed && !demo && page !== "account" ? (
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
          {page === "account" ? (
            <AccountCenter
              user={user}
              demo={demo}
              onSessionExpired={sessionExpired}
            />
          ) : !allowed ? (
            <Empty title="Bu alan için erişiminiz yok">
              Vigil inceleme verilerine yalnızca yönetici ve analist rolleri
              erişebilir. Oturum rolünüz: {roleLabels[user.role]}.
            </Empty>
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
                <>
                  <div className="stats-grid">
                    <Stat
                      label="Kayıtlı varlık"
                      value={workspace.entities.length}
                      foot="Manuel, doğrulama bekliyor"
                      icon={<Users size={22} />}
                      onClick={() => navigate("entities")}
                    />
                    <Stat
                      label="Etkin üyelik"
                      value={activeMemberships.length}
                      foot="Bir varlık birden çok grupta olabilir"
                      icon={<Shield size={22} />}
                      onClick={() => {
                        setMembershipFilter("active");
                        setGroupFilter("");
                        navigate("memberships");
                      }}
                    />
                    <Stat
                      label="Kırmızı öncelik"
                      value={highPriority.length}
                      foot="İnceleme üyeliği sayısı"
                      icon={<ShieldAlert size={22} />}
                      tone="red"
                      onClick={() => navigate("groups")}
                    />
                    <Stat
                      label="Gözden geçirme"
                      value={dueMemberships.length}
                      foot="Tarihi gelen ve süresi dolan açık kayıtlar"
                      icon={<CalendarClock size={22} />}
                      tone="yellow"
                      onClick={() => openReviewQueue()}
                    />
                  </div>
                  <div className="dashboard-columns">
                    <div className="dashboard-main">
                      <section className="intro-card">
                        <div>
                          <span className="intro-kicker">
                            <span />
                            İLİŞKİLENDİR · İNCELE · KAYDA AL
                          </span>
                          <h2>
                            Her incelemenin
                            <br />
                            bir bağlamı olsun.
                          </h2>
                          <p>
                            Varlıkları ilişkilendirin. Gerekçeyi ve sorumluyu
                            belirleyin.
                            <br className="desktop-break" />
                            İncelemelerin süresini ve geçmişini birlikte takip
                            edin.
                          </p>
                          <button onClick={() => navigate("groups")}>
                            İzleme gruplarını aç
                            <ArrowRight size={16} />
                          </button>
                        </div>
                        <div className="vigil-art" aria-hidden="true">
                          <div className="radar-ring r1" />
                          <div className="radar-ring r2" />
                          <div className="radar-ring r3" />
                          <div className="radar-core">
                            <Shield size={40} />
                          </div>
                          <span className="radar-node n1">
                            <UserRound size={21} />
                          </span>
                          <span className="radar-node n2">
                            <Fingerprint size={21} />
                          </span>
                          <span className="radar-node n3">
                            <Monitor size={21} />
                          </span>
                        </div>
                      </section>
                      <div className="section-heading">
                        <h2>İzleme grupları</h2>
                        <button
                          className="link-btn"
                          onClick={() => navigate("groups")}
                        >
                          Tüm gruplar
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      {workspace.groups.length ? (
                        <div className="group-grid home-groups">
                          {workspace.groups.slice(0, 4).map((g) => (
                            <GroupCard
                              key={g.id}
                              group={g}
                              count={
                                activeMemberships.filter(
                                  (m) => m.groupId === g.id,
                                ).length
                              }
                              onOpen={() => openGroup(g)}
                            />
                          ))}
                        </div>
                      ) : (
                        <Empty
                          title="İlk izleme grubunu oluşturun"
                          action={newButton("group", "Grup oluştur")}
                        >
                          Sarı, turuncu, kırmızı veya kuruma özel gruplarla
                          başlayabilirsiniz.
                        </Empty>
                      )}
                    </div>
                    <aside className="dashboard-side">
                      <section className="panel review-panel">
                        <div className="section-heading">
                          <h2>Gözden geçirme</h2>
                          <Badge tone="yellow">{dueMemberships.length}</Badge>
                        </div>
                        <p className="panel-sub">
                          Tarihi gelen ve kapatılmamış incelemeler · UTC
                        </p>
                        {dueMemberships.length ? (
                          <div className="review-list">
                            {dueMemberships.slice(0, 4).map((m) => (
                              <button
                                key={m.id}
                                className="review-item"
                                onClick={() => setMemberDetail(m)}
                              >
                                <span className="review-dot" />
                                <div>
                                  <strong>
                                    {workspace.entities.find(
                                      (e) => e.id === m.entityId,
                                    )?.name || "Varlık"}
                                  </strong>
                                  <small>
                                    {
                                      workspace.groups.find(
                                        (g) => g.id === m.groupId,
                                      )?.name
                                    }{" "}
                                    · {dateLabel(m.reviewOn)}
                                  </small>
                                  <small>Sorumlu: {m.responsible}</small>
                                  <ReviewScheduleBadge membership={m} today={today} />
                                </div>
                                <ChevronRight size={16} />
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="quiet-state">
                            <CalendarClock size={26} />
                            <p>İşlem bekleyen inceleme bulunmuyor.</p>
                          </div>
                        )}
                        {dueMemberships.length > 4 && (
                          <p className="panel-sub">
                            {dueMemberships.length} kaydın inceleme tarihine göre ilk 4'ü gösteriliyor.
                          </p>
                        )}
                        <button
                          className="link-btn"
                          onClick={() => openReviewQueue()}
                        >
                          İş listesine git
                          <ArrowRight size={15} />
                        </button>
                        <div className="inline-actions">
                          <button className="link-btn" onClick={() => openReviewQueue("upcoming")}>
                            Önümüzdeki 7 gün: {upcomingMemberships.length} inceleme
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </section>
                      <section className="panel connection-panel">
                        <Network size={27} />
                        <h3>Kaynak ve olay çalışma alanı</h3>
                        <p>
                          LDAP, Palo Alto, Logsign ve Trend Micro profillerini
                          yönetin; manuel aktarılan olayları ayrı inceleyin.
                        </p>
                        <Badge>Canlı toplama etkin değil</Badge>
                        <button
                          className="link-btn"
                          onClick={() => navigate("sources")}
                        >
                          Kaynakları aç
                          <ArrowRight size={15} />
                        </button>
                      </section>
                    </aside>
                  </div>
                  <div className="section-heading">
                    <h2>Varlık ve hesap ilişkileri</h2>
                    <button
                      className="link-btn"
                      onClick={() => navigate("entities")}
                    >
                      Varlıkları aç
                      <ArrowRight size={15} />
                    </button>
                  </div>
                  {workspace.entities.length ? (
                    <div className="entity-grid home-entities">
                      {workspace.entities.slice(0, 3).map((e) => (
                        <EntityCard
                          key={e.id}
                          entity={e}
                          workspace={workspace}
                          onOpen={() => setEntityDetail(e)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="panel welcome-steps">
                      <div>
                        <span>01</span>
                        <strong>Varlıkları ekleyin</strong>
                        <p>Personel, hesap ve cihazları kaydedin.</p>
                      </div>
                      <div>
                        <span>02</span>
                        <strong>İlişkileri kurun</strong>
                        <p>Hesap ve cihazları personelle ilişkilendirin.</p>
                      </div>
                      <div>
                        <span>03</span>
                        <strong>İncelemeyi başlatın</strong>
                        <p>Gerekçe, sorumlu ve tarihlerle gruba ekleyin.</p>
                      </div>
                    </div>
                  )}
                </>
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
              {page === "settings" && (
                <div className="settings-grid">
                  <section className="panel settings-card">
                    <Shield size={24} />
                    <h2>XLab Vigil</h2>
                    <p>
                      Kurumsal varlık, ilişki, izleme grubu ve gerekçeli
                      inceleme yönetimi.
                    </p>
                    <div className="settings-row">
                      <span>Sürüm</span>
                      <strong>{status?.version || "0.4.0"}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Çalışma biçimi</span>
                      <Badge>Yerel geliştirme</Badge>
                    </div>
                    <div className="settings-row">
                      <span>Canlı veri toplama</span>
                      <Badge tone="yellow">Etkin değil</Badge>
                    </div>
                    <div className="settings-row">
                      <span>Otomatik tehdit kararı</span>
                      <strong>Uygulanmaz</strong>
                    </div>
                  </section>
                  <section className="panel settings-card">
                    <Fingerprint size={24} />
                    <h2>Oturum ve erişim</h2>
                    <p>
                      Vigil kendi kullanıcıları, oturumları ve veritabanıyla
                      ayrı çalışır.
                    </p>
                    <div className="settings-row">
                      <span>Kullanıcı</span>
                      <strong>{user.name}</strong>
                    </div>
                    <div className="settings-row">
                      <span>Rol</span>
                      <strong>{roleLabels[user.role]}</strong>
                    </div>
                    <div className="settings-row">
                      <span>SSO / çok faktörlü giriş</span>
                      <Badge tone={accountSessionStatusTone.warning}>Henüz bağlı değil</Badge>
                    </div>
                    <div className="settings-row">
                      <span>Demo</span>
                      <strong>{demo ? "Salt okunur örnek" : "Kapalı"}</strong>
                    </div>
                  </section>
                  <section className="panel settings-card full-width">
                    <Database size={24} />
                    <h2>Ürün ve veri sınırları</h2>
                    <p>
                      Notlar, projeler ve şifre kasası XLab Nexus ürünündedir.
                      Vigil bu verilere erişmez. Bu sürümde kaydedilen manuel
                      varlıklar ve üyelikler, AD tarafından doğrulanmış kimlik
                      veya gerçek güvenlik olayı sayılmaz.
                    </p>
                    <div className="scope-grid">
                      <div>
                        <strong>Bu sürümde</strong>
                        <p>
                          Varlıklar ve ilişkiler, renkli gruplar, süreli
                          üyelikler, sürüm geçmişi, bağlantı profilleri, manuel
                          olay aktarımı, uygulama içi bildirimler ve e-posta
                          ayarları.
                        </p>
                      </div>
                      <div>
                        <strong>Bağlantı aşamasında</strong>
                        <p>
                          AD / Windows kaynakları, otomatik eşleştirme, inceleme
                          dosyaları, kaynak sağlığı ve kurala dayalı öneriler.
                        </p>
                      </div>
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : (
            <Loading label="Sayfa verileri yükleniyor…" />
          )}
          <footer className="page-footer">
            <span>
              XLAB VIGIL <span>Kurumsal inceleme alanı</span>
            </span>
            <span>
              {demo
                ? "Kurgusal örnek veriler"
                : "Manuel kayıtlar · Kaynak doğrulaması bekleniyor"}
            </span>
          </footer>
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
      {memberDetail && workspace && (
        <MembershipDetail
          key={`${demo}:${memberDetail.id}`}
          membership={memberDetail}
          workspace={workspace}
          demo={demo}
          onSessionExpired={sessionExpired}
          onMembershipChanged={membershipChanged}
          workspaceRefresh={workspaceRefresh}
          onClose={() => setMemberDetail(null)}
          onEdit={
            editable
              ? () => {
                  setEditor({ kind: "membership", value: memberDetail });
                  setMemberDetail(null);
                }
              : undefined
          }
        />
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  foot,
  icon,
  tone = "brand",
  onClick,
}: {
  label: string;
  value: number;
  foot: string;
  icon: ReactNode;
  tone?: "brand" | "red" | "yellow";
  onClick: () => void;
}) {
  return (
    <button className="stat-card" onClick={onClick}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{foot}</small>
      </div>
      <span className={`stat-icon ${tone}`}>{icon}</span>
    </button>
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
