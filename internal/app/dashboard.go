package app

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

// dashboardTrendDays is the number of UTC calendar days in the event trend,
// ending with the snapshot's current UTC day.
const dashboardTrendDays = 14

// severityCounts has one field per severity accepted by validEventSeverity.
type severityCounts struct {
	Info     int64 `json:"info"`
	Low      int64 `json:"low"`
	Medium   int64 `json:"medium"`
	High     int64 `json:"high"`
	Critical int64 `json:"critical"`
}

func (c *severityCounts) add(severity string, n int64) error {
	switch severity {
	case "info":
		c.Info += n
	case "low":
		c.Low += n
	case "medium":
		c.Medium += n
	case "high":
		c.High += n
	case "critical":
		c.Critical += n
	default:
		return fmt.Errorf("unexpected event severity %q", severity)
	}
	return nil
}

func (c severityCounts) total() int64 { return c.Info + c.Low + c.Medium + c.High + c.Critical }

type dashboardTrendDay struct {
	Day string `json:"day"`
	severityCounts
}

type dashboardCases struct {
	Open   int64 `json:"open"`
	Closed int64 `json:"closed"`
}

type dashboardResult struct {
	GeneratedAt         time.Time           `json:"generatedAt"`
	EventTrend          []dashboardTrendDay `json:"eventTrend"`
	EventSeverityTotals severityCounts      `json:"eventSeverityTotals"`
	EventTotal          int64               `json:"eventTotal"`
	Cases               dashboardCases      `json:"cases"`
	SourceCount         int64               `json:"sourceCount"`
}

func (a *App) registerDashboard(m *http.ServeMux) {
	m.Handle("GET /api/dashboard", a.auth(http.HandlerFunc(a.getDashboard)))
}

func (a *App) getDashboard(w http.ResponseWriter, r *http.Request) {
	if !riskAccess(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		invalid(w, "Pano özeti sorgu parametresi kabul etmez.")
		return
	}
	tx, generatedAt, err := a.beginWatchlistSnapshot(r.Context())
	if err != nil {
		dbFailure(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	result, err := readDashboard(r.Context(), tx, generatedAt)
	if err != nil {
		dbFailure(w, err)
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		dbFailure(w, err)
		return
	}
	respond(w, http.StatusOK, result)
}

func readDashboard(ctx context.Context, tx pgx.Tx, generatedAt time.Time) (dashboardResult, error) {
	result := dashboardResult{GeneratedAt: generatedAt.UTC(), EventTrend: make([]dashboardTrendDay, dashboardTrendDays)}
	today := time.Date(generatedAt.Year(), generatedAt.Month(), generatedAt.Day(), 0, 0, 0, 0, time.UTC)
	start := today.AddDate(0, 0, -(dashboardTrendDays - 1))
	end := today.AddDate(0, 0, 1)
	index := make(map[string]int, dashboardTrendDays)
	for i := range result.EventTrend {
		day := start.AddDate(0, 0, i).Format(time.DateOnly)
		result.EventTrend[i].Day = day
		index[day] = i
	}

	rows, err := tx.Query(ctx, `SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD'),severity,count(*) FROM security_events
 WHERE occurred_at>=$1 AND occurred_at<$2 GROUP BY 1,2`, start, end)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var day, severity string
		var n int64
		if err := rows.Scan(&day, &severity, &n); err != nil {
			rows.Close()
			return result, err
		}
		i, ok := index[day]
		if !ok {
			rows.Close()
			return result, fmt.Errorf("event trend day %q outside the requested range", day)
		}
		if err := result.EventTrend[i].add(severity, n); err != nil {
			rows.Close()
			return result, err
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}

	rows, err = tx.Query(ctx, `SELECT severity,count(*) FROM security_events GROUP BY severity`)
	if err != nil {
		return result, err
	}
	for rows.Next() {
		var severity string
		var n int64
		if err := rows.Scan(&severity, &n); err != nil {
			rows.Close()
			return result, err
		}
		if err := result.EventSeverityTotals.add(severity, n); err != nil {
			rows.Close()
			return result, err
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return result, err
	}
	result.EventTotal = result.EventSeverityTotals.total()

	if err := tx.QueryRow(ctx, `SELECT count(*) FILTER (WHERE status='open'),count(*) FILTER (WHERE status='closed') FROM investigation_cases`).Scan(&result.Cases.Open, &result.Cases.Closed); err != nil {
		return result, err
	}
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM source_connections`).Scan(&result.SourceCount); err != nil {
		return result, err
	}
	return result, nil
}
