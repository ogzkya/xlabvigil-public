package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/mail"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Notification struct {
	ID        string     `json:"id"`
	Title     string     `json:"title"`
	Body      string     `json:"body"`
	Severity  string     `json:"severity"`
	EventID   string     `json:"eventId"`
	CreatedAt time.Time  `json:"createdAt"`
	ReadAt    *time.Time `json:"readAt"`
}

// Keep this expression identical to the trigram index in schema_006.sql.
const notificationSearchExpression = `(title || ' ' || body)`

type NotificationSettings struct {
	Provider    string `json:"provider"`
	Host        string `json:"host"`
	Port        int    `json:"port"`
	FromAddress string `json:"fromAddress"`
	Recipient   string `json:"recipient"`
	SecretRef   string `json:"secretRef"`
	Version     int    `json:"version"`
	Status      string `json:"status"`
}

type notificationSettingsInput struct {
	Provider        string `json:"provider"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	FromAddress     string `json:"fromAddress"`
	Recipient       string `json:"recipient"`
	SecretRef       string `json:"secretRef"`
	ExpectedVersion int    `json:"expectedVersion"`
}

func (a *App) registerNotifications(m *http.ServeMux) {
	m.Handle("GET /api/notifications", a.auth(http.HandlerFunc(a.listNotifications)))
	m.Handle("POST /api/notifications/{id}/read", a.auth(http.HandlerFunc(a.readNotification)))
	m.Handle("GET /api/notification-settings", a.auth(http.HandlerFunc(a.getNotificationSettings)))
	m.Handle("PUT /api/notification-settings", a.auth(http.HandlerFunc(a.putNotificationSettings)))
}

// Called in the import transaction: inbox creation and event acceptance are atomic.
// This does not deliver mail or assert that the event subject poses a threat.
func (a *App) notifySecurityEvent(ctx context.Context, tx pgx.Tx, eventID, title, severity string) error {
	if severity != "high" && severity != "critical" {
		return nil
	}
	_, err := tx.Exec(ctx, `INSERT INTO notifications(id,event_id,title,body,severity) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING`, UUID(), eventID, title,
		"Elle içe aktarılan güvenlik olayı inceleme bekliyor. Kaynak kanıtını ve aday kimlik ilişkisini doğrulayın.", severity)
	return err
}

func notificationAdmin(w http.ResponseWriter, r *http.Request) bool {
	if currentUser(r).Role != "admin" {
		fail(w, http.StatusForbidden, "forbidden", "Bildirim kanalını yalnızca yönetici yapılandırabilir.")
		return false
	}
	return true
}

func (a *App) listNotifications(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	q, searchPattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	unreadOnly := false
	if values, present := q["unread"]; present {
		if len(values) != 1 || values[0] != "true" {
			invalid(w, "Okunmamış filtresi geçersiz.")
			return
		}
		unreadOnly = true
	}
	limit, cursor, err := parseListPage(q)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var unread int
	userID := currentUser(r).ID
	if err := tx.QueryRow(r.Context(), `SELECT count(*) FROM notifications n WHERE NOT EXISTS(SELECT 1 FROM notification_reads r WHERE r.notification_id=n.id AND r.user_id=$1)`, userID).Scan(&unread); err != nil {
		dbFailure(w, err)
		return
	}
	query := `SELECT n.id,n.title,n.body,n.severity,n.event_id,n.created_at,r.read_at,n.seq FROM notifications n LEFT JOIN notification_reads r ON r.notification_id=n.id AND r.user_id=$1 WHERE true`
	args := []any{userID}
	if cursor != 0 {
		query += ` AND n.seq<$2`
		args = append(args, cursor)
	}
	if unreadOnly {
		query += ` AND r.notification_id IS NULL`
	}
	if hasSearch {
		query += ` AND ` + notificationSearchExpression + ` ILIKE $` + strconv.Itoa(len(args)+1) + ` ESCAPE E'\\'`
		args = append(args, searchPattern)
	}
	query += ` ORDER BY n.seq DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, limit+1)
	rows, err := tx.Query(r.Context(), query, args...)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	items := []Notification{}
	next, last := "", int64(0)
	for rows.Next() {
		var item Notification
		var seq int64
		if err := rows.Scan(&item.ID, &item.Title, &item.Body, &item.Severity, &item.EventID, &item.CreatedAt, &item.ReadAt, &seq); err != nil {
			dbFailure(w, err)
			return
		}
		if len(items) == limit {
			next = strconv.FormatInt(last, 10)
			break
		}
		items = append(items, item)
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
	respond(w, http.StatusOK, map[string]any{"items": items, "nextCursor": next, "unreadCount": unread})
}

func (a *App) readNotification(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var input struct{}
	if !decode(w, r, &input) {
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var exists bool
	if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM notifications WHERE id=$1)`, id).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	if !exists {
		fail(w, http.StatusNotFound, "not_found", "Bildirim bulunamadı.")
		return
	}
	var readAt time.Time
	err := tx.QueryRow(r.Context(), `INSERT INTO notification_reads(notification_id,user_id) VALUES($1,$2) ON CONFLICT(notification_id,user_id) DO UPDATE SET read_at=notification_reads.read_at RETURNING read_at`, id, currentUser(r).ID).Scan(&readAt)
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "notification.read", "notification", id, http.StatusOK, map[string]any{"id": id, "readAt": readAt})
}

func scanNotificationSettings(row scanner) (NotificationSettings, error) {
	value := NotificationSettings{Status: "delivery_disabled"}
	err := row.Scan(&value.Provider, &value.Host, &value.Port, &value.FromAddress, &value.Recipient, &value.SecretRef, &value.Version)
	return value, err
}

func (a *App) getNotificationSettings(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	value, err := scanNotificationSettings(a.DB.QueryRow(r.Context(), `SELECT provider,host,port,from_address,recipient,secret_ref,version FROM notification_settings WHERE id=true`))
	if err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, value)
}

var notificationSecretPattern = regexp.MustCompile(`^env:[A-Z][A-Z0-9_]{2,95}$`)
var notificationHostLabel = regexp.MustCompile(`^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$`)

func validMailAddress(value string) bool {
	if !textLength(value, 3, 254) || strings.ContainsAny(value, "\r\n") {
		return false
	}
	parsed, err := mail.ParseAddress(value)
	return err == nil && parsed.Address == value && parsed.Name == "" && strings.Contains(value, "@")
}

func validNotificationHost(value string) bool {
	if !textLength(value, 1, 253) {
		return false
	}
	if net.ParseIP(value) != nil {
		return true
	}
	for _, part := range strings.Split(value, ".") {
		if !notificationHostLabel.MatchString(part) {
			return false
		}
	}
	return true
}

func validateNotificationSettings(in *notificationSettingsInput) bool {
	in.Host = strings.TrimSpace(in.Host)
	in.FromAddress = strings.TrimSpace(in.FromAddress)
	in.Recipient = strings.TrimSpace(in.Recipient)
	in.SecretRef = strings.TrimSpace(in.SecretRef)
	if in.ExpectedVersion < 1 {
		return false
	}
	if in.Provider == "none" {
		return in.Host == "" && in.Port == 0 && in.FromAddress == "" && in.Recipient == "" && in.SecretRef == ""
	}
	if !validMailAddress(in.FromAddress) || !validMailAddress(in.Recipient) || !notificationSecretPattern.MatchString(in.SecretRef) {
		return false
	}
	if in.Provider == "smtp" {
		return validNotificationHost(in.Host) && (in.Port == 465 || in.Port == 587)
	}
	return in.Provider == "graph" && in.Host == "" && in.Port == 0
}

func (a *App) putNotificationSettings(w http.ResponseWriter, r *http.Request) {
	if !notificationAdmin(w, r) {
		return
	}
	var input notificationSettingsInput
	if !decode(w, r, &input) {
		return
	}
	if !validateNotificationSettings(&input) {
		invalid(w, "Kanal, e-posta adresleri, güvenli SMTP portu ve env:NAME sır referansını kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	value, err := scanNotificationSettings(tx.QueryRow(r.Context(), `UPDATE notification_settings SET provider=$1,host=$2,port=$3,from_address=$4,recipient=$5,secret_ref=$6,version=version+1,updated_at=now() WHERE id=true AND version=$7 RETURNING provider,host,port,from_address,recipient,secret_ref,version`, input.Provider, input.Host, input.Port, input.FromAddress, input.Recipient, input.SecretRef, input.ExpectedVersion))
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusConflict, "stale_write", "Kanal ayarı değişti. Yenileyip tekrar deneyin.")
		return
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "notification_settings.updated", "notification_settings", "", http.StatusOK, value)
}
