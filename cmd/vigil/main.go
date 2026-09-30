package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"xlabvigil/internal/app"
)

func main() {
	addr := os.Getenv("VIGIL_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8320"
	}
	if addr != "127.0.0.1:8320" && addr != "127.0.0.1:8321" {
		log.Fatal("Bu geliştirme sürümü yalnızca ayrılmış yerel adreslerde çalışır.")
	}
	dsn := os.Getenv("VIGIL_DATABASE_URL")
	if dsn == "" {
		log.Fatal("Veritabanı ayarı eksik. scripts/start.ps1 kullanın.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatal("Veritabanı ayarı okunamadı.")
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		log.Fatal("Veritabanına ulaşılamadı.")
	}
	application := app.New(pool, "http://"+addr, "web/dist")
	if err = application.Migrate(ctx); err != nil {
		log.Fatal("Veritabanı hazırlanamadı.")
	}
	srv := &http.Server{Addr: addr, Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-stop
		shutdown, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = srv.Shutdown(shutdown)
	}()
	log.Printf("XLab Vigil hazır: http://%s (yerel geliştirme)", addr)
	if err = srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal("Uygulama başlatılamadı; port kullanımını kontrol edin.")
	}
}
