import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import {
  CalendarClock,
  ChevronRight,
  CornerDownLeft,
  Folder,
  MonitorCog,
  Moon,
  Plus,
  Search,
  ShieldAlert,
  Sun,
  UserRound,
} from "lucide-react";
import { Modal } from "./components";
import { MAX_LIST_SEARCH_LENGTH, MIN_LIST_SEARCH_LENGTH } from "./listSearch";
import { colorLabels, entityLabels } from "./types";
import type { Entity, Group, Membership, Page, Workspace } from "./types";
import type { ThemePreference } from "./theme";
import { themeLabels } from "./theme";

export type PaletteServerSearch = "cases" | "events" | "notifications" | "audit";

type Command = {
  id: string;
  section: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
};

export type CommandPaletteProps = {
  pages: { page: Page; title: string; icon: ReactNode }[];
  workspace: Workspace | null;
  searchTargets: { page: PaletteServerSearch; label: string }[];
  canCreate: { entity: boolean; group: boolean; membership: boolean };
  theme: ThemePreference;
  onClose: () => void;
  onNavigate: (page: Page) => void;
  onServerSearch: (page: PaletteServerSearch, query: string) => void;
  onOpenEntity: (entity: Entity) => void;
  onOpenMembership: (membership: Membership) => void;
  onOpenGroup: (group: Group) => void;
  onCreate: (kind: "entity" | "group" | "membership") => void;
  onOpenReviewQueue: () => void;
  onTheme: (value: ThemePreference) => void;
};

function normalize(value: string) {
  return value.toLocaleLowerCase("tr").normalize("NFC");
}
// Every whitespace-separated term must appear somewhere in the haystack.
function matchesTerms(terms: string[], ...values: string[]) {
  const haystack = normalize(values.join(" "));
  return terms.every((term) => haystack.includes(term));
}

const RECORD_LIMIT = 6;

export default function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const trimmed = query.trim();
  const terms = normalize(trimmed).split(/\s+/).filter(Boolean);
  const codePoints = [...trimmed].length;

  const commands = useMemo(() => {
    const run = (fn: () => void) => () => {
      props.onClose();
      fn();
    };
    const list: Command[] = props.pages.map(({ page, title, icon }) => ({
      id: `page:${page}`,
      section: "Sayfalar",
      label: title,
      hint: "Git",
      icon,
      run: run(() => props.onNavigate(page)),
    }));
    if (props.workspace) {
      list.push({
        id: "action:review",
        section: "İşlemler",
        label: "İnceleme iş listesini aç",
        keywords: "gözden geçirme geciken bugün",
        icon: <CalendarClock size={16} />,
        run: run(props.onOpenReviewQueue),
      });
    }
    if (props.canCreate.entity)
      list.push({ id: "create:entity", section: "İşlemler", label: "Yeni varlık ekle", keywords: "personel hesap cihaz oluştur", icon: <Plus size={16} />, run: run(() => props.onCreate("entity")) });
    if (props.canCreate.group)
      list.push({ id: "create:group", section: "İşlemler", label: "Yeni izleme grubu oluştur", keywords: "grup oluştur", icon: <Plus size={16} />, run: run(() => props.onCreate("group")) });
    if (props.canCreate.membership)
      list.push({ id: "create:membership", section: "İşlemler", label: "Yeni inceleme üyeliği ekle", keywords: "üyelik oluştur", icon: <Plus size={16} />, run: run(() => props.onCreate("membership")) });
    for (const value of ["system", "light", "dark"] as ThemePreference[]) {
      if (value === props.theme) continue;
      list.push({
        id: `theme:${value}`,
        section: "Görünüm",
        label: `${themeLabels[value]} kullan`,
        keywords: "tema görünüm karanlık aydınlık",
        icon: value === "dark" ? <Moon size={16} /> : value === "light" ? <Sun size={16} /> : <MonitorCog size={16} />,
        run: run(() => props.onTheme(value)),
      });
    }
    return list;
  }, [props]);

  const results = useMemo(() => {
    const visible = terms.length
      ? commands.filter((c) => matchesTerms(terms, c.label, c.section, c.keywords || ""))
      : commands.filter((c) => c.section !== "Görünüm");
    const workspace = props.workspace;
    if (!terms.length || !workspace) return visible;
    const close = (fn: () => void) => () => {
      props.onClose();
      fn();
    };
    const entityName = new Map(workspace.entities.map((e) => [e.id, e.name]));
    const groupById = new Map(workspace.groups.map((g) => [g.id, g]));
    const entities = workspace.entities
      .filter((e) => matchesTerms(terms, e.name, e.identifier, e.department, e.description, entityLabels[e.kind]))
      .slice(0, RECORD_LIMIT)
      .map<Command>((e) => ({
        id: `entity:${e.id}`,
        section: "Varlıklar",
        label: e.name,
        hint: [entityLabels[e.kind], e.department].filter(Boolean).join(" · "),
        icon: <UserRound size={16} />,
        run: close(() => props.onOpenEntity(e)),
      }));
    const groups = workspace.groups
      .filter((g) => matchesTerms(terms, g.name, g.description, colorLabels[g.color]))
      .slice(0, RECORD_LIMIT)
      .map<Command>((g) => ({
        id: `group:${g.id}`,
        section: "İzleme grupları",
        label: g.name,
        hint: colorLabels[g.color],
        icon: <ShieldAlert size={16} />,
        run: close(() => props.onOpenGroup(g)),
      }));
    const memberships = workspace.memberships
      .filter((m) =>
        matchesTerms(terms, entityName.get(m.entityId) || "", groupById.get(m.groupId)?.name || "", m.reason, m.responsible),
      )
      .slice(0, RECORD_LIMIT)
      .map<Command>((m) => ({
        id: `membership:${m.id}`,
        section: "Üyelikler",
        label: `${entityName.get(m.entityId) || "Varlık"} · ${groupById.get(m.groupId)?.name || "Grup"}`,
        hint: m.reason,
        icon: <Folder size={16} />,
        run: close(() => props.onOpenMembership(m)),
      }));
    const server =
      codePoints >= MIN_LIST_SEARCH_LENGTH && codePoints <= MAX_LIST_SEARCH_LENGTH
        ? props.searchTargets.map<Command>((target) => ({
            id: `search:${target.page}`,
            section: "Tüm kayıtlarda ara",
            label: `${target.label}: “${trimmed}”`,
            hint: "Sunucuda ara",
            icon: <Search size={16} />,
            run: close(() => props.onServerSearch(target.page, trimmed)),
          }))
        : [];
    return [...visible, ...entities, ...memberships, ...groups, ...server];
  }, [commands, terms, props, codePoints, trimmed]);

  const current = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (index: number) => `${listId}-${index}`;
  function move(delta: number) {
    if (!results.length) return;
    const next = (current + delta + results.length) % results.length;
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView({ block: "nearest" });
  }
  function onKey(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      results[current]?.run();
    }
  }

  let lastSection = "";
  return (
    <Modal title="Komut paleti" onClose={props.onClose} bare className="palette">
      <div className="palette-input">
        <Search size={18} />
        <input
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length ? optionId(current) : undefined}
          aria-label="Sayfa, kayıt veya işlem ara"
          placeholder="Sayfa, kayıt veya işlem ara…"
          value={query}
          maxLength={MAX_LIST_SEARCH_LENGTH * 2}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          data-initial-focus
        />
        <kbd>Esc</kbd>
      </div>
      <div className="palette-results" id={listId} role="listbox" aria-label="Sonuçlar" ref={listRef}>
        {results.map((item, index) => {
          const heading = item.section !== lastSection ? item.section : "";
          lastSection = item.section;
          return (
            <div key={item.id} role="presentation">
              {heading && (
                <div className="palette-section" role="presentation">
                  {heading}
                </div>
              )}
              <div
                id={optionId(index)}
                role="option"
                aria-selected={index === current}
                className={`palette-option ${index === current ? "active" : ""}`}
                onMouseMove={() => index !== current && setActive(index)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => item.run()}
              >
                <span className="palette-icon">{item.icon}</span>
                <span className="palette-label">
                  <strong>{item.label}</strong>
                  {item.hint && <small>{item.hint}</small>}
                </span>
                {index === current ? <CornerDownLeft size={14} /> : <ChevronRight size={14} />}
              </div>
            </div>
          );
        })}
        {!results.length && (
          <p className="palette-empty">
            {codePoints > 0 && codePoints < MIN_LIST_SEARCH_LENGTH
              ? `Eşleşme yok. Tüm kayıtlarda aramak için en az ${MIN_LIST_SEARCH_LENGTH} karakter yazın.`
              : "Eşleşen sayfa, kayıt veya işlem yok."}
          </p>
        )}
      </div>
      <footer className="palette-footer">
        <span><kbd>↑</kbd><kbd>↓</kbd> seç</span>
        <span><kbd>Enter</kbd> aç</span>
        <span><kbd>Ctrl</kbd><kbd>K</kbd> paleti aç/kapat</span>
      </footer>
    </Modal>
  );
}
