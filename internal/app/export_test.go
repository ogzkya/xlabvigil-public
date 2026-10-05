package app

import (
	"bytes"
	"context"
	"encoding/csv"
	"net/http/httptest"
	"net/url"
	"reflect"
	"regexp"
	"strings"
	"testing"
	"time"
)

var utf8BOM = []byte{0xEF, 0xBB, 0xBF}

var exportPaths = map[string]string{
	"/api/events/export":      "olaylar",
	"/api/cases/export":       "dosyalar",
	"/api/audit/export":       "islem-gunlugu",
	"/api/entities/export":    "varliklar",
	"/api/memberships/export": "uyelikler",
}

// exportCSV checks the transport format of a successful export and returns
// its parsed records, header first.
func exportCSV(t *testing.T, w *httptest.ResponseRecorder, slug string) [][]string {
	t.Helper()
	expect(t, w, 200)
	if got := w.Header().Get("Content-Type"); got != "text/csv; charset=utf-8" {
		t.Fatalf("content type %q", got)
	}
	if got := w.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("cache control %q", got)
	}
	disposition := regexp.MustCompile(`^attachment; filename="vigil-` + regexp.QuoteMeta(slug) + `-\d{8}T\d{6}Z\.csv"$`)
	if got := w.Header().Get("Content-Disposition"); !disposition.MatchString(got) {
		t.Fatalf("content disposition %q", got)
	}
	body := w.Body.Bytes()
	if !bytes.HasPrefix(body, utf8BOM) {
		t.Fatal("CSV body has no UTF-8 byte order mark")
	}
	body = body[len(utf8BOM):]
	if !bytes.HasSuffix(body, []byte("\r\n")) || bytes.Count(body, []byte("\n")) != bytes.Count(body, []byte("\r\n")) {
		t.Fatal("CSV lines are not CRLF terminated")
	}
	reader := csv.NewReader(bytes.NewReader(body))
	reader.Comma = ';'
	records, err := reader.ReadAll()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) == 0 {
		t.Fatal("CSV has no header row")
	}
	return records
}

func exportAuditCount(t *testing.T, a *App, action, kind string) int {
	t.Helper()
	var n int
	if err := a.DB.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE action=$1 AND kind=$2 AND record_id IS NULL`, action, kind).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func column(records [][]string, name string) int {
	for i, header := range records[0] {
		if header == name {
			return i
		}
	}
	return -1
}

func TestExportAccessControl(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	member := addUser(t, a, "member")
	viewer := addUser(t, a, "viewer")
	for path, slug := range exportPaths {
		exportCSV(t, request(a, "GET", path, nil, admin), slug)
		if path == "/api/audit/export" {
			expectCaseError(t, request(a, "GET", path, nil, analyst), 403, "forbidden")
		} else {
			exportCSV(t, request(a, "GET", path, nil, analyst), slug)
		}
		expectCaseError(t, request(a, "GET", path, nil, member), 403, "forbidden")
		expectCaseError(t, request(a, "GET", path, nil, viewer), 403, "forbidden")
		expectCaseError(t, request(a, "GET", path, nil, nil), 401, "unauthorized")
		expectCaseError(t, request(a, "GET", path+"?limit=5", nil, admin), 400, "invalid_input")
		expectCaseError(t, request(a, "GET", path+"?cursor=1", nil, admin), 400, "invalid_input")
		if w := request(a, "HEAD", path, nil, admin); w.Code != 405 || w.Header().Get("Allow") != "GET" {
			t.Fatalf("HEAD %s = %d, want 405 without an audit row", path, w.Code)
		}
	}
	for action, kind := range map[string]string{"events.exported": "security_event", "cases.exported": "case", "entities.exported": "entity", "memberships.exported": "membership"} {
		if got := exportAuditCount(t, a, action, kind); got != 2 {
			t.Fatalf("%s audit rows %d, want 2", action, got)
		}
	}
	if got := exportAuditCount(t, a, "audit.exported", "audit_event"); got != 1 {
		t.Fatalf("audit.exported rows %d, want 1", got)
	}
}

func TestEventExportFormatFiltersAndAudit(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	first := testConnection(t, a, admin)
	secondInput := manualConnectionInput()
	secondInput.Name = "İkinci kaynak"
	w := request(a, "POST", "/api/connections", secondInput, admin)
	expect(t, w, 201)
	second := decoded[Connection](t, w)
	occurred := time.Date(2026, 9, 1, 8, 30, 15, 123456000, time.FixedZone("TRT", 3*60*60))
	insertRawEvent(t, a, first.ID, "formula-equals", occurred, "critical", "=HYPERLINK(\"http://example.test\")", "+cmd")
	insertRawEvent(t, a, first.ID, "formula-at", occurred.Add(time.Minute), "high", "@SUM(A1)", "-2+3")
	insertRawEvent(t, a, first.ID, "formula-control", occurred.Add(2*time.Minute), "low", "\tTabbed title", "\rCarriage")
	insertRawEvent(t, a, second.ID, "plain-quoted", occurred.Add(3*time.Minute), "critical", `Semi;colon "quoted" başlık`, "Çok satırlı\nözet")
	execSQL(t, a, `UPDATE security_events SET subject='TEST\account',device='test-device',source_ip='192.0.2.10',origin_product='PAN-OS',origin_event_id='origin-1' WHERE external_id='plain-quoted'`)

	before := exportAuditCount(t, a, "events.exported", "security_event")
	records := exportCSV(t, request(a, "GET", "/api/events/export", nil, analyst), "olaylar")
	if !reflect.DeepEqual(records[0], eventExportHeader) || len(records[0]) != 16 {
		t.Fatalf("event header %q", records[0])
	}
	if len(records) != 5 {
		t.Fatalf("event rows %d, want 4", len(records)-1)
	}
	// Newest accepted sequence first.
	plain, control, at, equals := records[1], records[2], records[3], records[4]
	if want := []string{"2026-09-01T05:33:15Z", "", "critical", "authentication", `Semi;colon "quoted" başlık`, "Çok satırlı\nözet", `TEST\account`, "test-device", "192.0.2.10", "İkinci kaynak", "plain-quoted", "unlinked", "", "manual_import", "PAN-OS", "origin-1"}; plain[0] != want[0] || !reflect.DeepEqual(plain[2:], want[2:]) {
		t.Fatalf("plain event row %q, want %q", plain, want)
	}
	if _, err := time.Parse(time.RFC3339, plain[1]); err != nil || !strings.HasSuffix(plain[1], "Z") {
		t.Fatalf("receivedAt %q is not RFC3339 UTC", plain[1])
	}
	if equals[4] != `'=HYPERLINK("http://example.test")` || equals[5] != "'+cmd" || equals[9] != first.Name {
		t.Fatalf("equals row not neutralized: %q", equals)
	}
	if at[4] != "'@SUM(A1)" || at[5] != "'-2+3" {
		t.Fatalf("at row not neutralized: %q", at)
	}
	if !strings.HasPrefix(control[4], "'\t") || !strings.HasPrefix(control[5], "'") || strings.HasPrefix(control[5], "\r") {
		t.Fatalf("control row not neutralized: %q", control)
	}
	if got := exportAuditCount(t, a, "events.exported", "security_event"); got != before+1 {
		t.Fatalf("event export audit rows %d, want %d", got, before+1)
	}

	filtered := func(query string) [][]string {
		t.Helper()
		return exportCSV(t, request(a, "GET", "/api/events/export?"+query, nil, admin), "olaylar")[1:]
	}
	if rows := filtered("severity=critical"); len(rows) != 2 || rows[0][10] != "plain-quoted" || rows[1][10] != "formula-equals" {
		t.Fatalf("severity filter rows %q", rows)
	}
	if rows := filtered("connectionId=" + strings.ToUpper(second.ID)); len(rows) != 1 || rows[0][10] != "plain-quoted" {
		t.Fatalf("connection filter rows %q", rows)
	}
	if rows := filtered("q=" + url.QueryEscape("sum(a1")); len(rows) != 1 || rows[0][10] != "formula-at" {
		t.Fatalf("search rows %q", rows)
	}
	if rows := filtered("q=pan-os&severity=critical&connectionId=" + second.ID); len(rows) != 1 {
		t.Fatalf("combined filter rows %q", rows)
	}
	if rows := filtered("q=nothing-matches"); len(rows) != 0 {
		t.Fatalf("empty search rows %q", rows)
	}
	afterFilters := exportAuditCount(t, a, "events.exported", "security_event")
	for _, query := range []string{"severity=urgent", "connectionId=nope", "severity=low&severity=high", "q=ab", "limit=10", "unknown=1"} {
		expectCaseError(t, request(a, "GET", "/api/events/export?"+query, nil, admin), 400, "invalid_input")
	}
	if got := exportAuditCount(t, a, "events.exported", "security_event"); got != afterFilters {
		t.Fatal("rejected export wrote an audit row")
	}
}

func TestCaseExportFiltersAndColumns(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	open := createTestCase(t, a, admin)
	draft := caseDraft()
	draft.Title = "=Kapatılacak dosya"
	draft.Responsible = "@ekip"
	w := request(a, "POST", "/api/cases", draft, analyst)
	expect(t, w, 201)
	closed := decoded[InvestigationCase](t, w)
	expect(t, request(a, "POST", casePath(closed)+"/actions", caseActionInput{Action: "close", Reason: "-İnceleme tamamlandı ve kapatıldı", ExpectedVersion: 1}, analyst), 201)

	records := exportCSV(t, request(a, "GET", "/api/cases/export", nil, analyst), "dosyalar")
	if !reflect.DeepEqual(records[0], caseExportHeader) || len(records) != 3 {
		t.Fatalf("case export %q", records)
	}
	closedRow, openRow := records[1], records[2]
	if closedRow[0] != "'=Kapatılacak dosya" || closedRow[1] != "closed" || closedRow[2] != "'@ekip" || closedRow[5] != "Test analyst" || closedRow[8] != "'-İnceleme tamamlandı ve kapatıldı" || closedRow[9] != "2" {
		t.Fatalf("closed row %q", closedRow)
	}
	if _, err := time.Parse(time.RFC3339, closedRow[7]); err != nil || !strings.HasSuffix(closedRow[7], "Z") {
		t.Fatalf("closedAt %q", closedRow[7])
	}
	if openRow[0] != open.Title || openRow[1] != "open" || openRow[7] != "" || openRow[8] != "" || openRow[9] != "1" || openRow[4] != open.CreatedAt.UTC().Format(time.RFC3339) {
		t.Fatalf("open row %q", openRow)
	}
	if rows := exportCSV(t, request(a, "GET", "/api/cases/export?status=open", nil, admin), "dosyalar")[1:]; len(rows) != 1 || rows[0][1] != "open" {
		t.Fatalf("open filter %q", rows)
	}
	if rows := exportCSV(t, request(a, "GET", "/api/cases/export?status=closed&q=kapat%C4%B1lacak", nil, admin), "dosyalar")[1:]; len(rows) != 1 || rows[0][1] != "closed" {
		t.Fatalf("closed search filter %q", rows)
	}
	if rows := exportCSV(t, request(a, "GET", "/api/cases/export?status=open&q=kapat%C4%B1lacak", nil, admin), "dosyalar")[1:]; len(rows) != 0 {
		t.Fatalf("combined filter %q", rows)
	}
	for _, query := range []string{"status=pending", "status=open&status=closed", "limit=5", "q=x"} {
		expectCaseError(t, request(a, "GET", "/api/cases/export?"+query, nil, admin), 400, "invalid_input")
	}
	if got := exportAuditCount(t, a, "cases.exported", "case"); got != 4 {
		t.Fatalf("case export audit rows %d, want 4", got)
	}
}

func TestAuditExportAdminOnlyAndSearch(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	createPerson(t, a, admin)
	expectCaseError(t, request(a, "GET", "/api/audit/export", nil, analyst), 403, "forbidden")

	records := exportCSV(t, request(a, "GET", "/api/audit/export", nil, admin), "islem-gunlugu")
	if !reflect.DeepEqual(records[0], auditExportHeader) || len(records) != 3 {
		t.Fatalf("audit export %q", records)
	}
	if records[1][1] != "Test Owner" || records[1][2] != "entity.created" || records[1][3] != "entity" || records[2][2] != "workspace.created" {
		t.Fatalf("audit rows %q", records[1:])
	}
	if _, err := time.Parse(time.RFC3339, records[1][0]); err != nil {
		t.Fatalf("audit time %q", records[1][0])
	}
	// The export's own audit row is committed after the read and is visible next time.
	if rows := exportCSV(t, request(a, "GET", "/api/audit/export?q=exported", nil, admin), "islem-gunlugu")[1:]; len(rows) != 1 || rows[0][2] != "audit.exported" || rows[0][3] != "audit_event" {
		t.Fatalf("audit search rows %q", rows)
	}
	if rows := exportCSV(t, request(a, "GET", "/api/audit/export?q=zzzz&labelAction=workspace.created", nil, admin), "islem-gunlugu")[1:]; len(rows) != 1 || rows[0][2] != "workspace.created" {
		t.Fatalf("label action rows %q", rows)
	}
	for _, query := range []string{"labelAction=workspace.created", "q=zzzz&labelAction=Bad", "q=zzzz&labelAction=a.b&labelAction=a.b", "q=one&q=two", "limit=5"} {
		expectCaseError(t, request(a, "GET", "/api/audit/export?"+query, nil, admin), 400, "invalid_input")
	}
	if got := exportAuditCount(t, a, "audit.exported", "audit_event"); got != 3 {
		t.Fatalf("audit export rows %d, want 3", got)
	}
}

func TestEntityAndMembershipExports(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	person := createPerson(t, a, admin)
	w := request(a, "POST", "/api/entities", entityInput{Kind: "account", Name: "Test Account", Department: "IT", Description: "+formula açıklama", Identifier: "=cmd|' /C calc'!A0", PersonID: person.ID}, admin)
	expect(t, w, 201)
	account := decoded[Entity](t, w)
	group := createRiskGroup(t, a, admin, "red")
	input := memberInput(account, group)
	input.Reason = "-Belgelenmiş inceleme gerekçesi"
	expect(t, request(a, "POST", "/api/memberships", input, admin), 201)
	closedInput := memberInput(person, group)
	closedInput.Status = "closed"
	expect(t, request(a, "POST", "/api/memberships", closedInput, admin), 201)

	records := exportCSV(t, request(a, "GET", "/api/entities/export", nil, analyst), "varliklar")
	if !reflect.DeepEqual(records[0], entityExportHeader) || len(records) != 3 {
		t.Fatalf("entity export %q", records)
	}
	var accountRow, personRow []string
	for _, row := range records[1:] {
		switch row[0] {
		case account.Name:
			accountRow = row
		case person.Name:
			personRow = row
		}
	}
	if accountRow == nil || accountRow[1] != "account" || accountRow[2] != "'=cmd|' /C calc'!A0" || accountRow[3] != "IT" || accountRow[4] != "'+formula açıklama" || accountRow[5] != person.Name || accountRow[6] != account.CreatedAt.UTC().Format(time.RFC3339) {
		t.Fatalf("account row %q", accountRow)
	}
	if personRow == nil || personRow[1] != "person" || personRow[5] != "" {
		t.Fatalf("person row %q", personRow)
	}

	records = exportCSV(t, request(a, "GET", "/api/memberships/export", nil, analyst), "uyelikler")
	if !reflect.DeepEqual(records[0], membershipExportHeader) || len(records) != 3 {
		t.Fatalf("membership export %q", records)
	}
	var activeRow, closedRow []string
	for _, row := range records[1:] {
		switch row[0] {
		case account.Name:
			activeRow = row
		case person.Name:
			closedRow = row
		}
	}
	want := []string{account.Name, "account", "'=cmd|' /C calc'!A0", group.Name, "red", "'-Belgelenmiş inceleme gerekçesi", input.Responsible, input.StartsOn, input.EndsOn, input.ReviewOn, "active", "evet"}
	if activeRow == nil || !reflect.DeepEqual(activeRow[:12], want) {
		t.Fatalf("active membership row %q, want %q", activeRow, want)
	}
	if closedRow == nil || closedRow[10] != "closed" || closedRow[11] != "hayır" {
		t.Fatalf("closed membership row %q", closedRow)
	}
	if _, err := time.Parse(time.RFC3339, activeRow[13]); err != nil {
		t.Fatalf("membership updatedAt %q", activeRow[13])
	}
	for _, path := range []string{"/api/entities/export?q=test", "/api/memberships/export?status=active", "/api/memberships/export?"} {
		w := request(a, "GET", path, nil, admin)
		if path == "/api/memberships/export?" {
			exportCSV(t, w, "uyelikler")
			continue
		}
		expectCaseError(t, w, 400, "invalid_input")
	}
	if exportAuditCount(t, a, "entities.exported", "entity") != 1 || exportAuditCount(t, a, "memberships.exported", "membership") != 2 {
		t.Fatal("entity/membership export audit rows missing")
	}
}

func TestExportRowCap(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	connection := testConnection(t, a, admin)
	execSQL(t, a, `INSERT INTO security_events(id,connection_id,external_id,occurred_at,category,severity,title,identity_state,content_hash)
 SELECT gen_random_uuid(),$1,'cap-'||g,now()-g*interval '1 second','network',CASE WHEN g<=10000 THEN 'low' ELSE 'high' END,'Cap test','unlinked',repeat('0',64)
 FROM generate_series(1,10001) g`, connection.ID)

	records := exportCSV(t, request(a, "GET", "/api/events/export?severity=low", nil, admin), "olaylar")
	if len(records) != 10001 {
		t.Fatalf("exactly-at-cap export has %d data rows, want 10000", len(records)-1)
	}
	audits := exportAuditCount(t, a, "events.exported", "security_event")
	w := request(a, "GET", "/api/events/export", nil, admin)
	expectCaseError(t, w, 422, "export_too_large")
	if !strings.Contains(w.Header().Get("Content-Type"), "application/json") || w.Header().Get("Content-Disposition") != "" {
		t.Fatal("over-cap export returned file headers")
	}
	if msg := decoded[struct{ Message string }](t, w).Message; !strings.Contains(msg, "10.000") {
		t.Fatalf("over-cap message %q", msg)
	}
	if exportAuditCount(t, a, "events.exported", "security_event") != audits {
		t.Fatal("over-cap export wrote an audit row")
	}

	previous := exportRowLimit
	exportRowLimit = 2
	t.Cleanup(func() { exportRowLimit = previous })
	createTestCase(t, a, admin)
	createTestCase(t, a, admin)
	if rows := exportCSV(t, request(a, "GET", "/api/cases/export", nil, admin), "dosyalar"); len(rows) != 3 {
		t.Fatalf("case cap rows %d", len(rows)-1)
	}
	createTestCase(t, a, admin)
	expectCaseError(t, request(a, "GET", "/api/cases/export", nil, admin), 422, "export_too_large")
	expectCaseError(t, request(a, "GET", "/api/audit/export", nil, admin), 422, "export_too_large")
	if rows := exportCSV(t, request(a, "GET", "/api/cases/export?status=closed", nil, admin), "dosyalar"); len(rows) != 1 {
		t.Fatal("narrowed export should succeed under the cap")
	}
}

func TestExportAuditFailureSendsNoCSV(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	createPerson(t, a, admin)
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_test_offline`)
	w := request(a, "GET", "/api/entities/export", nil, admin)
	execSQL(t, a, `ALTER TABLE audit_events_test_offline RENAME TO audit_events`)
	expectCaseError(t, w, 503, "unavailable")
	if !strings.HasPrefix(w.Header().Get("Content-Type"), "application/json") || w.Header().Get("Content-Disposition") != "" || bytes.HasPrefix(w.Body.Bytes(), utf8BOM) {
		t.Fatal("failed audit still produced CSV output")
	}
}

func TestCSVCellNeutralization(t *testing.T) {
	for input, want := range map[string]string{
		"=1+1": "'=1+1", "+1": "'+1", "-1": "'-1", "@x": "'@x", "\tx": "'\tx", "\rx": "'\rx",
		"": "", "plain": "plain", " =x": " =x", "'=x": "'=x", "2026-01-01T00:00:00Z": "2026-01-01T00:00:00Z",
	} {
		if got := csvCell(input); got != want {
			t.Fatalf("csvCell(%q)=%q, want %q", input, got, want)
		}
	}
	body, err := encodeCSV([]string{"A", "B"}, [][]string{{"x;y", `"q"`}, {"=a", "satır\nsonu"}})
	if err != nil {
		t.Fatal(err)
	}
	want := string(utf8BOM) + "A;B\r\n\"x;y\";\"\"\"q\"\"\"\r\n'=a;\"satır\r\nsonu\"\r\n"
	if string(body) != want {
		t.Fatalf("encoded CSV %q, want %q", body, want)
	}
}
