package app

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type inboxResult struct {
	Items       []Notification `json:"items"`
	NextCursor  string         `json:"nextCursor"`
	UnreadCount int            `json:"unreadCount"`
}

func notificationFixture(t *testing.T, a *App, cookie *http.Cookie, externalID, severity string) {
	t.Helper()
	w := request(a, "POST", "/api/connections", map[string]any{"name": "Test notification source", "provider": "custom", "transport": "manual_json", "status": "configured"}, cookie)
	expect(t, w, 201)
	connection := decoded[map[string]any](t, w)
	event := map[string]any{"externalId": externalID, "occurredAt": time.Now().UTC().Format(time.RFC3339), "category": "authentication", "severity": severity, "title": "Synthetic authentication event", "summary": "Local test fixture only", "subject": "TEST\\fixture"}
	w = request(a, "POST", "/api/events/import", map[string]any{"connectionId": connection["id"], "events": []any{event}}, cookie)
	expect(t, w, 200)
	w = request(a, "POST", "/api/events/import", map[string]any{"connectionId": connection["id"], "events": []any{event}}, cookie)
	expect(t, w, 200)
	if count(t, a, `SELECT count(*) FROM notifications n JOIN security_events e ON e.id=n.event_id WHERE e.external_id='`+externalID+`'`) > 1 {
		t.Fatal("replay duplicated a notification")
	}
}

func TestNotificationsPersonalReceiptsAndPagination(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	viewer := addUser(t, a, "viewer")
	notificationFixture(t, a, admin, "notice-high", "high")
	notificationFixture(t, a, admin, "notice-critical", "critical")
	notificationFixture(t, a, admin, "notice-info", "info")
	w := request(a, "GET", "/api/notifications?limit=1", nil, admin)
	expect(t, w, 200)
	first := decoded[inboxResult](t, w)
	if len(first.Items) != 1 || first.NextCursor == "" || first.UnreadCount != 2 || first.Items[0].ReadAt != nil {
		t.Fatal("unexpected initial inbox or pagination")
	}
	w = request(a, "GET", "/api/notifications?limit=1&cursor="+first.NextCursor, nil, admin)
	expect(t, w, 200)
	second := decoded[inboxResult](t, w)
	if len(second.Items) != 1 || second.NextCursor != "" || second.Items[0].ID == first.Items[0].ID {
		t.Fatal("notification keyset pagination repeated or omitted item")
	}
	id := first.Items[0].ID
	w = request(a, "POST", "/api/notifications/"+id+"/read", map[string]any{}, admin)
	expect(t, w, 200)
	receipt := decoded[map[string]any](t, w)
	w = request(a, "POST", "/api/notifications/"+id+"/read", map[string]any{}, admin)
	expect(t, w, 200)
	if decoded[map[string]any](t, w)["readAt"] != receipt["readAt"] {
		t.Fatal("repeated read changed initial read time")
	}
	if decoded[inboxResult](t, request(a, "GET", "/api/notifications", nil, admin)).UnreadCount != 1 || decoded[inboxResult](t, request(a, "GET", "/api/notifications", nil, analyst)).UnreadCount != 2 {
		t.Fatal("read receipts leaked between users")
	}
	expect(t, request(a, "GET", "/api/notifications", nil, viewer), 403)
	expect(t, request(a, "POST", "/api/notifications/"+id+"/read", map[string]any{}, viewer), 403)
	expect(t, request(a, "GET", "/api/notification-settings", nil, viewer), 403)
	expect(t, request(a, "GET", "/api/notifications?cursor=-1", nil, admin), 400)
	expect(t, request(a, "GET", "/api/notifications?limit=101", nil, admin), 400)
	expect(t, request(a, "POST", "/api/notifications/"+UUID()+"/read", map[string]any{}, admin), 404)
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_offline`)
	expect(t, request(a, "POST", "/api/notifications/"+second.Items[0].ID+"/read", map[string]any{}, admin), 503)
	if decoded[inboxResult](t, request(a, "GET", "/api/notifications", nil, admin)).UnreadCount != 1 {
		t.Fatal("receipt must rollback on audit failure")
	}
}

func TestNotificationSettingsAccessValidationAndConcurrency(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	w := request(a, "GET", "/api/notification-settings", nil, admin)
	expect(t, w, 200)
	initial := decoded[NotificationSettings](t, w)
	if initial.Provider != "none" || initial.Status != "delivery_disabled" || initial.Version != 1 {
		t.Fatal("notification transport must default disabled")
	}
	input := notificationSettingsInput{Provider: "smtp", Host: "smtp.example.invalid", Port: 587, FromAddress: "vigil@example.invalid", Recipient: "soc@example.invalid", SecretRef: "env:VIGIL_SMTP_SECRET", ExpectedVersion: 1}
	expect(t, request(a, "PUT", "/api/notification-settings", input, analyst), 403)
	w = request(a, "PUT", "/api/notification-settings", input, admin)
	expect(t, w, 200)
	saved := decoded[NotificationSettings](t, w)
	if saved.Version != 2 || saved.Status != "delivery_disabled" || saved.Host != input.Host {
		t.Fatal("saved config must not claim delivery enabled")
	}
	expect(t, request(a, "PUT", "/api/notification-settings", input, admin), 409)
	input.ExpectedVersion = 2
	invalidInputs := []notificationSettingsInput{input, input, input, input, input}
	invalidInputs[0].Port = 25
	invalidInputs[1].SecretRef = "actual-password"
	invalidInputs[2].Recipient = "soc@example.invalid\r\nBcc: other@example.invalid"
	invalidInputs[3].Host = "https://user:secret@example.invalid"
	invalidInputs[4].Provider = "graph"
	for _, invalid := range invalidInputs {
		expect(t, request(a, "PUT", "/api/notification-settings", invalid, admin), 400)
	}
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_offline`)
	input.Host = "updated.example.invalid"
	expect(t, request(a, "PUT", "/api/notification-settings", input, admin), 503)
	saved = decoded[NotificationSettings](t, request(a, "GET", "/api/notification-settings", nil, admin))
	if saved.Version != 2 || saved.Host == input.Host {
		t.Fatal("notification config must rollback on audit failure")
	}
}

func TestMigrationUpgradePreservesExistingVigilData(t *testing.T) {
	a := testApp(t)
	ctx := context.Background()
	// Reconstruct a real v1 schema in an additional isolated namespace.
	name := "test_vigil_upgrade_" + UUID()[:8]
	quoted := pgx.Identifier{name}.Sanitize()
	execSQL(t, a, "CREATE SCHEMA "+quoted)
	t.Cleanup(func() { _, _ = a.DB.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE") })
	config := a.DB.Config().Copy()
	config.ConnConfig.RuntimeParams["search_path"] = name
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	old := New(pool, a.Origin, a.WebRoot)
	execSQL(t, old, schema)
	execSQL(t, old, `CREATE TABLE schema_migrations(version integer PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`)
	execSQL(t, old, `INSERT INTO schema_migrations(version,checksum) VALUES(1,$1)`, tokenHash(schema))
	execSQL(t, old, `INSERT INTO entities(id,kind,name) VALUES($1,'person','Existing migration fixture')`, UUID())
	if err := old.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if count(t, old, `SELECT count(*) FROM entities`) != 1 || count(t, old, `SELECT count(*) FROM schema_migrations`) != len(migrations) {
		t.Fatal("migration upgrade lost existing records")
	}
	if err := old.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
}
