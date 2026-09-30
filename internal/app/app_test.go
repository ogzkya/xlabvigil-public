package app

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func testApp(t *testing.T) *App {
	t.Helper()
	dsn := os.Getenv("VIGIL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("VIGIL_TEST_DATABASE_URL required for isolated PostgreSQL tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal("test database unavailable")
	}
	schemaName := "test_vigil_" + strings.ReplaceAll(UUID(), "-", "")
	quoted := pgx.Identifier{schemaName}.Sanitize()
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal("test schema unavailable")
	}
	t.Cleanup(func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+quoted+" CASCADE"); admin.Close() })
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("test configuration unavailable")
	}
	config.ConnConfig.RuntimeParams["search_path"] = schemaName
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("test connection unavailable")
	}
	t.Cleanup(db.Close)
	a := New(db, "http://127.0.0.1:8321", t.TempDir())
	if err = a.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return a
}
func request(a *App, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	raw, _ := json.Marshal(body)
	r := httptest.NewRequest(method, a.Origin+path, bytes.NewReader(raw))
	r.Header.Set("Origin", a.Origin)
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	return w
}
func expect(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d, want %d: %s", w.Code, status, w.Body.String())
	}
}
func decoded[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out
}
func bootstrap(t *testing.T, a *App) *http.Cookie {
	t.Helper()
	w := request(a, "POST", "/api/setup", credentials{Username: "owner", Password: "test-only-passphrase-2026", Name: "Test Owner"}, nil)
	expect(t, w, 201)
	c := w.Result().Cookies()
	if len(c) != 1 {
		t.Fatal("cookie missing")
	}
	return c[0]
}
func addUser(t *testing.T, a *App, role string) *http.Cookie {
	t.Helper()
	ctx := context.Background()
	id := UUID()
	if _, err := a.DB.Exec(ctx, `INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5)`, id, id, "Test "+role, hashPassword("test-only-password"), role); err != nil {
		t.Fatal(err)
	}
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	token, err := createSession(ctx, tx, id)
	if err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: "vigil_session", Value: token}
}
func createPerson(t *testing.T, a *App, c *http.Cookie) Entity {
	t.Helper()
	w := request(a, "POST", "/api/entities", entityInput{Kind: "person", Name: "Test Person", Department: "Test IT"}, c)
	expect(t, w, 201)
	return decoded[Entity](t, w)
}
func createRiskGroup(t *testing.T, a *App, c *http.Cookie, color string) Group {
	t.Helper()
	w := request(a, "POST", "/api/groups", groupInput{Name: "Test " + color, Color: color, Description: "Manual review only"}, c)
	expect(t, w, 201)
	return decoded[Group](t, w)
}
func memberInput(e Entity, g Group) membershipInput {
	now := time.Now().UTC()
	return membershipInput{EntityID: e.ID, GroupID: g.ID, Reason: "Documented test review reason", Responsible: "Test Reviewer", StartsOn: now.Format(time.DateOnly), EndsOn: now.AddDate(0, 0, 30).Format(time.DateOnly), ReviewOn: now.AddDate(0, 0, 10).Format(time.DateOnly), Status: "active"}
}
func execSQL(t *testing.T, a *App, sql string, args ...any) {
	t.Helper()
	if _, err := a.DB.Exec(context.Background(), sql, args...); err != nil {
		t.Fatal(err)
	}
}
func count(t *testing.T, a *App, sql string) int {
	t.Helper()
	var n int
	if err := a.DB.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMigrationIsolationAndIntegrity(t *testing.T) {
	a := testApp(t)
	ctx := context.Background()
	if err := a.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if count(t, a, `SELECT count(*) FROM schema_migrations`) != len(migrations) || count(t, a, `SELECT count(*) FROM users`) != 0 {
		t.Fatal("migration is not idempotent or seeded users")
	}
	execSQL(t, a, `CREATE TABLE records(id uuid)`)
	if err := a.Migrate(ctx); err == nil {
		t.Fatal("foreign product schema accepted")
	}
	execSQL(t, a, `DROP TABLE records`)
	execSQL(t, a, `UPDATE schema_migrations SET checksum='changed'`)
	if err := a.Migrate(ctx); err == nil {
		t.Fatal("changed migration accepted")
	}
	for index, migration := range migrations {
		execSQL(t, a, `UPDATE schema_migrations SET checksum=$1 WHERE version=$2`, tokenHash(migration), index+1)
	}
	execSQL(t, a, `DELETE FROM vigil_product`)
	if err := a.Migrate(ctx); err == nil {
		t.Fatal("missing product marker accepted")
	}
}

func TestSessionIsolationAndRoleBoundaries(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	if c.Name != "vigil_session" || !c.HttpOnly || c.SameSite != http.SameSiteStrictMode || c.MaxAge != 28800 {
		t.Fatal("session contract failed")
	}
	expect(t, request(a, "GET", "/api/session", nil, &http.Cookie{Name: "nexus_session", Value: c.Value}), 401)
	expect(t, request(a, "GET", "/api/entities", nil, nil), 401)
	expect(t, request(a, "GET", "/api/records/note", nil, c), 404)
	expect(t, request(a, "POST", "/api/setup", credentials{Username: "second", Name: "Second", Password: "test-only-passphrase-2026"}, nil), 409)
	for _, role := range []string{"member", "viewer"} {
		u := addUser(t, a, role)
		for _, path := range []string{"/api/entities", "/api/groups", "/api/memberships", "/api/sources", "/api/audit"} {
			expect(t, request(a, "GET", path, nil, u), 403)
		}
		expect(t, request(a, "POST", "/api/entities", entityInput{Kind: "person", Name: "Denied"}, u), 403)
	}
	analyst := addUser(t, a, "analyst")
	for _, path := range []string{"/api/entities", "/api/groups", "/api/memberships", "/api/sources"} {
		expect(t, request(a, "GET", path, nil, analyst), 200)
	}
	expect(t, request(a, "GET", "/api/audit", nil, analyst), 403)
	expect(t, request(a, "POST", "/api/entities", map[string]any{"kind": "person", "name": "Injected", "identityState": "verified"}, c), 400)
	r := httptest.NewRequest("POST", a.Origin+"/api/groups", strings.NewReader(`{"name":"Denied","color":"red"}`))
	r.Header.Set("Origin", "http://127.0.0.1:8318")
	r.Header.Set("Content-Type", "application/json")
	r.AddCookie(c)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	expect(t, w, 403)
	r = httptest.NewRequest("GET", "http://attacker.invalid/api/session", nil)
	r.AddCookie(c)
	w = httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	expect(t, w, 403)
	execSQL(t, a, `UPDATE sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1`, tokenHash(c.Value))
	expect(t, request(a, "GET", "/api/session", nil, c), 401)
}

func TestEntityRelationshipsAndVersionedWrites(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	p := createPerson(t, a, c)
	in := entityInput{Kind: "account", Name: "Test account", Identifier: "LAB\\candidate", PersonID: p.ID}
	w := request(a, "POST", "/api/entities", in, c)
	expect(t, w, 201)
	account := decoded[Entity](t, w)
	if account.IdentityState != "candidate" || account.PersonID != p.ID {
		t.Fatal("unverified relationship contract failed")
	}
	expect(t, request(a, "DELETE", "/api/entities/"+p.ID, deleteInput{1}, c), 409)
	expect(t, request(a, "PATCH", "/api/entities/"+p.ID, entityInput{Kind: "service", Name: p.Name, ExpectedVersion: 1}, c), 409)
	in.PersonID = account.ID
	expect(t, request(a, "POST", "/api/entities", in, c), 400)
	in.PersonID = p.ID
	in.ExpectedVersion = 1
	in.Name = "Updated account"
	w = request(a, "PATCH", "/api/entities/"+account.ID, in, c)
	expect(t, w, 200)
	if decoded[Entity](t, w).Version != 2 {
		t.Fatal("version not incremented")
	}
	expect(t, request(a, "PATCH", "/api/entities/"+account.ID, in, c), 409)
	expect(t, request(a, "DELETE", "/api/entities/"+account.ID, deleteInput{1}, c), 409)
	expect(t, request(a, "DELETE", "/api/entities/"+account.ID, deleteInput{2}, c), 200)
	expect(t, request(a, "DELETE", "/api/entities/"+p.ID, deleteInput{1}, c), 200)
}

func TestMembershipHistoryAndRetainedEvidence(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	p := createPerson(t, a, c)
	red := createRiskGroup(t, a, c, "red")
	yellow := createRiskGroup(t, a, c, "yellow")
	in := memberInput(p, red)
	w := request(a, "POST", "/api/memberships", in, c)
	expect(t, w, 201)
	m := decoded[Membership](t, w)
	if !m.Active || m.Version != 1 {
		t.Fatal("membership state wrong")
	}
	expect(t, request(a, "POST", "/api/memberships", in, c), 409)
	expect(t, request(a, "POST", "/api/memberships", memberInput(p, yellow), c), 201)
	expect(t, request(a, "DELETE", "/api/groups/"+red.ID, deleteInput{1}, c), 409)
	expect(t, request(a, "DELETE", "/api/entities/"+p.ID, deleteInput{1}, c), 409)
	in.ExpectedVersion = 1
	in.Status = "closed"
	in.Reason = "Review completed and explicitly closed"
	w = request(a, "PATCH", "/api/memberships/"+m.ID, in, c)
	expect(t, w, 200)
	closed := decoded[Membership](t, w)
	if closed.Active || closed.Version != 2 {
		t.Fatal("closed membership state wrong")
	}
	history := decoded[[]struct {
		Version int
		Data    Membership
		Actor   string
	}](t, request(a, "GET", "/api/memberships/"+m.ID+"/history", nil, c))
	if len(history) != 2 || history[0].Version != 2 || history[1].Data.Reason != m.Reason || history[0].Actor != "Test Owner" {
		t.Fatal("history does not preserve snapshots")
	}
	in.GroupID = yellow.ID
	in.ExpectedVersion = 2
	expect(t, request(a, "PATCH", "/api/memberships/"+m.ID, in, c), 400)
	expect(t, request(a, "DELETE", "/api/memberships/"+m.ID, deleteInput{2}, c), 404)
	expect(t, request(a, "DELETE", "/api/groups/"+red.ID, deleteInput{1}, c), 409)
	expect(t, request(a, "POST", "/api/memberships", memberInput(p, red), c), 201)
}

func TestConcurrentWritesAndAtomicHistoryAudit(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	p := createPerson(t, a, c)
	g := createRiskGroup(t, a, c, "orange")
	in := memberInput(p, g)
	w := request(a, "POST", "/api/memberships", in, c)
	expect(t, w, 201)
	m := decoded[Membership](t, w)
	in.ExpectedVersion = 1
	in.Reason = "Concurrent revision under review"
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() { defer wg.Done(); codes <- request(a, "PATCH", "/api/memberships/"+m.ID, in, c).Code }()
	}
	wg.Wait()
	close(codes)
	counts := map[int]int{}
	for code := range codes {
		counts[code]++
	}
	if counts[200] != 1 || counts[409] != 1 {
		t.Fatalf("concurrent update results %v", counts)
	}
	if count(t, a, `SELECT count(*) FROM membership_history`) != 2 {
		t.Fatal("duplicate or missing history")
	}
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_test_offline`)
	in.ExpectedVersion = 2
	in.Reason = "Must rollback together with audit"
	expect(t, request(a, "PATCH", "/api/memberships/"+m.ID, in, c), 503)
	if count(t, a, `SELECT version FROM memberships`) != 2 || count(t, a, `SELECT count(*) FROM membership_history`) != 2 {
		t.Fatal("audit failure did not rollback write and history")
	}
	execSQL(t, a, `ALTER TABLE audit_events_test_offline RENAME TO audit_events`)
	execSQL(t, a, `ALTER TABLE membership_history RENAME TO membership_history_test_offline`)
	expect(t, request(a, "PATCH", "/api/memberships/"+m.ID, in, c), 503)
	if count(t, a, `SELECT version FROM memberships`) != 2 {
		t.Fatal("history failure did not rollback write")
	}
	execSQL(t, a, `ALTER TABLE membership_history_test_offline RENAME TO membership_history`)
}

func TestConcurrentRelationshipCreationAndParentChanges(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	p := createPerson(t, a, c)
	start := make(chan struct{})
	codes := make(chan int, 2)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		codes <- request(a, "POST", "/api/entities", entityInput{Kind: "account", Name: "Concurrent account", PersonID: p.ID}, c).Code
	}()
	go func() {
		defer wg.Done()
		<-start
		codes <- request(a, "PATCH", "/api/entities/"+p.ID, entityInput{Kind: "service", Name: p.Name, ExpectedVersion: 1}, c).Code
	}()
	close(start)
	wg.Wait()
	close(codes)
	for code := range codes {
		if code != 200 && code != 201 && code != 400 && code != 409 {
			t.Fatalf("unexpected concurrency status %d", code)
		}
	}
	if count(t, a, `SELECT count(*) FROM entities c JOIN entities p ON p.id=c.person_id WHERE p.kind<>'person'`) != 0 {
		t.Fatal("concurrent kind edit invalidated person relationship")
	}
	p = createPerson(t, a, c)
	g := createRiskGroup(t, a, c, "red")
	start = make(chan struct{})
	codes = make(chan int, 2)
	wg.Add(2)
	go func() {
		defer wg.Done()
		<-start
		codes <- request(a, "POST", "/api/memberships", memberInput(p, g), c).Code
	}()
	go func() {
		defer wg.Done()
		<-start
		codes <- request(a, "DELETE", "/api/groups/"+g.ID, deleteInput{1}, c).Code
	}()
	close(start)
	wg.Wait()
	close(codes)
	results := map[int]int{}
	for code := range codes {
		results[code]++
	}
	if !((results[201] == 1 && results[409] == 1) || (results[200] == 1 && results[404] == 1)) {
		t.Fatalf("delete/create race %v", results)
	}
}

func TestCollectionOverflowAndDatabaseFailures(t *testing.T) {
	a := testApp(t)
	c := bootstrap(t, a)
	for _, path := range []string{"/api/entities", "/api/groups", "/api/memberships"} {
		w := request(a, "GET", path, nil, c)
		expect(t, w, 200)
		if strings.TrimSpace(w.Body.String()) != "[]" {
			t.Fatal("empty list must be array")
		}
	}
	execSQL(t, a, `INSERT INTO entities(id,kind,name) SELECT gen_random_uuid(),'person','Test '||g FROM generate_series(1,1001) g`)
	w := request(a, "GET", "/api/entities", nil, c)
	expect(t, w, 422)
	if !strings.Contains(w.Body.String(), "collection_limit") {
		t.Fatal("overflow hidden")
	}
	execSQL(t, a, `ALTER TABLE entities RENAME TO entities_test_offline`)
	expect(t, request(a, "GET", "/api/entities", nil, c), 503)
	execSQL(t, a, `ALTER TABLE entities_test_offline RENAME TO entities`)
	sources := decoded[[]struct{ Status string }](t, request(a, "GET", "/api/sources", nil, c))
	if len(sources) != 7 {
		t.Fatal("source catalog missing")
	}
	for _, s := range sources {
		if s.Status != "not_configured" {
			t.Fatal("fabricated connectivity")
		}
	}
}

func TestMembershipDatesAndPasswordValidation(t *testing.T) {
	now := time.Date(2026, 9, 22, 23, 30, 0, 0, time.UTC)
	in := membershipInput{EntityID: UUID(), GroupID: UUID(), Reason: "Gerekçeli inceleme", Responsible: "İnceleyen", StartsOn: "2026-09-22", ReviewOn: "2026-09-22", EndsOn: "2026-09-22", Status: "active"}
	if !validateMembership(&in, now) {
		t.Fatal("inclusive date rejected")
	}
	m := Membership{Status: in.Status, StartsOn: in.StartsOn, EndsOn: in.EndsOn}
	if !membershipActive(m, now) || membershipActive(m, now.Add(24*time.Hour)) {
		t.Fatal("date boundary incorrect")
	}
	for _, modify := range []func(*membershipInput){func(v *membershipInput) { v.Reason = "Short" }, func(v *membershipInput) { v.EndsOn = "2026-09-21" }, func(v *membershipInput) { v.ReviewOn = "2026-09-23" }, func(v *membershipInput) { v.EndsOn = "2028-09-22" }, func(v *membershipInput) { v.StartsOn = "2026-02-30" }, func(v *membershipInput) { v.Responsible = "" }} {
		bad := in
		modify(&bad)
		if validateMembership(&bad, now) {
			t.Fatal("invalid membership accepted")
		}
	}
	hash := hashPassword("Long test passphrase")
	if !checkPassword("Long test passphrase", hash) || checkPassword("wrong", hash) || checkPassword("anything", "argon2id$bad$bad") {
		t.Fatal("password verification failed")
	}
}
