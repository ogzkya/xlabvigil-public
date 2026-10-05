package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSetupUsesUnicodeNameLimits(t *testing.T) {
	a := testApp(t)
	input := credentials{Username: "owner", Password: "test-only-passphrase-2026"}
	for _, name := range []string{"İ", strings.Repeat("İ", 101), "Valid\x00Name"} {
		input.Name = name
		expect(t, request(a, http.MethodPost, "/api/setup", input, nil), http.StatusBadRequest)
	}
	input.Name = strings.Repeat("İ", 100)
	w := request(a, http.MethodPost, "/api/setup", input, nil)
	expect(t, w, http.StatusCreated)
	result := decoded[struct{ User User }](t, w)
	if result.User.Name != input.Name || count(t, a, `SELECT count(*) FROM users`) != 1 {
		t.Fatal("setup did not preserve the valid Unicode name")
	}
}

func TestLoginRechecksConcurrentAccountChangesBeforeSessionCreation(t *testing.T) {
	for _, scenario := range []string{"password", "inactive", "profile"} {
		t.Run(scenario, func(t *testing.T) {
			a := testApp(t)
			bootstrap(t, a)
			ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
			defer cancel()
			tx, err := a.DB.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			var userID string
			if err := tx.QueryRow(ctx, `SELECT id FROM users WHERE username='owner' FOR UPDATE`).Scan(&userID); err != nil {
				t.Fatal(err)
			}
			var blockerPID int
			if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&blockerPID); err != nil {
				t.Fatal(err)
			}
			done := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				done <- request(a, http.MethodPost, "/api/login", credentials{Username: "owner", Password: "test-only-passphrase-2026"}, nil)
			}()
			// The login has read and verified the old password once it waits on
			// this transaction's row lock. Commit the account change only then.
			ticker := time.NewTicker(10 * time.Millisecond)
			defer ticker.Stop()
			waiting := false
			for !waiting {
				if err := a.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::integer=ANY(pg_blocking_pids(pid)))`, blockerPID).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				select {
				case w := <-done:
					t.Fatalf("login created a response before rechecking the locked account: %d", w.Code)
				case <-ctx.Done():
					t.Fatal("login did not reach the locked account check")
				case <-ticker.C:
				}
			}
			var sql string
			var args []any
			switch scenario {
			case "password":
				sql, args = `UPDATE users SET password_hash=$2,version=version+1 WHERE id=$1`, []any{userID, hashPassword("changed-only-passphrase-2026")}
			case "inactive":
				sql, args = `UPDATE users SET active=false,version=version+1 WHERE id=$1`, []any{userID}
			case "profile":
				sql, args = `UPDATE users SET name='Current Analyst',role='analyst',version=version+1 WHERE id=$1`, []any{userID}
			}
			if _, err := tx.Exec(ctx, sql, args...); err != nil {
				t.Fatal(err)
			}
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			var w *httptest.ResponseRecorder
			select {
			case w = <-done:
			case <-ctx.Done():
				t.Fatal("login did not complete after the account change")
			}
			if scenario == "profile" {
				expect(t, w, http.StatusOK)
				result := decoded[struct{ User User }](t, w)
				if result.User.Name != "Current Analyst" || result.User.Role != "analyst" || len(w.Result().Cookies()) != 1 {
					t.Fatal("login returned the account profile from before the concurrent change")
				}
				if count(t, a, `SELECT count(*) FROM sessions`) != 2 || count(t, a, `SELECT count(*) FROM audit_events WHERE action='session.login'`) != 1 {
					t.Fatal("successful login did not record its session and audit atomically")
				}
			} else {
				expect(t, w, http.StatusUnauthorized)
				if len(w.Result().Cookies()) != 0 || count(t, a, `SELECT count(*) FROM sessions`) != 1 || count(t, a, `SELECT count(*) FROM audit_events WHERE action='session.login'`) != 0 {
					t.Fatal("rejected login created a session, cookie, or audit record")
				}
			}
		})
	}
}
