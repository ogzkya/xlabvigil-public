package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func seedWatchlistMembership(t *testing.T, a *App, person Entity, group Group, id, starts, ends, review, status string) Membership {
	t.Helper()
	if id == "" {
		id = UUID()
	}
	row := a.DB.QueryRow(context.Background(), `INSERT INTO memberships(id,entity_id,group_id,reason,responsible,starts_on,ends_on,review_on,status)
 VALUES($1,$2,$3,'Manual watchlist fixture rationale','Sentetik inceleyen',$4::text::date,$5::text::date,$6::text::date,$7) RETURNING `+membershipColumns,
		id, person.ID, group.ID, starts, ends, review, status)
	item, err := scanMembership(row)
	if err != nil {
		t.Fatal(err)
	}
	return item
}

func createWatchlistEntity(t *testing.T, a *App, cookie *http.Cookie, input entityInput) Entity {
	t.Helper()
	w := request(a, "POST", "/api/entities", input, cookie)
	expect(t, w, 201)
	return decoded[Entity](t, w)
}

func watchlistHTTP(t *testing.T, a *App, cookie *http.Cookie, query string) watchlistOverview {
	t.Helper()
	w := request(a, "GET", "/api/watchlist-overview"+query, nil, cookie)
	expect(t, w, http.StatusOK)
	return decoded[watchlistOverview](t, w)
}

func watchlistSummaryHTTP(t *testing.T, a *App, cookie *http.Cookie) watchlistSummary {
	t.Helper()
	w := request(a, "GET", "/api/watchlist-summary", nil, cookie)
	expect(t, w, http.StatusOK)
	return decoded[watchlistSummary](t, w)
}

func watchlistSummaryAt(t *testing.T, a *App, userID string, instant time.Time) watchlistSummary {
	t.Helper()
	ctx := context.Background()
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	result, err := readWatchlistSummary(ctx, tx, userID, instant)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return result
}

func watchlistAt(t *testing.T, a *App, userID string, instant time.Time, rawQuery string) watchlistOverview {
	t.Helper()
	ctx := context.Background()
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	query, err := parseWatchlistQuery(rawQuery, instant.UTC().Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	result, err := readWatchlistOverview(ctx, tx, query, userID, instant)
	if err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return result
}

func watchlistUserID(t *testing.T, a *App, cookie *http.Cookie) string {
	t.Helper()
	var id string
	if err := a.DB.QueryRow(context.Background(), `SELECT user_id::text FROM sessions WHERE token_hash=$1`, tokenHash(cookie.Value)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func watchlistFingerprint(t *testing.T, a *App) map[string]string {
	t.Helper()
	ctx := context.Background()
	rows, err := a.DB.Query(ctx, `SELECT tablename FROM pg_tables WHERE schemaname=current_schema() ORDER BY tablename`)
	if err != nil {
		t.Fatal(err)
	}
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	rows.Close()
	result := map[string]string{}
	for _, table := range tables {
		var data string
		query := `SELECT COALESCE(jsonb_agg(data ORDER BY data::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t) AS data FROM ` + pgx.Identifier{table}.Sanitize() + ` t) records`
		if err := a.DB.QueryRow(ctx, query).Scan(&data); err != nil {
			t.Fatal(err)
		}
		result[table] = data
	}
	return result
}

func TestWatchlistOverviewRolesShapeAndNoWrites(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	member := addUser(t, a, "member")
	viewer := addUser(t, a, "viewer")
	before := watchlistFingerprint(t, a)
	expect(t, request(a, "GET", "/api/watchlist-overview", nil, nil), 401)
	for _, cookie := range []*http.Cookie{member, viewer} {
		expect(t, request(a, "GET", "/api/watchlist-overview", nil, cookie), 403)
	}
	for _, cookie := range []*http.Cookie{admin, analyst} {
		item := watchlistHTTP(t, a, cookie, "")
		if item.AsOf != item.GeneratedAt.UTC().Format(time.DateOnly) || item.GeneratedAt.Location() != time.UTC || item.Selection != (watchlistSelection{EntityKind: "all"}) || item.Red.Items == nil || item.Yellow.Items == nil || item.Alerts.Items == nil || item.Red.Total != 0 || item.Yellow.ActiveCount != 0 || item.Alerts.Total != 0 || item.Alerts.Filter != "all" || item.SourceNotifications.UnreadCount != 0 {
			t.Fatal("empty overview lacks explicit arrays, UTC time or counts")
		}
		encoded, _ := json.Marshal(item)
		for _, field := range []string{`"expired":0`, `"review_due":0`, `"red_priority":0`, `"review_upcoming":0`, `"nextCursor":""`, `"activeCount":0`, `"total":0`} {
			if !strings.Contains(string(encoded), field) {
				t.Fatalf("empty overview omitted field %s", field)
			}
		}
	}
	for _, query := range []string{"?q=", "?q=%20%20", "?q=ab", "?q=manual&q=manual", "?entityKind=", "?entityKind=other", "?entityKind=person&entityKind=person", "?kind=person", "?cursor=1", "?unknown=x", "?limit=0", "?limit=101", "?limit=01", "?limit=1&limit=2", "?alertKind=all&alertKind=all", "?alertKind=", "?alertKind=other", "?limit=%FF", "?bad=%zz"} {
		expectCaseError(t, request(a, "GET", "/api/watchlist-overview"+query, nil, admin), 400, "invalid_input")
	}
	expect(t, request(a, "POST", "/api/watchlist-overview", map[string]any{}, admin), 404)
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("read-only overview changed a product row, session, history or audit")
	}
}

func TestWatchlistUTCClassificationInclusiveEdges(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	instant := time.Date(2030, 1, 14, 19, 0, 0, 0, time.FixedZone("UTC-5", -5*60*60))
	today := instant.UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	fixtures := []struct {
		color, status, kind string
		start, end, review  int
		active              bool
	}{
		{"red", "active", "expired", -20, -1, -1, false},
		{"yellow", "active", "expired", -20, -1, -1, false},
		{"orange", "active", "review_due", -20, 30, 0, true},
		{"slate", "active", "review_due", -20, 30, -1, true},
		{"red", "active", "review_due", -20, 30, 0, true},
		{"red", "active", "red_priority", -20, 30, 8, true},
		{"red", "active", "review_due", -20, 0, 0, true},
		{"yellow", "active", "review_upcoming", 0, 30, 1, true},
		{"orange", "active", "review_upcoming", 0, 30, 7, true},
		{"slate", "active", "", 0, 30, 8, true},
		{"red", "active", "", 1, 30, 1, false},
		{"yellow", "active", "", 1, 30, 1, false},
		{"red", "closed", "", -20, 30, 0, false},
		{"orange", "closed", "", -20, -1, -1, false},
	}
	expected := map[string]string{}
	expectedActive := map[string]bool{}
	for _, fixture := range fixtures {
		group := createRiskGroup(t, a, admin, fixture.color)
		item := seedWatchlistMembership(t, a, person, group, "", date(fixture.start), date(fixture.end), date(fixture.review), fixture.status)
		expected[item.ID], expectedActive[item.ID] = fixture.kind, fixture.active
	}
	before := watchlistFingerprint(t, a)
	result := watchlistAt(t, a, watchlistUserID(t, a, admin), instant, "limit=100")
	if result.AsOf != "2030-01-15" || !result.GeneratedAt.Equal(today) || result.GeneratedAt.Location() != time.UTC || result.Red.Total != 5 || result.Red.ActiveCount != 3 || result.Yellow.Total != 3 || result.Yellow.ActiveCount != 1 || result.Alerts.Total != 9 || result.Alerts.Counts != (watchlistAlertCounts{Expired: 2, ReviewDue: 4, RedPriority: 1, ReviewUpcoming: 2}) {
		t.Fatalf("UTC classification counts differ: red=%d/%d yellow=%d/%d alerts=%+v", result.Red.Total, result.Red.ActiveCount, result.Yellow.Total, result.Yellow.ActiveCount, result.Alerts.Counts)
	}
	summary := watchlistSummaryAt(t, a, watchlistUserID(t, a, admin), instant)
	if summary.AsOf != "2030-01-15" || summary.GeneratedAt.Location() != time.UTC || summary.Alerts.Total != result.Alerts.Total || summary.Alerts.Counts != result.Alerts.Counts {
		t.Fatal("summary changed UTC date boundaries or primary-alert classification")
	}
	seen := map[string]bool{}
	lastRank := 0
	for _, alert := range result.Alerts.Items {
		id := alert.Record.Membership.ID
		if seen[id] || expected[id] != alert.Kind || expectedActive[id] != alert.Record.Membership.Active || watchlistRank(alert.Kind) < lastRank {
			t.Fatal("a membership has the wrong/multiple alert kinds or wrong priority order")
		}
		seen[id], lastRank = true, watchlistRank(alert.Kind)
	}
	for id, kind := range expected {
		if seen[id] != (kind != "") {
			t.Fatal("scheduled, closed or beyond-seven-day membership classified incorrectly")
		}
	}
	for _, entry := range append(result.Red.Items, result.Yellow.Items...) {
		if entry.Membership.Status != "active" || entry.Membership.EntityID != entry.Entity.ID || entry.Entity.ID != person.ID || entry.Membership.GroupID != entry.Group.ID || entry.Membership.Active != expectedActive[entry.Membership.ID] || entry.Membership.Reason == "" || entry.Group.Description == "" || entry.Entity.IdentityState != "candidate" {
			t.Fatal("full nested source records or snapshot active flag were lost")
		}
	}
	for rank := 1; rank <= 4; rank++ {
		filtered := watchlistAt(t, a, watchlistUserID(t, a, admin), instant, "limit=1&alertKind="+watchlistKind(rank))
		if filtered.Alerts.Counts != result.Alerts.Counts || len(filtered.Alerts.Items) != 1 || filtered.Alerts.Items[0].Kind != watchlistKind(rank) || filtered.Red.Total != result.Red.Total || filtered.Yellow.Total != result.Yellow.Total {
			t.Fatal("filter/page size changed complete counts or direct lists")
		}
		counts := []int{0, 2, 4, 1, 2}
		if filtered.Alerts.Total != counts[rank] {
			t.Fatal("filtered total is not the selected complete kind count")
		}
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("fixed UTC projection mutated records")
	}
}

func TestWatchlistReviewCloseAndManualColorTransitions(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	red := createRiskGroup(t, a, admin, "red")
	yellow := createRiskGroup(t, a, admin, "yellow")
	orange := createRiskGroup(t, a, admin, "orange")
	today := time.Now().UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	create := func(group Group) Membership {
		in := memberInput(person, group)
		in.ReviewOn = date(0)
		w := request(a, "POST", "/api/memberships", in, admin)
		expect(t, w, 201)
		return decoded[Membership](t, w)
	}
	redMember, yellowMember, _ := create(red), create(yellow), create(orange)
	initial := watchlistHTTP(t, a, admin, "")
	if initial.Alerts.Total != 3 || initial.Alerts.Counts.ReviewDue != 3 || initial.Red.Total != 1 || initial.Yellow.Total != 1 {
		t.Fatal("one entity in three groups was deduplicated or orange due was excluded")
	}
	for _, item := range []Membership{redMember, yellowMember} {
		w := request(a, "POST", "/api/memberships/"+item.ID+"/reviews", membershipReviewInput{Decision: "continue", Reason: "Human decided a later review checkpoint", ExpectedVersion: 1, NextReviewOn: date(7)}, admin)
		expect(t, w, 201)
	}
	continued := watchlistHTTP(t, a, admin, "")
	if continued.Alerts.Counts != (watchlistAlertCounts{ReviewDue: 1, RedPriority: 1, ReviewUpcoming: 1}) || continued.Red.Items[0].Membership.Version != 2 {
		t.Fatal("continue failed to clear due, preserve active red priority or reflect new version")
	}
	if summary := watchlistSummaryHTTP(t, a, admin); summary.Alerts.Counts != continued.Alerts.Counts || summary.Alerts.Total != continued.Alerts.Total {
		t.Fatal("summary did not follow continue decisions without clearing active red priority")
	}
	w := request(a, "POST", "/api/memberships/"+yellowMember.ID+"/reviews", membershipReviewInput{Decision: "close", Reason: "Human closed this review membership", ExpectedVersion: 2}, admin)
	expect(t, w, 201)
	closed := watchlistHTTP(t, a, admin, "")
	if closed.Yellow.Total != 0 || closed.Alerts.Total != 2 || closed.Alerts.Counts.ReviewUpcoming != 0 {
		t.Fatal("closure remained in direct list or system alerts")
	}
	if summary := watchlistSummaryHTTP(t, a, admin); summary.Alerts.Counts != closed.Alerts.Counts || summary.Alerts.Total != closed.Alerts.Total {
		t.Fatal("summary retained a closed membership alert")
	}
	w = request(a, "PATCH", "/api/groups/"+red.ID, groupInput{Name: red.Name, Color: "yellow", Description: red.Description, ExpectedVersion: 1}, admin)
	expect(t, w, 200)
	before := watchlistFingerprint(t, a)
	recolored := watchlistHTTP(t, a, admin, "")
	if recolored.Red.Total != 0 || recolored.Yellow.Total != 1 || recolored.Alerts.Counts.RedPriority != 0 || recolored.Alerts.Counts.ReviewUpcoming != 1 || recolored.Yellow.Items[0].Group.Version != 2 {
		t.Fatal("manual group color change was not reflected consistently")
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("overview automatically wrote a color/review/closure/audit")
	}
}

func TestWatchlistIndependentPaginationAndHTTPBoundCursors(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	red := createRiskGroup(t, a, admin, "red")
	yellow := createRiskGroup(t, a, admin, "yellow")
	today := time.Now().UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	for index := 1; index <= 24; index++ {
		person := createPerson(t, a, admin)
		seedWatchlistMembership(t, a, person, red, fmt.Sprintf("00000000-0000-4000-8000-%012x", index), date(-5), date(30), date(9), "active")
		if index <= 23 {
			seedWatchlistMembership(t, a, person, yellow, fmt.Sprintf("00000000-0000-4000-8000-%012x", index+100), date(-5), date(30), date(0), "active")
		}
	}
	defaultPage := watchlistHTTP(t, a, admin, "")
	if len(defaultPage.Red.Items) != 20 || len(defaultPage.Yellow.Items) != 20 || len(defaultPage.Alerts.Items) != 20 || defaultPage.Red.NextCursor == "" || defaultPage.Yellow.NextCursor == "" || defaultPage.Alerts.NextCursor == "" || defaultPage.Red.Total != 24 || defaultPage.Yellow.Total != 23 || defaultPage.Alerts.Total != 47 {
		t.Fatal("default bounded pages or complete totals differ")
	}
	first := watchlistHTTP(t, a, admin, "?limit=3")
	redNext := watchlistHTTP(t, a, admin, "?limit=3&redCursor="+url.QueryEscape(first.Red.NextCursor))
	if redNext.Red.Items[0].Membership.ID == first.Red.Items[0].Membership.ID || !reflect.DeepEqual(redNext.Yellow.Items, first.Yellow.Items) || !reflect.DeepEqual(redNext.Alerts.Items, first.Alerts.Items) {
		t.Fatal("advancing red moved yellow/alert pages or failed to advance")
	}
	for _, scope := range []string{"red", "yellow", "alerts"} {
		seen, cursor := map[string]bool{}, ""
		var previous string
		for {
			params := url.Values{"limit": {"3"}}
			if cursor != "" {
				key := scope + "Cursor"
				if scope == "alerts" {
					key = "alertCursor"
				}
				params.Set(key, cursor)
			}
			page := watchlistHTTP(t, a, admin, "?"+params.Encode())
			var items []WatchlistEntry
			ranks := map[string]int{}
			if scope == "red" {
				items, cursor = page.Red.Items, page.Red.NextCursor
			} else if scope == "yellow" {
				items, cursor = page.Yellow.Items, page.Yellow.NextCursor
			} else {
				cursor = page.Alerts.NextCursor
				for _, alert := range page.Alerts.Items {
					ranks[alert.Record.Membership.ID] = watchlistRank(alert.Kind)
					items = append(items, alert.Record)
				}
			}
			for _, item := range items {
				id := item.Membership.ID
				key := item.Membership.ReviewOn + ":" + id
				if scope == "alerts" {
					key = fmt.Sprintf("%d:", ranks[id]) + key
				}
				if seen[id] || key <= previous {
					t.Fatal("keyset pages duplicated, omitted or reordered equal-date IDs")
				}
				seen[id], previous = true, key
			}
			if cursor == "" {
				break
			}
		}
		want := map[string]int{"red": 24, "yellow": 23, "alerts": 47}[scope]
		if len(seen) != want {
			t.Fatalf("%s pagination yielded %d rows, want %d", scope, len(seen), want)
		}
	}
	for _, query := range []string{"?redCursor=" + url.QueryEscape(first.Yellow.NextCursor), "?yellowCursor=" + url.QueryEscape(first.Red.NextCursor), "?alertCursor=" + url.QueryEscape(first.Red.NextCursor), "?alertKind=review_due&alertCursor=" + url.QueryEscape(first.Alerts.NextCursor), "?redCursor=", "?alertCursor=bad", "?yellowCursor=%FF"} {
		expectCaseError(t, request(a, "GET", "/api/watchlist-overview"+query, nil, admin), 400, "invalid_cursor")
	}
	var stale watchlistCursor
	data, _ := base64.RawURLEncoding.DecodeString(first.Red.NextCursor)
	if err := json.Unmarshal(data, &stale); err != nil {
		t.Fatal(err)
	}
	stale.AsOf = today.AddDate(0, 0, -1).Format(time.DateOnly)
	expectCaseError(t, request(a, "GET", "/api/watchlist-overview?redCursor="+encodeWatchlistCursor(stale), nil, admin), 400, "invalid_cursor")
	filtered := watchlistHTTP(t, a, admin, "?limit=3&alertKind=red_priority&redCursor="+url.QueryEscape(first.Red.NextCursor))
	if filtered.Alerts.Total != 24 || filtered.Alerts.Counts.ReviewDue != 23 || len(filtered.Alerts.Items) != 3 || filtered.Alerts.Items[0].Kind != "red_priority" {
		t.Fatal("independent direct cursor or filtered global alert counts failed")
	}
}

func TestWatchlistSharedSnapshotAndPersonalSourceInbox(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	person := createPerson(t, a, admin)
	execSQL(t, a, `UPDATE entities SET name='Snapshot Ω🙂' WHERE id=$1`, person.ID)
	group := createRiskGroup(t, a, admin, "red")
	today := time.Now().UTC()
	item := seedWatchlistMembership(t, a, person, group, "", today.AddDate(0, 0, -1).Format(time.DateOnly), today.AddDate(0, 0, 30).Format(time.DateOnly), today.Format(time.DateOnly), "active")
	first, second := sampleEvent("watchlist-high-1"), sampleEvent("watchlist-high-2")
	first.Severity, second.Severity = "high", "critical"
	importCaseEvents(t, a, admin, first, second)
	notifications := decoded[struct{ Items []Notification }](t, request(a, "GET", "/api/notifications", nil, admin)).Items
	if len(notifications) != 2 || watchlistHTTP(t, a, admin, "").SourceNotifications.UnreadCount != 2 || watchlistHTTP(t, a, analyst, "").SourceNotifications.UnreadCount != 2 {
		t.Fatal("source notifications not included as a separate personal count")
	}
	expect(t, request(a, "POST", "/api/notifications/"+notifications[0].ID+"/read", map[string]any{}, admin), 200)
	if watchlistHTTP(t, a, admin, "").SourceNotifications.UnreadCount != 1 || watchlistHTTP(t, a, analyst, "").SourceNotifications.UnreadCount != 2 {
		t.Fatal("one analyst's receipt changed another analyst's unread count")
	}
	ctx := context.Background()
	tx, err := a.DB.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SET LOCAL TIME ZONE 'Etc/GMT+12'`); err != nil {
		t.Fatal(err)
	}
	var generatedAt time.Time
	var members int
	if err := tx.QueryRow(ctx, `SELECT transaction_timestamp(),(SELECT count(*) FROM memberships)`).Scan(&generatedAt, &members); err != nil || members != 1 {
		t.Fatal("snapshot checkpoint failed")
	}
	userID := watchlistUserID(t, a, admin)
	writer, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(ctx)
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`UPDATE memberships SET status='closed',version=version+1 WHERE id=$1`, []any{item.ID}},
		{`UPDATE risk_groups SET color='yellow',version=version+1 WHERE id=$1`, []any{group.ID}},
		{`UPDATE entities SET name='Changed after checkpoint',version=version+1 WHERE id=$1`, []any{person.ID}},
		{`INSERT INTO notification_reads(notification_id,user_id) VALUES($1,$2)`, []any{notifications[1].ID, userID}},
	} {
		if _, err := writer.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	selection := url.Values{"q": {"Snapshot Ω🙂"}, "entityKind": {"person"}}
	query, err := parseWatchlistQuery(selection.Encode(), generatedAt.UTC().Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	result, err := readWatchlistOverview(ctx, tx, query, userID, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if result.AsOf != generatedAt.UTC().Format(time.DateOnly) || result.GeneratedAt.Location() != time.UTC || result.Selection != (watchlistSelection{Q: "Snapshot Ω🙂", EntityKind: "person"}) || result.Red.Total != 1 || result.Red.Items[0].Entity.Name != "Snapshot Ω🙂" || result.Red.Items[0].Group.Color != "red" || result.Red.Items[0].Membership.Status != "active" || result.Alerts.Counts.ReviewDue != 1 || result.SourceNotifications.UnreadCount != 1 {
		t.Fatal("counts, nested records, alerts or unread escaped the shared UTC snapshot")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	current := watchlistHTTP(t, a, admin, "?"+selection.Encode())
	if current.Red.Total != 0 || current.Alerts.Total != 0 || current.SourceNotifications.UnreadCount != 0 {
		t.Fatal("a later request incorrectly retained the previous MVCC snapshot")
	}
}

func TestWatchlistDependencyFailuresFailClosed(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	group := createRiskGroup(t, a, admin, "red")
	in := memberInput(person, group)
	expect(t, request(a, "POST", "/api/memberships", in, admin), 201)
	for _, table := range []string{"memberships", "risk_groups", "entities", "notifications", "notification_reads"} {
		t.Run(table, func(t *testing.T) {
			unavailable := table + "_watchlist_unavailable"
			execSQL(t, a, "ALTER TABLE "+pgx.Identifier{table}.Sanitize()+" RENAME TO "+pgx.Identifier{unavailable}.Sanitize())
			defer execSQL(t, a, "ALTER TABLE "+pgx.Identifier{unavailable}.Sanitize()+" RENAME TO "+pgx.Identifier{table}.Sanitize())
			for _, endpoint := range []string{"/api/watchlist-overview", "/api/watchlist-summary"} {
				w := request(a, "GET", endpoint, nil, admin)
				expectCaseError(t, w, 503, "unavailable")
				if strings.Contains(w.Body.String(), `"red"`) || strings.Contains(w.Body.String(), `"alerts"`) || strings.Contains(w.Body.String(), `"unreadCount"`) {
					t.Fatal("partial/zero watchlist response exposed after a dependency failure")
				}
			}
		})
	}
	watchlistHTTP(t, a, admin, "")
	watchlistSummaryHTTP(t, a, admin)
}

func TestWatchlistCursorCanonicalQueryValidation(t *testing.T) {
	const day = "2030-01-15"
	base := watchlistCursor{Version: 2, Scope: "red", AsOf: day, ReviewOn: day, ID: "0f000000-0000-4000-8000-000000000001", EntityKind: "all"}
	valid := encodeWatchlistCursor(base)
	if _, err := parseWatchlistCursor(valid, "red", day, "", "", "all"); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*watchlistCursor){
		func(c *watchlistCursor) { c.Version = 1 }, func(c *watchlistCursor) { c.Scope = "yellow" },
		func(c *watchlistCursor) { c.AsOf = "2030-01-14" }, func(c *watchlistCursor) { c.Filter = "all" },
		func(c *watchlistCursor) { c.ReviewOn = "2030-1-15" }, func(c *watchlistCursor) { c.ReviewOn = "0000-01-01" },
		func(c *watchlistCursor) { c.ID = strings.ToUpper(c.ID) }, func(c *watchlistCursor) { c.ID = "invalid" },
		func(c *watchlistCursor) { c.Rank = 1 }, func(c *watchlistCursor) { c.SearchKey = "bWFudWFs" },
		func(c *watchlistCursor) { c.EntityKind = "person" },
	} {
		cursor := base
		change(&cursor)
		if _, err := parseWatchlistCursor(encodeWatchlistCursor(cursor), "red", day, "", "", "all"); !errorsIsCursor(err) {
			t.Fatal("invalid bound/canonical cursor accepted")
		}
	}
	data, _ := json.Marshal(base)
	for _, raw := range []string{string(data) + " ", strings.Replace(string(data), `"version":2`, `"version":2,"version":2`, 1), strings.TrimSuffix(string(data), "}") + `,"extra":1}`, string(data) + string(data)} {
		if _, err := parseWatchlistCursor(base64.RawURLEncoding.EncodeToString([]byte(raw)), "red", day, "", "", "all"); !errorsIsCursor(err) {
			t.Fatal("duplicate/unknown/trailing JSON cursor accepted")
		}
	}
	for _, raw := range []string{"", "not-base64!", valid + "=", valid + "\n", strings.Repeat("a", 2049)} {
		if _, err := parseWatchlistCursor(raw, "red", day, "", "", "all"); !errorsIsCursor(err) {
			t.Fatal("noncanonical/oversize base64 cursor accepted")
		}
	}
	alert := base
	alert.Scope, alert.Filter, alert.Rank = "alerts", "review_due", 2
	if _, err := parseWatchlistCursor(encodeWatchlistCursor(alert), "alerts", day, "review_due", "", "all"); err != nil {
		t.Fatal(err)
	}
	for _, rank := range []int{0, 1, 3, 5} {
		alert.Rank = rank
		if _, err := parseWatchlistCursor(encodeWatchlistCursor(alert), "alerts", day, "review_due", "", "all"); !errorsIsCursor(err) {
			t.Fatal("wrong alert rank/filter cursor accepted")
		}
	}
	if _, err := parseWatchlistQuery("redCursor="+valid+"&redCursor="+valid, day); err == nil {
		t.Fatal("duplicate cursor query accepted")
	}
	if query, err := parseWatchlistQuery("limit=100&alertKind=review_upcoming&redCursor="+valid, day); err != nil || query.Limit != 100 || query.RedCursor == nil || query.AlertKind != "review_upcoming" {
		t.Fatal("independent direct cursor and maximum limit rejected")
	}
}

func errorsIsCursor(err error) bool { return err == errWatchlistCursor }

func TestWatchlistSearchQueryRuneBoundsAndV2Encoding(t *testing.T) {
	const day = "2030-01-15"
	for _, search := range []string{"abc", "  Çınar🙂  ", "🙂🙂🙂", strings.Repeat("🙂", 120), `Ab%_\z`, `<&>`} {
		values := url.Values{"q": {search}, "entityKind": {"application"}}
		query, err := parseWatchlistQuery(values.Encode(), day)
		normalized := strings.TrimSpace(search)
		if err != nil || query.Selection != (watchlistSelection{Q: normalized, EntityKind: "application"}) || query.SearchKey != base64.RawURLEncoding.EncodeToString([]byte(normalized)) {
			t.Fatal("Unicode/rune search bounds or authoritative selection changed")
		}
		cursor := watchlistCursor{Version: 2, Scope: "red", AsOf: day, ReviewOn: day, ID: "0f000000-0000-4000-8000-000000000001", SearchKey: query.SearchKey, EntityKind: query.Selection.EntityKind}
		data, _ := json.Marshal(cursor)
		want := fmt.Sprintf(`{"version":2,"scope":"red","asOf":"%s","filter":"","reviewOn":"%s","id":"%s","rank":0,"searchKey":"%s","entityKind":"application"}`, day, day, cursor.ID, query.SearchKey)
		if string(data) != want {
			t.Fatal("V2 cursor field order or ASCII search key differs from the client codec")
		}
		values.Set("redCursor", encodeWatchlistCursor(cursor))
		values.Set("q", normalized)
		if _, err := parseWatchlistQuery(values.Encode(), day); err != nil {
			t.Fatal("trim-equivalent query failed cursor validation")
		}
		values.Set("q", normalized+"x")
		if len([]rune(normalized)) < 120 {
			if _, err := parseWatchlistQuery(values.Encode(), day); !errorsIsCursor(err) {
				t.Fatal("changed search scope accepted the previous cursor")
			}
		}
	}
	query, err := parseWatchlistQuery("q="+url.QueryEscape(`Ab%_\z`), day)
	if err != nil || query.SearchPattern != `%Ab\%\_\\z%` {
		t.Fatal("literal percent, underscore or backslash was not escaped by shared list search")
	}
	for _, search := range []string{"", "   ", "🙂🙂", strings.Repeat("🙂", 121), "abc\n", "a\x00bc", string([]byte{'a', 'b', 0xff})} {
		if _, err := parseWatchlistQuery(url.Values{"q": {search}}.Encode(), day); err == nil || errorsIsCursor(err) {
			t.Fatal("invalid supplied search accepted or misreported as a cursor failure")
		}
	}
	for _, kind := range []string{"all", "person", "account", "device", "service", "application"} {
		query, err := parseWatchlistQuery(url.Values{"entityKind": {kind}}.Encode(), day)
		if err != nil || query.Selection != (watchlistSelection{EntityKind: kind}) || query.SearchPattern != "" || query.SearchKey != "" {
			t.Fatal("omitted search or supported entity kind changed")
		}
	}
	legacy := `{"version":1,"scope":"red","asOf":"2030-01-15","filter":"","reviewOn":"2030-01-15","id":"0f000000-0000-4000-8000-000000000001","rank":0}`
	if _, err := parseWatchlistQuery("redCursor="+base64.RawURLEncoding.EncodeToString([]byte(legacy)), day); !errorsIsCursor(err) {
		t.Fatal("a legacy V1 cursor survived the selection contract change")
	}
}

func TestWatchlistLiteralSearchAcrossAllFieldsAndEntityKinds(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	instant := time.Date(2030, 1, 15, 12, 0, 0, 0, time.UTC)
	date := func(offset int) string { return instant.AddDate(0, 0, offset).Format(time.DateOnly) }
	const needle = `Ab%_\z`
	kinds := []string{"person", "account", "device", "service", "application", "person"}
	colors := []string{"red", "yellow", "orange", "slate", "red", "yellow"}
	for index := 0; index < 6; index++ {
		in := entityInput{Kind: kinds[index], Name: fmt.Sprintf("Source %d", index), Department: "Baseline department", Identifier: fmt.Sprintf("source-%d", index)}
		if index == 0 {
			in.Name = "Entity " + needle
		} else if index == 1 {
			in.Identifier = "ID-" + needle
		} else if index == 2 {
			in.Department = "Department " + needle
		}
		entity := createWatchlistEntity(t, a, admin, in)
		group := createRiskGroup(t, a, admin, colors[index])
		if index == 3 {
			execSQL(t, a, `UPDATE risk_groups SET name=$2 WHERE id=$1`, group.ID, "Group "+needle)
		}
		member := seedWatchlistMembership(t, a, entity, group, "", date(-1), date(30), date(0), "active")
		if index == 4 {
			execSQL(t, a, `UPDATE memberships SET reason=$2 WHERE id=$1`, member.ID, "Manual reason "+needle)
		} else if index == 5 {
			execSQL(t, a, `UPDATE memberships SET responsible=$2 WHERE id=$1`, member.ID, "Reviewer "+needle)
		}
	}
	// Neither a wildcard-looking near match nor excluded description fields
	// may join the six selected records.
	for _, in := range []entityInput{
		{Kind: "person", Name: `Entity AbZZx\z`},
		{Kind: "person", Name: "Description-only record", Description: needle},
		{Kind: "person", Name: "Çınar🙂 ekibi"},
	} {
		entity := createWatchlistEntity(t, a, admin, in)
		group := createRiskGroup(t, a, admin, "red")
		seedWatchlistMembership(t, a, entity, group, "", date(-1), date(30), date(0), "active")
	}
	before := watchlistFingerprint(t, a)
	query := url.Values{"q": {`  aB%_\Z  `}}
	result := watchlistAt(t, a, watchlistUserID(t, a, admin), instant, query.Encode())
	if result.Selection != (watchlistSelection{Q: `aB%_\Z`, EntityKind: "all"}) || result.Red.Total != 2 || result.Red.ActiveCount != 2 || result.Yellow.Total != 2 || result.Yellow.ActiveCount != 2 || result.Alerts.Total != 6 || result.Alerts.Counts != (watchlistAlertCounts{ReviewDue: 6}) {
		t.Fatal("literal case-insensitive six-field selection or complete counts differ")
	}
	for _, kind := range []string{"person", "account", "device", "service", "application"} {
		query.Set("entityKind", kind)
		filtered := watchlistAt(t, a, watchlistUserID(t, a, admin), instant, query.Encode())
		want := 1
		if kind == "person" {
			want = 2
		}
		if filtered.Alerts.Total != want || filtered.Alerts.Counts.ReviewDue != want || filtered.Selection.EntityKind != kind {
			t.Fatal("entity kind did not intersect the complete six-field search")
		}
		for _, item := range filtered.Alerts.Items {
			if item.Record.Entity.Kind != kind {
				t.Fatal("another kind escaped the selection")
			}
		}
	}
	unicode := watchlistAt(t, a, watchlistUserID(t, a, admin), instant, url.Values{"q": {"  Çınar🙂  "}}.Encode())
	if unicode.Selection.Q != "Çınar🙂" || unicode.Red.Total != 1 || unicode.Alerts.Total != 1 || unicode.Red.Items[0].Entity.Name != "Çınar🙂 ekibi" {
		t.Fatal("Turkish/emoji literal UTF-8 search did not reach PostgreSQL intact")
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("filtered projection mutated product rows")
	}
}

func TestWatchlistFilteredHistoryPagingAndIndependentUnread(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	today := time.Now().UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	groups := map[string]Group{}
	for _, color := range []string{"red", "yellow", "orange", "slate"} {
		groups[color] = createRiskGroup(t, a, admin, color)
	}
	// Earlier rows exceed a normal page and do not match. Searching must read
	// the full database rather than filtering the first unselected page.
	for index := 0; index < 40; index++ {
		entity := createWatchlistEntity(t, a, admin, entityInput{Kind: "person", Name: fmt.Sprintf("Earlier unselected %d", index)})
		seedWatchlistMembership(t, a, entity, groups["red"], "", date(-10), date(30), date(-5), "active")
	}
	const needle = `Deep%_\Record Çınar🙂`
	for _, kind := range []string{"person", "account", "device", "service", "application"} {
		for index, fixture := range []struct {
			color       string
			end, review int
		}{{"red", -1, -3}, {"red", 30, 9}, {"yellow", 30, 0}, {"yellow", 30, 4}, {"orange", 30, 0}, {"slate", 30, 0}} {
			entity := createWatchlistEntity(t, a, admin, entityInput{Kind: kind, Name: fmt.Sprintf("%s %s %d", needle, kind, index)})
			seedWatchlistMembership(t, a, entity, groups[fixture.color], "", date(-10), date(fixture.end), date(fixture.review), "active")
		}
	}
	for _, fixture := range []struct{ kind, color, status string }{{"device", "red", "active"}, {"person", "yellow", "active"}, {"application", "red", "closed"}} {
		entity := createWatchlistEntity(t, a, admin, entityInput{Kind: fixture.kind, Name: needle + " extra " + fixture.kind})
		seedWatchlistMembership(t, a, entity, groups[fixture.color], "", date(1), date(30), date(4), fixture.status)
	}
	firstEvent, secondEvent := sampleEvent("selected-source-1"), sampleEvent("selected-source-2")
	firstEvent.Severity, secondEvent.Severity = "high", "critical"
	importCaseEvents(t, a, admin, firstEvent, secondEvent)
	notifications := decoded[struct{ Items []Notification }](t, request(a, "GET", "/api/notifications", nil, admin)).Items
	if len(notifications) != 2 {
		t.Fatal("source inbox fixture was not created")
	}
	expect(t, request(a, "POST", "/api/notifications/"+notifications[0].ID+"/read", map[string]any{}, admin), 200)
	before := watchlistFingerprint(t, a)
	for _, entry := range watchlistHTTP(t, a, admin, "").Red.Items {
		if strings.Contains(entry.Entity.Name, needle) {
			t.Fatal("late search fixture unexpectedly appeared in the first unselected page")
		}
	}
	selected := url.Values{"q": {"  " + needle + "  "}}
	first := watchlistHTTP(t, a, admin, "?"+selected.Encode())
	counts := watchlistAlertCounts{Expired: 5, ReviewDue: 15, RedPriority: 5, ReviewUpcoming: 5}
	if first.Selection != (watchlistSelection{Q: needle, EntityKind: "all"}) || first.Red.Total != 11 || first.Red.ActiveCount != 5 || first.Yellow.Total != 11 || first.Yellow.ActiveCount != 10 || first.Alerts.Total != 30 || first.Alerts.Counts != counts || len(first.Alerts.Items) != 20 || first.Alerts.NextCursor == "" || first.SourceNotifications.UnreadCount != 1 {
		t.Fatal("full-history selection changed date labels, page bounds or complete filtered counts")
	}
	for _, scope := range []string{"red", "yellow", "alerts"} {
		values := url.Values{"q": {needle}, "limit": {"2"}}
		key := scope + "Cursor"
		if scope == "alerts" {
			key = "alertCursor"
		}
		seen := map[string]bool{}
		for {
			page := watchlistHTTP(t, a, admin, "?"+values.Encode())
			if page.Alerts.Counts != counts || page.Alerts.Total != 30 || page.Red.Total != 11 || page.Yellow.Total != 11 || page.SourceNotifications.UnreadCount != 1 || page.Selection.Q != needle {
				t.Fatal("filtered keyset advancement changed full counts, selection or unread")
			}
			items, cursor := page.Red.Items, page.Red.NextCursor
			if scope == "yellow" {
				items, cursor = page.Yellow.Items, page.Yellow.NextCursor
			} else if scope == "alerts" {
				items, cursor = nil, page.Alerts.NextCursor
				for _, alert := range page.Alerts.Items {
					items = append(items, alert.Record)
				}
			}
			for _, entry := range items {
				if seen[entry.Membership.ID] || !strings.Contains(entry.Entity.Name, needle) {
					t.Fatal("filtered keyset duplicated a row or admitted a nonmatch")
				}
				seen[entry.Membership.ID] = true
			}
			if cursor == "" {
				break
			}
			values.Set(key, cursor)
		}
		want := 11
		if scope == "alerts" {
			want = 30
		}
		if len(seen) != want {
			t.Fatal("filtered history pages omitted late database rows")
		}
	}
	selected.Set("entityKind", "person")
	selected.Set("limit", "2")
	personPage := watchlistHTTP(t, a, admin, "?"+selected.Encode())
	if personPage.Red.Total != 2 || personPage.Red.ActiveCount != 1 || personPage.Yellow.Total != 3 || personPage.Yellow.ActiveCount != 2 || personPage.Alerts.Total != 6 || personPage.Alerts.Counts != (watchlistAlertCounts{Expired: 1, ReviewDue: 3, RedPriority: 1, ReviewUpcoming: 1}) || personPage.Yellow.NextCursor == "" || personPage.Alerts.NextCursor == "" {
		t.Fatal("kind intersection did not include scheduled labels or complete primary-alert counts")
	}
	selected.Set("yellowCursor", personPage.Yellow.NextCursor)
	selected.Set("alertCursor", personPage.Alerts.NextCursor)
	secondPersonPage := watchlistHTTP(t, a, admin, "?"+selected.Encode())
	if len(secondPersonPage.Yellow.Items) != 1 || secondPersonPage.Yellow.Total != 3 || secondPersonPage.Yellow.Items[0].Membership.ID == personPage.Yellow.Items[0].Membership.ID || secondPersonPage.Alerts.Counts != personPage.Alerts.Counts {
		t.Fatal("kind-bound cursors did not advance complete filtered pages")
	}
	for _, params := range []url.Values{
		{"q": {needle + " altered"}, "alertCursor": {first.Alerts.NextCursor}},
		{"q": {needle}, "entityKind": {"person"}, "alertCursor": {first.Alerts.NextCursor}},
		{"q": {needle}, "entityKind": {"device"}, "yellowCursor": {personPage.Yellow.NextCursor}},
		{"q": {needle}, "entityKind": {"person"}, "redCursor": {personPage.Yellow.NextCursor}},
		{"q": {needle}, "alertKind": {"review_due"}, "alertCursor": {first.Alerts.NextCursor}},
		{"alertCursor": {first.Alerts.NextCursor}},
	} {
		expectCaseError(t, request(a, "GET", "/api/watchlist-overview?"+params.Encode(), nil, admin), 400, "invalid_cursor")
	}
	due := watchlistHTTP(t, a, admin, "?"+url.Values{"q": {needle}, "alertKind": {"review_due"}, "limit": {"2"}}.Encode())
	if due.Alerts.Total != 15 || due.Alerts.Counts != counts || due.Red.Total != 11 || due.SourceNotifications.UnreadCount != 1 {
		t.Fatal("alert kind changed the selected complete counts or unrelated source inbox")
	}
	for _, cookie := range []*http.Cookie{admin, analyst} {
		noResults := watchlistHTTP(t, a, cookie, "?"+url.Values{"q": {"No matching manual record"}, "entityKind": {"device"}}.Encode())
		wantUnread := 1
		if cookie == analyst {
			wantUnread = 2
		}
		if noResults.Red.Total != 0 || noResults.Yellow.Total != 0 || noResults.Alerts.Total != 0 || noResults.Alerts.Counts != (watchlistAlertCounts{}) || noResults.SourceNotifications.UnreadCount != wantUnread {
			t.Fatal("empty manual selection changed personal all-source unread or exposed unfiltered counts")
		}
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("search, kind and cursor reads mutated product data")
	}
}

func TestWatchlistSummaryRolesParamsShapeAndNoWrites(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	member := addUser(t, a, "member")
	viewer := addUser(t, a, "viewer")
	before := watchlistFingerprint(t, a)
	expectCaseError(t, request(a, "GET", "/api/watchlist-summary", nil, nil), 401, "unauthorized")
	for _, cookie := range []*http.Cookie{member, viewer} {
		expectCaseError(t, request(a, "GET", "/api/watchlist-summary", nil, cookie), 403, "forbidden")
	}
	for _, cookie := range []*http.Cookie{admin, analyst} {
		w := request(a, "GET", "/api/watchlist-summary", nil, cookie)
		expect(t, w, 200)
		result := decoded[watchlistSummary](t, w)
		if result.AsOf != result.GeneratedAt.UTC().Format(time.DateOnly) || result.GeneratedAt.Location() != time.UTC || result.Alerts.Total != 0 || result.Alerts.Counts != (watchlistAlertCounts{}) || result.SourceNotifications.UnreadCount != 0 {
			t.Fatal("empty compact summary lost UTC time or explicit complete zero counts")
		}
		shape := decoded[map[string]json.RawMessage](t, w)
		if len(shape) != 4 || shape["asOf"] == nil || shape["generatedAt"] == nil || shape["alerts"] == nil || shape["sourceNotifications"] == nil || !strings.HasSuffix(string(shape["generatedAt"]), `Z"`) {
			t.Fatal("summary top-level schema contains missing/extra fields or a non-UTC timestamp")
		}
		var alerts, counts, inbox map[string]json.RawMessage
		if json.Unmarshal(shape["alerts"], &alerts) != nil || len(alerts) != 2 || alerts["total"] == nil || alerts["counts"] == nil || json.Unmarshal(alerts["counts"], &counts) != nil || len(counts) != 4 || json.Unmarshal(shape["sourceNotifications"], &inbox) != nil || len(inbox) != 1 || inbox["unreadCount"] == nil {
			t.Fatal("summary contains paging/rows or lacks the fixed count/inbox fields")
		}
		for _, kind := range []string{"expired", "review_due", "red_priority", "review_upcoming"} {
			if string(counts[kind]) != "0" {
				t.Fatal("summary omitted a zero primary-alert kind")
			}
		}
	}
	for _, raw := range []string{"q=", "q=manual", "q=manual&q=manual", "entityKind=all", "limit=20", "redCursor=", "alertKind=all", "%zz=x", "q=%FF", "&&", "bad"} {
		expectCaseError(t, request(a, "GET", "/api/watchlist-summary?"+raw, nil, admin), 400, "invalid_input")
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("compact summary or rejected parameters mutated product/session data")
	}
}

func TestWatchlistSummaryUncappedCountsOverviewParityAndPersonalInbox(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	red := createRiskGroup(t, a, admin, "red")
	today := time.Now().UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	execSQL(t, a, `WITH inserted AS (
 INSERT INTO entities(id,kind,name)
 SELECT ('10000000-0000-4000-8000-'||lpad(to_hex(number),12,'0'))::uuid,'account','Uncapped account '||number
 FROM generate_series(1,1100) AS number RETURNING id)
 INSERT INTO memberships(id,entity_id,group_id,reason,responsible,starts_on,ends_on,review_on,status)
 SELECT e.id,e.id,$1::uuid,'Manual uncapped review fixture','Synthetic reviewer',$2::text::date,$3::text::date,$4::text::date,'active'
 FROM inserted e`, red.ID, date(-10), date(30), date(10))
	person := createPerson(t, a, admin)
	for _, fixture := range []struct {
		color, status      string
		start, end, review int
	}{
		{"red", "active", -10, -1, -3}, {"orange", "active", -10, -1, -3},
		{"yellow", "active", -10, 30, 0}, {"slate", "active", -10, 30, 0},
		{"yellow", "active", -10, 30, 7}, {"yellow", "active", -10, 30, 8},
		{"red", "active", 1, 30, 4}, {"red", "closed", -10, 30, 0},
	} {
		group := createRiskGroup(t, a, admin, fixture.color)
		seedWatchlistMembership(t, a, person, group, "", date(fixture.start), date(fixture.end), date(fixture.review), fixture.status)
	}
	first, second := sampleEvent("summary-inbox-1"), sampleEvent("summary-inbox-2")
	first.Severity, second.Severity = "high", "critical"
	importCaseEvents(t, a, admin, first, second)
	notifications := decoded[struct{ Items []Notification }](t, request(a, "GET", "/api/notifications", nil, admin)).Items
	if len(notifications) != 2 {
		t.Fatal("personal source-inbox fixture missing")
	}
	expect(t, request(a, "POST", "/api/notifications/"+notifications[0].ID+"/read", map[string]any{}, admin), 200)
	before := watchlistFingerprint(t, a)
	for _, endpoint := range []string{"/api/entities", "/api/memberships"} {
		expectCaseError(t, request(a, "GET", endpoint, nil, admin), 422, "collection_limit")
	}
	summary := watchlistSummaryHTTP(t, a, admin)
	want := watchlistAlertCounts{Expired: 2, ReviewDue: 2, RedPriority: 1100, ReviewUpcoming: 1}
	if summary.Alerts.Counts != want || summary.Alerts.Total != 1105 || summary.SourceNotifications.UnreadCount != 1 {
		t.Fatal("summary applied a collection cap, omitted all-color alerts or changed primary precedence")
	}
	overview := watchlistHTTP(t, a, admin, "?limit=1")
	if overview.Alerts.Counts != summary.Alerts.Counts || overview.Alerts.Total != summary.Alerts.Total || overview.SourceNotifications != summary.SourceNotifications || len(overview.Alerts.Items) != 1 {
		t.Fatal("global summary differs from the unfiltered complete overview despite a one-row page")
	}
	filtered := watchlistHTTP(t, a, admin, "?"+url.Values{"q": {"Uncapped account"}, "entityKind": {"account"}, "alertKind": {"review_due"}, "limit": {"1"}}.Encode())
	if filtered.Alerts.Total != 0 || filtered.Alerts.Counts != (watchlistAlertCounts{RedPriority: 1100}) || filtered.Red.Total != 1100 {
		t.Fatal("overview selection fixture did not retain independent filtered counts")
	}
	if after := watchlistSummaryHTTP(t, a, admin); after.Alerts != summary.Alerts || after.SourceNotifications != summary.SourceNotifications {
		t.Fatal("an overview search/type/kind/page selection contaminated the global summary")
	}
	other := watchlistSummaryHTTP(t, a, analyst)
	if other.Alerts != summary.Alerts || other.SourceNotifications.UnreadCount != 2 {
		t.Fatal("summary source receipt is not personal or changed membership alert counts")
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("uncapped global summary, filtered overview or personal summary mutated records")
	}
}

func TestWatchlistSummarySharedReadonlySnapshot(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	group := createRiskGroup(t, a, admin, "red")
	today := time.Now().UTC()
	date := func(offset int) string { return today.AddDate(0, 0, offset).Format(time.DateOnly) }
	item := seedWatchlistMembership(t, a, person, group, "", date(-1), date(30), date(10), "active")
	event := sampleEvent("summary-snapshot-source")
	event.Severity = "high"
	importCaseEvents(t, a, admin, event)
	notifications := decoded[struct{ Items []Notification }](t, request(a, "GET", "/api/notifications", nil, admin)).Items
	if len(notifications) != 1 {
		t.Fatal("summary snapshot inbox fixture missing")
	}
	ctx := context.Background()
	tx, generatedAt, err := a.beginWatchlistSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	var accessMode, isolation string
	if err := tx.QueryRow(ctx, `SHOW transaction_read_only`).Scan(&accessMode); err != nil || accessMode != "on" {
		t.Fatal("shared watchlist snapshot is not read only")
	}
	if err := tx.QueryRow(ctx, `SHOW transaction_isolation`).Scan(&isolation); err != nil || isolation != "repeatable read" {
		t.Fatal("shared watchlist snapshot does not have repeatable-read isolation")
	}
	if _, err := tx.Exec(ctx, `SET LOCAL TIME ZONE 'Etc/GMT+12'`); err != nil {
		t.Fatal(err)
	}
	userID := watchlistUserID(t, a, admin)
	writer, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Rollback(ctx)
	if _, err := writer.Exec(ctx, `UPDATE memberships SET status='closed',version=version+1 WHERE id=$1`, item.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Exec(ctx, `INSERT INTO notification_reads(notification_id,user_id) VALUES($1,$2)`, notifications[0].ID, userID); err != nil {
		t.Fatal(err)
	}
	if err := writer.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	summary, err := readWatchlistSummary(ctx, tx, userID, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	query, err := parseWatchlistQuery("limit=1", generatedAt.Format(time.DateOnly))
	if err != nil {
		t.Fatal(err)
	}
	overview, err := readWatchlistOverview(ctx, tx, query, userID, generatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if summary.GeneratedAt.Location() != time.UTC || summary.AsOf != generatedAt.UTC().Format(time.DateOnly) || summary.Alerts.Total != 1 || summary.Alerts.Counts != (watchlistAlertCounts{RedPriority: 1}) || summary.SourceNotifications.UnreadCount != 1 || overview.Alerts.Counts != summary.Alerts.Counts || overview.SourceNotifications != summary.SourceNotifications {
		t.Fatal("summary counts or personal unread escaped the shared UTC snapshot")
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	before := watchlistFingerprint(t, a)
	current := watchlistSummaryHTTP(t, a, admin)
	if current.Alerts.Total != 0 || current.Alerts.Counts != (watchlistAlertCounts{}) || current.SourceNotifications.UnreadCount != 0 {
		t.Fatal("a later summary request retained the closed/read previous snapshot")
	}
	if !reflect.DeepEqual(before, watchlistFingerprint(t, a)) {
		t.Fatal("snapshot summary read mutated product data")
	}
}
