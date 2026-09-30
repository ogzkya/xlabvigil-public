package app

import (
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

func manualConnectionInput() connectionInput {
	return connectionInput{Name: "Local normalized acceptance", Provider: "palo_alto", Transport: "manual_json", Status: "configured", Scope: "Explicit normalized security metadata only"}
}

func testConnection(t *testing.T, a *App, c *http.Cookie) Connection {
	t.Helper()
	w := request(a, "POST", "/api/connections", manualConnectionInput(), c)
	expect(t, w, 201)
	return decoded[Connection](t, w)
}

func sampleEvent(id string) eventInput {
	return eventInput{ExternalID: id, OccurredAt: time.Now().UTC().Add(-time.Hour).Truncate(time.Microsecond), Category: "authentication", Severity: "medium", Title: "Normalized test authentication", Summary: "Isolated local acceptance record", Subject: `TEST\account`, Device: "test-device", SourceIP: "192.0.2.10", OriginProduct: "PAN-OS", OriginEventID: id}
}

func TestConnectionValidation(t *testing.T) {
	for _, tc := range []struct {
		name, provider, transport, endpoint, secret string
		valid                                       bool
	}{
		{"local", "palo_alto", "manual_json", "", "", true},
		{"ldaps", "ldap_ad", "ldaps", "ldaps://directory.example.test:636", "env:VIGIL_LDAP_PASSWORD", true},
		{"wef", "windows_wef", "wef_https", "https://wef.example.test:5986", "", true},
		{"syslog", "logsign", "syslog_tls", "tls://logs.example.test:6514", "", true},
		{"api", "trend_vision_one", "api_https", "https://api.example.test/v3.0", "env:VISION_TOKEN", true},
		{"userinfo", "palo_alto", "api_https", "https://user:secret@api.example.test", "", false},
		{"query", "palo_alto", "api_https", "https://api.example.test?token=secret", "", false},
		{"bare query", "palo_alto", "api_https", "https://api.example.test?", "", false},
		{"fragment", "palo_alto", "api_https", "https://api.example.test#secret", "", false},
		{"bare fragment", "palo_alto", "api_https", "https://api.example.test#", "", false},
		{"insecure", "palo_alto", "api_https", "http://api.example.test", "", false},
		{"no host", "palo_alto", "api_https", "https:///path", "", false},
		{"wrong scheme", "ldap_ad", "ldaps", "https://directory.example.test", "", false},
		{"secret", "palo_alto", "api_https", "", "plain-secret-value", false},
		{"secret path", "palo_alto", "api_https", "", "env:../secret", false},
		{"unknown provider", "all_products", "manual_json", "", "", false},
		{"ldap events", "ldap_ad", "manual_json", "", "", false},
		{"wrong provider transport", "trend_vision_one", "syslog_tls", "", "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := connectionInput{Name: "Test configuration", Provider: tc.provider, Transport: tc.transport, Endpoint: tc.endpoint, SecretRef: tc.secret, Status: "configured"}
			if got := validateConnection(&in); got != tc.valid {
				t.Fatalf("valid=%v, want %v", got, tc.valid)
			}
		})
	}
}

func TestNormalizedEventValidation(t *testing.T) {
	now := time.Now()
	for _, tc := range []struct {
		name   string
		change func(*eventInput)
	}{
		{"missing time", func(e *eventInput) { e.OccurredAt = time.Time{} }},
		{"future", func(e *eventInput) { e.OccurredAt = now.Add(time.Hour) }},
		{"severity", func(e *eventInput) { e.Severity = "urgent" }},
		{"category", func(e *eventInput) { e.Category = "personal_messages" }},
		{"source IP", func(e *eventInput) { e.SourceIP = "hostname.example.test" }},
		{"IP range", func(e *eventInput) { e.SourceIP = "192.0.2.0/24" }},
		{"zoned IP", func(e *eventInput) { e.SourceIP = "fe80::1%eth0" }},
		{"entity", func(e *eventInput) { e.EntityID = "not-a-uuid" }},
		{"long title", func(e *eventInput) { e.Title = strings.Repeat("x", 241) }},
		{"zero byte", func(e *eventInput) { e.Summary = "invalid\x00content" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e := sampleEvent("validation")
			tc.change(&e)
			if validateEvent(&e, now) {
				t.Fatal("invalid normalized event accepted")
			}
		})
	}
	e := sampleEvent("validation")
	e.SourceIP = "::ffff:192.0.2.10"
	if !validateEvent(&e, now) || e.SourceIP != "192.0.2.10" {
		t.Fatal("IP normalization failed")
	}
}

func TestIntegrationRoleBoundariesAndVersionedConfiguration(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	if connection.Version != 1 || connection.Status != "configured" || connection.EventCount != 0 || connection.LastReceivedAt != nil {
		t.Fatal("configuration falsely claims ingestion")
	}
	for _, path := range []string{"/api/connections", "/api/events"} {
		expect(t, request(a, "GET", path, nil, nil), 401)
	}
	for _, role := range []string{"analyst", "member", "viewer"} {
		c := addUser(t, a, role)
		readStatus := 403
		if role == "analyst" {
			readStatus = 200
		}
		for _, path := range []string{"/api/connections", "/api/events"} {
			expect(t, request(a, "GET", path, nil, c), readStatus)
		}
		expect(t, request(a, "POST", "/api/connections", manualConnectionInput(), c), 403)
		in := manualConnectionInput()
		in.ExpectedVersion = 1
		expect(t, request(a, "PATCH", "/api/connections/"+connection.ID, in, c), 403)
		expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: connection.ID, Events: []eventInput{sampleEvent("denied")}}, c), 403)
	}
	in := manualConnectionInput()
	in.ExpectedVersion = 1
	in.Status = "paused"
	w := request(a, "PATCH", "/api/connections/"+connection.ID, in, admin)
	expect(t, w, 200)
	if got := decoded[Connection](t, w); got.Version != 2 || got.Status != "paused" {
		t.Fatal("configuration revision not persisted")
	}
	expect(t, request(a, "PATCH", "/api/connections/"+connection.ID, in, admin), 409)
	expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: connection.ID, Events: []eventInput{sampleEvent("paused")}}, admin), 409)
	if count(t, a, `SELECT count(*) FROM security_events`) != 0 {
		t.Fatal("paused import wrote data")
	}
	in.ExpectedVersion = 0
	in.Status = "connected"
	expect(t, request(a, "POST", "/api/connections", in, admin), 400)
	in.Status = "configured"
	in.Transport = "api_https"
	w = request(a, "POST", "/api/connections", in, admin)
	expect(t, w, 201)
	apiConnection := decoded[Connection](t, w)
	expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: apiConnection.ID, Events: []eventInput{sampleEvent("not-live")}}, admin), 409)
}

func TestNormalizedImportDeduplicationAndAtomicConflict(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	person := createPerson(t, a, admin)
	e := sampleEvent("same-event")
	e.EntityID = person.ID
	e.Severity = "high"
	batch := eventImportInput{ConnectionID: connection.ID, Events: []eventInput{e, e}}
	w := request(a, "POST", "/api/events/import", batch, admin)
	expect(t, w, 200)
	result := decoded[map[string]int](t, w)
	if result["accepted"] != 1 || result["duplicates"] != 1 {
		t.Fatalf("unexpected import result: %v", result)
	}
	w = request(a, "POST", "/api/events/import", batch, admin)
	expect(t, w, 200)
	result = decoded[map[string]int](t, w)
	if result["accepted"] != 0 || result["duplicates"] != 2 {
		t.Fatal("replayed batch was not idempotent")
	}
	w = request(a, "GET", "/api/events", nil, admin)
	expect(t, w, 200)
	page := decoded[eventPage](t, w)
	if len(page.Items) != 1 || page.NextCursor != "" {
		t.Fatal("event list mismatch")
	}
	got := page.Items[0]
	if got.EntityID != person.ID || got.IdentityState != "candidate" || got.Provenance != "manual_import" || got.OriginProduct != "PAN-OS" || got.SourceIP != e.SourceIP {
		t.Fatal("identity or source provenance lost")
	}
	if count(t, a, `SELECT count(*) FROM memberships`) != 0 {
		t.Fatal("import automatically classified a person")
	}
	newEvent := sampleEvent("must-rollback")
	conflict := e
	conflict.Title = "Different payload using the same external ID"
	batch.Events = []eventInput{newEvent, conflict}
	expect(t, request(a, "POST", "/api/events/import", batch, admin), 409)
	if count(t, a, `SELECT count(*) FROM security_events`) != 1 || count(t, a, `SELECT event_count FROM source_connections`) != 1 {
		t.Fatal("conflicting replay did not roll back entire batch")
	}
	missingEntity := sampleEvent("missing-entity")
	missingEntity.EntityID = UUID()
	batch.Events = []eventInput{newEvent, missingEntity}
	expect(t, request(a, "POST", "/api/events/import", batch, admin), 400)
	if count(t, a, `SELECT count(*) FROM security_events`) != 1 {
		t.Fatal("missing entity did not roll back prior inserts")
	}
	in := manualConnectionInput()
	in.ExpectedVersion = 1
	in.Provider = "logsign"
	expect(t, request(a, "PATCH", "/api/connections/"+connection.ID, in, admin), 409)
	expect(t, request(a, "DELETE", "/api/entities/"+person.ID, deleteInput{1}, admin), 409)
	w = request(a, "GET", "/api/connections", nil, admin)
	expect(t, w, 200)
	connections := decoded[[]Connection](t, w)
	if len(connections) != 1 || connections[0].EventCount != 1 || connections[0].LastReceivedAt == nil {
		t.Fatal("ingestion receipt count mismatch")
	}
}

func TestEventKeysetPaginationAndFilters(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	first := testConnection(t, a, admin)
	second := testConnection(t, a, admin)
	one, two, three := sampleEvent("one"), sampleEvent("two"), sampleEvent("three")
	two.Severity = "low"
	for _, batch := range []eventImportInput{{ConnectionID: first.ID, Events: []eventInput{one, two}}, {ConnectionID: second.ID, Events: []eventInput{three}}} {
		expect(t, request(a, "POST", "/api/events/import", batch, admin), 200)
	}
	w := request(a, "GET", "/api/events?limit=2", nil, admin)
	expect(t, w, 200)
	page := decoded[eventPage](t, w)
	if len(page.Items) != 2 || page.NextCursor == "" || page.Items[0].ExternalID != "three" || page.Items[1].ExternalID != "two" {
		t.Fatal("first cursor page mismatch")
	}
	expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: first.ID, Events: []eventInput{sampleEvent("new-during-paging")}}, admin), 200)
	w = request(a, "GET", "/api/events?limit=2&cursor="+page.NextCursor, nil, admin)
	expect(t, w, 200)
	page = decoded[eventPage](t, w)
	if len(page.Items) != 1 || page.Items[0].ExternalID != "one" || page.NextCursor != "" {
		t.Fatal("concurrent insert shifted cursor or duplicated results")
	}
	w = request(a, "GET", "/api/events?connectionId="+first.ID+"&severity=low", nil, admin)
	expect(t, w, 200)
	page = decoded[eventPage](t, w)
	if len(page.Items) != 1 || page.Items[0].ExternalID != "two" || page.Items[0].IdentityState != "unlinked" {
		t.Fatal("event filter or unlinked identity mismatch")
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=invalid", "cursor=-1", "cursor=invalid", "severity=unknown", "connectionId=invalid"} {
		expect(t, request(a, "GET", "/api/events?"+query, nil, admin), 400)
	}
}

func TestImportConcurrentDeduplicationAndAuditRollback(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	batch := eventImportInput{ConnectionID: connection.ID, Events: []eventInput{sampleEvent("concurrent")}}
	type outcome struct {
		status int
		body   string
	}
	results := make(chan outcome, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := request(a, "POST", "/api/events/import", batch, admin)
			results <- outcome{status: w.Code, body: w.Body.String()}
		}()
	}
	wg.Wait()
	close(results)
	for result := range results {
		if result.status != 200 {
			t.Fatalf("concurrent import failed: %d %s", result.status, result.body)
		}
	}
	if count(t, a, `SELECT count(*) FROM security_events`) != 1 || count(t, a, `SELECT event_count FROM source_connections`) != 1 {
		t.Fatal("concurrent retries duplicated events")
	}
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_test_offline`)
	batch.Events = []eventInput{sampleEvent("audit-must-rollback")}
	batch.Events[0].Severity = "critical"
	expect(t, request(a, "POST", "/api/events/import", batch, admin), 503)
	if count(t, a, `SELECT count(*) FROM security_events`) != 1 || count(t, a, `SELECT event_count FROM source_connections`) != 1 {
		t.Fatal("audit failure retained import or receipt counter")
	}
	in := manualConnectionInput()
	in.ExpectedVersion = 1
	in.Name = "Must not persist"
	expect(t, request(a, "PATCH", "/api/connections/"+connection.ID, in, admin), 503)
	if count(t, a, `SELECT version FROM source_connections`) != 1 {
		t.Fatal("audit failure retained configuration mutation")
	}
}

func TestImportRejectsRawDataAndInvalidBatches(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	for _, events := range [][]eventInput{{}, make([]eventInput, 101), {sampleEvent("valid"), {ExternalID: "invalid"}}} {
		expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: connection.ID, Events: events}, admin), 400)
	}
	expect(t, request(a, "POST", "/api/events/import", map[string]any{"connectionId": connection.ID, "events": []map[string]any{{"externalId": "raw", "raw": "unbounded body"}}}, admin), 400)
	if count(t, a, `SELECT count(*) FROM security_events`) != 0 || count(t, a, `SELECT event_count FROM source_connections`) != 0 {
		t.Fatal("invalid batch persisted data")
	}
}
