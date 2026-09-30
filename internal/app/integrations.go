package app

import (
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Connection is configuration only. No state implies that a provider was contacted.
type Connection struct {
	ID             string     `json:"id"`
	Name           string     `json:"name"`
	Provider       string     `json:"provider"`
	Transport      string     `json:"transport"`
	Endpoint       string     `json:"endpoint"`
	ProductVersion string     `json:"productVersion"`
	Scope          string     `json:"scope"`
	SecretRef      string     `json:"secretRef"`
	Status         string     `json:"status"`
	Version        int        `json:"version"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	LastReceivedAt *time.Time `json:"lastReceivedAt"`
	EventCount     int64      `json:"eventCount"`
}

type connectionInput struct {
	Name            string `json:"name"`
	Provider        string `json:"provider"`
	Transport       string `json:"transport"`
	Endpoint        string `json:"endpoint"`
	ProductVersion  string `json:"productVersion"`
	Scope           string `json:"scope"`
	SecretRef       string `json:"secretRef"`
	Status          string `json:"status"`
	ExpectedVersion int    `json:"expectedVersion"`
}

type eventInput struct {
	ExternalID    string    `json:"externalId"`
	OccurredAt    time.Time `json:"occurredAt"`
	Category      string    `json:"category"`
	Severity      string    `json:"severity"`
	Title         string    `json:"title"`
	Summary       string    `json:"summary"`
	Subject       string    `json:"subject"`
	Device        string    `json:"device"`
	SourceIP      string    `json:"sourceIp"`
	EntityID      string    `json:"entityId"`
	OriginProduct string    `json:"originProduct"`
	OriginEventID string    `json:"originEventId"`
}

type SecurityEvent struct {
	eventInput
	ID            string    `json:"id"`
	ConnectionID  string    `json:"connectionId"`
	ReceivedAt    time.Time `json:"receivedAt"`
	IdentityState string    `json:"identityState"`
	Provenance    string    `json:"provenance"`
}

type eventImportInput struct {
	ConnectionID string       `json:"connectionId"`
	Events       []eventInput `json:"events"`
}

type eventPage struct {
	Items      []SecurityEvent `json:"items"`
	NextCursor string          `json:"nextCursor"`
}

const connectionColumns = `id,name,provider,transport,endpoint,product_version,scope,secret_ref,status,version,created_at,updated_at,last_received_at,event_count`
const eventColumns = `id,connection_id,external_id,occurred_at,received_at,category,severity,title,summary,subject,device,COALESCE(host(source_ip),''),COALESCE(entity_id::text,''),identity_state,provenance,origin_product,origin_event_id,seq`
// Keep this expression identical to the trigram index in schema_005.sql.
const eventSearchExpression = `(title || ' ' || summary || ' ' || subject || ' ' || device || ' ' || COALESCE(host(source_ip), '') || ' ' || origin_product || ' ' || external_id || ' ' || origin_event_id)`

var secretReferencePattern = regexp.MustCompile(`^env:[A-Z_][A-Z0-9_]{0,127}$`)

func (a *App) registerIntegrations(m *http.ServeMux) {
	m.Handle("GET /api/connections", a.auth(http.HandlerFunc(a.listConnections)))
	m.Handle("POST /api/connections", a.auth(http.HandlerFunc(a.createConnection)))
	m.Handle("PATCH /api/connections/{id}", a.auth(http.HandlerFunc(a.updateConnection)))
	m.Handle("GET /api/events", a.auth(http.HandlerFunc(a.listSecurityEvents)))
	m.Handle("GET /api/entities/{id}/candidate-events", a.auth(http.HandlerFunc(a.listCandidateEventsForEntity)))
	m.Handle("POST /api/events/import", a.auth(http.HandlerFunc(a.importSecurityEvents)))
}

func integrationAdmin(w http.ResponseWriter, r *http.Request) bool {
	if currentUser(r).Role != "admin" {
		fail(w, 403, "forbidden", "Kaynak yapılandırma ve olay aktarımı için yönetici yetkisi gerekiyor.")
		return false
	}
	return true
}

func scanConnection(row scanner) (c Connection, err error) {
	err = row.Scan(&c.ID, &c.Name, &c.Provider, &c.Transport, &c.Endpoint, &c.ProductVersion, &c.Scope, &c.SecretRef, &c.Status, &c.Version, &c.CreatedAt, &c.UpdatedAt, &c.LastReceivedAt, &c.EventCount)
	return
}

func validateConnection(in *connectionInput) bool {
	in.Name = strings.TrimSpace(in.Name)
	in.Endpoint = strings.TrimSpace(in.Endpoint)
	in.ProductVersion = strings.TrimSpace(in.ProductVersion)
	in.Scope = strings.TrimSpace(in.Scope)
	in.SecretRef = strings.TrimSpace(in.SecretRef)
	var allowed bool
	switch in.Provider {
	case "ldap_ad":
		allowed = in.Transport == "ldaps"
	case "windows_wef":
		allowed = in.Transport == "wef_https" || in.Transport == "manual_json"
	case "trend_vision_one":
		allowed = in.Transport == "api_https" || in.Transport == "manual_json"
	case "palo_alto", "logsign", "trend_apex_one", "trend_deep_security", "custom":
		allowed = in.Transport == "syslog_tls" || in.Transport == "api_https" || in.Transport == "manual_json"
	}
	if !allowed || !textLength(in.Name, 2, 160) || !textLength(in.Endpoint, 0, 2048) || !textLength(in.ProductVersion, 0, 160) || !textLength(in.Scope, 0, 2000) || (in.Status != "configured" && in.Status != "paused") || (in.SecretRef != "" && !secretReferencePattern.MatchString(in.SecretRef)) {
		return false
	}
	if in.Endpoint == "" {
		return true
	}
	u, err := url.Parse(in.Endpoint)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || strings.Contains(in.Endpoint, "#") || (u.Scheme != "https" && u.Scheme != "ldaps" && u.Scheme != "tls") {
		return false
	}
	switch in.Transport {
	case "ldaps":
		return u.Scheme == "ldaps"
	case "wef_https", "api_https":
		return u.Scheme == "https"
	case "syslog_tls":
		return u.Scheme == "tls"
	}
	return true
}

func (a *App) listConnections(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT `+connectionColumns+` FROM source_connections ORDER BY created_at DESC,id DESC LIMIT 501`)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := []Connection{}
	for rows.Next() {
		c, err := scanConnection(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		out = append(out, c)
	}
	if err := rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	if len(out) > 500 {
		collectionLimit(w)
		return
	}
	respond(w, 200, out)
}

func (a *App) createConnection(w http.ResponseWriter, r *http.Request) {
	if !integrationAdmin(w, r) {
		return
	}
	var in connectionInput
	if !decode(w, r, &in) {
		return
	}
	if in.Status == "" {
		in.Status = "configured"
	}
	if !validateConnection(&in) || in.ExpectedVersion != 0 {
		invalid(w, "Kaynak, aktarım türü ve güvenli adres alanlarını kontrol edin. Kimlik bilgisi yerine env:DEGISKEN referansı kullanın.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	c, err := scanConnection(tx.QueryRow(r.Context(), `INSERT INTO source_connections(id,name,provider,transport,endpoint,product_version,scope,secret_ref,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING `+connectionColumns, UUID(), in.Name, in.Provider, in.Transport, in.Endpoint, in.ProductVersion, in.Scope, in.SecretRef, in.Status))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "connection.created", "connection", c.ID, 201, c)
}

func (a *App) updateConnection(w http.ResponseWriter, r *http.Request) {
	if !integrationAdmin(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in connectionInput
	if !decode(w, r, &in) {
		return
	}
	if !validateConnection(&in) || in.ExpectedVersion < 1 {
		invalid(w, "Kaynak alanlarını ve güncelleme sürümünü kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	previous, err := scanConnection(tx.QueryRow(r.Context(), `SELECT `+connectionColumns+` FROM source_connections WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if previous.Version != in.ExpectedVersion {
		stale(w)
		return
	}
	if previous.EventCount > 0 && (previous.Provider != in.Provider || previous.Transport != in.Transport) {
		fail(w, 409, "source_has_events", "Olay kaydı bulunan kaynağın ürün ve aktarım türü değiştirilemez. Yeni bir kaynak kaydedin.")
		return
	}
	c, err := scanConnection(tx.QueryRow(r.Context(), `UPDATE source_connections SET name=$2,provider=$3,transport=$4,endpoint=$5,product_version=$6,scope=$7,secret_ref=$8,status=$9,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+connectionColumns, id, in.Name, in.Provider, in.Transport, in.Endpoint, in.ProductVersion, in.Scope, in.SecretRef, in.Status))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "connection.updated", "connection", c.ID, 200, c)
}

func validEventSeverity(s string) bool {
	switch s {
	case "info", "low", "medium", "high", "critical":
		return true
	}
	return false
}

func validateEvent(in *eventInput, now time.Time) bool {
	in.ExternalID = strings.TrimSpace(in.ExternalID)
	in.Title = strings.TrimSpace(in.Title)
	in.Summary = strings.TrimSpace(in.Summary)
	in.Subject = strings.TrimSpace(in.Subject)
	in.Device = strings.TrimSpace(in.Device)
	in.SourceIP = strings.TrimSpace(in.SourceIP)
	in.EntityID = strings.ToLower(strings.TrimSpace(in.EntityID))
	in.OriginProduct = strings.TrimSpace(in.OriginProduct)
	in.OriginEventID = strings.TrimSpace(in.OriginEventID)
	in.OccurredAt = in.OccurredAt.UTC().Truncate(time.Microsecond)
	switch in.Category {
	case "authentication", "authorization", "account_lifecycle", "network", "endpoint", "email", "data_access", "other":
	default:
		return false
	}
	if !validEventSeverity(in.Severity) || in.OccurredAt.IsZero() || in.OccurredAt.Year() < 1 || in.OccurredAt.After(now.Add(5*time.Minute)) || !textLength(in.ExternalID, 1, 256) || !textLength(in.Title, 2, 240) || !textLength(in.Summary, 0, 2000) || !textLength(in.Subject, 0, 256) || !textLength(in.Device, 0, 256) || !textLength(in.OriginProduct, 0, 160) || !textLength(in.OriginEventID, 0, 256) || (in.EntityID != "" && !uuidPattern.MatchString(in.EntityID)) {
		return false
	}
	if in.SourceIP != "" {
		ip, err := netip.ParseAddr(in.SourceIP)
		if err != nil || ip.Zone() != "" {
			return false
		}
		in.SourceIP = ip.Unmap().String()
	}
	return true
}

func (a *App) importSecurityEvents(w http.ResponseWriter, r *http.Request) {
	if !integrationAdmin(w, r) {
		return
	}
	var in eventImportInput
	if !decode(w, r, &in) {
		return
	}
	in.ConnectionID = strings.ToLower(strings.TrimSpace(in.ConnectionID))
	if !uuidPattern.MatchString(in.ConnectionID) || len(in.Events) < 1 || len(in.Events) > 100 {
		invalid(w, "Geçerli bir kaynak ve 1–100 normalleştirilmiş olay gerekiyor.")
		return
	}
	now := time.Now()
	for i := range in.Events {
		if !validateEvent(&in.Events[i], now) {
			invalid(w, "Olay alanlarını kontrol edin: zaman, önem, kategori ve IP geçerli olmalı; ham içerik kabul edilmez.")
			return
		}
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	c, err := scanConnection(tx.QueryRow(r.Context(), `SELECT `+connectionColumns+` FROM source_connections WHERE id=$1 FOR UPDATE`, in.ConnectionID))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if c.Status != "configured" || c.Transport != "manual_json" {
		fail(w, 409, "import_unavailable", "Aktarım için duraklatılmamış bir manuel JSON kaynağı seçin.")
		return
	}
	accepted, duplicates := 0, 0
	for _, e := range in.Events {
		normalized, _ := json.Marshal(e)
		hash := tokenHash(string(normalized))
		var previousHash string
		err = tx.QueryRow(r.Context(), `SELECT content_hash FROM security_events WHERE connection_id=$1 AND external_id=$2`, c.ID, e.ExternalID).Scan(&previousHash)
		if err == nil {
			if previousHash != hash {
				fail(w, 409, "event_id_conflict", "Aynı kaynak ve olay kimliği farklı içerikle kullanıldı. Toplu aktarım kaydedilmedi.")
				return
			}
			duplicates++
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			dbFailure(w, err)
			return
		}
		identityState := "unlinked"
		if e.EntityID != "" {
			var exists string
			if err = tx.QueryRow(r.Context(), `SELECT id FROM entities WHERE id=$1 FOR KEY SHARE`, e.EntityID).Scan(&exists); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					invalid(w, "Olayla ilişkilendirilecek varlık bulunamadı. Toplu aktarım kaydedilmedi.")
				} else {
					dbFailure(w, err)
				}
				return
			}
			identityState = "candidate"
		}
		id := UUID()
		_, err = tx.Exec(r.Context(), `INSERT INTO security_events(id,connection_id,external_id,occurred_at,category,severity,title,summary,subject,device,source_ip,entity_id,identity_state,origin_product,origin_event_id,content_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11::text,'')::inet,$12,$13,$14,$15,$16)`, id, c.ID, e.ExternalID, e.OccurredAt, e.Category, e.Severity, e.Title, e.Summary, e.Subject, e.Device, e.SourceIP, optionalID(e.EntityID), identityState, e.OriginProduct, e.OriginEventID, hash)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if e.Severity == "high" || e.Severity == "critical" {
			if err = a.notifySecurityEvent(r.Context(), tx, id, e.Title, e.Severity); err != nil {
				dbFailure(w, err)
				return
			}
		}
		accepted++
	}
	if accepted > 0 {
		if _, err = tx.Exec(r.Context(), `UPDATE source_connections SET event_count=event_count+$2,last_received_at=now() WHERE id=$1`, c.ID, accepted); err != nil {
			dbFailure(w, err)
			return
		}
	}
	a.finish(w, r, tx, "events.imported", "connection", c.ID, 200, map[string]int{"accepted": accepted, "duplicates": duplicates})
}

func (a *App) listSecurityEvents(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	q, searchPattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	connectionID := strings.ToLower(q.Get("connectionId"))
	severity := q.Get("severity")
	if (connectionID != "" && !uuidPattern.MatchString(connectionID)) || (severity != "" && !validEventSeverity(severity)) {
		invalid(w, "Kaynak ve önem filtresini kontrol edin.")
		return
	}
	limit, cursor, err := parseListPage(q)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if cursor == 0 {
		cursor = math.MaxInt64
	}
	query := `SELECT ` + eventColumns + ` FROM security_events WHERE ($1::uuid IS NULL OR connection_id=$1::uuid) AND ($2='' OR severity=$2) AND seq<$3`
	args := []any{optionalID(connectionID), severity, cursor}
	if hasSearch {
		query += ` AND ` + eventSearchExpression + ` ILIKE $4 ESCAPE E'\\'`
		args = append(args, searchPattern)
	}
	query += ` ORDER BY seq DESC LIMIT $` + strconv.Itoa(len(args)+1)
	args = append(args, limit+1)
	rows, err := a.DB.Query(r.Context(), query, args...)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := eventPage{Items: []SecurityEvent{}}
	var lastSeq int64
	for rows.Next() {
		var e SecurityEvent
		var seq int64
		if err = rows.Scan(&e.ID, &e.ConnectionID, &e.ExternalID, &e.OccurredAt, &e.ReceivedAt, &e.Category, &e.Severity, &e.Title, &e.Summary, &e.Subject, &e.Device, &e.SourceIP, &e.EntityID, &e.IdentityState, &e.Provenance, &e.OriginProduct, &e.OriginEventID, &seq); err != nil {
			dbFailure(w, err)
			return
		}
		if len(out.Items) == limit {
			out.NextCursor = strconv.FormatInt(lastSeq, 10)
			break
		}
		out.Items = append(out.Items, e)
		lastSeq = seq
	}
	if err = rows.Err(); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, 200, out)
}

func (a *App) listCandidateEventsForEntity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	entityID, ok := pathID(w, r)
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

	tx, err := a.DB.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var exists int
	if err := tx.QueryRow(r.Context(), `SELECT 1 FROM entities WHERE id=$1`, entityID).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}

	var rows pgx.Rows
	if cursor == 0 {
		rows, err = tx.Query(r.Context(), `SELECT `+eventColumns+` FROM security_events WHERE entity_id=$1 AND identity_state='candidate' ORDER BY seq DESC LIMIT $2`, entityID, limit+1)
	} else {
		rows, err = tx.Query(r.Context(), `SELECT `+eventColumns+` FROM security_events WHERE entity_id=$1 AND identity_state='candidate' AND seq<$2 ORDER BY seq DESC LIMIT $3`, entityID, cursor, limit+1)
	}
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := eventPage{Items: []SecurityEvent{}}
	var lastSeq int64
	for rows.Next() {
		var event SecurityEvent
		var seq int64
		if err := rows.Scan(&event.ID, &event.ConnectionID, &event.ExternalID, &event.OccurredAt, &event.ReceivedAt, &event.Category, &event.Severity, &event.Title, &event.Summary, &event.Subject, &event.Device, &event.SourceIP, &event.EntityID, &event.IdentityState, &event.Provenance, &event.OriginProduct, &event.OriginEventID, &seq); err != nil {
			dbFailure(w, err)
			return
		}
		if len(out.Items) == limit {
			out.NextCursor = strconv.FormatInt(lastSeq, 10)
			break
		}
		out.Items = append(out.Items, event)
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
