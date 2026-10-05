package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

func requireWebBuild(webRoot string) error {
	file, err := os.Open(filepath.Join(webRoot, "index.html"))
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 {
		return errors.New("web index must be a non-empty regular file")
	}
	return nil
}

// Wait for graceful shutdown before main closes the database pool. Serve stops
// accepting connections before Shutdown has finished draining active requests.
func serveHTTP(ctx context.Context, server *http.Server, listener net.Listener) error {
	served := make(chan error, 1)
	go func() { served <- server.Serve(listener) }()
	var serveErr error
	stopped := false
	select {
	case serveErr = <-served:
		stopped = true
	case <-ctx.Done():
	}
	// An unexpected listener failure must drain active requests as well.
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := server.Shutdown(shutdown)
	if err != nil {
		_ = server.Close()
	}
	if !stopped {
		serveErr = <-served
	}
	if err != nil {
		return err
	}
	if !errors.Is(serveErr, http.ErrServerClosed) {
		return serveErr
	}
	return nil
}
