package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"
)

//go:embed schema.sql
var schema string

//go:embed schema_002.sql
var integrationSchema string

//go:embed schema_003.sql
var notificationSchema string

//go:embed schema_004.sql
var userManagementSchema string

//go:embed schema_005.sql
var eventSearchSchema string

//go:embed schema_006.sql
var notificationSearchSchema string

//go:embed schema_007.sql
var auditSearchSchema string

//go:embed schema_008.sql
var candidateEventSchema string

//go:embed schema_009.sql
var membershipEvidenceSchema string

//go:embed schema_010.sql
var membershipActivitySchema string

//go:embed schema_011.sql
var membershipReviewSchema string

//go:embed schema_012.sql
var investigationCaseSchema string

var migrations = []string{schema, integrationSchema, notificationSchema, userManagementSchema, eventSearchSchema, notificationSearchSchema, auditSearchSchema, candidateEventSchema, membershipEvidenceSchema, membershipActivitySchema, membershipReviewSchema, investigationCaseSchema}

const productVersion = "1.4.0"

type App struct {
	DB              *pgxpool.Pool
	Origin, WebRoot string
	mu              sync.Mutex
	attempts        map[string]attempt
}
type attempt struct {
	Count int
	Until time.Time
}
type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}
type userKey struct{}

func New(db *pgxpool.Pool, origin, webRoot string) *App {
	return &App{DB: db, Origin: origin, WebRoot: webRoot, attempts: map[string]attempt{}}
}

// Migrate applies immutable numbered migrations atomically and refuses schema drift.
func (a *App) Migrate(ctx context.Context) error {
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(7418320)`); err != nil {
		return err
	}
	var foreign bool
	if err = tx.QueryRow(ctx, `SELECT to_regclass('records') IS NOT NULL OR to_regclass('nexus_product') IS NOT NULL`).Scan(&foreign); err != nil {
		return err
	}
	if foreign {
		return errors.New("refusing to initialize Vigil in a Nexus database")
	}
	if _, err = tx.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	var latest int
	if err = tx.QueryRow(ctx, `SELECT COALESCE(max(version),0) FROM schema_migrations`).Scan(&latest); err != nil {
		return err
	}
	if latest > len(migrations) {
		return fmt.Errorf("database schema %d is newer than this Vigil binary", latest)
	}
	for index, migration := range migrations {
		version := index + 1
		checksum := tokenHash(migration)
		var stored string
		err = tx.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version=$1`, version).Scan(&stored)
		if errors.Is(err, pgx.ErrNoRows) {
			if version <= latest {
				return fmt.Errorf("Vigil migration %d is missing from the ledger", version)
			}
			if _, err = tx.Exec(ctx, migration); err != nil {
				return err
			}
			if _, err = tx.Exec(ctx, `INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)`, version, checksum); err != nil {
				return err
			}
		} else if err != nil {
			return err
		} else if stored != checksum {
			return fmt.Errorf("Vigil migration %d checksum mismatch", version)
		}
	}
	var product string
	if err = tx.QueryRow(ctx, `SELECT name FROM vigil_product WHERE id=true`).Scan(&product); err != nil {
		return err
	}
	if product != "XLab Vigil" {
		return errors.New("unexpected product database")
	}
	return tx.Commit(ctx)
}
func (a *App) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/health", a.health)
	m.HandleFunc("GET /api/status", a.status)
	m.HandleFunc("POST /api/setup", a.setup)
	m.HandleFunc("POST /api/login", a.login)
	m.Handle("GET /api/session", a.auth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { respond(w, 200, map[string]any{"user": currentUser(r)}) })))
	m.Handle("POST /api/logout", a.auth(http.HandlerFunc(a.logout)))
	m.Handle("POST /api/session/password", a.auth(http.HandlerFunc(a.changePassword)))
	a.registerUserManagement(m)
	a.registerCases(m)
	a.registerWatchlists(m)
	a.registerDashboard(m)
	a.registerExports(m)
	m.Handle("GET /api/entities", a.auth(http.HandlerFunc(a.listEntities)))
	m.Handle("POST /api/entities", a.auth(http.HandlerFunc(a.createEntity)))
	m.Handle("PATCH /api/entities/{id}", a.auth(http.HandlerFunc(a.updateEntity)))
	m.Handle("DELETE /api/entities/{id}", a.auth(http.HandlerFunc(a.deleteEntity)))
	m.Handle("GET /api/groups", a.auth(http.HandlerFunc(a.listGroups)))
	m.Handle("POST /api/groups", a.auth(http.HandlerFunc(a.createGroup)))
	m.Handle("PATCH /api/groups/{id}", a.auth(http.HandlerFunc(a.updateGroup)))
	m.Handle("DELETE /api/groups/{id}", a.auth(http.HandlerFunc(a.deleteGroup)))
	m.Handle("GET /api/memberships", a.auth(http.HandlerFunc(a.listMemberships)))
	m.Handle("POST /api/memberships", a.auth(http.HandlerFunc(a.createMembership)))
	m.Handle("GET /api/memberships/{id}", a.auth(http.HandlerFunc(a.getMembership)))
	m.Handle("PATCH /api/memberships/{id}", a.auth(http.HandlerFunc(a.updateMembership)))
	m.Handle("POST /api/memberships/{id}/reviews", a.auth(http.HandlerFunc(a.reviewMembership)))
	m.Handle("GET /api/memberships/{id}/reviews/latest", a.auth(http.HandlerFunc(a.latestMembershipReview)))
	m.Handle("GET /api/memberships/{id}/history", a.auth(http.HandlerFunc(a.membershipHistory)))
	m.Handle("GET /api/memberships/{id}/activity", a.auth(http.HandlerFunc(a.membershipActivity)))
	a.registerMembershipEvidence(m)
	m.Handle("GET /api/sources", a.auth(http.HandlerFunc(a.sources)))
	a.registerIntegrations(m)
	a.registerNotifications(m)
	m.Handle("GET /api/audit", a.auth(http.HandlerFunc(a.auditList)))
	m.Handle("GET /api/audit/page", a.auth(http.HandlerFunc(a.auditPage)))
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "not_found", "İstek bulunamadı.") })
	m.HandleFunc("/", a.static)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		w.Header().Set("Cache-Control", "no-store")
		if r.Host != strings.TrimPrefix(a.Origin, "http://") {
			fail(w, 403, "invalid_host", "Bu adres üzerinden erişim kapalı.")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" {
			if r.Header.Get("Origin") != a.Origin {
				fail(w, 403, "invalid_origin", "İstek kaynağı doğrulanamadı.")
				return
			}
			if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
				fail(w, 415, "invalid_content_type", "JSON içerik gerekiyor.")
				return
			}
		}
		ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
		defer cancel()
		m.ServeHTTP(w, r.WithContext(ctx))
	})
}
func (a *App) static(w http.ResponseWriter, r *http.Request) {
	if r.Method != "GET" && r.Method != "HEAD" {
		http.Error(w, "Method not allowed", 405)
		return
	}
	if strings.HasPrefix(r.URL.Path, "/assets/") || r.URL.Path == "/favicon.svg" {
		p := filepath.Join(a.WebRoot, filepath.FromSlash(r.URL.Path))
		root, _ := filepath.Abs(a.WebRoot)
		abs, _ := filepath.Abs(p)
		if !strings.HasPrefix(abs, root+string(filepath.Separator)) {
			http.NotFound(w, r)
			return
		}
		info, err := os.Stat(abs)
		if err != nil || info.IsDir() {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, abs)
		return
	}
	http.ServeFile(w, r, filepath.Join(a.WebRoot, "index.html"))
}
func respond(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, message string) {
	respond(w, status, map[string]string{"code": code, "message": message})
}
func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128*1024))
	d.DisallowUnknownFields()
	if err := d.Decode(out); err != nil {
		fail(w, 400, "invalid_input", "Alanları ve içerik boyutunu kontrol edin.")
		return false
	}
	if d.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, "invalid_input", "Tek bir JSON kaydı gerekiyor.")
		return false
	}
	return true
}
func UUID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 15) | 64
	b[8] = (b[8] & 63) | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[:4], b[4:6], b[6:8], b[8:10], b[10:])
}
func hashPassword(p string) string {
	salt := make([]byte, 16)
	_, err := rand.Read(salt)
	if err != nil {
		panic(err)
	}
	hash := argon2.IDKey([]byte(p), salt, 2, 19*1024, 1, 32)
	return "argon2id$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(hash)
}
func checkPassword(p, encoded string) bool {
	parts := strings.Split(encoded, "$")
	if len(parts) != 3 || parts[0] != "argon2id" {
		return false
	}
	salt, e1 := base64.RawStdEncoding.DecodeString(parts[1])
	want, e2 := base64.RawStdEncoding.DecodeString(parts[2])
	if e1 != nil || e2 != nil || len(salt) != 16 || len(want) != 32 {
		return false
	}
	got := argon2.IDKey([]byte(p), salt, 2, 19*1024, 1, 32)
	return subtle.ConstantTimeCompare(got, want) == 1
}
func tokenHash(v string) string { sum := sha256.Sum256([]byte(v)); return hex.EncodeToString(sum[:]) }
func (a *App) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie("vigil_session")
		if err != nil || len(c.Value) != 43 {
			fail(w, 401, "unauthorized", "Oturum açmanız gerekiyor.")
			return
		}
		var u User
		err = a.DB.QueryRow(r.Context(), `SELECT u.id,u.username,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE token_hash=$1 AND expires_at>now() AND u.active`, tokenHash(c.Value)).Scan(&u.ID, &u.Username, &u.Name, &u.Role)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, 401, "unauthorized", "Oturumunuz sona erdi.")
			return
		}
		if err != nil {
			fail(w, 503, "unavailable", "Oturum doğrulanamadı. Tekrar deneyin.")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), userKey{}, u)))
	})
}
func currentUser(r *http.Request) User { return r.Context().Value(userKey{}).(User) }
func (a *App) allowedAttempt(r *http.Request) bool {
	return a.allowedAttemptFor(r, "login")
}
func (a *App) allowedAttemptFor(r *http.Request, purpose string) bool {
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	key := purpose + "\x00" + host
	a.mu.Lock()
	defer a.mu.Unlock()
	now := time.Now()
	for k, v := range a.attempts {
		if now.After(v.Until) {
			delete(a.attempts, k)
		}
	}
	v := a.attempts[key]
	if v.Count >= 20 {
		return false
	}
	if v.Count == 0 {
		v.Until = now.Add(15 * time.Minute)
	}
	v.Count++
	a.attempts[key] = v
	return true
}
func (a *App) health(w http.ResponseWriter, r *http.Request) {
	if err := a.DB.Ping(r.Context()); err != nil {
		fail(w, 503, "unavailable", "Veritabanı bağlantısı yok.")
		return
	}
	respond(w, 200, map[string]string{"status": "ok", "product": "XLab Vigil", "version": productVersion, "mode": "local-development"})
}
func (a *App) status(w http.ResponseWriter, r *http.Request) {
	var initialized bool
	if err := a.DB.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users)").Scan(&initialized); err != nil {
		fail(w, 503, "unavailable", "Çalışma alanı bilgisi alınamadı.")
		return
	}
	respond(w, 200, map[string]any{"initialized": initialized, "version": productVersion, "product": "XLab Vigil", "directoryConnected": false})
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Name     string `json:"name"`
}

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{2,63}$`)

func (a *App) setup(w http.ResponseWriter, r *http.Request) {
	if !a.allowedAttempt(r) {
		fail(w, 429, "rate_limited", "Çok fazla deneme. Bir süre sonra tekrar deneyin.")
		return
	}
	var in credentials
	if !decode(w, r, &in) {
		return
	}
	in.Username = strings.ToLower(strings.TrimSpace(in.Username))
	in.Name = strings.TrimSpace(in.Name)
	if !usernamePattern.MatchString(in.Username) || len(in.Password) < 12 || len(in.Password) > 128 || !textLength(in.Name, 2, 100) {
		fail(w, 400, "invalid_input", "Adınızı, kullanıcı adınızı ve en az 12 karakterli parolanızı kontrol edin.")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable", "Kurulum başlatılamadı.")
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(7518320)"); err != nil {
		fail(w, 503, "unavailable", "Kurulum kilidi alınamadı.")
		return
	}
	var exists bool
	if err = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM users)").Scan(&exists); err != nil {
		fail(w, 503, "unavailable", "Kurulum durumu alınamadı.")
		return
	}
	if exists {
		fail(w, 409, "already_initialized", "Çalışma alanı daha önce oluşturuldu. Giriş yapın.")
		return
	}
	u := User{UUID(), in.Username, in.Name, "admin"}
	_, err = tx.Exec(r.Context(), "INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5)", u.ID, u.Username, u.Name, hashPassword(in.Password), u.Role)
	if err == nil {
		err = a.audit(r.Context(), tx, u.ID, "workspace.created", "", "")
	}
	if err != nil {
		fail(w, 503, "unavailable", "Çalışma alanı oluşturulamadı.")
		return
	}
	token, err := createSession(r.Context(), tx, u.ID)
	if err != nil || tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable", "Kurulum tamamlanamadı.")
		return
	}
	setSession(w, token)
	respond(w, 201, map[string]any{"user": u})
}
func createSession(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	_, err := tx.Exec(ctx, "DELETE FROM sessions WHERE expires_at<=now()")
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')", tokenHash(token), userID)
	return token, err
}
func setSession(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{Name: "vigil_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: 8 * 60 * 60})
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	if !a.allowedAttempt(r) {
		fail(w, 429, "rate_limited", "Çok fazla deneme. Bir süre sonra tekrar deneyin.")
		return
	}
	var in credentials
	if !decode(w, r, &in) {
		return
	}
	if len(in.Password) > 128 {
		fail(w, 401, "invalid_credentials", "Kullanıcı adı veya parola hatalı.")
		return
	}
	var u User
	var hash string
	err := a.DB.QueryRow(r.Context(), "SELECT id,username,name,role,password_hash FROM users WHERE username=$1 AND active", strings.ToLower(strings.TrimSpace(in.Username))).Scan(&u.ID, &u.Username, &u.Name, &u.Role, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		fail(w, 503, "unavailable", "Giriş şu anda tamamlanamıyor.")
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		hash = "argon2id$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	}
	valid := checkPassword(in.Password, hash)
	if err != nil || !valid {
		fail(w, 401, "invalid_credentials", "Kullanıcı adı veya parola hatalı.")
		return
	}
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		fail(w, 503, "unavailable", "Giriş tamamlanamadı.")
		return
	}
	defer tx.Rollback(r.Context())
	// Password verification is expensive, so do it before taking the row lock.
	// Recheck the verified hash and active account under that lock before
	// creating a session, in the same order as account/password changes.
	var lockedUser User
	var lockedHash string
	err = tx.QueryRow(r.Context(), `SELECT id,username,name,role,password_hash FROM users WHERE id=$1 AND active FOR UPDATE`, u.ID).Scan(&lockedUser.ID, &lockedUser.Username, &lockedUser.Name, &lockedUser.Role, &lockedHash)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && lockedHash != hash) {
		fail(w, 401, "invalid_credentials", "Kullanıcı adı veya parola hatalı.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	u = lockedUser
	token, err := createSession(r.Context(), tx, u.ID)
	if err == nil {
		err = a.audit(r.Context(), tx, u.ID, "session.login", "", "")
	}
	if err != nil || tx.Commit(r.Context()) != nil {
		fail(w, 503, "unavailable", "Giriş tamamlanamadı.")
		return
	}
	setSession(w, token)
	respond(w, 200, map[string]any{"user": u})
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	c, _ := r.Cookie("vigil_session")
	if _, err := a.DB.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", tokenHash(c.Value)); err != nil {
		fail(w, 503, "unavailable", "Oturum kapatılamadı. Tekrar deneyin.")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "vigil_session", Value: "", Path: "/", HttpOnly: true, SameSite: http.SameSiteStrictMode, MaxAge: -1})
	respond(w, 200, map[string]bool{"ok": true})
}
func (a *App) audit(ctx context.Context, tx pgx.Tx, actor, action, kind, id string) error {
	var recordID any
	if id != "" {
		recordID = id
	}
	_, err := tx.Exec(ctx, "INSERT INTO audit_events(actor_id,action,kind,record_id) VALUES($1,$2,$3,$4)", actor, action, kind, recordID)
	return err
}
func (a *App) auditList(w http.ResponseWriter, r *http.Request) {
	if currentUser(r).Role != "admin" {
		fail(w, 403, "forbidden", "Bu kayıtları görüntüleme yetkiniz yok.")
		return
	}
	rows, err := a.DB.Query(r.Context(), "SELECT a.id,u.name,a.action,a.kind,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 1001")
	if err != nil {
		fail(w, 503, "unavailable", "Denetim kayıtları alınamadı.")
		return
	}
	defer rows.Close()
	type event struct {
		ID        int64     `json:"id"`
		Actor     string    `json:"actor"`
		Action    string    `json:"action"`
		Kind      string    `json:"kind"`
		CreatedAt time.Time `json:"createdAt"`
	}
	out := []event{}
	for rows.Next() {
		var e event
		if err = rows.Scan(&e.ID, &e.Actor, &e.Action, &e.Kind, &e.CreatedAt); err != nil {
			fail(w, 503, "unavailable", "Denetim kayıtları okunamadı.")
			return
		}
		out = append(out, e)
		if len(out) > 1000 {
			collectionLimit(w)
			return
		}
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable", "Denetim kayıtları tamamlanamadı.")
		return
	}
	respond(w, 200, out)
}

type auditPageItem struct {
	ID        int64     `json:"id"`
	Actor     string    `json:"actor"`
	Action    string    `json:"action"`
	Kind      string    `json:"kind"`
	CreatedAt time.Time `json:"createdAt"`
}

type auditPageResult struct {
	Items      []auditPageItem `json:"items"`
	NextCursor string          `json:"nextCursor"`
}

var auditLabelActionPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,39}$`)

// parseAuditLabelActions validates optional exact action codes that extend an
// audit search; they are accepted only together with q.
func parseAuditLabelActions(q url.Values, hasSearch bool) ([]string, bool) {
	labelActions := q["labelAction"]
	if len(labelActions) == 0 {
		return labelActions, true
	}
	if !hasSearch || len(labelActions) > 32 {
		return nil, false
	}
	seen := make(map[string]bool, len(labelActions))
	for _, action := range labelActions {
		if len(action) > 80 || !auditLabelActionPattern.MatchString(action) || seen[action] {
			return nil, false
		}
		seen[action] = true
	}
	return labelActions, true
}

func (a *App) auditPage(w http.ResponseWriter, r *http.Request) {
	if currentUser(r).Role != "admin" {
		fail(w, 403, "forbidden", "Bu kayıtları görüntüleme yetkiniz yok.")
		return
	}

	q, searchPattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	labelActions, ok := parseAuditLabelActions(q, hasSearch)
	if !ok {
		invalid(w, "Arama işlemlerini kontrol edin.")
		return
	}
	limit, cursor, err := parseListPage(q)
	if err != nil {
		invalid(w, err.Error())
		return
	}

	var rows pgx.Rows
	if hasSearch && cursor == 0 {
		rows, err = a.DB.Query(r.Context(), `SELECT a.id,u.name,a.action,a.kind,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE (u.name ILIKE $1 ESCAPE E'\\' OR a.action ILIKE $1 ESCAPE E'\\' OR a.kind ILIKE $1 ESCAPE E'\\' OR a.action = ANY($2::text[])) ORDER BY a.id DESC LIMIT $3`, searchPattern, labelActions, limit+1)
	} else if hasSearch {
		rows, err = a.DB.Query(r.Context(), `SELECT a.id,u.name,a.action,a.kind,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.id<$1 AND (u.name ILIKE $2 ESCAPE E'\\' OR a.action ILIKE $2 ESCAPE E'\\' OR a.kind ILIKE $2 ESCAPE E'\\' OR a.action = ANY($3::text[])) ORDER BY a.id DESC LIMIT $4`, cursor, searchPattern, labelActions, limit+1)
	} else if cursor == 0 {
		rows, err = a.DB.Query(r.Context(), `SELECT a.id,u.name,a.action,a.kind,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT $1`, limit+1)
	} else {
		rows, err = a.DB.Query(r.Context(), `SELECT a.id,u.name,a.action,a.kind,a.created_at FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE a.id<$1 ORDER BY a.id DESC LIMIT $2`, cursor, limit+1)
	}
	if err != nil {
		fail(w, 503, "unavailable", "Denetim kayıtları alınamadı.")
		return
	}
	defer rows.Close()
	out := auditPageResult{Items: []auditPageItem{}}
	var lastID int64
	for rows.Next() {
		var item auditPageItem
		if err := rows.Scan(&item.ID, &item.Actor, &item.Action, &item.Kind, &item.CreatedAt); err != nil {
			fail(w, 503, "unavailable", "Denetim kayıtları okunamadı.")
			return
		}
		if len(out.Items) == limit {
			out.NextCursor = strconv.FormatInt(lastID, 10)
			break
		}
		out.Items = append(out.Items, item)
		lastID = item.ID
	}
	if rows.Err() != nil {
		fail(w, 503, "unavailable", "Denetim kayıtları tamamlanamadı.")
		return
	}
	respond(w, 200, out)
}
