package app

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestMembershipReviewDecisionHistoryAndConflicts(t *testing.T) {
	a := testApp(t)
	admin := bootstrap(t, a)
	viewer := addUser(t, a, "viewer")
	entity := createPerson(t, a, admin)
	group := createRiskGroup(t, a, admin, "yellow")
	createdResponse := request(a, http.MethodPost, "/api/memberships", memberInput(entity, group), admin)
	expect(t, createdResponse, http.StatusCreated)
	created := decoded[Membership](t, createdResponse)
	path := "/api/memberships/" + created.ID + "/reviews"
	latestPath := path + "/latest"
	expect(t, request(a, http.MethodGet, latestPath, nil, viewer), http.StatusForbidden)
	expect(t, request(a, http.MethodGet, "/api/memberships/"+UUID()+"/reviews/latest", nil, admin), http.StatusNotFound)
	initialLatest := request(a, http.MethodGet, latestPath, nil, admin)
	expect(t, initialLatest, http.StatusOK)
	if decoded[latestMembershipReviewResult](t, initialLatest).Review != nil {
		t.Fatal("membership without an explicit review has a latest decision")
	}
	nextReviewOn := time.Now().UTC().AddDate(0, 0, 15).Format(time.DateOnly)
	decision := membershipReviewInput{
		Decision: "continue", Reason: "Reviewed the current candidate context", ExpectedVersion: created.Version,
		NextReviewOn: nextReviewOn,
	}

	expect(t, request(a, http.MethodPost, path, decision, viewer), http.StatusForbidden)
	expect(t, request(a, http.MethodPost, path, membershipReviewInput{
		Decision: "continue", Reason: decision.Reason, ExpectedVersion: created.Version,
		NextReviewOn: created.StartsOn,
	}, admin), http.StatusBadRequest)
	assertMembershipReviewState(t, a, created.ID, created.Version, 0)

	continuedResponse := request(a, http.MethodPost, path, decision, admin)
	expect(t, continuedResponse, http.StatusCreated)
	continued := decoded[membershipReviewResult](t, continuedResponse)
	if continued.Membership.Version != created.Version+1 || continued.Membership.ReviewOn != nextReviewOn ||
		continued.Membership.Status != "active" || continued.Membership.Reason != created.Reason ||
		continued.Review.Decision != "continue" || continued.Review.Reason != decision.Reason ||
		continued.Review.Version != continued.Membership.Version {
		t.Fatalf("continue response changed the wrong fields: %+v", continued)
	}
	assertMembershipReviewState(t, a, created.ID, continued.Membership.Version, 1)
	continuedLatest := request(a, http.MethodGet, latestPath, nil, admin)
	expect(t, continuedLatest, http.StatusOK)
	if review := decoded[latestMembershipReviewResult](t, continuedLatest).Review; review == nil || review.Version != continued.Membership.Version || review.Decision != "continue" {
		t.Fatalf("latest decision after continue = %+v", review)
	}
	expect(t, request(a, http.MethodPost, path, decision, admin), http.StatusConflict)
	assertMembershipReviewState(t, a, created.ID, continued.Membership.Version, 1)

	closeResponse := request(a, http.MethodPost, path, membershipReviewInput{
		Decision: "close", Reason: "The manual review is complete", ExpectedVersion: continued.Membership.Version,
	}, admin)
	expect(t, closeResponse, http.StatusCreated)
	closed := decoded[membershipReviewResult](t, closeResponse)
	if closed.Membership.Status != "closed" || closed.Membership.ReviewOn != nextReviewOn ||
		closed.Membership.Version != continued.Membership.Version+1 || closed.Review.NextReviewOn != "" {
		t.Fatalf("close response changed the wrong fields: %+v", closed)
	}
	assertMembershipReviewState(t, a, created.ID, closed.Membership.Version, 2)
	closedLatest := request(a, http.MethodGet, latestPath, nil, admin)
	expect(t, closedLatest, http.StatusOK)
	if review := decoded[latestMembershipReviewResult](t, closedLatest).Review; review == nil || review.Version != closed.Membership.Version || review.Decision != "close" || review.Reason != "The manual review is complete" {
		t.Fatalf("latest decision after close = %+v", review)
	}
	expect(t, request(a, http.MethodPost, path, membershipReviewInput{
		Decision: "close", Reason: "Repeated manual review decision", ExpectedVersion: closed.Membership.Version,
	}, admin), http.StatusConflict)
	assertMembershipReviewState(t, a, created.ID, closed.Membership.Version, 2)

	activityResponse := request(a, http.MethodGet, "/api/memberships/"+created.ID+"/activity", nil, admin)
	expect(t, activityResponse, http.StatusOK)
	activity := decoded[membershipActivityPage](t, activityResponse)
	if len(activity.Items) != 3 || activity.Items[0].Review == nil ||
		activity.Items[0].Review.Decision != "close" || activity.Items[1].Review == nil ||
		activity.Items[1].Review.Decision != "continue" || activity.Items[2].Review != nil {
		t.Fatalf("review activity is incomplete or out of order: %+v", activity.Items)
	}
}

func assertMembershipReviewState(t *testing.T, a *App, membershipID string, version, reviews int) {
	t.Helper()
	var storedVersion int
	if err := a.DB.QueryRow(context.Background(), `SELECT version FROM memberships WHERE id=$1`, membershipID).Scan(&storedVersion); err != nil {
		t.Fatal(err)
	}
	if storedVersion != version {
		t.Fatalf("membership version %d, want %d", storedVersion, version)
	}
	var reviewCount, historyCount, auditCount int
	if err := a.DB.QueryRow(context.Background(), `SELECT count(*) FROM membership_reviews WHERE membership_id=$1`, membershipID).Scan(&reviewCount); err != nil {
		t.Fatal(err)
	}
	if err := a.DB.QueryRow(context.Background(), `SELECT count(*) FROM membership_history WHERE membership_id=$1`, membershipID).Scan(&historyCount); err != nil {
		t.Fatal(err)
	}
	if err := a.DB.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE record_id=$1 AND action='membership.reviewed'`, membershipID).Scan(&auditCount); err != nil {
		t.Fatal(err)
	}
	if reviewCount != reviews || historyCount != reviews+1 || auditCount != reviews {
		t.Fatalf("review/history/audit counts = %d/%d/%d, want %d/%d/%d", reviewCount, historyCount, auditCount, reviews, reviews+1, reviews)
	}
}
