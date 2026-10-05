package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"xlabvigil/internal/app"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

var errListenAddress = errors.New("VIGIL_ADDR yalnızca 127.0.0.1 üzerinde 1024–65535 arası bir port olabilir.")

func loopbackAddress(value string) (string, error) {
	if value == "" {
		return "127.0.0.1:8320", nil
	}
	const prefix = "127.0.0.1:"
	if !strings.HasPrefix(value, prefix) {
		return "", errListenAddress
	}
	portText := value[len(prefix):]
	if len(portText) == 0 || len(portText) > 5 || portText[0] == '0' {
		return "", errListenAddress
	}
	for _, digit := range portText {
		if digit < '0' || digit > '9' {
			return "", errListenAddress
		}
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1024 || port > 65535 {
		return "", errListenAddress
	}
	return value, nil
}

func run() error {
	addr, err := loopbackAddress(os.Getenv("VIGIL_ADDR"))
	if err != nil {
		return err
	}
	webRoot := filepath.Join("web", "dist")
	if err := requireWebBuild(webRoot); err != nil {
		return errors.New("Ön yüz derlemesi eksik veya okunamıyor. web dizininde npm run build çalıştırın.")
	}
	dsn := os.Getenv("VIGIL_DATABASE_URL")
	if dsn == "" {
		return errors.New("Veritabanı ayarı eksik. scripts/start.ps1 kullanın.")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return errors.New("Veritabanı ayarı okunamadı.")
	}
	defer pool.Close()
	if err = pool.Ping(ctx); err != nil {
		return errors.New("Veritabanına ulaşılamadı.")
	}
	application := app.New(pool, "http://"+addr, webRoot)
	if err = application.Migrate(ctx); err != nil {
		return errors.New("Veritabanı hazırlanamadı.")
	}
	srv := &http.Server{Addr: addr, Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 * 1024}
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return errors.New("Uygulama başlatılamadı; port kullanımını kontrol edin.")
	}
	runContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log.Printf("XLab Vigil hazır: http://%s (yerel geliştirme)", addr)
	return serveHTTP(runContext, srv, listener)
}
