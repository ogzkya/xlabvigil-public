//go:build !windows

package backupcrypto

import (
	"os"
	"testing"
)

func makePrivate(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
}
