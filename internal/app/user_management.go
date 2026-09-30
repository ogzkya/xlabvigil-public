package app

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type managedUser struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	Active    bool      `json:"active"`
	Version   int       `json:"version"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type createUserInput struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Role     string `json:"role"`
}

type updateUserInput struct {
	Name            string `json:"name"`
	Role            string `json:"role"`
	Active          *bool  `json:"active"`
	ExpectedVersion int    `json:"expectedVersion"`
}

const managedUserColumns = `id,username,name,role,active,version,created_at,updated_at`
const userMutationLock = int64(7583200)

func (a *App) registerUserManagement(m *http.ServeMux) {
	m.Handle("GET /api/users", a.auth(http.HandlerFunc(a.listUsers)))
	m.Handle("POST /api/users", a.auth(http.HandlerFunc(a.createUser)))
	m.Handle("PATCH /api/users/{id}", a.auth(http.HandlerFunc(a.updateUser)))
	m.Handle("POST /api/users/{id}/sessions/revoke", a.auth(http.HandlerFunc(a.revokeUserSessions)))
}

func userAdmin(w http.ResponseWriter, r *http.Request) bool {
	if currentUser(r).Role != "admin" {
		fail(w, 403, "forbidden", "Kullanıcı yönetimi için yönetici yetkisi gerekiyor.")
		return false
	}
	return true
}

func scanManagedUser(row scanner) (u managedUser, err error) {
	err = row.Scan(&u.ID, &u.Username, &u.Name, &u.Role, &u.Active, &u.Version, &u.CreatedAt, &u.UpdatedAt)
	return
}

func validUserRole(role string) bool {
	switch role {
	case "admin", "analyst", "member", "viewer":
		return true
	default:
		return false
	}
}

func validateNewUser(in *createUserInput) bool {
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	in.Name = strings.TrimSpace(in.Name)
	return usernamePattern.MatchString(in.Username) && textLength(in.Name, 2, 100) && len(in.Password) >= 12 && len(in.Password) <= 128 && validUserRole(in.Role)
}

func (a *App) listUsers(w http.ResponseWriter, r *http.Request) {
	if !userAdmin(w, r) {
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if !confirmAdminSession(w, r, tx) {
		return
	}
	rows, err := tx.Query(r.Context(), `SELECT `+managedUserColumns+` FROM users ORDER BY created_at,id LIMIT 501`)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	users := []managedUser{}
	for rows.Next() {
		u, err := scanManagedUser(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	if len(users) > 500 {
		collectionLimit(w)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, 200, users)
}

func (a *App) createUser(w http.ResponseWriter, r *http.Request) {
	if !userAdmin(w, r) {
		return
	}
	var in createUserInput
	if !decode(w, r, &in) {
		return
	}
	if !validateNewUser(&in) {
		invalid(w, "Kullanıcı adı, görünen ad, rol ve en az 12 karakterli parola alanlarını kontrol edin.")
		return
	}
	passwordHash := hashPassword(in.Password)
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock($1)`, userMutationLock); err != nil {
		dbFailure(w, err)
		return
	}
	if !confirmAdminSession(w, r, tx) {
		return
	}
	u, err := scanManagedUser(tx.QueryRow(r.Context(), `INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING `+managedUserColumns, UUID(), in.Username, in.Name, passwordHash, in.Role))
	if err != nil {
		respondUserWriteError(w, err)
		return
	}
	a.finish(w, r, tx, "user.created", "user", u.ID, 201, u)
}

func (a *App) updateUser(w http.ResponseWriter, r *http.Request) {
	if !userAdmin(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in updateUserInput
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if !textLength(in.Name, 2, 100) || !validUserRole(in.Role) || in.Active == nil || in.ExpectedVersion < 1 {
		invalid(w, "Görünen ad, rol ve güncelleme sürümü alanlarını kontrol edin.")
		return
	}
	actor := currentUser(r)
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock($1)`, userMutationLock); err != nil {
		dbFailure(w, err)
		return
	}
	if !confirmAdminSession(w, r, tx) {
		return
	}
	previous, err := scanManagedUser(tx.QueryRow(r.Context(), `SELECT `+managedUserColumns+` FROM users WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if previous.Version != in.ExpectedVersion {
		stale(w)
		return
	}
	if actor.ID == id && (previous.Role != in.Role || previous.Active != *in.Active) {
		fail(w, 409, "self_change_forbidden", "Kendi rolünüzü veya hesabınızın etkinliğini değiştiremezsiniz.")
		return
	}
	if previous.Role == "admin" && previous.Active && (in.Role != "admin" || !*in.Active) {
		var activeAdmins int
		if err = tx.QueryRow(r.Context(), `SELECT count(*) FROM users WHERE role='admin' AND active`).Scan(&activeAdmins); err != nil {
			dbFailure(w, err)
			return
		}
		if activeAdmins <= 1 {
			fail(w, 409, "last_active_admin", "Son etkin yönetici hesabı kapatılamaz veya başka role alınamaz.")
			return
		}
	}
	updated, err := scanManagedUser(tx.QueryRow(r.Context(), `UPDATE users SET name=$2,role=$3,active=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+managedUserColumns, id, in.Name, in.Role, *in.Active))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if previous.Role != updated.Role || previous.Active != updated.Active {
		if _, err = tx.Exec(r.Context(), `DELETE FROM sessions WHERE user_id=$1`, id); err != nil {
			dbFailure(w, err)
			return
		}
	}
	a.finish(w, r, tx, "user.updated", "user", updated.ID, 200, updated)
}

func (a *App) revokeUserSessions(w http.ResponseWriter, r *http.Request) {
	if !userAdmin(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in struct{}
	if !decode(w, r, &in) {
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if _, err := tx.Exec(r.Context(), `SELECT pg_advisory_xact_lock($1)`, userMutationLock); err != nil {
		dbFailure(w, err)
		return
	}
	if !confirmAdminSession(w, r, tx) {
		return
	}
	if currentUser(r).ID == id {
		fail(w, 409, "self_revoke_forbidden", "Kendi oturumunuzu bu ekrandan kapatamazsınız; çıkış yapın.")
		return
	}
	var target string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM users WHERE id=$1 FOR UPDATE`, id).Scan(&target); err != nil {
		dbFailure(w, err)
		return
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM sessions WHERE user_id=$1 AND expires_at>now()`, target)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "user.sessions_revoked", "user", target, http.StatusOK, map[string]int64{"revoked": tag.RowsAffected()})
}

func confirmAdminSession(w http.ResponseWriter, r *http.Request, tx pgx.Tx) bool {
	cookie, err := r.Cookie("vigil_session")
	if err != nil || len(cookie.Value) != 43 {
		fail(w, 401, "unauthorized", "Oturum açmanız gerekiyor.")
		return false
	}
	var role string
	err = tx.QueryRow(r.Context(), `SELECT u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.token_hash=$2 AND s.expires_at>now() AND u.active FOR UPDATE OF u`, currentUser(r).ID, tokenHash(cookie.Value)).Scan(&role)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 401, "unauthorized", "Oturumunuz sona erdi.")
		return false
	}
	if err != nil {
		dbFailure(w, err)
		return false
	}
	if role != "admin" {
		fail(w, 403, "forbidden", "Kullanıcı yönetimi için yönetici yetkisi gerekiyor.")
		return false
	}
	return true
}

func respondUserWriteError(w http.ResponseWriter, err error) {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		fail(w, 409, "duplicate_username", "Bu kullanıcı adı zaten kullanılıyor.")
		return
	}
	dbFailure(w, err)
}
