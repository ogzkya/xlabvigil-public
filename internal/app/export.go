package app

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// exportRowLimit is the maximum number of data rows in one CSV export. A
// larger match is rejected instead of being silently truncated. Tests may
// lower it; production code never changes it.
var exportRowLimit = 10000

type exportSpec struct {
	action, kind, slug string
	header             []string
	// read returns at most limit rows; the caller detects overflow with limit=cap+1.
	read func(ctx context.Context, tx pgx.Tx, generatedAt time.Time, limit int) ([][]string, error)
}

func (a *App) registerExports(m *http.ServeMux) {
	m.Handle("GET /api/events/export", getOnly(a.auth(http.HandlerFunc(a.exportEvents))))
	m.Handle("GET /api/cases/export", getOnly(a.auth(http.HandlerFunc(a.exportCases))))
	m.Handle("GET /api/audit/export", getOnly(a.auth(http.HandlerFunc(a.exportAudit))))
	m.Handle("GET /api/entities/export", getOnly(a.auth(http.HandlerFunc(a.exportEntities))))
	m.Handle("GET /api/memberships/export", getOnly(a.auth(http.HandlerFunc(a.exportMemberships))))
}

// The mux also routes HEAD to GET patterns. An export writes an audit row,
// so a HEAD probe must not record a download that never delivered a file.
func getOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			fail(w, http.StatusMethodNotAllowed, "method_not_allowed", "Dışa aktarım yalnız GET isteğiyle alınabilir.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// csvCell neutralizes spreadsheet formula injection by prefixing a single
// quote to any value that a spreadsheet could interpret as a formula.
func csvCell(value string) string {
	if value != "" && strings.ContainsRune("=+-@\t\r", rune(value[0])) {
		return "'" + value
	}
	return value
}

func csvTime(t time.Time) string { return t.UTC().Format(time.RFC3339) }

func csvOptionalTime(t *time.Time) string {
	if t == nil {
		return ""
	}
	return csvTime(*t)
}

func encodeCSV(header []string, rows [][]string) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteRune(0xFEFF) // UTF-8 byte order mark for spreadsheet applications
	writer := csv.NewWriter(&buf)
	writer.Comma = ';'
	writer.UseCRLF = true
	for _, record := range append([][]string{header}, rows...) {
		cells := make([]string, len(record))
		for i, value := range record {
			cells[i] = csvCell(value)
		}
		if err := writer.Write(cells); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// exportQueryKeys rejects unknown or repeated query keys. Keys listed in
// repeatable may occur more than once.
func exportQueryKeys(values url.Values, allowed map[string]bool, repeatable map[string]bool) bool {
	for key, entries := range values {
		if !allowed[key] || (len(entries) != 1 && !repeatable[key]) {
			return false
		}
	}
	return true
}

// collectRows drains rows into string records and always closes them so the
// transaction connection is free for the audit insert.
func collectRows(rows pgx.Rows, scan func(pgx.Rows) ([]string, error)) ([][]string, error) {
	defer rows.Close()
	out := [][]string{}
	for rows.Next() {
		record, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func exportTooLarge(w http.ResponseWriter) {
	fail(w, 422, "export_too_large", fmt.Sprintf("Dışa aktarım en fazla %s satır içerebilir. Filtreleri daraltıp tekrar deneyin; dosya eksik oluşturulmadı.", formatThousands(exportRowLimit)))
}

func formatThousands(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "." + s[i:]
	}
	return s
}

// runExport reads the rows and writes the audit record in one transaction.
// The CSV body is sent only after that transaction commits.
func (a *App) runExport(w http.ResponseWriter, r *http.Request, spec exportSpec) {
	ctx := r.Context()
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(ctx)
	var generatedAt time.Time
	if err := tx.QueryRow(ctx, `SELECT transaction_timestamp()`).Scan(&generatedAt); err != nil {
		dbFailure(w, err)
		return
	}
	generatedAt = generatedAt.UTC()
	limit := exportRowLimit
	rows, err := spec.read(ctx, tx, generatedAt, limit+1)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if len(rows) > limit {
		exportTooLarge(w)
		return
	}
	body, err := encodeCSV(spec.header, rows)
	if err != nil {
		fail(w, 503, "unavailable", "Dışa aktarım dosyası oluşturulamadı.")
		return
	}
	if err := a.audit(ctx, tx, currentUser(r).ID, spec.action, spec.kind, ""); err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		dbFailure(w, err)
		return
	}
	filename := "vigil-" + spec.slug + "-" + generatedAt.Format("20060102T150405Z") + ".csv"
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

var eventExportHeader = []string{"Olay zamanı (UTC)", "Alınma zamanı (UTC)", "Önem", "Kategori", "Başlık", "Özet", "Hesap / özne", "Cihaz", "Kaynak IP", "Bağlantı", "Aktarım kayıt kimliği", "Kimlik durumu", "Varlık kimliği", "Veri kökeni", "Özgün ürün", "Özgün olay kimliği"}

func (a *App) exportEvents(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	q, searchPattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if !exportQueryKeys(q, map[string]bool{"connectionId": true, "severity": true, "q": true}, nil) {
		invalid(w, "Olay dışa aktarımı yalnız birer kez connectionId, severity ve q parametrelerini kabul eder.")
		return
	}
	connectionID := strings.ToLower(q.Get("connectionId"))
	severity := q.Get("severity")
	if (connectionID != "" && !uuidPattern.MatchString(connectionID)) || (severity != "" && !validEventSeverity(severity)) {
		invalid(w, "Kaynak ve önem filtresini kontrol edin.")
		return
	}
	a.runExport(w, r, exportSpec{action: "events.exported", kind: "security_event", slug: "olaylar", header: eventExportHeader,
		read: func(ctx context.Context, tx pgx.Tx, _ time.Time, limit int) ([][]string, error) {
			query := `SELECT e.occurred_at,e.received_at,e.severity,e.category,e.title,e.summary,e.subject,e.device,COALESCE(host(e.source_ip),''),
 COALESCE(c.name,e.connection_id::text),e.external_id,e.identity_state,COALESCE(e.entity_id::text,''),e.provenance,e.origin_product,e.origin_event_id
 FROM security_events e LEFT JOIN source_connections c ON c.id=e.connection_id
 WHERE ($1::uuid IS NULL OR e.connection_id=$1::uuid) AND ($2='' OR e.severity=$2)`
			args := []any{optionalID(connectionID), severity}
			if hasSearch {
				query += ` AND ` + eventSearchExpressionQualified + ` ILIKE $3 ESCAPE E'\\'`
				args = append(args, searchPattern)
			}
			query += ` ORDER BY e.seq DESC LIMIT $` + strconv.Itoa(len(args)+1)
			args = append(args, limit)
			rows, err := tx.Query(ctx, query, args...)
			if err != nil {
				return nil, err
			}
			return collectRows(rows, func(rows pgx.Rows) ([]string, error) {
				var occurredAt, receivedAt time.Time
				record := make([]string, 16)
				err := rows.Scan(&occurredAt, &receivedAt, &record[2], &record[3], &record[4], &record[5], &record[6], &record[7], &record[8], &record[9], &record[10], &record[11], &record[12], &record[13], &record[14], &record[15])
				record[0], record[1] = csvTime(occurredAt), csvTime(receivedAt)
				return record, err
			})
		}})
}

// eventSearchExpressionQualified is eventSearchExpression with columns
// qualified by the security_events alias "e" so it stays unambiguous in joins.
const eventSearchExpressionQualified = `(e.title || ' ' || e.summary || ' ' || e.subject || ' ' || e.device || ' ' || COALESCE(host(e.source_ip), '') || ' ' || e.origin_product || ' ' || e.external_id || ' ' || e.origin_event_id)`

var caseExportHeader = []string{"Başlık", "Durum", "Sorumlu", "Özet", "Oluşturulma zamanı (UTC)", "Oluşturan", "Güncellenme zamanı (UTC)", "Kapanış zamanı (UTC)", "Kapatma gerekçesi", "Sürüm"}

func (a *App) exportCases(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	params, pattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if !exportQueryKeys(params, map[string]bool{"status": true, "q": true}, nil) {
		invalid(w, "Dosya dışa aktarımı yalnız birer kez status ve q parametrelerini kabul eder.")
		return
	}
	status := "all"
	if supplied, ok := params["status"]; ok {
		status = supplied[0]
	}
	if status != "all" && status != "open" && status != "closed" {
		invalid(w, "Dosya durumu all, open veya closed olmalı.")
		return
	}
	a.runExport(w, r, exportSpec{action: "cases.exported", kind: "case", slug: "dosyalar", header: caseExportHeader,
		read: func(ctx context.Context, tx pgx.Tx, _ time.Time, limit int) ([][]string, error) {
			query := `SELECT title,status,responsible,summary,created_at,created_by_name,updated_at,closed_at,closure_reason,version FROM investigation_cases WHERE ($1='all' OR status=$1)`
			args := []any{status}
			if hasSearch {
				query += ` AND ` + caseSearchExpression + ` ILIKE $2 ESCAPE E'\\'`
				args = append(args, pattern)
			}
			query += ` ORDER BY seq DESC LIMIT $` + strconv.Itoa(len(args)+1)
			args = append(args, limit)
			rows, err := tx.Query(ctx, query, args...)
			if err != nil {
				return nil, err
			}
			return collectRows(rows, func(rows pgx.Rows) ([]string, error) {
				var createdAt, updatedAt time.Time
				var closedAt *time.Time
				var version int
				record := make([]string, 10)
				err := rows.Scan(&record[0], &record[1], &record[2], &record[3], &createdAt, &record[5], &updatedAt, &closedAt, &record[8], &version)
				record[4], record[6], record[7], record[9] = csvTime(createdAt), csvTime(updatedAt), csvOptionalTime(closedAt), strconv.Itoa(version)
				return record, err
			})
		}})
}

var auditExportHeader = []string{"İşlem zamanı (UTC)", "İşlemi yapan", "İşlem", "Kayıt türü"}

func (a *App) exportAudit(w http.ResponseWriter, r *http.Request) {
	if currentUser(r).Role != "admin" {
		fail(w, 403, "forbidden", "Bu kayıtları görüntüleme yetkiniz yok.")
		return
	}
	q, searchPattern, hasSearch, err := parseListSearch(r.URL.RawQuery)
	if err != nil {
		invalid(w, err.Error())
		return
	}
	if !exportQueryKeys(q, map[string]bool{"q": true, "labelAction": true}, map[string]bool{"labelAction": true}) {
		invalid(w, "İşlem günlüğü dışa aktarımı yalnız q ve labelAction parametrelerini kabul eder.")
		return
	}
	labelActions, ok := parseAuditLabelActions(q, hasSearch)
	if !ok {
		invalid(w, "Arama işlemlerini kontrol edin.")
		return
	}
	a.runExport(w, r, exportSpec{action: "audit.exported", kind: "audit_event", slug: "islem-gunlugu", header: auditExportHeader,
		read: func(ctx context.Context, tx pgx.Tx, _ time.Time, limit int) ([][]string, error) {
			var rows pgx.Rows
			var err error
			if hasSearch {
				rows, err = tx.Query(ctx, `SELECT a.created_at,u.name,a.action,a.kind FROM audit_events a JOIN users u ON u.id=a.actor_id WHERE (u.name ILIKE $1 ESCAPE E'\\' OR a.action ILIKE $1 ESCAPE E'\\' OR a.kind ILIKE $1 ESCAPE E'\\' OR a.action = ANY($2::text[])) ORDER BY a.id DESC LIMIT $3`, searchPattern, labelActions, limit)
			} else {
				rows, err = tx.Query(ctx, `SELECT a.created_at,u.name,a.action,a.kind FROM audit_events a JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT $1`, limit)
			}
			if err != nil {
				return nil, err
			}
			return collectRows(rows, func(rows pgx.Rows) ([]string, error) {
				var createdAt time.Time
				record := make([]string, 4)
				err := rows.Scan(&createdAt, &record[1], &record[2], &record[3])
				record[0] = csvTime(createdAt)
				return record, err
			})
		}})
}

var entityExportHeader = []string{"Ad", "Tür", "Tanımlayıcı", "Birim", "Açıklama", "Bağlı kişi", "Oluşturulma zamanı (UTC)", "Güncellenme zamanı (UTC)"}

func (a *App) exportEntities(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		invalid(w, "Varlık dışa aktarımı sorgu parametresi kabul etmez.")
		return
	}
	a.runExport(w, r, exportSpec{action: "entities.exported", kind: "entity", slug: "varliklar", header: entityExportHeader,
		read: func(ctx context.Context, tx pgx.Tx, _ time.Time, limit int) ([][]string, error) {
			rows, err := tx.Query(ctx, `SELECT e.name,e.kind,e.identifier,e.department,e.description,COALESCE(p.name,''),e.created_at,e.updated_at
 FROM entities e LEFT JOIN entities p ON p.id=e.person_id ORDER BY e.updated_at DESC,e.id LIMIT $1`, limit)
			if err != nil {
				return nil, err
			}
			return collectRows(rows, func(rows pgx.Rows) ([]string, error) {
				var createdAt, updatedAt time.Time
				record := make([]string, 8)
				err := rows.Scan(&record[0], &record[1], &record[2], &record[3], &record[4], &record[5], &createdAt, &updatedAt)
				record[6], record[7] = csvTime(createdAt), csvTime(updatedAt)
				return record, err
			})
		}})
}

var membershipExportHeader = []string{"Varlık adı", "Varlık türü", "Varlık tanımlayıcısı", "Grup adı", "Grup rengi", "Gerekçe", "Sorumlu", "Başlangıç tarihi", "Bitiş tarihi", "Gözden geçirme tarihi", "Durum", "Bugün etkin", "Oluşturulma zamanı (UTC)", "Güncellenme zamanı (UTC)"}

func (a *App) exportMemberships(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		invalid(w, "Üyelik dışa aktarımı sorgu parametresi kabul etmez.")
		return
	}
	a.runExport(w, r, exportSpec{action: "memberships.exported", kind: "membership", slug: "uyelikler", header: membershipExportHeader,
		read: func(ctx context.Context, tx pgx.Tx, generatedAt time.Time, limit int) ([][]string, error) {
			rows, err := tx.Query(ctx, `SELECT e.name,e.kind,e.identifier,g.name,g.color,m.reason,m.responsible,
 to_char(m.starts_on,'YYYY-MM-DD'),to_char(m.ends_on,'YYYY-MM-DD'),to_char(m.review_on,'YYYY-MM-DD'),m.status,m.created_at,m.updated_at
 FROM memberships m JOIN entities e ON e.id=m.entity_id JOIN risk_groups g ON g.id=m.group_id
 ORDER BY m.updated_at DESC,m.id LIMIT $1`, limit)
			if err != nil {
				return nil, err
			}
			return collectRows(rows, func(rows pgx.Rows) ([]string, error) {
				var createdAt, updatedAt time.Time
				record := make([]string, 14)
				err := rows.Scan(&record[0], &record[1], &record[2], &record[3], &record[4], &record[5], &record[6], &record[7], &record[8], &record[9], &record[10], &createdAt, &updatedAt)
				active := membershipActive(Membership{Status: record[10], StartsOn: record[7], EndsOn: record[8]}, generatedAt)
				record[11] = "hayır"
				if active {
					record[11] = "evet"
				}
				record[12], record[13] = csvTime(createdAt), csvTime(updatedAt)
				return record, err
			})
		}})
}
