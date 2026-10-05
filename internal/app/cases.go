package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// InvestigationCase is a human-maintained review file. Its responsible label
// neither assigns access nor verifies identity; event references stay manual.
type InvestigationCase struct {
	ID            string     `json:"id"`
	Title         string     `json:"title"`
	Summary       string     `json:"summary"`
	Responsible   string     `json:"responsible"`
	Status        string     `json:"status"`
	Version       int        `json:"version"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	CreatedByID   string     `json:"createdById"`
	CreatedBy     string     `json:"createdBy"`
	ClosedAt      *time.Time `json:"closedAt"`
	ClosureReason string     `json:"closureReason"`
}

type caseFields struct {
	Title       string `json:"title"`
	Summary     string `json:"summary"`
	Responsible string `json:"responsible"`
}
type createCaseInput struct {
	ID string `json:"id"`
	caseFields
}
type updateCaseInput struct {
	caseFields
	ExpectedVersion int `json:"expectedVersion"`
}
type caseActionInput struct {
	Action          string `json:"action"`
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type caseEvidenceInput struct {
	EventID         string `json:"eventId"`
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type caseRetractionInput struct {
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type casePage struct {
	Items      []InvestigationCase `json:"items"`
	NextCursor string              `json:"nextCursor"`
}

type CaseActivity struct {
	ID         string             `json:"id"`
	CaseID     string             `json:"caseId"`
	Version    int                `json:"version"`
	Action     string             `json:"action"`
	Reason     string             `json:"reason"`
	ActorID    string             `json:"actorId"`
	Actor      string             `json:"actor"`
	OccurredAt time.Time          `json:"occurredAt"`
	Before     *InvestigationCase `json:"before"`
	After      InvestigationCase  `json:"after"`
}
type caseActivityPage struct {
	Items      []CaseActivity `json:"items"`
	NextCursor string         `json:"nextCursor"`
}
type caseActionResult struct {
	Case     InvestigationCase `json:"case"`
	Activity CaseActivity      `json:"activity"`
}

type CaseEventEvidence struct {
	ID               string        `json:"id"`
	CaseID           string        `json:"caseId"`
	EventID          string        `json:"eventId"`
	Reason           string        `json:"reason"`
	Status           string        `json:"status"`
	AttachedBy       string        `json:"attachedBy"`
	AttachedByID     string        `json:"attachedById"`
	AttachedAt       time.Time     `json:"attachedAt"`
	RetractedBy      string        `json:"retractedBy"`
	RetractedByID    string        `json:"retractedById"`
	RetractedAt      *time.Time    `json:"retractedAt"`
	RetractionReason string        `json:"retractionReason"`
	Event            SecurityEvent `json:"event"`
}
type caseEvidencePage struct {
	Items      []CaseEventEvidence `json:"items"`
	NextCursor string              `json:"nextCursor"`
}
type caseEvidenceResult struct {
	Case     InvestigationCase `json:"case"`
	Evidence CaseEventEvidence `json:"evidence"`
}

const caseColumns = `id,title,summary,responsible,status,version,created_at,updated_at,created_by::text,created_by_name,closed_at,closure_reason`
const caseSearchExpression = `(title || ' ' || summary || ' ' || responsible)`
const caseEvidenceSelect = `SELECT
 v.id,v.case_id,v.event_id,v.reason,v.attached_by::text,v.attached_by_name,v.attached_at,
 COALESCE(v.retracted_by::text,''),v.retracted_by_name,v.retracted_at,v.retraction_reason,
 e.id,e.connection_id,e.external_id,e.occurred_at,e.received_at,e.category,e.severity,
 e.title,e.summary,e.subject,e.device,COALESCE(host(e.source_ip),''),
 COALESCE(e.entity_id::text,''),e.identity_state,e.provenance,e.origin_product,e.origin_event_id,v.seq
 FROM case_event_evidence v JOIN security_events e ON e.id=v.event_id`

func (a *App) registerCases(m *http.ServeMux) {
	m.Handle("GET /api/cases", a.auth(http.HandlerFunc(a.listCases)))
	m.Handle("POST /api/cases", a.auth(http.HandlerFunc(a.createCase)))
	m.Handle("GET /api/cases/{id}", a.auth(http.HandlerFunc(a.getCase)))
	m.Handle("PATCH /api/cases/{id}", a.auth(http.HandlerFunc(a.updateCase)))
	m.Handle("POST /api/cases/{id}/actions", a.auth(http.HandlerFunc(a.caseAction)))
	m.Handle("GET /api/cases/{id}/activity", a.auth(http.HandlerFunc(a.caseActivity)))
	m.Handle("GET /api/cases/{id}/event-evidence", a.auth(http.HandlerFunc(a.listCaseEvidence)))
	m.Handle("POST /api/cases/{id}/event-evidence", a.auth(http.HandlerFunc(a.attachCaseEvidence)))
	m.Handle("POST /api/cases/{id}/event-evidence/{evidenceId}/retract", a.auth(http.HandlerFunc(a.retractCaseEvidence)))
}

func scanCase(row scanner) (item InvestigationCase, err error) {
	err = row.Scan(&item.ID, &item.Title, &item.Summary, &item.Responsible,
		&item.Status, &item.Version, &item.CreatedAt, &item.UpdatedAt,
		&item.CreatedByID, &item.CreatedBy, &item.ClosedAt, &item.ClosureReason)
	return
}

func normalizeCaseFields(fields *caseFields) bool {
	fields.Title = strings.TrimSpace(fields.Title)
	fields.Summary = strings.TrimSpace(fields.Summary)
	fields.Responsible = strings.TrimSpace(fields.Responsible)
	return textLength(fields.Title, 3, 160) && textLength(fields.Summary, 10, 2000) && textLength(fields.Responsible, 2, 100)
}

func caseConflict(w http.ResponseWriter) {
	fail(w, http.StatusConflict, "case_conflict", "İnceleme dosyası başka bir işlemde değişti. Taslağınızı koruyup güncel dosyayı açıkça yeniden yükleyin.")
}
func caseClosed(w http.ResponseWriter) {
	fail(w, http.StatusConflict, "case_closed", "İnceleme dosyası kapalı. Yeni işlem için gerekçeli yeniden açma kararı gerekir.")
}

func (a *App) lockCase(w http.ResponseWriter, r *http.Request, tx pgx.Tx, id string, version int) (InvestigationCase, bool) {
	item, err := scanCase(tx.QueryRow(r.Context(), `SELECT `+caseColumns+` FROM investigation_cases WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		dbFailure(w, err)
		return item, false
	}
	if item.Version != version {
		caseConflict(w)
		return item, false
	}
	return item, true
}

func saveCase(ctx context.Context, tx pgx.Tx, item InvestigationCase, occurredAt time.Time) (InvestigationCase, error) {
	return scanCase(tx.QueryRow(ctx, `UPDATE investigation_cases SET title=$2,summary=$3,responsible=$4,status=$5,
 version=version+1,updated_at=$6,closed_at=$7,closure_reason=$8 WHERE id=$1 RETURNING `+caseColumns,
		item.ID, item.Title, item.Summary, item.Responsible, item.Status, occurredAt, item.ClosedAt, item.ClosureReason))
}

func appendCaseHistory(ctx context.Context, tx pgx.Tx, actor User, before *InvestigationCase, after InvestigationCase, action, reason string, occurredAt time.Time) (CaseActivity, error) {
	item := CaseActivity{ID: UUID(), CaseID: after.ID, Version: after.Version, Action: action,
		Reason: reason, ActorID: actor.ID, Actor: actor.Name, OccurredAt: occurredAt, Before: before, After: after}
	var beforeData []byte
	var err error
	if before != nil {
		beforeData, err = json.Marshal(before)
		if err != nil {
			return item, err
		}
	}
	afterData, err := json.Marshal(after)
	if err != nil {
		return item, err
	}
	_, err = tx.Exec(ctx, `INSERT INTO case_history(id,case_id,version,action,reason,actor_id,actor_name,occurred_at,before_data,after_data)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)`,
		item.ID, item.CaseID, item.Version, item.Action, item.Reason, item.ActorID, item.Actor, item.OccurredAt, beforeData, afterData)
	return item, err
}

func caseQuery(r *http.Request, search bool) (url.Values, int, int64, string, bool, error) {
	values, pattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		return nil, 0, 0, "", false, err
	}
	for key, entries := range values {
		if len(entries) != 1 || (key != "limit" && key != "cursor" && !(search && (key == "q" || key == "status"))) {
			return nil, 0, 0, "", false, errors.New("İnceleme dosyası sorgusu geçersiz.")
		}
	}
	limit, cursor, err := parseListPage(values)
	if _, supplied := values["limit"]; !supplied {
		limit = 20
	}
	return values, limit, cursor, pattern, hasSearch, err
}

func (a *App) listCases(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	params, limit, cursor, pattern, hasSearch, err := caseQuery(r, true)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	status := "all"
	if supplied, ok := params["status"]; ok {
		status = supplied[0]
	}
	if status != "all" && status != "open" && status != "closed" {
		invalid(w, "Dosya durumu all, open veya closed olmalı.")
		return
	}
	query := `SELECT ` + caseColumns + `,seq FROM investigation_cases WHERE ($1='all' OR status=$1) AND ($2::bigint=0 OR seq<$2)`
	args := []any{status, cursor}
	if hasSearch {
		query += ` AND ` + caseSearchExpression + ` ILIKE $3 ESCAPE E'\\'`
		args = append(args, pattern)
	}
	query += ` ORDER BY seq DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, limit+1)
	rows, err := a.DB.Query(r.Context(), query, args...)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	page := casePage{Items: []InvestigationCase{}}
	var last int64
	for rows.Next() {
		var item InvestigationCase
		var seq int64
		if err := rows.Scan(&item.ID, &item.Title, &item.Summary, &item.Responsible,
			&item.Status, &item.Version, &item.CreatedAt, &item.UpdatedAt, &item.CreatedByID, &item.CreatedBy, &item.ClosedAt, &item.ClosureReason, &seq); err != nil {
			dbFailure(w, err)
			return
		}
		if len(page.Items) == limit {
			page.NextCursor = strconv.FormatInt(last, 10)
			break
		}
		page.Items = append(page.Items, item)
		last = seq
	}
	if err := rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, page)
}

func (a *App) getCase(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	item, err := scanCase(a.DB.QueryRow(r.Context(), `SELECT `+caseColumns+` FROM investigation_cases WHERE id=$1`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, item)
}

func (a *App) createCase(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	var in createCaseInput
	if !decode(w, r, &in) {
		return
	}
	in.ID = strings.ToLower(strings.TrimSpace(in.ID))
	if !uuidPattern.MatchString(in.ID) || !normalizeCaseFields(&in.caseFields) {
		invalid(w, "Taslak UUID, 3–160 karakterlik başlık, 10–2000 karakterlik özet ve 2–100 karakterlik sorumlu etiketi gerekiyor.")
		return
	}
	payload, err := json.Marshal(in.caseFields)
	if err != nil {
		dbFailure(w, err)
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	actor := currentUser(r)
	now := time.Now().UTC().Truncate(time.Microsecond)
	item, err := scanCase(tx.QueryRow(r.Context(), `INSERT INTO investigation_cases(id,title,summary,responsible,created_at,updated_at,created_by,created_by_name,creation_payload)
 VALUES($1,$2,$3,$4,$5,$5,$6,$7,$8::jsonb) ON CONFLICT(id) DO NOTHING RETURNING `+caseColumns,
		in.ID, in.Title, in.Summary, in.Responsible, now, actor.ID, actor.Name, payload))
	if errors.Is(err, pgx.ErrNoRows) {
		// Compare immutable creation fields, never the currently edited title or
		// status. A lost-response retry returns the authoritative current file.
		var matches bool
		err = tx.QueryRow(r.Context(), `SELECT created_by=$2::uuid AND creation_payload=$3::jsonb FROM investigation_cases WHERE id=$1 FOR UPDATE`, in.ID, actor.ID, payload).Scan(&matches)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if !matches {
			fail(w, http.StatusConflict, "case_id_conflict", "Bu taslak kimliği başka içerik veya oluşturan kişiyle kullanılmış. Taslak yeniden gönderilmedi.")
			return
		}
		item, err = scanCase(tx.QueryRow(r.Context(), `SELECT `+caseColumns+` FROM investigation_cases WHERE id=$1`, in.ID))
		if err != nil {
			dbFailure(w, err)
			return
		}
		if err := tx.Commit(r.Context()); err != nil {
			dbFailure(w, err)
			return
		}
		respond(w, http.StatusOK, item)
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := appendCaseHistory(r.Context(), tx, actor, nil, item, "created", "", now); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "case.created", "case", item.ID, http.StatusCreated, item)
}

func (a *App) updateCase(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in updateCaseInput
	if !decode(w, r, &in) {
		return
	}
	if !normalizeCaseFields(&in.caseFields) || in.ExpectedVersion < 1 {
		invalid(w, "Dosya alanları ve güncel sürüm gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, ok := a.lockCase(w, r, tx, id, in.ExpectedVersion)
	if !ok {
		return
	}
	if old.Status != "open" {
		caseClosed(w)
		return
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	item := old
	item.Title, item.Summary, item.Responsible = in.Title, in.Summary, in.Responsible
	item, err := saveCase(r.Context(), tx, item, now)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := appendCaseHistory(r.Context(), tx, currentUser(r), &old, item, "updated", "", now); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "case.updated", "case", id, http.StatusOK, item)
}

func (a *App) caseAction(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in caseActionInput
	if !decode(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if (in.Action != "note" && in.Action != "close" && in.Action != "reopen") || !textLength(in.Reason, 10, 2000) || in.ExpectedVersion < 1 {
		invalid(w, "note, close veya reopen işlemi, 10–2000 karakterlik gerekçe ve güncel sürüm gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, ok := a.lockCase(w, r, tx, id, in.ExpectedVersion)
	if !ok {
		return
	}
	if in.Action == "reopen" && old.Status == "open" {
		fail(w, http.StatusConflict, "case_open", "İnceleme dosyası zaten açık.")
		return
	}
	if in.Action != "reopen" && old.Status == "closed" {
		caseClosed(w)
		return
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	item, action := old, "noted"
	if in.Action == "close" {
		item.Status, item.ClosedAt, item.ClosureReason, action = "closed", &now, in.Reason, "closed"
	} else if in.Action == "reopen" {
		item.Status, item.ClosedAt, item.ClosureReason, action = "open", nil, "", "reopened"
	}
	item, err := saveCase(r.Context(), tx, item, now)
	if err != nil {
		dbFailure(w, err)
		return
	}
	activity, err := appendCaseHistory(r.Context(), tx, currentUser(r), &old, item, action, in.Reason, now)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "case."+action, "case", id, http.StatusCreated, caseActionResult{Case: item, Activity: activity})
}

func (a *App) readCaseTx(w http.ResponseWriter, r *http.Request, id string) (pgx.Tx, bool) {
	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		dbFailure(w, err)
		return nil, false
	}
	var exists int
	if err := tx.QueryRow(r.Context(), `SELECT 1 FROM investigation_cases WHERE id=$1`, id).Scan(&exists); err != nil {
		tx.Rollback(r.Context())
		dbFailure(w, err)
		return nil, false
	}
	return tx, true
}

func (a *App) caseActivity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	_, limit, cursor, _, _, err := caseQuery(r, false)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	tx, ok := a.readCaseTx(w, r, id)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), `SELECT id,case_id,version,action,reason,actor_id,actor_name,occurred_at,before_data,after_data,seq
 FROM case_history WHERE case_id=$1 AND ($2::bigint=0 OR seq<$2) ORDER BY seq DESC LIMIT $3`, id, cursor, limit+1)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	page := caseActivityPage{Items: []CaseActivity{}}
	var last int64
	for rows.Next() {
		var item CaseActivity
		var before, after []byte
		var seq int64
		if err := rows.Scan(&item.ID, &item.CaseID, &item.Version, &item.Action, &item.Reason,
			&item.ActorID, &item.Actor, &item.OccurredAt, &before, &after, &seq); err != nil {
			dbFailure(w, err)
			return
		}
		if len(page.Items) == limit {
			page.NextCursor = strconv.FormatInt(last, 10)
			break
		}
		if len(before) > 0 {
			item.Before = &InvestigationCase{}
			if err := json.Unmarshal(before, item.Before); err != nil {
				dbFailure(w, err)
				return
			}
		}
		if err := json.Unmarshal(after, &item.After); err != nil {
			dbFailure(w, err)
			return
		}
		page.Items = append(page.Items, item)
		last = seq
	}
	if err := rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	rows.Close()
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, page)
}

func scanCaseEvidence(row scanner) (CaseEventEvidence, int64, error) {
	var item CaseEventEvidence
	var seq int64
	err := row.Scan(&item.ID, &item.CaseID, &item.EventID, &item.Reason,
		&item.AttachedByID, &item.AttachedBy, &item.AttachedAt,
		&item.RetractedByID, &item.RetractedBy, &item.RetractedAt, &item.RetractionReason,
		&item.Event.ID, &item.Event.ConnectionID, &item.Event.ExternalID,
		&item.Event.OccurredAt, &item.Event.ReceivedAt, &item.Event.Category,
		&item.Event.Severity, &item.Event.Title, &item.Event.Summary,
		&item.Event.Subject, &item.Event.Device, &item.Event.SourceIP,
		&item.Event.EntityID, &item.Event.IdentityState, &item.Event.Provenance,
		&item.Event.OriginProduct, &item.Event.OriginEventID, &seq)
	item.Status = "attached"
	if item.RetractedAt != nil {
		item.Status = "retracted"
	}
	return item, seq, err
}

func caseEvidenceByID(ctx context.Context, tx pgx.Tx, caseID, evidenceID string) (CaseEventEvidence, error) {
	item, _, err := scanCaseEvidence(tx.QueryRow(ctx, caseEvidenceSelect+` WHERE v.case_id=$1 AND v.id=$2`, caseID, evidenceID))
	return item, err
}

func (a *App) listCaseEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	_, limit, cursor, _, _, err := caseQuery(r, false)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	tx, ok := a.readCaseTx(w, r, id)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	rows, err := tx.Query(r.Context(), caseEvidenceSelect+` WHERE v.case_id=$1 AND ($2::bigint=0 OR v.seq<$2) ORDER BY v.seq DESC LIMIT $3`, id, cursor, limit+1)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	page := caseEvidencePage{Items: []CaseEventEvidence{}}
	var last int64
	for rows.Next() {
		item, seq, err := scanCaseEvidence(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if len(page.Items) == limit {
			page.NextCursor = strconv.FormatInt(last, 10)
			break
		}
		page.Items = append(page.Items, item)
		last = seq
	}
	if err := rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	rows.Close()
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, page)
}

func (a *App) attachCaseEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in caseEvidenceInput
	if !decode(w, r, &in) {
		return
	}
	in.EventID = strings.ToLower(strings.TrimSpace(in.EventID))
	in.Reason, ok = evidenceReason(in.Reason)
	if !ok || !uuidPattern.MatchString(in.EventID) || in.ExpectedVersion < 1 {
		invalid(w, "Olay UUID, 10–1000 karakterlik gerekçe ve güncel dosya sürümü gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, ok := a.lockCase(w, r, tx, id, in.ExpectedVersion)
	if !ok {
		return
	}
	if old.Status != "open" {
		caseClosed(w)
		return
	}
	// The independent case can explicitly reference linked or unlinked manual
	// imports. Nothing is inferred from an event's name, IP, time or entity.
	var exists string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM security_events WHERE id=$1 FOR KEY SHARE`, in.EventID).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	actor := currentUser(r)
	evidenceID := UUID()
	err := tx.QueryRow(r.Context(), `INSERT INTO case_event_evidence(id,case_id,event_id,reason,attached_by,attached_by_name,attached_at)
 VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(case_id,event_id) WHERE retracted_at IS NULL DO NOTHING RETURNING id`,
		evidenceID, id, in.EventID, in.Reason, actor.ID, actor.Name, now).Scan(&evidenceID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusConflict, "event_already_attached", "Bu olay inceleme dosyasına zaten etkin olarak iliştirilmiş.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	item, err := saveCase(r.Context(), tx, old, now)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := appendCaseHistory(r.Context(), tx, actor, &old, item, "event_attached", in.Reason, now); err != nil {
		dbFailure(w, err)
		return
	}
	evidence, err := caseEvidenceByID(r.Context(), tx, id, evidenceID)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "case_evidence.attached", "case", id, http.StatusCreated, caseEvidenceResult{Case: item, Evidence: evidence})
}

func (a *App) retractCaseEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	evidenceID := strings.ToLower(r.PathValue("evidenceId"))
	if !uuidPattern.MatchString(evidenceID) {
		invalid(w, "Olay ilişkisi UUID geçersiz.")
		return
	}
	var in caseRetractionInput
	if !decode(w, r, &in) {
		return
	}
	in.Reason, ok = evidenceReason(in.Reason)
	if !ok || in.ExpectedVersion < 1 {
		invalid(w, "10–1000 karakterlik geri çekme gerekçesi ve güncel dosya sürümü gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, ok := a.lockCase(w, r, tx, id, in.ExpectedVersion)
	if !ok {
		return
	}
	if old.Status != "open" {
		caseClosed(w)
		return
	}
	var retractedAt *time.Time
	if err := tx.QueryRow(r.Context(), `SELECT retracted_at FROM case_event_evidence WHERE case_id=$1 AND id=$2 FOR UPDATE`, id, evidenceID).Scan(&retractedAt); err != nil {
		dbFailure(w, err)
		return
	}
	if retractedAt != nil {
		fail(w, http.StatusConflict, "evidence_already_retracted", "Bu olay ilişkisi daha önce geri çekilmiş.")
		return
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	actor := currentUser(r)
	if _, err := tx.Exec(r.Context(), `UPDATE case_event_evidence SET retracted_by=$3,retracted_by_name=$4,retracted_at=$5,retraction_reason=$6 WHERE case_id=$1 AND id=$2`,
		id, evidenceID, actor.ID, actor.Name, now, in.Reason); err != nil {
		dbFailure(w, err)
		return
	}
	item, err := saveCase(r.Context(), tx, old, now)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := appendCaseHistory(r.Context(), tx, actor, &old, item, "event_retracted", in.Reason, now); err != nil {
		dbFailure(w, err)
		return
	}
	evidence, err := caseEvidenceByID(r.Context(), tx, id, evidenceID)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "case_evidence.retracted", "case", id, http.StatusOK, caseEvidenceResult{Case: item, Evidence: evidence})
}
