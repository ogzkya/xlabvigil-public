package app

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
)

type passwordChangeInput struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (a *App) changePassword(w http.ResponseWriter, r *http.Request) {
	if !a.allowedAttemptFor(r, "password") {
		fail(w, 429, "rate_limited", "Çok fazla parola değiştirme denemesi. Bir süre sonra tekrar deneyin.")
		return
	}
	var in passwordChangeInput
	if !decode(w, r, &in) {
		return
	}
	if len(in.CurrentPassword) < 1 || len(in.CurrentPassword) > 128 || len(in.NewPassword) < 12 || len(in.NewPassword) > 128 {
		invalid(w, "Mevcut parolayı ve 12–128 bayt aralığındaki yeni parolayı kontrol edin.")
		return
	}
	user := currentUser(r)
	var existingHash string
	err := a.DB.QueryRow(r.Context(), `SELECT password_hash FROM users WHERE id=$1 AND active`, user.ID).Scan(&existingHash)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 401, "unauthorized", "Oturumunuz sona erdi.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	if !checkPassword(in.CurrentPassword, existingHash) {
		fail(w, 400, "invalid_current_password", "Mevcut parola doğru değil.")
		return
	}
	if checkPassword(in.NewPassword, existingHash) {
		invalid(w, "Yeni parola mevcut paroladan farklı olmalı.")
		return
	}
	newHash := hashPassword(in.NewPassword)
	cookie, err := r.Cookie("vigil_session")
	if err != nil || len(cookie.Value) != 43 {
		fail(w, 401, "unauthorized", "Oturum açmanız gerekiyor.")
		return
	}
	currentSessionHash := tokenHash(cookie.Value)
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var lockedHash string
	err = tx.QueryRow(r.Context(), `SELECT u.password_hash FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND u.active AND s.token_hash=$2 AND s.expires_at>now() FOR UPDATE OF u`, user.ID, currentSessionHash).Scan(&lockedHash)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 401, "unauthorized", "Oturumunuz sona erdi.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	if lockedHash != existingHash {
		fail(w, 409, "stale_password", "Parola başka bir oturumda değiştirildi. Yeniden deneyin.")
		return
	}
	if _, err = tx.Exec(r.Context(), `UPDATE users SET password_hash=$2,version=version+1,updated_at=now() WHERE id=$1`, user.ID, newHash); err != nil {
		dbFailure(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2`, user.ID, currentSessionHash); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "session.password_changed", "user", user.ID, 200, map[string]bool{"ok": true})
}
