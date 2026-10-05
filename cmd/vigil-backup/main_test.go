package main

import (
	"bytes"
	"strings"
	"testing"
)

func TestCLIRejectsSecretArgumentsAndInvalidStdinWithoutEcho(t *testing.T) {
	secret := "Never-echo-this-secret-value"
	for _, args := range [][]string{{}, {"unknown", secret}, {"encrypt", "--password", secret}, {"decrypt", "--input", "file", "--output-dir", "dir", secret}, {"encrypt", "--source-dir", "dir"}} {
		var stderr bytes.Buffer
		if code := run(args, strings.NewReader(secret), &stderr); code != 2 {
			t.Fatalf("usage error exit: %d", code)
		}
		if strings.Contains(stderr.String(), secret) {
			t.Fatal("CLI echoed secret argument")
		}
	}
	for _, password := range []string{secret + "\nextra", secret + "\x00", secret + "\r", secret + string([]byte{0xff})} {
		var stderr bytes.Buffer
		if code := run([]string{"encrypt", "--source-dir", "dir", "--output", "file"}, strings.NewReader(password), &stderr); code != 1 {
			t.Fatalf("invalid stdin exit: %d", code)
		}
		if strings.Contains(stderr.String(), secret) {
			t.Fatal("CLI echoed stdin password")
		}
	}
	var stderr bytes.Buffer
	if code := run([]string{"encrypt", "--source-dir", secret, "--output", "file"}, strings.NewReader(secret), &stderr); code != 1 {
		t.Fatalf("missing source exit: %d", code)
	}
	if strings.Contains(stderr.String(), secret) {
		t.Fatal("CLI echoed filesystem argument")
	}
}
