package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// MembershipReview records a human review checkpoint. Its reason is distinct
// from the membership's original rationale and does not grant or revoke access.
type MembershipReview struct {
	MembershipID string    `json:"membershipId"`
	Version      int       `json:"version"`
	Decision     string    `json:"decision"`
	Reason       string    `json:"reason"`
	NextReviewOn string    `json:"nextReviewOn"`
	ActorID      string    `json:"actorId"`
	Actor        string    `json:"actor"`
	ReviewedAt   time.Time `json:"reviewedAt"`
}

type membershipReviewInput struct {
	Decision        string `json:"decision"`
	Reason          string `json:"reason"`
	ExpectedVersion int    `json:"expectedVersion"`
	NextReviewOn    string `json:"nextReviewOn"`
}

type membershipReviewResult struct {
	Membership Membership       `json:"membership"`
	Review     MembershipReview `json:"review"`
}

type latestMembershipReviewResult struct {
	Review *MembershipReview `json:"review"`
}

func (a *App) latestMembershipReview(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	// The parent check and latest decision must describe the same snapshot.
	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var exists int
	if err := tx.QueryRow(r.Context(), `SELECT 1 FROM memberships WHERE id=$1`, id).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	var review MembershipReview
	err = tx.QueryRow(r.Context(), `SELECT membership_id::text,version,decision,reason,
	 COALESCE(to_char(next_review_on,'YYYY-MM-DD'),''),actor_id::text,actor_name,reviewed_at
	 FROM membership_reviews WHERE membership_id=$1 ORDER BY version DESC LIMIT 1`, id).Scan(
		&review.MembershipID, &review.Version, &review.Decision, &review.Reason,
		&review.NextReviewOn, &review.ActorID, &review.Actor, &review.ReviewedAt,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		dbFailure(w, err)
		return
	}
	result := latestMembershipReviewResult{}
	if err == nil {
		result.Review = &review
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, result)
}

func (a *App) getMembership(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	membership, err := scanMembership(a.DB.QueryRow(r.Context(), `SELECT `+membershipColumns+` FROM memberships WHERE id=$1`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, membership)
}

func (a *App) reviewMembership(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in membershipReviewInput
	if !decode(w, r, &in) {
		return
	}
	in.Reason = strings.TrimSpace(in.Reason)
	if (in.Decision != "continue" && in.Decision != "close") || !textLength(in.Reason, 10, 1000) || in.ExpectedVersion < 1 {
		invalid(w, "İnceleme kararı, 10–1000 karakterlik karar gerekçesi ve güncel üyelik sürümü gerekiyor.")
		return
	}
	if in.Decision == "close" && in.NextReviewOn != "" {
		invalid(w, "Kapatma kararında sonraki gözden geçirme tarihi gönderilemez.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, err := scanMembership(tx.QueryRow(r.Context(), `SELECT `+membershipColumns+` FROM memberships WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if old.Version != in.ExpectedVersion {
		stale(w)
		return
	}
	if old.Status == "closed" {
		fail(w, http.StatusConflict, "membership_closed", "Bu inceleme üyeliği kapatılmış. Kapalı üyelik için yeni inceleme kararı kaydedilemez.")
		return
	}

	// Capture the decision time after obtaining the row lock. Date checks,
	// membership metadata and both historical records use this same instant.
	reviewedAt := time.Now().UTC().Truncate(time.Microsecond)
	today := reviewedAt.Format(time.DateOnly)
	status, reviewOn := old.Status, old.ReviewOn
	if in.Decision == "continue" {
		if old.EndsOn <= today {
			fail(w, http.StatusConflict, "review_period_ended", "Üyeliğin süresi içinde ileri bir gözden geçirme günü kalmadı. Üyeliği kapatın veya tarihlerini ayrı bir düzenlemeyle güncelleyin.")
			return
		}
		nextReview, err := time.Parse(time.DateOnly, in.NextReviewOn)
		if err != nil || nextReview.Year() < 1 || nextReview.Format(time.DateOnly) != in.NextReviewOn || in.NextReviewOn <= today || in.NextReviewOn < old.StartsOn || in.NextReviewOn > old.EndsOn {
			invalid(w, "Sonraki gözden geçirme tarihi UTC bugününden sonra ve üyeliğin başlangıç–bitiş aralığında olmalı (YYYY-MM-DD).")
			return
		}
		reviewOn = in.NextReviewOn
	} else {
		status = "closed"
	}

	membership, err := scanMembership(tx.QueryRow(r.Context(), `UPDATE memberships
	 SET status=$2,review_on=$3::text::date,version=version+1,updated_at=$4
	 WHERE id=$1 RETURNING `+membershipColumns, id, status, reviewOn, reviewedAt))
	if err != nil {
		dbFailure(w, err)
		return
	}
	membership.Active = membershipActive(membership, reviewedAt)
	actor := currentUser(r)
	review := MembershipReview{
		MembershipID: id, Version: membership.Version, Decision: in.Decision,
		Reason: in.Reason, NextReviewOn: in.NextReviewOn,
		ActorID: actor.ID, Actor: actor.Name, ReviewedAt: reviewedAt,
	}
	snapshot, err := json.Marshal(membership)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO membership_history(membership_id,version,action,actor_id,data,created_at)
	 VALUES($1,$2,'reviewed',$3,$4,$5)`, id, membership.Version, actor.ID, snapshot, reviewedAt); err != nil {
		dbFailure(w, err)
		return
	}
	if _, err := tx.Exec(r.Context(), `INSERT INTO membership_reviews
	 (membership_id,version,decision,reason,next_review_on,actor_id,actor_name,reviewed_at)
	 VALUES($1,$2,$3,$4,NULLIF($5::text,'')::date,$6,$7,$8)`,
		id, membership.Version, review.Decision, review.Reason, review.NextReviewOn, review.ActorID, review.Actor, reviewedAt); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "membership.reviewed", "membership", id, http.StatusCreated, membershipReviewResult{Membership: membership, Review: review})
}
