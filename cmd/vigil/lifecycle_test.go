package main

import (
	"context"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestServeHTTPWaitsForActiveRequestDuringShutdown(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	started, release, stopping := make(chan struct{}), make(chan struct{}), make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "saved")
	})}
	defer server.Close()
	server.RegisterOnShutdown(func() { close(stopping) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- serveHTTP(ctx, server, listener) }()
	response := make(chan error, 1)
	go func() {
		client := &http.Client{Timeout: 3 * time.Second}
		result, err := client.Get("http://" + listener.Addr().String())
		if err == nil {
			defer result.Body.Close()
			var data []byte
			data, err = io.ReadAll(result.Body)
			if err == nil && (result.StatusCode != http.StatusOK || string(data) != "saved") {
				err = errors.New("active response was not completed")
			}
		}
		response <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("request did not start")
	}
	cancel()
	select {
	case <-stopping:
	case <-time.After(3 * time.Second):
		close(release)
		t.Fatal("shutdown did not start")
	}
	select {
	case err := <-done:
		close(release)
		t.Fatalf("server returned before the active request completed: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	select {
	case err := <-response:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("active response did not complete")
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("shutdown did not complete")
	}
}

func TestServeHTTPReportsListenerFailureWithoutWaitingForStop(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	if err := listener.Close(); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { done <- serveHTTP(ctx, &http.Server{}, listener) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("listener failure was reported as a successful stop")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("listener failure waited for a stop signal")
	}
}

func TestRequireWebBuildRejectsMissingEmptyOrDirectoryIndex(t *testing.T) {
	for _, state := range []string{"missing", "empty", "directory", "ready"} {
		t.Run(state, func(t *testing.T) {
			root := t.TempDir()
			index := filepath.Join(root, "index.html")
			if state == "directory" {
				if err := os.Mkdir(index, 0700); err != nil {
					t.Fatal(err)
				}
			} else if state != "missing" {
				var content []byte
				if state == "ready" {
					content = []byte("<!doctype html><title>XLab Vigil</title>")
				}
				if err := os.WriteFile(index, content, 0600); err != nil {
					t.Fatal(err)
				}
			}
			err := requireWebBuild(root)
			if (err == nil) != (state == "ready") {
				t.Fatalf("build state %s: %v", state, err)
			}
		})
	}
}
