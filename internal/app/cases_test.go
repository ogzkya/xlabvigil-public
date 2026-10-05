package app

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"testing"
)

func caseDraft() createCaseInput {
	return createCaseInput{ID: UUID(), caseFields: caseFields{Title: "Yerel inceleme dosyası", Summary: "İnsan tarafından yürütülen örnek inceleme özeti", Responsible: "İnceleme ekibi"}}
}

func createTestCase(t *testing.T, a *App, cookie *http.Cookie) InvestigationCase {
	t.Helper()
	w := request(a, http.MethodPost, "/api/cases", caseDraft(), cookie)
	expect(t, w, http.StatusCreated)
	return decoded[InvestigationCase](t, w)
}

func casePath(item InvestigationCase) string { return "/api/cases/" + item.ID }

func expectCaseError(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	expect(t, response, status)
	if decoded[struct{ Code string }](t, response).Code != code {
		t.Fatalf("case error code, want %s: %s", code, response.Body.String())
	}
}

func assertCaseVersion(t *testing.T, a *App, id string, version int) {
	t.Helper()
	var current, history, audit int
	err := a.DB.QueryRow(context.Background(), `SELECT version,
 (SELECT count(*) FROM case_history WHERE case_id=$1),
 (SELECT count(*) FROM audit_events WHERE record_id=$1 AND kind='case')
 FROM investigation_cases WHERE id=$1`, id).Scan(&current, &history, &audit)
	if err != nil || current != version || history != version || audit != version {
		t.Fatalf("case version/history/audit=%d/%d/%d, want %d: %v", current, history, audit, version, err)
	}
}

func TestCaseLifecycleReplayAndRecordedSnapshots(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	analyst := addUser(t, a, "analyst")
	draft := caseDraft()
	draft.ID = strings.ToUpper(draft.ID)
	draft.Title = "  " + draft.Title + "  "
	w := request(a, http.MethodPost, "/api/cases", draft, admin)
	expect(t, w, 201)
	created := decoded[InvestigationCase](t, w)
	if created.ID != strings.ToLower(draft.ID) || created.Title != strings.TrimSpace(draft.Title) || created.Version != 1 || created.Status != "open" || created.ClosedAt != nil || created.ClosureReason != "" || created.CreatedBy != "Test Owner" || created.CreatedByID == "" {
		t.Fatalf("invalid created case: %+v", created)
	}
	w = request(a, http.MethodPost, "/api/cases", draft, admin)
	expect(t, w, 200)
	if !reflect.DeepEqual(decoded[InvestigationCase](t, w), created) {
		t.Fatal("creation retry changed authoritative case")
	}
	assertCaseVersion(t, a, created.ID, 1)
	changed := caseFields{Title: "Sonradan güncellenen başlık", Summary: "Daha sonraki ayrı düzenleme açıklaması", Responsible: "Yeni ekip etiketi"}
	w = request(a, http.MethodPatch, casePath(created), updateCaseInput{caseFields: changed, ExpectedVersion: 1}, analyst)
	expect(t, w, 200)
	updated := decoded[InvestigationCase](t, w)
	if updated.Version != 2 || updated.CreatedBy != created.CreatedBy || updated.CreatedByID != created.CreatedByID {
		t.Fatal("update rewrote creation identity")
	}
	w = request(a, http.MethodPost, casePath(created)+"/actions", caseActionInput{Action: "note", Reason: "Ayrı gerekçeli inceleme notu", ExpectedVersion: 2}, analyst)
	expect(t, w, 201)
	noted := decoded[caseActionResult](t, w)
	if noted.Case.Version != 3 || noted.Activity.Action != "noted" || noted.Activity.Before.Version != 2 || noted.Activity.After.Version != 3 || noted.Case.Title != changed.Title {
		t.Fatal("note is not a versioned checkpoint")
	}
	closure := "İnceleme tamamlandı; manuel gerekçeli kapanış"
	w = request(a, http.MethodPost, casePath(created)+"/actions", caseActionInput{Action: "close", Reason: closure, ExpectedVersion: 3}, admin)
	expect(t, w, 201)
	closed := decoded[caseActionResult](t, w)
	if closed.Case.Version != 4 || closed.Case.Status != "closed" || closed.Case.ClosedAt == nil || closed.Case.ClosureReason != closure || !closed.Case.ClosedAt.Equal(closed.Activity.OccurredAt) {
		t.Fatal("closure context was not captured")
	}
	// A lost creation response must replay against immutable original fields,
	// and return current version/status rather than an obsolete version one.
	w = request(a, http.MethodPost, "/api/cases", draft, admin)
	expect(t, w, 200)
	if !reflect.DeepEqual(decoded[InvestigationCase](t, w), closed.Case) {
		t.Fatal("late creation retry returned stale initial case")
	}
	assertCaseVersion(t, a, created.ID, 4)
	different := draft
	different.Summary = "Farklı içerikle aynı taslak UUID tekrar kullanıldı"
	expectCaseError(t, request(a, "POST", "/api/cases", different, admin), 409, "case_id_conflict")
	expectCaseError(t, request(a, "POST", "/api/cases", draft, analyst), 409, "case_id_conflict")
	expectCaseError(t, request(a, "PATCH", casePath(created), updateCaseInput{caseFields: changed, ExpectedVersion: 4}, admin), 409, "case_closed")
	for _, action := range []string{"note", "close"} {
		expectCaseError(t, request(a, "POST", casePath(created)+"/actions", caseActionInput{Action: action, Reason: closure, ExpectedVersion: 4}, admin), 409, "case_closed")
	}
	expectCaseError(t, request(a, "POST", casePath(created)+"/actions", caseActionInput{Action: "reopen", Reason: "Yeni bilgiyle gerekçeli yeniden açma", ExpectedVersion: 3}, admin), 409, "case_conflict")
	w = request(a, "POST", casePath(created)+"/actions", caseActionInput{Action: "reopen", Reason: "Yeni bilgiyle gerekçeli yeniden açma", ExpectedVersion: 4}, analyst)
	expect(t, w, 201)
	reopened := decoded[caseActionResult](t, w)
	if reopened.Case.Version != 5 || reopened.Case.Status != "open" || reopened.Case.ClosedAt != nil || reopened.Case.ClosureReason != "" || reopened.Activity.Before.ClosureReason != closure {
		t.Fatal("reopen lost prior closure history")
	}
	expectCaseError(t, request(a, "POST", casePath(created)+"/actions", caseActionInput{Action: "reopen", Reason: "Açık dosyayı tekrar açma gerekçesi", ExpectedVersion: 5}, admin), 409, "case_open")
	execSQL(t, a, `UPDATE users SET name='New Current Profile'`)
	w = request(a, "GET", casePath(created)+"/activity", nil, admin)
	expect(t, w, 200)
	activity := decoded[caseActivityPage](t, w)
	if len(activity.Items) != 5 || activity.NextCursor != "" || activity.Items[4].Before != nil || activity.Items[4].After.Version != 1 || activity.Items[4].Actor != "Test Owner" || activity.Items[0].Before.Status != "closed" || activity.Items[0].After.Status != "open" {
		t.Fatalf("incomplete saved activity: %+v", activity)
	}
	for index, item := range activity.Items {
		if item.Version != 5-index || item.After.Version != item.Version || item.CaseID != created.ID || !uuidPattern.MatchString(item.ID) || item.Actor == "New Current Profile" {
			t.Fatal("history version or recorded actor changed")
		}
	}
	w = request(a, "GET", casePath(created), nil, admin)
	expect(t, w, 200)
	if decoded[InvestigationCase](t, w).CreatedBy != "Test Owner" {
		t.Fatal("creation actor was resolved from current profile")
	}
	assertCaseVersion(t, a, created.ID, 5)
	expect(t, request(a, "DELETE", casePath(created), map[string]any{}, admin), 404)
	if count(t, a, `SELECT count(*) FROM entities`)+count(t, a, `SELECT count(*) FROM memberships`) != 0 {
		t.Fatal("case lifecycle manufactured other product records")
	}
}

func TestCaseRolesInputValidationAndSearchPagination(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	expect(t, request(a, "GET", "/api/cases", nil, nil), 401)
	initial := decoded[casePage](t, request(a, "GET", "/api/cases", nil, admin))
	if initial.Items == nil || len(initial.Items) != 0 {
		t.Fatal("empty cases are not an explicit empty page")
	}
	item := createTestCase(t, a, admin)
	for _, role := range []string{"member", "viewer"} {
		cookie := addUser(t, a, role)
		for _, path := range []string{"/api/cases", casePath(item), casePath(item) + "/activity", casePath(item) + "/event-evidence"} {
			expect(t, request(a, "GET", path, nil, cookie), 403)
		}
		for _, call := range []struct{ method, path string }{{"POST", "/api/cases"}, {"PATCH", casePath(item)}, {"POST", casePath(item) + "/actions"}, {"POST", casePath(item) + "/event-evidence"}, {"POST", casePath(item) + "/event-evidence/" + UUID() + "/retract"}} {
			expect(t, request(a, call.method, call.path, map[string]any{}, cookie), 403)
		}
	}
	analyst := addUser(t, a, "analyst")
	createTestCase(t, a, analyst)
	for _, change := range []func(*createCaseInput){
		func(in *createCaseInput) { in.ID = "" }, func(in *createCaseInput) { in.ID = "invalid" },
		func(in *createCaseInput) { in.Title = "İş" }, func(in *createCaseInput) { in.Title = strings.Repeat("İ", 161) },
		func(in *createCaseInput) { in.Title = "valid\x00title" }, func(in *createCaseInput) { in.Summary = "short" },
		func(in *createCaseInput) { in.Summary = strings.Repeat("İ", 2001) }, func(in *createCaseInput) { in.Responsible = "A" },
		func(in *createCaseInput) { in.Responsible = strings.Repeat("İ", 101) },
	} {
		in := caseDraft()
		change(&in)
		expect(t, request(a, "POST", "/api/cases", in, admin), 400)
	}
	expect(t, request(a, "POST", "/api/cases", map[string]any{"id": UUID(), "title": "Valid title", "summary": "Valid descriptive summary", "responsible": "Team", "status": "closed"}, admin), 400)
	expect(t, request(a, "PATCH", casePath(item), updateCaseInput{caseFields: caseDraft().caseFields}, admin), 400)
	for _, in := range []caseActionInput{{Action: "delete", Reason: "Valid review rationale", ExpectedVersion: 1}, {Action: "note", Reason: "short", ExpectedVersion: 1}, {Action: "note", Reason: "Valid review rationale"}} {
		expect(t, request(a, "POST", casePath(item)+"/actions", in, admin), 400)
	}
	wide := caseDraft()
	wide.Title = strings.Repeat("İ", 160)
	wide.Summary = strings.Repeat("İ", 2000)
	wide.Responsible = strings.Repeat("İ", 100)
	expect(t, request(a, "POST", "/api/cases", wide, admin), 201)
	for index := 0; index < 22; index++ {
		in := caseDraft()
		in.Title = fmt.Sprintf("Sequence case %02d", index)
		expect(t, request(a, "POST", "/api/cases", in, admin), 201)
	}
	literal := caseDraft()
	literal.Title = `Literal%_\marker`
	expect(t, request(a, "POST", "/api/cases", literal, admin), 201)
	searchPath := "/api/cases?q=" + url.QueryEscape(`%_\`)
	page := decoded[casePage](t, request(a, "GET", searchPath, nil, admin))
	if len(page.Items) != 1 || page.Items[0].ID != literal.ID {
		t.Fatalf("literal search wildcard escaped incorrectly: %+v", page)
	}
	page = decoded[casePage](t, request(a, "GET", "/api/cases?limit=1", nil, admin))
	if len(page.Items) != 1 || page.Items[0].ID != literal.ID || page.NextCursor == "" {
		t.Fatal("case seq pagination missing lookahead")
	}
	newest := createTestCase(t, a, admin)
	next := decoded[casePage](t, request(a, "GET", "/api/cases?limit=1&cursor="+page.NextCursor, nil, admin))
	if len(next.Items) != 1 || next.Items[0].ID == newest.ID || next.Items[0].ID == literal.ID {
		t.Fatal("later insert disturbed existing cursor page")
	}
	defaultPage := decoded[casePage](t, request(a, "GET", "/api/cases", nil, admin))
	if len(defaultPage.Items) != 20 || defaultPage.NextCursor == "" {
		t.Fatal("case default page size is not twenty")
	}
	expect(t, request(a, "POST", casePath(item)+"/actions", caseActionInput{Action: "close", Reason: "Explicit manual closure rationale", ExpectedVersion: 1}, admin), 201)
	closed := decoded[casePage](t, request(a, "GET", "/api/cases?status=closed", nil, admin))
	if len(closed.Items) != 1 || closed.Items[0].ID != item.ID {
		t.Fatal("case status filter ran after pagination")
	}
	for _, query := range []string{"limit=0", "limit=101", "limit=01", "limit=1&limit=2", "cursor=0", "cursor=01", "cursor=9223372036854775808", "status=", "status=active", "status=open&status=closed", "q=ab", "q=valid&q=valid", "q=%FF", "q=bad%0Aline", "unknown=x", "q=%zz"} {
		expect(t, request(a, "GET", "/api/cases?"+query, nil, admin), 400)
	}
	for _, suffix := range []string{"/activity", "/event-evidence"} {
		for _, query := range []string{"limit=0", "cursor=", "q=valid", "status=open", "limit=20&limit=20"} {
			expect(t, request(a, "GET", casePath(item)+suffix+"?"+query, nil, admin), 400)
		}
		expect(t, request(a, "GET", "/api/cases/"+UUID()+suffix, nil, admin), 404)
	}
	expect(t, request(a, "GET", "/api/cases/invalid", nil, admin), 400)
	expect(t, request(a, "GET", "/api/cases/"+UUID(), nil, admin), 404)
}

func importCaseEvents(t *testing.T, a *App, cookie *http.Cookie, events ...eventInput) []SecurityEvent {
	t.Helper()
	connection := testConnection(t, a, cookie)
	expect(t, request(a, "POST", "/api/events/import", eventImportInput{ConnectionID: connection.ID, Events: events}, cookie), 200)
	w := request(a, "GET", "/api/events?connectionId="+connection.ID, nil, cookie)
	expect(t, w, 200)
	return decoded[eventPage](t, w).Items
}

func TestCaseMultipleManualEventReferencesAndPreservedRelationships(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	group := createRiskGroup(t, a, admin, "yellow")
	membershipResponse := request(a, "POST", "/api/memberships", memberInput(person, group), admin)
	expect(t, membershipResponse, 201)
	membership := decoded[Membership](t, membershipResponse)
	linked := sampleEvent("case-linked")
	linked.EntityID = person.ID
	first := importCaseEvents(t, a, admin, linked, sampleEvent("case-unlinked"))
	second := importCaseEvents(t, a, admin, sampleEvent("different-source"))
	item := createTestCase(t, a, admin)
	version := 1
	var evidence []CaseEventEvidence
	for _, event := range append(first, second...) {
		w := request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: event.ID, Reason: "Analyst selected investigation context", ExpectedVersion: version}, admin)
		expect(t, w, 201)
		result := decoded[caseEvidenceResult](t, w)
		version++
		if result.Case.Version != version || result.Evidence.CaseID != item.ID || !reflect.DeepEqual(result.Evidence.Event, event) || result.Evidence.Status != "attached" || result.Evidence.RetractedAt != nil {
			t.Fatal("case attachment rewrote event provenance or failed versioning")
		}
		evidence = append(evidence, result.Evidence)
	}
	expectCaseError(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: first[0].ID, Reason: "Duplicate manual event reference", ExpectedVersion: version - 1}, admin), 409, "case_conflict")
	expectCaseError(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: first[0].ID, Reason: "Duplicate manual event reference", ExpectedVersion: version}, admin), 409, "event_already_attached")
	expect(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: UUID(), Reason: "Missing manual event reference", ExpectedVersion: version}, admin), 404)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: "invalid", Reason: "Valid rationale text", ExpectedVersion: version}, admin), 400)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: first[0].ID, Reason: "short", ExpectedVersion: version}, admin), 400)
	other := createTestCase(t, a, admin)
	retractPath := casePath(item) + "/event-evidence/" + evidence[0].ID + "/retract"
	expect(t, request(a, "POST", casePath(other)+"/event-evidence/"+evidence[0].ID+"/retract", caseRetractionInput{Reason: "Must not retract another case reference", ExpectedVersion: 1}, admin), 404)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence/"+UUID()+"/retract", caseRetractionInput{Reason: "Missing evidence withdrawal reason", ExpectedVersion: version}, admin), 404)
	w := request(a, "POST", retractPath, caseRetractionInput{Reason: "Reference withdrawn after human review", ExpectedVersion: version}, admin)
	expect(t, w, 200)
	withdrawn := decoded[caseEvidenceResult](t, w)
	version++
	if withdrawn.Case.Version != version || withdrawn.Evidence.Status != "retracted" || withdrawn.Evidence.RetractedAt == nil || withdrawn.Evidence.Reason != evidence[0].Reason || !withdrawn.Evidence.AttachedAt.Equal(evidence[0].AttachedAt) {
		t.Fatal("retraction rewrote original attachment")
	}
	expectCaseError(t, request(a, "POST", retractPath, caseRetractionInput{Reason: "Repeated withdrawal latest version", ExpectedVersion: version}, admin), 409, "evidence_already_retracted")
	w = request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: evidence[0].EventID, Reason: "A new explicit attachment after retraction", ExpectedVersion: version}, admin)
	expect(t, w, 201)
	reattached := decoded[caseEvidenceResult](t, w)
	version++
	if reattached.Evidence.ID == evidence[0].ID || reattached.Evidence.Status != "attached" {
		t.Fatal("reattachment reused historical reference identity")
	}
	seen := map[string]bool{}
	cursor := ""
	for {
		path := casePath(item) + "/event-evidence?limit=1"
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		w = request(a, "GET", path, nil, admin)
		expect(t, w, 200)
		page := decoded[caseEvidencePage](t, w)
		if len(page.Items) != 1 || seen[page.Items[0].ID] {
			t.Fatal("evidence pagination duplicated or lost a reference")
		}
		seen[page.Items[0].ID] = true
		cursor = page.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 4 {
		t.Fatal("retracted evidence disappeared from page history")
	}
	w = request(a, "GET", casePath(item)+"/activity?limit=1", nil, admin)
	expect(t, w, 200)
	activity := decoded[caseActivityPage](t, w)
	if len(activity.Items) != 1 || activity.Items[0].Action != "event_attached" || activity.Items[0].Before.Version != version-1 || activity.NextCursor == "" {
		t.Fatal("event reference missing its one versioned activity")
	}
	expect(t, request(a, "POST", casePath(item)+"/actions", caseActionInput{Action: "close", Reason: "Completed human review closes the file", ExpectedVersion: version}, admin), 201)
	version++
	expectCaseError(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: first[0].ID, Reason: "No mutation of a closed case allowed", ExpectedVersion: version}, admin), 409, "case_closed")
	expectCaseError(t, request(a, "POST", retractPath, caseRetractionInput{Reason: "No retraction on closed file allowed", ExpectedVersion: version}, admin), 409, "case_closed")
	expect(t, request(a, "GET", casePath(item)+"/event-evidence", nil, admin), 200)
	if _, err := a.DB.Exec(context.Background(), `DELETE FROM security_events WHERE id=$1`, first[0].ID); err == nil {
		t.Fatal("case evidence did not retain its event FK")
	}
	current, err := scanMembership(a.DB.QueryRow(context.Background(), `SELECT `+membershipColumns+` FROM memberships WHERE id=$1`, membership.ID))
	if err != nil || !reflect.DeepEqual(current, membership) || count(t, a, `SELECT count(*) FROM membership_history`) != 1 || count(t, a, `SELECT count(*) FROM membership_event_evidence`) != 0 {
		t.Fatal("independent case references changed membership context")
	}
	assertCaseVersion(t, a, item.ID, version)
}

func TestCaseConcurrentCreationUpdatesAndEvidenceVersionConflicts(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	draft := caseDraft()
	concurrent := func(call func(int) *httptest.ResponseRecorder) map[int]int {
		start := make(chan struct{})
		codes := make(chan int, 2)
		var wait sync.WaitGroup
		for index := 0; index < 2; index++ {
			wait.Add(1)
			go func(index int) { defer wait.Done(); <-start; codes <- call(index).Code }(index)
		}
		close(start)
		wait.Wait()
		close(codes)
		counts := map[int]int{}
		for code := range codes {
			counts[code]++
		}
		return counts
	}
	results := concurrent(func(_ int) *httptest.ResponseRecorder { return request(a, "POST", "/api/cases", draft, admin) })
	if results[201] != 1 || results[200] != 1 {
		t.Fatalf("concurrent idempotent creation: %v", results)
	}
	item := decoded[InvestigationCase](t, request(a, "GET", "/api/cases/"+draft.ID, nil, admin))
	assertCaseVersion(t, a, item.ID, 1)
	results = concurrent(func(index int) *httptest.ResponseRecorder {
		fields := draft.caseFields
		fields.Title = fmt.Sprintf("Concurrent case title %d", index)
		return request(a, "PATCH", casePath(item), updateCaseInput{caseFields: fields, ExpectedVersion: 1}, admin)
	})
	if results[200] != 1 || results[409] != 1 {
		t.Fatalf("concurrent updates: %v", results)
	}
	assertCaseVersion(t, a, item.ID, 2)
	events := importCaseEvents(t, a, admin, sampleEvent("concurrent-reference-a"), sampleEvent("concurrent-reference-b"))
	results = concurrent(func(index int) *httptest.ResponseRecorder {
		return request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: events[index].ID, Reason: "Concurrent explicit event reference", ExpectedVersion: 2}, admin)
	})
	if results[201] != 1 || results[409] != 1 || count(t, a, `SELECT count(*) FROM case_event_evidence`) != 1 {
		t.Fatalf("concurrent attachments: %v", results)
	}
	assertCaseVersion(t, a, item.ID, 3)
	collision := caseDraft()
	results = concurrent(func(index int) *httptest.ResponseRecorder {
		in := collision
		in.Summary = fmt.Sprintf("Different immutable creation summary %d", index)
		return request(a, "POST", "/api/cases", in, admin)
	})
	if results[201] != 1 || results[409] != 1 {
		t.Fatalf("concurrent different creation payloads: %v", results)
	}
	assertCaseVersion(t, a, collision.ID, 1)
}

func TestCaseHistoryAuditFailuresRollbackAllWrites(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	item := createTestCase(t, a, admin)
	events := importCaseEvents(t, a, admin, sampleEvent("rollback-reference-a"), sampleEvent("rollback-reference-b"))
	fields := caseDraft().caseFields
	fields.Title = "Must never persist failed update"
	execSQL(t, a, `ALTER TABLE case_history RENAME TO case_history_test_offline`)
	failedDraft := caseDraft()
	expect(t, request(a, "POST", "/api/cases", failedDraft, admin), 503)
	expect(t, request(a, "GET", "/api/cases/"+failedDraft.ID, nil, admin), 404)
	expect(t, request(a, "PATCH", casePath(item), updateCaseInput{caseFields: fields, ExpectedVersion: 1}, admin), 503)
	expect(t, request(a, "POST", casePath(item)+"/actions", caseActionInput{Action: "close", Reason: "Failed close must roll back completely", ExpectedVersion: 1}, admin), 503)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: events[0].ID, Reason: "Failed attachment must roll back completely", ExpectedVersion: 1}, admin), 503)
	execSQL(t, a, `ALTER TABLE case_history_test_offline RENAME TO case_history`)
	assertCaseVersion(t, a, item.ID, 1)
	if count(t, a, `SELECT count(*) FROM case_event_evidence`) != 0 {
		t.Fatal("history failure retained event reference")
	}
	w := request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: events[0].ID, Reason: "Reference before rollback withdrawal", ExpectedVersion: 1}, admin)
	expect(t, w, 201)
	evidence := decoded[caseEvidenceResult](t, w).Evidence
	execSQL(t, a, `ALTER TABLE audit_events RENAME TO audit_events_test_offline`)
	failedDraft = caseDraft()
	expect(t, request(a, "POST", "/api/cases", failedDraft, admin), 503)
	expect(t, request(a, "GET", "/api/cases/"+failedDraft.ID, nil, admin), 404)
	expect(t, request(a, "PATCH", casePath(item), updateCaseInput{caseFields: fields, ExpectedVersion: 2}, admin), 503)
	expect(t, request(a, "POST", casePath(item)+"/actions", caseActionInput{Action: "note", Reason: "Failed note must roll back completely", ExpectedVersion: 2}, admin), 503)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence", caseEvidenceInput{EventID: events[1].ID, Reason: "Audit failure rolls back new reference", ExpectedVersion: 2}, admin), 503)
	expect(t, request(a, "POST", casePath(item)+"/event-evidence/"+evidence.ID+"/retract", caseRetractionInput{Reason: "Audit failure rolls back withdrawal", ExpectedVersion: 2}, admin), 503)
	execSQL(t, a, `ALTER TABLE audit_events_test_offline RENAME TO audit_events`)
	assertCaseVersion(t, a, item.ID, 2)
	current := decoded[InvestigationCase](t, request(a, "GET", casePath(item), nil, admin))
	page := decoded[caseEvidencePage](t, request(a, "GET", casePath(item)+"/event-evidence", nil, admin))
	if current.Title != item.Title || current.Status != "open" || len(page.Items) != 1 || page.Items[0].RetractedAt != nil || page.Items[0].Status != "attached" {
		t.Fatal("failed transaction changed its authoritative case/evidence")
	}
}

func TestCaseMigration11To12PreservesPriorRecordsAndLedger(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	person := createPerson(t, a, admin)
	group := createRiskGroup(t, a, admin, "orange")
	w := request(a, "POST", "/api/memberships", memberInput(person, group), admin)
	expect(t, w, 201)
	membership := decoded[Membership](t, w)
	next := memberInput(person, group).ReviewOn
	expect(t, request(a, "POST", "/api/memberships/"+membership.ID+"/reviews", membershipReviewInput{Decision: "continue", Reason: "Existing explicit review before migration", ExpectedVersion: 1, NextReviewOn: next}, admin), 201)
	event := sampleEvent("existing-source-before-cases")
	event.EntityID = person.ID
	event.Severity = "high"
	importCaseEvents(t, a, admin, event)
	// Remove only the new, still-empty migration12 tables/ledger entry. This
	// leaves the immutable migration1–11 schema and its saved records intact.
	execSQL(t, a, `DROP TABLE case_event_evidence; DROP TABLE case_history; DROP TABLE investigation_cases; DELETE FROM schema_migrations WHERE version=12`)
	tables := []string{"vigil_product", "schema_migrations", "users", "sessions", "entities", "risk_groups", "memberships", "membership_history", "membership_reviews", "audit_events", "source_connections", "security_events", "notifications", "notification_reads", "notification_settings", "membership_event_evidence"}
	snapshot := func() map[string]string {
		t.Helper()
		data := map[string]string{}
		for _, table := range tables {
			var value string
			err := a.DB.QueryRow(context.Background(), `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM `+table+` t`+func() string {
				if table == "schema_migrations" {
					return " WHERE version<=11"
				}
				return ""
			}()).Scan(&value)
			if err != nil {
				t.Fatal(err)
			}
			data[table] = value
		}
		return data
	}
	before := snapshot()
	if err := a.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, snapshot()) {
		t.Fatal("migration12 changed existing case-independent records or checksums")
	}
	if count(t, a, `SELECT count(*) FROM schema_migrations`) != 12 || count(t, a, `SELECT count(*) FROM investigation_cases`)+count(t, a, `SELECT count(*) FROM case_history`)+count(t, a, `SELECT count(*) FROM case_event_evidence`) != 0 {
		t.Fatal("migration12 ledger or empty state incorrect")
	}
	if err := a.Migrate(context.Background()); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, snapshot()) || count(t, a, `SELECT count(*) FROM schema_migrations`) != 12 {
		t.Fatal("migration12 is not idempotent")
	}
	createTestCase(t, a, admin)
}
