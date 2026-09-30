package app

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// MembershipEventEvidence records a reviewer's explicit reference to an imported
// candidate event. It does not verify the event's source or entity identity.
type MembershipEventEvidence struct {
	ID               string        `json:"id"`
	MembershipID     string        `json:"membershipId"`
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

type membershipEvidencePage struct {
	Items      []MembershipEventEvidence `json:"items"`
	NextCursor string                    `json:"nextCursor"`
}

type attachEvidenceInput struct {
	EventID string `json:"eventId"`
	Reason  string `json:"reason"`
}

type retractEvidenceInput struct {
	Reason string `json:"reason"`
}

const membershipEvidenceSelect = `SELECT
 v.id,v.membership_id,v.event_id,v.reason,v.attached_by::text,v.attached_by_name,v.attached_at,
 COALESCE(v.retracted_by::text,''),v.retracted_by_name,v.retracted_at,v.retraction_reason,
 e.id,e.connection_id,e.external_id,e.occurred_at,e.received_at,e.category,e.severity,
 e.title,e.summary,e.subject,e.device,COALESCE(host(e.source_ip),''),
 COALESCE(e.entity_id::text,''),e.identity_state,e.provenance,e.origin_product,e.origin_event_id,
 v.seq
 FROM membership_event_evidence v JOIN security_events e ON e.id=v.event_id`

func scanMembershipEvidence(row scanner) (MembershipEventEvidence, int64, error) {
	var item MembershipEventEvidence
	var seq int64
	err := row.Scan(
		&item.ID, &item.MembershipID, &item.EventID, &item.Reason,
		&item.AttachedByID, &item.AttachedBy, &item.AttachedAt,
		&item.RetractedByID, &item.RetractedBy, &item.RetractedAt, &item.RetractionReason,
		&item.Event.ID, &item.Event.ConnectionID, &item.Event.ExternalID,
		&item.Event.OccurredAt, &item.Event.ReceivedAt, &item.Event.Category,
		&item.Event.Severity, &item.Event.Title, &item.Event.Summary,
		&item.Event.Subject, &item.Event.Device, &item.Event.SourceIP,
		&item.Event.EntityID, &item.Event.IdentityState, &item.Event.Provenance,
		&item.Event.OriginProduct, &item.Event.OriginEventID, &seq,
	)
	if err != nil {
		return item, 0, err
	}
	item.Status = "attached"
	if item.RetractedAt != nil {
		item.Status = "retracted"
	}
	return item, seq, nil
}

func (a *App) registerMembershipEvidence(m *http.ServeMux) {
	m.Handle("GET /api/memberships/{id}/event-evidence", a.auth(http.HandlerFunc(a.listMembershipEvidence)))
	m.Handle("POST /api/memberships/{id}/event-evidence", a.auth(http.HandlerFunc(a.attachMembershipEvidence)))
	m.Handle("POST /api/memberships/{id}/event-evidence/{evidenceId}/retract", a.auth(http.HandlerFunc(a.retractMembershipEvidence)))
}

func (a *App) listMembershipEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	membershipID, ok := pathID(w, r)
	if !ok {
		return
	}
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		invalid(w, "Sayfalama sorgusu geçersiz.")
		return
	}
	for key := range params {
		if key != "limit" && key != "cursor" {
			invalid(w, "Bu görünüm yalnız limit ve cursor parametrelerini kabul eder.")
			return
		}
	}
	limit, cursor, err := parseListPage(params)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if _, supplied := params["limit"]; !supplied {
		limit = 20
	}

	// Existence and page must describe one database snapshot. Separate page requests
	// remain fresh reads, like the other keyset-paged Vigil collections.
	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var exists int
	if err := tx.QueryRow(r.Context(), `SELECT 1 FROM memberships WHERE id=$1`, membershipID).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	var rows pgx.Rows
	if cursor == 0 {
		rows, err = tx.Query(r.Context(), membershipEvidenceSelect+` WHERE v.membership_id=$1 ORDER BY v.seq DESC LIMIT $2`, membershipID, limit+1)
	} else {
		rows, err = tx.Query(r.Context(), membershipEvidenceSelect+` WHERE v.membership_id=$1 AND v.seq<$2 ORDER BY v.seq DESC LIMIT $3`, membershipID, cursor, limit+1)
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := membershipEvidencePage{Items: []MembershipEventEvidence{}}
	var lastSeq int64
	for rows.Next() {
		item, seq, err := scanMembershipEvidence(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if len(out.Items) == limit {
			out.NextCursor = strconv.FormatInt(lastSeq, 10)
			break
		}
		out.Items = append(out.Items, item)
		lastSeq = seq
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
	respond(w, 200, out)
}

func evidenceReason(reason string) (string, bool) {
	reason = strings.TrimSpace(reason)
	return reason, textLength(reason, 10, 1000)
}

func evidenceByID(ctx context.Context, tx pgx.Tx, membershipID, evidenceID string) (MembershipEventEvidence, error) {
	item, _, err := scanMembershipEvidence(tx.QueryRow(ctx, membershipEvidenceSelect+` WHERE v.membership_id=$1 AND v.id=$2`, membershipID, evidenceID))
	return item, err
}

func (a *App) attachMembershipEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	membershipID, ok := pathID(w, r)
	if !ok {
		return
	}
	var in attachEvidenceInput
	if !decode(w, r, &in) {
		return
	}
	in.EventID = strings.ToLower(strings.TrimSpace(in.EventID))
	in.Reason, ok = evidenceReason(in.Reason)
	if !uuidPattern.MatchString(in.EventID) || !ok {
		invalid(w, "Olay kimliği ve 10–1000 karakterlik inceleme gerekçesi gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var entityID string
	if err := tx.QueryRow(r.Context(), `SELECT entity_id FROM memberships WHERE id=$1 FOR UPDATE`, membershipID).Scan(&entityID); err != nil {
		dbFailure(w, err)
		return
	}
	var eventEntityID, identityState string
	if err := tx.QueryRow(r.Context(), `SELECT COALESCE(entity_id::text,''),identity_state FROM security_events WHERE id=$1 FOR KEY SHARE`, in.EventID).Scan(&eventEntityID, &identityState); err != nil {
		dbFailure(w, err)
		return
	}
	if identityState != "candidate" {
		fail(w, 409, "event_not_candidate", "Yalnız varlığa aday bağlanmış bir olay incelemeye eklenebilir.")
		return
	}
	if eventEntityID != entityID {
		fail(w, 409, "event_entity_mismatch", "Olay bu üyeliğin varlığıyla aday ilişkili değil.")
		return
	}
	actor := currentUser(r)
	evidenceID := UUID()
	// The partial unique index makes a second active reference impossible. A
	// retracted row remains in history and permits an explicit new attachment.
	var insertedID string
	err := tx.QueryRow(r.Context(), `INSERT INTO membership_event_evidence(id,membership_id,event_id,reason,attached_by,attached_by_name)
	 VALUES($1,$2,$3,$4,$5,$6)
	 ON CONFLICT (membership_id,event_id) WHERE retracted_at IS NULL DO NOTHING
	 RETURNING id`, evidenceID, membershipID, in.EventID, in.Reason, actor.ID, actor.Name).Scan(&insertedID)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 409, "evidence_duplicate", "Bu olay incelemeye zaten ekli.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	item, err := evidenceByID(r.Context(), tx, membershipID, insertedID)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "membership_evidence.attached", "membership", membershipID, 201, item)
}

func (a *App) retractMembershipEvidence(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	membershipID, ok := pathID(w, r)
	if !ok {
		return
	}
	evidenceID := strings.ToLower(r.PathValue("evidenceId"))
	if !uuidPattern.MatchString(evidenceID) {
		invalid(w, "Olay bağlantısı kimliği geçersiz.")
		return
	}
	var in retractEvidenceInput
	if !decode(w, r, &in) {
		return
	}
	in.Reason, ok = evidenceReason(in.Reason)
	if !ok {
		invalid(w, "Geri çekme gerekçesi 10–1000 karakter olmalı.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var exists int
	if err := tx.QueryRow(r.Context(), `SELECT 1 FROM memberships WHERE id=$1 FOR UPDATE`, membershipID).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	var retractedAt *time.Time
	if err := tx.QueryRow(r.Context(), `SELECT retracted_at FROM membership_event_evidence WHERE id=$1 AND membership_id=$2 FOR UPDATE`, evidenceID, membershipID).Scan(&retractedAt); err != nil {
		dbFailure(w, err)
		return
	}
	if retractedAt != nil {
		fail(w, 409, "evidence_already_retracted", "Bu olay bağlantısı daha önce geri çekildi.")
		return
	}
	actor := currentUser(r)
	if _, err := tx.Exec(r.Context(), `UPDATE membership_event_evidence
	 SET retracted_by=$3,retracted_by_name=$4,retracted_at=now(),retraction_reason=$5
	 WHERE id=$1 AND membership_id=$2`, evidenceID, membershipID, actor.ID, actor.Name, in.Reason); err != nil {
		dbFailure(w, err)
		return
	}
	item, err := evidenceByID(r.Context(), tx, membershipID, evidenceID)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "membership_evidence.retracted", "membership", membershipID, 200, item)
}
