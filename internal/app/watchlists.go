package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// WatchlistEntry is a read projection of an existing manual membership. The
// projection does not assign a color, close a membership or enforce access.
type WatchlistEntry struct {
	Membership Membership `json:"membership"`
	Entity     Entity     `json:"entity"`
	Group      Group      `json:"group"`
}

type watchlistPage struct {
	Items       []WatchlistEntry `json:"items"`
	NextCursor  string           `json:"nextCursor"`
	Total       int              `json:"total"`
	ActiveCount int              `json:"activeCount"`
}

type WatchlistAlert struct {
	Kind   string         `json:"kind"`
	Record WatchlistEntry `json:"record"`
}

type watchlistAlertCounts struct {
	Expired        int `json:"expired"`
	ReviewDue      int `json:"review_due"`
	RedPriority    int `json:"red_priority"`
	ReviewUpcoming int `json:"review_upcoming"`
}

func (counts watchlistAlertCounts) total() int {
	return counts.Expired + counts.ReviewDue + counts.RedPriority + counts.ReviewUpcoming
}

type watchlistSourceNotifications struct {
	UnreadCount int `json:"unreadCount"`
}

type watchlistSummaryAlerts struct {
	Total  int                  `json:"total"`
	Counts watchlistAlertCounts `json:"counts"`
}

type watchlistSummary struct {
	AsOf                string                       `json:"asOf"`
	GeneratedAt         time.Time                    `json:"generatedAt"`
	Alerts              watchlistSummaryAlerts       `json:"alerts"`
	SourceNotifications watchlistSourceNotifications `json:"sourceNotifications"`
}

type watchlistAlertPage struct {
	Items      []WatchlistAlert     `json:"items"`
	NextCursor string               `json:"nextCursor"`
	Total      int                  `json:"total"`
	Filter     string               `json:"filter"`
	Counts     watchlistAlertCounts `json:"counts"`
}

type watchlistOverview struct {
	AsOf                string                       `json:"asOf"`
	GeneratedAt         time.Time                    `json:"generatedAt"`
	Selection           watchlistSelection           `json:"selection"`
	Red                 watchlistPage                `json:"red"`
	Yellow              watchlistPage                `json:"yellow"`
	Alerts              watchlistAlertPage           `json:"alerts"`
	SourceNotifications watchlistSourceNotifications `json:"sourceNotifications"`
}

type watchlistSelection struct {
	Q          string `json:"q"`
	EntityKind string `json:"entityKind"`
}

type watchlistCursor struct {
	Version    int    `json:"version"`
	Scope      string `json:"scope"`
	AsOf       string `json:"asOf"`
	Filter     string `json:"filter"`
	ReviewOn   string `json:"reviewOn"`
	ID         string `json:"id"`
	Rank       int    `json:"rank"`
	SearchKey  string `json:"searchKey"`
	EntityKind string `json:"entityKind"`
}

type watchlistQuery struct {
	Limit         int
	AlertKind     string
	Selection     watchlistSelection
	SearchPattern string
	SearchKey     string
	RedCursor     *watchlistCursor
	YellowCursor  *watchlistCursor
	AlertCursor   *watchlistCursor
}

var errWatchlistCursor = errors.New("Liste imleci geçersiz veya UTC günü/filtre değişti. Bu listeyi ilk sayfadan yeniden açın.")

func watchlistKind(rank int) string {
	switch rank {
	case 1:
		return "expired"
	case 2:
		return "review_due"
	case 3:
		return "red_priority"
	case 4:
		return "review_upcoming"
	default:
		return "all"
	}
}

func watchlistRank(kind string) int {
	for rank := 1; rank <= 4; rank++ {
		if watchlistKind(rank) == kind {
			return rank
		}
	}
	return 0
}

func encodeWatchlistCursor(cursor watchlistCursor) string {
	data, _ := json.Marshal(cursor) // All fields are fixed scalar types.
	return base64.RawURLEncoding.EncodeToString(data)
}

func validWatchlistDate(value string) bool {
	day, err := time.Parse(time.DateOnly, value)
	return err == nil && day.Year() >= 1 && day.Format(time.DateOnly) == value
}

func parseWatchlistCursor(value, scope, asOf, filter, searchKey, entityKind string) (*watchlistCursor, error) {
	if len(value) == 0 || len(value) > 2048 {
		return nil, errWatchlistCursor
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		return nil, errWatchlistCursor
	}
	var cursor watchlistCursor
	if json.Unmarshal(data, &cursor) != nil || cursor.Version != 2 || cursor.Scope != scope || cursor.AsOf != asOf || cursor.Filter != filter || cursor.SearchKey != searchKey || cursor.EntityKind != entityKind || !validWatchlistDate(cursor.ReviewOn) || !uuidPattern.MatchString(cursor.ID) {
		return nil, errWatchlistCursor
	}
	if (scope == "alerts" && (cursor.Rank < 1 || cursor.Rank > 4 || (filter != "all" && cursor.Rank != watchlistRank(filter)))) || (scope != "alerts" && cursor.Rank != 0) {
		return nil, errWatchlistCursor
	}
	// Re-encoding rejects duplicate/unknown fields, alternate JSON spelling,
	// extra bytes and alternate base64 forms. Database UUIDs are lowercase.
	for _, character := range cursor.ID {
		if character >= 'A' && character <= 'F' {
			return nil, errWatchlistCursor
		}
	}
	if encodeWatchlistCursor(cursor) != value {
		return nil, errWatchlistCursor
	}
	return &cursor, nil
}

func parseWatchlistQuery(rawQuery, asOf string) (watchlistQuery, error) {
	query := watchlistQuery{Limit: 20, AlertKind: "all", Selection: watchlistSelection{EntityKind: "all"}}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return query, errors.New("Liste sorgusu geçersiz.")
	}
	for key, entries := range values {
		if len(entries) != 1 || (key != "limit" && key != "redCursor" && key != "yellowCursor" && key != "alertCursor" && key != "alertKind" && key != "q" && key != "entityKind") {
			return query, errors.New("Liste sorgusu yinelenen veya bilinmeyen alan içeriyor.")
		}
	}
	if supplied, present := values["q"]; present {
		query.Selection.Q = strings.TrimSpace(supplied[0])
	}
	_, query.SearchPattern, _, err = parseListSearch(values.Encode())
	if err != nil {
		return query, err
	}
	query.SearchKey = base64.RawURLEncoding.EncodeToString([]byte(query.Selection.Q))
	if supplied, present := values["entityKind"]; present {
		query.Selection.EntityKind = supplied[0]
		switch query.Selection.EntityKind {
		case "all", "person", "account", "device", "service", "application":
		default:
			return query, errors.New("Varlık türü all, person, account, device, service veya application olmalı.")
		}
	}
	if _, supplied := values["limit"]; supplied {
		query.Limit, _, err = parseListPage(url.Values{"limit": values["limit"]})
		if err != nil {
			return query, err
		}
	}
	if supplied, present := values["alertKind"]; present {
		query.AlertKind = supplied[0]
		if query.AlertKind != "all" && watchlistRank(query.AlertKind) == 0 {
			return query, errors.New("Uyarı türü all, expired, review_due, red_priority veya review_upcoming olmalı.")
		}
	}
	for _, page := range []struct {
		key, scope, filter string
		target             **watchlistCursor
	}{
		{"redCursor", "red", "", &query.RedCursor},
		{"yellowCursor", "yellow", "", &query.YellowCursor},
		{"alertCursor", "alerts", query.AlertKind, &query.AlertCursor},
	} {
		if supplied, present := values[page.key]; present {
			*page.target, err = parseWatchlistCursor(supplied[0], page.scope, asOf, page.filter, query.SearchKey, query.Selection.EntityKind)
			if err != nil {
				return query, err
			}
		}
	}
	return query, nil
}

// Expiry is strict (< UTC day), so the last day stays inclusive. A future
// start contributes to direct lists, but never to any primary alert kind.
const watchlistRecordsCTE = `WITH watchlist_records AS (
 SELECT m.id,m.review_on,m.starts_on,m.ends_on,g.color,
 CASE WHEN m.starts_on>$1::text::date THEN 0
      WHEN m.ends_on<$1::text::date THEN 1
      WHEN m.review_on<=$1::text::date THEN 2
      WHEN g.color='red' THEN 3
      WHEN m.review_on<=$1::text::date+7 THEN 4
      ELSE 0 END AS alert_rank
 FROM memberships m JOIN risk_groups g ON g.id=m.group_id JOIN entities e ON e.id=m.entity_id
 WHERE m.status='active' AND ($3='all' OR e.kind=$3)
 AND ($2='' OR e.name ILIKE $2 ESCAPE E'\\' OR e.identifier ILIKE $2 ESCAPE E'\\'
      OR e.department ILIKE $2 ESCAPE E'\\' OR g.name ILIKE $2 ESCAPE E'\\'
      OR m.reason ILIKE $2 ESCAPE E'\\' OR m.responsible ILIKE $2 ESCAPE E'\\')
) `

const watchlistEntrySelect = `SELECT
 m.id,m.entity_id,m.group_id,m.reason,m.responsible,
 to_char(m.starts_on,'YYYY-MM-DD'),to_char(m.ends_on,'YYYY-MM-DD'),to_char(m.review_on,'YYYY-MM-DD'),m.status,m.version,m.created_at,m.updated_at,
 e.id,e.kind,e.name,e.department,e.description,e.identifier,COALESCE(e.person_id::text,''),e.identity_state,e.version,e.created_at,e.updated_at,
 g.id,g.name,g.color,g.description,g.version,g.created_at,g.updated_at,k.alert_rank
 FROM watchlist_records k JOIN memberships m ON m.id=k.id JOIN entities e ON e.id=m.entity_id JOIN risk_groups g ON g.id=m.group_id `

func scanWatchlistEntry(row scanner, generatedAt time.Time) (entry WatchlistEntry, rank int, err error) {
	m, e, g := &entry.Membership, &entry.Entity, &entry.Group
	err = row.Scan(&m.ID, &m.EntityID, &m.GroupID, &m.Reason, &m.Responsible,
		&m.StartsOn, &m.EndsOn, &m.ReviewOn, &m.Status, &m.Version, &m.CreatedAt, &m.UpdatedAt,
		&e.ID, &e.Kind, &e.Name, &e.Department, &e.Description, &e.Identifier, &e.PersonID, &e.IdentityState, &e.Version, &e.CreatedAt, &e.UpdatedAt,
		&g.ID, &g.Name, &g.Color, &g.Description, &g.Version, &g.CreatedAt, &g.UpdatedAt, &rank)
	m.Active = membershipActive(*m, generatedAt)
	return
}

func listWatchlist(ctx context.Context, tx pgx.Tx, asOf string, generatedAt time.Time, color string, cursor *watchlistCursor, query watchlistQuery) (watchlistPage, error) {
	page := watchlistPage{Items: []WatchlistEntry{}}
	var review, id any
	if cursor != nil {
		review, id = cursor.ReviewOn, cursor.ID
	}
	rows, err := tx.Query(ctx, watchlistRecordsCTE+watchlistEntrySelect+`
 WHERE k.color=$4 AND ($5::text::date IS NULL OR (k.review_on,k.id)>($5::text::date,$6::uuid))
 ORDER BY k.review_on,k.id LIMIT $7`, asOf, query.SearchPattern, query.Selection.EntityKind, color, review, id, query.Limit+1)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	var last WatchlistEntry
	for rows.Next() {
		entry, _, err := scanWatchlistEntry(rows, generatedAt)
		if err != nil {
			return page, err
		}
		if len(page.Items) == query.Limit {
			page.NextCursor = encodeWatchlistCursor(watchlistCursor{Version: 2, Scope: color, AsOf: asOf, ReviewOn: last.Membership.ReviewOn, ID: last.Membership.ID, SearchKey: query.SearchKey, EntityKind: query.Selection.EntityKind})
			break
		}
		page.Items = append(page.Items, entry)
		last = entry
	}
	return page, rows.Err()
}

func listWatchlistAlerts(ctx context.Context, tx pgx.Tx, asOf string, generatedAt time.Time, query watchlistQuery) (watchlistAlertPage, error) {
	page := watchlistAlertPage{Items: []WatchlistAlert{}, Filter: query.AlertKind}
	var review, id any
	rank := 0
	if query.AlertCursor != nil {
		review, id, rank = query.AlertCursor.ReviewOn, query.AlertCursor.ID, query.AlertCursor.Rank
	}
	rows, err := tx.Query(ctx, watchlistRecordsCTE+watchlistEntrySelect+`
 WHERE k.alert_rank>0 AND ($4='all' OR k.alert_rank=$5)
 AND ($6::text::date IS NULL OR (k.alert_rank,k.review_on,k.id)>($7::integer,$6::text::date,$8::uuid))
 ORDER BY k.alert_rank,k.review_on,k.id LIMIT $9`, asOf, query.SearchPattern, query.Selection.EntityKind, query.AlertKind, watchlistRank(query.AlertKind), review, rank, id, query.Limit+1)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	var last WatchlistAlert
	var lastRank int
	for rows.Next() {
		entry, rank, err := scanWatchlistEntry(rows, generatedAt)
		if err != nil {
			return page, err
		}
		if len(page.Items) == query.Limit {
			page.NextCursor = encodeWatchlistCursor(watchlistCursor{Version: 2, Scope: "alerts", AsOf: asOf, Filter: query.AlertKind, ReviewOn: last.Record.Membership.ReviewOn, ID: last.Record.Membership.ID, Rank: lastRank, SearchKey: query.SearchKey, EntityKind: query.Selection.EntityKind})
			break
		}
		page.Items = append(page.Items, WatchlistAlert{Kind: watchlistKind(rank), Record: entry})
		last, lastRank = page.Items[len(page.Items)-1], rank
	}
	return page, rows.Err()
}

type watchlistTotals struct {
	RedTotal, RedActive, YellowTotal, YellowActive int
	Alerts                                         watchlistAlertCounts
}

func readWatchlistCounts(ctx context.Context, tx pgx.Tx, asOf, searchPattern, entityKind string) (watchlistTotals, error) {
	var totals watchlistTotals
	err := tx.QueryRow(ctx, watchlistRecordsCTE+`SELECT
 count(*) FILTER(WHERE color='red'),count(*) FILTER(WHERE color='red' AND starts_on<=$1::text::date AND ends_on>=$1::text::date),
 count(*) FILTER(WHERE color='yellow'),count(*) FILTER(WHERE color='yellow' AND starts_on<=$1::text::date AND ends_on>=$1::text::date),
 count(*) FILTER(WHERE alert_rank=1),count(*) FILTER(WHERE alert_rank=2),count(*) FILTER(WHERE alert_rank=3),count(*) FILTER(WHERE alert_rank=4)
 FROM watchlist_records`, asOf, searchPattern, entityKind).Scan(&totals.RedTotal, &totals.RedActive, &totals.YellowTotal, &totals.YellowActive,
		&totals.Alerts.Expired, &totals.Alerts.ReviewDue, &totals.Alerts.RedPriority, &totals.Alerts.ReviewUpcoming)
	return totals, err
}

func readWatchlistUnreadCount(ctx context.Context, tx pgx.Tx, userID string) (int, error) {
	var count int
	err := tx.QueryRow(ctx, `SELECT count(*) FROM notifications n WHERE NOT EXISTS(
 SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)`, userID).Scan(&count)
	return count, err
}

func readWatchlistSummary(ctx context.Context, tx pgx.Tx, userID string, generatedAt time.Time) (watchlistSummary, error) {
	generatedAt = generatedAt.UTC()
	result := watchlistSummary{AsOf: generatedAt.Format(time.DateOnly), GeneratedAt: generatedAt}
	// The header summary always covers the entire persisted open collection.
	// It shares the overview classification and complete-count query, without
	// applying an overview search/type selection or loading any paged rows.
	totals, err := readWatchlistCounts(ctx, tx, result.AsOf, "", "all")
	if err != nil {
		return result, err
	}
	result.Alerts = watchlistSummaryAlerts{Total: totals.Alerts.total(), Counts: totals.Alerts}
	result.SourceNotifications.UnreadCount, err = readWatchlistUnreadCount(ctx, tx, userID)
	return result, err
}

func readWatchlistOverview(ctx context.Context, tx pgx.Tx, query watchlistQuery, userID string, generatedAt time.Time) (watchlistOverview, error) {
	generatedAt = generatedAt.UTC()
	result := watchlistOverview{AsOf: generatedAt.Format(time.DateOnly), GeneratedAt: generatedAt, Selection: query.Selection}
	totals, err := readWatchlistCounts(ctx, tx, result.AsOf, query.SearchPattern, query.Selection.EntityKind)
	if err != nil {
		return result, err
	}
	counts := totals.Alerts
	result.Red, err = listWatchlist(ctx, tx, result.AsOf, generatedAt, "red", query.RedCursor, query)
	if err != nil {
		return result, err
	}
	result.Red.Total, result.Red.ActiveCount = totals.RedTotal, totals.RedActive
	result.Yellow, err = listWatchlist(ctx, tx, result.AsOf, generatedAt, "yellow", query.YellowCursor, query)
	if err != nil {
		return result, err
	}
	result.Yellow.Total, result.Yellow.ActiveCount = totals.YellowTotal, totals.YellowActive
	result.Alerts, err = listWatchlistAlerts(ctx, tx, result.AsOf, generatedAt, query)
	if err != nil {
		return result, err
	}
	result.Alerts.Counts = counts
	switch query.AlertKind {
	case "expired":
		result.Alerts.Total = counts.Expired
	case "review_due":
		result.Alerts.Total = counts.ReviewDue
	case "red_priority":
		result.Alerts.Total = counts.RedPriority
	case "review_upcoming":
		result.Alerts.Total = counts.ReviewUpcoming
	default:
		result.Alerts.Total = counts.total()
	}
	result.SourceNotifications.UnreadCount, err = readWatchlistUnreadCount(ctx, tx, userID)
	return result, err
}

func (a *App) registerWatchlists(m *http.ServeMux) {
	m.Handle("GET /api/watchlist-overview", a.auth(http.HandlerFunc(a.getWatchlistOverview)))
	m.Handle("GET /api/watchlist-summary", a.auth(http.HandlerFunc(a.getWatchlistSummary)))
}

func (a *App) beginWatchlistSnapshot(ctx context.Context) (pgx.Tx, time.Time, error) {
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, time.Time{}, err
	}
	var generatedAt time.Time
	if err := tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&generatedAt); err != nil {
		_ = tx.Rollback(ctx)
		return nil, time.Time{}, err
	}
	return tx, generatedAt.UTC(), nil
}

func (a *App) getWatchlistSummary(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		invalid(w, "Uyarı özeti sorgu parametresi kabul etmez.")
		return
	}
	tx, generatedAt, err := a.beginWatchlistSnapshot(r.Context())
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	result, err := readWatchlistSummary(r.Context(), tx, currentUser(r).ID, generatedAt)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, result)
}

func (a *App) getWatchlistOverview(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	tx, generatedAt, err := a.beginWatchlistSnapshot(r.Context())
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	query, err := parseWatchlistQuery(r.URL.RawQuery, generatedAt.Format(time.DateOnly))
	if err != nil {
		if errors.Is(err, errWatchlistCursor) {
			fail(w, http.StatusBadRequest, "invalid_cursor", err.Error())
		} else {
			invalid(w, err.Error())
		}
		return
	}
	result, err := readWatchlistOverview(r.Context(), tx, query, currentUser(r).ID, generatedAt)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, result)
}
