package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type Entity struct {
	ID            string    `json:"id"`
	Kind          string    `json:"kind"`
	Name          string    `json:"name"`
	Department    string    `json:"department"`
	Description   string    `json:"description"`
	Identifier    string    `json:"identifier"`
	PersonID      string    `json:"personId"`
	IdentityState string    `json:"identityState"`
	Version       int       `json:"version"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}
type entityInput struct {
	Kind            string `json:"kind"`
	Name            string `json:"name"`
	Department      string `json:"department"`
	Description     string `json:"description"`
	Identifier      string `json:"identifier"`
	PersonID        string `json:"personId"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type Group struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Color       string    `json:"color"`
	Description string    `json:"description"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type groupInput struct {
	Name            string `json:"name"`
	Color           string `json:"color"`
	Description     string `json:"description"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type Membership struct {
	ID          string    `json:"id"`
	EntityID    string    `json:"entityId"`
	GroupID     string    `json:"groupId"`
	Reason      string    `json:"reason"`
	Responsible string    `json:"responsible"`
	StartsOn    string    `json:"startsOn"`
	EndsOn      string    `json:"endsOn"`
	ReviewOn    string    `json:"reviewOn"`
	Status      string    `json:"status"`
	Active      bool      `json:"active"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}
type membershipInput struct {
	EntityID        string `json:"entityId"`
	GroupID         string `json:"groupId"`
	Reason          string `json:"reason"`
	Responsible     string `json:"responsible"`
	StartsOn        string `json:"startsOn"`
	EndsOn          string `json:"endsOn"`
	ReviewOn        string `json:"reviewOn"`
	Status          string `json:"status"`
	ExpectedVersion int    `json:"expectedVersion"`
}
type deleteInput struct {
	ExpectedVersion int `json:"expectedVersion"`
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

const entityColumns = `id,kind,name,department,description,identifier,COALESCE(person_id::text,''),identity_state,version,created_at,updated_at`
const groupColumns = `id,name,color,description,version,created_at,updated_at`
const membershipColumns = `id,entity_id,group_id,reason,responsible,to_char(starts_on,'YYYY-MM-DD'),to_char(ends_on,'YYYY-MM-DD'),to_char(review_on,'YYYY-MM-DD'),status,version,created_at,updated_at`

type scanner interface{ Scan(...any) error }

func scanEntity(row scanner) (e Entity, err error) {
	err = row.Scan(&e.ID, &e.Kind, &e.Name, &e.Department, &e.Description, &e.Identifier, &e.PersonID, &e.IdentityState, &e.Version, &e.CreatedAt, &e.UpdatedAt)
	return
}
func scanGroup(row scanner) (g Group, err error) {
	err = row.Scan(&g.ID, &g.Name, &g.Color, &g.Description, &g.Version, &g.CreatedAt, &g.UpdatedAt)
	return
}
func scanMembership(row scanner) (m Membership, err error) {
	err = row.Scan(&m.ID, &m.EntityID, &m.GroupID, &m.Reason, &m.Responsible, &m.StartsOn, &m.EndsOn, &m.ReviewOn, &m.Status, &m.Version, &m.CreatedAt, &m.UpdatedAt)
	m.Active = membershipActive(m, time.Now())
	return
}
func membershipActive(m Membership, now time.Time) bool {
	today := now.UTC().Format(time.DateOnly)
	return m.Status == "active" && m.StartsOn <= today && today <= m.EndsOn
}
func textLength(s string, min, max int) bool {
	n := utf8.RuneCountInString(s)
	return n >= min && n <= max && !strings.ContainsRune(s, '\x00')
}
func riskAccess(w http.ResponseWriter, r *http.Request) bool {
	role := currentUser(r).Role
	if role != "admin" && role != "analyst" {
		fail(w, 403, "forbidden", "Bu kayıtlara erişim yetkiniz yok.")
		return false
	}
	return true
}
func collectionLimit(w http.ResponseWriter) {
	fail(w, 422, "collection_limit", "Kayıt sayısı bu sürümün görüntüleme sınırını aşıyor. Veri eksik gösterilmedi.")
}
func invalid(w http.ResponseWriter, message string) { fail(w, 400, "invalid_input", message) }
func stale(w http.ResponseWriter) {
	fail(w, 409, "stale_write", "Kayıt başka bir işlemle güncellendi. Listeyi yenileyin.")
}
func dbFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found", "Kayıt bulunamadı.")
		return
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) {
		switch pg.Code {
		case "23505":
			fail(w, 409, "duplicate_membership", "Bu varlık için grupta kapatılmamış bir üyelik zaten var.")
			return
		case "23503", "23001":
			fail(w, 409, "reference_conflict", "İlişkili kayıtlar nedeniyle işlem tamamlanamadı. Listeyi yenileyin.")
			return
		case "40001", "40P01":
			fail(w, 409, "concurrent_write", "Eşzamanlı bir işlemle çakışma oldu. Listeyi yenileyip tekrar deneyin.")
			return
		}
	}
	fail(w, 503, "unavailable", "İşlem tamamlanamadı. Tekrar deneyin.")
}
func pathID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !uuidPattern.MatchString(id) {
		invalid(w, "Kayıt kimliği geçersiz.")
		return "", false
	}
	return strings.ToLower(id), true
}
func optionalID(id string) any {
	if id == "" {
		return nil
	}
	return id
}
func (a *App) begin(w http.ResponseWriter, r *http.Request) (pgx.Tx, bool) {
	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		dbFailure(w, err)
		return nil, false
	}
	return tx, true
}
func (a *App) finish(w http.ResponseWriter, r *http.Request, tx pgx.Tx, action, kind, id string, status int, result any) {
	if err := a.audit(r.Context(), tx, currentUser(r).ID, action, kind, id); err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, status, result)
}
func validateEntity(in *entityInput) bool {
	in.Name = strings.TrimSpace(in.Name)
	in.Department = strings.TrimSpace(in.Department)
	in.Description = strings.TrimSpace(in.Description)
	in.Identifier = strings.TrimSpace(in.Identifier)
	in.PersonID = strings.ToLower(strings.TrimSpace(in.PersonID))
	switch in.Kind {
	case "person", "account", "device", "service", "application":
	default:
		return false
	}
	return textLength(in.Name, 2, 160) && textLength(in.Department, 0, 160) && textLength(in.Description, 0, 4000) && textLength(in.Identifier, 0, 512) && (in.PersonID == "" || ((in.Kind == "account" || in.Kind == "device") && uuidPattern.MatchString(in.PersonID)))
}
func validateGroup(in *groupInput) bool {
	in.Name = strings.TrimSpace(in.Name)
	in.Description = strings.TrimSpace(in.Description)
	switch in.Color {
	case "yellow", "orange", "red", "slate":
	default:
		return false
	}
	return textLength(in.Name, 2, 120) && textLength(in.Description, 0, 4000)
}
func validateMembership(in *membershipInput, now time.Time) bool {
	in.EntityID = strings.ToLower(strings.TrimSpace(in.EntityID))
	in.GroupID = strings.ToLower(strings.TrimSpace(in.GroupID))
	in.Reason = strings.TrimSpace(in.Reason)
	in.Responsible = strings.TrimSpace(in.Responsible)
	if !uuidPattern.MatchString(in.EntityID) || !uuidPattern.MatchString(in.GroupID) || !textLength(in.Reason, 10, 4000) || !textLength(in.Responsible, 2, 160) || (in.Status != "active" && in.Status != "closed") {
		return false
	}
	start, e1 := time.Parse(time.DateOnly, in.StartsOn)
	end, e2 := time.Parse(time.DateOnly, in.EndsOn)
	review, e3 := time.Parse(time.DateOnly, in.ReviewOn)
	if e1 != nil || e2 != nil || e3 != nil || start.Year() < 1 || end.Year() < 1 || review.Year() < 1 || start.After(review) || review.After(end) || end.Sub(start) > 366*24*time.Hour {
		return false
	}
	return in.Status == "closed" || in.EndsOn >= now.UTC().Format(time.DateOnly)
}
func lockPerson(ctx context.Context, tx pgx.Tx, id string) error {
	if id == "" {
		return nil
	}
	var kind string
	if err := tx.QueryRow(ctx, `SELECT kind FROM entities WHERE id=$1 FOR KEY SHARE`, id).Scan(&kind); err != nil {
		return err
	}
	if kind != "person" {
		return errNotPerson
	}
	return nil
}

var errNotPerson = errors.New("parent must be person")

func personFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, errNotPerson) || errors.Is(err, pgx.ErrNoRows) {
		invalid(w, "Bağlanacak kişi bulunamadı veya kayıt personel türünde değil.")
		return
	}
	dbFailure(w, err)
}

func (a *App) listEntities(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT `+entityColumns+` FROM entities ORDER BY updated_at DESC,id LIMIT 1001`)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := []Entity{}
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		out = append(out, e)
		if len(out) > 1000 {
			collectionLimit(w)
			return
		}
	}
	if rows.Err() != nil {
		dbFailure(w, rows.Err())
		return
	}
	respond(w, 200, out)
}
func (a *App) createEntity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	var in entityInput
	if !decode(w, r, &in) {
		return
	}
	if !validateEntity(&in) || in.ExpectedVersion != 0 {
		invalid(w, "Varlık türünü, adını ve kişi bağlantısını kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	if err := lockPerson(r.Context(), tx, in.PersonID); err != nil {
		personFailure(w, err)
		return
	}
	e, err := scanEntity(tx.QueryRow(r.Context(), `INSERT INTO entities(id,kind,name,department,description,identifier,person_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING `+entityColumns, UUID(), in.Kind, in.Name, in.Department, in.Description, in.Identifier, optionalID(in.PersonID)))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "entity.created", "entity", e.ID, 201, e)
}
func (a *App) updateEntity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in entityInput
	if !decode(w, r, &in) {
		return
	}
	if !validateEntity(&in) || in.ExpectedVersion < 1 || in.PersonID == id {
		invalid(w, "Varlık bilgilerini ve sürümünü kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	old, err := scanEntity(tx.QueryRow(r.Context(), `SELECT `+entityColumns+` FROM entities WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if old.Version != in.ExpectedVersion {
		stale(w)
		return
	}
	if old.Kind != in.Kind {
		var used bool
		err = tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM entities WHERE person_id=$1) OR EXISTS(SELECT 1 FROM memberships WHERE entity_id=$1)`, id).Scan(&used)
		if err != nil {
			dbFailure(w, err)
			return
		}
		if used {
			fail(w, 409, "reference_conflict", "İlişkili kayıtları bulunan varlığın türü değiştirilemez.")
			return
		}
	}
	if err = lockPerson(r.Context(), tx, in.PersonID); err != nil {
		personFailure(w, err)
		return
	}
	e, err := scanEntity(tx.QueryRow(r.Context(), `UPDATE entities SET kind=$2,name=$3,department=$4,description=$5,identifier=$6,person_id=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+entityColumns, id, in.Kind, in.Name, in.Department, in.Description, in.Identifier, optionalID(in.PersonID)))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "entity.updated", "entity", id, 200, e)
}
func (a *App) deleteEntity(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in deleteInput
	if !decode(w, r, &in) {
		return
	}
	if in.ExpectedVersion < 1 {
		invalid(w, "Kayıt sürümü gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var version int
	err := tx.QueryRow(r.Context(), `SELECT version FROM entities WHERE id=$1 FOR UPDATE`, id).Scan(&version)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if version != in.ExpectedVersion {
		stale(w)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM entities WHERE id=$1`, id); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "entity.deleted", "entity", id, 200, map[string]bool{"ok": true})
}
func (a *App) listGroups(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT `+groupColumns+` FROM risk_groups ORDER BY updated_at DESC,id LIMIT 1001`)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := []Group{}
	for rows.Next() {
		g, err := scanGroup(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		out = append(out, g)
		if len(out) > 1000 {
			collectionLimit(w)
			return
		}
	}
	if rows.Err() != nil {
		dbFailure(w, rows.Err())
		return
	}
	respond(w, 200, out)
}
func (a *App) createGroup(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	var in groupInput
	if !decode(w, r, &in) {
		return
	}
	if !validateGroup(&in) || in.ExpectedVersion != 0 {
		invalid(w, "Grup adını, rengini ve açıklamasını kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	g, err := scanGroup(tx.QueryRow(r.Context(), `INSERT INTO risk_groups(id,name,color,description) VALUES($1,$2,$3,$4) RETURNING `+groupColumns, UUID(), in.Name, in.Color, in.Description))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "group.created", "group", g.ID, 201, g)
}
func (a *App) updateGroup(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in groupInput
	if !decode(w, r, &in) {
		return
	}
	if !validateGroup(&in) || in.ExpectedVersion < 1 {
		invalid(w, "Grup bilgilerini ve sürümünü kontrol edin.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var version int
	err := tx.QueryRow(r.Context(), `SELECT version FROM risk_groups WHERE id=$1 FOR UPDATE`, id).Scan(&version)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if version != in.ExpectedVersion {
		stale(w)
		return
	}
	g, err := scanGroup(tx.QueryRow(r.Context(), `UPDATE risk_groups SET name=$2,color=$3,description=$4,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+groupColumns, id, in.Name, in.Color, in.Description))
	if err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "group.updated", "group", id, 200, g)
}
func (a *App) deleteGroup(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in deleteInput
	if !decode(w, r, &in) {
		return
	}
	if in.ExpectedVersion < 1 {
		invalid(w, "Kayıt sürümü gerekiyor.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	var version int
	err := tx.QueryRow(r.Context(), `SELECT version FROM risk_groups WHERE id=$1 FOR UPDATE`, id).Scan(&version)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if version != in.ExpectedVersion {
		stale(w)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM risk_groups WHERE id=$1`, id); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "group.deleted", "group", id, 200, map[string]bool{"ok": true})
}
func (a *App) listMemberships(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT `+membershipColumns+` FROM memberships ORDER BY updated_at DESC,id LIMIT 1001`)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	out := []Membership{}
	for rows.Next() {
		m, err := scanMembership(rows)
		if err != nil {
			dbFailure(w, err)
			return
		}
		out = append(out, m)
		if len(out) > 1000 {
			collectionLimit(w)
			return
		}
	}
	if rows.Err() != nil {
		dbFailure(w, rows.Err())
		return
	}
	respond(w, 200, out)
}
func appendHistory(ctx context.Context, tx pgx.Tx, actor, action string, m Membership) error {
	data, err := json.Marshal(m)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO membership_history(membership_id,version,action,actor_id,data) VALUES($1,$2,$3,$4,$5)`, m.ID, m.Version, action, actor, data)
	return err
}
func (a *App) createMembership(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	var in membershipInput
	if !decode(w, r, &in) {
		return
	}
	if !validateMembership(&in, time.Now()) || in.ExpectedVersion != 0 {
		invalid(w, "Üyelik gerekçesi en az 10 karakter, sorumlu ve geçerli tarihler gerekiyor. Süre en fazla 366 gün olabilir.")
		return
	}
	tx, ok := a.begin(w, r)
	if !ok {
		return
	}
	defer tx.Rollback(r.Context())
	// Hold parents until commit so kind changes and deletion cannot race membership creation.
	var locked string
	if err := tx.QueryRow(r.Context(), `SELECT id FROM entities WHERE id=$1 FOR KEY SHARE`, in.EntityID).Scan(&locked); err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.QueryRow(r.Context(), `SELECT id FROM risk_groups WHERE id=$1 FOR KEY SHARE`, in.GroupID).Scan(&locked); err != nil {
		dbFailure(w, err)
		return
	}
	m, err := scanMembership(tx.QueryRow(r.Context(), `INSERT INTO memberships(id,entity_id,group_id,reason,responsible,starts_on,ends_on,review_on,status) VALUES($1,$2,$3,$4,$5,$6::text::date,$7::text::date,$8::text::date,$9) RETURNING `+membershipColumns, UUID(), in.EntityID, in.GroupID, in.Reason, in.Responsible, in.StartsOn, in.EndsOn, in.ReviewOn, in.Status))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if err = appendHistory(r.Context(), tx, currentUser(r).ID, "created", m); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "membership.created", "membership", m.ID, 201, m)
}
func (a *App) updateMembership(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var in membershipInput
	if !decode(w, r, &in) {
		return
	}
	if !validateMembership(&in, time.Now()) || in.ExpectedVersion < 1 {
		invalid(w, "Üyelik bilgilerini, tarihleri ve sürümünü kontrol edin.")
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
	if in.EntityID != old.EntityID || in.GroupID != old.GroupID {
		invalid(w, "Üyeliğin varlık ve grup bağlantısı değiştirilemez.")
		return
	}
	m, err := scanMembership(tx.QueryRow(r.Context(), `UPDATE memberships SET reason=$2,responsible=$3,starts_on=$4::text::date,ends_on=$5::text::date,review_on=$6::text::date,status=$7,version=version+1,updated_at=now() WHERE id=$1 RETURNING `+membershipColumns, id, in.Reason, in.Responsible, in.StartsOn, in.EndsOn, in.ReviewOn, in.Status))
	if err != nil {
		dbFailure(w, err)
		return
	}
	if err = appendHistory(r.Context(), tx, currentUser(r).ID, "updated", m); err != nil {
		dbFailure(w, err)
		return
	}
	a.finish(w, r, tx, "membership.updated", "membership", id, 200, m)
}
func (a *App) membershipHistory(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	id, ok := pathID(w, r)
	if !ok {
		return
	}
	var exists bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM memberships WHERE id=$1)`, id).Scan(&exists); err != nil {
		dbFailure(w, err)
		return
	}
	if !exists {
		dbFailure(w, pgx.ErrNoRows)
		return
	}
	rows, err := a.DB.Query(r.Context(), `SELECT h.version,h.action,u.name,h.created_at,h.data FROM membership_history h JOIN users u ON u.id=h.actor_id WHERE membership_id=$1 ORDER BY h.version DESC LIMIT 1001`, id)
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer rows.Close()
	type entry struct {
		Version   int             `json:"version"`
		Action    string          `json:"action"`
		Actor     string          `json:"actor"`
		CreatedAt time.Time       `json:"createdAt"`
		Data      json.RawMessage `json:"data"`
	}
	out := []entry{}
	for rows.Next() {
		var e entry
		if err = rows.Scan(&e.Version, &e.Action, &e.Actor, &e.CreatedAt, &e.Data); err != nil {
			dbFailure(w, err)
			return
		}
		out = append(out, e)
		if len(out) > 1000 {
			collectionLimit(w)
			return
		}
	}
	if rows.Err() != nil {
		dbFailure(w, rows.Err())
		return
	}
	respond(w, 200, out)
}
func (a *App) sources(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	type source struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		Category    string `json:"category"`
		Status      string `json:"status"`
		Description string `json:"description"`
	}
	respond(w, 200, []source{
		{"ad", "Active Directory", "directory", "not_configured", "Personel ve hesap eşleştirme için planlanan dizin bağlantısı. Henüz veri alınmıyor."},
		{"wef", "Windows / WEF", "events", "not_configured", "Giriş, yetki ve hesap yaşam döngüsü olayları. Toplayıcı henüz kurulmadı."},
		{"network", "Palo Alto Networks", "network", "not_configured", "PAN-OS / Panorama trafik, tehdit ve GlobalProtect olayları. Canlı toplayıcı henüz uygulanmadı."},
		{"nac-siem", "Logsign SIEM", "security", "not_configured", "SIEM alarm ve olayları için sürüme bağlı API / aktarım seçenekleri. Canlı toplayıcı henüz uygulanmadı."},
		{"edr", "Trend Micro", "endpoint", "not_configured", "Vision One, Apex One / Apex Central ve Deep Security ayrı kaynak profilleridir. Canlı toplayıcı henüz uygulanmadı."},
		{"m365", "Microsoft 365", "cloud", "not_configured", "Kurumsal bulut hesap ve erişim olayları için planlanan kaynak."},
		{"api", "Özel kaynak / JSON", "custom", "not_configured", "Ortak olay sözleşmesiyle yönetici tarafından yerel JSON içe aktarımı. Otomatik API veya Syslog toplayıcısı yok."},
	})
}
