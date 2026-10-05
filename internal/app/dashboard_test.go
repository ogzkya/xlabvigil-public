package app

import (
	"context"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func insertRawEvent(t *testing.T, a *App, connectionID, externalID string, occurredAt time.Time, severity, title, summary string) {
	t.Helper()
	execSQL(t, a, `INSERT INTO security_events(id,connection_id,external_id,occurred_at,category,severity,title,summary,identity_state,content_hash)
 VALUES($1,$2,$3,$4,'authentication',$5,$6,$7,'unlinked',$8)`, UUID(), connectionID, externalID, occurredAt, severity, title, summary, tokenHash(externalID))
}

func dashboardAt(t *testing.T, a *App, instant time.Time) dashboardResult {
	t.Helper()
	ctx := context.Background()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	// A non-UTC session zone proves bucketing does not depend on it.
	if _, err := tx.Exec(ctx, `SET LOCAL TimeZone='Pacific/Kiritimati'`); err != nil {
		t.Fatal(err)
	}
	result, err := readDashboard(ctx, tx, instant)
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDashboardAccessAndStrictQuery(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	for role, cookie := range map[string]*http.Cookie{"admin": admin, "analyst": addUser(t, a, "analyst")} {
		w := request(a, "GET", "/api/dashboard", nil, cookie)
		expect(t, w, 200)
		if w.Header().Get("Content-Type") != "application/json; charset=utf-8" {
			t.Fatalf("%s dashboard content type %q", role, w.Header().Get("Content-Type"))
		}
	}
	for _, role := range []string{"member", "viewer"} {
		expectCaseError(t, request(a, "GET", "/api/dashboard", nil, addUser(t, a, role)), 403, "forbidden")
	}
	expectCaseError(t, request(a, "GET", "/api/dashboard", nil, nil), 401, "unauthorized")
	for _, query := range []string{"?limit=5", "?q=abc", "?days=14", "?x", "?%zz"} {
		expectCaseError(t, request(a, "GET", "/api/dashboard"+query, nil, admin), 400, "invalid_input")
	}
	if count(t, a, `SELECT count(*) FROM audit_events WHERE action NOT IN ('workspace.created')`) != 0 {
		t.Fatal("dashboard read wrote audit rows")
	}
}

func TestDashboardEmptyShapeIsZeroFilled(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	w := request(a, "GET", "/api/dashboard", nil, admin)
	expect(t, w, 200)
	raw := decoded[map[string]any](t, w)
	keys := []string{}
	for key := range raw {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if !reflect.DeepEqual(keys, []string{"cases", "eventSeverityTotals", "eventTotal", "eventTrend", "generatedAt", "sourceCount"}) {
		t.Fatalf("dashboard keys %v", keys)
	}
	severityKeys := func(value any) []string {
		out := []string{}
		for key := range value.(map[string]any) {
			out = append(out, key)
		}
		sort.Strings(out)
		return out
	}
	if got := severityKeys(raw["eventSeverityTotals"]); !reflect.DeepEqual(got, []string{"critical", "high", "info", "low", "medium"}) {
		t.Fatalf("severity total keys %v", got)
	}
	trend := raw["eventTrend"].([]any)
	if len(trend) != 14 {
		t.Fatalf("trend length %d", len(trend))
	}
	if got := severityKeys(trend[0]); !reflect.DeepEqual(got, []string{"critical", "day", "high", "info", "low", "medium"}) {
		t.Fatalf("trend keys %v", got)
	}
	result := decoded[dashboardResult](t, w)
	today := result.GeneratedAt.UTC().Format(time.DateOnly)
	if generatedAt, _ := raw["generatedAt"].(string); !strings.HasSuffix(generatedAt, "Z") {
		t.Fatalf("generatedAt %q is not a UTC timestamp", generatedAt)
	}
	if result.EventTrend[13].Day != today {
		t.Fatalf("trend ends %s, want %s", result.EventTrend[13].Day, today)
	}
	for i, day := range result.EventTrend {
		want := result.GeneratedAt.UTC().AddDate(0, 0, i-13).Format(time.DateOnly)
		if day.Day != want || day.severityCounts != (severityCounts{}) {
			t.Fatalf("trend[%d]=%+v, want zero day %s", i, day, want)
		}
	}
	if result.EventSeverityTotals != (severityCounts{}) || result.EventTotal != 0 || result.Cases != (dashboardCases{}) || result.SourceCount != 0 {
		t.Fatalf("empty dashboard not zero: %+v", result)
	}
}

func TestDashboardBucketsEventsByUTCDayAndSeverity(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	at := func(value string) time.Time {
		parsed, err := time.Parse(time.RFC3339Nano, value)
		if err != nil {
			t.Fatal(err)
		}
		return parsed
	}
	instant := at("2026-03-10T00:30:00Z")
	for i, event := range []struct {
		when, severity string
	}{
		{"2026-02-24T23:59:59.999999Z", "critical"}, // day before the window
		{"2026-02-25T00:00:00Z", "info"},            // first day, boundary
		{"2026-03-09T23:59:59.999999Z", "high"},     // previous day, last microsecond
		{"2026-03-10T01:30:00+03:00", "high"},       // 2026-03-09T22:30Z
		{"2026-03-10T00:00:00Z", "low"},             // current day, boundary
		{"2026-03-10T00:10:00Z", "medium"},
		{"2026-03-10T00:20:00Z", "medium"},
		{"2026-03-11T00:00:00Z", "critical"}, // after the current UTC day
	} {
		insertRawEvent(t, a, connection.ID, "bucket-"+string(rune('a'+i)), at(event.when), event.severity, "Bucket test", "")
	}
	result := dashboardAt(t, a, instant)
	if len(result.EventTrend) != 14 || result.EventTrend[0].Day != "2026-02-25" || result.EventTrend[13].Day != "2026-03-10" {
		t.Fatalf("trend window %+v", result.EventTrend)
	}
	want := map[string]severityCounts{
		"2026-02-25": {Info: 1},
		"2026-03-09": {High: 2},
		"2026-03-10": {Low: 1, Medium: 2},
	}
	for _, day := range result.EventTrend {
		if day.severityCounts != want[day.Day] {
			t.Fatalf("day %s counts %+v, want %+v", day.Day, day.severityCounts, want[day.Day])
		}
	}
	if result.EventSeverityTotals != (severityCounts{Info: 1, Low: 1, Medium: 2, High: 2, Critical: 2}) || result.EventTotal != 8 {
		t.Fatalf("totals %+v total %d", result.EventSeverityTotals, result.EventTotal)
	}
	if !result.GeneratedAt.Equal(instant) || result.SourceCount != 1 {
		t.Fatalf("generatedAt %s sourceCount %d", result.GeneratedAt, result.SourceCount)
	}
}

func TestDashboardCountsCasesSourcesAndRecentEvents(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	testConnection(t, a, admin)
	second := testConnection(t, a, admin)
	insertRawEvent(t, a, second.ID, "recent-critical", time.Now().UTC().Add(-time.Minute), "critical", "Recent critical", "")
	insertRawEvent(t, a, second.ID, "old-low", time.Now().UTC().AddDate(-1, 0, 0), "low", "Old low", "")
	for i := 0; i < 3; i++ {
		createTestCase(t, a, admin)
	}
	closed := createTestCase(t, a, analyst)
	expect(t, request(a, "POST", casePath(closed)+"/actions", caseActionInput{Action: "close", Reason: "İnceleme tamamlandı ve kapatıldı", ExpectedVersion: 1}, analyst), 201)
	w := request(a, "GET", "/api/dashboard", nil, analyst)
	expect(t, w, 200)
	result := decoded[dashboardResult](t, w)
	if result.Cases != (dashboardCases{Open: 3, Closed: 1}) || result.SourceCount != 2 || result.EventTotal != 2 {
		t.Fatalf("dashboard counts %+v", result)
	}
	if result.EventSeverityTotals != (severityCounts{Low: 1, Critical: 1}) {
		t.Fatalf("severity totals %+v", result.EventSeverityTotals)
	}
	var trendCritical int64
	for _, day := range result.EventTrend {
		trendCritical += day.Critical
		if day.Low != 0 {
			t.Fatal("old event counted in trend")
		}
	}
	if trendCritical != 1 {
		t.Fatalf("recent critical events in trend %d", trendCritical)
	}
}
