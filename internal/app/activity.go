package app

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// MembershipActivity is a read model over the records written by review actions.
// It neither creates another history nor treats a reference as source verification.
type MembershipActivity struct {
	ID              string                      `json:"id"`
	Action          string                      `json:"action"`
	OccurredAt      time.Time                   `json:"occurredAt"`
	ActorID         string                      `json:"actorId"`
	Actor           string                      `json:"actor"`
	ActorNameSource string                      `json:"actorNameSource"`
	Version         int                         `json:"version,omitempty"`
	Before          *Membership                 `json:"before,omitempty"`
	After           *Membership                 `json:"after,omitempty"`
	Evidence        *MembershipActivityEvidence `json:"evidence,omitempty"`
	Review          *MembershipActivityReview   `json:"review,omitempty"`
}

type MembershipActivityReview struct {
	Decision     string `json:"decision"`
	Reason       string `json:"reason"`
	NextReviewOn string `json:"nextReviewOn"`
}

type MembershipActivityEvidence struct {
	ID              string    `json:"id"`
	EventID         string    `json:"eventId"`
	Title           string    `json:"title"`
	Severity        string    `json:"severity"`
	EventOccurredAt time.Time `json:"eventOccurredAt"`
	OriginProduct   string    `json:"originProduct"`
	OriginEventID   string    `json:"originEventId"`
	Provenance      string    `json:"provenance"`
	IdentityState   string    `json:"identityState"`
	Reason          string    `json:"reason"`
}

type membershipActivityPage struct {
	Items      []MembershipActivity `json:"items"`
	NextCursor string               `json:"nextCursor"`
}

type membershipActivityCursor struct {
	Version      int    `json:"version"`
	MembershipID string `json:"membershipId"`
	Kind         string `json:"kind"`
	Timestamp    string `json:"timestamp"`
	Rank         int    `json:"rank"`
	Sequence     string `json:"seq"`
}

type membershipActivityPosition struct {
	Timestamp time.Time
	Rank      int
	Sequence  int64
}

func encodeMembershipActivityCursor(membershipID, kind string, position membershipActivityPosition) string {
	// All fields are fixed scalar types, so marshaling cannot fail.
	data, _ := json.Marshal(membershipActivityCursor{
		Version: 1, MembershipID: membershipID, Kind: kind,
		Timestamp: position.Timestamp.UTC().Format(time.RFC3339Nano),
		Rank:      position.Rank, Sequence: strconv.FormatInt(position.Sequence, 10),
	})
	return base64.RawURLEncoding.EncodeToString(data)
}

func parseMembershipActivityCursor(value, membershipID, kind string) (*membershipActivityPosition, error) {
	invalidCursor := errors.New("Etkinlik sayfalama imleci geçersiz. Listeyi baştan açın.")
	if len(value) == 0 || len(value) > 1024 {
		return nil, invalidCursor
	}
	data, err := base64.RawURLEncoding.Strict().DecodeString(value)
	if err != nil {
		return nil, invalidCursor
	}
	var cursor membershipActivityCursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return nil, invalidCursor
	}
	if cursor.Version != 1 || cursor.MembershipID != membershipID || cursor.Kind != kind || cursor.Rank < 1 || cursor.Rank > 3 || !canonicalPositiveDecimal(cursor.Sequence) {
		return nil, invalidCursor
	}
	if (kind == "membership" && cursor.Rank != 1) || (kind == "evidence" && cursor.Rank == 1) {
		return nil, invalidCursor
	}
	sequence, err := strconv.ParseInt(cursor.Sequence, 10, 64)
	if err != nil {
		return nil, invalidCursor
	}
	timestamp, err := time.Parse(time.RFC3339Nano, cursor.Timestamp)
	if err != nil {
		return nil, invalidCursor
	}
	position := membershipActivityPosition{Timestamp: timestamp, Rank: cursor.Rank, Sequence: sequence}
	// Only the canonical form emitted by this endpoint is accepted. This also
	// rejects duplicate/unknown JSON fields, alternate offsets and extra bytes.
	if encodeMembershipActivityCursor(membershipID, kind, position) != value {
		return nil, invalidCursor
	}
	return &position, nil
}

// Each branch contributes at most one page plus a lookahead before the merge.
// Rank and sequence are numeric tie breakers: membership version, attachment
// sequence, then retraction sequence. A retraction is its own activity entry.
const membershipActivityQuery = `WITH activity_keys AS (
 (SELECT h.created_at AS occurred_at,1 AS source_rank,h.version::bigint AS source_seq
  FROM membership_history h
  WHERE h.membership_id=$1 AND $2::text IN ('all','membership')
   AND ($3::timestamptz IS NULL OR (h.created_at,1,h.version::bigint)<($3::timestamptz,$4::integer,$5::bigint))
  ORDER BY h.created_at DESC,h.version DESC LIMIT $6)
 UNION ALL
 (SELECT v.attached_at AS occurred_at,2 AS source_rank,v.seq AS source_seq
  FROM membership_event_evidence v
  WHERE v.membership_id=$1 AND $2::text IN ('all','evidence')
   AND ($3::timestamptz IS NULL OR (v.attached_at,2,v.seq)<($3::timestamptz,$4::integer,$5::bigint))
  ORDER BY v.attached_at DESC,v.seq DESC LIMIT $6)
 UNION ALL
 (SELECT v.retracted_at AS occurred_at,3 AS source_rank,v.seq AS source_seq
  FROM membership_event_evidence v
  WHERE v.membership_id=$1 AND v.retracted_at IS NOT NULL AND $2::text IN ('all','evidence')
   AND ($3::timestamptz IS NULL OR (v.retracted_at,3,v.seq)<($3::timestamptz,$4::integer,$5::bigint))
  ORDER BY v.retracted_at DESC,v.seq DESC LIMIT $6)
), activity_page AS (
 SELECT occurred_at,source_rank,source_seq FROM activity_keys
 ORDER BY occurred_at DESC,source_rank DESC,source_seq DESC LIMIT $6
)
SELECT p.occurred_at,p.source_rank,p.source_seq,COALESCE(h.action,''),
 CASE p.source_rank WHEN 1 THEN COALESCE(review.actor_id::text,h.actor_id::text) WHEN 2 THEN v.attached_by::text ELSE v.retracted_by::text END,
 CASE p.source_rank WHEN 1 THEN COALESCE(review.actor_name,u.name) WHEN 2 THEN v.attached_by_name ELSE v.retracted_by_name END,
 COALESCE(h.version,0),h.data,previous.data,
 COALESCE(v.id::text,''),COALESCE(v.event_id::text,''),COALESCE(e.title,''),COALESCE(e.severity,''),e.occurred_at,
 COALESCE(e.origin_product,''),COALESCE(e.origin_event_id,''),COALESCE(e.provenance,''),COALESCE(e.identity_state,''),
 CASE p.source_rank WHEN 2 THEN v.reason WHEN 3 THEN v.retraction_reason ELSE '' END,
 COALESCE(review.decision,''),COALESCE(review.reason,''),COALESCE(to_char(review.next_review_on,'YYYY-MM-DD'),'')
FROM activity_page p
LEFT JOIN membership_history h ON p.source_rank=1 AND h.membership_id=$1 AND h.version=p.source_seq
LEFT JOIN membership_history previous ON previous.membership_id=h.membership_id AND previous.version=h.version-1
LEFT JOIN membership_reviews review ON h.action='reviewed' AND review.membership_id=h.membership_id AND review.version=h.version
LEFT JOIN users u ON u.id=h.actor_id
LEFT JOIN membership_event_evidence v ON p.source_rank IN (2,3) AND v.membership_id=$1 AND v.seq=p.source_seq
LEFT JOIN security_events e ON e.id=v.event_id
ORDER BY p.occurred_at DESC,p.source_rank DESC,p.source_seq DESC`

func scanMembershipActivity(row scanner) (MembershipActivity, membershipActivityPosition, error) {
	var item MembershipActivity
	var position membershipActivityPosition
	var membershipAction string
	var afterData, beforeData []byte
	var evidence MembershipActivityEvidence
	var review MembershipActivityReview
	var eventOccurredAt *time.Time
	err := row.Scan(
		&item.OccurredAt, &position.Rank, &position.Sequence, &membershipAction,
		&item.ActorID, &item.Actor, &item.Version, &afterData, &beforeData,
		&evidence.ID, &evidence.EventID, &evidence.Title, &evidence.Severity, &eventOccurredAt,
		&evidence.OriginProduct, &evidence.OriginEventID, &evidence.Provenance, &evidence.IdentityState, &evidence.Reason,
		&review.Decision, &review.Reason, &review.NextReviewOn,
	)
	if err != nil {
		return item, position, err
	}
	position.Timestamp = item.OccurredAt
	if position.Rank == 1 {
		item.ID = "membership:" + strconv.FormatInt(position.Sequence, 10)
		item.Action = "membership." + membershipAction
		item.ActorNameSource = "current_profile"
		if membershipAction == "reviewed" {
			if review.Decision != "continue" && review.Decision != "close" {
				return item, position, errors.New("membership review activity is missing its decision")
			}
			item.Review = &review
			item.ActorNameSource = "recorded"
		}
		item.After = &Membership{}
		if err := json.Unmarshal(afterData, item.After); err != nil {
			return item, position, err
		}
		if len(beforeData) > 0 {
			item.Before = &Membership{}
			if err := json.Unmarshal(beforeData, item.Before); err != nil {
				return item, position, err
			}
		}
	} else {
		if eventOccurredAt == nil || evidence.ID == "" || evidence.EventID == "" {
			return item, position, errors.New("membership activity is missing its referenced event")
		}
		evidence.EventOccurredAt = *eventOccurredAt
		item.Evidence = &evidence
		item.ActorNameSource = "recorded"
		if position.Rank == 2 {
			item.ID = "evidence-attached:" + evidence.ID
			item.Action = "membership_evidence.attached"
		} else {
			item.ID = "evidence-retracted:" + evidence.ID
			item.Action = "membership_evidence.retracted"
		}
	}
	return item, position, nil
}

func (a *App) membershipActivity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	membershipID, ok := pathID(w, r)
	if !ok {
		return
	}
	params, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		invalid(w, "Etkinlik sorgusu geçersiz.")
		return
	}
	for key := range params {
		if key != "limit" && key != "cursor" && key != "kind" {
			invalid(w, "Bu görünüm yalnız limit, cursor ve kind parametrelerini kabul eder.")
			return
		}
	}
	pageParams := url.Values{}
	if values, present := params["limit"]; present {
		pageParams["limit"] = values
	}
	limit, _, err := parseListPage(pageParams)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if _, supplied := params["limit"]; !supplied {
		limit = 20
	}
	kind := "all"
	if values, present := params["kind"]; present {
		if len(values) != 1 || (values[0] != "all" && values[0] != "membership" && values[0] != "evidence") {
			invalid(w, "Etkinlik türü all, membership veya evidence olmalı.")
			return
		}
		kind = values[0]
	}
	var cursorAt *time.Time
	cursorRank, cursorSequence := 0, int64(0)
	if values, present := params["cursor"]; present {
		if len(values) != 1 {
			invalid(w, "Etkinlik sayfalama imleci yalnız bir kez gönderilebilir.")
			return
		}
		position, err := parseMembershipActivityCursor(values[0], membershipID, kind)
		if err != nil {
			invalid(w, err.Error())
			return
		}
		cursorAt, cursorRank, cursorSequence = &position.Timestamp, position.Rank, position.Sequence
	}

	// Parent existence and the merged activity page share one snapshot. Subsequent
	// page requests are fresh reads, not a frozen or independently sealed history.
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
	rows, err := tx.Query(r.Context(), membershipActivityQuery, membershipID, kind, cursorAt, cursorRank, cursorSequence, limit+1)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := membershipActivityPage{Items: []MembershipActivity{}}
	var lastPosition membershipActivityPosition
	for rows.Next() {
		item, position, err := scanMembershipActivity(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if len(out.Items) == limit {
			out.NextCursor = encodeMembershipActivityCursor(membershipID, kind, lastPosition)
			break
		}
		out.Items = append(out.Items, item)
		lastPosition = position
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
	respond(w, http.StatusOK, out)
}
